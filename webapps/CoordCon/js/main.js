/* main.js — Товчнуудын холболт, жишээ, theme, эхлүүлэх */
$('#im').onclick=()=>$('#fi').click();$('#fi').onchange=e=>{impF([...e.target.files]);e.target.value=''};
$('#in').ondragover=e=>e.preventDefault();$('#in').ondrop=e=>{e.preventDefault();impF([...e.dataTransfer.files])};$('#xb').onclick=exp;
$('#mt').onclick=()=>{const h=$('main').classList.toggle('nm');$('#mt').textContent=h?'🗺 Зураг нээх':'🗺 Зураг нуух'};
showP('i');showP('o');
$('#cl').onclick=()=>{$('#in').value='';run(0)};
$('#ex').onclick=()=>{$('#is').value='auto';showP('i');$('#in').value=`Талбай А
47.9210 106.9100
47.9210 106.9300
47.9100 106.9300
47.9100 106.9100

Шугам Б
47°55'30"N 106°53'00"E
47°54'00"N 106°56'00"E

Цэг В
48T 650123 5310456

Талбай Г
5310100 18650100
5310100 18650400
5309800 18650400
5309800 18650100`;run(1)};
$('#cp').onclick=async()=>{const o=$('#out'),b=$('#cp');try{await navigator.clipboard.writeText(o.value)}catch(e){o.select();document.execCommand('copy')}b.textContent='Хуулагдлаа ✓';setTimeout(()=>b.textContent='Хуулах',1200)};
$('#th').onclick=()=>{const r=document.documentElement;r.dataset.theme=getComputedStyle(r).getPropertyValue('--dk').trim()=='1'?'light':'dark';draw()};
$('#ex').click();
