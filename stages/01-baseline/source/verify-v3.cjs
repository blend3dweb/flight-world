const {chromium}=require('C:/Users/sva/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict');const fs=require('node:fs');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:900}});const errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto('http://127.0.0.1:8765/?render=1');await page.waitForFunction(()=>window.flightReady);
  await page.evaluate(()=>{window.flight.seek(10);window.flight.startFlight('islands');window.flight.setView('external');window.flight.setEnvironment({hour:11,cycle:false},{immediate:true});});
  const luminance=()=>page.evaluate(()=>{const c=window.flight.getCanvas(),p=c.getContext('2d').getImageData(300,600,240,50).data;let sum=0;for(let i=0;i<p.length;i+=4)sum+=(p[i]+p[i+1]+p[i+2])/3;return sum/(p.length/4);});
  const day=await luminance();await page.evaluate(()=>window.flight.setEnvironment({hour:0}));const night=await luminance();assert.ok(day>night*2);
  await page.evaluate(()=>{window.flight.setEnvironment({hour:23.99,cycle:true,cycleSeconds:90});window.flight.step(1);});const midnight=await page.evaluate(()=>window.flight.getState().environment);assert.ok(midnight.hour>=0&&midnight.hour<1);
  await page.keyboard.press('Space');const paused=await page.evaluate(()=>window.flight.getState());await page.evaluate(()=>window.flight.step(2));assert.equal((await page.evaluate(()=>window.flight.getState().environment)).hour,paused.environment.hour);
  await page.evaluate(()=>window.flight.setEnvironment({weather:'rain',hour:13,cycle:false}));const rain=await page.evaluate(()=>({state:window.flight.getState().environment,visible:window.flight.inspect().atmosphere.precipitation.rain.visible}));assert.equal(rain.state.rain,1);assert.equal(rain.visible,true);
  await page.evaluate(()=>window.flight.setEnvironment({weather:'snow'}));const snow=await page.evaluate(()=>({state:window.flight.getState().environment,visible:window.flight.inspect().atmosphere.precipitation.snow.visible}));assert.equal(snow.state.snow,1);assert.equal(snow.visible,true);
  await page.keyboard.press('Space');await page.evaluate(()=>{window.flight.setEnvironment({weather:'sun'});window.flight.step(8);});const clear=await page.evaluate(()=>window.flight.getState().environment);assert.ok(clear.snow<.04);
  await page.evaluate(()=>{window.flight.setEnvironment({weather:'sun',hour:11,cycle:false,autoWeather:false},{immediate:true});});
  // Feed a diagnostic red cubemap to the ocean only. Its rendered pixels must
  // respond while the visible sky, geometry and lighting remain unchanged.
  const reflection=await page.evaluate(async()=>{
    const THREE=await import('./vendor/three.module.js');const d=window.flight.inspect(),c=window.flight.getCanvas();
    function pixels(){d.renderer.render(d.scene,d.camera);const ctx=c.getContext('2d');ctx.drawImage(d.renderer.domElement,0,0,c.width,c.height);return ctx.getImageData(300,600,240,50).data;}
    const original=d.ocean.material.uniforms.environmentMap.value,baseline=pixels();
    const face=document.createElement('canvas');face.width=face.height=16;const fc=face.getContext('2d');fc.fillStyle='#f00';fc.fillRect(0,0,16,16);
    const probe=new THREE.CubeTexture(Array(6).fill(face));probe.needsUpdate=true;d.ocean.material.uniforms.environmentMap.value=probe;
    const changed=pixels();let delta=0;for(let i=0;i<changed.length;i+=4)delta+=Math.abs(changed[i]-baseline[i])+Math.abs(changed[i+1]-baseline[i+1])+Math.abs(changed[i+2]-baseline[i+2]);
    d.ocean.material.uniforms.environmentMap.value=original;probe.dispose();window.flight.step(0);
    return {meanChannelDelta:delta/(changed.length/4*3),sameSkyMap:d.scene.background===original,roofHasWindows:!!d.city.material[2].map};
  });assert.ok(reflection.meanChannelDelta>8);assert.equal(reflection.sameSkyMap,true);assert.equal(reflection.roofHasWindows,false);
  const resources=await page.evaluate(()=>{
    const d=window.flight.inspect(),before=d.renderer.info.memory.textures;
    for(let i=0;i<12;i++)window.flight.setEnvironment({hour:i*2,weather:['sun','rain','snow'][i%3]},{immediate:true});
    return {before,after:d.renderer.info.memory.textures};
  });assert.ok(resources.after<=resources.before+2);
  await page.evaluate(()=>{window.flight.reset();window.flight.setEnvironment({autoWeather:true,cycle:false});window.flight.step(46);});assert.equal((await page.evaluate(()=>window.flight.getState().environment)).weather,'rain');
  await page.evaluate(()=>window.flight.step(45));assert.equal((await page.evaluate(()=>window.flight.getState().environment)).weather,'snow');
  assert.deepEqual(errors,[]);
  const result={passed:['day and night change rendered ocean brightness','midnight wraps safely','pause freezes daylight cycle','rain and snow appear; manual weather works on pause','weather fades back to clear','ocean pixels respond to actual reflection map','sky and ocean use the same HDR cubemap','roofs still have no windows','reflection resources reused','automatic weather cycles through rain and snow'],dayLuminance:day,nightLuminance:night,reflection,resources,errors};
  fs.writeFileSync(__dirname+'/verification-v3.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
