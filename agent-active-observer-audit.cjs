const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { FlightAgentController } = require('./agent-controller.cjs');

const memoryFile = path.join(__dirname, 'tmp', 'agent-bridge', 'active-observer-audit-memory.json');
const outputFile = path.join(__dirname, 'docs', 'verification', 'agent-active-observer-audit.json');

async function request(base, pathname, method = 'GET', body) {
  const response = await fetch(`${base}${pathname}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`${method} ${pathname}: ${result.error ?? response.status}`);
  return { status: response.status, body: result };
}

async function waitForInspection(base, timeoutMs = 300000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const state = (await request(base, '/state')).body;
    if (state.inspection && state.inspection.status !== 'running') return state.inspection;
    await new Promise(resolve => setTimeout(resolve, 400));
  }
  throw new Error('Active observer inspection timed out');
}

(async () => {
  fs.mkdirSync(path.dirname(memoryFile), { recursive: true });
  fs.rmSync(memoryFile, { force: true });
  const controller = new FlightAgentController({ port: 0, headless: true, memoryFile });
  try {
    const state = await controller.start();
    const base = state.api;
    const before = (await request(base, '/observe', 'POST', {})).body.observer;
    const started = await request(base, '/inspection/start', 'POST', {
      semantic: 'bridge',
      views: 4,
      analyze: true,
      elevation: 0.28,
      distanceFactor: 2.6,
    });
    assert.equal(started.status, 202);
    const finished = await waitForInspection(base);
    assert.equal(finished.status, 'complete');
    const memory = (await request(base, '/memory')).body;
    const run = memory.inspectionRuns.at(-1);
    const after = (await request(base, '/observe', 'POST', {})).body.observer;

    assert.equal(state.capabilities.protocol, '0.2.0');
    assert.equal(run.status, 'complete');
    assert.ok(run.views.length >= 4 && run.views.length <= 6);
    assert.equal(run.views.filter(view => view.reason === 'scheduled').length, 4);
    assert.equal(run.target.object.semantic, 'bridge');
    assert.equal(run.target.object.module, 'city.js');
    assert.ok(run.target.bounds.radius > 0);
    assert.ok(run.target.geometry?.vertices > 0);
    assert.ok(run.target.materials.length > 0);
    assert.deepEqual(after, before, 'Observer pose must be restored after the tour');
    assert.equal(new Set(run.views.map(view => view.observer.position.join(','))).size, run.views.length, 'Every tour view must use a distinct camera position');
    for (const view of run.views) {
      assert.deepEqual(Object.keys(view.observation.sensors).sort(), ['depth', 'normal', 'objectId', 'rgb']);
      assert.ok(view.center?.object?.id > 0);
      assert.equal(view.modelInspection.ok, true);
      assert.equal(view.modelInspection.model, 'qwen2.5vl:3b');
      assert.equal(view.modelInspection.codexReview, 'required');
      assert.ok(['pass', 'reinspect'].includes(view.modelInspection.finding.decision));
    }
    const serialized = JSON.stringify(memory);
    assert.equal(serialized.includes('data:image/'), false);
    assert.equal(serialized.includes(';base64,'), false);
    assert.deepEqual(state.errors, []);

    const report = {
      checkedAt: new Date().toISOString(),
      protocol: state.capabilities.protocol,
      model: run.views[0].modelInspection.model,
      requested: run.requested,
      target: run.target,
      status: run.status,
      restoredObserver: after,
      views: run.views.map(view => ({
        index: view.index,
        azimuth: view.azimuth,
        observer: view.observer,
        center: view.center?.object ?? null,
        sensors: view.observation.sensors,
        perception: view.modelInspection.perception,
        decision: view.modelInspection.finding.decision,
        metrics: view.modelInspection.metrics,
      })),
      rawImagesPersisted: false,
      controllerErrors: state.errors,
    };
    fs.mkdirSync(path.dirname(outputFile), { recursive: true });
    fs.writeFileSync(outputFile, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify({
      protocol: report.protocol,
      model: report.model,
      target: report.target.object,
      views: report.views.map(view => ({ index: view.index, decision: view.decision, center: view.center?.semantic ?? null, wallMs: view.metrics.wallMs })),
      observerRestored: JSON.stringify(after) === JSON.stringify(before),
      rawImagesPersisted: false,
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
