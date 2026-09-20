const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { FlightAgentController } = require('./agent-controller.cjs');
const modelConfig = require('./agent-model-config.json');

const memoryFile = path.join(__dirname, 'tmp', 'agent-bridge', 'defect-audit-memory.json');
const requestedModel = process.env.FLIGHT_VISION_MODEL || modelConfig.visionDispatcher.model;
const modelSuffix = `-${requestedModel.replace(/[^a-z0-9.-]+/gi, '-')}`;
const outputFile = path.join(__dirname, 'docs', 'verification', `ollama-defect-sensitivity-audit${modelSuffix}.json`);
const view = {
  position: [-1350, 430, -720],
  target: [-2000, 60, -1900],
  fov: 58,
  environment: { hour: 10, weather: 'sun', cycle: false, autoWeather: false, immediate: true },
};

async function capture(controller) {
  const width = controller.dispatcher.dispatcher.inputs.rgb.width;
  const height = controller.dispatcher.dispatcher.inputs.rgb.height;
  const observation = await controller.observe({ visual: true, sensors: ['rgb', 'depth', 'normal', 'objectId'], width, height, quality: 0.72 });
  const identification = await controller.execute({ type: 'world.identifyPixel', payload: { x: Math.floor(width / 2), y: Math.floor(height / 2), width, height } });
  return { observation, center: identification.result.hit };
}

async function injectDefect(controller) {
  return controller.page.evaluate(() => {
    const { scene } = window.flight.inspect();
    const visibility = [];
    scene.traverse(object => {
      if (object === scene) return;
      visibility.push([object, object.visible]);
      object.visible = false;
    });
    window.__flightAgentRestoreDefect = () => {
      visibility.forEach(([object, visible]) => { object.visible = visible; });
      delete window.__flightAgentRestoreDefect;
      window.flight.step(1 / 240);
    };
    window.flight.step(1 / 240);
    return { target: 'scene descendants', action: 'visible=false', hiddenObjects: visibility.length, expectedVisualEffect: 'empty framebuffer' };
  });
}

async function restoreDefect(controller) {
  return controller.page.evaluate(() => {
    if (typeof window.__flightAgentRestoreDefect !== 'function') return false;
    window.__flightAgentRestoreDefect();
    return true;
  });
}

(async () => {
  fs.mkdirSync(path.dirname(memoryFile), { recursive: true });
  fs.rmSync(memoryFile, { force: true });
  const controller = new FlightAgentController({ port: 0, headless: true, memoryFile });
  controller.dispatcher.dispatcher.model = requestedModel;
  let injected = false;
  try {
    await controller.start();
    await controller.execute({ type: 'simulation.pause', payload: { paused: true } });
    await controller.execute({ type: 'observer.set', payload: { position: view.position, target: view.target, fov: view.fov } });
    await controller.execute({ type: 'environment.set', payload: view.environment });

    const baselineCapture = await capture(controller);
    assert.ok(baselineCapture.center?.object?.uuid, 'Baseline center object was not found');
    const baseline = await controller.dispatcher.analyze(baselineCapture.observation, {
      observationId: 'defect-test:baseline', phase: 'baseline', center: baselineCapture.center,
      expected: ['city', 'building', 'road', 'terrain'],
    });
    assert.equal(baseline.ok, true);
    assert.equal(baseline.finding.decision, 'pass', `Baseline decision failed. Perception: ${baseline.perception}. Structured: ${JSON.stringify(baseline.modelFinding)}`);
    assert.equal(baseline.perceptionDecision, 'pass', 'Vision pass rejected the correct baseline');

    const injection = await injectDefect(controller);
    injected = true;
    const damagedCapture = await capture(controller);
    const baselineRgb = baselineCapture.observation.visual.passes.rgb;
    const damagedRgb = damagedCapture.observation.visual.passes.rgb;
    assert.notEqual(damagedRgb.dataUrl, baselineRgb.dataUrl, 'Injected defect did not change the RGB framebuffer');
    assert.ok(Math.abs(damagedRgb.meanLuminance - baselineRgb.meanLuminance) > 10 || Math.abs(damagedRgb.luminanceStdDev - baselineRgb.luminanceStdDev) > 10, 'Injected defect did not create a measurable visual difference');
    const damaged = await controller.dispatcher.analyze(damagedCapture.observation, {
      observationId: 'defect-test:damaged', phase: 'damaged-single-frame', center: damagedCapture.center,
      expected: ['city', 'building', 'road', 'terrain'],
      baselineSensorStatistics: {
        meanLuminance: baselineRgb.meanLuminance,
        luminanceStdDev: baselineRgb.luminanceStdDev,
      },
    });
    assert.equal(damaged.ok, true);
    const modelSensitivityDetected = damaged.perceptionDecision === 'defect';
    const controllerSensitivityDetected = damaged.finding.decision !== 'pass' && damaged.finding.defects.length > 0;

    assert.equal(await restoreDefect(controller), true);
    injected = false;
    await controller.execute({ type: 'observer.set', payload: { position: view.position, target: view.target, fov: view.fov } });
    const restoredCapture = await capture(controller);
    const restored = await controller.dispatcher.analyze(restoredCapture.observation, {
      observationId: 'defect-test:restored', phase: 'restored-comparison', center: restoredCapture.center,
      expected: ['city', 'building', 'road', 'terrain'],
    });
    assert.equal(restored.ok, true);
    assert.equal(restored.finding.decision, 'pass', 'The restored scene did not return to pass');
    assert.equal(restored.perceptionDecision, 'pass', 'Vision pass rejected the restored scene');

    const report = {
      checkedAt: new Date().toISOString(),
      model: controller.dispatcher.dispatcher.model,
      view,
      target: { name: 'Complete visual scene', semantic: 'world', module: 'flight.js' },
      injection,
      baseline,
      damaged,
      modelSensitivityDetected,
      controllerSensitivityDetected,
      restored,
      rawImagesPersisted: false,
      sourceSceneModified: false,
    };
    report.passed = baseline.finding.decision === 'pass' && controllerSensitivityDetected && restored.finding.decision === 'pass';
    report.modelPassed = modelSensitivityDetected;
    const serialized = JSON.stringify(report);
    assert.equal(serialized.includes('data:image/'), false);
    assert.equal(serialized.includes(';base64,'), false);
    fs.mkdirSync(path.dirname(outputFile), { recursive: true });
    fs.writeFileSync(outputFile, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify({
      target: report.target,
      baseline: baseline.finding,
      damaged: damaged.finding,
      modelSensitivityDetected,
      controllerSensitivityDetected,
      sensorGate: damaged.sensorGate,
      restored: restored.finding,
      timingsMs: { baseline: baseline.metrics.wallMs, damaged: damaged.metrics.wallMs, restored: restored.metrics.wallMs },
      rawImagesPersisted: false,
      sourceSceneModified: false,
      output: outputFile,
    }, null, 2));
    if (!report.passed) throw new Error(`Sensitivity audit failed: neither ${requestedModel} nor the controller detected the injected empty-scene defect`);
  } finally {
    if (injected && controller.page) await restoreDefect(controller).catch(() => {});
    await controller.stop();
    fs.rmSync(memoryFile, { force: true });
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
