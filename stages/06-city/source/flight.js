import * as THREE from './vendor/three.module.js';
import { createVegetation } from './vegetation.js';
import { createOcean } from './ocean.js';
import { positionWorld, sin, cos, attribute } from './vendor/tsl.js';
import { createAircraft } from './aircraft.js';
import { createAtmosphere } from './atmosphere.js';
import { createCity } from './city.js';
import { urbanHeight, reservedLand, PADS, URBAN_GLSL } from './city-layout.js';

// Seeded procedural world. No remote assets or services are needed at runtime.
const canvas = document.querySelector('#flight');
const ctx = canvas.getContext('2d', { alpha: false });
const params = new URLSearchParams(location.search);
const offlineRender = params.has('render');
if (offlineRender) document.documentElement.classList.add('render');
let seed = 418;
const random = () => { seed = (Math.imul(1664525, seed) + 1013904223) >>> 0; return seed / 4294967296; };
const clamp = THREE.MathUtils.clamp;
const lerp = THREE.MathUtils.lerp;
const rad = Math.PI / 180;
const noise = (x, z) => Math.sin(x*.0021 + Math.cos(z*.0031)*1.8)*Math.cos(z*.0027) + .45*Math.sin(x*.0093+z*.0061) + .2*Math.cos(x*.025-z*.019);
const islands = [
  [-2000,-1900,1450,1950,230], [2500,-3300,1780,2300,360],
  [-3650,-6800,2200,2600,390], [1700,-8700,1200,1850,265],
  [5600,-7600,2600,3600,340], [-6000,-12700,3100,2800,290],
  [200,-14100,2850,2500,490], [8000,-15800,3500,3700,400],
  [-6400,-2600,1200,1900,220], [7200,1300,1700,1600,210],
  [750,-900,340,570,64], [-700,-5100,380,620,85],
];
function islandHeight(x,z,a) {
  const dx=(x-a[0])/a[2], dz=(z-a[1])/a[3];
  const edge=1-Math.hypot(dx,dz)+noise(x,z)*.085;
  const natural=edge<0?-3+edge*150:Math.pow(edge,1.65)*a[4]*(.8+.22*noise(x*.9,z*.9))+Math.min(edge*95,8)-3;
  return urbanHeight(x,z,natural,islands.indexOf(a));
}
function ground(x,z) { let h=-15; for(const a of islands) h=Math.max(h,islandHeight(x,z,a)); return h; }

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2('#b0d0d0', .000046);
const camera = new THREE.PerspectiveCamera(66,1,.2,60000);
camera.rotation.order='YXZ';
const renderer = new THREE.WebGPURenderer({ antialias: true, alpha: false, logarithmicDepthBuffer:true, powerPreference:'high-performance' });
await renderer.init();
if(!renderer.backend.isWebGPUBackend)throw new Error('WebGPU недоступен. Откройте сцену в браузере с поддержкой WebGPU.');
renderer.setPixelRatio(1);renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFShadowMap;
renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.toneMapping=THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure=1.05;
const hemisphere=new THREE.HemisphereLight('#c3e9ff','#485d38',1.45);scene.add(hemisphere);
const sunlight = new THREE.DirectionalLight('#fff0d0',3.1);
sunlight.castShadow=true;sunlight.shadow.mapSize.set(1024,1024);sunlight.shadow.normalBias=1;sunlight.shadow.bias=-.0001;Object.assign(sunlight.shadow.camera,{left:-1400,right:1400,top:1400,bottom:-1400,near:10000,far:19000});sunlight.shadow.camera.updateProjectionMatrix();
sunlight.position.set(-9000,11000,-17000); scene.add(sunlight);
const sunDir=new THREE.Vector3(-.42,.52,-.74).normalize();

const atmosphere=createAtmosphere({renderer,scene,sunlight,hemisphere,sunDir});

const water=createOcean({renderer,scene,atmosphere,sunDir,ground});
const {ocean,uniforms:seaUniforms}=water;scene.add(ocean);

