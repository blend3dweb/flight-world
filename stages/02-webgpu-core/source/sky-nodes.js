import {wgslFn} from './vendor/tsl.js';
export const skyNight=wgslFn(`fn skyNight(base:vec3f,d:vec3f,sun:vec3f,moon:vec3f,day:f32,storm:f32)->vec3f{
 let night=1.-smoothstep(-.12,.13,sun.y);
 var dark=mix(vec3f(.009,.019,.039),vec3f(.0014,.0032,.009),pow(max(d.y,0.),.4));
 let cell=floor(d*1800.);let seed=fract(sin(dot(cell,vec3f(12.9898,78.233,37.719)))*43758.5453);
 let star=step(.9985,seed)*smoothstep(.02,.2,d.y);
 dark+=vec3f(.3,.42,.6)*star*smoothstep(.12,.4,-sun.y);
 let md=max(dot(d,moon),0.);dark+=vec3f(.75,.83,1.)*(smoothstep(.99978,.99985,md)*2.4+pow(md,260.)*.035);
 var c=mix(base*.30,dark,night);
 c=mix(c,mix(vec3f(.009,.015,.025),vec3f(.25,.30,.34),day),storm*.55);
 return max(c,vec3f(0.));
}`);
