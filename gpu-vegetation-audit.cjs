const {chromium}=require('C:/Users/sva/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const stage=process.argv[2]||'09-vegetation-refinement',stageRoot=path.join(__dirname,'stages',stage),out=path.join(stageRoot,'vegetation-audit');
if(fs.existsSync(path.join(stageRoot,'complete.json')))throw Error('Completed vegetation audit is protected. Choose a new output stage.');fs.mkdirSync(out,{recursive:true});
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true,args:['--force-high-performance-gpu','--use-webgpu-power-preference=high-performance']});try{
 const page=await browser.newPage({viewport:{width:1600,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto('http://127.0.0.1:8765/webgpu/index.html?render=1');await page.waitForFunction(()=>window.flightReady,null,{timeout:120000});
 const result=await page.evaluate(async()=>{
  const d=flight.inspect(),v=d.vegetation,frames={};flight.reset();flight.setEnvironment({hour:10,cycle:false,weather:'sun',autoWeather:false},{immediate:true});flight.step(8);
  async function shot(name,eye,target){const url=await flight.captureShot({eye,target});frames[name]=url;const image=new Image();image.src=url;await image.decode();const c=document.createElement('canvas');c.width=1600;c.height=900;const x=c.getContext('2d');x.drawImage(image,0,0);return x.getImageData(0,0,1600,900).data;}
  function difference(a,b){let changed=0,sum=0;for(let i=0;i<a.length;i+=4){const delta=Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2]);sum+=delta;if(delta>18)changed++;}return {changedPixels:changed,meanChannelDifference:sum/(a.length/4*3)};}
  const eye=[-3173,79,-1886],target=[-3263,32,-1976];await shot('00-warm',eye,target);const a=await shot('01-near',eye,target),repeat=await shot('02-repeat',eye,target);
  flight.step(1/30);const moved=await shot('03-wind-frame',eye,target);
  await shot('04-high',[-3750,1050,-5700],[-3650,100,-6900]);const high={nearVisible:v.tiles.some(t=>t.near.visible),nearCount:v.tiles.reduce((n,t)=>n+(t.near.visible?t.near.count:0),0),grassVisible:v.grassPatches.filter(p=>p.mesh.visible).length,shrubsVisible:v.shrub.visible};
  await shot('05-grass',[-3255,22.5,-1968],[-3263,21,-1976]);const near={nearCount:v.tiles.reduce((n,t)=>n+t.near.count,0),grassVisible:v.grassPatches.filter(p=>p.mesh.visible).length,detailMix:v.detailMix.value};
  const reservedShrubs=v.shrubPoints.filter(([x,,z])=>d.reservedLand(x,z)).length;
  let reservedGrass=0,undergroundGrass=0;for(const patch of v.grassPatches)for(let i=0;i<patch.positions.length;i+=3){const x=patch.positions[i],y=patch.positions[i+1],z=patch.positions[i+2];if(d.reservedLand(x,z))reservedGrass++;if(Math.abs(y-d.ground(x,z)-.025)>.01)undergroundGrass++;}
  const triangles=v.tiles.map(t=>({kind:t.kind,near:t.near.geometry.attributes.position.count/3,far:t.far.geometry.attributes.position.count/3}));
  return {frames,stats:v.stats,repeat:difference(a,repeat),motion:difference(a,moved),near,high,reservedShrubs,reservedGrass,undergroundGrass,triangles,backend:d.renderer.backend.device.adapterInfo.vendor};
 });
 for(const [name,url] of Object.entries(result.frames))fs.writeFileSync(path.join(out,name+'.png'),Buffer.from(url.split(',')[1],'base64'));delete result.frames;
 console.log(JSON.stringify(result,null,2));assert.equal(result.backend,'nvidia');assert.equal(result.stats.variants,4);assert.equal(result.stats.grassPatches,48);assert.ok(result.stats.shrubs>10000);assert.ok(result.near.nearCount>0&&result.near.nearCount<=result.stats.nearCapacity);assert.ok(result.near.grassVisible>0);assert.equal(result.high.nearCount,0);assert.equal(result.high.grassVisible,0);assert.equal(result.high.shrubsVisible,true);assert.equal(result.reservedShrubs,0);assert.equal(result.reservedGrass,0);assert.equal(result.undergroundGrass,0);assert.ok(result.repeat.meanChannelDifference<.02);assert.ok(result.motion.changedPixels>100);assert.deepEqual(errors,[]);result.errors=errors;
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1)});
