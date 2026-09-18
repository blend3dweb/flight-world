import * as T from './vendor/three.module.js';
import {uniform,attribute,positionGeometry,vec3,vec4,vec2,mix,cameraWorldMatrix,uv,wgslFn} from './vendor/tsl.js';
const falling=wgslFn(`fn falling(p:vec3f,c:vec3f,t:f32,w:f32,s:f32)->vec3f{
 let size=mix(vec3f(150.,100.,150.),vec3f(130.,90.,130.),s);
 let speed=mix(vec3f(w*9.,-48.,4.),vec3f(w*2.,-4.2,.8),s);
 let drift=vec3f(sin(t+p.y)*1.2,0.,cos(t*.6+p.y))*s;
 return fract((p+t*speed+drift-c)/size)*size-size*.5+c;
}`);
export function createPrecipitation(){
 let seed=4291;const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 function us(){return {center:uniform(new T.Vector3()),elapsed:uniform(0),wind:uniform(1),amount:uniform(0),daylight:uniform(1)};}
 const u=us(),v=us(),pos=[],tip=[];
 for(let i=0;i<2600;i++){const p=[rand()*150,rand()*100,rand()*150];pos.push(...p,...p);tip.push(0,1);}
 const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(pos,3));geo.setAttribute('tip',new T.Float32BufferAttribute(tip,1));
 const rm=new T.LineBasicNodeMaterial({transparent:true,depthWrite:false});
 rm.positionNode=falling({p:positionGeometry,c:u.center,t:u.elapsed,w:u.wind,s:0}).add(vec3(u.wind.mul(-.16),1.15,0).mul(attribute('tip','float')));
 rm.colorNode=mix(vec3(.30,.40,.53),vec3(.72,.81,.89),u.daylight);rm.opacityNode=u.amount.mul(.43);rm.uniforms=u;
 const rain=new T.LineSegments(geo,rm);rain.frustumCulled=false;rain.renderOrder=3;
 const sg=new T.PlaneGeometry(1,1),offsets=[];for(let i=0;i<1800;i++)offsets.push(rand()*130,rand()*90,rand()*130);
 sg.setAttribute('flakeOffset',new T.InstancedBufferAttribute(new Float32Array(offsets),3));
 const sm=new T.MeshBasicNodeMaterial({transparent:true,depthWrite:false,side:T.DoubleSide});
 sm.positionNode=falling({p:attribute('flakeOffset','vec3'),c:v.center,t:v.elapsed,w:v.wind,s:1}).add(cameraWorldMatrix.mul(vec4(positionGeometry.mul(.24),0)).xyz);
 sm.colorNode=mix(vec3(.48,.57,.72),vec3(.95,.97,1),v.daylight);sm.opacityNode=uv().sub(.5).length().smoothstep(.12,.5).oneMinus().mul(v.amount).mul(.92);sm.uniforms=v;
 const snow=new T.InstancedMesh(sg,sm,1800),identity=new T.Matrix4();for(let i=0;i<1800;i++)snow.setMatrixAt(i,identity);snow.frustumCulled=false;snow.renderOrder=4;
 return {rain,snow,update(center,t,r,s,daylight,wind){for(const [object,amount] of [[rain,r],[snow,s]]){object.visible=amount>.002;const u=object.material.uniforms;u.center.value.copy(center);u.elapsed.value=t;u.amount.value=amount;u.daylight.value=daylight;u.wind.value=wind;}}};
}
