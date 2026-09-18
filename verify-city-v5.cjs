const {chromium}=require('C:/Users/sva/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict'),fs=require('node:fs');
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});try{
const page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
await page.goto('http://127.0.0.1:8765/?render=1');await page.waitForFunction(()=>window.flightReady,null,{timeout:60000});
const geometry=await page.evaluate(async()=>{
 const d=flight.inspect(),c=d.infrastructure,{inside,rectangle,coast}=await import('./urban-plan.js');
 function overlap(a,b){for(const poly of [a,b])for(let i=0;i<poly.length;i++){const p=poly[i],q=poly[(i+1)%poly.length],axis=[q[1]-p[1],p[0]-q[0]],aa=a.map(p=>p[0]*axis[0]+p[1]*axis[1]),bb=b.map(p=>p[0]*axis[0]+p[1]*axis[1]);if(Math.max(...aa)<Math.min(...bb)||Math.max(...bb)<Math.min(...aa))return false;}return true;}
 const roadPolys=c.roads.map(r=>rectangle((r.a[0]+r.b[0])/2,(r.a[1]+r.b[1])/2,r.width,Math.hypot(r.b[0]-r.a[0],r.b[1]-r.a[1]),Math.atan2(r.b[0]-r.a[0],r.b[1]-r.a[1])));
 const roadOverlaps=c.buildings.filter(b=>roadPolys.some(r=>overlap(b.footprint,r))).map(b=>[b.x,b.z]);
 const outsideBlocks=c.buildings.filter(b=>!b.footprint.every(p=>inside(p,c.blocks[b.block]))).length;
 const trees=d.forestPoints.filter(([x,y,z])=>d.reservedLand(x,z)).length;
 const wrongBases=c.buildings.filter(b=>Math.abs(d.ground(b.x,b.z)-12)>.03).length;
 const roadTerrainErrors=c.roads.flatMap(r=>[.1,.5,.9].map(t=>{const x=r.a[0]+(r.b[0]-r.a[0])*t,z=r.a[1]+(r.b[1]-r.a[1])*t;return {x,z,h:d.ground(x,z)};})).filter(p=>p.h>12.05||p.h<11.5);
 const bridgeErrors=[];for(let x=-1460;x<1980;x+=10)if(d.ground(x,c.bridge.z)>c.bridgeY(x)+.05)bridgeErrors.push(x);
 const runwayErrors=[];for(let z=-4030;z<-2370;z+=10)if(Math.abs(d.ground(2730,z)-28)>.01)runwayErrors.push(z);
 let cameras=0,lights=0;c.group.traverse(o=>{if(o.isCamera)cameras++;if(o.isLight)lights++;});
 const directions=c.roads.filter(r=>r.kind==='street').map(r=>Math.atan2(r.b[1]-r.a[1],r.b[0]-r.a[0])*180/Math.PI);
 const directionBins=new Set(directions.map(a=>Math.round(a/5))).size;
 const shoreCrossings=[];for(let x=-2580;x<=-1390;x+=35){let lo=-1700,hi=0;for(let i=0;i<25;i++){const z=(lo+hi)/2;if(d.ground(x,z)>0)lo=z;else hi=z;}shoreCrossings.push({x,z:(lo+hi)/2});}
 const marine=[];for(const name of ['Marina yacht hulls','Marina pontoons']){const mesh=c.group.getObjectByName(name),M=new (await import('./vendor/three.module.js')).Matrix4();for(let i=0;i<mesh.count;i++){mesh.getMatrixAt(i,M);const p=M.elements;if(d.ground(p[12],p[14])>0)marine.push([name,p[12],p[14]]);}}
 return {stats:c.stats,roadOverlaps,outsideBlocks,trees,wrongBases,roadTerrainErrors,bridgeErrors,runwayErrors,extraCameras:cameras,extraLights:lights,roofMap:!!c.roofMat.map,directionBins,shoreCrossings,marine};
});
console.log(JSON.stringify(geometry,null,2));assert.deepEqual(geometry.roadOverlaps,[]);assert.equal(geometry.outsideBlocks,0);assert.equal(geometry.trees,0);assert.equal(geometry.wrongBases,0);assert.deepEqual(geometry.roadTerrainErrors,[]);assert.deepEqual(geometry.bridgeErrors,[]);assert.deepEqual(geometry.runwayErrors,[]);assert.deepEqual(geometry.marine,[]);assert.equal(geometry.extraCameras,0);assert.equal(geometry.extraLights,0);assert.equal(geometry.roofMap,false);assert.ok(geometry.directionBins>12);assert.equal(Object.keys(geometry.stats.architecture).length,6);
const windows=await page.evaluate(async()=>{
 const T=await import('./vendor/three.module.js'),d=flight.inspect(),c=d.infrastructure,scene=new T.Scene(),camera=new T.OrthographicCamera(-300,300,150,-150,.1,100);camera.position.z=5;
 const source=c.towerMesh.material[0],mat=source.clone();mat.onBeforeCompile=source.onBeforeCompile;mat.customProgramCacheKey=source.customProgramCacheKey;mat.color.set(0);mat.emissive.set(0xffffff);mat.emissiveIntensity=1;
 const mesh=new T.InstancedMesh(new T.PlaneGeometry(1,1),mat,1);mesh.setMatrixAt(0,new T.Matrix4().makeScale(600,300,1));scene.add(mesh);
 const rt=new T.WebGLRenderTarget(1280,640),pixels=new Uint8Array(1280*640*4);const counts=[];
 for(const density of [.55,.275,.275]){c.windowDensity.value=density;d.renderer.setRenderTarget(rt);d.renderer.render(scene,camera);d.renderer.readRenderTargetPixels(rt,0,0,1280,640,pixels);let count=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i]>100)count++;counts.push(count);}
 d.renderer.setRenderTarget(null);c.windowDensity.value=.275;mesh.geometry.dispose();mat.dispose();rt.dispose();flight.step(0);return {before:counts[0],after:counts[1],repeat:counts[2],ratio:counts[1]/counts[0],density:c.windowDensity.value};
});assert.ok(windows.ratio>.47&&windows.ratio<.53);assert.equal(windows.after,windows.repeat);
for(const shot of [{name:'city-v5-day',hour:10,eye:[-950,720,-670],target:[-1980,40,-1880]},{name:'city-v5-night',hour:0,eye:[-1950,135,-1360],target:[-2100,80,-2060]},{name:'city-v5-architecture',hour:10,eye:[-1940,145,-1390],target:[-2050,50,-1950]}]){
 const image=await page.evaluate(({hour,eye,target})=>{flight.setEnvironment({hour,cycle:false,weather:'sun'},{immediate:true});const d=flight.inspect();d.cockpit.visible=d.aircraft.visible=false;d.camera.position.set(...eye);d.camera.lookAt(...target);d.atmosphere.apply(d.camera);d.ocean.material.uniforms.eye.value.copy(d.camera.position);d.renderer.render(d.scene,d.camera);return d.renderer.domElement.toDataURL().split(',')[1];},shot);fs.writeFileSync(__dirname+'/'+shot.name+'.png',Buffer.from(image,'base64'));
}
assert.deepEqual(errors,[]);const report={geometry,windows,errors};fs.writeFileSync(__dirname+'/verification-city-v5.json',JSON.stringify(report,null,2));console.log(JSON.stringify({windows,errors},null,2));
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1);});
