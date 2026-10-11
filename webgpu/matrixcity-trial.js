import * as THREE from './vendor/three.module.js';
import { PLYLoader } from './node_modules/three/examples/jsm/loaders/PLYLoader.js';

// Local, non-distributable geometry trial. MatrixCity uses metres with Z up.
// The pair of meshes shares one transform, so visual depth and collision agree.
const ASSET_ROOT = '../data/matrixcity/geometry/block_3_roi/';
const ORIGIN = new THREE.Vector3(-1940, 12, -2460);

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

  const visual = new THREE.Mesh(surface, new THREE.MeshStandardMaterial({ color: '#b8bfc2', roughness: .9, side: THREE.DoubleSide }));
  visual.name = 'MatrixCity depth-derived visible surfaces';
  visual.userData.agent = { semantic: 'building', module: 'matrixcity-trial.js', source: 'MatrixCity aerial block_3' };
  visual.receiveShadow = true;
  group.add(visual);

  const collision = new THREE.Mesh(collider, new THREE.MeshBasicMaterial({ visible: false, colorWrite: false, depthWrite: false }));
  collision.name = 'matrixcity-building-001';
  collision.userData.agent = { semantic: 'building', module: 'matrixcity-trial.js', stableId: 'matrixcity-building-001', role: 'collision-proxy' };
  collision.visible = false;
  group.add(collision);

  group.visible = false;
  return { group, visual, collision, origin: ORIGIN.toArray() };
}
