/* parser.js — Солбицол таних, мөр/объект задлах */
/* ---------- parsing ---------- */
function ord(a,b,h){let x=a,y=b,lf;if(h.length>=2){const g=(v,c)=>('SW'.includes(c)?-1:1)*Math.abs(v);x=g(a,h[0]);y=g(b,h[1]);lf='EW'.includes(h[0])}else lf=Math.abs(a)>90;
const la=lf?y:x,lo=lf?x:y;return Math.abs(la)<=90&&Math.abs(lo)<=180?{la,lo}:null}
function cz(n,el){if(n.length!=3)return null;const q=Math.hypot(n[0],n[1],n[2]);if(q<6.2e6||q>6.5e6)return null;const r=l2c(n[0],n[1],n[2],el);return{la:r[0],lo:r[1]}}
function pt(s,sys,c){const t=s.replace(/[;,\t]/g,' '),n=(t.match(/-?\d+(?:\.\d+)?/g)||[]).map(Number),h=(t.match(/[NSEW]/gi)||[]).map(c=>c.toUpperCase()),L=n.length;
if(sys=='wgs'){if(L==2)return ord(n[0],n[1],h);if(L!=4&&L!=6)return null}
else if(sys=='cart'||(sys=='auto'&&L==3&&cz(n,WG)))return cz(n,sys=='cart'?c.el:WG);
else if(sys=='wm'){if(L!=2)return null;const R=6378137;return{la:Math.atan(Math.sinh(n[1]/R))*R2D,lo:n[0]/R*R2D}}
else if(sys=='tm'){if(L!=2)return null;const[e,q]=c.o?[n[1],n[0]]:n,r=c.T.inv(e,q,c.cm,c.k,c.fe,c.fn);return{la:r[0],lo:r[1]}}
else if(sys=='utm'){if(L==3&&n[0]>=1&&n[0]<=60&&n[1]>=1e5){const lt=(t.match(/^\s*\d+\s*([A-Za-z])/)||[])[1],r=TW.inv(n[1],n[2],n[0]*6-183,.9996,5e5,lt&&lt.toUpperCase()<'N'?1e7:0);return{la:r[0],lo:r[1]}}if(L!=2)return null;const r=TW.inv(Math.min(...n),Math.max(...n),(c.z||48)*6-183,.9996,5e5,0);return{la:r[0],lo:r[1]}}
else if(sys=='gk6'||sys=='gk3'){if(L!=2)return null;const lo=Math.min(...n),hi=Math.max(...n),big=hi>=1e7,z=big?Math.floor(hi/1e6):c.z||DZ[sys],r=TK.inv(big?hi-z*1e6:lo,big?lo:hi,sys=='gk6'?z*6-3:z*3,1,5e5,0);return{la:r[0],lo:r[1]}}
if(L==3&&n[0]>=1&&n[0]<=60&&n[1]>=1e5){const lt=(t.match(/^\s*\d+\s*([A-Za-z])/)||[])[1],r=TW.inv(n[1],n[2],n[0]*6-183,.9996,5e5,lt&&lt.toUpperCase()<'N'?1e7:0);return{la:r[0],lo:r[1]}}
if(L==2){const[a,b]=n;if(Math.max(Math.abs(a),Math.abs(b))<=360)return ord(a,b,h);const lo=Math.min(a,b),hi=Math.max(a,b);
if(hi>=1e7){const z=Math.floor(hi/1e6),r=TK.inv(hi-z*1e6,lo,z<=28?z*6-3:z*3,1,5e5,0);return{la:r[0],lo:r[1]}}
if(lo>=1e5&&lo<1e6&&hi>=1e6){const r=TW.inv(lo,hi,105,.9996,5e5,0);return{la:r[0],lo:r[1]}}return null}
if(L==4||L==6){const k=L/2,v=x=>(x[0]<0||Object.is(x[0],-0)?-1:1)*(Math.abs(x[0])+(x[1]||0)/60+(x[2]||0)/3600);return ord(v(n.slice(0,k)),v(n.slice(k)),h)}return null}
function parse(txt,sys,c){const fs=[],er=[];let cur=null;const push=()=>{if(cur&&cur.p.length)fs.push(cur);cur=null};
txt.split(/\r?\n/).forEach((ln,i)=>{ln=ln.trim();if(!ln){push();return}cur=cur||{p:[],name:'',kind:''};
if(ln[0]=='#'){const m=ln.match(/^#([pla])?(?: (.*))?$/);cur.name=m?m[2]||'':ln.slice(1).trim();if(m&&m[1])cur.kind=m[1];return}
if(!/\d/.test(ln)){cur.name=ln;const k=/шугам|line/i.test(ln)?'l':/талбай|polygon|area/i.test(ln)?'a':/цэг|point/i.test(ln)?'p':'';if(k)cur.kind=k;return}
const r=pt(ln,sys,c);r?cur.p.push(r):er.push(i+1)});push();
fs.forEach(f=>f.k=f.kind||(f.p.length>2?'a':f.p.length==2?'l':'p'));return{fs,er}}
