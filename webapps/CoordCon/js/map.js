/* map.js — Газрын зураг (canvas), давхрагууд, pan/zoom */
/* ---------- map ---------- */
const cv=$('#map'),cx=cv.getContext('2d');let W=0,H=0,dpr=1,FS=[],V={x:.5,y:.4,z:4.3};V.x=(103+180)/360;V.y=.5-Math.log((1+Math.sin(46.8*D2R))/(1-Math.sin(46.8*D2R)))/(4*Math.PI);
const wx=lo=>(lo+180)/360,wy=la=>{const s=Math.sin(la*D2R);return .5-Math.log((1+s)/(1-s))/(4*Math.PI)},sc=()=>256*2**V.z;
const px=p=>[(wx(p.lo)-V.x)*sc()+W/2,(wy(p.la)-V.y)*sc()+H/2];
const unpx=(X,Y)=>{const x=(X-W/2)/sc()+V.x,y=(Y-H/2)/sc()+V.y;return{lo:x*360-180,la:Math.atan(Math.sinh(Math.PI*(1-2*y)))*R2D}};
const E_='https://server.arcgisonline.com/ArcGIS/rest/services/',G_='https://mt1.google.com/vt/lyrs=',B_='https://ecn.t3.tiles.virtualearth.net/tiles/';
const LY=[['OpenStreetMap','OSM Humanitarian','https://a.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png',1],
['OpenStreetMap','CyclOSM','https://a.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png',1],
['OpenStreetMap','OpenTopoMap','https://a.tile.opentopomap.org/{z}/{x}/{y}.png',1,17],
['Google','Google Газрын зураг',G_+'m&x={x}&y={y}&z={z}',1],
['Google','Google Хиймэл дагуул',G_+'s&x={x}&y={y}&z={z}'],
['Google','Google Холимог',G_+'y&x={x}&y={y}&z={z}'],
['Google','Google Рельеф',G_+'p&x={x}&y={y}&z={z}',1],
['Esri','Esri Хиймэл дагуул',E_+'World_Imagery/MapServer/tile/{z}/{y}/{x}'],
['Esri','Esri Гудамж',E_+'World_Street_Map/MapServer/tile/{z}/{y}/{x}',1],
['Esri','Esri Топо',E_+'World_Topo_Map/MapServer/tile/{z}/{y}/{x}',1],
['Esri','Esri Цайвар саарал',E_+'Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',1,16],
['Esri','Esri Харанхуй саарал',E_+'Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',0,16],
['Bing','Bing Хиймэл дагуул',B_+'a{q}.jpeg?g=1'],
['Bing','Bing Холимог',B_+'h{q}.jpeg?g=1'],
['Bing','Bing Гудамж',B_+'r{q}.png?g=1',1],
['Бусад','Суурьгүй (зөвхөн тор)','']].map(([g,n,u,i,m])=>({g,n,u,i,m}));
const qk=(z,x,y)=>{let s='';for(let i=z;i>0;i--){const m=1<<(i-1);s+=(x&m?1:0)+(y&m?2:0)}return s};
const tiles={};function tile(L,z,x,y){const k=L.n+z+'/'+x+'/'+y;if(!tiles[k]){const i=new Image();i.onload=draw;i.src=L.u.replace('{z}',z).replace('{x}',x).replace('{y}',y).replace('{q}',qk(z,x,y));tiles[k]=i}return tiles[k]}
function fit(ps){if(!ps.length){draw();return}let a=[1,1,0,0];ps.forEach(p=>{const x=wx(p.lo),y=wy(p.la);a=[Math.min(a[0],x),Math.min(a[1],y),Math.max(a[2],x),Math.max(a[3],y)]});
V.x=(a[0]+a[2])/2;V.y=(a[1]+a[3])/2;V.z=Math.max(1,Math.min(17,Math.log2(Math.min(W*.75/Math.max((a[2]-a[0])*256,1e-9),H*.75/Math.max((a[3]-a[1])*256,1e-9)))));draw()}
function draw(){if(!W)return;const c=getComputedStyle(document.documentElement),g=n=>c.getPropertyValue(n).trim(),dk=g('--dk')=='1',S=sc();$('#th').textContent=dk?'☀':'☾';
cx.setTransform(dpr,0,0,dpr,0,0);cx.fillStyle=g('--map');cx.fillRect(0,0,W,H);
const LA=LY[+$('#ly').value];if(LA.u){const tz=Math.max(0,Math.min(LA.m||19,Math.round(V.z))),n=2**tz,ts=S/n;cx.filter=dk&&LA.i?'invert(1) hue-rotate(180deg) brightness(.85)':'none';
for(let tx=Math.floor((V.x-W/2/S)*n);tx<=Math.floor((V.x+W/2/S)*n);tx++)for(let ty=Math.max(0,Math.floor((V.y-H/2/S)*n));ty<=Math.min(n-1,Math.floor((V.y+H/2/S)*n));ty++){const im=tile(LA,tz,(tx%n+n)%n,ty);if(im.complete&&im.naturalWidth)cx.drawImage(im,(tx/n-V.x)*S+W/2,(ty/n-V.y)*S+H/2,ts+.5,ts+.5)}cx.filter='none'}
const a=unpx(0,0),b=unpx(W,H),st=[1e-4,2e-4,5e-4,.001,.002,.005,.01,.02,.05,.1,.2,.5,1,2,5,10,20,30].find(s=>s*S/360>=90)||30,dg=Math.max(0,Math.ceil(-Math.log10(st)-1e-9));
cx.lineWidth=1;cx.strokeStyle=g('--grid');cx.fillStyle=g('--mu');cx.font='11px system-ui';cx.globalAlpha=.75;
for(let lo=Math.ceil(a.lo/st)*st;lo<=b.lo;lo+=st){const x=(wx(lo)-V.x)*S+W/2;cx.beginPath();cx.moveTo(x,0);cx.lineTo(x,H);cx.stroke();cx.fillText(lo.toFixed(dg)+'°',x+4,12)}
for(let la=Math.ceil(b.la/st)*st;la<=a.la;la+=st){const y=(wy(la)-V.y)*S+H/2;cx.beginPath();cx.moveTo(0,y);cx.lineTo(W,y);cx.stroke();cx.fillText(la.toFixed(dg)+'°',4,y-4)}
cx.globalAlpha=1;cx.lineJoin='round';
FS.forEach((f,i)=>{const col=PAL[i%PAL.length],ps=f.p.map(px);cx.strokeStyle=col;cx.fillStyle=col;cx.lineWidth=2.5;
if(ps.length>1){cx.beginPath();ps.forEach((q,j)=>j?cx.lineTo(q[0],q[1]):cx.moveTo(q[0],q[1]));if(f.k=='a'&&ps.length>2){cx.closePath();cx.globalAlpha=.2;cx.fill();cx.globalAlpha=1}cx.stroke()}
ps.forEach((q,j)=>{cx.beginPath();cx.arc(q[0],q[1],ps.length>1?3.5:6,0,7);cx.fillStyle=col;cx.fill();cx.lineWidth=1.5;cx.strokeStyle=g('--card');cx.stroke();
if(ps.length<=60){cx.font='600 11px system-ui';cx.lineWidth=3;cx.strokeText(ps.length>1?j+1:(f.name||j+1),q[0]+7,q[1]-7);cx.fillStyle=g('--tx');cx.fillText(ps.length>1?j+1:(f.name||j+1),q[0]+7,q[1]-7)}})})}
let dr=null;cv.onpointerdown=e=>{dr=[e.clientX,e.clientY,V.x,V.y];cv.setPointerCapture(e.pointerId)};
cv.onpointermove=e=>{if(dr){V.x=dr[2]-(e.clientX-dr[0])/sc();V.y=Math.max(0,Math.min(1,dr[3]-(e.clientY-dr[1])/sc()));draw()}const r=cv.getBoundingClientRect(),p=unpx(e.clientX-r.left,e.clientY-r.top);$('#cur').textContent=p.la.toFixed(5)+', '+p.lo.toFixed(5)+' · z'+V.z.toFixed(1)};
cv.onpointerup=()=>dr=null;
cv.addEventListener('wheel',e=>{e.preventDefault();const r=cv.getBoundingClientRect(),X=e.clientX-r.left,Y=e.clientY-r.top,p=unpx(X,Y);V.z=Math.max(1,Math.min(19,V.z-e.deltaY*.0015));V.x=wx(p.lo)-(X-W/2)/sc();V.y=wy(p.la)-(Y-H/2)/sc();draw()},{passive:false});
$('#zi').onclick=()=>{V.z=Math.min(19,V.z+1);draw()};$('#zo').onclick=()=>{V.z=Math.max(1,V.z-1);draw()};$('#ft').onclick=()=>fit(FS.flatMap(f=>f.p));
new ResizeObserver(()=>{const r=cv.parentElement.getBoundingClientRect();W=r.width;H=r.height;dpr=devicePixelRatio||1;cv.width=W*dpr;cv.height=H*dpr;draw()}).observe(cv.parentElement);
