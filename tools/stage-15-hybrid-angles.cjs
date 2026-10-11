// Numeric in-memory RGB comparison at fixed MatrixCity viewpoints. No media files.
const { chromium } = require('C:/Users/sva/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const { spawn } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const origin = 'http://127.0.0.1:8765';

async function main() {
  let server;
  let browser;
  try {
    try { if (!(await fetch(origin + '/webgpu/index.html')).ok) throw Error('HTTP error'); }
    catch {
      server = spawn(process.execPath, [path.join(root, 'serve.cjs')], { cwd: root, windowsHide: true, stdio: 'ignore' });
      for (let i = 0; i < 40; i++) {
        await new Promise(resolve => setTimeout(resolve, 250));
        try { if ((await fetch(origin + '/webgpu/index.html')).ok) break; } catch { /* starting */ }
      }
    }
    browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--force-high-performance-gpu', '--use-webgpu-power-preference=high-performance'] });
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(origin + '/webgpu/index.html?test=1&matrixcity=1&density=30k&depth=1');
    await page.waitForFunction(() => window.flightReady && window.flight.matrixCityTrial?.splat, null, { timeout: 120000 });
    const result = await page.evaluate(async () => {
      flight.setPaused(true);
      flight.setEnvironment({ hour: 10, cycle: false, weather: 'sun', autoWeather: false }, { immediate: true });
      const target = [-2090, 42, -2109];
      const views = [
        { name: 'south', position: [-2090, 115, -1930] },
        { name: 'east', position: [-1905, 115, -2109] },
        { name: 'north', position: [-2090, 115, -2290] },
      ];
      async function pixels(dataUrl) {
        const image = new Image();
        image.src = dataUrl;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.width;canvas.height = image.height;
        const context = canvas.getContext('2d');
        context.drawImage(image, 0, 0);
        return context.getImageData(0, 0, canvas.width, canvas.height).data;
      }
      async function capture(mode, position) {
        flight.setMatrixCityMode(mode);
        flight.agent.setObserver({ position, target, fov: 58 });
        const observation = await flight.agent.observe({ visual: true, sensors: ['rgb'], width: 192, height: 108, quality: .9 });
        return pixels(observation.visual.passes.rgb.dataUrl);
      }
      function compare(a, b) {
        let difference = 0, changed = 0, darkA = 0, darkB = 0;
        for (let i = 0; i < a.length; i += 4) {
          const delta = (Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2]))/3;
          difference += delta;
          if (delta > 20) changed++;
          if (a[i]+a[i+1]+a[i+2] < 60) darkA++;
          if (b[i]+b[i+1]+b[i+2] < 60) darkB++;
        }
        const count = a.length/4;
        return { meanAbsRgb: +(difference/count).toFixed(2), changedAbove20Percent: +(100*changed/count).toFixed(2), darkPercentA: +(100*darkA/count).toFixed(2), darkPercentB: +(100*darkB/count).toFixed(2) };
      }
      const rows = [];
      for (const view of views) {
        const gaussian = await capture('gaussian', view.position);
        const hybrid = await capture('hybrid', view.position);
        const repeated = await capture('gaussian', view.position);
        rows.push({ angle: view.name, gaussianVsHybrid: compare(gaussian, hybrid), gaussianRepeat: compare(gaussian, repeated) });
      }
      flight.setMatrixCityMode('original');
      return rows;
    });
    console.log(JSON.stringify({ result, errors }, null, 2));
    if (errors.length) throw Error(errors.join('; '));
  } finally {
    await browser?.close();
    server?.kill();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
