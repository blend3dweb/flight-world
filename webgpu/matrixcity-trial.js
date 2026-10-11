import * as THREE from './vendor/three.module.js';
import { PLYLoader } from './node_modules/three/examples/jsm/loaders/PLYLoader.js';
import { GaussianSplatPLYLoader } from './node_modules/three/examples/jsm/loaders/GaussianSplatPLYLoader.js';
import { GaussianSplat } from './node_modules/three/examples/jsm/objects/GaussianSplat.js';

// Local, non-distributable geometry trial. MatrixCity uses metres with Z up.
// The pair of meshes shares one transform, so visual depth and collision agree.
const ASSET_ROOT = '../data/matrixcity/geometry/block_3_roi/';
// Center the 120 m source sector over Oceania's replaceable block #12.
const ORIGIN = new THREE.Vector3(-2028, 12, -2669);

export async function createMatrixCityTrial() {
  const loader = new PLYLoader();
  const [surface, collider] = await Promise.all([
    loader.loadAsync(`${ASSET_ROOT}visible_surfaces_source.ply`),
    loader.loadAsync(`${ASSET_ROOT}matrixcity-building-001-collider.ply`),
  ]);
  if (!surface.index || !collider.index) throw new Error('MatrixCity PLY meshes require triangle faces');
  for (const geometry of [surface, collider]) {
    for (const name of ['position', 'normal']) {
      const attribute = geometry.getAttribute(name);
      if (attribute && !(attribute.array instanceof Float32Array)) {
        geometry.setAttribute(name, new THREE.Float32BufferAttribute(attribute.array, attribute.itemSize, attribute.normalized));
      }
    }
  }
  const group = new THREE.Group();
  group.name = 'MatrixCity block_3 geometry trial';
  group.userData.agent = { semantic: 'city', module: 'matrixcity-trial.js' };
  group.position.copy(ORIGIN);
  group.rotation.x = -Math.PI / 2;

  const visualMaterial = new THREE.MeshStandardMaterial({ color: '#b8bfc2', roughness: .9, side: THREE.DoubleSide });
  // The local hybrid writes the source mesh depth before transparent splats.
  const depthMaterial = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true, side: THREE.DoubleSide });
  const visual = new THREE.Mesh(surface, visualMaterial);
  visual.name = 'MatrixCity depth-derived visible surfaces';
  visual.userData.agent = { semantic: 'building', module: 'matrixcity-trial.js', stableId: 'matrixcity-sector-surface', source: 'MatrixCity aerial block_3' };
  visual.receiveShadow = true;
  group.add(visual);

  const collision = new THREE.Mesh(collider, new THREE.MeshBasicMaterial({ visible: false, colorWrite: false, depthWrite: false }));
  collision.name = 'matrixcity-building-001';
  collision.userData.agent = { semantic: 'building', module: 'matrixcity-trial.js', stableId: 'matrixcity-building-001', role: 'collision-proxy' };
  collision.visible = false;
  group.add(collision);

  group.visible = false;
  return { group, visual, visualMaterial, depthMaterial, collision, splat: null, origin: ORIGIN.toArray() };
}

export async function addMatrixCitySplats(trial) {
  const [geometry, metadata] = await Promise.all([
    new GaussianSplatPLYLoader().loadAsync(`${ASSET_ROOT}splats_roi_sh0_30k.ply`),
    fetch(`${ASSET_ROOT}alignment_metadata.json`).then(response => {
      if (!response.ok) throw new Error(`MatrixCity alignment HTTP ${response.status}`);
      return response.json();
    }),
  ]);
  const rows = metadata.dataparser_transform;
  const s = metadata.dataparser_scale;
  if (!Array.isArray(rows) || rows.length !== 3 || !Number.isFinite(s) || s <= 0) throw new Error('Invalid MatrixCity alignment');
  const t = new THREE.Vector3(rows[0][3], rows[1][3], rows[2][3]);
  const inverse = new THREE.Matrix4().set(
    rows[0][0] / s, rows[1][0] / s, rows[2][0] / s, 0,
    rows[0][1] / s, rows[1][1] / s, rows[2][1] / s, 0,
    rows[0][2] / s, rows[1][2] / s, rows[2][2] / s, 0,
    0, 0, 0, 1,
  );
  t.applyMatrix4(new THREE.Matrix4().set(
    rows[0][0], rows[1][0], rows[2][0], 0,
    rows[0][1], rows[1][1], rows[2][1], 0,
    rows[0][2], rows[1][2], rows[2][2], 0,
    0, 0, 0, 1,
  )).negate();
  inverse.setPosition(t);
  const splat = new GaussianSplat(geometry);
  splat.name = 'MatrixCity cropped Gaussian appearance';
  splat.userData.agent = { semantic: 'building', module: 'matrixcity-trial.js', source: 'MatrixCity Splatfacto SH0 30k' };
  splat.applyMatrix4(inverse);
  splat.visible = false;
  trial.group.add(splat);
  trial.splat = splat;
  return splat;
}
