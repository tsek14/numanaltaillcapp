/* export.js — Файл экспорт: GeoJSON, KML, GPX, WKT, CSV, DXF, Shapefile, ZIP */
const EXT={geojson:'geojson',kml:'kml',gpx:'gpx',wkt:'wkt',csv:'csv',dxf:'dxf',txt:'txt'},
flat=()=>FS.flatMap(f=>f.k=='p'?f.p.map(p=>({name:f.name,k:'p',p:[p]})):[{name:f.name,k:f.k=='a'&&f.p.length<3?'l':f.k,p:f.p}]).map(f=>f.k!='p'&&f.p.length<2?{...f,k:'p'}:f),
nmf=(f,i)=>f.name||KN[f.k]+' '+(i+1),
X={geojson:()=>JSON.stringify({type:'FeatureCollection',features:flat().map((f,i)=>{const c=f.p.map(p=>[p.lo,p.la]);return{type:'Feature',properties:{name:nmf(f,i),type:KN[f.k]},geometry:f.k=='p'?{type:'Point',coordinates:c[0]}:f.k=='l'?{type:'LineString',coordinates:c}:{type:'Polygon',coordinates:[[...c,c[0]]]}}})},null,1),
kml:()=>'<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document>'+flat().map((f,i)=>{const c=f.p.map(p=>p.lo+','+p.la+',0');return'<Placemark><name>'+esc(nmf(f,i))+'</name>'+(f.k=='p'?'<Point><coordinates>'+c[0]+'</coordinates></Point>':f.k=='l'?'<LineString><coordinates>'+c.join(' ')+'</coordinates></LineString>':'<Polygon><outerBoundaryIs><LinearRing><coordinates>'+[...c,c[0]].join(' ')+'</coordinates></LinearRing></outerBoundaryIs></Polygon>')+'</Placemark>'}).join('')+'</Document></kml>',
gpx:()=>'<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Coordinate Converter" xmlns="http://www.topografix.com/GPX/1/1">'+flat().sort((a,b)=>(b.k=='p')-(a.k=='p')).map((f,i)=>{const n='<name>'+esc(nmf(f,i))+'</name>',pp=f.k=='a'?[...f.p,f.p[0]]:f.p;return f.k=='p'?'<wpt lat="'+f.p[0].la+'" lon="'+f.p[0].lo+'">'+n+'</wpt>':'<trk>'+n+'<trkseg>'+pp.map(p=>'<trkpt lat="'+p.la+'" lon="'+p.lo+'"/>').join('')+'</trkseg></trk>'}).join('')+'</gpx>',
wkt:()=>flat().map(f=>{const c=f.p.map(p=>p.lo+' '+p.la);return f.k=='p'?'POINT ('+c[0]+')':f.k=='l'?'LINESTRING ('+c.join(', ')+')':'POLYGON (('+[...c,c[0]].join(', ')+'))'}).join('\n'),
csv:(m,o)=>'name,type,seq,lat,lon,converted\n'+flat().map((f,i)=>f.p.map((p,j)=>[nmf(f,i).replace(/[,"\n]/g,' '),{p:'point',l:'line',a:'polygon'}[f.k],j+1,p.la.toFixed(8),p.lo.toFixed(8),'"'+FM[m](p,f.p[0],o).replace(/"/g,'""')+'"'].join(',')).join('\n')).join('\n'),
dxf:(m,o)=>{const xy=(p,c)=>{if(m=='dd'||m=='ddl'||m=='dms')return[p.lo,p.la];const n=FM[m](p,c,o).match(/-?\d+(?:\.\d+)?/g).map(Number);return m=='utm'?[n[1],n[2]]:m=='cart'?[n[0],n[1]]:m=='tm'&&!o.o?[n[0],n[1]]:m=='wm'?[n[0],n[1]]:[n[1],n[0]]};
let s='0\nSECTION\n2\nENTITIES\n';flat().forEach(f=>{const q=f.p.map(p=>xy(p,f.p[0]).map(v=>+v.toFixed(6))),L='8\n'+{p:'POINTS',l:'LINES',a:'POLYGONS'}[f.k]+'\n';
s+=f.k=='p'?'0\nPOINT\n'+L+'10\n'+q[0][0]+'\n20\n'+q[0][1]+'\n30\n0\n':'0\nPOLYLINE\n'+L+'66\n1\n70\n'+(f.k=='a'?1:0)+'\n'+q.map(a=>'0\nVERTEX\n'+L+'10\n'+a[0]+'\n20\n'+a[1]+'\n30\n0\n').join('')+'0\nSEQEND\n'+L});return s+'0\nENDSEC\n0\nEOF\n'}};
const PRJ='GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]',
bb=P=>{const x=P.map(p=>p[0]),y=P.map(p=>p[1]);return[Math.min(...x),Math.min(...y),Math.max(...x),Math.max(...y)]};
function mkShp(k,recs){const t=k=='p'?1:k=='l'?3:5,cl=recs.map(P=>k=='p'?20:48+16*P.length),len=100+cl.reduce((a,c)=>a+c+8,0),box=bb([].concat(...recs)),
sv=new DataView(new ArrayBuffer(len)),sx=new DataView(new ArrayBuffer(100+8*recs.length)),hd=(v,n)=>{v.setInt32(0,9994);v.setInt32(24,n/2);v.setInt32(28,1000,true);v.setInt32(32,t,true);box.forEach((d,i)=>v.setFloat64(36+8*i,d,true))};
hd(sv,len);hd(sx,100+8*recs.length);let o=100;
recs.forEach((P,i)=>{sv.setInt32(o,i+1);sv.setInt32(o+4,cl[i]/2);sx.setInt32(100+8*i,o/2);sx.setInt32(104+8*i,cl[i]/2);o+=8;sv.setInt32(o,t,true);
if(k=='p'){sv.setFloat64(o+4,P[0][0],true);sv.setFloat64(o+12,P[0][1],true)}
else{bb(P).forEach((d,j)=>sv.setFloat64(o+4+8*j,d,true));sv.setInt32(o+36,1,true);sv.setInt32(o+40,P.length,true);sv.setInt32(o+44,0,true);P.forEach((q,j)=>{sv.setFloat64(o+48+16*j,q[0],true);sv.setFloat64(o+56+16*j,q[1],true)})}
o+=cl[i]});return[sv.buffer,sx.buffer]}
function mkDbf(rows){const e=new TextEncoder(),W=[['NAME',80],['TYPE',20]],hl=32+32*W.length+1,rl=1+W.reduce((a,w)=>a+w[1],0),b=new Uint8Array(hl+rl*rows.length+1),v=new DataView(b.buffer),d=new Date();
b[0]=3;b[1]=d.getFullYear()-1900;b[2]=d.getMonth()+1;b[3]=d.getDate();v.setUint32(4,rows.length,true);v.setUint16(8,hl,true);v.setUint16(10,rl,true);
W.forEach((w,i)=>{const o=32+32*i;b.set(e.encode(w[0]),o);b[o+11]=67;b[o+16]=w[1]});b[hl-1]=13;
rows.forEach((r,i)=>{let o=hl+rl*i;b[o++]=32;r.forEach((x,j)=>{const w=W[j][1];b.fill(32,o,o+w);b.set(e.encode(String(x)).slice(0,w),o);o+=w})});b[b.length-1]=26;return b.buffer}
function shpSet(){const F=flat().map((f,i)=>[f,i]),out={};
[['p','points'],['l','lines'],['a','polygons']].forEach(([k,n])=>{const fs=F.filter(a=>a[0].k==k);if(!fs.length)return;
const recs=fs.map(([f])=>{const P=f.p.map(p=>[p.lo,p.la]);if(k=='a'){P.push(P[0]);let a=0;for(let i=1;i<P.length;i++)a+=P[i-1][0]*P[i][1]-P[i][0]*P[i-1][1];if(a>0)P.reverse()}return P}),[sh,sx]=mkShp(k,recs);
out[n+'.shp']=sh;out[n+'.shx']=sx;out[n+'.dbf']=mkDbf(fs.map(([f,i])=>[nmf(f,i),KN[f.k]]));out[n+'.prj']=PRJ;out[n+'.cpg']='UTF-8'});return out}
async function save(name,data){const d=window.claude?await claude.use('downloads'):null;
if(d){const ext=name.split('.').pop();
if(ext=='kmz')name=name.replace('.kmz','.zip');else if(ext=='geojson')name=name.replace('.geojson','.json');
else if(!['json','csv','txt','zip'].includes(ext)){if(window.JSZip){const z=new JSZip();z.file(name,data);data=await z.generateAsync({type:'blob'});name=name.replace(/\.\w+$/,'.zip')}else name+='.txt'}
try{await d.save({filename:name,data});msg('✓ '+name)}catch(e){if(e.code!='declined')msg('⚠ Хадгалж чадсангүй: '+e.code)}return}
const a=document.createElement('a');a.href=URL.createObjectURL(data instanceof Blob?data:new Blob([data]));a.download=name;a.click();msg('✓ '+name)}
async function exp(){if(!FS.length)return msg('Экспортлох өгөгдөл алга');const f=$('#xf').value,m=$('#os').value,o=cfg('o'),b='coordinates';
if(f=='shp'||f=='shpz'){const o=shpSet(),ks=Object.keys(o);if(!ks.length)return msg('Экспортлох өгөгдөл алга');
const cap=window.claude&&await claude.use('downloads');
if(f=='shpz'||cap){if(!window.JSZip)return msg('⚠ ZIP сан ачаалагдсангүй');const z=new JSZip();ks.forEach(n=>z.file(n,o[n]));await save('shapefile.zip',await z.generateAsync({type:'blob'}));if(f=='shp')msg('ℹ Нийтэлсэн хуудсанд .shp, .dbf өргөтгөл хадгалагддаггүй тул ZIP-д багцлав');return}
for(const n of ks){await save(n,new Blob([o[n]]));await new Promise(r=>setTimeout(r,300))}return}
if(f=='zip'||f=='kmz'){if(!window.JSZip)return msg('⚠ ZIP сан ачаалагдсангүй');const z=new JSZip();
if(f=='kmz')z.file('doc.kml',X.kml());else Object.keys(EXT).forEach(k=>z.file(b+'.'+EXT[k],k=='txt'?$('#out').value:X[k](m,o)));
if(f=='zip'){const q=shpSet();Object.keys(q).forEach(n=>z.file('shapefile/'+n,q[n]))}
return save(b+(f=='kmz'?'.kmz':'.zip'),await z.generateAsync({type:'blob'}))}
return save(b+'.'+EXT[f],f=='txt'?$('#out').value:X[f](m,o))}
