const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { FlightAgentController } = require('./agent-controller.cjs');

const memoryFile = path.join(__dirname, 'tmp', 'agent-bridge', 'flight-control-audit-memory.json');
const outputFile = path.join(__dirname, 'docs', 'verification', 'agent-flight-control-audit.json');

(async () => {
  const controller = new FlightAgentController({ port: 0, headless: true, memoryFile });
  try {
    await controller.start();
    const command = (type, payload) => controller.execute({ type, payload });
    const state = async () => (await controller.observe({ visual: false })).world;
    await command('flight.start', { location: 'airport' });
    await command('simulation.pause', { paused: true });
    const altitude = await command('flight.setAltitude', { metres: 350 });
    assert.equal(altitude.result.targetAltitude, 350);
    const route = await command('flight.setRoute', { waypoints: [{ x: 2600, z: -3000, y: 350 }] });
    assert.equal(route.result.route.length, 1);
    const speed = await command('simulation.setSpeed', { factor: 1.5 });
    assert.equal(speed.result.simulationSpeed, 1.5);
    const before = await state();
    await command('simulation.step', { seconds: 2 });
    await command('simulation.step', { seconds: 2 });
    const after = await state();
    assert.equal(after.paused, true);
    assert.ok(after.time >= before.time + 3.9, 'Paused stepping must advance simulation time');
    assert.ok(after.z < before.z - 100, 'Route must move the aircraft toward the waypoint');
    assert.ok(after.x < before.x, 'Route must steer toward the waypoint x coordinate');
    assert.ok(after.y > before.y, 'Altitude command must begin a climb');
    await assert.rejects(command('flight.setAltitude', { metres: 9000 }), /Altitude must be/);
    await assert.rejects(command('flight.setRoute', { waypoints: [{ x: 99999, z: 0 }] }), /Route requires/);
    await assert.rejects(command('simulation.setSpeed', { factor: 10 }), /Simulation speed must be/);

    await controller.page.close();
    const restored = await state();
    assert.equal(restored.flightPlan.targetAltitude, 350);
    assert.equal(restored.flightPlan.route.length, 1);
    assert.equal(restored.flightPlan.simulationSpeed, 1.5);
    assert.equal(restored.paused, true);

    await command('flight.setRoute', { waypoints: [] });
    await command('flight.start', { location: 'city' });
    const reset = await state();
    assert.equal(reset.flightPlan.route.length, 0);
    assert.equal(reset.flightPlan.targetAltitude, null);
    assert.equal(reset.flightPlan.simulationSpeed, 1);
    const report = {
      checkedAt: new Date().toISOString(),
      protocol: controller.state.capabilities.protocol,
      before: { x: before.x, y: before.y, z: before.z, time: before.time },
      after: { x: after.x, y: after.y, z: after.z, time: after.time },
      pausedStepAdvanced: true, routeSteered: true, altitudeClimbed: true,
      invalidCommandsRejected: true, checkpointRestored: true, resetClearedPlan: true,
      rawImagesPersisted: false,
    };
    fs.mkdirSync(path.dirname(outputFile), { recursive: true });
    fs.writeFileSync(outputFile, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await controller.stop();
    fs.rmSync(memoryFile, { force: true });
  }
})().catch(error => { console.error(error); process.exit(1); });
