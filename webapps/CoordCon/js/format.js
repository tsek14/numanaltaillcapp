/* format.js — Гаралтын формат, урт/талбай тооцоо */
/* ---------- formatting ---------- */
const dm=(v,h)=>{const a=Math.abs(v);let d=Math.floor(a),m=Math.floor((a-d)*60),s=+(((a-d)*60-m)*60).toFixed(2);if(s>=60){s=0;m++}if(m>=60){m=0;d++}return d+'°'+String(m).padStart(2,'0')+"'"+s.toFixed(2).padStart(5,'0')+'"'+(v<0?h[1]:h[0])};
const gk=w=>(p,c,o)=>{const z=o.z||(w==6?Math.floor(c.lo/6)+1:Math.round(c.lo/3)),r=TK.fwd(p.la,p.lo,w==6?z*6-3:z*3,1,5e5,0);return r[1].toFixed(2)+' '+(z*1e6+r[0]).toFixed(2)};
const FM={dd8:p=>p.la.toFixed(8)+' '+p.lo.toFixed(8),xy:p=>p.lo+' '+p.la,dd:p=>p.la.toFixed(6)+' '+p.lo.toFixed(6),ddl:p=>p.lo.toFixed(6)+' '+p.la.toFixed(6),dms:p=>dm(p.la,'NS')+' '+dm(p.lo,'EW'),
utm:(p,c,o)=>{const z=o.z||Math.floor((c.lo+180)/6)+1,r=TW.fwd(p.la,p.lo,z*6-183,.9996,5e5,c.la<0?1e7:0);return z+'CDEFGHJKLMNPQRSTUVWX'[Math.max(0,Math.min(19,Math.floor((c.la+80)/8)))]+' '+r[0].toFixed(2)+' '+r[1].toFixed(2)},
gk6:gk(6),gk3:gk(3),cart:(p,c,o)=>c2l(p.la,p.lo,o.h,o.el).map(v=>v.toFixed(3)).join(' '),tm:(p,c,o)=>{const r=o.T.fwd(p.la,p.lo,o.cm,o.k,o.fe,o.fn);return(o.o?[r[1],r[0]]:r).map(v=>v.toFixed(2)).join(' ')},wm:p=>(6378137*p.lo*D2R).toFixed(2)+' '+(6378137*Math.log(Math.tan(Math.PI/4+p.la*D2R/2))).toFixed(2)};
const fmt=(f,m,o)=>((f.name||f.k!=(f.p.length>2?'a':f.p.length==2?'l':'p'))?'#'+f.k+(f.name?' '+f.name:'')+'\n':'')+f.p.map(p=>FM[m](p,f.p[0],o)).join('\n');
const hav=(a,b)=>{const h=Math.sin((b.la-a.la)*D2R/2)**2+Math.cos(a.la*D2R)*Math.cos(b.la*D2R)*Math.sin((b.lo-a.lo)*D2R/2)**2;return 12742014.4*Math.asin(Math.sqrt(h))};
function stat(f){const p=f.p;let L=0,A=0;for(let i=1;i<p.length;i++)L+=hav(p[i-1],p[i]);
if(f.k=='a'&&p.length>2){L+=hav(p[p.length-1],p[0]);for(let i=0;i<p.length;i++){const a=p[i],b=p[(i+1)%p.length];A+=(b.lo-a.lo)*D2R*(2+Math.sin(a.la*D2R)+Math.sin(b.la*D2R))}A=Math.abs(A*6371007.2**2/2)}return{L,A}}
const fa=A=>A<1e4?A.toFixed(1)+' м²':A<1e6?(A/1e4).toFixed(2)+' га':(A/1e6).toFixed(3)+' км²',fl=L=>L<1e3?L.toFixed(1)+' м':(L/1e3).toFixed(3)+' км';
