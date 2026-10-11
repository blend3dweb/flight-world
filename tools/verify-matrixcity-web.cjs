// Smoke-check the optional local geometry mode without screenshots or video.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { chromium } = require('C:/Users/sva/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

const root = path.resolve(__dirname, '..');
const origin = 'http://127.0.0.1:8765';

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
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin + '/webgpu/index.html?test=1&matrixcity=1');
    await page.waitForFunction(() => window.flightReady && window.flight.matrixCityTrial, null, { timeout: 120000 });
    const result = await page.evaluate(() => {
      const { scene, infrastructure } = flight.inspect();
      const { visual, collision } = flight.matrixCityTrial;
      const loaded = {
        vertices: visual.geometry.attributes.position.count,
        triangles: visual.geometry.index.count / 3,
        collisionTriangles: collision.geometry.index.count / 3,
        stableId: collision.userData.agent.stableId,
      };
      flight.setMatrixCityMode('geometry');
      const active = { mode: flight.getState().matrixCityMode, cityVisible: infrastructure.group.visible, trialVisible: visual.parent.visible };
      const found = scene.getObjectByName('matrixcity-building-001');
      const catalog = flight.agent.queryObjects({ name: 'matrixcity-building-001', visible: false });
      const colliderHits = flight.agent.raycast({ origin: [-2022, 200, -1900], direction: [0, -1, 0], limit: 32 })
        .filter(hit => hit.object.stableId === 'matrixcity-building-001').length;
      flight.setMatrixCityMode('original');
      const restored = { mode: flight.getState().matrixCityMode, cityVisible: infrastructure.group.visible, trialVisible: visual.parent.visible };
      return { loaded, active, restored, collisionFound: found === collision, catalog: catalog.map(item => item.stableId), colliderHits };
    });
    assert.ok(result.loaded.vertices > 10000 && result.loaded.triangles > 10000);
    assert.equal(result.loaded.stableId, 'matrixcity-building-001');
    assert.equal(result.active.mode, 'geometry');
    assert.equal(result.active.cityVisible, false);
    assert.equal(result.active.trialVisible, true);
    assert.equal(result.restored.mode, 'original');
    assert.equal(result.restored.cityVisible, true);
    assert.equal(result.restored.trialVisible, false);
    assert.equal(result.collisionFound, true);
    assert.ok(result.catalog.includes('matrixcity-building-001'));
    assert.ok(result.colliderHits > 0);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await browser?.close();
    server?.kill();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
