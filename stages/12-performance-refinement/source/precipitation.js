import * as T from './vendor/three.module.js';
import {uniform,attribute,positionGeometry,vec3,mix,uv,wgslFn} from './vendor/tsl.js';
const falling=wgslFn(`fn falling(p:vec3f,c:vec3f,t:f32,w:f32,s:f32,phase:f32)->vec3f{
 let size=mix(vec3f(150.,100.,150.),vec3f(130.,90.,130.),s);
 let variation=mix(.72,1.28,fract(sin(phase*91.7)*43758.5453));
 let speed=mix(vec3f(w*9.,-48.*variation,4.),vec3f(w*(1.2+variation),-4.2*variation,.8),s);
 let drift=vec3f(sin(t*.72+p.y*.08+phase*8.)*2.1,0.,cos(t*.51+p.x*.06+phase*11.)*1.6)*s;
 return fract((p+t*speed+drift-c)/size)*size-size*.5+c;
}`);
export function createPrecipitation(){
 let seed=4291;const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 function us(){return {center:uniform(new T.Vector3()),elapsed:uniform(0),wind:uniform(1),amount:uniform(0),daylight:uniform(1)};}
 const u=us(),v=us(),pos=[],tip=[],rainSeeds=[];
 for(let i=0;i<2600;i++){const p=[rand()*150,rand()*100,rand()*150],s=rand();pos.push(...p,...p);tip.push(0,1);rainSeeds.push(s,s);}
 const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(pos,3));geo.setAttribute('tip',new T.Float32BufferAttribute(tip,1));
 geo.setAttribute('particleSeed',new T.Float32BufferAttribute(rainSeeds,1));
 const rm=new T.LineBasicNodeMaterial({transparent:true,depthWrite:false});
 const rainSeed=attribute('particleSeed','float');
 rm.positionNode=falling({p:positionGeometry,c:u.center,t:u.elapsed,w:u.wind,s:0,phase:rainSeed}).add(vec3(u.wind.mul(-.24),rainSeed.mul(.85).add(.85),0).mul(attribute('tip','float')));
 rm.colorNode=mix(vec3(.30,.40,.53),vec3(.72,.81,.89),u.daylight);rm.opacityNode=u.amount.mul(.43);rm.uniforms=u;
 const rain=new T.LineSegments(geo,rm);rain.frustumCulled=false;rain.renderOrder=3;
 const sg=new T.OctahedronGeometry(1,0),offsets=[],flakeSeeds=[],flakeSizes=[];for(let i=0;i<1800;i++){offsets.push(rand()*130,rand()*90,rand()*130);flakeSeeds.push(rand());flakeSizes.push(.07+rand()*.22);}
 sg.setAttribute('flakeOffset',new T.InstancedBufferAttribute(new Float32Array(offsets),3));
 sg.setAttribute('flakeSeed',new T.InstancedBufferAttribute(new Float32Array(flakeSeeds),1));sg.setAttribute('flakeSize',new T.InstancedBufferAttribute(new Float32Array(flakeSizes),1));
 const sm=new T.MeshBasicNodeMaterial({transparent:true,depthWrite:false});const flakeSeed=attribute('flakeSeed','float');
 sm.positionNode=falling({p:attribute('flakeOffset','vec3'),c:v.center,t:v.elapsed,w:v.wind,s:1,phase:flakeSeed}).add(positionGeometry.mul(attribute('flakeSize','float')));
 sm.colorNode=mix(vec3(.54,.64,.78),vec3(.96,.98,1),v.daylight);sm.opacityNode=v.amount.mul(.80);sm.uniforms=v;
 const snow=new T.InstancedMesh(sg,sm,1800),identity=new T.Matrix4();for(let i=0;i<1800;i++)snow.setMatrixAt(i,identity);snow.frustumCulled=false;snow.renderOrder=4;
 return {rain,snow,update(center,t,r,s,daylight,wind){for(const [object,amount] of [[rain,r],[snow,s]]){object.visible=amount>.002;const u=object.material.uniforms;u.center.value.copy(center);u.elapsed.value=t;u.amount.value=amount;u.daylight.value=daylight;u.wind.value=wind;}}};
}
