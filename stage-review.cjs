const {chromium}=require('C:/Users/sva/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const stage=process.argv[2]||'01-baseline',gpu=stage!=='01-baseline';
if(Number(stage.slice(0,2))<8&&fs.existsSync(path.join(__dirname,'stages',stage,'report.json')))throw Error('Archived stage is protected. Choose a new output stage.');
const out=path.join(__dirname,'stages',stage);fs.mkdirSync(out,{recursive:true});
if(fs.existsSync(path.join(out,'complete.json')))throw Error('Completed stage is protected. Choose a new output stage.');
const shots=[
 {name:'01-city-day',hour:10,eye:[-950,720,-670],target:[-1980,40,-1880]},
 {name:'02-city-sunset',hour:18.1,eye:[-950,720,-670],target:[-1980,40,-1880]},
 {name:'03-city-night',hour:0,eye:[-1950,135,-1360],target:[-2100,80,-2060]},
 {name:'04-rain',hour:12,weather:'rain',eye:[-1940,145,-1390],target:[-2050,50,-1950]},
 {name:'05-snow',hour:12,weather:'snow',eye:[-1940,145,-1390],target:[-2050,50,-1950]},
 {name:'06-bay-low',hour:10,eye:[-1850,9,-1130],target:[-2040,48,-1950]},
 {name:'07-bay-night',hour:0,eye:[-1850,9,-1130],target:[-2040,48,-1950]},
 {name:'08-vegetation-near',hour:10,vegetation:true},
 {name:'09-airport',hour:10,eye:[3500,670,-1890],target:[2450,28,-3240]},
 {name:'10-cockpit',hour:10,view:'cockpit'},
 {name:'11-aircraft-front',hour:10,view:'external',azimuth:3.8},
 {name:'12-aircraft-side',hour:18,view:'external',azimuth:1.6},
 {name:'13-forest-above',hour:10,eye:[-3750,1050,-5700],target:[-3650,100,-6900]}
];
if(Number(stage.slice(0,2))>=5)shots.push({name:'15-grass-detail',hour:10,grass:true});
if(Number(stage.slice(0,2))>=6)shots.push({name:'16-architecture',hour:10,eye:[-1940,90,-1390],target:[-2050,50,-1950]},{name:'17-rooftops',hour:10,eye:[-2020,250,-1980],target:[-2150,70,-2230]});
if(Number(stage.slice(0,2))>=8)shots.push(
 {name:'18-open-ocean',hour:10,time:8,eye:[-500,6,2000],target:[-2000,3,0]},
 {name:'19-bay-sunset',hour:18.1,time:8,eye:[-1850,9,-1130],target:[-2040,48,-1950]},
 {name:'20-shore',hour:10,time:8,eye:[-2200,18,-1290],target:[-2270,0,-1370]},
 {name:'21-bay-storm',hour:12,weather:'rain',time:8,eye:[-1850,9,-1130],target:[-2040,48,-1950]},
 {name:'22-ocean-above',hour:10,time:8,eye:[-500,800,1800],target:[-1400,0,-2400]}
);
if(Number(stage.slice(0,2))>=9)shots.push(
 {name:'23-forest-low',hour:10,time:8,eye:[-3173,79,-1886],target:[-3263,32,-1976]},
 {name:'24-canopy-side',hour:10,time:8,eye:[-3220,43,-1915],target:[-3263,28,-1976]},
 {name:'25-grass-close',hour:10,time:8,eye:[-3255,22.5,-1968],target:[-3263,21,-1976]},
 {name:'26-forest-lod',hour:10,time:8,eye:[-3210,235,-1810],target:[-3330,30,-2050]}
);
if(Number(stage.slice(0,2))>=10)shots.push(
 {name:'27-street-level',hour:10,time:8,eye:[-1940,22,-1390],target:[-2050,25,-1950]},
 {name:'28-waterfront-street',hour:10,time:8,eye:[-2310,22,-1400],target:[-2180,25,-1510]},
 {name:'29-terminal-ground',hour:10,time:8,eye:[1970,50,-3200],target:[2140,39,-3200]},
 {name:'30-city-low-flight',hour:18.1,time:8,eye:[-2400,110,-1300],target:[-2000,45,-1950]}
);
if(Number(stage.slice(0,2))>=11)shots.push(
 {name:'31-sunrise-horizon',hour:6.25,time:8,eye:[-500,720,1800],target:[-1700,40,-2200]},
 {name:'32-cloud-layers',hour:11,time:12,eye:[-3200,1350,-4200],target:[-3650,180,-6800]},
 {name:'33-night-sky',hour:0,time:8,eye:[-1800,120,-1300],target:[-2050,900,-2100]},
 {name:'34-rain-low',hour:12,weather:'rain',time:8,eye:[-1940,46,-1390],target:[-2050,28,-1950]},
 {name:'35-snow-low',hour:12,weather:'snow',time:8,eye:[-1940,46,-1390],target:[-2050,28,-1950]},
 {name:'36-sunset-reflection',hour:18.1,time:8,eye:[-1850,9,-1130],target:[-2040,48,-1950]}
);
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:!process.env.HEADED,args:['--disable-background-timer-throttling','--disable-renderer-backgrounding',...(process.env.FLIGHT_GPU==='nvidia'?['--force-high-performance-gpu','--use-webgpu-power-preference=high-performance']:[])]});try{
 const page=await browser.newPage({viewport:{width:1600,height:900}}),errors=[],warnings=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());if(m.type()==='warning')warnings.push(m.text());});
 if(stage==='11-atmosphere-before')for(const file of ['flight.js','atmosphere.js','sky-nodes.js','precipitation.js'])await page.route(`**/webgpu/${file}`,route=>route.fulfill({path:path.join(out,'source',file),contentType:'text/javascript'}));
 if(stage==='12-performance-before')for(const file of ['flight.js','atmosphere.js','ocean.js','vegetation.js'])await page.route(`**/webgpu/${file}`,route=>route.fulfill({path:path.join(out,'source',file),contentType:'text/javascript'}));
 await page.goto(`http://127.0.0.1:8765/${gpu?'webgpu/index.html':''}?render=1`);
 await page.waitForFunction(()=>window.flightReady,null,{timeout:120000});
 const report={stage,date:new Date().toISOString(),shots:[],checks:[],errors,warnings};
 report.backend=await page.evaluate(()=>{const r=flight.inspect().renderer;return {webgpu:!!r.backend?.isWebGPUBackend,revision:flight.revision||'180',adapter:r.backend?.device?.adapterInfo?{vendor:r.backend.device.adapterInfo.vendor,architecture:r.backend.device.adapterInfo.architecture}:null};});
 if(gpu)assert.equal(report.backend.webgpu,true,'Must use actual WebGPU backend');
 // Exercise user input and invariants, rather than testing only helper output.
 await page.keyboard.press('Space');const paused=await page.evaluate(()=>flight.getState());await page.evaluate(()=>flight.step(.5));assert.equal(await page.evaluate(()=>flight.getState().time),paused.time);
 await page.keyboard.press('Space');await page.keyboard.down('ArrowRight');await page.evaluate(()=>{for(let i=0;i<60;i++)flight.step(1/30);});await page.keyboard.up('ArrowRight');assert.ok(await page.evaluate(()=>!flight.getState().auto&&flight.getState().roll<0));
 await page.keyboard.press('KeyR');await page.keyboard.press('KeyV');assert.equal(await page.evaluate(()=>flight.getState().viewMode),'external');
 await page.keyboard.press('KeyO');const orbit0=await page.evaluate(()=>flight.getState().orbit.azimuth);await page.evaluate(()=>flight.step(.5));assert.notEqual(await page.evaluate(()=>flight.getState().orbit.azimuth),orbit0);
 report.checks.push('pause','manual bank','external camera','orbit during flight');
 const environment=await page.evaluate(()=>{flight.reset();flight.setEnvironment({hour:23.8,cycle:true,cycleSeconds:90});flight.step(1);const h=flight.getState().environment.hour;flight.setEnvironment({weather:'rain'},{immediate:true});const rain=flight.getState().environment.rain;flight.setEnvironment({weather:'snow'},{immediate:true});const snow=flight.getState().environment.snow;return {h,rain,snow};});assert.ok(environment.h<1);assert.equal(environment.rain,1);assert.equal(environment.snow,1);report.checks.push('midnight wrap','rain','snow');
 report.geometry=await page.evaluate(()=>{const d=flight.inspect(),c=d.infrastructure;return {buildings:c.buildings.length,entrances:c.entrances.length,windowDensity:c.windowDensity.value,roofMap:!!c.roofMat.map,reservedTrees:d.forestPoints.filter(([x,y,z])=>d.reservedLand(x,z)).length,runwayHeight:d.ground(2730,-3200),stats:c.stats};});assert.equal(report.geometry.windowDensity,.275);assert.equal(report.geometry.reservedTrees,0);assert.equal(report.geometry.roofMap,false);assert.equal(report.geometry.runwayHeight,28);assert.equal(report.geometry.entrances,report.geometry.buildings);report.checks.push('window density','roof material','forest exclusion','runway','entrances');
 if(Number(stage.slice(0,2))>=7){
  report.quality=await page.evaluate(()=>{
   const result=[];for(const value of ['low','balanced','high']){flight.setQuality(value);const d=flight.inspect();result.push({value,width:d.renderer.domElement.width,height:d.renderer.domElement.height,reflection:d.water.planar.reflector.resolutionScale});}return result;
  });assert.deepEqual(report.quality.map(q=>[q.width,q.height]),[[1040,585],[1312,738],[1600,900]]);report.checks.push('quality profiles');
  report.lod=await page.evaluate(async()=>{
   const d=flight.inspect(),p=d.vegetation.grassPatches[0];
   await flight.captureShot({eye:[p.x+8,p.y+2,p.z+8],target:[p.x,p.y,p.z]});
   const near={trees:d.vegetation.tiles.reduce((n,t)=>n+t.near.count,0),grass:d.vegetation.grassPatches.filter(p=>p.mesh.visible).length};
   await flight.captureShot({eye:[p.x,p.y+1100,p.z+50],target:[p.x,p.y,p.z]});
   const far={trees:d.vegetation.tiles.reduce((n,t)=>n+(t.near.visible?t.near.count:0),0),grass:d.vegetation.grassPatches.filter(p=>p.mesh.visible).length};
   return {near,far};
  });assert.ok(report.lod.near.trees>0&&report.lod.near.trees<=1536);assert.ok(report.lod.near.grass>0);assert.equal(report.lod.far.trees,0);assert.equal(report.lod.far.grass,0);report.checks.push('near vegetation and altitude LOD');
 }
 for(const shot of shots){
  const result=await page.evaluate(async s=>{
   flight.reset();flight.setEnvironment({hour:s.hour,cycle:false,weather:s.weather||'sun',autoWeather:false},{immediate:true});if(s.time)flight.step(s.time);
   if(s.view){flight.setView(s.view);if(s.view==='external')flight.setOrbit({azimuth:s.azimuth,elevation:.18,distance:30,auto:false});flight.step(0);return {state:flight.getState(),image:flight.getCanvas().toDataURL()};}
   const d=flight.inspect();let eye=s.eye,target=s.target;
   if(s.grass){const p=d.vegetation.grassPatches[0];eye=[p.x+8,p.y+2,p.z+8];target=[p.x,p.y+.5,p.z];}
   if(s.vegetation){const p=d.forestPoints.find(p=>p[0]>-3300&&p[0]<-3000&&p[2]>-2300&&p[2]<-1800)||d.forestPoints[0];eye=[p[0]+90,Math.max(p[1]+55,d.ground(p[0]+90,p[2]+90)+55),p[2]+90];target=[p[0],p[1]+12,p[2]];}
   if(flight.captureShot){const image=await flight.captureShot({eye,target});return {eye,target,state:flight.getState(),image};}
   d.cockpit.visible=d.aircraft.visible=false;d.camera.position.set(...eye);d.camera.lookAt(...target);d.atmosphere.apply(d.camera);d.ocean.material.uniforms.eye.value.copy(d.camera.position);d.renderer.render(d.scene,d.camera);
   return {eye,target,state:flight.getState(),image:d.renderer.domElement.toDataURL()};
  },shot);
  fs.writeFileSync(path.join(out,shot.name+'.png'),Buffer.from(result.image.split(',')[1],'base64'));delete result.image;report.shots.push({...shot,...result});console.log(stage,shot.name);
 }
 await page.evaluate(()=>{flight.reset();flight.setEnvironment({hour:10,cycle:false});});
 report.frameTiming=await page.evaluate(async()=>{const times=[];for(let i=0;i<150;i++){const t=performance.now();flight.step(1/60);await new Promise(requestAnimationFrame);if(i>29)times.push(performance.now()-t);}times.sort((a,b)=>a-b);return {mode:'headless RAF diagnostic, not desktop FPS guarantee',medianMs:times[Math.floor(times.length*.5)],p95Ms:times[Math.floor(times.length*.95)],samples:times.length};});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(out,'14-mobile.png')});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),390);report.checks.push('mobile viewport');
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
 fs.writeFileSync(path.join(out,'index.html'),`<!doctype html><meta charset="utf-8"><title>${stage}</title><style>body{background:#14232b;color:#eee;font:16px system-ui;margin:24px}main{display:grid;grid-template-columns:repeat(2,1fr);gap:20px}img{width:100%}figure{margin:0}a{color:#cfe7b9}</style><h1>${stage}</h1><p><a href="report.json">Отчёт проверок</a></p><main>${[...shots.map(s=>s.name),'14-mobile'].map(n=>`<figure><a href="${n}.png"><img src="${n}.png"></a><figcaption>${n}</figcaption></figure>`).join('')}</main>`);
 assert.deepEqual(errors,[]);console.log(JSON.stringify({stage,checks:report.checks,backend:report.backend,frameTiming:report.frameTiming,errors},null,2));
 }finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1)});
