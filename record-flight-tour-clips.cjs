const { chromium } = require('C:/Users/sva/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs = require('node:fs');
const path = require('node:path');

const outputDir = path.join(__dirname, 'exports', 'tour-clips');
fs.mkdirSync(outputDir, { recursive: true });

const scenes = [
  { name: '01-city-sunrise', location: 'city', view: 'cockpit', hour: 6.4, weather: 'sun', azimuth: 0.7 },
  { name: '02-islands-rain', location: 'islands', view: 'external', hour: 12.5, weather: 'rain', azimuth: 1.15 },
  { name: '03-airport-snow', location: 'airport', view: 'external', hour: 18.2, weather: 'snow', azimuth: 2.3 },
  { name: '04-city-night', location: 'city', view: 'external', hour: 23.0, weather: 'sun', azimuth: 4.1 },
];

async function prepareScene(page, scene) {
  await page.evaluate((s) => {
    flight.startFlight(s.location);
    flight.setView(s.view);
    if (s.view === 'external') flight.setOrbit({ auto: true, distance: 27, azimuth: s.azimuth, elevation: 0.24 });
    flight.setEnvironment({ hour: s.hour, cycle: false, weather: s.weather, autoWeather: false }, { immediate: true });
  }, scene);
  await page.waitForTimeout(2500);
}

async function recordScene(page, scene) {
  const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
  await page.evaluate(({ fileName, durationMs }) => {
    const type = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm';
    const canvas = flight.getCanvas();
    const stream = canvas.captureStream(30);
    const recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 8_000_000 });
    const chunks = [];
    recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
    recorder.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
      const url = URL.createObjectURL(new Blob(chunks, { type }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `${fileName}.webm`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    };
    const compose = () => {
      flight.getCanvas();
      if (recorder.state === 'recording') requestAnimationFrame(compose);
    };
    recorder.start(500);
    compose();
    setTimeout(() => recorder.state === 'recording' && recorder.stop(), durationMs);
  }, { fileName: scene.name, durationMs: 5000 });

  const download = await downloadPromise;
  const output = path.join(outputDir, `${scene.name}.webm`);
  await download.saveAs(output);
  return { output, size: fs.statSync(output).size };
}

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: false,
    args: ['--force-high-performance-gpu', '--use-webgpu-power-preference=high-performance', '--window-size=1300,800'],
  });
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, acceptDownloads: true });
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto('http://127.0.0.1:8765/webgpu/index.html');
    await page.waitForFunction(() => window.flightReady, null, { timeout: 120000 });
    await page.evaluate(() => flight.setQuality('balanced'));

    const results = [];
    for (const scene of scenes) {
      await prepareScene(page, scene);
      results.push(await recordScene(page, scene));
    }

    if (errors.length) throw new Error(`Browser errors: ${errors.join(' | ')}`);
    console.log(JSON.stringify({ results, errors }, null, 2));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
