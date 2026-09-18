const {chromium}=require('C:/Users/sva/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const stage=process.argv[2]||'11-atmosphere-refinement',out=path.join(__dirname,'stages',stage);
if(fs.existsSync(path.join(out,'complete.json')))throw Error('Completed atmosphere audit is protected.');
fs.mkdirSync(out,{recursive:true});

(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true,args:['--force-high-performance-gpu','--use-webgpu-power-preference=high-performance']});try{
 const page=await browser.newPage({viewport:{width:1600,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto('http://127.0.0.1:8765/webgpu/index.html?test=1');await page.waitForFunction(()=>window.flightReady,null,{timeout:120000});
 const report=await page.evaluate(()=>{
  const d=flight.inspect(),cloud=()=>d.atmosphere.sky.material.uniforms.cloudOrigin.value.toArray(),sample=()=>({state:flight.getState().environment,cloud:cloud(),fog:d.scene.fog.color.getHexString(),fogDensity:d.scene.fog.density,exposure:d.renderer.toneMappingExposure,environmentIntensity:d.scene.environmentIntensity,rainVisible:d.atmosphere.precipitation.rain.visible,snowVisible:d.atmosphere.precipitation.snow.visible,wetness:d.terrainWetness.value});
  flight.setEnvironment({hour:10,cycle:false,weather:'sun',autoWeather:false},{immediate:true});flight.place({x:-1730,y:350,z:-1000,heading:0,pitch:0});flight.step(0);const sun=sample();
  flight.place({heading:2.1});flight.step(0);const rotated=sample();
  flight.place({x:-730,z:-500});flight.step(0);const translated=sample();
  flight.setEnvironment({weather:'rain'},{immediate:true});flight.step(0);const rain=sample();
  flight.setEnvironment({weather:'snow'},{immediate:true});flight.step(0);const snow=sample();
  flight.setEnvironment({hour:0,weather:'sun'},{immediate:true});flight.step(0);const night=sample();
  flight.setEnvironment({hour:23.8,cycle:true,cycleSeconds:90,weather:'rain'},{immediate:true});flight.step(1);const transition=sample();
  const beforePause=flight.getState().environment.elapsed;document.querySelector('#pause').click();flight.step(2);const afterPause=flight.getState().environment.elapsed;document.querySelector('#pause').click();
  const rainGeo=d.atmosphere.precipitation.rain.geometry,snowGeo=d.atmosphere.precipitation.snow.geometry,sizes=snowGeo.getAttribute('flakeSize');
  return {backend:d.renderer.backend.device.adapterInfo.vendor,sun,rotated,translated,rain,snow,night,transition,pause:{before:beforePause,after:afterPause},precipitation:{rainVertices:rainGeo.getAttribute('position').count,rainSeeds:rainGeo.getAttribute('particleSeed').count,snowInstances:d.atmosphere.precipitation.snow.count,snowGeometry:snowGeo.type,snowSizes:{count:sizes.count,min:Math.min(...sizes.array),max:Math.max(...sizes.array)}}};
 });
 assert.equal(report.backend,'nvidia');assert.deepEqual(report.rotated.cloud,report.sun.cloud);assert.ok(Math.abs(report.translated.cloud[0]-report.sun.cloud[0]-.16)<1e-5);assert.ok(Math.abs(report.translated.cloud[1]-report.sun.cloud[1]-.08)<1e-5);
 assert.equal(report.rain.rainVisible,true);assert.equal(report.rain.snowVisible,false);assert.equal(report.rain.wetness,1);assert.equal(report.snow.snowVisible,true);assert.equal(report.snow.rainVisible,false);assert.equal(report.snow.wetness,0);assert.ok(report.rain.fogDensity>report.sun.fogDensity);assert.ok(report.snow.fogDensity>report.sun.fogDensity);assert.ok(report.night.environmentIntensity<report.sun.environmentIntensity);assert.ok(report.transition.state.hour<1);assert.equal(report.pause.before,report.pause.after);
 assert.equal(report.precipitation.rainVertices,5200);assert.equal(report.precipitation.rainSeeds,5200);assert.equal(report.precipitation.snowInstances,1800);assert.equal(report.precipitation.snowGeometry,'OctahedronGeometry');assert.equal(report.precipitation.snowSizes.count,1800);assert.ok(report.precipitation.snowSizes.min>=.07&&report.precipitation.snowSizes.max<=.291);assert.deepEqual(errors,[]);
 fs.writeFileSync(path.join(out,'atmosphere-audit.json'),JSON.stringify({...report,errors},null,2));console.log(JSON.stringify({...report,errors},null,2));
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exit(1)});
