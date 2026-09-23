const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { FlightAgentController } = require('./agent-controller.cjs');
const { validateFinding, classifyPerception } = require('./ollama-vision-dispatcher.cjs');
const modelConfig = require('./agent-model-config.json');

const memoryFile = path.join(__dirname, 'tmp', 'agent-bridge', 'ollama-audit-memory.json');
const requestedModel = process.env.FLIGHT_VISION_MODEL || modelConfig.visionDispatcher.model;
const modelSuffix = `-${requestedModel.replace(/[^a-z0-9.-]+/gi, '-')}`;
const outputFile = path.join(__dirname, 'docs', 'verification', `ollama-dispatcher-audit${modelSuffix}.json`);

async function request(base, pathname, method = 'GET', body) {
  const response = await fetch(`${base}${pathname}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`${method} ${pathname}: ${result.error ?? response.status}`);
  return result;
}

async function waitForRoute(base, timeoutMs = 900000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const state = await request(base, '/state');
    if (state.route && state.route.status !== 'running') return state.route;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error('Ollama inspection route timed out');
}

function auditGuardrails() {
  assert.equal(classifyPerception('The bridge does not appear to be a severe rendering defect.'), 'pass');
  assert.equal(classifyPerception('The image is a severe rendering defect. No discernible objects are present.'), 'defect');
  assert.equal(classifyPerception('There are no visible airport structures in the image.', ['airport']), 'defect');
  assert.equal(classifyPerception('The image pixels do not contain any vegetation.', ['vegetation']), 'defect');
  assert.equal(classifyPerception('There is no vegetation visible in the image.', ['vegetation']), 'defect');
  assert.equal(classifyPerception('The airport is not present in the image.', ['airport']), 'defect');
  assert.equal(classifyPerception('No visible buildings appear in the image.', ['building']), 'defect');
  assert.equal(classifyPerception('It is not possible to determine the presence of an airport.', ['airport']), 'defect');
  assert.equal(classifyPerception('The frame is very dark and lacks visible details.', ['airport']), 'defect');
  assert.equal(classifyPerception('There is no airport visible in the image.', ['vegetation']), 'pass');
  const finding = {
    observationId: 'wrong-id',
    decision: 'dispatch-to-codex',
    summary: 'Проверка неподтверждённой находки',
    defects: [{
      category: 'ocean', severity: 'high', confidence: 0.9, description: 'Тестовая аномалия',
      evidence: ['synthetic-validator-test'], recommendedAction: 'Повторить осмотр',
      objectId: 999999, semantic: 'road', module: 'city.js',
    }],
  };
  const validation = validateFinding(finding, 'guardrail-observation', new Map(), {
    requireObjectOrModuleEvidence: true,
    minimumConfidenceForAutomaticDispatch: 0.65,
  });
  assert.deepEqual(validation.errors, []);
  assert.equal(finding.observationId, 'guardrail-observation');
  assert.equal(finding.defects[0].objectId, null);
  assert.equal(finding.defects[0].semantic, null);
  assert.equal(finding.defects[0].module, null);
  assert.equal(finding.decision, 'reinspect');
  return {
    hallucinatedObjectRemoved: true,
    inventedSemanticAndModuleRemoved: true,
    unsupportedDispatchDowngraded: true,
  };
}

(async () => {
  const guardrails = auditGuardrails();
  fs.mkdirSync(path.dirname(memoryFile), { recursive: true });
  fs.rmSync(memoryFile, { force: true });
  const controller = new FlightAgentController({ port: 0, headless: true, memoryFile });
  controller.dispatcher.dispatcher.model = requestedModel;
  try {
    const state = await controller.start();
    const base = state.api;
    const model = await request(base, '/model');
    assert.equal(model.model, requestedModel);
    assert.equal(model.available, true);

    const started = await request(base, '/route/start', 'POST', { name: 'oceania-inspection', analyze: true });
    assert.equal(started.analyze, true);
    const routeState = await waitForRoute(base);
    assert.equal(routeState.status, 'complete');

    const memory = await request(base, '/memory');
    const run = memory.routeRuns.find(item => item.id === routeState.id);
    assert.ok(run);
    assert.equal(run.analyze, true);
    assert.equal(run.waypoints.length, 6);
    for (const waypoint of run.waypoints) {
      assert.equal(waypoint.modelInspection.ok, true, `${waypoint.id}: ${waypoint.modelInspection.validation.errors.join('; ')}`);
      assert.equal(waypoint.modelInspection.model, requestedModel);
      assert.equal(waypoint.modelInspection.codexReview, 'required');
      assert.equal(waypoint.modelInspection.finding.observationId, `${run.id}:${waypoint.id}`);
      assert.ok(waypoint.modelInspection.metrics.wallMs > 0);
    }
    const serialized = JSON.stringify(memory);
    assert.equal(serialized.includes('data:image/'), false, 'Persistent model memory must not contain image payloads');

    const metrics = run.waypoints.map(waypoint => waypoint.modelInspection.metrics);
    const report = {
      checkedAt: new Date().toISOString(),
      model,
      route: { id: run.id, name: run.name, status: run.status },
      waypoints: run.waypoints.map(waypoint => ({
        id: waypoint.id,
        expected: waypoint.expected,
        center: waypoint.center?.object ?? null,
        perception: waypoint.modelInspection.perception,
        perceptionDecision: waypoint.modelInspection.perceptionDecision,
        perceptionGate: waypoint.modelInspection.perceptionGate,
        modelFinding: waypoint.modelInspection.modelFinding,
        finding: waypoint.modelInspection.finding,
        sensorGate: waypoint.modelInspection.sensorGate,
        validation: waypoint.modelInspection.validation,
        metrics: waypoint.modelInspection.metrics,
        codexReview: waypoint.modelInspection.codexReview,
      })),
      aggregate: {
        count: metrics.length,
        totalWallMs: metrics.reduce((sum, item) => sum + item.wallMs, 0),
        averageWallMs: Math.round(metrics.reduce((sum, item) => sum + item.wallMs, 0) / metrics.length),
        hotAverageWallMs: Math.round(metrics.slice(1).reduce((sum, item) => sum + item.wallMs, 0) / Math.max(1, metrics.length - 1)),
        totalPromptTokens: metrics.reduce((sum, item) => sum + (item.promptTokens ?? 0), 0),
        totalOutputTokens: metrics.reduce((sum, item) => sum + (item.outputTokens ?? 0), 0),
      },
      guardrails,
      persistedWithoutImages: true,
      controllerErrors: state.errors,
    };
    fs.mkdirSync(path.dirname(outputFile), { recursive: true });
    fs.writeFileSync(outputFile, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify({
      model: report.model.model,
      routeStatus: report.route.status,
      decisions: report.waypoints.map(item => ({ id: item.id, decision: item.finding.decision, defects: item.finding.defects.length, wallMs: item.metrics.wallMs })),
      aggregate: report.aggregate,
      guardrails: report.guardrails,
      persistedWithoutImages: report.persistedWithoutImages,
      controllerErrors: report.controllerErrors,
      output: outputFile,
    }, null, 2));
  } finally {
    await controller.stop();
    fs.rmSync(memoryFile, { force: true });
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
