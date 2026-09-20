import * as THREE from './vendor/three.module.js';

const PROTOCOL_VERSION = '0.1.0';
const MAX_QUERY_RESULTS = 100;
const frameVector = new THREE.Vector3();

const semanticRules = [
  ['aircraft', /aircraft|aero 042|propeller|wing|fuselage|cockpit|float/i, 'aircraft.js'],
  ['ocean', /\bocean\b|water|\bsea\b|wake/i, 'ocean.js'],
  ['bridge', /bridge/i, 'city.js'],
  ['airport', /airport|runway|terminal|gate|hangar|taxiway/i, 'city.js'],
  ['road', /road|street|junction|crossing|lane|asphalt/i, 'city.js'],
  ['vegetation', /forest|tree|grass|shrub|palm|foliage|planter/i, 'vegetation.js'],
  ['building', /building|tower|residence|facade|roof|podium|pavilion|balcon|storefront/i, 'city.js'],
  ['city', /city|oceania|harbour|bench|lamp|vehicle|people|bollard|bus stop|bike rack/i, 'city.js'],
  ['terrain', /island|terrain|ground|shore|beach/i, 'flight.js'],
  ['atmosphere', /sky|cloud|moon|sun|rain|snow|precipitation/i, 'atmosphere.js'],
];

function round(value, digits = 3) {
  const power = 10 ** digits;
  return Math.round(value * power) / power;
}

function vector(value) {
  return [round(value.x), round(value.y), round(value.z)];
}

function objectLabel(object) {
  const names = [];
  let current = object;
  while (current) {
    if (current.name) names.push(current.name);
    current = current.parent;
  }
  return names.join(' / ');
}

function classify(object) {
  const explicit = object.userData?.agent;
  if (explicit?.semantic) return { semantic: explicit.semantic, module: explicit.module ?? null };
  const label = objectLabel(object);
  for (const [semantic, expression, module] of semanticRules) {
    if (expression.test(label)) return { semantic, module };
  }
  return { semantic: object.isLight ? 'light' : object.isCamera ? 'camera' : 'world', module: null };
}

function finiteVector(value, label) {
  if (!Array.isArray(value) || value.length !== 3 || value.some(item => !Number.isFinite(item))) {
    throw new TypeError(`${label} must contain three finite numbers`);
  }
  return value;
}

