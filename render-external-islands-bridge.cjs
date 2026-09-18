const { chromium } = require('C:/Users/sva/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs = require('node:fs');
const path = require('node:path');

const output = path.join(__dirname, 'exports', 'time-slider-fixed-renders');
fs.mkdirSync(output, { recursive: true });

const externalStates = [
  { file: '06-external-city-day.png', location: 'city', hour: 12, azimuth: 0.75, elevation: 0.22, distance: 27 },
  { file: '07-external-islands-day.png', location: 'islands', hour: 13, azimuth: 1.15, elevation: 0.18, distance: 30 },
  { file: '08-external-islands-sunset.png', location: 'islands', hour: 18, azimuth: 2.25, elevation: 0.24, distance: 29 },
];

const bridgeStates = [
  { file: '09-bridge-overview.png', eye: [400, 220, -1250], target: [-250, 60, -1990], hour: 14 },
  { file: '10-bridge-low-angle.png', eye: [-1080, 105, -1600], target: [320, 28, -1988], hour: 17 },
];

(async () => {
  const errors = [];
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto('http://127.0.0.1:8765/webgpu/index.html?render=1', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.flightReady === true, null, { timeout: 120000 });
    await page.evaluate(() => flight.setQuality('balanced'));

    const rendered = [];
    for (const state of externalStates) {
      await page.evaluate((s) => {
        flight.startFlight(s.location);
        flight.setView('external');
        flight.setOrbit({ auto: false, distance: s.distance, azimuth: s.azimuth, elevation: s.elevation });
        flight.setEnvironment({ hour: s.hour, cycle: false, weather: 'sun', autoWeather: false }, { immediate: true });
        for (let i = 0; i < 8; i++) flight.step(1 / 30);
      }, state);
      await page.waitForTimeout(400);
      const filePath = path.join(output, state.file);
      await page.screenshot({ path: filePath });
      rendered.push({ ...state, bytes: fs.statSync(filePath).size, type: 'external-flight' });
    }

    await page.evaluate(() => {
      flight.setQuality('high');
      flight.setSize(1600, 900);
      flight.startFlight('city');
    });
    for (const state of bridgeStates) {
      const dataUrl = await page.evaluate(async (s) => {
        flight.setEnvironment({ hour: s.hour, cycle: false, weather: 'sun', autoWeather: false }, { immediate: true });
        return flight.captureShot({ eye: s.eye, target: s.target });
      }, state);
      const filePath = path.join(output, state.file);
      fs.writeFileSync(filePath, Buffer.from(dataUrl.split(',')[1], 'base64'));
      rendered.push({ ...state, bytes: fs.statSync(filePath).size, type: 'bridge-camera' });
    }

    if (errors.length) throw new Error(`Browser errors: ${errors.join(' | ')}`);
    fs.writeFileSync(path.join(output, 'external-manifest.json'), `${JSON.stringify({ rendered, errors }, null, 2)}\n`);
    console.log(JSON.stringify({ output, count: rendered.length, errors }, null, 2));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
