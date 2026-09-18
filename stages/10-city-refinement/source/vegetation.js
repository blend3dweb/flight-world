import * as T from './vendor/three.module.js';
import {mergeGeometries} from './node_modules/three/examples/jsm/utils/BufferGeometryUtils.js';
import {uniform,positionGeometry,positionLocal,positionWorld,attribute,vec3,sin,cos,color,mix,smoothstep} from './vendor/tsl.js';

function rng(seed){return ()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};}
function paint(geometry,tint){
 const colors=[];for(let i=0;i<geometry.attributes.position.count;i++)colors.push(tint.r,tint.g,tint.b);
 geometry.setAttribute('color',new T.Float32BufferAttribute(colors,3));return geometry.index?geometry.toNonIndexed():geometry;
}
function disposeParts(parts){for(const part of parts)part.dispose();}
function branchBetween(start,end,radius,colorValue){
 const direction=end.clone().sub(start),geometry=new T.CylinderGeometry(radius*.62,radius,direction.length(),5,1);
 geometry.applyQuaternion(new T.Quaternion().setFromUnitVectors(new T.Vector3(0,1,0),direction.clone().normalize()));
 geometry.translate(...start.clone().add(end).multiplyScalar(.5).toArray());return paint(geometry,new T.Color(colorValue));
}
function canopyLobes(kind,detail,rand,parts){
 const presets=[
  {height:13.5,count:9,radius:3.2,spread:4.3,flat:.52,hue:.285},
  {height:15.5,count:10,radius:3.1,spread:3.2,flat:.80,hue:.255},
  {height:18,count:9,radius:2.8,spread:2.5,flat:1.08,hue:.31},
  {height:14.5,count:8,radius:3.4,spread:4.8,flat:.62,hue:.235}
 ][kind],centers=[];
 const count=detail?presets.count:Math.max(4,Math.floor(presets.count*.55));
 for(let i=0;i<count;i++){
  const angle=i*2.39996+kind*.73,jitter=.55+rand()*.55,ring=i===0?0:presets.spread*Math.sqrt(i/(count-1));
  let x=Math.cos(angle)*ring*jitter,z=Math.sin(angle)*ring*jitter;if(kind===3)x+=ring*.28;
  const y=presets.height*(.66+.025*i)+Math.sin(angle*1.7)*.55,radius=presets.radius*(.72+rand()*.33)*(i===0?1.08:1);
  centers.push(new T.Vector3(x,y,z));
  const crown=new T.IcosahedronGeometry(1,detail?1:0);crown.scale(radius,radius*presets.flat,radius*(.82+rand()*.28));
  const position=crown.attributes.position;
  for(let p=0;p<position.count;p++){const px=position.getX(p),py=position.getY(p),pz=position.getZ(p),rough=1+.08*Math.sin(px*4.1+py*2.7+pz*3.3+kind);position.setXYZ(p,px*rough,py*rough,pz*rough);}
  crown.computeVertexNormals();crown.translate(x,y,z);
  parts.push(paint(crown,new T.Color().setHSL(presets.hue+(rand()-.5)*.045,.38+rand()*.14,.14+rand()*.07)));
 }
 return {preset:presets,centers};
}
function treeShape(kind,detail){
 const rand=rng(1249+kind*97+(detail?13:0)),parts=[],{preset,centers}=canopyLobes(kind,detail,rand,parts),trunkColor=kind===2?'#57463a':'#665041';
 const trunk=new T.CylinderGeometry(.18,.46,preset.height*.72,7,detail?3:1);trunk.translate(0,preset.height*.36,0);parts.push(paint(trunk,new T.Color(trunkColor)));
 if(detail){const fork=new T.Vector3(0,preset.height*.43,0);for(let i=1;i<centers.length;i+=2)parts.push(branchBetween(fork,centers[i].clone().multiply(new T.Vector3(.72,.82,.72)),.16,trunkColor));}
 const merged=mergeGeometries(parts);disposeParts(parts);merged.computeBoundingSphere();return merged;
}
function shrubShape(){
 const rand=rng(904),parts=[];
 for(let i=0;i<5;i++){const angle=i*2.39996,r=.45+rand()*.55,g=new T.IcosahedronGeometry(1,0);g.scale(.75+r*.45,.55+r*.32,.72+r*.4);g.translate(Math.cos(angle)*r*.72,.48+rand()*.28,Math.sin(angle)*r*.72);parts.push(paint(g,new T.Color().setHSL(.25+rand()*.045,.42,.13+rand()*.055)));}
 const merged=mergeGeometries(parts);disposeParts(parts);return merged;
}
function treeSeed([x,,z]){return ((Math.sin(x*12.9898+z*78.233)*43758.5453)%1+1)%1;}

