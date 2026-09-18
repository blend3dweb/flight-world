import * as THREE from './vendor/three.module.js';
import { makeFacade } from './materials.js';
import { uniform } from './vendor/tsl.js';
import {CITY,AIRPORT,bridgeHeight,shoreZ} from './city-layout.js';
import {junctions,inset,inside,rectangle,mixQuad,coast} from './urban-plan.js';

// Block / curb / furniture alignment follows the CityGenerator example's approach.
// Geometry and standard PBR materials are authored for our existing WebGL renderer.
// This module deliberately creates neither cameras nor lights.
export function createCity(){
 const group=new THREE.Group();group.name='Oceania — city, airport and harbour';
 let seed=94;const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 const batches=new Map(),obj=new THREE.Object3D(),col=new THREE.Color();let placement=null;
 const windowDensity=uniform(.275); // Previously .55: halve occupancy, retain lamp brightness.
 const frond=new THREE.BufferGeometry(),fp=[],fi=[];
 for(let i=0;i<=10;i++){const t=i/10,w=.55*Math.sin(Math.PI*t);fp.push(-w,.6*Math.sin(t*Math.PI)-t*t*1.4,t,w,.6*Math.sin(t*Math.PI)-t*t*1.4,t);if(i<10){const v=i*2;fi.push(v,v+2,v+1,v+1,v+2,v+3);}}
 frond.setAttribute('position',new THREE.Float32BufferAttribute(fp,3));frond.setIndex(fi);frond.computeVertexNormals();
 const box=new THREE.BoxGeometry(1,1,1),cylinder=new THREE.CylinderGeometry(1,1,1,8),leaf=new THREE.SphereGeometry(1,6,4);
 const mat=(color,roughness=.75,metalness=0)=>new THREE.MeshStandardMaterial({color,roughness,metalness});
 const m={asphalt:mat('#303d42'),concrete:mat('#b5c1b9'),white:mat('#eee8d6'),sand:mat('#cebfa0'),grass:mat('#517b48'),wood:mat('#a37143'),metal:mat('#465c5b',.4,.55),rubber:mat('#17282b'),trunk:mat('#766141'),leaf:mat('#417d53'),glass:mat('#396d79',.21,.55),roof:mat('#adc2c4',.66,.25),yellow:mat('#eec15d'),red:mat('#c96852'),water:mat('#3298a8',.2,.45)};
 m.leaf.side=THREE.DoubleSide;
 const glow=new THREE.MeshStandardMaterial({color:'#fff0be',emissive:'#ffd394',emissiveIntensity:0,roughness:.6});
 const runwayLight=new THREE.MeshStandardMaterial({color:'#b9efff',emissive:'#b9e8ff',emissiveIntensity:0});
 const facades=[0,1,2,3].map(i=>makeFacade(i,windowDensity));
 const towerMats=facades.map(f=>[f,f,m.roof,m.roof,f,f]);
 function put(name,geometry,material,x,y,z,w,h,d,rot=0,color){
   if(placement){[x,z]=rotatePlacement(x,z);rot+=placement.angle;}
   let b=batches.get(name);if(!b){b={geometry,material,items:[]};batches.set(name,b);}
   b.items.push({x,y,z,w,h,d,rot,color});
 }
 function b(name,material,x,y,z,w,h,d,rot=0,color){put(name,box,material,x,y,z,w,h,d,rot,color);}
 const stats={blocks:0,buildings:0,entrances:0,benches:0,palms:0,cars:0,crosswalks:0,streetlights:0,runways:1,gates:4};
 const buildings=[],roads=[],entrances=[],benchPositions=[],blocks=[];
 function rotatePlacement(x,z){const p=placement,dx=x-p.x,dz=z-p.z;return [p.x+Math.cos(p.angle)*dx+Math.sin(p.angle)*dz,p.z-Math.sin(p.angle)*dx+Math.cos(p.angle)*dz];}
 function local(x,z,a,dx,dz){return [x+Math.cos(a)*dx+Math.sin(a)*dz,z-Math.sin(a)*dx+Math.cos(a)*dz];}
 function part(name,material,x,y,z,a,dx,dy,dz,w,h,d){const [px,pz]=local(x,z,a,dx,dz);b(name,material,px,y+dy,pz,w,h,d,a);}
 function bench(x,y,z,a=0){
   stats.benches++;benchPositions.push([x,y,z]);
   for(let k=0;k<4;k++)part('Bench slats',m.wood,x,y,z,a,0,.53,(k-1.5)*.17,2.1,.09,.13);
   for(let k=0;k<3;k++)part('Bench slats',m.wood,x,y,z,a,0,.77+k*.15,-.34,2.1,.10,.10);
   for(const dx of [-.78,.78]){part('Bench feet',m.metal,x,y,z,a,dx,.27,0,.09,.54,.59);part('Bench feet',m.metal,x,y,z,a,dx,.79,-.36,.08,.83,.08);}
 }
 function palm(x,y,z,scale=1){
   stats.palms++;const h=(9+rand()*3)*scale;
   put('Palm trunks',cylinder,m.trunk,x,y+h/2,z,.27*scale,h,.27*scale);
   for(let j=0;j<7;j++){
    const a=j*Math.PI*2/7+rand()*.2;const len=(3.7+rand())*scale;
    put('Palm fronds',frond,m.leaf,x,y+h,z,scale,scale,len,a);
   }
 }
 function lamp(x,y,z,a=0){
   stats.streetlights++;part('Street poles',m.metal,x,y,z,a,0,4.2,0,.16,8.4,.16);part('Street poles',m.metal,x,y,z,a,0,8.35,1.1,.13,.13,2.3);part('Street lamps',glow,x,y,z,a,0,8.28,2.2,.60,.13,1.1);
 }
 function bin(x,y,z){put('Litter bins',cylinder,m.metal,x,y+.55,z,.35,1.1,.35);put('Litter lids',cylinder,m.wood,x,y+1.11,z,.39,.10,.39);}
 function car(x,y,z,a=0,color='#e0e7da'){
   stats.cars++;b('Vehicle bodies',m.white,x,y+.7,z,1.9,.8,4.5,a,color);part('Vehicle glazing',m.glass,x,y,z,a,0,1.24,-.15,1.67,.57,2.25);
   for(const xx of [-.97,.97])for(const zz of [-1.35,1.35])part('Vehicle wheels',m.rubber,x,y,z,a,xx,.4,zz,.22,.62,.64);
   for(const xx of [-.61,.61])part('Vehicle lamps',glow,x,y,z,a,xx,.78,2.28,.43,.18,.05);
 }
 function person(x,y,z,a=0){
   const color=['#e6bc70','#6997a4','#efeddf','#b97664'][Math.floor(rand()*4)];b('People clothes',m.white,x,y+1.05,z,.42,.63,.26,a,color);
   put('People heads',leaf,m.sand,x,y+1.54,z,.19,.22,.19);
   for(const dx of [-.12,.12])part('People legs',m.metal,x,y,z,a,dx,.40,0,.13,.8,.14);
 }
 function crossing(x,y,z,a){
   stats.crosswalks++;for(let n=-4;n<=4;n++)part('Zebra crossings',m.white,x,y,z,a,n*1.45,0,0,.65,.018,4.2);
 }
 const X=CITY.x,Z=CITY.z,Y=CITY.y;
 // Streets are edges of a connected irregular graph, not a rotated square grid.
 function strip(name,material,a,c,width,y=.12,height=.12){
   const dx=c[0]-a[0],dz=c[1]-a[1],length=Math.hypot(dx,dz),angle=Math.atan2(dx,dz);
   b(name,material,(a[0]+c[0])/2,Y+y-height/2,(a[1]+c[1])/2,width,height,length+.04,angle);
 }
 function road(a,c,width=24,kind='street'){
   const dx=c[0]-a[0],dz=c[1]-a[1],len=Math.hypot(dx,dz),angle=Math.atan2(dx,dz),nx=dz/len,nz=-dx/len;
   strip('Roads',m.asphalt,a,c,width);roads.push({a,b:c,width,kind});
   for(let t=25;t<len-22;t+=13)b('Lane markings',m.white,a[0]+dx*t/len,Y+.14,a[1]+dz*t/len,.17,.02,5,angle);
   for(const t of [22,len-22])if(len>65)crossing(a[0]+dx*t/len,Y+.16,a[1]+dz*t/len,angle);
   for(let t=38;t<len-25;t+=43){const x=a[0]+dx*t/len+nx*(width/2+4),z=a[1]+dz*t/len+nz*(width/2+4);lamp(x,Y+.4,z,angle-Math.PI/2);}
   if(len>100&&rand()>.25)car(a[0]+dx*.45+nx*width*.25,Y+.12,a[1]+dz*.45+nz*width*.25,angle,['#f1e3b8','#e0e5dd','#668f9b'][Math.floor(rand()*3)]);
 }
 function polygon(name,material,points,top=.4){
   const shape=new THREE.Shape(points.map(([x,z])=>new THREE.Vector2(x,-z)));
   const geo=new THREE.ExtrudeGeometry(shape,{depth:top,bevelEnabled:false});geo.rotateX(-Math.PI/2);geo.translate(0,Y,0);
   const mesh=new THREE.Mesh(geo,material);mesh.name=name;group.add(mesh);
 }
 for(let i=0;i<7;i++)for(let j=0;j<6;j++){
   const p=junctions[i][j];if(i<6)road(p,junctions[i+1][j]);if(j<5)road(p,junctions[i][j+1]);
   put('Street junctions',cylinder,m.asphalt,p[0],Y+.06,p[1],12,.12,12);
 }
 const roundGeo=new THREE.CylinderGeometry(1,1,1,32),roundMats=[facades[3],m.roof,m.roof];
 const roofShape=new THREE.Shape().moveTo(-.5,0).lineTo(.5,0).lineTo(0,.45).closePath();
 const gable=new THREE.ExtrudeGeometry(roofShape,{depth:1,bevelEnabled:false});gable.translate(0,0,-.5);
 const architecture=['stepped','round','courtyard','terraced','gable','twin'];stats.architecture={};
 function building(x,z,w,d,h,type=0,front=0,angle=0,kind=0,block){
   const y=Y+.4;placement={x,z,angle};const style=architecture[kind];stats.architecture[style]=(stats.architecture[style]||0)+1;
   stats.buildings++;buildings.push({x,z,w,d,h,y,angle,style,block,footprint:rectangle(x,z,w+8,d+18,angle)});
   if(kind===1){
     put('Round podiums',roundGeo,[facades[2],m.roof,m.roof],x,y+3,z,w*.5,6,d*.5);
     put('Round towers',roundGeo,roundMats,x,y+6+(h-6)/2,z,w*.44,h-6,d*.44);
     for(let f=6;f<h;f+=7.6)put('Round floor rims',roundGeo,m.white,x,y+f,z,w*.455,.25,d*.455);
     put('Round crowns',roundGeo,m.roof,x,y+h+.4,z,w*.45,.8,d*.45);
   }else if(kind===2){
     for(const sx of [-1,1]){b('Courtyard wings',towerMats[2],x+sx*w*.34,y+h/2,z,w*.32,h,d);b('Courtyard roofs',m.roof,x+sx*w*.34,y+h+.25,z,w*.33,.5,d+.2);}
     b('Courtyard wings',towerMats[2],x,y+h/2,z-d*.34,w,h,d*.32);b('Courtyard roofs',m.roof,x,y+h+.25,z-d*.34,w,.5,d*.33);
     b('Courtyard lawns',m.grass,x,y+.035,z+d*.1,w*.33,.07,d*.65);
   }else if(kind===3){
     for(let t=0;t<3;t++){const depth=d*(1-t*.24),zz=z-t*d*.12,hh=h/3;b('Terraced residences',towerMats[2],x,y+(t+.5)*hh,zz,w,hh,depth);b('Terrace roof slabs',m.white,x,y+(t+1)*hh+.15,zz,w+.6,.3,depth+.5);if(t<2){b('Roof gardens',m.grass,x,y+(t+1)*hh+.35,zz+depth/2-d*.10,w*.82,.12,d*.15);b('Terrace balustrades',m.glass,x,y+(t+1)*hh+.9,zz+depth/2,w,1.2,.10);}}
   }else if(kind===4){
     b('Resort residences',towerMats[2],x,y+h/2,z,w,h,d);put('Pavilion pitched roofs',gable,m.metal,x,y+h,z,w+3,9,d+3);
     for(const sx of [-1,1])b('Pavilion colonnades',m.white,x+sx*w*.42,y+2.8,z+d*.48,.45,5.6,.45);
   }else if(kind===5){
     b('Podiums',towerMats[2],x,y+3,z,w+3,6,d+3,0,'#e0dfce');
     for(const side of [-1,1]){const hh=h*(side>0?.77:1);b('Twin towers',towerMats[0],x+side*w*.30,y+6+hh/2,z,w*.34,hh,d*.88);b('Twin tower crowns',m.roof,x+side*w*.30,y+6+hh+.25,z,w*.35,.5,d*.89);}
     b('Sky bridges',m.glass,x,y+h*.57,z,w*.5,4,d*.42);
   }else{
     b('Podiums',towerMats[2],x,y+3,z,w+3,6,d+3,0,'#e0dfce');
     b(`Towers ${type}`,towerMats[type],x,y+6+(h-6)/2,z,w,h-6,d);
     for(let f=12;f<h;f+=15.2)b('Floor ledges',m.white,x,y+f,z,w+.8,.25,d+.8);
     if(h>70){b(`Towers ${type}`,towerMats[type],x,y+h+5,z,w*.70,10,d*.70);b('Roof caps',m.roof,x,y+h+10.3,z,w*.72,.6,d*.72);}else b('Roof caps',m.roof,x,y+h+.25,z,w+.2,.5,d+.2);
   }
   // Every style retains an entrance facing its street; U-shaped buildings enter a wing.
   const a=front,doorX=kind===2?x-w*.34:x,extra=[0,5].includes(kind)?1.58:.22;
   const [ex,ez]=local(doorX,z,a,0,d/2+extra),[wx,wz]=rotatePlacement(ex,ez);stats.entrances++;entrances.push({x:wx,z:wz,y,width:4.6,angle:angle+a});
   part('Entrance frames',m.white,ex,y,ez,a,0,2.1,0,5.2,4.2,.4);part('Entrance glass',m.glass,ex,y,ez,a,0,1.9,.23,4.6,3.8,.08);part('Door mullions',m.metal,ex,y,ez,a,0,1.9,.31,.09,3.8,.07);
   for(const dx of [-.22,.22])part('Door handles',m.white,ex,y,ez,a,dx,1.2,.40,.04,.6,.06);
   part('Entrance canopies',m.roof,ex,y,ez,a,0,4.3,1.7,7,.25,4.2);part('Entrance landings',m.concrete,ex,y,ez,a,0,.03,3.1,6,.06,6);
   placement=null;
 }
 for(let ix=0;ix<6;ix++)for(let iz=0;iz<5;iz++){
   stats.blocks++;const poly=inset([junctions[ix][iz],junctions[ix+1][iz],junctions[ix+1][iz+1],junctions[ix][iz+1]],16),id=blocks.length;blocks.push(poly);polygon('Irregular sidewalk block',m.concrete,poly);
   const park=(ix===2&&iz===3)||(ix===4&&iz===1),[x,z]=mixQuad(poly,.5,.5);
   if(park){polygon('Park lawn',m.grass,inset(poly,9),.44);const a=mixQuad(poly,.5,0),c=mixQuad(poly,.5,1);strip('Park paths',m.sand,a,c,6,.49,.04);put('Fountain basin',cylinder,m.concrete,x,Y+.8,z,12,.8,12);put('Fountain water',cylinder,m.water,x,Y+1.23,z,10.8,.06,10.8);}
   else for(let sx=0;sx<2;sx++)for(let sz=0;sz<2;sz++){
     const [bx,bz]=mixQuad(poly,sx?.73:.27,sz?.73:.27),edge=sz?[poly[3],poly[2]]:[poly[0],poly[1]],angle=-Math.atan2(edge[1][1]-edge[0][1],edge[1][0]-edge[0][0]);
     let w=35+rand()*5,d=33+rand()*5;
     while(!rectangle(bx,bz,w+8,d+18,angle).every(p=>inside(p,poly))&&w>19){w*=.93;d*=.93;}
     if(!rectangle(bx,bz,w+8,d+18,angle).every(p=>inside(p,poly)))continue;
     const kind=(ix+iz*2+sx+sz*3)%6,core=Math.max(0,1-Math.hypot(ix-2.5,iz-2)*.34),h=[0,1,5].includes(kind)?42+rand()*40+core*100:16+rand()*22;
     building(bx,bz,w,d,h,kind%3,sz?0:Math.PI,angle,kind,id);
   }
   // Furniture is measured along actual pavement edges, and turns with them.
   for(let e=0;e<4;e++){
     const a=poly[e],c=poly[(e+1)%4],dx=c[0]-a[0],dz=c[1]-a[1],l=Math.hypot(dx,dz),nx=-dz/l,nz=dx/l,angle=Math.atan2(dx,dz);
     for(let t=22;t<l-15;t+=36)palm(a[0]+dx*t/l+nx*3,Y+.4,a[1]+dz*t/l+nz*3,.8);
     const mx=(a[0]+c[0])/2+nx*3,mz=(a[1]+c[1])/2+nz*3;bench(mx,Y+.4,mz,angle-Math.PI/2);bin(mx+nx*2,Y+.4,mz+nz*2);person(mx+dx*.12,Y+.4,mz+dz*.12,angle);
   }
 }
 // Coastal road and promenade follow the same smooth shoreline used by terrain/water.
 function ribbon(name,material,points,width,top){
   const pos=[],ids=[];
   points.forEach((p,i)=>{const a=points[Math.max(0,i-1)],b=points[Math.min(points.length-1,i+1)],dx=b[0]-a[0],dz=b[1]-a[1],l=Math.hypot(dx,dz),nx=-dz/l*width/2,nz=dx/l*width/2;pos.push(p[0]+nx,Y+top,p[1]+nz,p[0]-nx,Y+top,p[1]-nz);if(i<points.length-1){const j=i*2;ids.push(j,j+2,j+1,j+1,j+2,j+3);}});
   const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));geo.setIndex(ids);geo.computeVertexNormals();const mesh=new THREE.Mesh(geo,material);mesh.name=name;group.add(mesh);
 }
 ribbon('Coastal promenade',m.sand,coast,10,.42);
 ribbon('Coastal road',m.asphalt,coast.map(([x,z])=>[x,z-24]),18,.12);
 for(let i=0;i<coast.length-1;i++){
   const a=coast[i],c=coast[i+1];
   const ra=[a[0],a[1]-24],rc=[c[0],c[1]-24];roads.push({a:ra,b:rc,width:18,kind:'coastal'});
   if(i%2===0)strip('Coastal markings',m.white,ra,rc,.18,.15,.02);
   if(i%3===0){const angle=-Math.atan2(c[1]-a[1],c[0]-a[0]);bench(a[0],Y+.42,a[1],angle+Math.PI);palm(a[0],Y+.42,a[1]-6);}
 }
 for(const ix of [0,3,6]){const a=junctions[ix][5],z=shoreZ(a[0])-54;road(a,[a[0],z],18,'coastal link');}
 road(junctions[6][2],[-1472,-1988],24,'bridge link');
 // Small marina, with its access following the bay rather than a straight seawall.
 const marinaX=X+355,marinaZ=Math.max(...[0,30,60,80].map(dx=>shoreZ(marinaX+dx)))+60,rampStart=shoreZ(marinaX)+30,rampLength=marinaZ-rampStart;
 b('Marina access',m.wood,marinaX,Y,shoreZ(marinaX),5,.35,62);
 for(let i=0;i<36;i++)b('Marina ramp',m.wood,marinaX,Y-(i+.5)*(9.8/36),rampStart+(i+.5)*rampLength/36,5,.24,rampLength/36+.1);
 b('Marina shore deck',m.wood,marinaX+35,2.2,marinaZ,90,.5,7);
 for(let i=0;i<3;i++){const x=marinaX+i*30;b('Marina pontoons',m.wood,x,2.2,marinaZ+40,3,.5,85);for(let j=0;j<3;j++){const z=marinaZ+15+j*26;b('Marina yacht hulls',m.white,x+8,1.25,z,5,2.3,15);b('Marina yacht cabins',m.glass,x+8,3,z,3.6,1.6,6);put('Marina yacht masts',cylinder,m.white,x+8,10,z,.08,17,.08);}}

 // Gently graded causeway joins a city junction to the airport's landside road.
 const bridge={x0:X+528,x1:1980,z:Z-88};
 const bridgeY=bridgeHeight;
 const segments=90,step=(bridge.x1-bridge.x0)/segments;
 for(let i=0;i<segments;i++){
   const x=bridge.x0+(i+.5)*step,y=bridgeY(x);b('Bridge deck',m.concrete,x,y-1,bridge.z,step+.08,2,26);
   b('Bridge asphalt',m.asphalt,x,y+.065,bridge.z,step+.1,.13,20);
   for(const s of [-1,1]){b('Bridge footpaths',m.concrete,x,y+.26,bridge.z+s*11.4,step+.08,.52,2.4);b('Bridge rails',m.metal,x,y+1.15,bridge.z+s*12.7,step+.08,.17,.16);}
   b('Bridge road line',m.white,x,y+.15,bridge.z,6,.02,.2);
   if(i%4===1){b('Bridge piers',m.concrete,x,(y-2)/2,bridge.z,5,y-2,17);lamp(x,y,bridge.z+11,Math.PI);}
 }
 // Two cable-stayed spans give the lagoon crossing a recognisable silhouette.
 function beam(name,material,a,c,r){const av=new THREE.Vector3(...a),cv=new THREE.Vector3(...c),v=cv.clone().sub(av);const mesh=new THREE.Mesh(new THREE.CylinderGeometry(r,r,v.length(),5),material);mesh.position.copy(av).add(cv).multiplyScalar(.5);mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),v.normalize());mesh.name=name;group.add(mesh);}
 for(const tx of [-430,780]){
   const ty=bridgeY(tx);for(const s of [-1,1]){b('Bridge towers',m.white,tx,ty+40,bridge.z+s*12,4,80,3.3);for(const dx of [-240,-170,-100,100,170,240])beam('Bridge cables',m.white,[tx,ty+76,bridge.z+s*12],[tx+dx,bridgeY(tx+dx)+.5,bridge.z+s*12],.20);}
   b('Bridge crossbars',m.white,tx,ty+68,bridge.z,5,3,27);
 }

 const A=AIRPORT,AY=A.y;
 // Airport: clear protected strip; apron and terminal remain on its west side.
 b('Airport grass',m.grass,A.x,AY+.025,A.z,1220,.05,2140);
 b('Runway',m.asphalt,A.runwayX,AY+.10,A.z,46,.2,A.runwayLength);
 for(const s of [-1,1])b('Runway edges',m.white,A.runwayX+s*21,AY+.22,A.z,.45,.02,1700);
 for(let z=A.z-785;z<A.z+790;z+=52)b('Runway centreline',m.white,A.runwayX,AY+.23,z,.7,.02,26);
 for(const s of [-1,1]){
   for(let k=-4;k<=4;k++)if(k!==0)b('Runway thresholds',m.white,A.runwayX+k*4.2,AY+.24,A.z+s*813,1.7,.02,32);
   for(const xx of [-12,12])b('Runway aiming points',m.white,A.runwayX+xx,AY+.24,A.z+s*610,6,.02,36);
 }
 b('Taxiway',m.asphalt,2585,AY+.09,A.z,22,.18,1650);
 for(const z of [A.z-750,A.z-250,A.z+250,A.z+750]){b('Taxiway',m.asphalt,2657,AY+.10,z,166,.2,22);b('Taxi lines',m.yellow,2657,AY+.23,z,166,.018,.23);}
 b('Taxi lines',m.yellow,2585,AY+.21,A.z,.25,.018,1620);
 b('Apron',m.concrete,2390,AY+.1,A.z,335,.2,620);
 b('Terminal glass',m.glass,2140,AY+9,A.z,105,18,380);
 b('Terminal roof',m.white,2140,AY+18.5,A.z,123,1.1,403);
 for(let z=A.z-180;z<A.z+190;z+=15)b('Terminal fins',m.white,2193,AY+9,z,.8,18,.6);
 for(let i=0;i<4;i++){
   const z=A.z-170+i*112;b('Jet bridges',m.glass,2236,AY+5.8,z,88,4,5);b('Jet bridge roofs',m.white,2236,AY+8,z,89,.5,6);
   b('Gate stands',m.yellow,2345,AY+.22,z,132,.02,.25);
   // Parked regional jets, in scale with the 46 m wide runway.
   const jet=new THREE.Group();jet.name=`Parked regional jet ${i+1}`;
   const body=new THREE.Mesh(new THREE.SphereGeometry(1,16,8),m.white);body.scale.set(1.35,1.45,15);jet.add(body);
   const wings=new THREE.Mesh(new THREE.BoxGeometry(27,.22,3.6),m.white);wings.position.z=1;jet.add(wings);
   const tail=new THREE.Mesh(new THREE.BoxGeometry(.18,4.4,3.5),m.glass);tail.position.set(0,2.1,12);jet.add(tail);
   const tailWing=new THREE.Mesh(new THREE.BoxGeometry(10,.18,2.3),m.white);tailWing.position.z=11;jet.add(tailWing);
   for(const s of [-1,1]){const engine=new THREE.Mesh(new THREE.CylinderGeometry(.8,.8,3.4,10).rotateX(Math.PI/2),m.metal);engine.position.set(s*4.5,-1,1);jet.add(engine);}
   for(const [x,z] of [[0,-10],[-2,3],[2,3]]){const gear=new THREE.Mesh(new THREE.BoxGeometry(.12,1.8,.12),m.metal);gear.position.set(x,-1.8,z);jet.add(gear);const wheel=new THREE.Mesh(new THREE.BoxGeometry(.35,.7,.7),m.rubber);wheel.position.set(x,-2.55,z);jet.add(wheel);}
   jet.position.set(2290,AY+3,z);jet.rotation.y=Math.PI/2;group.add(jet);
 }
 // Landside circulation, passenger entrances and parking connect directly to bridge.
 b('Airport access road',m.asphalt,1980,AY+.10,-2630,24,.2,1308);
 for(const z of [-2920,-3470])b('Airport access road',m.asphalt,2032,AY+.11,z,128,.2,18);
 b('Terminal forecourt',m.concrete,2063,AY+.24,A.z,42,.48,402);
 for(const z of [-3310,-3200,-3090]){b('Terminal entrance',m.white,2085,AY+3,z,.6,6,8);b('Terminal entrance glass',m.glass,2084.5,AY+2.8,z,.1,5.6,7.2);b('Terminal entrance canopy',m.roof,2077,AY+6.2,z,17,.4,14);bench(2063,AY+.48,z+14,Math.PI/2);palm(2050,AY+.48,z+30);}
 b('Car park',m.asphalt,2027,AY+.13,-3700,155,.26,235);
 for(let row=0;row<3;row++)for(let n=0;n<18;n++){const x=1962+row*52,z=-3800+n*11;b('Parking bays',m.white,x,AY+.28,z,13,.025,.14);if(rand()>.22)car(x,AY+.27,z+5,Math.PI/2,['#d9e5df','#749da4','#e1b875'][n%3]);}
 // ATC tower, hangars, boundary fence and approach lights.
 b('Control tower base',m.white,2220,AY+21,-3660,12,42,12);b('Control tower cab',m.glass,2220,AY+45,-3660,24,8,22);b('Control tower roof',m.roof,2220,AY+49.5,-3660,27,1,25);
 for(let i=0;i<3;i++){const z=-3840-i*140;b('Hangars',m.white,2385,AY+9,z,105,18,95);b('Hangar doors',m.metal,2438,AY+7.5,z,.2,15,75);b('Hangar roofs',m.roof,2385,AY+18.4,z,110,.8,100);b('Service aprons',m.concrete,2480,AY+.12,z,90,.24,106);}
 for(let z=A.z-1050;z<A.z+1050;z+=30){for(const x of [1900,3070])b('Airport fence posts',m.metal,x,AY+1.25,z,.10,2.5,.10);for(const x of [A.runwayX-25,A.runwayX+25])put('Runway edge lights',leaf,runwayLight,x,AY+.40,z,.27,.20,.27);}
 for(const x of [1900,3070])for(const y of [AY+.8,AY+2.3])b('Airport fence cables',m.metal,x,y,A.z,.04,.04,2100);
 // Signs are geometry-bound, including the runway numbers. No screen-facing billboards.
 function sign(text,x,y,z,w,h,a=0,horizontal=false){
   const c=document.createElement('canvas');c.width=1024;c.height=128;const cx=c.getContext('2d');cx.fillStyle=horizontal?'#303d42':'#163e46';cx.fillRect(0,0,c.width,c.height);cx.fillStyle='#f0eada';cx.textAlign='center';cx.textBaseline='middle';cx.font='600 65px Segoe UI';cx.fillText(text,512,64);
   const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=4;
   const mesh=new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshStandardMaterial({map:t,roughness:.7}));mesh.position.set(x,y,z);if(horizontal){mesh.rotation.x=-Math.PI/2;mesh.rotation.z=a;}else{mesh.rotation.y=a;const back=new THREE.Mesh(new THREE.BoxGeometry(w,h,.2),m.metal);back.position.set(x-Math.sin(a)*.11,y,z-Math.cos(a)*.11);back.rotation.y=a;group.add(back);}group.add(mesh);
 }
 sign('OCEANIA  /  INTERNATIONAL',2140,AY+13,-3009.8,97,8);
 sign('18',A.runwayX,AY+.26,A.z-759,16,19,Math.PI,true);sign('36',A.runwayX,AY+.26,A.z+759,16,19,0,true);
 sign('OCEANIA  •  LAGOON DISTRICT',X,Y+3.4,Z+476,75,5);
 // Compile each repeated component into one instanced batch.
 for(const [name,data] of batches){
   const mesh=new THREE.InstancedMesh(data.geometry.clone(),data.material,data.items.length);mesh.name=name;
   mesh.geometry.setAttribute('facadeSize',new THREE.InstancedBufferAttribute(new Float32Array(data.items.flatMap(v=>[v.w,v.h,v.d])),3));
   mesh.geometry.setAttribute('facadeSeed',new THREE.InstancedBufferAttribute(new Float32Array(data.items.flatMap(v=>[v.x,v.z])),2));
   data.items.forEach((v,i)=>{obj.position.set(v.x,v.y,v.z);obj.rotation.set(0,v.rot,0);obj.scale.set(v.w,v.h,v.d);obj.updateMatrix();mesh.setMatrixAt(i,obj.matrix);if(v.color)mesh.setColorAt(i,col.set(v.color));});
   mesh.computeBoundingSphere();group.add(mesh);data.mesh=mesh;
 }
 const towerMesh=batches.get('Towers 0').mesh;
 function update(daylight,rain){for(const f of facades)f.emissiveIntensity=(1-daylight)*1.8;glow.emissiveIntensity=(1-daylight)*3;runwayLight.emissiveIntensity=(1-daylight)*4;m.asphalt.roughness=.92-rain*.63;m.concrete.roughness=.88-rain*.33;}
 function clearance(x,z){let y=-Infinity;for(const v of buildings)if(inside([x,z],v.footprint))y=Math.max(y,v.y+v.h+12);if(x>=bridge.x0&&x<=bridge.x1&&Math.abs(z-bridge.z)<22){y=Math.max(y,bridgeY(x)+2);for(const tx of [-430,780])if(Math.abs(x-tx)<14)y=Math.max(y,bridgeY(tx)+80);}return y;}
 return {group,stats,buildings,roads,blocks,entrances,benchPositions,windowDensity,towerMesh,roofMat:m.roof,update,clearance,bridge,bridgeY};
}
