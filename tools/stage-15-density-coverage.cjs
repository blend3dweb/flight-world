// Compare local MatrixCity RGB coverage numerically, using only in-memory frames.
const { chromium } = require('C:/Users/sva/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--force-high-performance-gpu', '--use-webgpu-power-preference=high-performance'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    const results = [];
    for (const density of ['30k', 'full']) {
      const suffix = density === 'full' ? '&density=full' : '';
      await page.goto(`http://127.0.0.1:8765/webgpu/index.html?matrixcity=1&focus=hybrid&isolate=1${suffix}`);
      await page.waitForFunction(() => window.flightReady && flight.getState().matrixCityIsolated, {}, { timeout: 120000 });
      const rows = await page.evaluate(async () => {
        const target = [-2090, 42, -2109];
        const views = [
          { name: 'south', position: [-2090, 115, -1930] },
          { name: 'east', position: [-1905, 115, -2109] },
        ];
        const rows = [];
        for (const view of views) {
          flight.agent.setObserver({ position: view.position, target, fov: 58 });
          for (const mode of ['gaussian', 'hybrid']) {
            flight.setMatrixCityMode(mode);
            const observation = await flight.agent.observe({ visual: true, sensors: ['rgb'], width: 320, height: 180, quality: .92 });
            const image = new Image();
            image.src = observation.visual.passes.rgb.dataUrl;
            await image.decode();
            const canvas = document.createElement('canvas');
            canvas.width = image.width;canvas.height = image.height;
            const context = canvas.getContext('2d');
            context.drawImage(image, 0, 0);
            const { data } = context.getImageData(0, 0, image.width, image.height);
            const background = data.slice(0, 3);
            let coverage = 0, luma = 0, edges = 0;
            for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
              const i = (y * image.width + x) * 4;
              const difference = Math.abs(data[i]-background[0])+Math.abs(data[i+1]-background[1])+Math.abs(data[i+2]-background[2]);
              if (difference > 45) coverage++;
              luma += data[i]*.2126+data[i+1]*.7152+data[i+2]*.0722;
              if (x && y) {
                const left = i-4, up = i-image.width*4;
                edges += (Math.abs(data[i]-data[left])+Math.abs(data[i+1]-data[left+1])+Math.abs(data[i+2]-data[left+2])+
                  Math.abs(data[i]-data[up])+Math.abs(data[i+1]-data[up+1])+Math.abs(data[i+2]-data[up+2]))/6;
              }
            }
            const count = image.width * image.height;
            rows.push({ view: view.name, mode, splats: flight.matrixCityTrial.splat.splatGeometry.attributes.position.count,
              nonBackgroundPercent: +(coverage * 100 / count).toFixed(2), meanLuminance: +(luma / count).toFixed(2), meanNeighborDifference: +(edges / count).toFixed(2) });
          }
        }
        return rows;
      });
      results.push(...rows);
    }
    if (errors.length) throw Error(errors.join('; '));
    console.log(JSON.stringify(results, null, 2));
  } finally { await browser.close(); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
