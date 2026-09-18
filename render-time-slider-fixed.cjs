const { chromium } = require('C:/Users/sva/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs = require('node:fs');
const path = require('node:path');

const output = path.join(__dirname, 'exports', 'time-slider-fixed-renders');
if (path.dirname(output) !== path.join(__dirname, 'exports') || path.basename(output) !== 'time-slider-fixed-renders') {
  throw new Error(`Unsafe output path: ${output}`);
}

const states = [
  { file: '01-before-sunrise-0530.png', title: 'Предрассветное время', hour: 5.5 },
  { file: '02-morning-0730.png', title: 'Утро', hour: 7.5 },
  { file: '03-noon-1200.png', title: 'Полдень', hour: 12 },
  { file: '04-sunset-1830.png', title: 'Закат', hour: 18.5 },
  { file: '05-night-2300.png', title: 'Ночь', hour: 23 },
];

(async () => {
  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(output, { recursive: true });
  const errors = [];
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto('http://127.0.0.1:8765/webgpu/index.html?render=1', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.flightReady === true, null, { timeout: 120000 });
    await page.evaluate(() => {
      flight.setQuality('balanced');
      flight.startFlight('city');
      flight.setView('cockpit');
    });

    const rendered = [];
    for (const state of states) {
      const environment = await page.evaluate((value) => {
        const slider = document.querySelector('#time-of-day');
        slider.value = String(value);
        slider.dispatchEvent(new Event('input', { bubbles: true }));
        return flight.getState().environment;
      }, state.hour);
      await page.waitForTimeout(250);
      const filePath = path.join(output, state.file);
      await page.screenshot({ path: filePath });
      rendered.push({ ...state, bytes: fs.statSync(filePath).size, captureFace: environment.captureFace });
    }

    if (errors.length) throw new Error(`Browser errors: ${errors.join(' | ')}`);
    if (rendered.some((item) => item.captureFace !== -1)) throw new Error('Partial cubemap capture detected.');
    fs.writeFileSync(path.join(output, 'manifest.json'), `${JSON.stringify({ rendered, errors }, null, 2)}\n`);
    console.log(JSON.stringify({ output, count: rendered.length, errors }, null, 2));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
