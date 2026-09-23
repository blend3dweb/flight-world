import * as THREE from './vendor/three.module.js';

const PROTOCOL_VERSION = '0.2.0';
const MAX_QUERY_RESULTS = 100;
const frameVector = new THREE.Vector3();

const semanticRules = [
  ['aircraft', /aircraft|aero 042|\bjet\b|propeller|wing|fuselage|cockpit|float/i, 'aircraft.js'],
  ['ocean', /\bocean\b|water|\bsea\b|wake/i, 'ocean.js'],
  ['bridge', /bridge/i, 'city.js'],
  ['airport', /airport|runway|terminal|gate|hangar|taxiway/i, 'city.js'],
  ['road', /road|street|junction|crossing|lane|asphalt|sidewalk|promenade|\bpath/i, 'city.js'],
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
  let current = object;
  while (current) {
    const explicit = current.userData?.agent;
    if (explicit?.semantic) return { semantic: explicit.semantic, module: explicit.module ?? null };
    const label = current.name || '';
    for (const [semantic, expression, module] of semanticRules) {
      if (expression.test(label)) return { semantic, module };
    }
    current = current.parent;
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
  const savedObserverPoses = new Map();
  let followedObject = null;
  let followOptions = null;

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

  function boundsFor(object) {
    const box = new THREE.Box3().setFromObject(object);
    const center = box.isEmpty() ? object.getWorldPosition(new THREE.Vector3()) : box.getCenter(new THREE.Vector3());
    const size = box.isEmpty() ? new THREE.Vector3(1, 1, 1) : box.getSize(new THREE.Vector3());
    return { center, size, radius: Math.max(size.length() * 0.5, 1) };
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

  function resolveObject({ id, name, semantic, visible = false } = {}) {
    catalog();
    if (Number.isInteger(id) && objects.has(id)) return objects.get(id);
    const matches = queryObjects({ name, semantic, visible, limit: MAX_QUERY_RESULTS });
    if (!matches.length) throw new Error('Target object was not found');
    const ranked = matches.map(match => {
      const object = objects.get(match.id);
      return { object, radius: boundsFor(object).radius };
    }).sort((a, b) => b.radius - a.radius);
    return ranked[0].object;
  }

  function materialDescription(material) {
    if (!material) return null;
    return {
      name: material.name || null,
      type: material.type,
      color: material.color?.getHexString ? `#${material.color.getHexString()}` : null,
      roughness: Number.isFinite(material.roughness) ? round(material.roughness) : null,
      metalness: Number.isFinite(material.metalness) ? round(material.metalness) : null,
      opacity: Number.isFinite(material.opacity) ? round(material.opacity) : null,
      transparent: Boolean(material.transparent),
      side: material.side,
      map: material.map?.name || material.map?.source?.data?.currentSrc || null,
    };
  }

  function inspectObject(payload = {}) {
    const object = resolveObject(payload);
    const bounds = boundsFor(object);
    const materials = (Array.isArray(object.material) ? object.material : [object.material]).filter(Boolean).map(materialDescription);
    const lod = [];
    let current = object;
    while (current) {
      if (current.isLOD) lod.push({ name: current.name || current.type, levels: current.levels?.map(level => ({ distance: round(level.distance), hysteresis: round(level.hysteresis ?? 0) })) ?? [] });
      current = current.parent;
    }
    return {
      object: describe(object),
      bounds: { center: vector(bounds.center), size: vector(bounds.size), radius: round(bounds.radius) },
      hierarchy: objectLabel(object).split(' / ').filter(Boolean),
      geometry: object.geometry ? {
        type: object.geometry.type,
        vertices: object.geometry.attributes?.position?.count ?? 0,
        indices: object.geometry.index?.count ?? 0,
        instances: object.isInstancedMesh ? object.count : null,
      } : null,
      materials,
      lod,
      source: classify(object).module,
    };
  }

  function setObserver({ position, target, fov } = {}) {
    followedObject = null;
    followOptions = null;
    if (position) observer.position.fromArray(finiteVector(position, 'position'));
    if (target) observerTarget.fromArray(finiteVector(target, 'target'));
    if (Number.isFinite(fov)) observer.fov = THREE.MathUtils.clamp(fov, 20, 110);
    observer.lookAt(observerTarget);
    observer.updateProjectionMatrix();
    observer.updateMatrixWorld(true);
    return observerState();
  }

  function saveObserver({ name = 'default' } = {}) {
    const key = String(name).trim() || 'default';
    if (savedObserverPoses.size >= 20 && !savedObserverPoses.has(key)) savedObserverPoses.delete(savedObserverPoses.keys().next().value);
    savedObserverPoses.set(key, observerState());
    return { name: key, observer: observerState() };
  }

  function restoreObserver({ name = 'default' } = {}) {
    const key = String(name).trim() || 'default';
    const pose = savedObserverPoses.get(key);
    if (!pose) throw new Error(`Observer pose was not found: ${key}`);
    const restored = setObserver(pose);
    return { name: key, observer: restored };
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
    const object = resolveObject({ id, name, semantic, visible: false });
    const { center, radius: objectRadius } = boundsFor(object);
    const radius = Math.max(objectRadius, Number(distance) || 80);
    followedObject = null;
    followOptions = null;
    observerTarget.copy(center);
    observer.position.set(center.x + radius * 0.72, center.y + Math.max(Number(elevation) || 30, radius * 0.24), center.z + radius * 0.72);
    observer.lookAt(observerTarget);
    observer.updateMatrixWorld(true);
    return { object: describe(object), observer: observerState() };
  }

  function positionAroundObject(object, { azimuth = 0, elevation = 0.3, distanceFactor = 2.4, minimumDistance = 20 } = {}) {
    const bounds = boundsFor(object);
    const horizontal = Math.max(bounds.radius * THREE.MathUtils.clamp(Number(distanceFactor) || 2.4, 1.2, 8), Number(minimumDistance) || 20);
    const angle = Number.isFinite(azimuth) ? azimuth : 0;
    const pitch = THREE.MathUtils.clamp(Number(elevation) || 0.3, -0.35, 1.2);
    observerTarget.copy(bounds.center);
    observer.position.set(
      bounds.center.x + Math.cos(angle) * horizontal,
      bounds.center.y + Math.sin(pitch) * horizontal,
      bounds.center.z + Math.sin(angle) * horizontal,
    );
    observer.lookAt(observerTarget);
    observer.updateMatrixWorld(true);
    return bounds;
  }

  function orbitObject(payload = {}) {
    followedObject = null;
    followOptions = null;
    const object = resolveObject(payload);
    const bounds = positionAroundObject(object, payload);
    return { target: describe(object), bounds: { center: vector(bounds.center), size: vector(bounds.size), radius: round(bounds.radius) }, observer: observerState() };
  }

  function updateFollowedObject() {
    if (!followedObject || !followOptions) return;
    positionAroundObject(followedObject, followOptions);
  }

  function followObject(payload = {}) {
    const target = payload.semantic || payload.name || payload.id ? payload : { ...payload, semantic: 'aircraft', name: 'AERO 042' };
    followedObject = resolveObject({ ...target, visible: false });
    followOptions = {
      azimuth: Number.isFinite(payload.azimuth) ? payload.azimuth : 0.75,
      elevation: Number.isFinite(payload.elevation) ? payload.elevation : 0.28,
      distanceFactor: Number.isFinite(payload.distanceFactor) ? payload.distanceFactor : 2.8,
      minimumDistance: Number.isFinite(payload.minimumDistance) ? payload.minimumDistance : 18,
    };
    const bounds = positionAroundObject(followedObject, followOptions);
    return { following: true, target: describe(followedObject), bounds: { center: vector(bounds.center), radius: round(bounds.radius) }, observer: observerState() };
  }

  function stopFollowing() {
    const target = followedObject ? describe(followedObject) : null;
    followedObject = null;
    followOptions = null;
    return { following: false, target };
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
    updateFollowedObject();
  }

  async function observe({ visual = false, sensors, width = 512, height = 288, quality = 0.72 } = {}) {
    updateFollowedObject();
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
      case 'observer.orbitObject': result = orbitObject(payload); break;
      case 'observer.followObject': result = followObject(payload); break;
      case 'observer.stopFollowing': result = stopFollowing(); break;
      case 'observer.save': result = saveObserver(payload); break;
      case 'observer.restore': result = restoreObserver(payload); break;
      case 'world.query': result = queryObjects(payload); break;
      case 'world.inspectObject': result = inspectObject(payload); break;
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
      commands: ['ping', 'observe', 'observer.set', 'observer.moveToObject', 'observer.orbitObject', 'observer.followObject', 'observer.stopFollowing', 'observer.save', 'observer.restore', 'world.query', 'world.inspectObject', 'world.raycast', 'world.identifyPixel', 'environment.set', 'flight.start', 'quality.set', 'simulation.pause', 'simulation.step'],
      sensors: ['rgb-framebuffer-on-demand', 'depth-buffer-on-demand', 'normal-buffer-on-demand', 'object-id-buffer-on-demand', 'semantic-object-catalog', 'raycast', 'world-state', 'renderer-telemetry'],
      plannedSensors: ['gpu-timestamps'],
      visualPersistence: 'memory-only',
    };
  }

  return { capabilities, dispatch, observe, queryObjects, inspectObject, raycast, identifyPixel, setObserver, moveToObject, orbitObject, followObject, saveObserver, restoreObserver, observerState, telemetry, reportFrame, get lastCommand() { return lastCommand; } };
}
