const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const { chromium } = require('C:/Users/sva/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const { OllamaVisionDispatcher } = require('./ollama-vision-dispatcher.cjs');
const { planMission } = require('./agent-mission-planner.cjs');

const root = __dirname;
const defaults = {
  origin: 'http://127.0.0.1:8765',
  host: '127.0.0.1',
  port: 8766,
  headless: true,
  routeFile: path.join(root, 'agent-routes.json'),
  memoryFile: path.join(root, 'tmp', 'agent-bridge', 'memory.json'),
  modelConfigFile: path.join(root, 'agent-model-config.json'),
};

function now() { return new Date().toISOString(); }
function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function isRecoverableConnectionError(error) {
  return /target page.*closed|page has been closed|browser has been closed|browser closed|target closed|execution context was destroyed|session closed|connection closed|page crashed/i.test(String(error?.message ?? error));
}
function normalizedProjectFiles(files) {
  if (!Array.isArray(files) || files.length < 1 || files.length > 20) throw new Error('One to twenty project files are required');
  return [...new Set(files.map(value => {
    const file = String(value ?? '').trim().replaceAll('\\', '/');
    if (!file || file.includes('\0') || path.isAbsolute(file) || file.split('/').includes('..')) throw new Error(`Unsafe project file: ${file || '<empty>'}`);
    return file.replace(/^\.\//, '');
  }))];
}
function json(response, status, value) {
  const body = JSON.stringify(value, null, 2);
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' });
  response.end(body);
}
function readBody(request, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', chunk => {
      body += chunk;
      if (body.length > limit) reject(new Error('Request body is too large'));
    });
    request.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { reject(new Error('Request body must be valid JSON')); }
    });
    request.on('error', reject);
  });
}
function summarizePass(pass) {
  if (!pass) return null;
  return {
    mimeType: pass.mimeType,
    width: pass.width,
    height: pass.height,
    meanLuminance: pass.meanLuminance,
    luminanceStdDev: pass.luminanceStdDev,
    bytes: typeof pass.dataUrl === 'string' ? Math.floor((pass.dataUrl.length - pass.dataUrl.indexOf(',') - 1) * 0.75) : 0,
  };
}
function summarizeObservation(observation) {
  const visual = observation.visual;
  return {
    timestamp: observation.timestamp,
    observer: observation.observer,
    world: {
      position: [observation.world.x, observation.world.y, observation.world.z],
      heading: observation.world.heading,
      paused: observation.world.paused,
      quality: observation.world.quality,
      environment: observation.world.environment,
      ocean: observation.world.ocean,
    },
    telemetry: observation.telemetry,
    nearby: observation.nearby.map(object => ({ id: object.id, name: object.name, semantic: object.semantic, module: object.module, position: object.position })),
    sensors: visual ? Object.fromEntries(Object.entries(visual.passes).map(([name, pass]) => [name, summarizePass(pass)])) : {},
  };
}

class FlightAgentController {
  constructor(options = {}) {
    this.options = { ...defaults, ...options };
    this.browser = null;
    this.page = null;
    this.api = null;
    this.sceneServer = null;
    this.queue = Promise.resolve();
    this.recoveryPromise = null;
    this.stopping = false;
    this.cancelRoute = false;
    this.missionPromise = null;
    this.state = { status: 'created', startedAt: null, api: null, scene: this.options.origin, route: null, inspection: null, cycle: null, mission: null, recovery: { count: 0, last: null }, errors: [] };
    this.routes = JSON.parse(fs.readFileSync(this.options.routeFile, 'utf8'));
    this.dispatcher = new OllamaVisionDispatcher({ configPath: this.options.modelConfigFile });
    this.memory = this.loadMemory();
    this.safeCheckpoint = this.memory.safeCheckpoint ?? null;
  }

