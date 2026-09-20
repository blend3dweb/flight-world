const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { FlightAgentController } = require('./agent-controller.cjs');

const memoryFile = path.join(__dirname, 'tmp', 'agent-bridge', 'resilience-audit-memory.json');
const outputFile = path.join(__dirname, 'docs', 'verification', 'agent-resilience-audit.json');

function fakeInspection(observationId, decision) {
  return {
    ok: true,
    model: 'deterministic-reinspect-probe',
    role: 'audit-probe',
    codexReview: 'required',
    perception: decision === 'reinspect' ? 'The first angle needs another viewpoint.' : 'The object is visible from this angle.',
    perceptionDecision: decision === 'reinspect' ? 'defect' : 'pass',
    finding: {
      observationId,
      decision,
      summary: decision === 'reinspect' ? 'Additional angle required.' : 'Visible state confirmed.',
      defects: decision === 'reinspect' ? [{ category: 'unknown', severity: 'low', confidence: 0.5, description: 'View is inconclusive.', evidence: ['audit probe'], recommendedAction: 'Capture another angle.' }] : [],
    },
    validation: { errors: [], corrections: [] },
    metrics: { wallMs: 0, pipeline: 'deterministic-audit-probe' },
  };
}

(async () => {
  fs.mkdirSync(path.dirname(memoryFile), { recursive: true });
  fs.rmSync(memoryFile, { force: true });
  const controller = new FlightAgentController({ port: 0, headless: true, memoryFile });
  try {
    const state = await controller.start();
    await controller.execute({ type: 'flight.start', payload: { location: 'airport' } });
    await controller.execute({ type: 'environment.set', payload: { hour: 19.25, weather: 'rain', cycle: false, autoWeather: false, immediate: true } });
    await controller.execute({ type: 'simulation.pause', payload: { paused: true } });
    await controller.execute({ type: 'observer.set', payload: { position: [3300, 480, -2450], target: [2500, 35, -3300], fov: 54 } });
    const checkpoint = await controller.observe({ visual: false });

    await controller.page.close();
    const recovered = await controller.observe({ visual: false });
    assert.deepEqual(recovered.observer, checkpoint.observer);
    assert.equal(recovered.world.environment.weather, checkpoint.world.environment.weather);
    assert.equal(recovered.world.paused, checkpoint.world.paused);
    assert.deepEqual([recovered.world.x, recovered.world.y, recovered.world.z], [checkpoint.world.x, checkpoint.world.y, checkpoint.world.z]);
    assert.equal(state.recovery.count, 1);
    assert.equal(state.recovery.last.restored, true);

    await controller.browser.close();
    const browserRecovered = await controller.observe({ visual: false });
    assert.deepEqual(browserRecovered.observer, checkpoint.observer);
    assert.equal(browserRecovered.world.environment.weather, checkpoint.world.environment.weather);
    assert.equal(state.recovery.count, 2);
    assert.equal(state.recovery.last.restored, true);

    await assert.rejects(
      controller.execute({ type: 'audit.unsupported-command', payload: {} }),
      /Unsupported Agent Bridge command/,
    );
    assert.equal(state.recovery.count, 2, 'Invalid commands must not restart the scene');

    let calls = 0;
    controller.dispatcher.analyze = async (_observation, context) => fakeInspection(context.observationId, calls++ === 0 ? 'reinspect' : 'pass');
    const beforeTour = await controller.observe({ visual: false });
    const tour = await controller.inspectObjectTour({ semantic: 'bridge', views: 3, analyze: true, maxExtraViews: 2 });
    const afterTour = await controller.observe({ visual: false });

    assert.equal(tour.status, 'complete');
    assert.equal(tour.decision, 'pass');
    assert.equal(tour.views.length, 4);
    assert.equal(tour.views.filter(view => view.reason === 'scheduled').length, 3);
    const followUp = tour.views.find(view => view.reason === 'reinspect-follow-up');
    assert.ok(followUp);
    assert.equal(followUp.parentView, 0);
    assert.equal(followUp.rootView, 0);
    assert.equal(followUp.modelInspection.finding.decision, 'pass');
    assert.deepEqual(afterTour.observer, beforeTour.observer);
    assert.equal(state.errors.length, 0);

    const memory = controller.memory;
    const serialized = JSON.stringify(memory);
    assert.equal(serialized.includes('data:image/'), false);
    assert.equal(serialized.includes(';base64,'), false);
    assert.equal(memory.recoveries.length, 2);

    const report = {
      checkedAt: new Date().toISOString(),
      protocol: state.capabilities.protocol,
      recovery: state.recovery,
      checkpoint: {
        observer: checkpoint.observer,
        position: [checkpoint.world.x, checkpoint.world.y, checkpoint.world.z],
        paused: checkpoint.world.paused,
        environment: checkpoint.world.environment,
      },
      recovered: {
        observer: recovered.observer,
        position: [recovered.world.x, recovered.world.y, recovered.world.z],
        paused: recovered.world.paused,
        environment: recovered.world.environment,
      },
      browserRecovered: {
        observer: browserRecovered.observer,
        position: [browserRecovered.world.x, browserRecovered.world.y, browserRecovered.world.z],
        paused: browserRecovered.world.paused,
        environment: browserRecovered.world.environment,
      },
      invalidCommandTriggeredRecovery: false,
      adaptiveInspection: {
        target: tour.target.object,
        requestedViews: tour.requestedViews,
        actualViews: tour.views.length,
        maxExtraViews: tour.maxExtraViews,
        decision: tour.decision,
        views: tour.views.map(view => ({ index: view.index, reason: view.reason, parentView: view.parentView, rootView: view.rootView, azimuth: view.azimuth, elevation: view.elevation, decision: view.modelInspection.finding.decision })),
        observerRestored: JSON.stringify(afterTour.observer) === JSON.stringify(beforeTour.observer),
      },
      rawImagesPersisted: false,
      controllerErrors: state.errors,
    };
    fs.mkdirSync(path.dirname(outputFile), { recursive: true });
    fs.writeFileSync(outputFile, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify({
      protocol: report.protocol,
      recoveries: report.recovery.count,
      checkpointRestored: report.recovery.last.restored,
      invalidCommandTriggeredRecovery: report.invalidCommandTriggeredRecovery,
      requestedViews: report.adaptiveInspection.requestedViews,
      actualViews: report.adaptiveInspection.actualViews,
      decision: report.adaptiveInspection.decision,
      observerRestored: report.adaptiveInspection.observerRestored,
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