const terrainMaterial = new THREE.MeshStandardNodeMaterial({roughness:1});
terrainMaterial.colorNode=attribute('color','vec3').mul(sin(positionWorld.x.mul(.16)).mul(sin(positionWorld.z.mul(.18))).mul(.045).add(.95));
for(const a of islands){
  // Keep shoreline sampling fine enough for the same height function used by water.
  const spacing=a===islands[0]?8:24,limit=a===islands[0]?640:384;
  const nx=clamp(Math.ceil(a[2]*2.35/spacing),64,limit),nz=clamp(Math.ceil(a[3]*2.35/spacing),64,limit);
  const geo=new THREE.PlaneGeometry(a[2]*2.35,a[3]*2.35,nx,nz);geo.rotateX(-Math.PI/2);geo.translate(a[0],0,a[1]);
  const p=geo.attributes.position, colors=[];const c=new THREE.Color();
  for(let i=0;i<p.count;i++){
    const x=p.getX(i),z=p.getZ(i),h=islandHeight(x,z,a);p.setY(i,h);
    const n=noise(x*2,z*2)*.5+.5;
    const beachBlend=THREE.MathUtils.smoothstep(h,1,13),forestBlend=THREE.MathUtils.smoothstep(h,17,35);
    c.setRGB(lerp(.42+n*.06,.06+n*.02,beachBlend),lerp(.39+n*.06,.095+n*.027,beachBlend),lerp(.26+n*.06,.026+n*.012,beachBlend));
    c.r=lerp(c.r,.013+n*.012,forestBlend);c.g=lerp(c.g,.043+n*.022,forestBlend);c.b=lerp(c.b,.021+n*.012,forestBlend);
    colors.push(c.r,c.g,c.b);
  }
  geo.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geo.computeVertexNormals();const groundMesh=new THREE.Mesh(geo,terrainMaterial);groundMesh.receiveShadow=true;scene.add(groundMesh);
}

// Canopies at several scales make the islands read as dense forest in motion.
const forestPoints=[];
for(let i=0;i<150000;i++){
  const a=islands[Math.floor(random()*islands.length)],x=a[0]+(random()*2-1)*a[2],z=a[1]+(random()*2-1)*a[3];
  const h=islandHeight(x,z,a);
  if(h>13&&!reservedLand(x,z))forestPoints.push([x,h,z,13+random()*18]);
}
const vegetation=createVegetation({points:forestPoints,ground,reservedLand});const forest=vegetation.group;scene.add(forest);

// City and airport share the terrain pads and the existing environment lighting.
const infrastructure=createCity();scene.add(infrastructure.group);
const city=infrastructure.towerMesh,roofMat=infrastructure.roofMat,windowTex=null;

// The atmospheric skybox supplies world-oriented cloud layers.
// A few anchored sailboats and wakes establish scale near the islands.
const hullMat=new THREE.MeshStandardMaterial({color:'#f1eee0',roughness:.6});
for(let i=0;i<32;i++){
  const x=(random()-.5)*10000,z=1800-random()*15000;if(ground(x,z)>-4)continue;
  const boat=new THREE.Group();const hull=new THREE.Mesh(new THREE.BoxGeometry(5,3,17),hullMat);hull.position.y=2;boat.add(hull);
  const sailGeo=new THREE.BufferGeometry();sailGeo.setAttribute('position',new THREE.Float32BufferAttribute([0,4,6,0,28,-1,0,4,-7],3));sailGeo.computeVertexNormals();boat.add(new THREE.Mesh(sailGeo,new THREE.MeshStandardMaterial({color:'#fff9e6',side:THREE.DoubleSide})));
  boat.position.set(x,0,z);boat.rotation.y=random()*6;scene.add(boat);
}

// Camera-relative aircraft: nose, windscreen sill, and two slim struts.
const cockpit=new THREE.Group();camera.add(cockpit);scene.add(camera);
const metal=new THREE.MeshStandardMaterial({color:'#343e3e',metalness:.7,roughness:.3});
const nose=new THREE.Mesh(new THREE.SphereGeometry(1,40,24),new THREE.MeshStandardMaterial({color:'#e6ded0',metalness:.32,roughness:.34}));
nose.scale.set(.68,.26,1.6);nose.position.set(0,-1.12,-2.6);cockpit.add(nose);
const stripe=new THREE.Mesh(new THREE.SphereGeometry(1,32,16),new THREE.MeshStandardMaterial({color:'#c6a24d',metalness:.25,roughness:.45}));stripe.scale.set(.075,.264,1.6);stripe.position.copy(nose.position);cockpit.add(stripe);
function strut(a,b,r){const dir=new THREE.Vector3().subVectors(b,a);const m=new THREE.Mesh(new THREE.CylinderGeometry(r,r,dir.length(),12),metal);m.position.copy(a).add(b).multiplyScalar(.5);m.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),dir.normalize());cockpit.add(m);}
strut(new THREE.Vector3(-1.5,-1,-1.55),new THREE.Vector3(-2.25,1.6,-1.9),.038);
strut(new THREE.Vector3(1.5,-1,-1.55),new THREE.Vector3(2.25,1.6,-1.9),.038);
const sill=new THREE.Mesh(new THREE.BoxGeometry(5,.12,.3),metal);sill.position.set(0,-1.04,-1.75);cockpit.add(sill);
const {aircraft,propeller}=createAircraft();scene.add(aircraft);
const flightRotation=new THREE.Euler(0,0,0,'YXZ');
const orbitOffset=new THREE.Vector3();
const orbit={azimuth:.8,elevation:.26,distance:21,auto:false};
let viewMode='cockpit';

