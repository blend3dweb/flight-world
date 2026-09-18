import * as T from './vendor/three.module.js';
import {uniform,positionWorld,positionGeometry,modelWorldMatrix,cameraPosition,vec2,vec3,vec4,mix,screenUV,cubeTexture,reflect,normalize,dot,pow,texture,reflector,wgslFn,smoothstep} from './vendor/tsl.js';
import {noise2} from './sky-nodes.js';
const waveField=wgslFn(`fn waveField(p:vec2f,t:f32,wind:f32)->vec3f{
 var result=vec3f(0.);
 for(var i=0;i<6;i++){
  let fi=f32(i);let angle=.37+fi*2.39996;let direction=vec2f(cos(angle),sin(angle));
  let len=180./pow(1.82,fi);let k=6.283185/len;let a=.43/pow(1.9,fi)*(1.+wind*.32);
  let phase=dot(p,direction)*k-t*sqrt(9.81*k)+fi*1.31;
  result+=vec3f(direction.x*k*a*cos(phase),a*sin(phase),direction.y*k*a*cos(phase));
 }
 return result;
}`);
function heightTexture(ground,size,bounds){
 const data=new Uint16Array(size*size);const [x,z,w,h]=bounds;
 for(let j=0;j<size;j++)for(let i=0;i<size;i++)data[j*size+i]=T.DataUtils.toHalfFloat(ground(x+(i+.5)/size*w,z+(j+.5)/size*h));
 const map=new T.DataTexture(data,size,size,T.RedFormat,T.HalfFloatType);map.minFilter=map.magFilter=T.LinearFilter;map.needsUpdate=true;return map;
}
export function createOcean({scene,atmosphere,sunDir,ground}){
 const uniforms={time:uniform(0),sun:uniform(sunDir),eye:uniform(new T.Vector3()),daylight:uniform(1),rainAmount:uniform(0),snowAmount:uniform(0),wind:uniform(1),fogDensity:uniform(.000032),reflectionStrength:uniform(1)};
 const globalBounds=[-15000,-24000,32000,32000],localBounds=[-4000,-4000,4300,4300];
 const heightMap=heightTexture(ground,1024,globalBounds),coastMap=heightTexture(ground,768,localBounds);
 const heightAt=(p)=>{const localUV=p.sub(vec2(...localBounds.slice(0,2))).div(4300),edge=localUV.sub(.5).abs().x.max(localUV.sub(.5).abs().y),weight=edge.smoothstep(.46,.49).oneMinus();return mix(texture(heightMap,p.sub(vec2(-15000,-24000)).div(32000)).r,texture(coastMap,localUV).r,weight);};
 const t=uniforms.time,world=modelWorldMatrix.mul(vec4(positionGeometry,1)).xyz;
 const depth=heightAt(positionWorld.xz).negate();
 
 // Named WGSL arguments must match the shader signature.
 const field=(p)=>waveField({p,t,wind:uniforms.wind});
 const dist=cameraPosition.distance(positionWorld),calm=smoothstep(0,16,depth);
 const slope=field(positionWorld.xz);
 const micro=vec2(noise2(positionWorld.xz.mul(.16).add(vec2(t.mul(.5),0))),noise2(positionWorld.zx.mul(.21).sub(vec2(t.mul(.35),0)))).sub(.5).mul(.13).mul(smoothstep(250,2400,dist).oneMinus());
 const n=normalize(vec3(slope.x.negate().mul(calm).add(micro.x),1,slope.z.negate().mul(calm).add(micro.y)));
 const v=normalize(cameraPosition.sub(positionWorld)),f=pow(dot(n,v).max(0).oneMinus(),5).mul(.92).add(.045);
 const sky=cubeTexture(atmosphere.cubeTarget.texture,reflect(v.negate(),n));
 const planar=reflector({resolutionScale:.5,bounces:false,samples:1});planar.reflector.updateBeforeType='render';planar.target.rotation.x=-Math.PI/2;scene.add(planar.target);
 planar.uvNode=screenUV.flipX().add(vec2(n.x,n.z).mul(.008).mul(smoothstep(50,2500,dist).oneMinus().mul(.8).add(.2)));
 const reflected=mix(sky,planar,smoothstep(3500,9000,dist).oneMinus().mul(uniforms.reflectionStrength));
 const shallow=depth.max(0).mul(-.075).exp();
 const water=mix(vec3(.005,.045,.068),vec3(.028,.34,.31),shallow).mul(uniforms.daylight.mul(.96).add(.04));
 const crest=slope.y.smoothstep(.52,.82).mul(uniforms.rainAmount).mul(.20);
 const shore=depth.sub(t.mul(1.2).sin().mul(.35).add(1)).abs().smoothstep(.15,.8).oneMinus().mul(depth.smoothstep(0,.4)).mul(.4);
 const foam=shore.add(crest).clamp(0,.6);
 const mat=new T.MeshBasicNodeMaterial();mat.colorNode=mix(mix(water,reflected,f),vec3(.65,.72,.70).mul(uniforms.daylight.mul(.95).add(.05)),foam);
 mat.positionNode=positionGeometry.add(vec3(0,field(world.xz).y.mul(smoothstep(0,16,heightAt(world.xz).negate())),0));
 mat.uniforms=uniforms;
 const geo=new T.PlaneGeometry(2,2,192,192);geo.rotateX(-Math.PI/2);const p=geo.attributes.position;
 const warp=v=>Math.sign(v)*(Math.abs(v)*650+Math.pow(Math.abs(v),4)*74400);
 for(let i=0;i<p.count;i++){p.setX(i,warp(p.getX(i)));p.setZ(i,warp(p.getZ(i)));}geo.computeBoundingSphere();
 const ocean=new T.Mesh(geo,mat);ocean.name='Ocean — geometric waves and city reflection';ocean.frustumCulled=false;
 return {ocean,uniforms,planar,heightMap,coastMap,update(camera){ocean.position.set(Math.round(camera.position.x/32)*32,0,Math.round(camera.position.z/32)*32);},dispose(){geo.dispose();mat.dispose();planar.dispose();heightMap.dispose();coastMap.dispose();}};
}
