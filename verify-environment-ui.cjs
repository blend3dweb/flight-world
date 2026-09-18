const {chromium}=require('C:/Users/sva/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:8765/?v=3');await page.waitForFunction(()=>window.flightReady);
  await page.locator('#pause').click();await page.locator('#environment-panel summary').click();
  await page.locator('#time-of-day').focus();await page.keyboard.press('End');const end=await page.evaluate(()=>window.flight.getState());assert.ok(end.environment.hour>23.8);assert.equal(end.environment.cycle,false);assert.equal(end.auto,true);
  await page.keyboard.press('Home');assert.equal((await page.evaluate(()=>window.flight.getState().environment)).hour,0);
  await page.locator('[data-weather=rain]').click();assert.equal((await page.evaluate(()=>window.flight.getState().environment)).rain,1);
  await page.locator('[data-weather=snow]').click();assert.equal((await page.evaluate(()=>window.flight.getState().environment)).snow,1);
  await page.locator('#day-duration').selectOption('90');await page.locator('#day-cycle').click();assert.equal((await page.evaluate(()=>window.flight.getState().environment)).cycleSeconds,90);
  await page.locator('#auto-weather').click();assert.equal((await page.evaluate(()=>window.flight.getState().environment)).autoWeather,true);
  await page.evaluate(()=>window.flight.setEnvironment({hour:13,cycle:false,weather:'snow',autoWeather:false},{immediate:true}));await page.screenshot({path:__dirname+'/environment-controls.png'});
  await page.locator('#flight-location').selectOption('airport');let location=await page.evaluate(()=>flight.getState());assert.ok(Math.abs(location.x-2730)<3);assert.equal(location.environment.hour,13);assert.equal(location.environment.weather,'snow');
  await page.locator('#flight-location').selectOption('islands');location=await page.evaluate(()=>flight.getState());assert.ok(Math.abs(location.x+120)<3);
  await page.locator('#reset').click();assert.equal(await page.locator('#flight-location').inputValue(),'city');
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:__dirname+'/environment-mobile.png'});
  const fit=await page.locator('#environment-panel').evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<innerHeight;});assert.equal(fit,true);
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:['time slider keyboard input never steers aircraft','time slider stops automatic clock','manual rain and snow work on pause','cycle speed selection','automatic weather toggle','environment panel fits mobile','city/airport/islands selector and reset','relocation preserves weather and time'],errors},null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
