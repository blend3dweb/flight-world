// Stage 15.1: repeatable numeric baseline; never captures screenshots or video.
const { chromium } = require('C:/Users/sva/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const origin = 'http://127.0.0.1:8765';
const output = path.join(__dirname, 'docs/verification/stage-15-1-baseline.json');
const viewport = { width: 1920, height: 1080 };
const route = {
  block: { ix: 2, iz: 2, id: 12, center: [-2088.4, -2109.4] },
  start: { x: -2320, y: 190, z: -2110, heading: -Math.PI / 2, pitch: 0, roll: 0 },
  waypoint: { x: -1800, y: 190, z: -2110 },
  view: { mode: 'external', azimuth: 0.8, elevation: 0.9, distance: 65, auto: false },
};

function gpuMemoryMiB() {
  try {
    const raw = execFileSync('nvidia-smi', ['--query-gpu=memory.used', '--format=csv,noheader,nounits'], { encoding: 'utf8', windowsHide: true });
    return Number(raw.trim().split(/\r?\n/)[0]);
  } catch { return null; }
}

async function ensureServer() {
  try {
    const response = await fetch(origin + '/webgpu/index.html', { signal: AbortSignal.timeout(1500) });
    if (!response.ok || !(await response.text()).includes('flight.js')) throw Error('Port 8765 serves a different application.');
    return null;
  } catch (error) {
    if (error.message.includes('different application')) throw error;
  }
  const child = spawn(process.execPath, [path.join(__dirname, 'serve.cjs')], { cwd: __dirname, windowsHide: true, stdio: 'ignore' });
  for (let i = 0; i < 40; i++) {
    await new Promise(resolve => setTimeout(resolve, 250));
    try { if ((await fetch(origin + '/webgpu/index.html')).ok) return child; } catch { /* wait */ }
  }
  child.kill();
  throw Error('Local server did not start.');
}

async function main() {
  const gpuIdleMiB = gpuMemoryMiB();
  const server = await ensureServer();
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--force-high-performance-gpu', '--use-webgpu-power-preference=high-performance'] });
    browser.on('disconnected', () => console.error('Benchmark Chrome disconnected.'));
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on('pageerror', error => { errors.push(error.message); console.error('PAGE ERROR', error.message); });
    page.on('console', message => { if (message.type() === 'error') { errors.push(message.text()); console.error('CONSOLE ERROR', message.text()); } });
    page.on('crash', () => { errors.push('Page crashed'); console.error('PAGE CRASHED'); });
    page.on('close', () => console.error('Benchmark page closed.'));
    const resources = new Map();
    page.on('response', response => {
      if (response.url().startsWith(origin)) resources.set(response.url(), Number(response.headers()['content-length']) || 0);
    });
    await page.goto(origin + '/webgpu/index.html?test=1');
    await page.waitForFunction(() => window.flightReady, null, { timeout: 120000 });
    const setup = await page.evaluate(route => {
      const d = flight.inspect();
      if (d.renderer.backend.device.adapterInfo.vendor !== 'nvidia') throw Error('Expected NVIDIA WebGPU adapter.');
      flight.setQuality('high');
      flight.setEnvironment({ hour: 10, cycle: false, weather: 'sun', autoWeather: false }, { immediate: true });
      flight.setView(route.view.mode);
      flight.setOrbit(route.view);
      const block = d.infrastructure.blocks[route.block.id];
      const buildings = d.infrastructure.buildings.filter(item => item.block === route.block.id).map(item => ({ x: item.x, z: item.z, height: item.h, style: item.style }));
      const supportedTimestamp = d.renderer.backend.device.features.has('timestamp-query');
      return {
        adapter: {
          vendor: d.renderer.backend.device.adapterInfo.vendor,
          architecture: d.renderer.backend.device.adapterInfo.architecture,
          device: d.renderer.backend.device.adapterInfo.device,
          description: d.renderer.backend.device.adapterInfo.description,
        },
        timestampQuerySupported: supportedTimestamp,
        timestampQueryEnabled: d.renderer.backend.trackTimestamp,
        blockPolygon: block,
        buildings,
        cityStats: d.infrastructure.stats,
        deviceMemoryGB: navigator.deviceMemory ?? null,
      };
    }, route);
    if (setup.buildings.length < 3) throw Error('Selected block is empty.');

    const cases = ['baseline-1', 'city-hidden', 'reflection-held', 'baseline-2'];
    const trials = [];
    for (const name of cases) {
      await page.evaluate(({ route, name }) => {
        const d = flight.inspect();
        if (window.__stage15Undo) { window.__stage15Undo(); window.__stage15Undo = null; }
        flight.startFlight('city');
        flight.setEnvironment({ hour: 10, cycle: false, weather: 'sun', autoWeather: false }, { immediate: true });
        flight.setView(route.view.mode);
        flight.setOrbit(route.view);
        flight.place(route.start);
        flight.setFlightRoute([route.waypoint]);
        const undo = [];
        if (name === 'city-hidden') {
          const old = d.infrastructure.group.visible;
          d.infrastructure.group.visible = false;
          undo.push(() => { d.infrastructure.group.visible = old; });
        } else if (name === 'reflection-held') {
          const old = d.water.update;
          d.water.update = () => {};
          undo.push(() => { d.water.update = old; });
        }
        window.__stage15Undo = () => undo.reverse().forEach(fn => fn());
      }, { route, name });
      await page.bringToFront();
      await page.waitForTimeout(8000);
      const startGpuMiB = gpuMemoryMiB();
      const result = await page.evaluate(async name => {
        const d = flight.inspect();
        const start = flight.getState();
        const sampleStartMs = performance.now();
        const initialReflection = start.ocean.reflectionUpdates;
        const initialSky = start.environment.reflectionUpdates;
        const intervals = [];
        let last = 0;
        await new Promise(resolve => {
          const since = performance.now();
          const tick = now => {
            if (last) intervals.push(now - last);
            last = now;
            if (now - since < 5000) requestAnimationFrame(tick);
            else resolve();
          };
          requestAnimationFrame(tick);
        });
        const ordered = [...intervals].sort((a, b) => a - b);
        const at = q => ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * q))];
        const end = flight.getState();
        const timeline = flight.getPerformanceHistory().filter(entry => entry.timeMs >= sampleStartMs).map(entry => ({ elapsedMs: Math.round(entry.timeMs - sampleStartMs), frameMs: Math.round(entry.frameMs * 100) / 100, instantaneousFps: Math.round(100000 / entry.frameMs) / 100 }));
        return {
          name,
          sampleSeconds: 5,
          frames: intervals.length,
          medianFrameMs: at(.5), p95FrameMs: at(.95), p99FrameMs: at(.99), maxFrameMs: ordered.at(-1),
          over33ms: intervals.filter(ms => ms > 33.4).length,
          over50ms: intervals.filter(ms => ms > 50).length,
          meanFps: intervals.length * 1000 / intervals.reduce((sum, ms) => sum + ms, 0),
          liveFpsAtEnd: flight.getPerformance(),
          hudTextAtEnd: document.querySelector('#performance-hud')?.textContent ?? null,
          timeline,
          cpuSubmission: flight.agent.telemetry().cpuSubmitMs,
          rendererInfo: { ...d.renderer.info.render },
          rendererMemory: { ...d.renderer.info.memory },
          jsHeapBytes: performance.memory?.usedJSHeapSize ?? null,
          reflectionUpdates: end.ocean.reflectionUpdates - initialReflection,
          skyCaptures: end.environment.reflectionUpdates - initialSky,
          stateStart: { x: start.x, y: start.y, z: start.z, environment: start.environment },
          stateEnd: { x: end.x, y: end.y, z: end.z, environment: end.environment },
        };
      }, name);
      result.gpuMemoryUsedMiB = { start: startGpuMiB, end: gpuMemoryMiB() };
      trials.push(result);
      fs.writeFileSync(output, JSON.stringify({ stage: '15.1', status: 'partial', date: new Date().toISOString(), viewport, quality: 'high', route, setup, trials, errors }, null, 2));
      console.log(`${name}: median ${result.medianFrameMs?.toFixed(1) ?? 'n/a'} ms, p95 ${result.p95FrameMs?.toFixed(1) ?? 'n/a'} ms, ${result.frames} frames`);
    }
    const hudCheck = await page.evaluate(async () => {
      flight.setPaused(true);
      await new Promise(resolve => setTimeout(resolve, 350));
      const paused = { state: flight.getPerformance(), text: document.querySelector('#performance-hud').textContent };
      flight.setPaused(false);
      await new Promise(resolve => setTimeout(resolve, 1000));
      const resumed = { state: flight.getPerformance(), text: document.querySelector('#performance-hud').textContent };
      return { paused, resumed };
    });
    assert.equal(hudCheck.paused.state.paused, true);
    assert.equal(hudCheck.paused.state.fps, 0);
    assert.equal(hudCheck.resumed.state.paused, false);
    const final = await page.evaluate(() => { if (window.__stage15Undo) window.__stage15Undo(); return flight.getState(); });
    const report = {
      stage: '15.1', date: new Date().toISOString(), viewport, quality: 'high', route,
      environment: { hour: 10, cycle: false, weather: 'sun', autoWeather: false, exposure: 1.05 },
      setup, trials, hudCheck, finalEnvironment: final.environment,
      gpuIdleMiB, gpuMemoryNote: 'nvidia-smi reports whole-adapter memory, not this browser process; use only as a coarse bound.',
      downloadedBytes: [...resources.values()].reduce((sum, bytes) => sum + bytes, 0),
      resourceCount: resources.size,
      errors,
      limitations: ['GPU timestamp is not enabled in the production renderer; per-pass GPU timing requires an isolated instrumented build.', 'Ablations alter the image and are diagnostic, not final quality comparisons.', 'nvidia-smi whole-adapter memory includes unrelated applications.'],
    };
    fs.writeFileSync(output, JSON.stringify(report, null, 2));
    if (errors.length) throw Error('Browser errors: ' + errors.join('; '));
    console.log(`Saved ${output}`);
  } finally {
    if (browser) await browser.close();
    if (server) server.kill();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
