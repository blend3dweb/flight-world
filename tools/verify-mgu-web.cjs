const assert = require('node:assert/strict');
const { chromium } = require('C:/Users/sva/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--force-high-performance-gpu', '--use-webgpu-power-preference=high-performance'] });
  try {
    for (const count of process.argv.includes('--full') ? [250000, 750000, 3000000] : [250000, 750000]) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
      const errors = [];page.on('pageerror', error => errors.push(error.message));
      await page.goto(`http://127.0.0.1:8765/webgpu/mgu.html?density=${count}`);
      await page.waitForFunction(() => window.mgu, null, { timeout: 240000 });
      await page.waitForTimeout(3000);
      if (count === 250000) {
        const parity = await page.evaluate(async () => {
          const { GaussianSplatPLYLoader } = await import('/webgpu/node_modules/three/examples/jsm/loaders/GaussianSplatPLYLoader.js');
          const reference = await new GaussianSplatPLYLoader().loadAsync('/data/mgu/mgu-250000.ply');
          const differences = {};
          for (const [name, attribute] of Object.entries(reference.attributes)) {
            const actual = mgu.splat.splatGeometry.attributes[name].array;
            let different = 0;
            if (actual.length !== attribute.array.length) throw new Error(`Attribute size mismatch: ${name}`);
            for (let i = 0; i < actual.length; i++) if (actual[i] !== attribute.array[i]) different++;
            differences[name] = different;
          }
          reference.dispose();return differences;
        });
        assert.ok(Object.values(parity).every(count => count === 0), JSON.stringify(parity));
        console.log('Loader parity: ' + JSON.stringify(parity));
      }
      const state = await page.evaluate(() => {
        const initial = mgu.getState();
        mgu.setColor(false);const assertRaw = mgu.getState().corrected === false;
        mgu.setColor(true);mgu.controls.rotateSpeed = .8;mgu.controls.update();
        return { ...initial, rawSwitch: assertRaw, restored: mgu.getState().corrected };
      });
      assert.equal(state.count, count);assert.equal(state.sh3, true);assert.equal(state.rawSwitch, true);assert.equal(state.restored, true);
      assert.ok(state.fps > 0);assert.deepEqual(errors, []);assert.deepEqual(state.errors, []);
      fs.mkdirSync(path.resolve(__dirname, '../tmp'), { recursive: true });
      await page.screenshot({ path: path.resolve(__dirname, `../tmp/mgu-${count}.png`) });
      await page.evaluate(() => mgu.groundView());
      await page.waitForTimeout(1500);
      await page.screenshot({ path: path.resolve(__dirname, `../tmp/mgu-${count}-ground.png`) });
      console.log(JSON.stringify(state));
      await page.close();
    }
  } finally {await browser.close();}
}
main().catch(error => {console.error(error);process.exitCode = 1;});
