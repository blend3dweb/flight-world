const fs = require('node:fs');
const path = require('node:path');
const { FlightAgentController } = require('./agent-controller.cjs');

const memoryFile = path.join(__dirname, 'tmp', 'agent-bridge', 'flight-mission-live-memory.json');
const outputFile = path.join(__dirname, 'docs', 'verification', 'agent-flight-mission-live.json');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const controller = new FlightAgentController({ port: 0, headless: true, memoryFile });
  try {
    await controller.start();
    const model = await controller.dispatcher.status();
    if (!model.available) throw new Error('The configured vision model is unavailable');
    const mission = controller.createMission({ goal: 'Пролети город, мост и аэропорт' });
    const started = Date.now();
    while (['planned', 'running', 'stopping'].includes(mission.status) && Date.now() - started < 360000) await delay(500);
    if (mission.status !== 'complete') throw new Error(`Flight mission ${mission.status}: ${mission.error ?? 'timeout'}`);
    const report = {
      checkedAt: new Date().toISOString(), protocol: controller.state.capabilities.protocol,
      model: controller.dispatcher.dispatcher.model, goal: mission.plan.goal,
      status: mission.status, decision: mission.decision, steps: mission.progress.steps,
      checkpoints: mission.progress.checkpoints.map(item => ({
        id: item.id, decision: item.decision, expected: item.expected,
        visibleMatches: item.visibleMatches, center: item.center,
        hour: item.observation.world.environment.hour,
        flight: item.observation.world.position,
        perception: item.perception,
      })),
      rawImagesPersisted: false, errors: controller.state.errors,
    };
    fs.mkdirSync(path.dirname(outputFile), { recursive: true });
    fs.writeFileSync(outputFile, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await controller.stop();
    fs.rmSync(memoryFile, { force: true });
  }
})().catch(error => { console.error(error); process.exit(1); });
