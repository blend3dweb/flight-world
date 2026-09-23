const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { FlightAgentController } = require('./agent-controller.cjs');

const memoryFile = path.join(__dirname, 'tmp', 'agent-bridge', 'development-cycle-audit-memory.json');
const fixFile = path.join(__dirname, 'tmp', 'agent-bridge', 'cycle-audit-fix.txt');
const fixRelative = 'tmp/agent-bridge/cycle-audit-fix.txt';
const outputFile = path.join(__dirname, 'docs', 'verification', 'agent-development-cycle-audit.json');

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

function fakeInspection(observationId, decision) {
  return {
    ok: true,
    model: 'deterministic-cycle-probe',
    role: 'audit-probe',
    codexReview: 'required',
    perception: decision === 'pass' ? 'The bridge is visible and correct.' : 'A bridge geometry discontinuity requires Codex review.',
    perceptionDecision: decision === 'pass' ? 'pass' : 'defect',
    finding: {
      observationId,
      decision,
      summary: decision === 'pass' ? 'Bridge verification passed.' : 'Bridge geometry must be checked in source.',
      defects: decision === 'pass' ? [] : [{
        category: 'geometry', severity: 'high', confidence: 0.9,
        description: 'Audit probe geometry finding.', pixel: null, objectId: null, semantic: 'bridge', module: 'city.js',
        evidence: ['deterministic audit probe'], recommendedAction: 'Codex must review the source before a fix is recorded.',
      }],
    },
    validation: { errors: [], corrections: [] },
    metrics: { wallMs: 0, pipeline: 'deterministic-cycle-probe' },
  };
}

async function waitForCycle(base, id, timeoutMs = 180000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const cycles = (await request(base, '/cycles')).body.cycles;
    const cycle = cycles.find(item => item.id === id);
    if (cycle && cycle.status !== 'verifying') return cycle;
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  throw new Error('Development cycle recheck timed out');
}

(async () => {
  fs.mkdirSync(path.dirname(memoryFile), { recursive: true });
  fs.rmSync(memoryFile, { force: true });
  fs.rmSync(fixFile, { force: true });
  const controller = new FlightAgentController({ port: 0, headless: true, memoryFile });
  try {
    const state = await controller.start();
    const base = state.api;
    let phase = 'finding';
    controller.dispatcher.analyze = async (_observation, context) => fakeInspection(context.observationId, phase === 'finding' ? 'dispatch-to-codex' : 'pass');
    await controller.execute({ type: 'environment.set', payload: { hour: 0.5, weather: 'sun', cycle: false, autoWeather: false, immediate: true } });

    const initial = await controller.inspectObjectTour({ semantic: 'bridge', views: 3, analyze: true, maxExtraViews: 0 });
    assert.equal(initial.decision, 'dispatch-to-codex');
    assert.ok(initial.developmentCycleId);
    let cycle = controller.developmentCycle(initial.developmentCycleId);
    assert.equal(cycle.status, 'awaiting-codex-review');
    assert.equal(cycle.evidence.length, 3);
    assert.equal(cycle.environment.hour, 0.5);

    const deniedReview = await fetch(`${base}/cycle/review`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: cycle.id, reviewer: 'qwen2.5vl:3b', decision: 'approve-fix', rationale: 'Model attempted approval.', files: [fixRelative] }),
    });
    assert.equal(deniedReview.status, 500);
    assert.equal(controller.developmentCycle(cycle.id).status, 'awaiting-codex-review');

    cycle = (await request(base, '/cycle/review', 'POST', {
      id: cycle.id,
      reviewer: 'codex',
      decision: 'approve-fix',
      rationale: 'The deterministic finding is linked to city.js; approve a bounded test change and require reinspection.',
      files: [fixRelative],
    })).body;
    assert.equal(cycle.status, 'approved-for-fix');
    assert.equal(cycle.review.beforeFiles[0].exists, false);

    const prematureFix = await fetch(`${base}/cycle/fix`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: cycle.id, reviewer: 'codex', summary: 'No file was changed.', files: [fixRelative] }),
    });
    assert.equal(prematureFix.status, 500);
    assert.equal(controller.developmentCycle(cycle.id).status, 'approved-for-fix');

    fs.writeFileSync(fixFile, 'bounded audit change\n');
    cycle = (await request(base, '/cycle/fix', 'POST', {
      id: cycle.id,
      reviewer: 'codex',
      summary: 'Created the bounded audit artifact approved by Codex.',
      files: [fixRelative],
      commit: 'audit-only',
    })).body;
    assert.equal(cycle.status, 'fix-recorded');
    assert.deepEqual(cycle.fix.changed, [fixRelative]);

    phase = 'verified';
    await controller.execute({ type: 'environment.set', payload: { hour: 11, weather: 'sun', cycle: false, autoWeather: false, immediate: true } });
    const recheck = await request(base, '/cycle/recheck', 'POST', { id: cycle.id });
    assert.equal(recheck.status, 202);
    cycle = await waitForCycle(base, cycle.id);
    assert.equal(cycle.status, 'verified');
    assert.equal(cycle.recheck.decision, 'pass');
    const repeated = controller.memory.inspectionRuns.find(item => item.id === cycle.recheck.inspectionRunId);
    assert.equal(repeated.views[0].observation.world.environment.hour, 0.5, 'Recheck must restore the original night conditions');
    assert.equal(controller.memory.developmentCycles.length, 1, 'Recheck must not open a nested cycle');
    assert.deepEqual(cycle.history.map(item => item.event), ['finding-created', 'codex-review', 'fix-recorded', 'recheck-started', 'recheck-completed']);
    assert.equal(state.errors.length, 0);

    const serialized = JSON.stringify(controller.memory);
    assert.equal(serialized.includes('data:image/'), false);
    assert.equal(serialized.includes(';base64,'), false);

    const report = {
      checkedAt: new Date().toISOString(),
      protocol: state.capabilities.protocol,
      cycle,
      gates: {
        nonCodexReviewRejected: true,
        unchangedFixRejected: true,
        changedFileHashRecorded: Boolean(cycle.fix.files[0].sha256),
        nestedCyclePrevented: controller.memory.developmentCycles.length === 1,
        originalEnvironmentRestored: repeated.views[0].observation.world.environment.hour === 0.5,
      },
      rawImagesPersisted: false,
      controllerErrors: state.errors,
    };
    fs.mkdirSync(path.dirname(outputFile), { recursive: true });
    fs.writeFileSync(outputFile, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify({
      protocol: report.protocol,
      initialDecision: cycle.initialDecision,
      codexDecision: cycle.review.decision,
      changedFiles: cycle.fix.changed,
      recheckDecision: cycle.recheck.decision,
      status: cycle.status,
      gates: report.gates,
      rawImagesPersisted: false,
      controllerErrors: report.controllerErrors,
      output: outputFile,
    }, null, 2));
  } finally {
    await controller.stop();
    fs.rmSync(fixFile, { force: true });
    fs.rmSync(memoryFile, { force: true });
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
