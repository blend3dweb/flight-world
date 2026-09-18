const {chromium}=require('C:/Users/sva/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
(async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1600,height:900}});const errors=[];
    page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    await page.goto('http://127.0.0.1:8765/?render=1');await page.waitForFunction(()=>window.flightReady);
    await page.evaluate(()=>window.flight.seek(12));
    const cloudBefore=await page.evaluate(()=>Array.from(window.flight.inspect().clouds.instanceMatrix.array));
    await page.keyboard.press('KeyV');const external=await page.evaluate(()=>window.flight.getState());assert.equal(external.viewMode,'external');assert.equal(external.auto,true);
    await page.mouse.move(780,420);await page.mouse.down();await page.mouse.move(1060,490,{steps:8});await page.mouse.up();
    const dragged=await page.evaluate(()=>window.flight.getState());assert.equal(dragged.auto,true);assert.notEqual(dragged.orbit.azimuth,external.orbit.azimuth);assert.equal(dragged.heading,external.heading);
    await page.mouse.wheel(0,200);const zoomed=await page.evaluate(()=>window.flight.getState());assert.ok(zoomed.orbit.distance>dragged.orbit.distance);
    await page.keyboard.press('KeyO');await page.evaluate(()=>{for(let i=0;i<60;i++)window.flight.step(1/30);});
    const moving=await page.evaluate(()=>window.flight.getState());assert.ok(moving.time>zoomed.time);assert.notEqual(moving.z,zoomed.z);assert.notEqual(moving.orbit.azimuth,zoomed.orbit.azimuth);
    const cloudAfter=await page.evaluate(()=>Array.from(window.flight.inspect().clouds.instanceMatrix.array));assert.deepEqual(cloudAfter,cloudBefore);
    const materials=await page.evaluate(()=>{const {city,clouds,scene}=window.flight.inspect();let sprites=0;scene.traverse(o=>{if(o.isSprite)sprites++;});return {roofHasMap:!!city.material[2].map,wallHasMap:!!city.material[0].map,cloudsAreMesh:clouds.isInstancedMesh,sprites};});
    assert.equal(materials.roofHasMap,false);assert.equal(materials.wallHasMap,true);assert.equal(materials.sprites,0);
    await page.evaluate(()=>{window.flight.setOrbit({azimuth:.9,elevation:.28,distance:19,auto:false});});await page.screenshot({path:__dirname+'/external-preview.png'});
    for(const [name,angle,elevation] of [['side',1.57,.16],['front',3.1,.15],['below',2.3,-.32]]){
      await page.evaluate(([azimuth,elevation])=>window.flight.setOrbit({azimuth,elevation}),[angle,elevation]);await page.screenshot({path:__dirname+`/external-${name}.png`});
    }
    await page.keyboard.press('KeyV');assert.equal((await page.evaluate(()=>window.flight.getState())).viewMode,'cockpit');
    // Close views of actual world geometry, for visual roof and shoreline review.
    for(const [name,pos,target] of [['roofs',[-3500,690,-11600],[-3500,150,-10800]],['shore',[-1200,45,-550],[-1600,0,-900]],['water-low',[-200,65,600],[0,20,-3500]]]){
      await page.evaluate(({pos,target})=>{
        const d=window.flight.inspect();d.cockpit.visible=false;d.aircraft.visible=false;d.camera.position.set(...pos);d.camera.lookAt(...target);d.ocean.material.uniforms.eye.value.copy(d.camera.position);d.renderer.render(d.scene,d.camera);
        const c=window.flight.getCanvas();c.getContext('2d').drawImage(d.renderer.domElement,0,0,c.width,c.height);
      },{pos,target});await page.screenshot({path:__dirname+`/review-${name}.png`});
    }
    await page.keyboard.press('KeyV');await page.setViewportSize({width:390,height:844});await page.screenshot({path:__dirname+'/mobile-external.png'});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),390);
    assert.deepEqual(errors,[]);
    const report={passed:['mouse orbits without steering or stopping the aircraft','zoom changes camera distance','automatic orbit and flight advance together','cloud geometry stays fixed in world coordinates','no billboard sprites','roof material has no windows; walls keep windows','return to cockpit','portrait view fits'],errors,materials};
    fs.writeFileSync(__dirname+'/verification-v2.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
