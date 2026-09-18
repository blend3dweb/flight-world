const { chromium } = require('C:/Users/sva/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const output = path.join(__dirname, 'exports', 'time-slider-audit');
const url = process.env.FLIGHT_URL || 'http://127.0.0.1:8765/webgpu/index.html?render=1';
fs.mkdirSync(output, { recursive: true });

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.flightReady === true, null, { timeout: 120000 });
    await page.evaluate(() => {
      flight.setQuality('balanced');
      flight.startFlight('city');
      flight.setView('cockpit');
    });

    const checks = [];
    for (const hour of [5.5, 7.5, 12, 18.5, 23]) {
      const state = await page.evaluate((value) => {
        const slider = document.querySelector('#time-of-day');
        slider.value = String(value);
        slider.dispatchEvent(new Event('input', { bubbles: true }));
        const environment = flight.getState().environment;
        return {
          hour: environment.hour,
          captureFace: environment.captureFace,
          reflectionUpdates: environment.reflectionUpdates,
        };
      }, hour);
      await page.waitForTimeout(150);
      await page.screenshot({ path: path.join(output, `hour-${String(hour).replace('.', '_')}.png`) });
      checks.push(state);
    }

    assert.deepEqual(errors, []);
    assert.ok(checks.every((check) => check.captureFace === -1), 'A partial cubemap capture remained visible after slider input.');
    assert.ok(checks.every((check, index) => index === 0 || check.reflectionUpdates > checks[index - 1].reflectionUpdates), 'The full sky capture did not refresh for every slider position.');
    fs.writeFileSync(path.join(output, 'audit.json'), `${JSON.stringify({ checks, errors }, null, 2)}\n`);
    console.log(JSON.stringify({ output, checks, errors }, null, 2));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
