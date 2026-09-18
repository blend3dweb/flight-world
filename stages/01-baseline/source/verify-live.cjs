const {chromium}=require('C:/Users/sva/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict');
(async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1440,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto('http://127.0.0.1:8765/?v=2');await page.waitForFunction(()=>window.flightReady);
    await page.locator('#view').click();await page.locator('#orbit').click();
    const before=await page.evaluate(()=>window.flight.getState());
    await page.waitForFunction(t=>window.flight.getState().time>t+1,before.time,{timeout:30000});
    const after=await page.evaluate(()=>window.flight.getState());assert.equal(after.viewMode,'external');assert.ok(after.orbit.azimuth>before.orbit.azimuth);assert.notEqual(after.z,before.z);
    await page.locator('#pause').click();const paused=await page.evaluate(()=>window.flight.getState());
    await page.mouse.move(720,350);await page.mouse.down();await page.mouse.move(850,410,{steps:4});await page.mouse.up();
    const inspected=await page.evaluate(()=>window.flight.getState());assert.equal(inspected.time,paused.time);assert.notEqual(inspected.orbit.azimuth,paused.orbit.azimuth);assert.equal(inspected.auto,true);
    await page.screenshot({path:__dirname+'/live-controls.png'});
    await page.setViewportSize({width:390,height:844});await page.screenshot({path:__dirname+'/mobile-controls.png'});
    const fits=await page.locator('#controls').evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;});assert.ok(fits);
    assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:['visible buttons switch view and start orbit','real animation advances flight and camera','paused plane remains still during mouse inspection','controls fit mobile viewport'],errors},null,2));
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
