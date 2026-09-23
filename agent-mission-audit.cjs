const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { FlightAgentController } = require('./agent-controller.cjs');
const { planMission } = require('./agent-mission-planner.cjs');

const memoryFile = path.join(__dirname, 'tmp', 'agent-bridge', 'mission-audit-memory.json');
const outputFile = path.join(__dirname, 'docs', 'verification', 'agent-mission-audit.json');

async function api(base, pathname, method = 'GET', body) {
  const response = await fetch(`${base}${pathname}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const value = await response.json();
  if (!response.ok) throw new Error(`${pathname}: ${value.error ?? response.status}`);
  return value;
}

async function waitForMission(base, id, timeoutMs = 360000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const mission = (await api(base, '/missions')).missions.find(item => item.id === id);
    if (mission && !['planned', 'running', 'stopping'].includes(mission.status)) return mission;
    await new Promise(resolve => setTimeout(resolve, 400));
  }
  throw new Error(`Mission ${id} did not finish in time`);
}

function summarizeMission(mission, memory) {
  const run = memory.inspectionRuns.find(item => item.id === mission.inspectionRunId);
  return {
    id: mission.id, goal: mission.plan.goal, status: mission.status,
    plan: mission.plan, selected: mission.selection,
    decision: mission.decision, developmentCycleId: mission.developmentCycleId,
    attempts: mission.attempts, history: mission.history,
    inspection: run ? {
      id: run.id, status: run.status, target: run.target.object,
      environment: run.views[0]?.observation?.world?.environment,
      views: run.views.map(view => ({
        index: view.index, reason: view.reason,
        decision: view.modelInspection?.finding?.decision,
        perception: view.modelInspection?.perception,
        model: view.modelInspection?.model,
        center: view.center?.object?.semantic ?? null,
      })),
    } : null,
  };
}

(async () => {
  fs.mkdirSync(path.dirname(memoryFile), { recursive: true });
  fs.rmSync(memoryFile, { force: true });
  const controller = new FlightAgentController({ port: 0, headless: true, memoryFile });
  try {
    const state = await controller.start();
    const base = state.api;
    const examples = [
      { goal: 'Проверь аэропорт ночью', semantic: 'airport', hour: 0.5, weather: 'sun' },
      { goal: 'Проверь мост под дождём', semantic: 'bridge', hour: 17.8, weather: 'rain' },
      { goal: 'Проверь растительность и берег днём', semantic: 'vegetation', hour: 11, weather: 'sun' },
    ];
    const missions = [];
    for (const [index, example] of examples.entries()) {
      const started = await api(base, '/mission/start', 'POST', { goal: example.goal });
      assert.equal(started.plan.semantic, example.semantic);
      assert.equal(started.plan.environment.hour, example.hour);
      assert.equal(started.plan.environment.weather, example.weather);
      if (index === 0) {
        await api(base, '/mission/stop', 'POST', { id: started.id });
        const stopped = await waitForMission(base, started.id);
        assert.equal(stopped.status, 'stopped');
        await api(base, '/mission/resume', 'POST', { id: started.id });
      }
      const mission = await waitForMission(base, started.id);
      assert.equal(mission.status, 'complete', `${example.semantic}: ${mission.error ?? mission.status}`);
      assert.equal(mission.selection.object.semantic, example.semantic);
      const run = controller.memory.inspectionRuns.find(item => item.id === mission.inspectionRunId);
      assert.equal(run.target.object.semantic, example.semantic);
      assert.equal(run.target.object.name, mission.selection.object.name);
      assert.ok(run.views.length >= 3);
      assert.ok(run.views.every(view => view.modelInspection?.model === 'qwen2.5vl:3b'));
      missions.push(summarizeMission(mission, controller.memory));
      console.log(`${example.semantic}: ${mission.status}, ${mission.decision}, ${run.views.length} views`);
    }
    let syntheticViews = 0;
    controller.dispatcher.analyze = async (_observation, context) => {
      syntheticViews++;
      if (syntheticViews === 1) await controller.page.close();
      return {
        ok: true, model: 'recovery-probe', codexReview: 'required',
        perception: 'The bridge remains visible.', perceptionDecision: 'pass',
        finding: { observationId: context.observationId, decision: 'pass', summary: 'Bridge visible.', defects: [] },
        validation: { errors: [], corrections: [] }, metrics: { wallMs: 0 },
      };
    };
    const recoveryStarted = await api(base, '/mission/start', 'POST', { goal: 'Проверь мост под дождём' });
    const recovered = await waitForMission(base, recoveryStarted.id);
    assert.equal(recovered.status, 'complete');
    assert.equal(recovered.decision, 'pass');
    assert.ok(state.recovery.count >= 1);

    const interruptedMemory = path.join(__dirname, 'tmp', 'agent-bridge', 'mission-interrupted-memory.json');
    const copy = structuredClone(controller.memory);
    copy.missions.push({
      id: 'restart-probe', status: 'running', plan: planMission({ goal: 'Проверь мост под дождём' }, controller.routes),
      history: [], attempts: 1,
    });
    fs.writeFileSync(interruptedMemory, JSON.stringify(copy));
    const restarted = new FlightAgentController({ memoryFile: interruptedMemory });
    assert.equal(restarted.mission('restart-probe').status, 'interrupted');
    assert.equal(restarted.mission('restart-probe').plan.semantic, 'bridge');
    fs.rmSync(interruptedMemory, { force: true });

    const serialized = JSON.stringify(controller.memory);
    assert.ok(!serialized.includes('data:image/') && !serialized.includes(';base64,'));
    assert.deepEqual(state.errors, []);
    const report = {
      checkedAt: new Date().toISOString(), protocol: state.capabilities.protocol,
      model: 'qwen2.5vl:3b', missions,
      gates: {
        threeLiveMissions: missions.length === 3,
        stopAndResume: missions[0].attempts === 2,
        selectedObjectsMatchGoals: missions.every(item => item.selected.object.semantic === item.plan.semantic),
        allViewedByQwen: missions.every(item => item.inspection.views.every(view => view.model === 'qwen2.5vl:3b')),
        sceneClosureRecovered: state.recovery.count >= 1 && recovered.status === 'complete',
        interruptedMissionRestored: restarted.mission('restart-probe').status === 'interrupted',
      },
      rawImagesPersisted: false, controllerErrors: state.errors,
    };
    fs.mkdirSync(path.dirname(outputFile), { recursive: true });
    fs.writeFileSync(outputFile, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify({ output: outputFile, gates: report.gates }, null, 2));
  } finally {
    await controller.stop();
    fs.rmSync(memoryFile, { force: true });
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
