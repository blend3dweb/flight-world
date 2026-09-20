const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { FlightAgentController } = require('./agent-controller.cjs');

const memoryFile = path.join(__dirname, 'tmp', 'agent-bridge', 'controller-audit-memory.json');
const outputFile = path.join(__dirname, 'docs', 'verification', 'agent-controller-smoke.json');

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

async function waitForRoute(base, timeoutMs = 180000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const state = (await request(base, '/state')).body;
    if (state.route && state.route.status !== 'running') return state.route;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error('Agent Controller route timed out');
}

(async () => {
  fs.mkdirSync(path.dirname(memoryFile), { recursive: true });
  fs.rmSync(memoryFile, { force: true });
  const controller = new FlightAgentController({ port: 0, headless: true, memoryFile });
  try {
    const state = await controller.start();
    const base = state.api;
    const health = await request(base, '/health');
    const ping = await request(base, '/command', 'POST', { id: 'controller-ping', type: 'ping' });
    const firstStart = await request(base, '/route/start', 'POST', { name: 'smoke' });
    assert.equal(firstStart.status, 202);
    const firstState = await waitForRoute(base);
    assert.equal(firstState.status, 'complete');

    const recheckStart = await request(base, '/route/recheck', 'POST', { name: 'smoke' });
    assert.equal(recheckStart.status, 202);
    const recheckState = await waitForRoute(base);
    assert.equal(recheckState.status, 'complete');

    const fullStart = await request(base, '/route/start', 'POST', { name: 'oceania-inspection' });
    assert.equal(fullStart.status, 202);
    const fullState = await waitForRoute(base, 300000);
    assert.equal(fullState.status, 'complete');

    const memory = (await request(base, '/memory')).body;
    const runs = memory.routeRuns.filter(run => run.name === 'smoke');
    const baseline = runs.find(run => !run.recheck);
    const recheck = runs.find(run => run.recheck);
    const full = memory.routeRuns.find(run => run.name === 'oceania-inspection');
    assert.equal(health.body.ok, true);
    assert.equal(health.body.protocol, '0.1.0');
    assert.equal(ping.body.ok, true);
    assert.equal(ping.body.result.protocol, '0.1.0');
    assert.equal(baseline.status, 'complete');
    assert.equal(baseline.waypoints.length, 2);
    assert.equal(recheck.status, 'complete');
    assert.equal(recheck.baselineId, baseline.id);
    assert.equal(recheck.comparison.length, 2);
    assert.equal(full.status, 'complete');
    assert.deepEqual(full.waypoints.map(item => item.id), ['city-overview', 'city-night', 'bridge-rain', 'airport', 'islands-snow', 'ocean-sunset']);
    for (const run of runs) {
      for (const waypoint of run.waypoints) {
        assert.ok(waypoint.center?.object?.id > 0);
        assert.ok(waypoint.center.object.module);
        assert.deepEqual(Object.keys(waypoint.observation.sensors).sort(), ['depth', 'normal', 'objectId', 'rgb']);
      }
    }
    const serialized = JSON.stringify(memory);
    assert.equal(serialized.includes('data:image/'), false, 'Persistent route memory must not contain image payloads');
    assert.equal(state.errors.length, 0);
    assert.equal(fs.existsSync(memoryFile), true);

    const report = {
      checkedAt: new Date().toISOString(),
      protocol: health.body.protocol,
      apiHost: new URL(base).hostname,
      baseline: { id: baseline.id, status: baseline.status, waypoints: baseline.waypoints.map(item => ({ id: item.id, center: item.center.object, sensors: item.observation.sensors })) },
      recheck: { id: recheck.id, baselineId: recheck.baselineId, status: recheck.status, comparison: recheck.comparison },
      fullRoute: { id: full.id, status: full.status, waypoints: full.waypoints.map(item => ({ id: item.id, center: item.center.object, environment: item.observation.world.environment, sensors: item.observation.sensors })) },
      persistedWithoutImages: true,
      errors: state.errors,
    };
    fs.mkdirSync(path.dirname(outputFile), { recursive: true });
    fs.writeFileSync(outputFile, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify({
      protocol: report.protocol,
      apiHost: report.apiHost,
      baselineWaypoints: report.baseline.waypoints.length,
      recheckComparisons: report.recheck.comparison.length,
      fullRouteWaypoints: report.fullRoute.waypoints.length,
      persistedWithoutImages: report.persistedWithoutImages,
      errors: report.errors,
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
