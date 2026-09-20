const { chromium } = require('C:/Users/sva/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const output = path.join(__dirname, 'docs', 'verification', 'agent-bridge-smoke.json');

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--force-high-performance-gpu', '--use-webgpu-power-preference=high-performance'],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto('http://127.0.0.1:8765/webgpu/index.html?test=1');
    await page.waitForFunction(() => window.flightReady && window.flight?.agent, null, { timeout: 120000 });

    const report = await page.evaluate(async () => {
      const agent = window.flight.agent;
      const capabilities = agent.capabilities();
      const ping = await agent.dispatch({ id: 'ping-1', type: 'ping' });
      const ocean = await agent.dispatch({ id: 'query-1', type: 'world.query', payload: { semantic: 'ocean', limit: 5 } });
      const bridge = await agent.dispatch({ id: 'query-2', type: 'world.query', payload: { name: 'Bridge', visible: false, limit: 20 } });
      const observer = await agent.dispatch({
        id: 'observer-1',
        type: 'observer.set',
        payload: { position: [-1350, 430, -720], target: [-2000, 60, -1900], fov: 58 },
      });
      const raycast = await agent.dispatch({
        id: 'ray-1',
        type: 'world.raycast',
        payload: { origin: [-2000, 700, -1900], direction: [0, -1, 0], limit: 5 },
      });
      await agent.dispatch({
        id: 'environment-1',
        type: 'environment.set',
        payload: { hour: 19.5, cycle: false, weather: 'rain', autoWeather: false },
      });
      await agent.dispatch({ id: 'pause-1', type: 'simulation.pause', payload: { paused: true } });
      const observation = await agent.dispatch({
        id: 'observe-1',
        type: 'observe',
        payload: { visual: true, sensors: ['rgb', 'depth', 'normal', 'objectId'], width: 320, height: 180, quality: 0.65 },
      });
      const visual = observation.result.visual;
      const centerRay = agent.raycast({ ndc: [0, 0], limit: 1 });
      const identifiedPixel = await agent.dispatch({ type: 'world.identifyPixel', payload: { x: 160, y: 90, width: 320, height: 180 } });
      const centerId = await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = image.width; canvas.height = image.height;
          const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
          const pixel = context.getImageData(Math.floor(image.width / 2), Math.floor(image.height / 2), 1, 1).data;
          resolve(pixel[0] + (pixel[1] << 8) + (pixel[2] << 16));
        };
        image.onerror = reject;
        image.src = visual.passes.objectId.dataUrl;
      });
      const passSummary = Object.fromEntries(Object.entries(visual.passes).map(([name, pass]) => [name, {
        mimeType: pass.mimeType,
        bytes: Math.floor((pass.dataUrl.length - pass.dataUrl.indexOf(',') - 1) * 0.75),
        meanLuminance: pass.meanLuminance,
        luminanceStdDev: pass.luminanceStdDev,
      }]));
      return {
        capabilities,
        ping: { ok: ping.ok, protocol: ping.result.protocol },
        query: {
          ocean: ocean.result,
          bridge: bridge.result,
        },
        observer: observer.result,
        raycast: raycast.result,
        observation: {
          protocol: observation.result.protocol,
          world: observation.result.world,
          telemetry: observation.result.telemetry,
          nearbyCount: observation.result.nearby.length,
          visual: {
            mimeType: visual.mimeType,
            width: visual.width,
            height: visual.height,
            bytes: Math.floor((visual.dataUrl.length - visual.dataUrl.indexOf(',') - 1) * 0.75),
            prefix: visual.dataUrl.slice(0, 23),
            meanLuminance: visual.meanLuminance,
            luminanceStdDev: visual.luminanceStdDev,
            passes: passSummary,
            centerId,
            centerRayId: centerRay[0]?.object.id ?? null,
            identifiedPixel: identifiedPixel.result,
          },
        },
      };
    });

    assert.equal(report.capabilities.protocol, '0.1.0');
    assert.equal(report.capabilities.visualPersistence, 'memory-only');
    assert.equal(report.ping.ok, true);
    assert.equal(report.ping.protocol, '0.1.0');
    assert.ok(report.query.ocean.length > 0, 'Ocean must be present in the semantic catalog');
    assert.ok(report.query.bridge.length > 0, 'Bridge must be present in the semantic catalog');
    assert.ok(report.query.bridge.every(object => object.semantic === 'bridge'), 'Bridge objects must have the bridge semantic label');
    assert.deepEqual(report.observer.position, [-1350, 430, -720]);
    assert.ok(report.raycast.length > 0, 'Downward ray must hit the world');
    assert.equal(report.observation.world.environment.weather, 'rain');
    assert.equal(report.observation.world.paused, true);
    assert.ok(report.observation.nearbyCount > 0);
    assert.equal(report.observation.visual.mimeType, 'image/jpeg');
    assert.equal(report.observation.visual.width, 320);
    assert.equal(report.observation.visual.height, 180);
    assert.equal(report.observation.visual.prefix, 'data:image/jpeg;base64,');
    assert.ok(report.observation.visual.bytes > 1000, 'Framebuffer observation must contain image data');
    assert.ok(report.observation.visual.meanLuminance > 5, 'Framebuffer observation must not be black');
    assert.ok(report.observation.visual.luminanceStdDev > 5, 'Framebuffer observation must contain visible scene variation');
    assert.deepEqual(Object.keys(report.observation.visual.passes).sort(), ['depth', 'normal', 'objectId', 'rgb']);
    for (const [name, pass] of Object.entries(report.observation.visual.passes)) {
      assert.ok(pass.bytes > 500, `${name} sensor must contain image data`);
      assert.ok(pass.luminanceStdDev > 0.5, `${name} sensor must contain spatial variation`);
    }
    assert.equal(report.observation.visual.centerId, report.observation.visual.centerRayId, 'Object-ID buffer must agree with the center raycast');
    assert.equal(report.observation.visual.identifiedPixel.hit.object.id, report.observation.visual.centerId, 'Pixel identification must resolve the object-ID pixel');
    assert.ok(report.observation.visual.identifiedPixel.hit.object.module, 'Pixel identification must link the object to a source module');
    assert.deepEqual(errors, []);

    const persisted = { checkedAt: new Date().toISOString(), ...report, errors };
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, `${JSON.stringify(persisted, null, 2)}\n`);
    console.log(JSON.stringify({
      protocol: report.capabilities.protocol,
      commands: report.capabilities.commands.length,
      oceanObjects: report.query.ocean.length,
      bridgeObjects: report.query.bridge.length,
      rayHits: report.raycast.length,
      framebufferBytes: report.observation.visual.bytes,
      errors,
      output,
    }, null, 2));
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
