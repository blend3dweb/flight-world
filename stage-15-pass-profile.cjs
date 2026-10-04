// Optional GPU timestamp probe. Runs in ?profile=1; normal flight has no timer-query overhead.
const { chromium } = require('C:/Users/sva/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const origin = 'http://127.0.0.1:8765';
const output = path.join(__dirname, 'docs/verification/stage-15-1-gpu-passes.json');

async function main() {
  let server = null, browser = null;
  try {
    try { if (!(await fetch(origin + '/webgpu/index.html')).ok) throw Error('HTTP error'); }
    catch {
      server = spawn(process.execPath, [path.join(__dirname, 'serve.cjs')], { cwd: __dirname, windowsHide: true, stdio: 'ignore' });
      let ready = false;
      for (let i = 0; i < 40; i++) {
        await new Promise(resolve => setTimeout(resolve, 250));
        try { if ((await fetch(origin + '/webgpu/index.html')).ok) { ready = true; break; } } catch { /* wait */ }
      }
      if (!ready) throw Error('Local server did not start.');
    }
    browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--force-high-performance-gpu', '--use-webgpu-power-preference=high-performance'] });
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    const errors = [];
    page.on('pageerror', error => { errors.push(error.message); console.error('PAGE ERROR', error.message); });
    page.on('crash', () => errors.push('Page crashed'));
    await page.goto(origin + '/webgpu/index.html?test=1&profile=1');
    await page.waitForFunction(() => window.flightReady, null, { timeout: 120000 });
    await page.evaluate(() => {
      const d = flight.inspect(), renderer = d.renderer;
      if (renderer.backend.device.adapterInfo.vendor !== 'nvidia') throw Error('Expected NVIDIA WebGPU adapter.');
      flight.setQuality('high');
      flight.startFlight('city');
      flight.setEnvironment({ hour: 10, cycle: false, weather: 'sun', autoWeather: false }, { immediate: true });
      flight.setView('external');
      flight.setOrbit({ auto: false, azimuth: .8, elevation: .9, distance: 65 });
      flight.place({ x: -2320, y: 190, z: -2110, heading: -Math.PI / 2, pitch: 0, roll: 0 });
      flight.setFlightRoute([{ x: -1800, y: 190, z: -2110 }]);
      const labels = new Map();
      const inspector = renderer.inspector, original = inspector.beginRender;
      inspector.beginRender = function (uid, scene, camera, target) {
        let label;
        if (scene === d.scene && camera === d.camera) label = 'main';
        else if (scene === d.scene && target) label = 'reflection-or-offscreen';
        else if (scene === d.scene) label = 'scene-secondary';
        else label = 'other-scene';
        labels.set(uid, { label, sceneName: scene?.name ?? '', sceneType: scene?.type ?? '', cameraType: camera?.type ?? '', targetType: target?.constructor?.name ?? '' });
        return original.apply(this, arguments);
      };
      window.__stage15PassLabels = labels;
    });
    await page.waitForTimeout(15000);
    const result = await page.evaluate(async () => {
      const d = flight.inspect(), renderer = d.renderer;
      if (!renderer.backend.trackTimestamp) return { available: false, reason: 'Timestamp query unavailable on this device.' };
      await renderer.resolveTimestampsAsync('render'); // discard warm-up and release query slots
      const cpuSamples = {};
      const wrap = (object, key, label) => {
        const original = object[key];
        object[key] = function (...args) {
          const sampleLabel = label === 'renderer.render' ? (args[0] === d.scene && args[1] === d.camera ? 'renderer.render.main' : args[0] === d.scene ? 'renderer.render.scene-secondary' : 'renderer.render.other') : label;
          const values = cpuSamples[sampleLabel] ?? (cpuSamples[sampleLabel] = []);
          const start = performance.now();
          try { return original.apply(this, args); }
          finally { values.push(performance.now() - start); }
        };
      };
      for (const [object, key, label] of [
        [d.atmosphere, 'apply', 'atmosphere.apply'],
        [d.vegetation, 'update', 'vegetation.update'],
        [d.infrastructure, 'update', 'city.update'],
        [d.water, 'update', 'water.update'],
        [renderer, 'render', 'renderer.render'],
      ]) wrap(object, key, label);
      const startMs = performance.now();
      await new Promise(resolve => setTimeout(resolve, 3000));
      const totalLastFrameMs = await renderer.resolveTimestampsAsync('render');
      const pool = renderer.backend.timestampQueryPool.render;
      const classify = context => {
        if (context.sceneName?.startsWith('Scene [ Reflector ]')) return 'ocean-reflection';
        if (context.sceneName?.startsWith('Shadow Map')) return 'sun-shadow';
        if (context.sceneName === 'Output Color Transform') return 'output-transform';
        if (context.targetType === 'CubeRenderTarget') return 'sky-cubemap';
        return context.label;
      };
      const entries = [...pool.timestamps].map(([uid, gpuMs]) => {
        const context = window.__stage15PassLabels.get(uid) ?? { label: 'unknown' };
        return { uid, gpuMs, ...context, pass: classify(context) };
      });
      const byPass = {};
      for (const entry of entries) {
        const bucket = byPass[entry.pass] ?? (byPass[entry.pass] = { count: 0, totalGpuMs: 0 });
        bucket.count++;
        bucket.totalGpuMs += entry.gpuMs;
      }
      const cpuByCall = Object.fromEntries(Object.entries(cpuSamples).map(([label, values]) => {
        const sorted = [...values].sort((a, b) => a - b);
        return [label, { count: values.length, meanMs: values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length), p95Ms: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * .95))] ?? null, maxMs: sorted.at(-1) ?? null }];
      }));
      const agentObservations = [];
      for (let i = 0; i < 3; i++) {
        await new Promise(resolve => setTimeout(resolve, 500));
        const beforeAgentFps = flight.getPerformance(), agentStartMs = performance.now();
        const observation = await flight.agent.observe({ visual: true, sensors: ['rgb'], width: 256, height: 144 });
        agentObservations.push({ index: i + 1, wallMs: performance.now() - agentStartMs, width: observation.visual.width, height: observation.visual.height, encodedBytesApprox: Math.floor(observation.visual.dataUrl.length * .75), beforeAgentFps, afterAgentFps: flight.getPerformance() });
      }
      return {
        available: true, elapsedMs: performance.now() - startMs, totalLastFrameMs,
        timestampFrames: renderer.backend.getTimestampFrames('render'),
        byPass, entries, cpuByCall, cpuFrameSubmission: flight.agent.telemetry().cpuSubmitMs, agentObservations,
        fps: flight.getPerformance(),
        state: flight.getState(),
      };
    });
    fs.writeFileSync(output, JSON.stringify({ date: new Date().toISOString(), viewport: { width: 1920, height: 1080 }, quality: 'high', environment: { hour: 10, cycle: false, weather: 'sun' }, result, errors }, null, 2));
    console.log(JSON.stringify({ available: result.available, totalLastFrameMs: result.totalLastFrameMs, byPass: result.byPass, cpuByCall: result.cpuByCall, agentObservations: result.agentObservations, errors }));
  } finally {
    if (browser) await browser.close();
    if (server) server.kill();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
