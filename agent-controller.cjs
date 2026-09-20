const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const { chromium } = require('C:/Users/sva/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

const root = __dirname;
const defaults = {
  origin: 'http://127.0.0.1:8765',
  host: '127.0.0.1',
  port: 8766,
  headless: true,
  routeFile: path.join(root, 'agent-routes.json'),
  memoryFile: path.join(root, 'tmp', 'agent-bridge', 'memory.json'),
};

function now() { return new Date().toISOString(); }
function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
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
    this.cancelRoute = false;
    this.state = { status: 'created', startedAt: null, api: null, scene: this.options.origin, route: null, errors: [] };
    this.routes = JSON.parse(fs.readFileSync(this.options.routeFile, 'utf8'));
    this.memory = this.loadMemory();
  }

  loadMemory() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.options.memoryFile, 'utf8'));
      if (parsed.version === 1 && Array.isArray(parsed.routeRuns)) return parsed;
    } catch {}
    return { version: 1, updatedAt: null, sessions: [], routeRuns: [] };
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

  async start() {
    if (this.state.status !== 'created' && this.state.status !== 'stopped') return this.state;
    this.state.status = 'starting';
    await this.ensureSceneServer();
    this.browser = await chromium.launch({
      channel: 'chrome',
      headless: this.options.headless,
      args: ['--force-high-performance-gpu', '--use-webgpu-power-preference=high-performance'],
    });
    this.page = await this.browser.newPage({ viewport: { width: 1280, height: 720 } });
    this.page.on('pageerror', error => this.state.errors.push({ at: now(), type: 'pageerror', message: error.message }));
    this.page.on('console', message => { if (message.type() === 'error') this.state.errors.push({ at: now(), type: 'console', message: message.text() }); });
    await this.page.goto(`${this.options.origin}/webgpu/index.html?test=1`);
    await this.page.waitForFunction(() => window.flightReady && window.flight?.agent, null, { timeout: 120000 });
    const capabilities = await this.page.evaluate(() => window.flight.agent.capabilities());
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
    return this.enqueue(() => this.page.evaluate(commandValue => window.flight.agent.dispatch(commandValue), command));
  }

  observe(payload = {}) {
    return this.enqueue(() => this.page.evaluate(payloadValue => window.flight.agent.observe(payloadValue), payload));
  }

  routeDefinition(name) {
    const route = this.routes.routes?.[name];
    if (!route) throw new Error(`Unknown route: ${name}`);
    return route;
  }

  async runRoute(name, { recheck = false } = {}) {
    if (this.state.route?.status === 'running') throw new Error('Another route is already running');
    const definition = this.routeDefinition(name);
    const baseline = recheck ? [...this.memory.routeRuns].reverse().find(run => run.name === name && run.status === 'complete') : null;
    const run = { id: crypto.randomUUID(), name, title: definition.title, recheck, baselineId: baseline?.id ?? null, startedAt: now(), completedAt: null, status: 'running', waypoints: [], comparison: [] };
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
        const observation = await this.observe({ visual: true, sensors: ['rgb', 'depth', 'normal', 'objectId'], width: 320, height: 180, quality: 0.65 });
        const identification = await this.execute({ type: 'world.identifyPixel', payload: { x: 160, y: 90, width: 320, height: 180 } });
        const semanticCounts = {};
        for (const object of observation.nearby) semanticCounts[object.semantic] = (semanticCounts[object.semantic] ?? 0) + 1;
        const entry = { id: waypoint.id, expected: waypoint.expected, semanticCounts, center: identification.result.hit, observation: summarizeObservation(observation) };
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
    if (request.method === 'POST' && url.pathname === '/command') return json(response, 200, await this.execute(await readBody(request)));
    if (request.method === 'POST' && url.pathname === '/observe') return json(response, 200, await this.observe(await readBody(request)));
    if (request.method === 'POST' && (url.pathname === '/route/start' || url.pathname === '/route/recheck')) {
      const body = await readBody(request);
      const promise = this.runRoute(body.name, { recheck: url.pathname.endsWith('recheck') });
      promise.catch(() => {});
      return json(response, 202, { ok: true, route: body.name, recheck: url.pathname.endsWith('recheck') });
    }
    if (request.method === 'POST' && url.pathname === '/route/stop') { this.cancelRoute = true; return json(response, 200, { ok: true }); }
    return json(response, 404, { ok: false, error: 'Not found' });
  }

  async stop() {
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
