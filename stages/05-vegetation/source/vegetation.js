import * as T from './vendor/three.module.js';
import {mergeGeometries} from './node_modules/three/examples/jsm/utils/BufferGeometryUtils.js';
import {uniform,positionGeometry,positionLocal,positionWorld,attribute,vec3,sin,color,mix,uv,cameraPosition,screenCoordinate,smoothstep} from './vendor/tsl.js';
import {hash2} from './sky-nodes.js';
function rng(seed){return ()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};}
function paint(g,c){const a=[];for(let i=0;i<g.attributes.position.count;i++)a.push(c.r,c.g,c.b);g.setAttribute('color',new T.Float32BufferAttribute(a,3));return g.index?g.toNonIndexed():g;}
function treeShape(kind,detail){
 const rand=rng(218+kind),parts=[],c=new T.Color(),height=13+kind*2;
 const trunk=new T.CylinderGeometry(.12,.38,height*.68,6,3);trunk.translate(0,height*.34,0);parts.push(paint(trunk,c.set('#695140')));
 const centers=[];for(let i=0;i<(detail?7:3);i++){const a=i*2.39996,rad=i===0?0:2.5+rand()*1.7,y=height*.58+rand()*height*.24;centers.push([Math.cos(a)*rad,y,Math.sin(a)*rad,2.3+rand()*1.5]);}
 for(const [x,y,z,r] of centers){
  if(detail){
   const start=new T.Vector3(0,height*.4,0),end=new T.Vector3(x,y,z),v=end.clone().sub(start);const branch=new T.CylinderGeometry(.07,.17,v.length(),4);branch.applyQuaternion(new T.Quaternion().setFromUnitVectors(new T.Vector3(0,1,0),v.clone().normalize()));branch.translate(...start.add(end).multiplyScalar(.5).toArray());parts.push(paint(branch,c.set('#695140')));
   for(let j=0;j<42;j++){
    const a=rand()*Math.PI*2,ny=rand()*2-1,rr=Math.sqrt(1-ny*ny)*r*(.65+rand()*.35),px=x+Math.cos(a)*rr,py=y+ny*r*.85,pz=z+Math.sin(a)*rr;
    const leaf=new T.CircleGeometry(.60+rand()*.48,5);leaf.scale(1,.55,1);leaf.rotateX(rand()*Math.PI);leaf.rotateY(rand()*Math.PI*2);leaf.translate(px,py,pz);c.setHSL(.22+rand()*.10,.30+rand()*.20,.17+rand()*.13);parts.push(paint(leaf,c));
   }
  }else{
   const crown=new T.IcosahedronGeometry(r,0);const p=crown.attributes.position;for(let i=0;i<p.count;i++){const x=p.getX(i),y=p.getY(i),z=p.getZ(i),n=1+.12*Math.sin(x*3.1+z)*Math.cos(y*2.3);p.setXYZ(i,x*n,y*n*.84,z*n);}crown.computeVertexNormals();crown.translate(x,y,z);c.setHSL(.255+rand()*.045,.38,.21+rand()*.06);parts.push(paint(crown,c));
  }
 }
 const merged=mergeGeometries(parts);for(const p of parts)p.dispose();return merged;
}
export function createVegetation({points,ground,reservedLand}){
 const group=new T.Group();group.name='Forest — broadleaf trees, shrubs and grass';const elapsed=uniform(0),wind=uniform(1),eye=uniform(new T.Vector3());
 const material=new T.MeshStandardNodeMaterial({vertexColors:true,roughness:1,side:T.DoubleSide});
 const pos=positionGeometry,bend=pos.y.div(18).pow(2).mul(sin(elapsed.mul(1.2).add(positionLocal.x.mul(.04)))).mul(wind).mul(.11);
 material.positionNode=positionLocal.add(vec3(bend,0,bend.mul(.4)));
 const detailMix=uniform(1),fade=smoothstep(350,650,eye.distance(positionWorld)).oneMinus().mul(detailMix),threshold=hash2(screenCoordinate);
 const nearMaterial=material.clone(),farMaterial=material.clone();nearMaterial.maskNode=threshold.lessThan(fade);farMaterial.maskNode=threshold.greaterThanEqual(fade);
 const shapes=[0,1,2].map(k=>({near:treeShape(k,true),far:treeShape(k,false)}));
 const buckets=new Map();points.forEach((p,i)=>{const k=i%3,tx=Math.floor(p[0]/650),tz=Math.floor(p[2]/650),key=tx+','+tz+','+k;if(!buckets.has(key))buckets.set(key,{x:(tx+.5)*650,z:(tz+.5)*650,kind:k,points:[]});buckets.get(key).points.push(p);});
 const dummy=new T.Object3D(),tiles=[];
 for(const bucket of buckets.values()){
  const meshes={};for(const lod of ['near','far']){
   const mesh=new T.InstancedMesh(shapes[bucket.kind][lod],lod==='near'?nearMaterial:farMaterial,bucket.points.length);mesh.name='Broadleaf '+bucket.kind+' '+lod;
   bucket.points.forEach(([x,y,z,s],i)=>{dummy.position.set(x,y,z);dummy.rotation.set(0,(x+z)*.7,0);const scale=s/14;dummy.scale.set(scale,scale,scale);dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix);});mesh.computeBoundingSphere();group.add(mesh);meshes[lod]=mesh;
  }tiles.push({...bucket,...meshes});
 }
 const grassPatches=[],blade=new T.BufferGeometry();blade.setAttribute('position',new T.Float32BufferAttribute([-.055,0,0,.055,0,0,-.035,.42,.04,.035,.42,.04,0,.83,.13],3));blade.setIndex([0,1,2,1,3,2,2,3,4]);blade.computeVertexNormals();
 const gm=new T.MeshStandardNodeMaterial({roughness:1,side:T.DoubleSide});
 gm.colorNode=mix(color('#28472a'),color('#91a257'),positionGeometry.y);
 const base=attribute('grassBase','vec3'),gpos=positionGeometry;
 gm.positionNode=positionLocal.add(vec3(sin(elapsed.mul(1.8).add(base.x.mul(.24))).mul(gpos.y.pow(2)).mul(wind).mul(.22),0,0));
 const candidates=points.filter(([x,y,z])=>x>-3500&&x<-1300&&z>-2900&&z<-800);
 for(let k=0;k<32&&k<candidates.length;k++){
  const [x,y,z]=candidates[Math.floor(k*candidates.length/32)],rand=rng(k+428),positions=[];
  for(let j=0;j<2048;j++){const px=x+(rand()-.5)*24,pz=z+(rand()-.5)*24,h=ground(px,pz);if(h<13||reservedLand(px,pz)||Math.abs(h-ground(px+2,pz))>1.8)continue;positions.push(px,h+.025,pz);}
  const geometry=blade.clone();geometry.setAttribute('grassBase',new T.InstancedBufferAttribute(new Float32Array(positions),3));const mesh=new T.InstancedMesh(geometry,gm,positions.length/3);for(let i=0;i<mesh.count;i++){dummy.position.set(positions[i*3],positions[i*3+1],positions[i*3+2]);dummy.rotation.set(0,rand()*Math.PI*2,0);dummy.scale.set(.6+rand()*.8,.45+rand()*.85,1);dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix);}mesh.frustumCulled=false;mesh.name='Grass patch '+k;group.add(mesh);grassPatches.push({x,y,z,mesh});
 }
 function update(camera,t,w){elapsed.value=t;wind.value=w;eye.value.copy(camera.position);const altitude=camera.position.y-ground(camera.position.x,camera.position.z);detailMix.value=1-T.MathUtils.smoothstep(altitude,100,160);for(const tile of tiles){const d=Math.hypot(camera.position.x-tile.x,camera.position.z-tile.z);const near=d<1150&&altitude<160;tile.near.visible=near;tile.far.visible=d<14000;}for(const patch of grassPatches)patch.mesh.visible=camera.position.distanceTo(new T.Vector3(patch.x,patch.y,patch.z))<180;}
 return {group,tiles,grassPatches,elapsed,wind,update,stats:{trees:points.length,variants:3,tiles:tiles.length,grassBlades:grassPatches.reduce((s,p)=>s+p.mesh.count,0)}};
}
