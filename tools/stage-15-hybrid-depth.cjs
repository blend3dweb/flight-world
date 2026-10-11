// Live, same-route numeric FPS comparison. No screenshots or video.
const { chromium } = require('C:/Users/sva/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const origin = 'http://127.0.0.1:8765';
const fullRoi = process.argv.includes('--full-roi');
const output = path.join(root, `docs/verification/stage-15-hybrid-depth${fullRoi ? '-full' : ''}.json`);
const route = {
  start: { x: -2320, y: 190, z: -2110, heading: -Math.PI / 2, pitch: 0, roll: 0 },
  waypoint: { x: -1800, y: 190, z: -2110 },
  view: { mode: 'external', azimuth: .8, elevation: .9, distance: 65, auto: false },
};
const modes = ['gaussian', 'hybrid', 'gaussian'];

function gpuMiB() {
  try { return Number(execFileSync('nvidia-smi', ['--query-gpu=memory.used', '--format=csv,noheader,nounits'], { encoding: 'utf8', windowsHide: true }).trim().split(/\r?\n/)[0]); }
  catch { return null; }
}

async function ensureServer() {
  try { if ((await fetch(origin + '/webgpu/index.html', { signal: AbortSignal.timeout(1500) })).ok) return null; }
  catch { /* launch */ }
  const server = spawn(process.execPath, [path.join(root, 'serve.cjs')], { cwd: root, windowsHide: true, stdio: 'ignore' });
  for (let i = 0; i < 40; i++) {
    await new Promise(resolve => setTimeout(resolve, 250));
    try { if ((await fetch(origin + '/webgpu/index.html')).ok) return server; } catch { /* starting */ }
  }
  server.kill();
  throw Error('Local server did not start');
}

async function main() {
  const server = await ensureServer();
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--force-high-performance-gpu', '--use-webgpu-power-preference=high-performance'] });
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    const errors = [];
    const resources = new Map();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('response', response => { if (response.url().startsWith(origin)) resources.set(response.url(), Number(response.headers()['content-length']) || 0); });
    page.on('crash', () => errors.push('Page crashed'));
    await page.goto(origin + `/webgpu/index.html?test=1&matrixcity=1${fullRoi ? '&density=full' : ''}`);
    await page.waitForFunction(() => window.flightReady && window.flight.matrixCityTrial?.splat, null, { timeout: 120000 });
    const adapter = await page.evaluate(() => flight.inspect().renderer.backend.device.adapterInfo);
    const report = { stage: '15.3 depth-prepass trial', date: new Date().toISOString(), adapter, viewport: { width: 1920, height: 1080 }, quality: 'high', environment: '10:00, sunny and dry, cycle off', route, modes, trials: [], errors, splatCount: fullRoi ? 67915 : 30000, note: 'Same route; Gaussian-only vs depth-only mesh plus Gaussian, followed by a Gaussian repeat. Frames only, no saved images or video.' };
    for (const mode of modes) {
      await page.evaluate(({ mode, route }) => {
        flight.startFlight('city');
        flight.setQuality('high');
        flight.setEnvironment({ hour: 10, cycle: false, weather: 'sun', autoWeather: false }, { immediate: true });
        flight.setView(route.view.mode);
        flight.setOrbit(route.view);
        flight.place(route.start);
        flight.setMatrixCityMode(mode);
        flight.setFlightRoute([route.waypoint]);
      }, { mode, route });
      await page.waitForTimeout(5000);
      const startGpuMiB = gpuMiB();
      const trial = await page.evaluate(async ({ mode, route }) => {
        // Keep rewind and start timestamp in the same browser task: no host-side
        // GPU query may let the aircraft advance between them.
        flight.startFlight('city');
        flight.setEnvironment({ hour: 10, cycle: false, weather: 'sun', autoWeather: false }, { immediate: true });
        flight.setView(route.view.mode);
        flight.setOrbit(route.view);
        flight.place(route.start);
        flight.setMatrixCityMode(mode);
        flight.setFlightRoute([route.waypoint]);
        const start = performance.now();
        const startState = flight.getState();
        await new Promise(resolve => setTimeout(resolve, 5000));
        const timeline = flight.getPerformanceHistory().filter(item => item.timeMs >= start)
          .map(item => ({ elapsedMs: Math.round(item.timeMs - start), frameMs: Math.round(item.frameMs * 100) / 100 }));
        const ordered = timeline.map(item => item.frameMs).sort((a, b) => a - b);
        const quantile = q => ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * q))] ?? null;
        const sum = ordered.reduce((a, b) => a + b, 0);
        return { mode, frames: ordered.length, medianFrameMs: quantile(.5), p95FrameMs: quantile(.95), p99FrameMs: quantile(.99),
          maxFrameMs: ordered.at(-1) ?? null, meanFps: sum ? 1000 * ordered.length / sum : null,
          over50Ms: ordered.filter(value => value > 50).length, timeline,
          renderer: { ...flight.inspect().renderer.info.render }, jsHeapBytes: performance.memory?.usedJSHeapSize ?? null,
          stateStart: { x: startState.x, y: startState.y, z: startState.z, matrixCityMode: startState.matrixCityMode },
          state: { x: flight.getState().x, y: flight.getState().y, z: flight.getState().z, matrixCityMode: flight.getState().matrixCityMode } };
      }, { mode, route });
      trial.gpuMiB = { start: startGpuMiB, end: gpuMiB() };
      report.trials.push(trial);
      fs.writeFileSync(output, JSON.stringify(report, null, 2));
      console.log(`${mode}: ${trial.meanFps?.toFixed(2)} FPS, p95 ${trial.p95FrameMs?.toFixed(1)} ms, ${trial.frames} frames`);
    }
    report.resourceCount = resources.size;
    report.downloadedBytes = [...resources.values()].reduce((sum, value) => sum + value, 0);
    report.gpuMemoryNote = 'nvidia-smi reports whole-adapter memory, including other applications.';
    fs.writeFileSync(output, JSON.stringify(report, null, 2));
    if (errors.length) throw Error(errors.join('; '));
  } finally {
    await browser?.close();
    server?.kill();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
