/* app.js — Үндсэн UI логик: run(), системийн параметр, жагсаалт */
/* ---------- app ---------- */
function run(rf){const r=parse($('#in').value,$('#is').value,cfg('i')),oc=cfg('o'),m=$('#os').value;FS=r.fs;$('#out').value=FS.map(f=>fmt(f,m,oc)).join('\n\n');
$('#err').textContent=r.er.length?'⚠ Танигдаагүй мөр: '+r.er.join(', '):'';
$('#ls').innerHTML=FS.map((f,i)=>{const s=stat(f);return '<div class="it" data-i="'+i+'"><i style="background:'+PAL[i%PAL.length]+'"></i><b>'+(esc(f.name)||KN[f.k]+' '+(i+1))+'</b><small>'+f.p.length+' цэг'+(s.A?' · '+fa(s.A):'')+(f.k!='p'&&s.L?' · '+fl(s.L):'')+'</small></div>'}).join('')||'<div class="mu">Объект алга</div>';
rf?fit(FS.flatMap(f=>f.p)):draw()}
$('#ls').onclick=e=>{const d=e.target.closest('.it');if(d)fit(FS[d.dataset.i].p)};
const mk=p=>`<label class="pz">Бүс<input id="${p}-z" type="number" min="1" max="60"></label><label class="pt">Дундаж меридиан °<input id="${p}-c" type="number" step="any" value="105"></label><label class="pt">Масштаб k<input id="${p}-k" type="number" step="any" value="1"></label><label class="pt">False E<input id="${p}-e" type="number" step="any" value="500000"></label><label class="pt">False N<input id="${p}-n" type="number" step="any" value="0"></label><label class="pt pc">Эллипсоид<select id="${p}-l"><option value="w">WGS84</option><option value="k">Красовский</option></select></label><label class="pc">Өндөр h, м<input id="${p}-h" type="number" step="any" value="0"></label><label class="pt">Дараалал<select id="${p}-o"><option value="0">E N</option><option value="1">N E</option></select></label>`;
$('#ip').innerHTML=mk('i');$('#op').innerHTML=mk('o');
const DZ={utm:48,gk6:18,gk3:36},cfg=p=>{const g=k=>$('#'+p+'-'+k).value;return{z:+g('z')||0,cm:+g('c'),k:+g('k')||1,fe:+g('e')||0,fn:+g('n')||0,T:g('l')=='k'?TK:TW,el:g('l')=='k'?{a:6378245,f:1/298.3}:{a:6378137,f:1/298.257223563},h:+g('h')||0,o:g('o')=='1'}};
function showP(p){const s=$('#'+p+'s').value,z=s=='utm'||s=='gk6'||s=='gk3',t=s=='tm',cc=s=='cart',q=e=>document.querySelectorAll('#'+p+'p '+e);$('#'+p+'p').style.display=z||t||cc?'':'none';q('.pz').forEach(e=>e.style.display=z?'':'none');q('.pt').forEach(e=>e.style.display=t||(cc&&e.classList.contains('pc'))?'':'none');q('.pc').forEach(e=>{if(!e.classList.contains('pt'))e.style.display=cc&&p=='o'?'':'none'});$('#'+p+'-z').placeholder=p=='i'?(DZ[s]||''):'авто'}
$('#is').onchange=()=>{showP('i');run(1)};$('#os').onchange=()=>{showP('o');run(0)};
$('#ip').oninput=$('#ip').onchange=()=>run(1);$('#op').oninput=$('#op').onchange=()=>run(0);
const gs=[...new Set(LY.map(l=>l.g))];$('#ly').innerHTML=gs.map(g=>'<optgroup label="'+g+'">'+LY.map((l,i)=>l.g==g?'<option value="'+i+'">'+l.n+'</option>':'').join('')+'</optgroup>').join('');$('#ly').value=LY.findIndex(l=>l.n=='Google Хиймэл дагуул');$('#ly').onchange=draw;
$('#in').oninput=()=>{$('#msg').textContent='';run(1)};
