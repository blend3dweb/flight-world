import * as THREE from 'three/webgpu';
import { vec4, sRGBTransferEOTF } from 'three/tsl';
import { GaussianSplat } from './node_modules/three/examples/jsm/objects/GaussianSplat.js';
import { loadGaussianPLY } from './gaussian-ply-fast.js';
import { OrbitControls } from './node_modules/three/examples/jsm/controls/OrbitControls.js';

const status = document.querySelector('#status');
const params = new URLSearchParams(location.search);
let renderer, splat, metadata, controls, rawColor, correctedColor;
let corrected = params.get('color') !== 'raw';
let zUp = params.get('up') === 'z';
const scene = new THREE.Scene();
scene.background = new THREE.Color('#142832');
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, .001, 10000);
const group = new THREE.Group();scene.add(group);
const errors = [];
function showError(error) {
  console.error(error);errors.push(String(error));
  status.textContent = `Ошибка: ${error.message ?? error}. Откройте этот адрес в Chrome или Edge.`;
}
function setColor(value) {
  corrected = Boolean(value);
  if (splat) { splat.material.colorNode = corrected ? correctedColor : rawColor;splat.material.needsUpdate = true; }
  document.querySelector('#color').textContent = corrected ? 'Цвет sRGB · сравнить прежний' : 'Прежний цвет · вернуть sRGB';
  document.querySelector('#color').setAttribute('aria-pressed', String(corrected));
}
function home() {
  camera.up.set(0, 1, 0);
  document.querySelector('#axis').textContent = `Вверх: ${zUp ? 'Z' : 'Y'}`;
  const box = new THREE.Box3(new THREE.Vector3(...metadata.bounds[0]), new THREE.Vector3(...metadata.bounds[1]));
  group.updateMatrixWorld(true);box.applyMatrix4(group.matrixWorld);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const radius = size.length() * .5;
  controls.target.copy(center);
  camera.position.copy(center).add(new THREE.Vector3(1, .65, 1).normalize().multiplyScalar(radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2))));
  camera.near = Math.max(radius / 10000, .0001);camera.far = radius * 100;
  camera.updateProjectionMatrix();controls.minDistance = radius / 1000;controls.maxDistance = radius * 20;controls.update();
}
function groundView() {
  group.rotation.x = 0;zUp = false;document.querySelector('#axis').textContent = 'Вверх: −Y';
  camera.up.set(0, -1, 0);camera.position.set(0, 0, 0);controls.target.set(0, 0, 3);controls.update();
}
function focusBuilding() {
  group.rotation.x = 0;zUp = false;document.querySelector('#axis').textContent = 'Вверх: −Y';
  camera.up.set(0, -1, 0);camera.position.set(3, -2, -5);controls.target.set(0, .6, .5);controls.update();
}
function setAxis(value) {
  zUp = Boolean(value);group.rotation.x = zUp ? -Math.PI / 2 : 0;
  document.querySelector('#axis').textContent = `Вверх: ${zUp ? 'Z' : 'Y'}`;
  home();
}
try {
  renderer = new THREE.WebGPURenderer({ antialias: true, powerPreference: 'high-performance' });
  await renderer.init();
  if (!renderer.backend.isWebGPUBackend) throw new Error('WebGPU недоступен');
  renderer.setPixelRatio(1);renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;renderer.toneMapping = THREE.NoToneMapping;
  document.body.prepend(renderer.domElement);
  controls = new OrbitControls(camera, renderer.domElement);controls.enableDamping = false;
  const response = await fetch('../data/mgu/metadata.json');
  if (!response.ok) throw new Error('Локальные данные МГУ не подготовлены');
  metadata = await response.json();
  const requested = Number(params.get('density') || 3000000);
  const level = metadata.levels.find(item => item.count === requested);
  if (!level) throw new Error('Неизвестная плотность сплатов');
  document.querySelector('#density').value = String(level.count);
  status.textContent = `Загрузка ${level.count.toLocaleString('ru')} сплатов…`;
  const geometry = await loadGaussianPLY(`../data/mgu/${level.file}`, event => {
    status.textContent = `Загрузка: ${(event.loaded / 1000000).toFixed(1)} / ${(level.bytes / 1000000).toFixed(1)} МБ`;
  }, progress => {status.textContent = `Подготовка GPU: ${Math.round(progress * 100)}%`;});
  splat = new GaussianSplat(geometry);group.add(splat);
  rawColor = splat.material.colorNode;correctedColor = vec4(sRGBTransferEOTF(rawColor.rgb), rawColor.a);
  setColor(corrected);setAxis(zUp);
  document.querySelector('#home').onclick = home;
  const groundButton = document.createElement('button');groundButton.textContent = 'Из центра модели';
  groundButton.onclick = groundView;document.querySelector('#home').after(groundButton);
  const focusButton = document.createElement('button');focusButton.textContent = 'К центральному зданию';
  focusButton.onclick = focusBuilding;groundButton.after(focusButton);
  if (!params.has('up')) focusBuilding();
  document.querySelector('#axis').onclick = () => setAxis(!zUp);
  document.querySelector('#color').onclick = () => setColor(!corrected);
  document.querySelector('#density').onchange = event => {
    const url = new URL(location.href);url.searchParams.set('density', event.target.value);
    url.searchParams.set('up', zUp ? 'z' : 'y');url.searchParams.set('color', corrected ? 'srgb' : 'raw');location.href = url;
  };
  status.textContent = `${level.count.toLocaleString('ru')} сплатов · SH3 · отдельный Gaussian-слой`;
  let frames = 0, start = performance.now(), fps = 0;
  renderer.setAnimationLoop(() => {
    controls.update();renderer.render(scene, camera);frames++;
    const now = performance.now();
    if (now - start >= 1000) {fps = frames * 1000 / (now - start);document.querySelector('#fps').textContent = `FPS ${fps.toFixed(1)} · ${innerWidth}×${innerHeight}`;frames = 0;start = now;}
  });
  window.addEventListener('resize', () => {camera.aspect = innerWidth / innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth, innerHeight);});
  window.mgu = { getState: () => ({ count: geometry.attributes.position.count, sh3: geometry.hasAttribute('sphericalHarmonics3'), corrected, zUp, fps, errors }), setColor, setAxis, home, groundView, focusBuilding, scene, camera, renderer, controls, splat };
} catch (error) {showError(error);}
