/* import.js — Файл импорт: GeoJSON, KML/KMZ, GPX, WKT, CSV, DXF, Shapefile */
const msg=s=>$('#msg').textContent=s,ring=r=>{const a=r[0],b=r[r.length-1];return r.length>2&&a.la==b.la&&a.lo==b.lo?r.slice(0,-1):r};
function gj(o,nm,out){if(!o)return;const t=o.type,c=o.coordinates,P=x=>({lo:+x[0],la:+x[1]}),add=(k,p)=>out.push({name:nm,k,p});
if(t=='FeatureCollection')o.features.forEach(f=>gj(f,'',out));
else if(t=='Feature'){const q=o.properties||{};gj(o.geometry,String(q.name||q.Name||q.NAME||''),out)}
else if(t=='Point')add('p',[P(c)]);else if(t=='MultiPoint')c.forEach(x=>add('p',[P(x)]));
else if(t=='LineString')add('l',c.map(P));else if(t=='MultiLineString')c.forEach(x=>add('l',x.map(P)));
else if(t=='Polygon')add('a',ring(c[0].map(P)));else if(t=='MultiPolygon')c.forEach(x=>add('a',ring(x[0].map(P))));
else if(t=='GeometryCollection')o.geometries.forEach(g=>gj(g,nm,out))}
function kml(t){const d=new DOMParser().parseFromString(t,'text/xml'),out=[],co=e=>e.textContent.trim().split(/\s+/).map(s=>s.split(',').map(Number)).filter(a=>a.length>1&&!isNaN(a[0])&&!isNaN(a[1])).map(a=>({lo:a[0],la:a[1]}));
d.querySelectorAll('Placemark').forEach(pm=>{const nm=((pm.querySelector('name')||{}).textContent||'').trim();pm.querySelectorAll('Point,LineString,Polygon').forEach(g=>{const T=g.tagName.replace(/.*:/,''),c=g.querySelector(T=='Polygon'?'outerBoundaryIs coordinates':'coordinates');if(c){const p=co(c);out.push({name:nm,k:T=='Point'?'p':T=='LineString'?'l':'a',p:T=='Polygon'?ring(p):p})}})});return out}
function gpx(t){const d=new DOMParser().parseFromString(t,'text/xml'),out=[],P=e=>({la:+e.getAttribute('lat'),lo:+e.getAttribute('lon')}),nm=e=>((e.querySelector('name')||{}).textContent||'').trim();
d.querySelectorAll('wpt').forEach(w=>out.push({name:nm(w),k:'p',p:[P(w)]}));
d.querySelectorAll('trk').forEach(w=>out.push({name:nm(w),k:'l',p:[...w.querySelectorAll('trkpt')].map(P)}));
d.querySelectorAll('rte').forEach(w=>out.push({name:nm(w),k:'l',p:[...w.querySelectorAll('rtept')].map(P)}));return out}
function wkt(t){const out=[];t.split(/\r?\n/).forEach(l=>{const m=l.match(/^\s*(?:SRID=\d+;)?\s*(MULTI)?(POINT|LINESTRING|POLYGON)/i);if(!m)return;const T=m[2].toUpperCase();
(l.match(/\(([^()]+)\)/g)||[]).forEach((s,i)=>{const p=s.slice(1,-1).split(',').map(x=>{const a=x.trim().split(/\s+/).map(Number);return{lo:a[0],la:a[1]}});
if(T=='POINT')p.forEach(q=>out.push({name:'',k:'p',p:[q]}));else if(T=='LINESTRING')out.push({name:'',k:'l',p});else if(m[1]||i==0)out.push({name:'',k:'a',p:ring(p)})})});return out}
function csv(t){const L=t.trim().split(/\r?\n/),sp=l=>l.split(/[,;\t]/).map(s=>s.trim().replace(/^"|"$/g,'')),H=sp(L[0]).map(s=>s.toLowerCase()),fx=(...n)=>H.findIndex(h=>n.includes(h)),ia=fx('lat','latitude','y','φ'),io=fx('lon','lng','long','longitude','x','λ');
if(ia<0||io<0)return null;const iN=fx('name','нэр'),iT=fx('type','төрөл'),out=[];let cur=null;
L.slice(1).forEach(l=>{const r=sp(l),p={la:+r[ia],lo:+r[io]};if(isNaN(p.la)||isNaN(p.lo))return;const nm=iN>=0?r[iN]:'',ty=iT>=0?r[iT]:'';
if(iT>=0&&cur&&cur.name==nm&&cur.ty==ty&&ty!='point')cur.p.push(p);else{cur={name:nm,ty,k:ty=='polygon'?'a':ty=='line'?'l':'p',p:[p]};out.push(cur)}});return out}
function dxf(t){const a=t.split(/\r?\n/),out=[];let e=null,pl=null;
for(let i=0;i+1<a.length;i+=2){const c=+a[i],v=a[i+1].trim();
if(c==0){if(v=='VERTEX'){e=pl;if(e)e.h=0;continue}if(v=='SEQEND')pl=null;e=null;
if(v=='POINT'||v=='LINE'||v=='LWPOLYLINE'||v=='POLYLINE'){e={name:'',k:v=='POINT'?'p':'l',p:[],h:v=='POLYLINE'};out.push(e);if(v=='POLYLINE')pl=e}continue}
if(!e)continue;
if(c==70&&(+v&1)&&(e.h||!e.p.length)&&e.k=='l')e.k='a';
else if((c==10&&!e.h)||c==11)e.p.push({lo:+v,la:0});
else if((c==20&&!e.h)||c==21){if(e.p.length)e.p[e.p.length-1].la=+v}}
return out.map(e=>e.k=='a'?{...e,p:ring(e.p)}:e)}
function ld(r,proj){r=r.filter(f=>f.p.length);if(!r.length)return msg('Солбицол олдсонгүй');r.forEach(f=>{f.name=(f.name||'').replace(/\s+/g,' ').trim();f.k=f.k||'p'});
$('#is').value=proj?'auto':'wgs';showP('i');$('#in').value=r.map(f=>fmt(f,proj?'xy':'dd8',{})).join('\n\n');run(1);
msg('✓ '+r.length+' объект, '+r.reduce((s,f)=>s+f.p.length,0)+' цэг импортлогдлоо'+(proj?' (проекцын солбицол — оролтын системээ шалгана уу)':''))}
function tx(e,t){let r;
if(e=='geojson'||e=='json'){r=[];gj(JSON.parse(t),'',r)}else if(e=='kml')r=kml(t);else if(e=='gpx')r=gpx(t);else if(e=='wkt')r=wkt(t);else if(e=='dxf')return ld(dxf(t),1);
else if(e=='csv'||e=='txt'){r=e=='csv'?csv(t):0;if(!r){$('#is').value='auto';showP('i');$('#in').value=t.trim();run(1);return msg('✓ Текст оруулагдлаа')}}
else throw Error('Дэмжигдээгүй формат: .'+e);ld(r)}
async function imp(file){if(!file)return;const ext=file.name.split('.').pop().toLowerCase();try{
if(ext=='zip'||ext=='kmz'){if(!window.JSZip)throw Error('ZIP сан ачаалагдсангүй');const buf=await file.arrayBuffer(),z=await JSZip.loadAsync(buf),ns=Object.keys(z.files).filter(n=>!z.files[n].dir),f=e=>ns.find(n=>n.toLowerCase().endsWith('.'+e));
if(f('shp')){if(!window.shp)throw Error('Shapefile сан ачаалагдсангүй');const g=await shp(buf),r=[];(Array.isArray(g)?g:[g]).forEach(x=>gj(x,'',r));return ld(r)}
const e=['kml','geojson','json','gpx','wkt','dxf','csv','txt'].find(x=>f(x));if(!e)throw Error('ZIP доторх формат танигдсангүй');return tx(e,await z.file(f(e)).async('string'))}
tx(ext,await file.text())}catch(e){msg('⚠ '+e.message)}}
async function impF(fs){if(!fs.length)return;const by=e=>fs.find(f=>f.name.toLowerCase().endsWith('.'+e)),sf=by('shp');if(!sf)return imp(fs[0]);
try{if(!window.shp)throw Error('Shapefile сан ачаалагдсангүй');const pj=by('prj'),db=by('dbf'),g=shp.parseShp(await sf.arrayBuffer(),pj?await pj.text():undefined),fc=db?shp.combine([g,shp.parseDbf(await db.arrayBuffer())]):g,r=[];
(Array.isArray(fc)?fc:[fc]).forEach(x=>gj(x,'',r));ld(r,!pj&&r.some(f=>f.p.some(p=>Math.abs(p.lo)>180||Math.abs(p.la)>90)))}catch(e){msg('⚠ '+e.message)}}
