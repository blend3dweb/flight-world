// Reusable exterior details; all geometry remains batched by the city module.
export function createDetailBuilders({b,put,box,cylinder,m}){
 function facade(x,y,z,w,h,d){
  if(w<8||d<8||h<10)return;
  // Vertical fins sit outside the glass plane and cast real relief shadows.
  const count=Math.max(2,Math.floor(w/6));
  for(let i=0;i<=count;i++){const xx=x-w/2+i*w/count;for(const side of [-1,1])b('Facade vertical fins',m.white,xx,y,z+side*(d/2+.18),.22,h,.45);}
  const sideCount=Math.max(2,Math.floor(d/7));for(let i=0;i<=sideCount;i++){const zz=z-d/2+i*d/sideCount;for(const side of [-1,1])b('Facade side fins',m.metal,x+side*(w/2+.15),y,zz,.32,h,.18);}
  for(let level=-h/2+3.8;level<h/2;level+=7.6){for(const side of [-1,1])b('Facade spandrel bands',m.concrete,x,y+level,z+side*(d/2+.07),w,.32,.19);}
 }
 function roof(x,y,z,w,d){
  for(const side of [-1,1]){b('Roof parapets',m.roof,x,y+.55,z+side*(d/2-.3),w,1.1,.42);b('Roof parapets',m.roof,x+side*(w/2-.3),y+.55,z,.42,1.1,d);}
  const unitW=Math.min(3.8,w*.23),unitD=Math.min(5,d*.28);
  for(const side of [-1,1]){const xx=x+side*w*.19;b('Rooftop HVAC housings',m.concrete,xx,y+.75,z,unitW,1.5,unitD);put('Rooftop fan rims',cylinder,m.metal,xx,y+1.54,z,unitW*.34,.14,unitW*.34);for(let j=-2;j<=2;j++)b('Rooftop fan grilles',m.roof,xx+j*unitW*.1,y+1.64,z,.06,.05,unitW*.57);}
  b('Roof access housings',m.white,x,y+1.5,z-d*.26,Math.min(w*.2,4),3,Math.min(d*.2,4));
 }
 return {facade,roof};
}
