// Capture the trained block from the same two published cameras in WebGPU.
// Diagnostic PNGs stay in ignored data/matrixcity/quality-check/; no video.
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('C:/Users/sva/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

const root = path.resolve(__dirname, '..');
const out = path.join(root, 'data/matrixcity/quality-check');
const transforms = JSON.parse(fs.readFileSync(path.join(root, 'data/matrixcity/training/small_city_block_3_half/transforms.json'), 'utf8'));
const frames = ['0178', '0213'];

async function main() {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--force-high-performance-gpu', '--use-webgpu-power-preference=high-performance'] });
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:8765/webgpu/index.html?test=1&matrixcity=1&color=raw');
    await page.waitForFunction(() => window.flightReady && window.flight.matrixCityTrial?.splat, null, { timeout: 120000 });
    for (const name of frames) {
      const frame = transforms.frames.find(item => item.file_path.endsWith(`/${name}.png`));
      if (!frame) throw new Error(`Frame ${name} unavailable`);
      const captures = await page.evaluate(async ({ pose, width, height }) => {
        const THREE = await import('/webgpu/vendor/three.module.js');
        flight.setPaused(true);
        flight.setMatrixCityMode('gaussian');
        const { scene, renderer } = flight.inspect();
        const trial = flight.matrixCityTrial;
        const group = trial.visual.parent;
        group.updateMatrixWorld(true);
        const local = new THREE.Matrix4().set(...pose.flat());
        const world = new THREE.Matrix4().multiplyMatrices(group.matrixWorld, local);
        const camera = new THREE.PerspectiveCamera(2 * Math.atan(height / (2 * 1158.8224741214817)) * 180 / Math.PI, width / height, .2, 10000);
        world.decompose(camera.position, camera.quaternion, camera.scale);
        camera.updateMatrixWorld(true);
        const hidden = scene.children.filter(object => object !== group).map(object => [object, object.visible]);
        for (const [object] of hidden) object.visible = false;
        const oldBackground = scene.background, oldFog = scene.fog, oldTone = renderer.toneMapping, oldExposure = renderer.toneMappingExposure;
        scene.background = new THREE.Color(0, 0, 0);scene.fog = null;
        const target = new THREE.RenderTarget(width, height, { depthBuffer: true });
        target.texture.colorSpace = THREE.SRGBColorSpace;
        const canvas = document.createElement('canvas');canvas.width = width;canvas.height = height;
        const context = canvas.getContext('2d');
        try {
          const result = {};
          for (const [mode, tone, exposure] of [['neutral', THREE.NoToneMapping, 1], ['app', THREE.ACESFilmicToneMapping, 1.05], ['srgb-fixed', THREE.NoToneMapping, 1]]) {
            if (mode === 'srgb-fixed') {
              scene.background = oldBackground;scene.fog = oldFog;
              trial.setColorCorrected(true);
              scene.background = new THREE.Color(0, 0, 0);scene.fog = null;
            }
            renderer.toneMapping = tone;renderer.toneMappingExposure = exposure;
            renderer.setRenderTarget(target);
            await renderer.renderAsync(scene, camera);
            const pixels = await renderer.readRenderTargetPixelsAsync(target, 0, 0, width, height);
            context.putImageData(new ImageData(new Uint8ClampedArray(pixels), width, height), 0, 0);
            result[mode] = canvas.toDataURL('image/png').split(',')[1];
          }
          return result;
        } finally {
          renderer.setRenderTarget(null);target.dispose();
          scene.background = oldBackground;scene.fog = oldFog;renderer.toneMapping = oldTone;renderer.toneMappingExposure = oldExposure;
          for (const [object, visible] of hidden) object.visible = visible;
          trial.setColorCorrected(false);
        }
      }, { pose: frame.transform_matrix, width: transforms.w, height: transforms.h });
      for (const [mode, png] of Object.entries(captures)) fs.writeFileSync(path.join(out, `${name}-web-${mode}.png`), Buffer.from(png, 'base64'));
      console.log(`Captured WebGPU ${name}: ${Object.keys(captures).join(', ')}`);
    }
    if (errors.length) throw new Error(errors.join('\n'));
  } finally {
    await browser.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