export function createVegetation({points,ground,reservedLand}){
 const group=new T.Group();group.name='Forest — stable tree LOD, understory and grass';
 const elapsed=uniform(0),wind=uniform(1),eye=uniform(new T.Vector3()),detailMix=uniform(1);
 const material=new T.MeshStandardNodeMaterial({vertexColors:true,roughness:1,side:T.DoubleSide});
 const localHeight=positionGeometry.y.max(0),phase=positionWorld.x.mul(.022).add(positionWorld.z.mul(.017));
 const sway=sin(elapsed.mul(1.15).add(phase)).mul(localHeight.div(18).pow(1.7)).mul(wind).mul(.18);
 material.positionNode=positionLocal.add(vec3(sway,0,cos(elapsed.mul(.87).add(phase)).mul(sway).mul(.35)));
 const fade=smoothstep(145,270,eye.distance(positionWorld)).oneMinus().mul(detailMix),stableSeed=attribute('treeSeed','float');
 const nearMaterial=material.clone(),farMaterial=material.clone();nearMaterial.maskNode=stableSeed.lessThan(fade);farMaterial.maskNode=stableSeed.greaterThanEqual(fade);
 const variants=4,shapes=Array.from({length:variants},(_,kind)=>({near:treeShape(kind,true),far:treeShape(kind,false)}));
 const dummy=new T.Object3D(),tiles=[],spatial=new Map(),variantPoints=Array.from({length:variants},()=>[]);
 points.forEach((p,i)=>{const kind=i%variants,v={p,kind};variantPoints[kind].push(p);const key=Math.floor(p[0]/400)+','+Math.floor(p[2]/400);if(!spatial.has(key))spatial.set(key,[]);spatial.get(key).push(v);});
 function matrix([x,y,z,s],kind=0){const seed=treeSeed([x,y,z]),effectiveSize=15+(s-13)*.6,base=effectiveSize/(16+kind*.65);dummy.position.set(x,y,z);dummy.rotation.set(0,seed*Math.PI*2,0);dummy.scale.set(base*(.84+seed*.26),base*(.91+((seed*7)%1)*.22),base*(.84+((seed*13)%1)*.24));dummy.updateMatrix();return dummy.matrix;}
 for(let kind=0;kind<variants;kind++){
  const values=variantPoints[kind],farGeometry=shapes[kind].far;
  farGeometry.setAttribute('treeSeed',new T.InstancedBufferAttribute(new Float32Array(values.map(treeSeed)),1));
  const far=new T.InstancedMesh(farGeometry,farMaterial,values.length);far.name='Forest distant '+kind;values.forEach((p,i)=>far.setMatrixAt(i,matrix(p,kind)));far.computeBoundingSphere();group.add(far);
  const nearGeometry=shapes[kind].near,nearSeeds=new T.InstancedBufferAttribute(new Float32Array(384),1);nearGeometry.setAttribute('treeSeed',nearSeeds);
  const near=new T.InstancedMesh(nearGeometry,nearMaterial,384);near.name='Forest detailed '+kind;near.count=0;near.frustumCulled=false;near.castShadow=true;near.receiveShadow=true;group.add(near);tiles.push({near,far,kind,nearSeeds});
 }
 const shrubPoints=points.filter((_,i)=>i%3===0),shrubGeometry=shrubShape(),shrubMaterial=new T.MeshStandardNodeMaterial({vertexColors:true,roughness:1});
 const shrub=new T.InstancedMesh(shrubGeometry,shrubMaterial,shrubPoints.length);shrub.name='Forest understory';
 shrubPoints.forEach((p,i)=>{const seed=treeSeed(p);dummy.position.set(p[0]+Math.sin(i)*3,p[1]+.04,p[2]+Math.cos(i*1.7)*3);dummy.rotation.set(0,seed*6.28,0);dummy.scale.setScalar(.55+seed*.85);dummy.updateMatrix();shrub.setMatrixAt(i,dummy.matrix);});shrub.computeBoundingSphere();group.add(shrub);

 let lastEye=new T.Vector3(Infinity,Infinity,Infinity),lastNear=false,detailOverflow=false;
 const grassPatches=[],blade=new T.BufferGeometry();
 blade.setAttribute('position',new T.Float32BufferAttribute([-.032,0,0,.032,0,0,-.041,.23,.005,.041,.23,.005,-.031,.48,.026,.031,.48,.026,-.018,.72,.072,.018,.72,.072,0,1,.15],3));
 blade.setIndex([0,1,2,1,3,2,2,3,4,3,5,4,4,5,6,5,7,6,6,7,8]);blade.computeVertexNormals();
 const grassMaterial=new T.MeshStandardNodeMaterial({roughness:1,side:T.DoubleSide});
 const grassBase=attribute('grassBase','vec3'),grassTone=sin(grassBase.x.mul(.19).add(grassBase.z.mul(.31))).mul(.5).add(.5);
 grassMaterial.colorNode=mix(color('#203d22'),color('#7f9950'),positionGeometry.y.mul(.72).add(grassTone.mul(.28)));
 const grassPhase=grassBase.x.mul(.21).add(grassBase.z.mul(.17)),grassBend=positionGeometry.y.pow(1.7).mul(wind).mul(.24);
 grassMaterial.positionNode=positionLocal.add(vec3(sin(elapsed.mul(1.65).add(grassPhase)).mul(grassBend),0,cos(elapsed.mul(1.22).add(grassPhase)).mul(grassBend).mul(.45)));
 const candidates=points.filter(([x,,z])=>x>-3500&&x<-1300&&z>-2900&&z<-800);
 for(let k=0;k<48&&k<candidates.length;k++){
  const [x,y,z]=candidates[Math.floor(k*candidates.length/48)],rand=rng(k+428),positions=[];
  for(let j=0;j<3072;j++){const angle=rand()*Math.PI*2,radius=Math.sqrt(rand())*18,px=x+Math.cos(angle)*radius,pz=z+Math.sin(angle)*radius,h=ground(px,pz);if(h<13||reservedLand(px,pz)||Math.abs(h-ground(px+2,pz))>1.8)continue;positions.push(px,h+.025,pz);}
  const geometry=blade.clone();geometry.setAttribute('grassBase',new T.InstancedBufferAttribute(new Float32Array(positions),3));
  const mesh=new T.InstancedMesh(geometry,grassMaterial,positions.length/3);for(let i=0;i<mesh.count;i++){const seed=treeSeed([positions[i*3],0,positions[i*3+2]]);dummy.position.set(positions[i*3],positions[i*3+1],positions[i*3+2]);dummy.rotation.set(0,seed*Math.PI*2,0);dummy.scale.set(.65+seed*.5,.55+((seed*11)%1)*.75,1);dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix);}mesh.frustumCulled=false;mesh.name='Grass patch '+k;group.add(mesh);grassPatches.push({x,y,z,mesh,positions});
 }
 function update(camera,t,w){
  elapsed.value=t;wind.value=w;eye.value.copy(camera.position);const altitude=camera.position.y-ground(camera.position.x,camera.position.z),nearActive=altitude<180;detailMix.value=1-T.MathUtils.smoothstep(altitude,115,180);
  if(lastEye.distanceTo(camera.position)>24||nearActive!==lastNear){
   const lists=Array.from({length:variants},()=>[]),tx=Math.floor(camera.position.x/400),tz=Math.floor(camera.position.z/400);
   if(nearActive)for(let x=tx-1;x<=tx+1;x++)for(let z=tz-1;z<=tz+1;z++)for(const v of spatial.get(x+','+z)||[])if(Math.hypot(v.p[0]-camera.position.x,v.p[2]-camera.position.z)<360)lists[v.kind].push(v.p);
   detailOverflow=lists.some(list=>list.length>384);if(detailOverflow)detailMix.value=0;
   for(let kind=0;kind<variants;kind++){const tile=tiles[kind],count=detailOverflow?0:lists[kind].length;tile.near.count=count;for(let i=0;i<count;i++){tile.near.setMatrixAt(i,matrix(lists[kind][i],kind));tile.nearSeeds.setX(i,treeSeed(lists[kind][i]));}tile.near.instanceMatrix.needsUpdate=true;tile.nearSeeds.needsUpdate=true;}
   lastEye.copy(camera.position);lastNear=nearActive;
  }
  if(detailOverflow)detailMix.value=0;for(const tile of tiles)tile.near.visible=nearActive;shrub.visible=altitude<2200;
  for(const patch of grassPatches)patch.mesh.visible=altitude<75&&Math.hypot(camera.position.x-patch.x,camera.position.y-patch.y,camera.position.z-patch.z)<190;
 }
 const grassBlades=grassPatches.reduce((sum,patch)=>sum+patch.mesh.count,0);
 return {group,tiles,shrub,shrubPoints,grassPatches,elapsed,wind,detailMix,update,stats:{trees:points.length,variants,tiles:tiles.length,shrubs:shrubPoints.length,grassPatches:grassPatches.length,grassBlades,nearCapacity:variants*384}};
}
