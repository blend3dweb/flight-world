import * as T from './vendor/three.module.js';
import {uniform,positionWorld,cameraPosition,vec3,mix,sin,cos,normalWorld,cubeTexture,reflect,normalize,dot,pow,float} from './vendor/tsl.js';
export function createOcean({atmosphere,sunDir}){
 const uniforms={time:uniform(0),sun:uniform(sunDir),eye:uniform(new T.Vector3()),daylight:uniform(1),rainAmount:uniform(0),snowAmount:uniform(0),wind:uniform(1),fogDensity:uniform(.000032)};
 const p=positionWorld.xz,t=uniforms.time;
 const n=normalize(vec3(sin(p.x.mul(.045).add(t)).mul(.07).add(sin(p.y.mul(.11).sub(t.mul(1.5))).mul(.04)),1,cos(p.y.mul(.05).sub(t)).mul(.09)));
 const v=normalize(cameraPosition.sub(positionWorld)),f=pow(dot(n,v).max(0).oneMinus(),5).mul(.94).add(.06);
 const env=cubeTexture(atmosphere.cubeTarget.texture,reflect(v.negate(),n));
 const mat=new T.MeshBasicNodeMaterial();mat.colorNode=mix(vec3(.008,.14,.18).mul(uniforms.daylight.mul(.95).add(.05)),env,f);
 mat.uniforms=uniforms;
 const ocean=new T.Mesh(new T.PlaneGeometry(150000,150000),mat);ocean.rotation.x=-Math.PI/2;
 return {ocean,uniforms};
}