  loadMemory() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.options.memoryFile, 'utf8'));
      if (parsed.version === 1 && Array.isArray(parsed.routeRuns)) {
        if (!Array.isArray(parsed.inspectionRuns)) parsed.inspectionRuns = [];
        if (!Array.isArray(parsed.recoveries)) parsed.recoveries = [];
        if (!Array.isArray(parsed.developmentCycles)) parsed.developmentCycles = [];
        if (!Array.isArray(parsed.missions)) parsed.missions = [];
        for (const mission of parsed.missions) if (mission.status === 'running') mission.status = 'interrupted';
        return parsed;
      }
    } catch {}
    return { version: 1, updatedAt: null, sessions: [], routeRuns: [], inspectionRuns: [], recoveries: [], developmentCycles: [], missions: [], safeCheckpoint: null };
  }

  saveMemory() {
    this.memory.updatedAt = now();
    fs.mkdirSync(path.dirname(this.options.memoryFile), { recursive: true });
    const temporary = `${this.options.memoryFile}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(this.memory, null, 2)}\n`);
    fs.renameSync(temporary, this.options.memoryFile);
  }

  async sceneAvailable() {
    try {
      const response = await fetch(`${this.options.origin}/webgpu/index.html`, { signal: AbortSignal.timeout(1500) });
      return response.ok && (await response.text()).includes('flight.js');
    } catch { return false; }
  }

  async ensureSceneServer() {
    if (await this.sceneAvailable()) return;
    this.sceneServer = spawn(process.execPath, [path.join(root, 'serve.cjs')], { cwd: root, stdio: 'ignore', windowsHide: true });
    for (let attempt = 0; attempt < 30; attempt++) {
      await delay(250);
      if (await this.sceneAvailable()) return;
      if (this.sceneServer.exitCode !== null) break;
    }
    throw new Error('Flight World scene server did not start');
  }

  attachPageEvents(page) {
    page.on('pageerror', error => this.state.errors.push({ at: now(), type: 'pageerror', message: error.message }));
    page.on('console', message => { if (message.type() === 'error') this.state.errors.push({ at: now(), type: 'console', message: message.text() }); });
  }

  async ensureBrowser() {
    if (this.browser?.isConnected()) return;
    this.browser = await chromium.launch({
      channel: 'chrome',
      headless: this.options.headless,
      args: ['--force-high-performance-gpu', '--use-webgpu-power-preference=high-performance'],
    });
  }

  async openScenePage() {
    await this.ensureBrowser();
    this.page = await this.browser.newPage({ viewport: { width: 1280, height: 720 } });
    this.attachPageEvents(this.page);
    await this.page.goto(`${this.options.origin}/webgpu/index.html?test=1`);
    await this.page.waitForFunction(() => window.flightReady && window.flight?.agent, null, { timeout: 120000 });
    return this.page.evaluate(() => window.flight.agent.capabilities());
  }

  rememberCheckpoint(observation) {
    if (!observation?.observer || !observation?.world) return;
    this.safeCheckpoint = {
      at: now(),
      observer: observation.observer,
      flight: {
        x: observation.world.x, y: observation.world.y, z: observation.world.z,
        heading: observation.world.heading, pitch: observation.world.pitch, roll: observation.world.roll,
      },
      environment: observation.world.environment,
      flightPlan: observation.world.flightPlan ?? null,
      paused: observation.world.paused,
      quality: observation.world.quality,
    };
    this.memory.safeCheckpoint = this.safeCheckpoint;
  }

  async restoreCheckpoint(checkpoint) {
    if (!checkpoint) return;
    const dispatch = command => this.page.evaluate(value => window.flight.agent.dispatch(value), command);
    await dispatch({ type: 'simulation.pause', payload: { paused: true } });
    await this.page.evaluate(flight => window.flight.place?.(flight), checkpoint.flight);
    if (checkpoint.flightPlan) {
      await dispatch({ type: 'simulation.setSpeed', payload: { factor: checkpoint.flightPlan.simulationSpeed ?? 1 } });
      if (checkpoint.flightPlan.targetAltitude != null) await dispatch({ type: 'flight.setAltitude', payload: { metres: checkpoint.flightPlan.targetAltitude } });
      if (checkpoint.flightPlan.route?.length) await dispatch({ type: 'flight.setRoute', payload: { waypoints: checkpoint.flightPlan.route } });
    }
    if (checkpoint.environment) await dispatch({ type: 'environment.set', payload: { ...checkpoint.environment, cycle: false, autoWeather: false, immediate: true } });
    if (checkpoint.quality) await dispatch({ type: 'quality.set', payload: { quality: checkpoint.quality } });
    if (checkpoint.observer) await dispatch({ type: 'observer.set', payload: checkpoint.observer });
    await dispatch({ type: 'simulation.pause', payload: { paused: checkpoint.paused !== false } });
  }

  async recoverScene(reason) {
    if (this.recoveryPromise) return this.recoveryPromise;
    this.recoveryPromise = (async () => {
      const startedAt = now();
      const hadCheckpoint = Boolean(this.safeCheckpoint);
      this.state.status = 'recovering';
      try {
        if (this.page && !this.page.isClosed()) await this.page.close().catch(() => {});
        await this.ensureSceneServer();
        const capabilities = await this.openScenePage();
        await this.restoreCheckpoint(this.safeCheckpoint);
        const observation = await this.page.evaluate(() => window.flight.agent.observe({ visual: false }));
        this.rememberCheckpoint(observation);
        const recovery = { at: now(), startedAt, reason: String(reason?.message ?? reason).slice(0, 500), restored: hadCheckpoint };
        this.state.capabilities = capabilities;
        this.state.recovery.count++;
        this.state.recovery.last = recovery;
        this.memory.recoveries.push(recovery);
        this.memory.recoveries = this.memory.recoveries.slice(-20);
        this.state.status = 'ready';
        this.saveMemory();
      } catch (error) {
        this.state.status = 'failed';
        this.state.errors.push({ at: now(), type: 'recovery', message: error.message });
        throw error;
      } finally {
        this.recoveryPromise = null;
      }
    })();
    return this.recoveryPromise;
  }

  async withSceneRecovery(action) {
    try {
      return await action();
    } catch (error) {
      if (this.stopping || !isRecoverableConnectionError(error)) throw error;
      await this.recoverScene(error);
      return action();
    }
  }

  snapshotProjectFiles(files) {
    return normalizedProjectFiles(files).map(file => {
      const absolute = path.resolve(root, file);
      if (!absolute.startsWith(`${path.resolve(root)}${path.sep}`)) throw new Error(`Project file escapes workspace: ${file}`);
      if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) return { file, exists: false, bytes: 0, sha256: null };
      const content = fs.readFileSync(absolute);
      return { file, exists: true, bytes: content.length, sha256: crypto.createHash('sha256').update(content).digest('hex') };
    });
  }

  developmentCycle(id) {
    const cycle = this.memory.developmentCycles.find(item => item.id === id);
    if (!cycle) throw new Error(`Development cycle was not found: ${id}`);
    return cycle;
  }

  createDevelopmentCycle(run) {
    if (run.developmentCycleId) return this.developmentCycle(run.developmentCycleId);
    const nonPassViews = run.views.filter(view => view.modelInspection?.finding?.decision !== 'pass');
    const cycle = {
      id: crypto.randomUUID(),
      createdAt: now(),
      updatedAt: now(),
      status: 'awaiting-codex-review',
      inspectionRunId: run.id,
      target: run.target,
      request: run.requested,
      settings: run.settings,
      environment: run.views[0]?.observation?.world?.environment ?? null,
      initialDecision: run.decision,
      evidence: nonPassViews.map(view => ({
        view: view.index,
        reason: view.reason,
        center: view.center?.object ?? null,
        finding: view.modelInspection.finding,
      })),
      review: null,
      fix: null,
      recheck: null,
      history: [{ at: now(), event: 'finding-created', decision: run.decision }],
    };
    run.developmentCycleId = cycle.id;
    this.memory.developmentCycles.push(cycle);
    this.memory.developmentCycles = this.memory.developmentCycles.slice(-50);
    this.state.cycle = { id: cycle.id, status: cycle.status };
    this.saveMemory();
    return cycle;
  }

  reviewDevelopmentCycle({ id, reviewer, decision, rationale, files = [] } = {}) {
    const cycle = this.developmentCycle(id);
    if (reviewer !== 'codex') throw new Error('Only Codex may review a development cycle');
    if (!['approve-fix', 'request-reinspection', 'reject'].includes(decision)) throw new Error('Unsupported Codex review decision');
    if (typeof rationale !== 'string' || !rationale.trim()) throw new Error('Codex review rationale is required');
    if (!['awaiting-codex-review', 'needs-work'].includes(cycle.status)) throw new Error(`Cycle cannot be reviewed from status: ${cycle.status}`);
    const proposedFiles = decision === 'approve-fix' ? normalizedProjectFiles(files) : [];
    cycle.review = { at: now(), reviewer, decision, rationale: rationale.trim().slice(0, 2000), proposedFiles };
    if (decision === 'approve-fix') {
      cycle.review.beforeFiles = this.snapshotProjectFiles(proposedFiles);
      cycle.status = 'approved-for-fix';
    } else if (decision === 'request-reinspection') cycle.status = 'reinspection-requested';
    else cycle.status = 'rejected';
    cycle.updatedAt = now();
    cycle.history.push({ at: now(), event: 'codex-review', decision, rationale: cycle.review.rationale });
    this.state.cycle = { id: cycle.id, status: cycle.status };
    this.saveMemory();
    return cycle;
  }

  recordDevelopmentFix({ id, reviewer, summary, files, commit = null } = {}) {
    const cycle = this.developmentCycle(id);
    if (reviewer !== 'codex') throw new Error('Only Codex may record a development fix');
    if (cycle.status !== 'approved-for-fix') throw new Error(`Fix cannot be recorded from status: ${cycle.status}`);
    if (typeof summary !== 'string' || !summary.trim()) throw new Error('Fix summary is required');
    const changedFiles = normalizedProjectFiles(files);
    const approved = new Set(cycle.review.proposedFiles);
    if (changedFiles.some(file => !approved.has(file))) throw new Error('Fix contains a file that Codex did not approve');
    const before = new Map(cycle.review.beforeFiles.map(item => [item.file, item]));
    const afterFiles = this.snapshotProjectFiles(changedFiles);
    const changed = afterFiles.filter(item => {
      const previous = before.get(item.file) ?? { exists: false, sha256: null };
      return item.exists !== previous.exists || item.sha256 !== previous.sha256;
    });
    if (!changed.length) throw new Error('No approved project file changed after Codex review');
    cycle.fix = {
      at: now(), reviewer, summary: summary.trim().slice(0, 2000),
      commit: typeof commit === 'string' && commit.trim() ? commit.trim().slice(0, 100) : null,
      files: afterFiles,
      changed: changed.map(item => item.file),
    };
    cycle.status = 'fix-recorded';
    cycle.updatedAt = now();
    cycle.history.push({ at: now(), event: 'fix-recorded', files: cycle.fix.changed, commit: cycle.fix.commit });
    this.state.cycle = { id: cycle.id, status: cycle.status };
    this.saveMemory();
    return cycle;
  }

  async refreshScene() {
    this.state.status = 'refreshing';
    try {
      if (this.page && !this.page.isClosed()) await this.page.close().catch(() => {});
      await this.ensureSceneServer();
      const capabilities = await this.openScenePage();
      await this.restoreCheckpoint(this.safeCheckpoint);
      const observation = await this.page.evaluate(() => window.flight.agent.observe({ visual: false }));
      this.rememberCheckpoint(observation);
      this.state.capabilities = capabilities;
      this.state.status = 'ready';
    } catch (error) {
      this.state.status = 'failed';
      throw error;
    }
  }

  async recheckDevelopmentCycle(id) {
    const cycle = this.developmentCycle(id);
    if (!['fix-recorded', 'reinspection-requested'].includes(cycle.status)) throw new Error(`Cycle cannot be rechecked from status: ${cycle.status}`);
    cycle.status = 'verifying';
    cycle.updatedAt = now();
    cycle.history.push({ at: now(), event: 'recheck-started' });
    this.state.cycle = { id: cycle.id, status: cycle.status };
    this.saveMemory();
    try {
      await this.refreshScene();
      const sourceRun = this.memory.inspectionRuns.find(run => run.id === cycle.inspectionRunId);
      const environment = cycle.environment ?? sourceRun?.views[0]?.observation?.world?.environment;
      if (!environment || !Number.isFinite(environment.hour) || !['sun', 'rain', 'snow'].includes(environment.weather)) {
        throw new Error('Original inspection environment is unavailable; recheck cannot be compared');
      }
      await this.execute({ type: 'environment.set', payload: {
        hour: environment.hour, weather: environment.weather,
        cycle: false, autoWeather: false, immediate: true,
      } });
      const settings = cycle.settings ?? {};
      const run = await this.inspectObjectTour({
        name: cycle.target.object.name,
        semantic: cycle.target.object.semantic,
        views: settings.views ?? 4,
        startAzimuth: settings.startAzimuth ?? 0,
        elevation: settings.elevation ?? 0.3,
        distanceFactor: settings.distanceFactor ?? 2.4,
        minimumDistance: settings.minimumDistance ?? 20,
        maxExtraViews: settings.maxExtraViews ?? 2,
        orbitAnchor: settings.orbitAnchor ?? null,
        orbitRadius: settings.orbitRadius ?? null,
        analyze: true,
        createCycle: false,
      });
      cycle.recheck = { at: now(), inspectionRunId: run.id, decision: run.decision, views: run.views.length };
      cycle.status = run.decision === 'pass' ? 'verified' : 'needs-work';
      cycle.updatedAt = now();
      cycle.history.push({ at: now(), event: 'recheck-completed', decision: run.decision, inspectionRunId: run.id });
      this.state.cycle = { id: cycle.id, status: cycle.status };
      this.saveMemory();
      return cycle;
    } catch (error) {
      cycle.status = 'recheck-failed';
      cycle.updatedAt = now();
      cycle.history.push({ at: now(), event: 'recheck-failed', error: error.message });
      this.state.cycle = { id: cycle.id, status: cycle.status };
      this.saveMemory();
      throw error;
    }
  }

  mission(id) {
    const mission = this.memory.missions.find(item => item.id === id);
    if (!mission) throw new Error(`Mission was not found: ${id}`);
    return mission;
  }

  createMission(request) {
    if (this.missionPromise || this.state.route?.status === 'running' || this.state.inspection?.status === 'running') {
      throw new Error('Another mission, route, or inspection is running');
    }
    const plan = planMission(request, this.routes);
    const mission = {
      id: crypto.randomUUID(), createdAt: now(), updatedAt: now(),
      status: 'planned', plan, attempts: 0, selection: null,
      inspectionRunId: null, developmentCycleId: null, decision: null, progress: null,
      history: [{ at: now(), event: 'planned', reason: plan.selectionReason }],
    };
    this.memory.missions.push(mission);
    this.memory.missions = this.memory.missions.slice(-50);
    this.saveMemory();
    this.launchMission(mission);
    return mission;
  }

  launchMission(mission) {
    if (this.missionPromise) throw new Error('Another mission is running');
    this.missionPromise = this.executeMission(mission).finally(() => { this.missionPromise = null; });
    this.missionPromise.catch(() => {});
  }

  resumeMission(id) {
    const mission = this.mission(id);
    if (this.missionPromise || !['interrupted', 'stopped', 'failed'].includes(mission.status)) {
      throw new Error(`Mission cannot resume from status: ${mission.status}`);
    }
    this.launchMission(mission);
    return mission;
  }

  stopMission(id) {
    const mission = this.mission(id);
    if (mission.status !== 'running') throw new Error(`Mission cannot stop from status: ${mission.status}`);
    mission.status = 'stopping';
    mission.updatedAt = now();
    mission.history.push({ at: now(), event: 'stop-requested' });
    this.cancelRoute = true;
    this.state.mission = { id, status: mission.status };
    this.saveMemory();
    return mission;
  }

  async executeMission(mission) {
    if (mission.plan.kind === 'flight-route') return this.executeFlightMission(mission);
    const plan = mission.plan;
    mission.status = 'running';
    mission.attempts++;
    mission.updatedAt = now();
    mission.history.push({ at: now(), event: 'started', attempt: mission.attempts });
    this.state.mission = { id: mission.id, status: mission.status };
    this.saveMemory();
    try {
      const waypoint = this.routeDefinition('oceania-inspection').waypoints.find(item => item.id === plan.waypoint);
      await this.execute({ type: 'simulation.pause', payload: { paused: true } });
      await this.execute({ type: 'observer.set', payload: { position: waypoint.position, target: waypoint.target, fov: 58 } });
      await this.execute({ type: 'environment.set', payload: plan.environment });
      const matches = (await this.execute({
        type: 'world.query', payload: { semantic: plan.semantic, name: plan.preferredName, visible: true, limit: 20 },
      })).result;
      if (!matches.length) throw new Error(`No visible ${plan.semantic} object matches ${plan.preferredName}`);
      const selected = matches.find(item => item.name === plan.preferredName) ?? matches[0];
      mission.selection = {
        object: selected, candidateCount: matches.length,
        reason: `Visible ${plan.semantic} object matching ${plan.preferredName} in scene catalog.`,
      };
      mission.history.push({ at: now(), event: 'object-selected', object: selected.name, semantic: selected.semantic });
      this.saveMemory();
      if (mission.status === 'stopping') {
        mission.status = 'stopped';
        return mission;
      }
      const run = await this.inspectObjectTour({
        name: selected.name, semantic: plan.semantic, views: plan.views,
        maxExtraViews: plan.maxExtraViews, orbitAnchor: plan.orbitAnchor,
        orbitRadius: plan.orbitRadius, analyze: true, missionId: mission.id,
      });
      mission.inspectionRunId = run.id;
      mission.developmentCycleId = run.developmentCycleId ?? null;
      mission.decision = run.decision;
      mission.status = run.status === 'cancelled' || mission.status === 'stopping'
        ? 'stopped' : run.status === 'complete' ? 'complete' : 'failed';
      mission.history.push({
        at: now(), event: mission.status === 'complete' ? 'inspection-completed' : 'inspection-stopped',
        decision: run.decision, views: run.views.length, cycleId: mission.developmentCycleId,
      });
      return mission;
    } catch (error) {
      mission.status = mission.status === 'stopping' ? 'stopped' : 'failed';
      mission.error = error.message;
      mission.history.push({ at: now(), event: 'failed', error: error.message });
      throw error;
    } finally {
      mission.updatedAt = now();
      this.state.mission = { id: mission.id, status: mission.status };
      this.saveMemory();
    }
  }

  async executeFlightMission(mission) {
    const route = this.routeDefinition(mission.plan.route);
    const checkpoints = route.checkpoints;
    if (!Array.isArray(checkpoints) || checkpoints.length < 2) throw new Error('Flight mission requires at least two checkpoints');
    const fresh = mission.attempts === 0;
    const progress = mission.progress ?? { nextCheckpoint: 0, steps: 0, checkpoints: [] };
    mission.progress = progress;
    mission.status = 'running';
    mission.attempts++;
    this.cancelRoute = false;
    this.state.mission = { id: mission.id, status: mission.status };
    mission.history.push({ at: now(), event: fresh ? 'flight-started' : 'flight-resumed', checkpoint: progress.nextCheckpoint });
    this.saveMemory();
    try {
      if (fresh) await this.execute({ type: 'flight.start', payload: { location: route.flightStart } });
      await this.execute({ type: 'simulation.pause', payload: { paused: true } });
      await this.execute({ type: 'environment.set', payload: mission.plan.environment });
      const remaining = checkpoints.slice(Math.max(1, progress.nextCheckpoint)).map(item => item.flight);
      await this.execute({ type: 'flight.setRoute', payload: { waypoints: remaining } });
      for (let index = progress.nextCheckpoint; index < checkpoints.length; index++) {
        const checkpoint = checkpoints[index];
        if (this.cancelRoute || mission.status === 'stopping') break;
        if (checkpoint.flight) {
          await this.execute({ type: 'observer.followObject', payload: { semantic: 'aircraft', name: 'AERO 042' } });
          let arrived = false;
          for (let step = 0; step < 180; step++) {
            if (this.cancelRoute || mission.status === 'stopping') break;
            const observation = await this.observe({ visual: false });
            const world = observation.world;
            if (!world.auto) {
              mission.history.push({ at: now(), event: 'manual-override', checkpoint: checkpoint.id });
              mission.status = 'stopping';
              break;
            }
            const distance = Math.hypot(world.x - checkpoint.flight.x, world.z - checkpoint.flight.z);
            if (distance < 120) { arrived = true; break; }
            const seconds = Math.max(.25, Math.min(2, distance / Math.max(world.speed, 40) / 2));
            await this.execute({ type: 'simulation.step', payload: { seconds } });
            progress.steps++;
            if (progress.steps % 4 === 0) this.saveMemory();
          }
          if (this.cancelRoute || mission.status === 'stopping') break;
          if (!arrived) throw new Error(`Aircraft did not reach checkpoint: ${checkpoint.id}`);
        }
        await this.execute({ type: 'observer.set', payload: { ...checkpoint.observer, fov: 58 } });
        const width = this.dispatcher.dispatcher.inputs.rgb.width;
        const height = this.dispatcher.dispatcher.inputs.rgb.height;
        const observation = await this.observe({ visual: true, sensors: ['rgb', 'depth', 'normal', 'objectId'], width, height, quality: .72 });
        const center = (await this.execute({ type: 'world.identifyPixel', payload: { x: Math.floor(width / 2), y: Math.floor(height / 2), width, height } })).result.hit;
        const expectedObjects = (await this.execute({ type: 'world.query', payload: { semantic: checkpoint.expected[0], visible: true, limit: 5 } })).result;
        const analysis = await this.dispatcher.analyze(observation, {
          observationId: `${mission.id}:${checkpoint.id}`, mission: mission.id,
          expected: checkpoint.expected, center,
        });
        const decision = expectedObjects.length ? analysis.finding.decision : 'reinspect';
        progress.checkpoints.push({
          id: checkpoint.id, at: now(), decision, expected: checkpoint.expected,
          visibleMatches: expectedObjects.length, center: center?.object ?? null,
          observation: summarizeObservation(observation), perception: analysis.perception,
        });
        progress.nextCheckpoint = index + 1;
        mission.history.push({ at: now(), event: 'flight-checkpoint', checkpoint: checkpoint.id, decision, steps: progress.steps });
        this.saveMemory();
      }
      if (this.cancelRoute || mission.status === 'stopping') {
        mission.status = 'stopped';
        mission.decision = null;
        mission.history.push({ at: now(), event: 'flight-stopped', checkpoint: progress.nextCheckpoint });
      } else {
        mission.status = 'complete';
        mission.decision = progress.checkpoints.every(item => item.decision === 'pass') ? 'pass' : 'reinspect';
        mission.history.push({ at: now(), event: 'flight-completed', decision: mission.decision, steps: progress.steps });
      }
      return mission;
    } catch (error) {
      mission.status = mission.status === 'stopping' ? 'stopped' : 'failed';
      mission.error = error.message;
      mission.history.push({ at: now(), event: 'flight-failed', error: error.message });
      throw error;
    } finally {
      await this.execute({ type: 'flight.setRoute', payload: { waypoints: [] } }).catch(() => {});
      await this.execute({ type: 'simulation.pause', payload: { paused: true } }).catch(() => {});
      mission.updatedAt = now();
      this.state.mission = { id: mission.id, status: mission.status };
      this.saveMemory();
    }
  }

  async start() {
    if (this.state.status !== 'created' && this.state.status !== 'stopped') return this.state;
    this.stopping = false;
    this.state.status = 'starting';
    await this.ensureSceneServer();
    const capabilities = await this.openScenePage();
    if (this.safeCheckpoint) await this.restoreCheckpoint(this.safeCheckpoint);
    const initialObservation = await this.page.evaluate(() => window.flight.agent.observe({ visual: false }));
    this.rememberCheckpoint(initialObservation);
    await this.startApi();
    this.state.status = 'ready';
    this.state.startedAt = now();
    this.state.capabilities = capabilities;
    this.memory.sessions.push({ id: crypto.randomUUID(), startedAt: this.state.startedAt, protocol: capabilities.protocol, scene: this.options.origin });
    this.memory.sessions = this.memory.sessions.slice(-30);
    this.saveMemory();
    return this.state;
  }

  async startApi() {
    this.api = http.createServer((request, response) => this.handleRequest(request, response).catch(error => json(response, 500, { ok: false, error: error.message })));
    await new Promise((resolve, reject) => {
      this.api.once('error', reject);
      this.api.listen(this.options.port, this.options.host, resolve);
    });
    const address = this.api.address();
    this.state.api = `http://${this.options.host}:${address.port}`;
  }

  enqueue(action) {
    const run = this.queue.then(action, action);
    this.queue = run.catch(() => {});
    return run;
  }

  execute(command) {
    return this.enqueue(() => this.withSceneRecovery(() => this.page.evaluate(commandValue => window.flight.agent.dispatch(commandValue), command)));
  }

  observe(payload = {}) {
    return this.enqueue(() => this.withSceneRecovery(async () => {
      const observation = await this.page.evaluate(payloadValue => window.flight.agent.observe(payloadValue), payload);
      this.rememberCheckpoint(observation);
      return observation;
    }));
  }

  routeDefinition(name) {
    const route = this.routes.routes?.[name];
    if (!route) throw new Error(`Unknown route: ${name}`);
    return route;
  }

  async inspectWithModel(context = {}) {
    const width = this.dispatcher.dispatcher.inputs.rgb.width;
    const height = this.dispatcher.dispatcher.inputs.rgb.height;
    const observation = await this.observe({ visual: true, sensors: ['rgb', 'depth', 'normal', 'objectId'], width, height, quality: 0.72 });
    const identification = await this.execute({ type: 'world.identifyPixel', payload: { x: Math.floor(width / 2), y: Math.floor(height / 2), width, height } });
    return this.dispatcher.analyze(observation, { ...context, center: identification.result.hit });
  }

  async inspectObjectTour({ id, name, semantic, views = 4, analyze = true, startAzimuth = 0, elevation = 0.3, distanceFactor = 2.4, minimumDistance = 20, maxExtraViews = 2, orbitAnchor = null, orbitRadius = null, createCycle = true, missionId = null } = {}) {
    if (this.missionPromise && missionId !== this.state.mission?.id) throw new Error('A mission is already running');
    if (this.state.route?.status === 'running') throw new Error('A route is already running');
    if (this.state.inspection?.status === 'running') throw new Error('Another object inspection is already running');
    if (!id && !name && !semantic) throw new Error('Object inspection requires id, name, or semantic');
    const viewCount = Math.max(3, Math.min(8, Math.floor(Number(views) || 4)));
    const extraLimit = analyze === true ? Math.max(0, Math.min(4, Math.floor(Number(maxExtraViews) || 0))) : 0;
    if (orbitAnchor !== null && (!Array.isArray(orbitAnchor) || orbitAnchor.length !== 3 || orbitAnchor.some(value => !Number.isFinite(value)) || !Number.isFinite(orbitRadius) || orbitRadius < 20 || orbitRadius > 5000)) {
      throw new Error('Orbit anchor requires three finite coordinates and radius 20–5000');
    }
    const run = {
      id: crypto.randomUUID(),
      startedAt: now(),
      completedAt: null,
      status: 'running',
      requested: { id: Number.isInteger(id) ? id : null, name: name || null, semantic: semantic || null },
      analyze: analyze === true,
      requestedViews: viewCount,
      maxExtraViews: extraLimit,
      settings: { views: viewCount, startAzimuth: Number(startAzimuth), elevation: Number(elevation), distanceFactor: Number(distanceFactor), minimumDistance: Number(minimumDistance), maxExtraViews: extraLimit, orbitAnchor, orbitRadius },
      target: null,
      views: [],
      decision: analyze === true ? 'pending' : 'not-analyzed',
    };
    this.cancelRoute = false;
    this.memory.inspectionRuns.push(run);
    this.memory.inspectionRuns = this.memory.inspectionRuns.slice(-30);
    this.state.inspection = { id: run.id, status: 'running', target: run.requested, completed: 0, total: viewCount };
    this.saveMemory();
    let initialObserver = null;
    try {
      await this.execute({ type: 'simulation.pause', payload: { paused: true } });
      initialObserver = (await this.observe({ visual: false })).observer;
      const inspection = await this.execute({ type: 'world.inspectObject', payload: { id, name, semantic, visible: false } });
      run.target = inspection.result;
      this.state.inspection.target = inspection.result.object;
      const bounds = inspection.result.bounds;
      const runwayLike = inspection.result.object.semantic === 'airport' && bounds &&
        Math.max(bounds.size[0], bounds.size[2]) / Math.max(1, Math.min(bounds.size[0], bounds.size[2])) > 10;
      const orbitDistanceFactor = runwayLike ? Math.min(Number(distanceFactor), 1.2) : distanceFactor;
      const width = this.dispatcher.dispatcher.inputs.rgb.width;
      const height = this.dispatcher.dispatcher.inputs.rgb.height;
      const plannedViews = Array.from({ length: viewCount }, (_, index) => ({
        azimuth: Number(startAzimuth) + index * Math.PI * 2 / viewCount,
        elevation: Number(elevation),
        reason: 'scheduled',
        parentView: null,
        rootView: index,
      }));
      let extraViews = 0;
      for (let cursor = 0; cursor < plannedViews.length; cursor++) {
        if (this.cancelRoute) { run.status = 'cancelled'; break; }
        const plan = plannedViews[cursor];
        const index = run.views.length;
        const orbit = orbitAnchor
          ? await this.execute({
            type: 'observer.set',
            payload: {
              position: [
                orbitAnchor[0] + Math.cos(plan.azimuth) * orbitRadius,
                orbitAnchor[1] + Math.max(0.1, plan.elevation) * orbitRadius,
                orbitAnchor[2] + Math.sin(plan.azimuth) * orbitRadius,
              ],
              target: orbitAnchor, fov: 58,
            },
          })
          : await this.execute({
            type: 'observer.orbitObject',
            payload: { id: inspection.result.object.id, azimuth: plan.azimuth, elevation: plan.elevation, distanceFactor: orbitDistanceFactor, minimumDistance },
          });
        const observation = await this.observe({ visual: true, sensors: ['rgb', 'depth', 'normal', 'objectId'], width, height, quality: 0.72 });
        const identification = await this.execute({ type: 'world.identifyPixel', payload: { x: Math.floor(width / 2), y: Math.floor(height / 2), width, height } });
        const entry = {
          index,
          reason: plan.reason,
          parentView: plan.parentView,
          rootView: plan.rootView,
          azimuth: Number(plan.azimuth.toFixed(6)),
          elevation: Number(plan.elevation.toFixed(6)),
          observer: orbitAnchor ? orbit.result : orbit.result.observer,
          center: identification.result.hit,
          observation: summarizeObservation(observation),
        };
        if (analyze === true) {
          entry.modelInspection = await this.dispatcher.analyze(observation, {
            observationId: `${run.id}:view-${index + 1}`,
            inspection: run.id,
            view: index + 1,
            reason: plan.reason,
            expected: [inspection.result.object.semantic],
            center: identification.result.hit,
          });
        }
        run.views.push(entry);
        if (entry.modelInspection?.finding?.decision === 'reinspect' && extraViews < extraLimit) {
          const direction = extraViews % 2 === 0 ? 1 : -1;
          const ring = Math.floor(extraViews / 2) + 1;
          plannedViews.push({
            azimuth: plan.azimuth + direction * ring * Math.PI / viewCount * 0.5,
            elevation: Math.max(-0.2, Math.min(1, plan.elevation + 0.12 * ring)),
            reason: 'reinspect-follow-up',
            parentView: index,
            rootView: plan.rootView,
          });
          extraViews++;
          this.state.inspection.total = plannedViews.length;
        }
        this.state.inspection.completed = run.views.length;
        this.saveMemory();
      }
      if (run.status === 'running') {
        run.status = 'complete';
        if (analyze === true) {
          const roots = run.views.filter(view => view.reason === 'scheduled');
          const finalByRoot = roots.map(root => {
            const chain = run.views.filter(view => view.rootView === root.rootView);
            return { root: root.rootView, decision: chain.at(-1)?.modelInspection?.finding?.decision ?? 'reinspect' };
          });
          run.dispatchedRoots = finalByRoot.filter(item => item.decision === 'dispatch-to-codex').map(item => item.root);
          run.unresolvedRoots = finalByRoot.filter(item => item.decision === 'reinspect').map(item => item.root);
          run.decision = run.dispatchedRoots.length ? 'dispatch-to-codex' : run.unresolvedRoots.length ? 'reinspect' : 'pass';
        }
      }
    } catch (error) {
      run.status = 'failed';
      run.error = error.message;
      this.state.errors.push({ at: now(), type: 'inspection', message: error.message });
      throw error;
    } finally {
      if (initialObserver) {
        await this.execute({ type: 'observer.set', payload: initialObserver }).catch(error => this.state.errors.push({ at: now(), type: 'inspection-restore', message: error.message }));
        await this.observe({ visual: false }).catch(error => this.state.errors.push({ at: now(), type: 'inspection-checkpoint', message: error.message }));
      }
      run.completedAt = now();
      this.state.inspection.status = run.status;
      this.saveMemory();
    }
    if (createCycle !== false && run.status === 'complete' && analyze === true && run.decision !== 'pass') this.createDevelopmentCycle(run);
    return run;
  }

  async runRoute(name, { recheck = false, analyze = false } = {}) {
    if (this.missionPromise) throw new Error('A mission is already running');
    if (this.state.route?.status === 'running') throw new Error('Another route is already running');
    if (this.state.inspection?.status === 'running') throw new Error('An object inspection is already running');
    const definition = this.routeDefinition(name);
    if (!Array.isArray(definition.waypoints)) throw new Error(`Route ${name} is a flight mission; use /mission/start`);
    const baseline = recheck ? [...this.memory.routeRuns].reverse().find(run => run.name === name && run.status === 'complete') : null;
    const run = { id: crypto.randomUUID(), name, title: definition.title, recheck, analyze, baselineId: baseline?.id ?? null, startedAt: now(), completedAt: null, status: 'running', waypoints: [], comparison: [] };
    this.memory.routeRuns.push(run);
    this.memory.routeRuns = this.memory.routeRuns.slice(-50);
    this.state.route = { id: run.id, name, status: 'running', waypoint: null, completed: 0, total: definition.waypoints.length };
    this.cancelRoute = false;
    this.saveMemory();
    try {
      await this.execute({ type: 'simulation.pause', payload: { paused: true } });
      for (const waypoint of definition.waypoints) {
        if (this.cancelRoute) { run.status = 'cancelled'; break; }
        this.state.route.waypoint = waypoint.id;
        await this.execute({ type: 'observer.set', payload: { position: waypoint.position, target: waypoint.target, fov: waypoint.fov ?? 58 } });
        await this.execute({ type: 'environment.set', payload: { ...waypoint.environment, cycle: false, autoWeather: false, immediate: true } });
        const width = analyze ? this.dispatcher.dispatcher.inputs.rgb.width : 320;
        const height = analyze ? this.dispatcher.dispatcher.inputs.rgb.height : 180;
        const observation = await this.observe({ visual: true, sensors: ['rgb', 'depth', 'normal', 'objectId'], width, height, quality: analyze ? 0.72 : 0.65 });
        const identification = await this.execute({ type: 'world.identifyPixel', payload: { x: Math.floor(width / 2), y: Math.floor(height / 2), width, height } });
        const semanticCounts = {};
        for (const object of observation.nearby) semanticCounts[object.semantic] = (semanticCounts[object.semantic] ?? 0) + 1;
        const entry = { id: waypoint.id, expected: waypoint.expected, semanticCounts, center: identification.result.hit, observation: summarizeObservation(observation) };
        if (analyze) {
          entry.modelInspection = await this.dispatcher.analyze(observation, {
            observationId: `${run.id}:${waypoint.id}`,
            route: name,
            waypoint: waypoint.id,
            expected: waypoint.expected,
            center: identification.result.hit,
          });
        }
        run.waypoints.push(entry);
        if (baseline) {
          const before = baseline.waypoints.find(item => item.id === waypoint.id);
          run.comparison.push({
            id: waypoint.id,
            baselineFound: Boolean(before),
            centerSemanticChanged: before ? before.center?.object?.semantic !== entry.center?.object?.semantic : null,
            centerModuleChanged: before ? before.center?.object?.module !== entry.center?.object?.module : null,
            rgbMeanDelta: before ? Number((entry.observation.sensors.rgb.meanLuminance - before.observation.sensors.rgb.meanLuminance).toFixed(2)) : null,
            depthMeanDelta: before ? Number((entry.observation.sensors.depth.meanLuminance - before.observation.sensors.depth.meanLuminance).toFixed(2)) : null,
          });
        }
        this.state.route.completed = run.waypoints.length;
        this.saveMemory();
      }
      if (run.status === 'running') run.status = 'complete';
    } catch (error) {
      run.status = 'failed';
      run.error = error.message;
      this.state.errors.push({ at: now(), type: 'route', message: error.message });
      throw error;
    } finally {
      run.completedAt = now();
      this.state.route.status = run.status;
      this.saveMemory();
    }
    return run;
  }

  async handleRequest(request, response) {
    const url = new URL(request.url, this.state.api ?? `http://${this.options.host}`);
    if (request.method === 'GET' && url.pathname === '/health') return json(response, 200, { ok: this.state.status === 'ready', status: this.state.status, protocol: this.state.capabilities?.protocol ?? null });
    if (request.method === 'GET' && url.pathname === '/state') return json(response, 200, this.state);
    if (request.method === 'GET' && url.pathname === '/memory') return json(response, 200, this.memory);
    if (request.method === 'GET' && url.pathname === '/cycles') return json(response, 200, { cycles: this.memory.developmentCycles });
    if (request.method === 'GET' && url.pathname === '/missions') return json(response, 200, { missions: this.memory.missions });
    if (request.method === 'GET' && url.pathname === '/model') return json(response, 200, await this.dispatcher.status());
    if (request.method === 'POST' && url.pathname === '/command') return json(response, 200, await this.execute(await readBody(request)));
    if (request.method === 'POST' && url.pathname === '/observe') return json(response, 200, await this.observe(await readBody(request)));
    if (request.method === 'POST' && url.pathname === '/model/analyze') return json(response, 200, await this.inspectWithModel(await readBody(request)));
    if (request.method === 'POST' && url.pathname === '/mission/start') {
      const mission = this.createMission(await readBody(request));
      return json(response, 202, { ok: true, id: mission.id, status: mission.status, plan: mission.plan });
    }
    if (request.method === 'POST' && url.pathname === '/mission/resume') {
      const mission = this.resumeMission((await readBody(request)).id);
      return json(response, 202, { ok: true, id: mission.id, status: mission.status });
    }
    if (request.method === 'POST' && url.pathname === '/mission/stop') {
      const mission = this.stopMission((await readBody(request)).id);
      return json(response, 200, { ok: true, id: mission.id, status: mission.status });
    }
    if (request.method === 'POST' && url.pathname === '/cycle/review') return json(response, 200, this.reviewDevelopmentCycle(await readBody(request)));
    if (request.method === 'POST' && url.pathname === '/cycle/fix') return json(response, 200, this.recordDevelopmentFix(await readBody(request)));
    if (request.method === 'POST' && url.pathname === '/cycle/recheck') {
      const body = await readBody(request);
      const cycle = this.developmentCycle(body.id);
      if (!['fix-recorded', 'reinspection-requested'].includes(cycle.status)) throw new Error(`Cycle cannot be rechecked from status: ${cycle.status}`);
      const promise = this.recheckDevelopmentCycle(body.id);
      promise.catch(() => {});
      return json(response, 202, { ok: true, id: body.id, status: 'verifying' });
    }
    if (request.method === 'POST' && url.pathname === '/inspection/start') {
      const body = await readBody(request);
      const promise = this.inspectObjectTour(body);
      promise.catch(() => {});
      return json(response, 202, { ok: true, requested: { id: body.id ?? null, name: body.name ?? null, semantic: body.semantic ?? null }, views: Math.max(3, Math.min(8, Math.floor(Number(body.views) || 4))), maxExtraViews: Math.max(0, Math.min(4, Math.floor(Number(body.maxExtraViews ?? 2)))), analyze: body.analyze !== false });
    }
    if (request.method === 'POST' && (url.pathname === '/route/start' || url.pathname === '/route/recheck')) {
      const body = await readBody(request);
      const promise = this.runRoute(body.name, { recheck: url.pathname.endsWith('recheck'), analyze: body.analyze === true });
      promise.catch(() => {});
      return json(response, 202, { ok: true, route: body.name, recheck: url.pathname.endsWith('recheck'), analyze: body.analyze === true });
    }
    if (request.method === 'POST' && (url.pathname === '/route/stop' || url.pathname === '/inspection/stop')) { this.cancelRoute = true; return json(response, 200, { ok: true }); }
    return json(response, 404, { ok: false, error: 'Not found' });
  }

  async stop() {
    this.stopping = true;
    this.cancelRoute = true;
    if (this.api) await new Promise(resolve => this.api.close(resolve));
    if (this.browser) await this.browser.close();
    if (this.sceneServer && this.sceneServer.exitCode === null) this.sceneServer.kill();
    this.state.status = 'stopped';
  }
}

module.exports = { FlightAgentController, summarizeObservation };

if (require.main === module) {
  const visible = process.argv.includes('--visible');
  const portArgument = process.argv.find(value => value.startsWith('--port='));
  const controller = new FlightAgentController({ headless: !visible, port: portArgument ? Number(portArgument.split('=')[1]) : defaults.port });
  const shutdown = async () => { await controller.stop(); process.exit(0); };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  controller.start().then(state => {
    console.log(`Flight World Agent Controller: ${state.api}`);
    console.log(`Scene: ${state.scene}`);
    console.log('POST /route/start {"name":"oceania-inspection"}');
  }).catch(error => { console.error(error); process.exit(1); });
}
