import * as THREE from './vendor/three.module.js';
import { PLYLoader } from './node_modules/three/examples/jsm/loaders/PLYLoader.js';
import { GaussianSplatPLYLoader } from './node_modules/three/examples/jsm/loaders/GaussianSplatPLYLoader.js';
import { GaussianSplat } from './node_modules/three/examples/jsm/objects/GaussianSplat.js';

// Local, non-distributable geometry trial. MatrixCity uses metres with Z up.
// The pair of meshes shares one transform, so visual depth and collision agree.
const ASSET_ROOT = '../data/matrixcity/geometry/block_3_roi/';
// Center the 120 m source sector over Oceania's replaceable block #12.
const ORIGIN = new THREE.Vector3(-2028, 12, -2669);

export async function createMatrixCityTrial({ splatCountLabel = '30 000' } = {}) {
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

  // A local inspection aid, kept out of benchmark frames unless explicitly enabled.
  surface.computeBoundingBox();
  const bounds = surface.boundingBox;
  const x0 = bounds.min.x - 4, x1 = bounds.max.x + 4;
  const y0 = bounds.min.y - 4, y1 = bounds.max.y + 4;
  const floor = bounds.min.z + 3, top = bounds.max.z + 14;
  const edges = [];
  for (const z of [floor, top]) {
    for (const [ax, ay, bx, by] of [[x0, y0, x1, y0], [x1, y0, x1, y1], [x1, y1, x0, y1], [x0, y1, x0, y0]]) {
      edges.push(ax, ay, z, bx, by, z);
    }
  }
  for (const [x, y] of [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]) edges.push(x, y, floor, x, y, top);
  const outlineGeometry = new THREE.BufferGeometry();
  outlineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(edges, 3));
  const marker = new THREE.Group();
  marker.name = 'MatrixCity inspection marker';
  const outline = new THREE.LineSegments(outlineGeometry, new THREE.LineBasicMaterial({ color: 0xffcc55, depthTest: false, depthWrite: false, toneMapped: false }));
  outline.renderOrder = 999;
  outline.raycast = () => {};
  marker.add(outline);
  const labelCanvas = document.createElement('canvas');
  labelCanvas.width = 512;labelCanvas.height = 128;
  const label = labelCanvas.getContext('2d');
  label.fillStyle = 'rgba(12, 29, 39, 0.9)';label.fillRect(0, 0, 512, 128);
  label.strokeStyle = '#ffcc55';label.lineWidth = 8;label.strokeRect(4, 4, 504, 120);
  label.textAlign = 'center';label.fillStyle = '#ffffff';label.font = 'bold 39px Segoe UI, sans-serif';label.fillText('MATRIXCITY', 256, 55);
  label.font = '26px Segoe UI, sans-serif';label.fillText(`ГИБРИД · ${splatCountLabel} СПЛАТОВ`, 256, 98);
  const labelTexture = new THREE.CanvasTexture(labelCanvas);
  labelTexture.colorSpace = THREE.SRGBColorSpace;
  const labelSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, fog: false }));
  labelSprite.position.set((x0 + x1) / 2, (y0 + y1) / 2, Math.min(top + 18, floor + 125));
  labelSprite.scale.set(85, 21, 1);labelSprite.renderOrder = 1000;
  labelSprite.raycast = () => {};
  marker.add(labelSprite);
  marker.visible = false;
  group.add(marker);

  const collision = new THREE.Mesh(collider, new THREE.MeshBasicMaterial({ visible: false, colorWrite: false, depthWrite: false }));
  collision.name = 'matrixcity-building-001';
  collision.userData.agent = { semantic: 'building', module: 'matrixcity-trial.js', stableId: 'matrixcity-building-001', role: 'collision-proxy' };
  collision.visible = false;
  group.add(collision);

  group.visible = false;
  return { group, visual, visualMaterial, depthMaterial, collision, marker, splat: null, origin: ORIGIN.toArray() };
}

export async function addMatrixCitySplats(trial, { fullRoi = false } = {}) {
  const [geometry, metadata] = await Promise.all([
    new GaussianSplatPLYLoader().loadAsync(`${ASSET_ROOT}${fullRoi ? 'splats_roi_sh0_full.ply' : 'splats_roi_sh0_30k.ply'}`),
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
  splat.userData.agent = { semantic: 'building', module: 'matrixcity-trial.js', source: `MatrixCity Splatfacto SH0 ${fullRoi ? 'full ROI' : '30k'}` };
  splat.applyMatrix4(inverse);
  splat.visible = false;
  trial.group.add(splat);
  trial.splat = splat;
  return splat;
}