const initial={x:-1730,y:350,z:-1000,heading:.10,pitch:-.035,roll:0,speed:82,throttle:.73,time:0,auto:true,paused:false};
let state={...initial}, prevAltitude=state.y,verticalSpeed=0,showCockpit=true,recording=false,rafLast=0,drawCount=0;
const keys=new Set();let pointer={down:false,x:0,y:0};
const accent='#d7efb5',white='#edf5ef',muted='#adc5c5';
let W=1600,H=900;
function resize(){W=canvas.width=Math.round(innerWidth* Math.min(devicePixelRatio,1.5));H=canvas.height=Math.round(innerHeight*Math.min(devicePixelRatio,1.5));renderer.setSize(W,H,false);camera.aspect=W/H;camera.updateProjectionMatrix();draw();}
function text(str,x,y,size=13,color=white,align='left',font='mono') {ctx.fillStyle=color;ctx.font=`${size>=28?'500':'400'} ${size}px ${font==='mono'?'Consolas, monospace':'Segoe UI, sans-serif'}`;ctx.textAlign=align;ctx.textBaseline='middle';ctx.fillText(str,x,y);}
function line(x,y,xx,yy,color='#d9f1d36b',width=1){ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(xx,yy);ctx.stroke();}
function panel(x,y,w,h,alpha=.55){ctx.fillStyle=`rgba(7,28,37,${alpha})`;ctx.beginPath();ctx.roundRect(x,y,w,h,8);ctx.fill();ctx.strokeStyle='#d5e8dc25';ctx.lineWidth=1;ctx.stroke();}
function appear(start,fn){ctx.save();ctx.globalAlpha=clamp((state.time-start)/1.2,0,1);fn();ctx.restore();}
const headingDegrees=()=>((-state.heading/rad)%360+360)%360;
function tape(x,y,value,label,unit,side){
  const s=side==='left'?1:-1;const align=s===1?'left':'right';
  text(label,x,y-100,11,muted,align,'sans');text(Math.round(value).toString().padStart(3,'0'),x,y-61,42,white,align);text(unit,x,y-29,11,accent,align);
  line(x,y+1,x+s*89,y+1,'#dce9d969');
  ctx.save();ctx.beginPath();ctx.rect(Math.min(x,x+s*92),y+12,92,135);ctx.clip();
  const spacing=side==='left'?10:100;
  for(let v=Math.floor(value/spacing)*spacing-spacing*3;v<value+spacing*4;v+=spacing){const yy=y+78-(v-value)/spacing*28;line(x,yy,x+s*14,yy,'#c1d9d886');text(String(Math.round(v)),x+s*23,yy,11,'#d0dfdccc',align);}
  ctx.restore();ctx.fillStyle=accent;ctx.beginPath();ctx.moveTo(x+s*83,y+78);ctx.lineTo(x+s*93,y+72);ctx.lineTo(x+s*93,y+84);ctx.fill();
}
function map(x,y){
  panel(x,y,230,174,.65);text('АРХИПЕЛАГ',x+17,y+22,10,muted,'left','sans');text('N ↑',x+212,y+22,10,accent,'right');
  ctx.save();ctx.beginPath();ctx.rect(x+10,y+38,210,121);ctx.clip();
  for(const a of islands){ctx.fillStyle='#5e847969';ctx.beginPath();ctx.ellipse(x+115+(a[0]-state.x)*.009,y+108+(a[1]-state.z)*.009,a[2]*.009,a[3]*.009,-.1,0,Math.PI*2);ctx.fill();}
  for(const [px,pz,label] of [[-2000,-1900,'ГОРОД'],[2730,-3200,'АЭРОПОРТ']]){const mx=x+115+(px-state.x)*.009,my=y+108+(pz-state.z)*.009;ctx.fillStyle=accent;ctx.fillRect(mx-2,my-2,4,4);text(label,mx+6,my,7,accent);}
  ctx.setLineDash([3,6]);line(x+115,y+166,x+109,y+42,'#d6ebbc66');ctx.setLineDash([]);
  ctx.translate(x+115,y+110);ctx.rotate(-state.heading);ctx.fillStyle=accent;ctx.beginPath();ctx.moveTo(0,-8);ctx.lineTo(5,6);ctx.lineTo(0,3);ctx.lineTo(-5,6);ctx.closePath();ctx.fill();ctx.restore();
  text('МАСШТАБ  5 КМ',x+17,y+159,9,muted);line(x+170,y+158,x+211,y+158,muted,2);
}
function hud(){
  const portrait=W/H<.85,scale=portrait?W/600:Math.min(W/1600,H/900),vw=W/scale,vh=H/scale-(portrait?100:0);ctx.save();ctx.scale(scale,scale);
  // A subtle vignette improves the small instrument text without obscuring the view.
  const grad=ctx.createLinearGradient(0,0,0,vh);grad.addColorStop(0,'#0b23334f');grad.addColorStop(.24,'#071d2900');grad.addColorStop(.70,'#071d2900');grad.addColorStop(1,'#031b3177');ctx.fillStyle=grad;ctx.fillRect(0,0,vw,vh);
  appear(0,()=>{
    text('A E R O',40,43,25,white,'left','sans');line(40,68,80,68,accent,2);text('01  /  OCEANIA FLIGHT',96,69,10,muted);
    const env=atmosphere.getState();
    text(`${formatHour(env.hour)}  ·  ${{sun:'ЯСНО',rain:'ДОЖДЬ',snow:'СНЕГ'}[env.weather]}`,vw-40,40,12,white,'right','sans');text('OCEANIA  /  LAGOON DISTRICT',vw-40,64,11,muted,'right');
  });
  appear(1.2,()=>{
    ctx.save();if(portrait)ctx.translate(0,85);
    panel(vw/2-240,25,480,62,.34);
    ctx.save();ctx.beginPath();ctx.rect(vw/2-222,29,444,53);ctx.clip();
    const hdg=headingDegrees();for(let d=Math.floor(hdg/5)*5-45;d<hdg+45;d+=5){let x=vw/2+(d-hdg)*6;const num=(d%360+360)%360;line(x,63,x,d%10===0?52:57,'#e8f5dcaa');if(d%10===0)text(num===0?'N':String(num).padStart(3,'0'),x,41,10,white,'center');}
    ctx.restore();ctx.fillStyle=accent;ctx.beginPath();ctx.moveTo(vw/2-4,73);ctx.lineTo(vw/2+4,73);ctx.lineTo(vw/2,66);ctx.fill();
    text(`${Math.round(hdg).toString().padStart(3,'0')}°`,vw/2,100,16,accent,'center');
    ctx.restore();
  });
  appear(2,()=>{tape(44,vh*.36,state.speed*1.94384,'СКОРОСТЬ','KTS','left');tape(vw-44,vh*.36,state.y*3.28084,'ВЫСОТА','FT','right');});
  appear(3,()=>{
    const cx=vw/2,cy=vh*.46;
    if(viewMode==='cockpit'){
    ctx.save();ctx.translate(cx,cy);ctx.rotate(state.roll);
    const pitchOffset=state.pitch*600;
    for(let v=-20;v<=20;v+=5){const yy=v*8+pitchOffset;if(Math.abs(yy)>120)continue;const wide=v===0?95:42;line(-wide,yy,-17,yy,'#e2f6cd66');line(17,yy,wide,yy,'#e2f6cd66');if(v!==0){text(String(Math.abs(v)),wide+12,yy,10,'#effadd8a');}}
    ctx.restore();line(cx-33,cy,cx-12,cy,accent,1.5);line(cx+12,cy,cx+33,cy,accent,1.5);line(cx,cy-7,cx,cy+4,accent,1.5);ctx.strokeStyle=accent;ctx.beginPath();ctx.arc(cx,cy,6,0,Math.PI*2);ctx.stroke();
    text(state.auto?'АВТОПИЛОТ':'РУЧНОЕ УПРАВЛЕНИЕ',cx,cy+153,11,accent,'center','sans');
    }else{
      text(orbit.auto?'АВТОМАТИЧЕСКИЙ ОБЛЁТ':'ОСМОТР САМОЛЁТА',cx,vh-(portrait?267:152),12,accent,'center','sans');
      text(state.auto?'АВТОПИЛОТ':'РУЧНОЕ УПРАВЛЕНИЕ',cx,vh-(portrait?242:127),10,white,'center','sans');
    }
    text(`V/S  ${verticalSpeed>=0?'+':''}${Math.round(verticalSpeed*196.85/10)*10} FT/MIN`,vw-44,vh*.36+169,11,white,'right');
  });
  appear(4,()=>{
    map(40,vh-217);panel(vw-256,vh-217,216,174,.65);
    text('ДВИГАТЕЛЬ',vw-239,vh-195,10,muted,'left','sans');text('НОРМА',vw-57,vh-195,10,accent,'right','sans');
    text('THR',vw-239,vh-160,11,muted);text(`${Math.round(state.throttle*100)} %`,vw-57,vh-160,20,white,'right');
    ctx.fillStyle='#d9e7da20';ctx.fillRect(vw-239,vh-141,181,3);ctx.fillStyle=accent;ctx.fillRect(vw-239,vh-141,181*state.throttle,3);
    text('RPM',vw-239,vh-115,11,muted);text(String(Math.round(1700+state.throttle*1100)),vw-57,vh-115,16,white,'right');
    text('FUEL',vw-239,vh-83,11,muted);text(`${(84-state.time*.0018).toFixed(1)} %`,vw-57,vh-83,16,white,'right');
    text('ВЕТЕР  042° / 08 KTS',40,vh-24,10,white);text('C172  /  N–042',vw-40,vh-24,10,white,'right');
  });
  if(state.time<6){const a=clamp((state.time-.25)/1.2,0,1)*clamp((6-state.time)/1.5,0,1);ctx.globalAlpha=a;text('НАД ОСТРОВАМИ',vw/2,vh*.71,29,white,'center','sans');text('ПОЧУВСТВУЙТЕ ПОЛЁТ',vw/2,vh*.71+35,11,accent,'center','sans');ctx.globalAlpha=1;}
  if(state.paused){panel(vw/2-77,vh/2-23,154,46,.8);text('ПАУЗА',vw/2,vh/2,16,accent,'center','sans');}
  if(recording){ctx.fillStyle='#f58369';ctx.beginPath();ctx.arc(vw/2+265,44,4,0,Math.PI*2);ctx.fill();text('REC',vw/2+280,44,11,white);}
  ctx.restore();
}
function update(dt){
  if(state.paused)return;
  atmosphere.advance(dt);
  if(viewMode==='external'&&orbit.auto)orbit.azimuth+=dt*Math.PI/9;
  state.time+=dt;prevAltitude=state.y;
  if(state.auto){
    const t=state.time;state.roll=lerp(state.roll,.12*Math.sin(t*.19)-.07*Math.sin(t*.37),Math.min(1,dt*2));
    state.pitch=lerp(state.pitch,-.022+.021*Math.sin(t*.22),Math.min(1,dt));
    state.heading+=Math.sin(state.roll)*dt*.18;
    state.throttle=.73+.035*Math.sin(t*.12);
  }else{
    const rollIn=(keys.has('ArrowLeft')||keys.has('KeyA')?1:0)-(keys.has('ArrowRight')||keys.has('KeyD')?1:0)-(pointer.down?pointer.x:0);
    const pitchIn=(keys.has('ArrowDown')||keys.has('KeyS')?1:0)-(keys.has('ArrowUp')||keys.has('KeyW')?1:0)+(pointer.down?pointer.y:0);
    state.roll=lerp(state.roll,rollIn*.55,Math.min(1,dt*2.4));state.pitch=clamp(state.pitch+pitchIn*dt*.22,-.35,.35);
    state.heading+=Math.sin(state.roll)*dt*.34;
    state.throttle=clamp(state.throttle+((keys.has('ShiftLeft')||keys.has('ShiftRight')?1:0)-(keys.has('ControlLeft')||keys.has('ControlRight')?1:0))*dt*.15,.25,1);
  }
  state.speed=lerp(state.speed,49+state.throttle*48-state.pitch*35,Math.min(1,dt*.5));
  state.x-=Math.sin(state.heading)*state.speed*dt;state.z-=Math.cos(state.heading)*state.speed*dt;state.y+=Math.sin(state.pitch)*state.speed*dt;
  // This is a scenic experience: terrain clearance prevents entering the islands.
  state.y=Math.max(state.y,ground(state.x,state.z)+50,infrastructure.clearance(state.x,state.z)+35,55);
  state.y=Math.min(state.y,4500);verticalSpeed=lerp(verticalSpeed,(state.y-prevAltitude)/Math.max(dt,.00001),Math.min(1,dt*3));
  if(Math.hypot(state.x,state.z)>23000){state.x=initial.x;state.z=initial.z;state.heading=0;toast('Возвращаемся к архипелагу');}
}
function draw(){
  aircraft.position.set(state.x,state.y+Math.sin(state.time*1.8)*.25,state.z);
  flightRotation.set(state.pitch,state.heading,state.roll,'YXZ');aircraft.quaternion.setFromEuler(flightRotation);
  aircraft.visible=viewMode==='external';propeller.rotation.z=state.time*(90+state.throttle*90);
  if(viewMode==='external'){
    const angle=orbit.azimuth+state.heading;
    orbitOffset.set(Math.sin(angle)*Math.cos(orbit.elevation),Math.sin(orbit.elevation),Math.cos(angle)*Math.cos(orbit.elevation)).multiplyScalar(orbit.distance);
    camera.position.copy(aircraft.position).add(orbitOffset);
    camera.position.y=Math.max(camera.position.y,ground(camera.position.x,camera.position.z)+5);
    camera.up.set(0,1,0);camera.lookAt(aircraft.position);
  }else{
    camera.position.copy(aircraft.position);camera.rotation.copy(flightRotation);
  }
  water.update?.(camera);vegetation.update(camera,state.time,atmosphere.wind);
  atmosphere.apply(camera);
  const weather=atmosphere.getState();
  seaUniforms.daylight.value=atmosphere.daylight;seaUniforms.fogDensity.value=atmosphere.fogDensity;seaUniforms.rainAmount.value=weather.rain;seaUniforms.snowAmount.value=weather.snow;seaUniforms.wind.value=atmosphere.wind;
  infrastructure.update(atmosphere.daylight,weather.rain,camera);
  cockpit.visible=viewMode==='cockpit'&&showCockpit;seaUniforms.time.value=state.time;seaUniforms.eye.value.copy(camera.position);
  renderer.render(scene,camera);ctx.drawImage(renderer.domElement,0,0,W,H);hud();syncEnvironmentUI();drawCount++;
}
function frame(now){const dt=Math.min((now-(rafLast||now))/1000,.05);rafLast=now;update(dt);draw();if(!offlineRender)requestAnimationFrame(frame);}
let hintTimer;
function toast(message){const el=document.querySelector('#hint');el.textContent=message;el.classList.add('show');clearTimeout(hintTimer);hintTimer=setTimeout(()=>el.classList.remove('show'),5000);}
function syncButtons(){document.querySelector('#auto').setAttribute('aria-pressed',state.auto);document.querySelector('#pause').setAttribute('aria-pressed',state.paused);document.querySelector('#pause').textContent=state.paused?'Продолжить':'Пауза';document.querySelector('#cockpit').setAttribute('aria-pressed',showCockpit);document.querySelector('#cockpit').disabled=viewMode==='external';document.querySelector('#view').setAttribute('aria-pressed',viewMode==='external');document.querySelector('#orbit').hidden=viewMode!=='external';document.querySelector('#orbit').setAttribute('aria-pressed',orbit.auto);}
function setView(mode){viewMode=mode==='external'?'external':'cockpit';pointer.down=false;pointer.x=pointer.y=0;syncButtons();draw();}
function setOrbit(values){
  if(Number.isFinite(values.azimuth))orbit.azimuth=values.azimuth;
  if(Number.isFinite(values.elevation))orbit.elevation=clamp(values.elevation,-.6,1.35);
  if(Number.isFinite(values.distance))orbit.distance=clamp(values.distance,11,65);
  if(typeof values.auto==='boolean')orbit.auto=values.auto;
  syncButtons();draw();
}
function manual(){if(state.auto){state.auto=false;syncButtons();toast('Стрелки / WASD — крен и тангаж · Shift / Ctrl — тяга · P — автопилот');}}
function reset(){document.querySelector('#flight-location').value='city';state={...initial};atmosphere.reset();verticalSpeed=0;keys.clear();pointer.down=false;pointer.x=pointer.y=0;viewMode='cockpit';Object.assign(orbit,{azimuth:.8,elevation:.26,distance:21,auto:false});syncButtons();draw();}
function startFlight(location){
  const starts={city:initial,airport:{x:2730,y:200,z:-2030,heading:0},islands:{x:-120,y:490,z:2000,heading:0}};
  if(!starts[location])return;
  const environment=atmosphere.getState();reset();Object.assign(state,starts[location]);state.time=5;
  atmosphere.set(environment,{immediate:true});document.querySelector('#flight-location').value=location;draw();
}
document.querySelector('#flight-location').onchange=e=>startFlight(e.target.value);
function formatHour(hour){const minute=Math.floor(hour*60)%1440;return `${String(Math.floor(minute/60)).padStart(2,'0')}:${String(minute%60).padStart(2,'0')}`;}
function syncEnvironmentUI(){
  const env=atmosphere.getState();document.querySelector('#clock-label').textContent=formatHour(env.hour);
  const range=document.querySelector('#time-of-day');if(document.activeElement!==range)range.value=env.hour;
  document.querySelector('#day-cycle').setAttribute('aria-pressed',env.cycle);
  const duration=document.querySelector('#day-duration');if([...duration.options].some(o=>Number(o.value)===env.cycleSeconds))duration.value=String(env.cycleSeconds);
  document.querySelector('#auto-weather').setAttribute('aria-pressed',env.autoWeather);
  document.querySelectorAll('[data-weather]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.weather===env.weather));
}
function setEnvironment(values,options){atmosphere.set(values,options??{immediate:state.paused});draw();}
document.querySelector('#time-of-day').addEventListener('input',e=>setEnvironment({hour:Number(e.target.value),cycle:false}));
document.querySelector('#day-duration').onchange=e=>setEnvironment({cycleSeconds:Number(e.target.value)});
document.querySelector('#day-cycle').onclick=()=>setEnvironment({cycle:!atmosphere.getState().cycle});
document.querySelector('#auto-weather').onclick=()=>setEnvironment({autoWeather:!atmosphere.getState().autoWeather});
document.querySelectorAll('[data-weather]').forEach(b=>b.onclick=()=>setEnvironment({weather:b.dataset.weather,autoWeather:false}));
document.querySelector('#auto').onclick=()=>{state.auto=!state.auto;syncButtons();toast(state.auto?'Автопилот включён':'Стрелки / WASD — управление · Shift / Ctrl — тяга · Можно потянуть экран мышью');};
document.querySelector('#pause').onclick=()=>{state.paused=!state.paused;syncButtons();draw();};
document.querySelector('#cockpit').onclick=()=>{showCockpit=!showCockpit;syncButtons();draw();};
document.querySelector('#view').onclick=()=>{setView(viewMode==='external'?'cockpit':'external');toast(viewMode==='external'?'Потяните мышью — осмотр · Колёсико — расстояние · O — облёт · V — в кабину':'Вид из кабины · Стрелки / WASD — управление');};
document.querySelector('#orbit').onclick=()=>setOrbit({auto:!orbit.auto});
document.querySelector('#reset').onclick=reset;
document.querySelector('#fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{toast('Полноэкранный режим недоступен в этом окне');}};
document.addEventListener('keydown',e=>{
  if(e.target.closest?.('#environment-panel'))return;
  if(e.target instanceof HTMLButtonElement && ['Space','Enter'].includes(e.code))return;
  if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space','ControlLeft','ControlRight'].includes(e.code))e.preventDefault();
  if(e.repeat)return;keys.add(e.code);
  if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','KeyW','KeyA','KeyS','KeyD'].includes(e.code))manual();
  if(e.code==='KeyP')document.querySelector('#auto').click();if(e.code==='Space')document.querySelector('#pause').click();if(e.code==='KeyC')document.querySelector('#cockpit').click();if(e.code==='KeyR')reset();
  if(e.code==='KeyV')document.querySelector('#view').click();
  if(e.code==='KeyO'){if(viewMode!=='external')setView('external');setOrbit({auto:!orbit.auto});}
  if(viewMode==='external'&&['Equal','NumpadAdd','Minus','NumpadSubtract'].includes(e.code))setOrbit({distance:orbit.distance*(e.code==='Equal'||e.code==='NumpadAdd'?.9:1.1)});
});
document.addEventListener('keyup',e=>keys.delete(e.code));window.addEventListener('blur',()=>{keys.clear();pointer.down=false;});
canvas.addEventListener('pointerdown',e=>{
  if(!e.isPrimary||e.button!==0)return;
  if(viewMode==='cockpit')manual();else orbit.auto=false;
  canvas.focus();pointer={down:true,x:0,y:0,startX:e.clientX,startY:e.clientY,azimuth:orbit.azimuth,elevation:orbit.elevation};canvas.setPointerCapture(e.pointerId);syncButtons();
});
canvas.addEventListener('pointermove',e=>{if(pointer.down&&e.isPrimary){
  if(viewMode==='external'){orbit.azimuth=pointer.azimuth-(e.clientX-pointer.startX)*.008;orbit.elevation=clamp(pointer.elevation+(e.clientY-pointer.startY)*.006,-.6,1.35);draw();}
  else{pointer.x=clamp((e.clientX-pointer.startX)/200,-1,1);pointer.y=clamp((e.clientY-pointer.startY)/220,-1,1);}
}});
canvas.addEventListener('pointerup',()=>pointer.down=false);canvas.addEventListener('pointercancel',()=>pointer.down=false);
canvas.addEventListener('lostpointercapture',()=>pointer.down=false);
canvas.addEventListener('wheel',e=>{if(viewMode==='external'){e.preventDefault();setOrbit({distance:orbit.distance*Math.exp(clamp(e.deltaY,-300,300)*.001)});}},{passive:false});
document.querySelector('#record').onclick=()=>{
  if(recording)return;
  if(!canvas.captureStream||typeof MediaRecorder==='undefined'){toast('Этот браузер не поддерживает запись. Готовый MP4 находится в папке проекта.');return;}
  const type=['video/mp4;codecs=avc1.42001E','video/webm;codecs=vp9','video/webm'].find(t=>MediaRecorder.isTypeSupported(t));
  if(!type){toast('Не найден поддерживаемый формат записи');return;}
  const stream=canvas.captureStream(30);let rec;
  try{rec=new MediaRecorder(stream,{mimeType:type,videoBitsPerSecond:10000000});}catch{stream.getTracks().forEach(t=>t.stop());toast('Не удалось запустить запись');return;}
  const chunks=[];recording=true;state.paused=false;syncButtons();const button=document.querySelector('#record');button.textContent='Запись 20 с…';button.disabled=true;
  const cleanup=()=>{recording=false;stream.getTracks().forEach(t=>t.stop());button.textContent='● Запись';button.disabled=false;};
  rec.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};rec.onerror=()=>{cleanup();toast('Ошибка записи видео');};
  rec.onstop=()=>{cleanup();const blob=new Blob(chunks,{type});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`aero-flight.${type.startsWith('video/mp4')?'mp4':'webm'}`;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);toast('Видео сохранено в загрузки');};
  rec.start();setTimeout(()=>{if(rec.state==='recording')rec.stop();},20000);
};
// Deterministic frame stepping lets the MP4 exporter include every HUD pixel.
window.flight={revision:THREE.REVISION,getState:()=>({...state,verticalSpeed,drawCount,viewMode,orbit:{...orbit},environment:atmosphere.getState(),camera:camera.position.toArray(),triangles:renderer.info.render.triangles}),reset,setView,setOrbit,setEnvironment,startFlight,step(dt){update(dt);draw();},seek(t){reset();for(let i=0;i<Math.floor(t*30);i++)update(1/30);draw();},setSize(w,h){W=canvas.width=w;H=canvas.height=h;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();draw();},getCanvas:()=>canvas};
window.flight.captureShot=async({eye,target})=>{cockpit.visible=aircraft.visible=false;camera.position.set(...eye);camera.lookAt(...target);water.update?.(camera);vegetation.update(camera,state.time,atmosphere.wind);atmosphere.apply(camera);infrastructure.update(atmosphere.daylight,atmosphere.getState().rain,camera);seaUniforms.eye.value.copy(camera.position);renderer.render(scene,camera);await renderer.backend.device.queue.onSubmittedWorkDone();return renderer.domElement.toDataURL();};
if(offlineRender)window.flight.inspect=()=>({scene,camera,renderer,aircraft,cockpit,atmosphere,water,vegetation,city,roofMat,windowTex,ocean,ground,islandHeight,islands,infrastructure,forest,forestPoints,reservedLand,PADS});
window.addEventListener('resize',resize);resize();document.querySelector('#loading').remove();window.flightReady=true;
if(!offlineRender){requestAnimationFrame(frame);toast('Полёт начался · Стрелки / WASD — взять управление · P — автопилот');}
