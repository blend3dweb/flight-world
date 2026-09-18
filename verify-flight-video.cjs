const {chromium}=require('C:/Users/sva/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const out=path.join(__dirname,'exports'),fileName=process.argv[2]||'flight-world-tour.webm',url=`http://127.0.0.1:8765/exports/${fileName}`;
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});try{
 const page=await browser.newPage({viewport:{width:1600,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:8765/docs/README.md');
 await page.setContent('<style>*{box-sizing:border-box}html,body{margin:0;background:#000}video{display:block;width:1600px;height:900px}</style><video muted preload="auto"></video>');
 await page.evaluate(async source=>{const response=await fetch(source);if(!response.ok)throw Error(`video fetch ${response.status}`);const blob=await response.blob();document.querySelector('video').src=URL.createObjectURL(blob);},url);
 await page.waitForFunction(()=>{const v=document.querySelector('video');return v.readyState>=1&&Number.isFinite(v.duration);},null,{timeout:30000});
 const metadata=await page.locator('video').evaluate(v=>({duration:v.duration,width:v.videoWidth,height:v.videoHeight}));
 console.log(JSON.stringify(metadata));
 assert.ok(metadata.duration>=19&&metadata.duration<=22);assert.equal(metadata.width,1600);assert.equal(metadata.height,900);
 const frames=[];for(const second of [1,5,9,13,17]){await page.locator('video').evaluate((v,t)=>new Promise((resolve,reject)=>{v.currentTime=t;v.onseeked=resolve;v.onerror=()=>reject(v.error);}),second);const file=`flight-world-tour-${String(second).padStart(2,'0')}s.png`;await page.locator('video').screenshot({path:path.join(out,file)});frames.push(file);}
 assert.deepEqual(errors,[]);const report={file:fileName,bytes:fs.statSync(path.join(out,fileName)).size,...metadata,frames,errors};fs.writeFileSync(path.join(out,'video-audit.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
 }finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1)});
