// Smoke-check the optional local geometry mode without screenshots or video.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { chromium } = require('C:/Users/sva/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

const root = path.resolve(__dirname, '..');
const origin = 'http://127.0.0.1:8765';
const sh3 = process.argv.includes('--sh3');
const fullRoi = process.argv.includes('--full-roi') || sh3;
const depthPrepass = process.argv.includes('--depth-prepass');

async function main() {
  let server = null;
  let browser = null;
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
    page.on('pageerror', error => errors.push(error.stack || error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(`${message.text()} at ${JSON.stringify(message.location())}`); });
    await page.goto(origin + `/webgpu/index.html?test=1&matrixcity=1${sh3 ? '' : fullRoi ? '&sh=0' : '&density=30k'}${depthPrepass ? '&depth=1' : ''}`);
    await page.waitForFunction(() => window.flightReady && window.flight.matrixCityTrial?.splat, null, { timeout: 120000 });
    const result = await page.evaluate(async () => {
      const { scene, infrastructure } = flight.inspect();
      const { visual, collision, splat } = flight.matrixCityTrial;
      const color = { initial: flight.getState().matrixCityColorCorrected };
      flight.matrixCityTrial.setColorCorrected(false);
      color.raw = flight.getState().matrixCityColorCorrected;
      flight.matrixCityTrial.setColorCorrected(true);
      color.restored = flight.getState().matrixCityColorCorrected;
      flight.setMatrixCityInspection(true);
      flight.matrixCityTrial.setColorCorrected(false);
      color.orbit = flight.getState().viewMode === 'inspection' && flight.getState().matrixCityColorCorrected === false;
      flight.matrixCityTrial.setColorCorrected(true);
      flight.setMatrixCityInspection(false);
      const loaded = {
        vertices: visual.geometry.attributes.position.count,
        triangles: visual.geometry.index.count / 3,
        collisionTriangles: collision.geometry.index.count / 3,
        stableId: collision.userData.agent.stableId,
        splats: splat.splatGeometry.attributes.position.count,
        sh3: splat.splatGeometry.hasAttribute('sphericalHarmonics3'),
        replacedBlock: infrastructure.getBlockElementCounts(12),
      };
      flight.setMatrixCityMode('geometry');
      const active = { mode: flight.getState().matrixCityMode, cityVisible: infrastructure.group.visible, blockVisible: infrastructure.getBlockVisibility(12), trialVisible: visual.parent.visible };
      const found = scene.getObjectByName('matrixcity-building-001');
      const catalog = flight.agent.queryObjects({ name: 'matrixcity-building-001', visible: false });
      const colliderHits = flight.agent.raycast({ origin: [-2110, 200, -2109], direction: [0, -1, 0], limit: 32 })
        .filter(hit => hit.object.stableId === 'matrixcity-building-001').length;
      flight.setMatrixCityMode('gaussian');
      flight.place({ x: -2108, y: 170, z: -1959, heading: 0, pitch: -0.35, roll: 0 });
      const beforeDraws = flight.getState().drawCount;
      await new Promise(resolve => setTimeout(resolve, 1500));
      const gaussian = { mode: flight.getState().matrixCityMode, splatVisible: splat.visible, geometryVisible: visual.visible, drawnFrames: flight.getState().drawCount - beforeDraws };
      let geometrySensorPasses = 0;
      const previousBeforeRender = visual.onBeforeRender;
      visual.onBeforeRender = () => { geometrySensorPasses++; };
      flight.agent.setObserver({ position: [-2090, 115, -1930], target: [-2090, 42, -2109], fov: 58 });
      const observation = await flight.agent.observe({ visual: true, sensors: ['rgb', 'depth', 'normal', 'objectId'], width: 128, height: 72 });
      visual.onBeforeRender = previousBeforeRender;
      const centerId = await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => {
          const canvas = document.createElement('canvas');canvas.width = image.width;canvas.height = image.height;
          const context = canvas.getContext('2d');context.drawImage(image, 0, 0);
          const pixel = context.getImageData(64, 36, 1, 1).data;
          resolve(pixel[0] + (pixel[1] << 8) + (pixel[2] << 16));
        };
        image.onerror = reject;image.src = observation.visual.passes.objectId.dataUrl;
      });
      const centerHits = flight.agent.raycast({ ndc: [0, 0], limit: 4 }).map(hit => ({ id: hit.object.id, stableId: hit.object.stableId, name: hit.object.name }));
      const identified = flight.agent.identifyPixel({ x: 64, y: 36, width: 128, height: 72 });
      gaussian.sensors = { passes: Object.keys(observation.visual.passes), geometrySensorPasses,
        geometryRestored: !visual.visible && splat.visible, rgbBytes: observation.visual.passes.rgb.dataUrl.length,
        centerId, centerHits, identifiedId: identified.hit?.object.id ?? null };
      flight.setMatrixCityMode('hybrid');
      const hybrid = { mode: flight.getState().matrixCityMode, depthMaterial: visual.material.colorWrite === false && visual.material.depthWrite === true,
        sensorOnly: visual.material.visible === false && visual.material.depthWrite === false,
        geometryVisible: visual.visible, splatVisible: splat.visible, blockVisible: infrastructure.getBlockVisibility(12) };
      const hybridObservation = await flight.agent.observe({ visual: true, sensors: ['rgb', 'depth', 'normal', 'objectId'], width: 128, height: 72 });
      hybrid.sensors = Object.keys(hybridObservation.visual.passes);
      hybrid.materialRestored = visual.material.colorWrite === false && splat.visible;
      flight.setMatrixCityMode('original');
      const restored = { mode: flight.getState().matrixCityMode, cityVisible: infrastructure.group.visible, blockVisible: infrastructure.getBlockVisibility(12), trialVisible: visual.parent.visible };
      return { loaded, color, active, gaussian, hybrid, restored, collisionFound: found === collision, catalog: catalog.map(item => item.stableId), colliderHits };
    });
    assert.ok(result.loaded.vertices > 10000 && result.loaded.triangles > 10000);
    assert.equal(result.loaded.stableId, 'matrixcity-building-001');
    assert.equal(result.loaded.splats, fullRoi ? 67915 : 30000);
    assert.equal(result.loaded.sh3, sh3);
    assert.deepEqual(result.color, { initial: true, raw: false, restored: true, orbit: true });
    assert.ok(result.loaded.replacedBlock.instances > 0 && result.loaded.replacedBlock.surfaces > 0);
    assert.equal(result.active.mode, 'geometry');
    assert.equal(result.active.cityVisible, true);
    assert.equal(result.active.blockVisible, false);
    assert.equal(result.active.trialVisible, true);
    assert.equal(result.gaussian.mode, 'gaussian');
    assert.equal(result.gaussian.splatVisible, true);
    assert.equal(result.gaussian.geometryVisible, false);
    assert.ok(result.gaussian.drawnFrames > 0);
    assert.deepEqual(result.gaussian.sensors.passes, ['rgb', 'depth', 'normal', 'objectId']);
    assert.ok(result.gaussian.sensors.geometrySensorPasses >= 3);
    assert.equal(result.gaussian.sensors.geometryRestored, true);
    assert.equal(result.gaussian.sensors.identifiedId, result.gaussian.sensors.centerId);
    assert.equal(result.hybrid.mode, 'hybrid');
    assert.equal(result.hybrid.depthMaterial, depthPrepass);
    assert.equal(result.hybrid.sensorOnly, !depthPrepass);
    assert.equal(result.hybrid.geometryVisible, true);
    assert.equal(result.hybrid.splatVisible, true);
    assert.equal(result.hybrid.blockVisible, false);
    assert.deepEqual(result.hybrid.sensors, ['rgb', 'depth', 'normal', 'objectId']);
    assert.equal(result.hybrid.materialRestored, true);
    assert.equal(result.restored.mode, 'original');
    assert.equal(result.restored.cityVisible, true);
    assert.equal(result.restored.blockVisible, true);
    assert.equal(result.restored.trialVisible, false);
    assert.equal(result.collisionFound, true);
    assert.ok(result.catalog.includes('matrixcity-building-001'));
    assert.ok(result.colliderHits > 0);
    if(errors.length)console.error(errors.join('\n'));
    assert.deepEqual(errors, []);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await browser?.close();
    server?.kill();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
