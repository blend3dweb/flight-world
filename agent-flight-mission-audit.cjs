const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { FlightAgentController } = require('./agent-controller.cjs');

const memoryFile = path.join(__dirname, 'tmp', 'agent-bridge', 'flight-mission-audit-memory.json');
const outputFile = path.join(__dirname, 'docs', 'verification', 'agent-flight-mission-audit.json');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function until(predicate, label, timeoutMs = 240000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = predicate();
    if (value) return value;
    await delay(200);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

(async () => {
  const controller = new FlightAgentController({ port: 0, headless: true, memoryFile });
  try {
    await controller.start();
    controller.dispatcher.analyze = async (_observation, context) => ({
      perception: `Fixture: ${context.expected.join(', ')} is visible.`,
      finding: { decision: 'pass', summary: 'Deterministic flight-mission fixture.', defects: [] },
    });
    const mission = controller.createMission({ goal: 'Пролети город, мост и аэропорт' });
    assert.equal(mission.plan.kind, 'flight-route');
    await until(() => mission.progress?.nextCheckpoint >= 1 || mission.status !== 'running', 'city checkpoint');
    assert.equal(mission.status, 'running');
    controller.stopMission(mission.id);
    await until(() => mission.status === 'stopped' || mission.status === 'failed', 'mission stop');
    assert.equal(mission.status, 'stopped');
    assert.equal(mission.progress.nextCheckpoint, 1);
    controller.resumeMission(mission.id);
    await until(() => mission.status === 'running' && mission.progress.steps >= 2, 'resumed flight');
    await controller.page.close();
    await until(() => mission.status === 'complete' || mission.status === 'failed', 'mission completion');
    assert.equal(mission.status, 'complete', mission.error);
    assert.equal(mission.decision, 'pass');
    assert.deepEqual(mission.progress.checkpoints.map(item => item.id), ['city', 'bridge', 'airport']);
    assert.ok(mission.progress.steps > 2);
    assert.ok(controller.state.recovery.count >= 1);
    assert.equal(mission.progress.checkpoints.every(item => item.visibleMatches > 0), true);
    assert.equal(JSON.stringify(controller.memory).includes('data:image/'), false);
    const report = {
      checkedAt: new Date().toISOString(), protocol: controller.state.capabilities.protocol,
      goal: mission.plan.goal, status: mission.status, decision: mission.decision,
      checkpoints: mission.progress.checkpoints.map(item => ({ id: item.id, decision: item.decision, visibleMatches: item.visibleMatches })),
      steps: mission.progress.steps, stopAndResume: true, recoveryCount: controller.state.recovery.count,
      rawImagesPersisted: false, model: 'deterministic-fixture', errors: controller.state.errors,
    };
    fs.mkdirSync(path.dirname(outputFile), { recursive: true });
    fs.writeFileSync(outputFile, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await controller.stop();
    fs.rmSync(memoryFile, { force: true });
  }
})().catch(error => { console.error(error); process.exit(1); });
