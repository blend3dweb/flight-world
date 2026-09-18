const {chromium}=require('C:/Users/sva/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict'),path=require('node:path');

(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('response',response=>{if(response.status()>=400&&!response.url().endsWith('/favicon.ico'))errors.push(`${response.status()} ${response.url()}`);});
  await page.goto('http://127.0.0.1:8765/stages/index.html',{waitUntil:'networkidle'});
  const result=await page.evaluate(async()=>{
   const urls=[...document.images].map(image=>image.src),statuses=await Promise.all(urls.map(async url=>({url,status:(await fetch(url)).status})));
   return {title:document.querySelector('h1')?.textContent.trim(),cards:document.querySelectorAll('.cards .card').length,shots:document.querySelectorAll('.gallery figure').length,selected:document.querySelector('#shot')?.value,before:document.querySelector('#before')?.getAttribute('src'),after:document.querySelector('#after')?.getAttribute('src'),broken:statuses.filter(item=>item.status!==200)};
  });
  assert.equal(result.cards,13);assert.equal(result.shots,36);assert.equal(result.selected,'10-cockpit');
  assert.equal(result.before,'12-performance-refinement/10-cockpit.png');assert.equal(result.after,'13-reflection-stability/10-cockpit.png');
  assert.deepEqual(result.broken,[]);assert.deepEqual(errors,[]);
  await page.evaluate(()=>{for(const image of document.images)image.loading='eager';});
  await page.waitForFunction(()=>[...document.images].every(image=>image.complete&&image.naturalWidth),null,{timeout:30000});
  await page.screenshot({path:path.join(__dirname,'stages/gallery-preview.png'),fullPage:true});
  console.log(JSON.stringify({...result,errors},null,2));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1)});
