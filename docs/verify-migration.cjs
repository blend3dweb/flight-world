const { chromium } = require('C:/Users/sva/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const project = path.resolve(__dirname, '..'), out = path.join(__dirname, 'verification');
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const response = await fetch('http://127.0.0.1:8765/webgpu/flight.js');
  assert.ok(response.ok);
  const servedHash = sha256(Buffer.from(await response.arrayBuffer()));
  assert.equal(servedHash, sha256(fs.readFileSync(path.join(project, 'webgpu/flight.js'))));
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--force-high-performance-gpu', '--use-webgpu-power-preference=high-performance'] });
  const errors = [], shots = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto('http://127.0.0.1:8765/webgpu/index.html?render=1');
    await page.waitForFunction(() => window.flightReady, null, { timeout: 120000 });
    const backend = await page.evaluate(() => {
      const renderer = flight.inspect().renderer;
      return { webgpu: !!renderer.backend.isWebGPUBackend, vendor: renderer.backend.device.adapterInfo.vendor, revision: flight.revision };
    });
    assert.equal(backend.webgpu, true);
    assert.equal(backend.vendor, 'nvidia');
    for (const state of [{ name: '01-cockpit-day', hour: 10, weather: 'sun', view: 'cockpit' }, { name: '02-external-night', hour: 0, weather: 'sun', view: 'external' }, { name: '03-external-rain', hour: 12, weather: 'rain', view: 'external' }, { name: '04-cockpit-snow', hour: 12, weather: 'snow', view: 'cockpit' }]) {
      const result = await page.evaluate(async state => {
        flight.seek(8);
        flight.setEnvironment({ hour: state.hour, weather: state.weather, cycle: false, autoWeather: false }, { immediate: true });
        flight.setView(state.view);
        if (state.view === 'external') flight.setOrbit({ azimuth: 1.6, elevation: .18, distance: 30, auto: false });
        flight.step(0);
        await flight.inspect().renderer.backend.device.queue.onSubmittedWorkDone();
        return flight.getState();
      }, state);
      assert.equal(result.viewMode, state.view);
      assert.equal(result.environment.weather, state.weather);
      await page.screenshot({ path: path.join(out, state.name + '.png') });
      shots.push({ ...state, state: result });
    }
    assert.deepEqual(errors, []);
    const report = { date: new Date().toISOString(), project, servedFlightSha256: servedHash, backend, shots, errors, videoCreated: false };
    fs.writeFileSync(path.join(out, 'migration-smoke.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ project, backend, shots: shots.map(s => s.name), errors }, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