export function createAgentBridge({
  scene,
  renderer,
  getWorldState,
  setEnvironment,
  startFlight,
  setQuality,
  setPaused,
  stepSimulation,
  captureObservation,
}) {
  const observer = new THREE.PerspectiveCamera(60, 16 / 9, 0.2, 60000);
  observer.name = 'Agent observer';
  observer.position.set(-1450, 520, -420);
  const observerTarget = new THREE.Vector3(-2000, 80, -1900);
  observer.lookAt(observerTarget);
  observer.updateMatrixWorld(true);

  const ids = new WeakMap();
  const objects = new Map();
  let nextId = 1;
  const timings = [];
  let commandCount = 0;
  let observationCount = 0;
  let lastCommand = null;

  function idFor(object) {
    if (!ids.has(object)) {
      const id = nextId++;
      ids.set(object, id);
      objects.set(id, object);
    }
    return ids.get(object);
  }

  function describe(object) {
    object.getWorldPosition(frameVector);
    const classification = classify(object);
    return {
      id: idFor(object),
      uuid: object.uuid,
      name: object.name || object.type,
      type: object.type,
      semantic: classification.semantic,
      module: classification.module,
      visible: object.visible,
      position: vector(frameVector),
      instances: object.isInstancedMesh ? object.count : undefined,
      vertices: object.geometry?.attributes?.position?.count,
    };
  }

  function catalog() {
    const result = [];
    scene.traverse(object => {
      if (object === observer || (!object.name && !object.isMesh && !object.isLight)) return;
      idFor(object);
      result.push(object);
    });
    return result;
  }

  function queryObjects({ semantic, name, visible = true, limit = 25 } = {}) {
    const text = typeof name === 'string' ? name.trim().toLowerCase() : '';
    const maximum = THREE.MathUtils.clamp(Math.floor(Number(limit) || 25), 1, MAX_QUERY_RESULTS);
    const matches = [];
    for (const object of catalog()) {
      if (visible && !object.visible) continue;
      const description = describe(object);
      if (semantic && description.semantic !== semantic) continue;
      if (text && !objectLabel(object).toLowerCase().includes(text)) continue;
      matches.push(description);
      if (matches.length >= maximum) break;
    }
    return matches;
  }

  function setObserver({ position, target, fov } = {}) {
    if (position) observer.position.fromArray(finiteVector(position, 'position'));
    if (target) observerTarget.fromArray(finiteVector(target, 'target'));
    if (Number.isFinite(fov)) observer.fov = THREE.MathUtils.clamp(fov, 20, 110);
    observer.lookAt(observerTarget);
    observer.updateProjectionMatrix();
    observer.updateMatrixWorld(true);
    return observerState();
  }

  function observerState() {
    return {
      position: vector(observer.position),
      target: vector(observerTarget),
      fov: round(observer.fov),
      near: observer.near,
      far: observer.far,
    };
  }

  function moveToObject({ id, name, semantic, distance = 80, elevation = 30 } = {}) {
    let object = Number.isInteger(id) ? objects.get(id) : null;
    if (!object) {
      const match = queryObjects({ name, semantic, limit: 1 })[0];
      if (match) object = objects.get(match.id);
    }
    if (!object) throw new Error('Target object was not found');
    const box = new THREE.Box3().setFromObject(object);
    const center = box.isEmpty() ? object.getWorldPosition(new THREE.Vector3()) : box.getCenter(new THREE.Vector3());
    const size = box.isEmpty() ? new THREE.Vector3(1, 1, 1) : box.getSize(new THREE.Vector3());
    const radius = Math.max(size.length() * 0.5, Number(distance) || 80);
    observerTarget.copy(center);
    observer.position.set(center.x + radius * 0.72, center.y + Math.max(Number(elevation) || 30, radius * 0.24), center.z + radius * 0.72);
    observer.lookAt(observerTarget);
    observer.updateMatrixWorld(true);
    return { object: describe(object), observer: observerState() };
  }

  function raycast({ ndc = [0, 0], origin, direction, limit = 8 } = {}) {
    const raycaster = new THREE.Raycaster();
    if (origin || direction) {
      const start = new THREE.Vector3().fromArray(finiteVector(origin, 'origin'));
      const heading = new THREE.Vector3().fromArray(finiteVector(direction, 'direction')).normalize();
      raycaster.set(start, heading);
    } else {
      if (!Array.isArray(ndc) || ndc.length !== 2 || ndc.some(item => !Number.isFinite(item))) throw new TypeError('ndc must contain two finite numbers');
      observer.updateMatrixWorld(true);
      raycaster.setFromCamera(new THREE.Vector2(ndc[0], ndc[1]), observer);
    }
    const maximum = THREE.MathUtils.clamp(Math.floor(Number(limit) || 8), 1, 32);
    return raycaster.intersectObjects(scene.children, true).slice(0, maximum).map(hit => ({
      distance: round(hit.distance),
      point: vector(hit.point),
      instanceId: hit.instanceId,
      object: describe(hit.object),
    }));
  }

  function identifyPixel({ x, y, width, height } = {}) {
    if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) throw new TypeError('Pixel identification requires x, y, width and height');
    const ndc = [x / width * 2 - 1, 1 - y / height * 2];
    const hit = raycast({ ndc, limit: 1 })[0] ?? null;
    return { pixel: [x, y], viewport: [width, height], ndc: ndc.map(value => round(value)), hit };
  }

  function telemetry() {
    const ordered = timings.slice().sort((a, b) => a - b);
    const average = ordered.length ? ordered.reduce((sum, value) => sum + value, 0) / ordered.length : 0;
    const percentile95 = ordered.length ? ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * 0.95))] : 0;
    const info = renderer.info;
    return {
      cpuSubmitMs: { average: round(average), p95: round(percentile95), samples: ordered.length },
      renderer: {
        calls: info.render?.calls ?? 0,
        triangles: info.render?.triangles ?? 0,
        points: info.render?.points ?? 0,
        lines: info.render?.lines ?? 0,
        geometries: info.memory?.geometries ?? null,
        textures: info.memory?.textures ?? null,
      },
      adapter: renderer.backend?.device?.adapterInfo ?? null,
      gpuTimingAvailable: false,
      commandCount,
      observationCount,
    };
  }

  function reportFrame(cpuSubmitMs) {
    if (!Number.isFinite(cpuSubmitMs)) return;
    timings.push(cpuSubmitMs);
    if (timings.length > 180) timings.shift();
  }

  async function observe({ visual = false, sensors, width = 512, height = 288, quality = 0.72 } = {}) {
    observationCount++;
    const world = getWorldState();
    const response = {
      protocol: PROTOCOL_VERSION,
      timestamp: new Date().toISOString(),
      observer: observerState(),
      world,
      telemetry: telemetry(),
      nearby: queryObjects({ limit: 20 }),
    };
    if (visual || Array.isArray(sensors)) response.visual = await captureObservation(observer, { width, height, quality, sensors }, idFor);
    return response;
  }

  async function dispatch(command) {
    if (!command || typeof command !== 'object' || typeof command.type !== 'string') throw new TypeError('Command requires a type');
    commandCount++;
    lastCommand = { id: command.id ?? null, type: command.type, at: new Date().toISOString() };
    const payload = command.payload ?? {};
    let result;
    switch (command.type) {
      case 'ping': result = capabilities(); break;
      case 'observe': result = await observe(payload); break;
      case 'observer.set': result = setObserver(payload); break;
      case 'observer.moveToObject': result = moveToObject(payload); break;
      case 'world.query': result = queryObjects(payload); break;
      case 'world.raycast': result = raycast(payload); break;
      case 'world.identifyPixel': result = identifyPixel(payload); break;
      case 'environment.set': setEnvironment(payload, { immediate: payload.immediate !== false }); result = getWorldState().environment; break;
      case 'flight.start': startFlight(payload.location); result = getWorldState(); break;
      case 'quality.set': setQuality(payload.quality); result = getWorldState().quality; break;
      case 'simulation.pause': setPaused(payload.paused !== false); result = getWorldState().paused; break;
      case 'simulation.step': stepSimulation(THREE.MathUtils.clamp(Number(payload.seconds) || 1 / 30, 1 / 240, 2)); result = getWorldState(); break;
      default: throw new Error(`Unsupported Agent Bridge command: ${command.type}`);
    }
    return { id: command.id ?? null, ok: true, type: command.type, result };
  }

  function capabilities() {
    return {
      name: 'Flight World Agent Bridge',
      protocol: PROTOCOL_VERSION,
      transport: 'same-page JavaScript API',
      commands: ['ping', 'observe', 'observer.set', 'observer.moveToObject', 'world.query', 'world.raycast', 'world.identifyPixel', 'environment.set', 'flight.start', 'quality.set', 'simulation.pause', 'simulation.step'],
      sensors: ['rgb-framebuffer-on-demand', 'depth-buffer-on-demand', 'normal-buffer-on-demand', 'object-id-buffer-on-demand', 'semantic-object-catalog', 'raycast', 'world-state', 'renderer-telemetry'],
      plannedSensors: ['gpu-timestamps'],
      visualPersistence: 'memory-only',
    };
  }

  return { capabilities, dispatch, observe, queryObjects, raycast, identifyPixel, setObserver, moveToObject, observerState, telemetry, reportFrame, get lastCommand() { return lastCommand; } };
}
