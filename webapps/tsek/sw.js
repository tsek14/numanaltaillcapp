/* Service worker — апп-ын файлуудыг кэшлэж, сүлжээгүй үед (зоорь, хөдөө) ч нээгдэх боломж олгоно.
   fdd6d7586f25-ийг build.py нь хувилбар бүрд өөр утгаар солино: шинэ файл байршуулахад хуучин кэш
   устаж, дараагийн нээлтээр шинэ хувилбар орно. Хэрэглэгчийн өгөгдөл (localStorage) хөндөгдөхгүй. */
const CACHE='tsek-fdd6d7586f25';
const ASSETS=['./','index.html','manifest.webmanifest','icon-192.png','icon-512.png','icon-maskable-512.png'];
self.addEventListener('install',e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',e=>{
  e.waitUntil(caches.keys()
    .then(ks=>Promise.all(ks.filter(k=>k.startsWith('tsek-')&&k!==CACHE).map(k=>caches.delete(k))))
    .then(()=>self.clients.claim()));
});
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(e.request.method!=='GET'||u.origin!==location.origin)return;
  // Эхлээд кэш (шууд, сүлжээ шаардахгүй нээгдэнэ); кэшид алга бол сүлжээ; хуудасны хүсэлт бол index.html
  e.respondWith(caches.match(e.request,{ignoreSearch:true}).then(r=>r||fetch(e.request).catch(()=>
    e.request.mode==='navigate'?caches.match('index.html'):Response.error())));
});
