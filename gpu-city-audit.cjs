const {chromium}=require('C:/Users/sva/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict'),fs=require('node:fs');
const outputStage=process.argv[2]||'06-city';if(Number(outputStage.slice(0,2))<8&&fs.existsSync(__dirname+'/stages/'+outputStage+'/geometry-audit.json'))throw Error('Archived geometry audit is protected. Choose a new output stage.');
if(fs.existsSync(__dirname+'/stages/'+outputStage+'/complete.json'))throw Error('Completed geometry audit is protected. Choose a new output stage.');
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true,args:['--force-high-performance-gpu','--use-webgpu-power-preference=high-performance']});try{
const page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
await page.goto('http://127.0.0.1:8765/webgpu/index.html?render=1');await page.waitForFunction(()=>window.flightReady,null,{timeout:120000});
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
 await flight.captureShot({eye:[-1940,22,-1390],target:[-2050,25,-1950]});
 const detailNames=['Bus stop glass','Street planters','Bike rack posts','Street bollards','Storefront mullions'],nearDetails=Object.fromEntries(detailNames.map(name=>[name,c.group.getObjectByName(name)?.visible??false]));
 await flight.captureShot({eye:[8000,2000,8000],target:[-2000,20,-1900]});
 const farDetails=Object.fromEntries(detailNames.map(name=>[name,c.group.getObjectByName(name)?.visible??false]));
 return {stats:c.stats,roadOverlaps,outsideBlocks,trees,wrongBases,roadTerrainErrors,bridgeErrors,runwayErrors,extraCameras:cameras,extraLights:lights,roofMap:!!c.roofMat.map,directionBins,shoreCrossings,marine,detailVisibility:{near:nearDetails,far:farDetails}};
});
console.log(JSON.stringify(geometry,null,2));assert.deepEqual(geometry.roadOverlaps,[]);assert.equal(geometry.outsideBlocks,0);assert.equal(geometry.trees,0);assert.equal(geometry.wrongBases,0);assert.deepEqual(geometry.roadTerrainErrors,[]);assert.deepEqual(geometry.bridgeErrors,[]);assert.deepEqual(geometry.runwayErrors,[]);assert.deepEqual(geometry.marine,[]);assert.equal(geometry.extraCameras,0);assert.equal(geometry.extraLights,0);assert.equal(geometry.roofMap,false);assert.ok(geometry.directionBins>12);assert.equal(Object.keys(geometry.stats.architecture).length,6);
if(Number(outputStage.slice(0,2))>=10){for(const key of ['busStops','planters','bikeRacks','bollards','storefronts','balconies','landmarks'])assert.ok(geometry.stats[key]>0,`${key} must be populated`);assert.ok(Object.values(geometry.detailVisibility.near).some(Boolean));assert.ok(Object.values(geometry.detailVisibility.far).every(value=>!value));}
fs.writeFileSync(__dirname+'/stages/'+(process.argv[2]||'06-city')+'/geometry-audit.json',JSON.stringify({geometry,errors},null,2));assert.deepEqual(errors,[]); }finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1)});
