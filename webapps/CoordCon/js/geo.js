/* geo.js — Геодезийн суурь: туслах функц, Transverse Mercator (Крюгер), Cartesian ECEF */
const $=s=>document.querySelector(s),R2D=180/Math.PI,D2R=Math.PI/180,PAL=['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899','#14b8a6'],KN={p:'Цэг',l:'Шугам',a:'Талбай'};
const esc=s=>s.replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function TM(el){const n=el.f/(2-el.f),A=el.a/(1+n)*(1+n*n/4+n**4/64),e=Math.sqrt(el.f*(2-el.f)),
al=[n/2-2*n*n/3+5*n**3/16+41*n**4/180,13*n*n/48-3*n**3/5+557*n**4/1440,61*n**3/240-103*n**4/140,49561*n**4/161280],
be=[n/2-2*n*n/3+37*n**3/96-n**4/360,n*n/48+n**3/15-437*n**4/1440,17*n**3/480-37*n**4/840,4397*n**4/161280],
de=[2*n-2*n*n/3-2*n**3+116*n**4/45,7*n*n/3-8*n**3/5-227*n**4/45,56*n**3/15-136*n**4/35,4279*n**4/630];
return{fwd(la,lo,l0,k,fe,fn){const s=Math.sin(la*D2R),dl=(lo-l0)*D2R,t=Math.sinh(Math.atanh(s)-e*Math.atanh(e*s)),x0=Math.atan2(t,Math.cos(dl)),y0=Math.atanh(Math.sin(dl)/Math.sqrt(1+t*t));let x=x0,y=y0;
al.forEach((a,i)=>{const j=2*(i+1);x+=a*Math.sin(j*x0)*Math.cosh(j*y0);y+=a*Math.cos(j*x0)*Math.sinh(j*y0)});return[fe+k*A*y,fn+k*A*x]},
inv(E,N,l0,k,fe,fn){const x0=(N-fn)/(k*A),y0=(E-fe)/(k*A);let x=x0,y=y0;
be.forEach((b,i)=>{const j=2*(i+1);x-=b*Math.sin(j*x0)*Math.cosh(j*y0);y-=b*Math.cos(j*x0)*Math.sinh(j*y0)});
const c=Math.asin(Math.sin(x)/Math.cosh(y));let p=c;de.forEach((d,i)=>p+=d*Math.sin(2*(i+1)*c));return[p*R2D,l0+Math.atan2(Math.sinh(y),Math.cos(x))*R2D]}}}
const TW=TM({a:6378137,f:1/298.257223563}),TK=TM({a:6378245,f:1/298.3});
function l2c(X,Y,Z,el){const e2=el.f*(2-el.f),lo=Math.atan2(Y,X),r=Math.hypot(X,Y);let p=Math.atan2(Z,r*(1-e2));for(let i=0;i<8;i++){const N=el.a/Math.sqrt(1-e2*Math.sin(p)**2),h=r/Math.cos(p)-N;p=Math.atan2(Z,r*(1-e2*N/(N+h)))}return[p*R2D,lo*R2D]}
function c2l(la,lo,h,el){const e2=el.f*(2-el.f),p=la*D2R,l=lo*D2R,N=el.a/Math.sqrt(1-e2*Math.sin(p)**2);return[(N+h)*Math.cos(p)*Math.cos(l),(N+h)*Math.cos(p)*Math.sin(l),(N*(1-e2)+h)*Math.sin(p)]}
const WG={a:6378137,f:1/298.257223563};
