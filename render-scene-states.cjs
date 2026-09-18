const { chromium } = require('C:/Users/sva/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs = require('node:fs');
const path = require('node:path');

const output = path.join(__dirname, 'exports', 'scene-states');
if (path.dirname(output) !== path.join(__dirname, 'exports') || path.basename(output) !== 'scene-states') {
  throw new Error(`Unsafe output path: ${output}`);
}

const states = [
  { file: '01-spring-city-sunrise.png', title: 'Весна · город · рассвет · ясно', location: 'city', hour: 6.4, weather: 'sun', view: 'cockpit', azimuth: 0.8 },
  { file: '02-summer-islands-day.png', title: 'Лето · острова · день · ясно', location: 'islands', hour: 12.5, weather: 'sun', view: 'external', azimuth: 0.75 },
  { file: '03-summer-airport-day.png', title: 'Лето · аэропорт · день · ясно', location: 'airport', hour: 14.0, weather: 'sun', view: 'external', azimuth: 2.15 },
  { file: '04-autumn-city-rain.png', title: 'Осень · город · закат · дождь', location: 'city', hour: 17.2, weather: 'rain', view: 'external', azimuth: 4.0 },
  { file: '05-autumn-islands-rain.png', title: 'Осень · острова · день · дождь', location: 'islands', hour: 11.0, weather: 'rain', view: 'external', azimuth: 1.35 },
  { file: '06-autumn-airport-rain.png', title: 'Осень · аэропорт · сумерки · дождь', location: 'airport', hour: 18.4, weather: 'rain', view: 'external', azimuth: 2.75 },
  { file: '07-winter-city-snow.png', title: 'Зима · город · утро · снег', location: 'city', hour: 8.0, weather: 'snow', view: 'external', azimuth: 3.75 },
  { file: '08-winter-islands-snow.png', title: 'Зима · острова · сумерки · снег', location: 'islands', hour: 19.0, weather: 'snow', view: 'external', azimuth: 1.9 },
  { file: '09-city-night-clear.png', title: 'Город · ночь · ясно', location: 'city', hour: 23.0, weather: 'sun', view: 'external', azimuth: 4.35 },
];

(async () => {
  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(output, { recursive: true });
  const errors = [];
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto('http://127.0.0.1:8765/webgpu/index.html?render=1', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.flightReady === true, null, { timeout: 120000 });
    await page.evaluate(() => flight.setQuality('balanced'));

    const rendered = [];
    for (const state of states) {
      await page.evaluate((s) => {
        flight.startFlight(s.location);
        flight.setView(s.view);
        if (s.view === 'external') flight.setOrbit({ auto: false, distance: 27, azimuth: s.azimuth, elevation: 0.25 });
        flight.setEnvironment({ hour: s.hour, cycle: false, weather: s.weather, autoWeather: false }, { immediate: true });
        for (let i = 0; i < 12; i++) flight.step(1 / 30);
      }, state);
      await page.waitForTimeout(1200);
      const filePath = path.join(output, state.file);
      await page.screenshot({ path: filePath });
      const scene = await page.evaluate(() => flight.getState());
      rendered.push({ ...state, bytes: fs.statSync(filePath).size, triangles: scene.triangles });
    }

    if (errors.length) throw new Error(`Browser errors: ${errors.join(' | ')}`);
    fs.writeFileSync(path.join(output, 'manifest.json'), `${JSON.stringify({ rendered, errors }, null, 2)}\n`);
    console.log(JSON.stringify({ output, count: rendered.length, errors }, null, 2));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
