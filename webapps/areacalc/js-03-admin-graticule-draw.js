  // ---------- Administrative boundaries overlay (aimag/soum/bag polygons) ----------
  // Mirrors the MRPAM layer above exactly: Worker-based off-thread parsing
  // (falls back to a main-thread parse under file://), precomputed bboxes,
  // viewport-only rendering, a zoom floor, and a render cap — this dataset
  // is ~2,200 polygons nationwide (bag/khoroo level alone is 1,845), so the
  // same discipline applies. The three levels (aimag/soum/bag, tagged via
  // each feature's LEVEL property) can be toggled independently since they
  // overlap geographically — showing all three nationwide at once would be
  // both unreadable and a rendering-cost multiplier for no benefit.
  var ADMIN_MIN_ZOOM = 7;
  var ADMIN_MAX_RENDER = 400;
  var ADMIN_LEVEL_COLOR = { aimag:'#5fb3ff', soum:'#ffd23f', bag:'#7ee787' };
  var ADMIN_LEVEL_LABEL = { aimag:'Аймаг', soum:'Сум', bag:'Баг/Хороо' };
  // Bigger unit = smaller rank. Every bag/khoroo shares its outer edge with
  // the soum it belongs to, and every soum shares its edge with its aimag, so
  // the level drawn LAST paints over the others' lines. Strokes are therefore
  // drawn bag -> soum -> aimag (aimag on top), which is what lets all three
  // colors show at once. Higher levels are also drawn a little thicker so a
  // coincident lower-level line can't peek out at the anti-aliased edges.
  var ADMIN_LEVEL_RANK = { aimag:0, soum:1, bag:2 };
  var ADMIN_STROKE_SCALE = { aimag:1.8, soum:1.35, bag:1 };

  // Name labels: every visible aimag / soum / bag shows its name at the middle
  // of its own area. Sizes shrink with the level so the hierarchy reads at a glance.
  var adminLabelsOn = getSetting('adminLabelsOn', true);
  var ADMIN_LABEL_FONT = { aimag:{ px:15, weight:700 }, soum:{ px:13, weight:700 }, bag:{ px:11.5, weight:700 } };
  // Placement priority: the smallest unit claims the exact centre first, so a
  // small bag is never pushed out of its own (tiny) polygon by a big aimag label.
  var ADMIN_LABEL_ORDER = { bag:0, soum:1, aimag:2 };
  var adminLabelCtx = null;
  try{ adminLabelCtx = document.createElement('canvas').getContext('2d'); }catch(e){ adminLabelCtx = null; }

  var adminLoaded = false;
  var adminVisible = false;
  var adminFeatures = null; // [{bbox:[w,s,e,n], geometry, properties:{LEVEL,NAME,CODE,...}}, ...]
  var adminLayerGroup = L.layerGroup();
  var adminWorker = null;

  var adminLevelsOn = getSetting('adminLevelsOn', { aimag:true, soum:true, bag:true });
  var adminWeight = getSetting('adminWeight', 1.5);
  var adminFillOpacity = getSetting('adminFillOpacity', 0);

  var adminBtn = document.getElementById('adminLayerToggle');
  var adminFileInput = document.getElementById('adminFileInput');
  var ADMIN_HANDLE_KEY = 'adminGeojsonHandle', ADMIN_ENABLED_KEY = 'adminEnabled';

  function adminHint(msg){
    var el = document.getElementById('adminHint');
    if(!msg){ el.classList.remove('show'); return; }
    el.textContent = msg;
    el.classList.add('show');
  }

  // Reuses the exact same worker source shape as MRPAM's — a fresh Worker
  // instance, since a Blob-URL worker can only run the script it was built
  // from, but built from the identical logic (parse + per-feature bbox).
  function getAdminWorker(){
    if(adminWorker) return adminWorker;
    try{
      var blob = new Blob([MRPAM_WORKER_SRC], { type:'application/javascript' });
      adminWorker = new Worker(URL.createObjectURL(blob));
      return adminWorker;
    } catch(e){
      return null; // file:// origin — caller falls back to parseGeojsonSync
    }
  }

  function adminPopupHtml(props){
    function row(label, val){
      if(val === undefined || val === null || val === '') return '';
      return '<dt>'+escapeXml(label)+'</dt><dd>'+escapeXml(val)+'</dd>';
    }
    // Instead of exposing raw LEVEL/CODE, show where this unit actually
    // sits in the hierarchy: a bag shows its aimag+soum, a soum shows its
    // aimag, an aimag shows just its own name.
    var lvl = props.LEVEL;
    var nameLabel = ADMIN_LEVEL_LABEL[lvl] || 'Нэр';
    return '<dl>'
      + row(nameLabel, props.NAME)
      + (lvl === 'bag' ? row('Сум', props.SOUM) : '')
      + (lvl === 'bag' || lvl === 'soum' ? row('Аймаг', props.AIMAG) : '')
      + '</dl>';
  }

  // Select-and-export, shared with MRPAM / cadastre (see createSelectExport).
  var adminSel = createSelectExport({
    slotId: 'adminSelectSlot',
    modeTitle: 'Газрын зураг дээр хил дээр товшиж сонгоно',
    notLoadedMsg: 'Эхлээд захиргааны хилийн файл ачаална уу',
    unit: 'хил',
    fileBase: 'zakhirgaanii-khil-songoson',
    docName: 'Захиргааны хил — сонгосон',
    isLoaded: function(){ return adminLoaded; },
    getFeatures: function(){ return adminFeatures; },
    onChange: function(){ updateAdminOverlay(); },
    nameOf: function(props, idx){ return props.NAME || ('Хил ' + (idx + 1)); },
    colorOf: function(props){ return ADMIN_LEVEL_COLOR[props.LEVEL] || '#94a3b8'; },
    descOf: function(props){
      var rows = [];
      if(props.NAME) rows.push([ADMIN_LEVEL_LABEL[props.LEVEL] || 'Нэр', props.NAME]);
      if(props.LEVEL === 'bag' && props.SOUM) rows.push(['Сум', props.SOUM]);
      if((props.LEVEL === 'bag' || props.LEVEL === 'soum') && props.AIMAG) rows.push(['Аймаг', props.AIMAG]);
      return rows;
    }
  });

  // ---------- Name label placement ----------
  // Rendered width of a label (canvas measureText, so Cyrillic is exact rather
  // than guessed from the character count), plus a little padding for the halo.
  function adminLabelWidth(text, lvl){
    var f = ADMIN_LABEL_FONT[lvl];
    if(adminLabelCtx){
      adminLabelCtx.font = f.weight + ' ' + f.px + 'px "Space Grotesk", sans-serif';
      return adminLabelCtx.measureText(text).width + 6;
    }
    return text.length * f.px * 0.62 + 6;
  }

  // -- tiny planar geometry helpers (lng/lat treated as x/y) --
  // Area-weighted centroid of a ring (shoelace). Centroids are affine-invariant,
  // so no cos(lat) correction is needed here. Coordinates are shifted by the
  // first vertex first to keep the sums numerically well-behaved.
  function adminRingAreaCentroid(r){
    var x0 = r[0][0], y0 = r[0][1], a = 0, cx = 0, cy = 0;
    for(var i=0, j=r.length-1; i<r.length; j=i++){
      var xi = r[i][0]-x0, yi = r[i][1]-y0, xj = r[j][0]-x0, yj = r[j][1]-y0;
      var f = xj*yi - xi*yj;
      a += f; cx += (xj+xi)*f; cy += (yj+yi)*f;
    }
    return { area: a/2, c: Math.abs(a) < 1e-18 ? null : [x0 + cx/(3*a), y0 + cy/(3*a)] };
  }
  function adminRingHas(r, x, y){
    var inside = false;
    for(var i=0, j=r.length-1; i<r.length; j=i++){
      var xi = r[i][0], yi = r[i][1], xj = r[j][0], yj = r[j][1];
      if((yi > y) !== (yj > y) && x < (xj-xi)*(y-yi)/(yj-yi) + xi) inside = !inside;
    }
    return inside;
  }
  // Inside the outer ring and not inside any hole (e.g. a city enclave).
  function adminPolyHas(rings, x, y){
    if(!adminRingHas(rings[0], x, y)) return false;
    for(var k=1; k<rings.length; k++){ if(adminRingHas(rings[k], x, y)) return false; }
    return true;
  }
  function adminDistToRings(rings, x, y, kx){
    var best = Infinity;
    for(var k=0; k<rings.length; k++){
      var r = rings[k];
      for(var i=0, j=r.length-1; i<r.length; j=i++){
        var ax = r[j][0]*kx, ay = r[j][1], bx = r[i][0]*kx, by = r[i][1];
        var dx = bx-ax, dy = by-ay, px = x*kx-ax, py = y-ay, t = 0, l2 = dx*dx + dy*dy;
        if(l2 > 0){ t = (px*dx + py*dy)/l2; t = t < 0 ? 0 : (t > 1 ? 1 : t); }
        var ex = px - t*dx, ey = py - t*dy, d = ex*ex + ey*ey;
        if(d < best) best = d;
      }
    }
    return Math.sqrt(best);
  }
  // For awkward shapes (C-shaped units, units wrapped around an enclave) whose
  // centre of mass falls outside the polygon: the interior point that is
  // furthest from every edge, found with a coarse grid and one refinement pass.
  function adminPolyInnerPoint(rings){
    var r = rings[0], minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for(var i=0;i<r.length;i++){
      if(r[i][0] < minX) minX = r[i][0]; if(r[i][0] > maxX) maxX = r[i][0];
      if(r[i][1] < minY) minY = r[i][1]; if(r[i][1] > maxY) maxY = r[i][1];
    }
    var kx = Math.cos(((minY + maxY)/2) * Math.PI/180), best = null, bestD = -1;
    function scan(x0, x1, y0, y1, n){
      for(var a=0; a<n; a++){
        for(var b=0; b<n; b++){
          var x = x0 + (x1-x0)*(a+0.5)/n, y = y0 + (y1-y0)*(b+0.5)/n;
          if(!adminPolyHas(rings, x, y)) continue;
          var d = adminDistToRings(rings, x, y, kx);
          if(d > bestD){ bestD = d; best = [x, y]; }
        }
      }
    }
    var N = 24;
    scan(minX, maxX, minY, maxY, N);
    if(best){
      var cw = (maxX-minX)/N, ch = (maxY-minY)/N, bx = best[0], by = best[1];
      scan(bx-cw, bx+cw, by-ch, by+ch, 10);
    }
    return best;
  }
  // The point a label belongs at: centre of mass of the polygon's largest part,
  // or the inner point when that centre isn't actually inside the unit.
  function adminGeomLabelPoint(geom){
    if(!geom) return null;
    var parts = geom.type === 'Polygon' ? [geom.coordinates] : (geom.type === 'MultiPolygon' ? geom.coordinates : []);
    var bestPart = null, bestA = 0;
    parts.forEach(function(rings){
      if(!rings || !rings.length || !rings[0] || rings[0].length < 3) return;
      var a = Math.abs(adminRingAreaCentroid(rings[0]).area);
      if(a > bestA){ bestA = a; bestPart = rings; }
    });
    if(!bestPart) return null;
    var cc = adminRingAreaCentroid(bestPart[0]).c;
    if(cc && adminPolyHas(bestPart, cc[0], cc[1])) return cc;
    return adminPolyInnerPoint(bestPart);
  }
  // Computed once per feature and remembered on it (a new file brings new objects).
  function adminFeatureLabelPoint(f){
    if(f._lp === undefined){
      var p = null;
      try{ p = adminGeomLabelPoint(f.geometry); }catch(e){ p = null; }
      f._lp = p || false;
    }
    return f._lp || null;
  }
  // Centre of the part of a unit that is currently on screen. Used when the
  // unit's real centre is off-screen (a big aimag/soum zoomed in on), so its
  // name still shows in the middle of what the person can actually see.
  function adminVisiblePartPoint(f, bbox){
    if(typeof turf === 'undefined' || !turf.bboxClip) return null;
    try{
      var clipped = turf.bboxClip({ type:'Feature', properties:{}, geometry:f.geometry }, bbox);
      return adminGeomLabelPoint(clipped && clipped.geometry);
    }catch(e){ return null; }
  }

  // The part of the map the person can actually see: the bottom sheet covers
  // the lower part of the map and the search box the top, so names are only
  // placed in between (otherwise they'd be hidden behind those panels).
  function adminLabelRect(){
    var size = map.getSize(), R = { x0:0, y0:0, x1:size.x, y1:size.y };
    var mr = map.getContainer().getBoundingClientRect();
    var sheet = document.getElementById('sheet');
    if(sheet){
      var sr = sheet.getBoundingClientRect();
      if(sr.height > 0 && sr.width >= mr.width*0.5 && sr.top > mr.top) R.y1 = Math.max(R.y0, Math.min(R.y1, sr.top - mr.top - 4));
    }
    var sw = document.getElementById('searchWrap');
    if(sw){
      var wr = sw.getBoundingClientRect();
      // (with the side panel the search box sits over the panel, not over the map)
      if(wr.height > 0 && wr.bottom > mr.top && wr.right > mr.left) R.y0 = Math.min(Math.max(R.y0, wr.bottom - mr.top + 4), R.y1);
    }
    return R;
  }

  // Container-pixel anchor for one candidate label, or null.
  function adminLabelAnchor(c, R){
    var padX = c.w/2 + 3, padY = c.h/2 + 3;
    var x0 = R.x0 + padX, x1 = R.x1 - padX, y0 = R.y0 + padY, y1 = R.y1 - padY;
    if(x1 <= x0 || y1 <= y0) return null;
    var lp = adminFeatureLabelPoint(c.e.feat);
    if(lp){
      var cp = map.latLngToContainerPoint([lp[1], lp[0]]);
      if(cp.x >= x0 && cp.x <= x1 && cp.y >= y0 && cp.y <= y1) return cp;
    }
    var nw = map.containerPointToLatLng([x0, y0]), se = map.containerPointToLatLng([x1, y1]);
    var p = adminVisiblePartPoint(c.e.feat, [nw.lng, se.lat, se.lng, nw.lat]);
    return p ? map.latLngToContainerPoint([p[1], p[0]]) : null;
  }

  function addAdminLabels(visible){
    if(!adminLabelsOn) return;
    var R = adminLabelRect();
    if(R.x1 - R.x0 < 30 || R.y1 - R.y0 < 30) return;

    // 1) Only units big enough on screen to hold their own name get one —
    //    tiny polygons stay unlabelled until the person zooms in on them.
    var cands = [];
    visible.forEach(function(e){
      var name = e.feat.properties && e.feat.properties.NAME;
      var font = ADMIN_LABEL_FONT[e.lvl];
      if(!name || !font || !e.feat.bbox) return;
      var w = adminLabelWidth(String(name), e.lvl), h = font.px + 4, bb = e.feat.bbox;
      var tl = map.latLngToContainerPoint([bb[3], bb[0]]), br = map.latLngToContainerPoint([bb[1], bb[2]]);
      var ext = { x0:Math.max(tl.x, R.x0), x1:Math.min(br.x, R.x1), y0:Math.max(tl.y, R.y0), y1:Math.min(br.y, R.y1) };
      if(ext.x1 - ext.x0 < w || ext.y1 - ext.y0 < h*1.5) return;
      cands.push({ e:e, name:String(name), lvl:e.lvl, w:w, h:h, ext:ext, area:(ext.x1-ext.x0)*(ext.y1-ext.y0) });
    });
    cands.sort(function(a, b){ return ADMIN_LABEL_ORDER[a.lvl] - ADMIN_LABEL_ORDER[b.lvl] || b.area - a.area; });

    // 2) Place them. When several units share the same middle (a bag, its soum
    //    and its aimag all fill the screen) the labels stack so they read
    //    top to bottom as АЙМАГ, СУМ, БАГ: the bag keeps the exact centre (it is
    //    the smallest polygon, so it can least afford to move), the soum slides
    //    up just far enough to clear it, and the aimag slides up above both.
    //    A label that was moved must stay inside its own unit's on-screen
    //    extent, and one that still cannot be placed is dropped.
    var placed = [], GAP = 2;
    // Preferred slide directions per level: 0 = stay put, -1 = up, +1 = down.
    var DIRS = { bag:[0, 1, -1], soum:[0, -1, 1], aimag:[0, -1, 1] };
    function firstClash(rc){
      for(var i=0; i<placed.length; i++){
        var q = placed[i];
        if(rc.x0 < q.x1 + GAP && rc.x1 > q.x0 - GAP && rc.y0 < q.y1 + GAP && rc.y1 > q.y0 - GAP) return q;
      }
      return null;
    }
    // Slide `base` vertically (dir -1 up / +1 down) just far enough to clear every placed label.
    function slide(base, dir){
      var rc = base;
      for(var it=0; it<12; it++){
        var q = firstClash(rc);
        if(!q) return rc;
        var move = (dir < 0 ? rc.y1 - (q.y0 - GAP) : (q.y1 + GAP) - rc.y0) + 0.5;
        rc = { x0:rc.x0, x1:rc.x1, y0:rc.y0 + dir*move, y1:rc.y1 + dir*move };
        if(rc.y1 < R.y0 - 200 || rc.y0 > R.y1 + 200) return null;
      }
      return null;
    }
    function within(rc, box){ return rc.x0 >= box.x0 && rc.x1 <= box.x1 && rc.y0 >= box.y0 && rc.y1 <= box.y1; }

    cands.forEach(function(c){
      var p = adminLabelAnchor(c, R);
      if(!p) return;
      var base = { x0:p.x - c.w/2, x1:p.x + c.w/2, y0:p.y - c.h/2, y1:p.y + c.h/2 };
      var dirs = DIRS[c.lvl], rc = null;
      for(var d=0; d<dirs.length && !rc; d++){
        var cand = dirs[d] === 0 ? (firstClash(base) ? null : base) : slide(base, dirs[d]);
        if(!cand || !within(cand, R)) continue;
        if(dirs[d] !== 0 && !within(cand, c.ext)) continue;
        rc = cand;
      }
      if(!rc) return;
      placed.push(rc);
      var f = ADMIN_LABEL_FONT[c.lvl], col = ADMIN_LEVEL_COLOR[c.lvl] || '#ffffff';
      L.marker(map.containerPointToLatLng([(rc.x0 + rc.x1)/2, (rc.y0 + rc.y1)/2]), {
        icon: L.divIcon({
          className: 'admin-label', iconSize: [0, 0],
          html: '<span class="admin-label-txt" style="font-size:'+f.px+'px;font-weight:'+f.weight+';color:'+col+'">'+escapeXml(c.name)+'</span>'
        }),
        interactive: false, keyboard: false, zIndexOffset: -1000
      }).addTo(adminLayerGroup);
    });
  }

  function updateAdminOverlay(){
    adminLayerGroup.clearLayers();
    if(!adminLoaded || !adminVisible){ adminHint(''); renderLegend(); return; }

    var zoom = map.getZoom();
    if(zoom < ADMIN_MIN_ZOOM){
      adminHint('Захиргааны хил харахын тулд ойртуулна уу (zoom ' + ADMIN_MIN_ZOOM + '+)');
      renderLegend();
      return;
    }

    var b = map.getBounds();
    var view = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
    var visible = [];
    for(var i=0;i<adminFeatures.length;i++){
      var f = adminFeatures[i];
      var lvl = f.properties && f.properties.LEVEL;
      if(!adminLevelsOn[lvl]) continue;
      if(bboxIntersects(f.bbox, view)) visible.push({ feat:f, idx:i, lvl:lvl });
    }

    if(visible.length > ADMIN_MAX_RENDER){
      adminHint(visible.length + ' хил олдлоо — цөөрүүлэхийн тулд ойртуулна уу эсвэл зарим түвшинг унтраана уу');
      renderLegend();
      return;
    }

    adminHint(adminSel.isOn() ? 'Сонгох горим: хил дээр товшиж сонгоно уу (' + adminSel.count() + ' сонгосон)' : '');

    function rank(e){ return ADMIN_LEVEL_RANK[e.lvl]; }
    function colorOf(e){ return ADMIN_LEVEL_COLOR[e.lvl] || '#94a3b8'; }

    // Pass 1 — clickable areas (popup, or selection in select mode). Drawn
    // aimag -> soum -> bag so the smallest unit is on top and a tap reports
    // the most specific one (a bag's popup also names its soum and aimag).
    // Stroke is off here; the visible lines come from pass 2.
    visible.slice().sort(function(a, b){ return rank(a) - rank(b) || a.idx - b.idx; }).forEach(function(e){
      var c = colorOf(e);
      var isSel = adminSel.isSelected(e.idx);
      var layer = L.geoJSON(e.feat.geometry, {
        style: { stroke:false, fill:true, fillColor:c, fillOpacity: isSel ? Math.max(adminFillOpacity, 0.3) : adminFillOpacity }
      }).addTo(adminLayerGroup);
      if(adminSel.isOn()){
        layer.on('click', function(ev){
          L.DomEvent.stopPropagation(ev);
          adminSel.toggle(e.idx);
          updateAdminOverlay();
        });
      } else {
        layer.bindPopup(adminPopupHtml(e.feat.properties), { className:'mrpam-popup', maxWidth:240 });
      }
    });

    // Pass 2 — the boundary lines, non-interactive so taps fall through to
    // pass 1. Drawn bag -> soum -> aimag: aimag on top.
    visible.filter(function(e){ return !adminSel.isSelected(e.idx); })
      .sort(function(a, b){ return rank(b) - rank(a) || a.idx - b.idx; })
      .forEach(function(e){
        L.geoJSON(e.feat.geometry, {
          interactive: false,
          style: { color:colorOf(e), weight:adminWeight * ADMIN_STROKE_SCALE[e.lvl], opacity:0.9, fill:false }
        }).addTo(adminLayerGroup);
      });

    // Pass 3 — selected units get a white outline on top of everything.
    visible.filter(function(e){ return adminSel.isSelected(e.idx); }).forEach(function(e){
      L.geoJSON(e.feat.geometry, {
        interactive: false,
        style: { color:'#ffffff', weight:Math.max(adminWeight * ADMIN_STROKE_SCALE[e.lvl] + 1.5, 3), opacity:1, fill:false }
      }).addTo(adminLayerGroup);
    });

    addAdminLabels(visible);

    renderLegend();
    adminSel.refreshUi();
  }

  var debouncedAdminUpdate = debounce(updateAdminOverlay, 250);
  map.on('moveend zoomend', debouncedAdminUpdate);

  // The bottom sheet hides part of the map, and it changes height (collapse,
  // switching tabs, results appearing) without the map moving — so re-place the
  // names whenever its size changes, otherwise they could end up behind it.
  (function watchSheetForLabels(){
    var sheetEl = document.getElementById('sheet');
    if(!sheetEl) return;
    if(typeof ResizeObserver === 'function'){
      new ResizeObserver(function(){ debouncedAdminUpdate(); }).observe(sheetEl);
    } else {
      sheetEl.addEventListener('transitionend', function(ev){ if(ev.target === sheetEl) debouncedAdminUpdate(); });
    }
  })();

  function loadAdminText(text, silent, sourceLabel){
    adminBtn.classList.add('loading');
    if(!silent) toast('Файл уншиж байна…');

    function handleResult(data){
      adminBtn.classList.remove('loading');
      if(!data.ok){
        if(silent){ adminAutoLoadFailedHint(); }
        else { toast('GeoJSON файл уншихад алдаа гарлаа. administration.geojson файлыг сонгосон эсэхээ шалгана уу.'); }
        return;
      }
      // Sort once, here, rather than re-sorting on every redraw. Order is
      // bag -> soum -> aimag: this is both the fill draw order (smallest
      // unit on top, so a tap/popup reports the most specific one first)
      // and, reversed, the stroke draw order (aimag painted last so its
      // line wins on the shared edges). Loading the file in this order
      // also means an aimag can never end up drawn (and thus interactive)
      // before the soums/bags nested inside it, regardless of what order
      // the source GeoJSON happened to list features in.
      adminFeatures = data.features.slice().sort(function(a, b){
        var ra = ADMIN_LEVEL_RANK[a.properties && a.properties.LEVEL];
        var rb = ADMIN_LEVEL_RANK[b.properties && b.properties.LEVEL];
        if(ra === undefined) ra = 99;
        if(rb === undefined) rb = 99;
        return rb - ra; // bag(2) -> soum(1) -> aimag(0)
      });
      adminLoaded = true;
      adminVisible = true;
      adminSel.reset(); // indexes belong to the previous file's features
      adminLayerGroup.addTo(map);
      adminBtn.classList.add('active');
      toast(adminFeatures.length + ' захиргааны хил ачаалагдлаа' + (sourceLabel ? ' (' + sourceLabel + ')' : ''));
      idbSet(ADMIN_ENABLED_KEY, true).catch(function(){});
      updateAdminOverlay();
    }

    var worker = getAdminWorker();
    if(worker){
      worker.onmessage = function(e){ handleResult(e.data); };
      worker.onerror = function(){ handleResult(parseGeojsonSync(text)); };
      worker.postMessage(text);
    } else {
      setTimeout(function(){ handleResult(parseGeojsonSync(text)); }, 0);
    }
  }

  function loadAdminFile(file, silent){
    file.text().then(function(text){
      loadAdminText(text, silent, silent ? 'өмнөх файлаас' : null);
    }).catch(function(){
      adminBtn.classList.remove('loading');
      if(silent){ adminAutoLoadFailedHint(); }
      else { toast('Файл уншихад алдаа гарлаа'); }
    });
  }

  // Same "bundled next to the page" convenience as MRPAM — if
  // administration.geojson sits alongside this HTML file, it loads with
  // zero clicks and no prior file selection needed.
  var ADMIN_BUNDLED_URL = 'administration.geojson';
  function tryLoadBundledAdmin(){
    return fetch(ADMIN_BUNDLED_URL, { cache:'no-cache' }).then(function(res){
      if(!res.ok) throw new Error('http ' + res.status);
      return res.text();
    }).then(function(text){
      loadAdminText(text, true, 'дотоод файлаас');
      return true;
    }).catch(function(){
      return false; // not found / blocked by CORS (e.g. file://) — caller falls back
    });
  }

  function pickAdminFile(){
    if(supportsFSAccess){
      window.showOpenFilePicker({
        types: [{ description:'GeoJSON', accept: { 'application/geo+json':['.geojson'], 'application/json':['.json'] } }],
        excludeAcceptAllOption: false,
        multiple: false
      }).then(function(handles){
        var handle = handles[0];
        idbSet(ADMIN_HANDLE_KEY, handle).catch(function(){});
        return handle.getFile();
      }).then(function(file){
        loadAdminFile(file, false);
      }).catch(function(err){
        if(err && err.name === 'AbortError') return;
        toast('Файл сонгоход алдаа гарлаа');
      });
    } else {
      adminFileInput.value = '';
      adminFileInput.click();
    }
  }

  function tryAutoLoadAdmin(){
    tryLoadBundledAdmin().then(function(loadedBundled){
      if(loadedBundled) return;
      tryAutoLoadAdminFromRememberedHandle();
    });
  }

  function tryAutoLoadAdminFromRememberedHandle(){
    if(!supportsFSAccess) return;
    idbGet(ADMIN_ENABLED_KEY).then(function(wasEnabled){
      if(!wasEnabled) return;
      return idbGet(ADMIN_HANDLE_KEY).then(function(handle){
        if(!handle) return;
        return handle.queryPermission({ mode:'read' }).then(function(perm){
          if(perm === 'granted') return handle;
          if(perm === 'prompt'){
            return handle.requestPermission({ mode:'read' }).then(function(p2){
              if(p2 === 'granted') return handle;
              throw new Error('permission not granted');
            });
          }
          throw new Error('permission denied');
        }).then(function(h){ return h.getFile(); })
          .then(function(file){ loadAdminFile(file, true); })
          .catch(function(){ adminAutoLoadFailedHint(); });
      });
    }).catch(function(){});
  }

  function adminAutoLoadFailedHint(){
    var el = document.getElementById('adminHint');
    el.innerHTML = 'Өмнөх GeoJSON файлыг дахин ачаалж чадсангүй. <a href="#" id="adminRetryLink" style="color:var(--teal); text-decoration:underline;">Дахин сонгох</a>';
    el.classList.add('show');
    document.getElementById('adminRetryLink').addEventListener('click', function(e){
      e.preventDefault();
      adminHint('');
      pickAdminFile();
    });
  }
  map.whenReady(tryAutoLoadAdmin);

  adminBtn.addEventListener('click', function(){
    if(!adminLoaded){
      pickAdminFile();
      return;
    }
    adminVisible = !adminVisible;
    adminBtn.classList.toggle('active', adminVisible);
    idbSet(ADMIN_ENABLED_KEY, adminVisible).catch(function(){});
    if(adminVisible){ adminLayerGroup.addTo(map); updateAdminOverlay(); }
    else { map.removeLayer(adminLayerGroup); adminHint(''); renderLegend(); adminSel.reset(); }
  });

  adminFileInput.addEventListener('change', function(){
    var file = this.files && this.files[0];
    if(file) loadAdminFile(file, false);
  });

  // ---- Admin boundary settings dropdown (per-level visibility, style) ----
  var adminSettingsBtn = document.getElementById('adminSettingsBtn');
  var adminSettingsPanel = document.getElementById('adminSettingsPanel');
  adminSettingsBtn.addEventListener('click', function(e){
    e.stopPropagation();
    adminSettingsPanel.classList.toggle('open');
  });
  document.addEventListener('click', function(e){
    if(!adminSettingsPanel.contains(e.target) && e.target !== adminSettingsBtn && !adminSettingsBtn.contains(e.target)){
      adminSettingsPanel.classList.remove('open');
    }
  });

  var alShowAimag = document.getElementById('alShowAimag');
  var alShowSoum = document.getElementById('alShowSoum');
  var alShowBag = document.getElementById('alShowBag');
  alShowAimag.checked = !!adminLevelsOn.aimag;
  alShowSoum.checked = !!adminLevelsOn.soum;
  alShowBag.checked = !!adminLevelsOn.bag;
  function wireAdminLevelToggle(el, key){
    el.addEventListener('change', function(){
      adminLevelsOn[key] = el.checked;
      saveSetting('adminLevelsOn', adminLevelsOn);
      updateAdminOverlay();
    });
  }
  wireAdminLevelToggle(alShowAimag, 'aimag');
  wireAdminLevelToggle(alShowSoum, 'soum');
  wireAdminLevelToggle(alShowBag, 'bag');

  var alShowLabels = document.getElementById('alShowLabels');
  alShowLabels.checked = adminLabelsOn;
  alShowLabels.addEventListener('change', function(){
    adminLabelsOn = alShowLabels.checked;
    saveSetting('adminLabelsOn', adminLabelsOn);
    updateAdminOverlay();
  });

  var alWeight = document.getElementById('alWeight');
  var alWeightVal = document.getElementById('alWeightVal');
  var alFillOpacity = document.getElementById('alFillOpacity');
  var alFillOpacityVal = document.getElementById('alFillOpacityVal');
  alWeight.value = adminWeight;
  alWeightVal.textContent = adminWeight + 'px';
  alFillOpacity.value = Math.round(adminFillOpacity*100);
  alFillOpacityVal.textContent = Math.round(adminFillOpacity*100) + '%';
  alWeight.addEventListener('input', function(){
    adminWeight = parseFloat(this.value);
    alWeightVal.textContent = adminWeight + 'px';
    saveSetting('adminWeight', adminWeight);
    updateAdminOverlay();
  });
  alFillOpacity.addEventListener('input', function(){
    adminFillOpacity = parseInt(this.value, 10) / 100;
    alFillOpacityVal.textContent = this.value + '%';
    saveSetting('adminFillOpacity', adminFillOpacity);
    updateAdminOverlay();
  });

  var drawLayer = L.layerGroup().addTo(map);

  // ---------- Graticule (coordinate grid) ----------
  var graticuleLayer = L.layerGroup();
  var GRAT_STYLE_DEFAULT = { color:'#ffd23f', weight:2, opacity:1, labelColor:'#cfe3da', labelSize:9.5 };
  var graticuleOn = getSetting('graticuleOn', true);
  var gratStyle = Object.assign({}, GRAT_STYLE_DEFAULT, getSetting('gratStyle', {}));
  var gratDensityOffsetSaved = getSetting('gratDensityOffset', 0);
  var gratManualIntervalSaved = getSetting('gratManualInterval', null);

  // Standard degree/minute/second steps, largest to smallest.
  var GRAT_STEPS = [
    90, 45, 30, 20, 10, 5, 2, 1,   // degrees
    0.5, 0.25, 0.2, 0.1,
    1/60*30, 1/60*20, 1/60*10, 1/60*5, 1/60*2, 1/60,   // 30',20',10',5',2',1'
    1/3600*30, 1/3600*20, 1/3600*10, 1/3600*5, 1/3600*2, 1/3600, // 30",20",10",5",2",1"
    1/3600*0.5, 1/3600*0.2, 1/3600*0.1, 1/3600*0.05, 1/3600*0.02,
    1/3600*0.01, 1/3600*0.005, 1/3600*0.002, 1/3600*0.001 // sub-arcsecond
  ];
  var GRAT_MIN_LINES = 2;        // target range: never fewer than this...
  var GRAT_TARGET_MAX_LINES = 3; // ...and never more than this, when a step allows it
  var GRAT_MAX_LINES = 60;       // hard safety cap on the draw loop only
  var gratDensityOffset = gratDensityOffsetSaved || 0; // manual nudge from the auto-picked step; 0 = auto
  var gratManualInterval = gratManualIntervalSaved || null; // explicit D/M/S interval in degrees, or null = not set

  function gratNextStep(v, iv){ return Math.round((v+iv)*1e9)/1e9; }

  // How many grid lines a given interval produces across [startCoord,
  // endCoord] once floor-aligned to the grid origin — same alignment the
  // real draw loop uses, so this always matches what ends up on screen.
  function gratCountLines(startCoord, endCoord, iv){
    var s = Math.floor(startCoord/iv)*iv;
    var n = 0;
    for(var v=s; v<=endCoord; v=gratNextStep(v,iv)){ n++; if(n > 200) break; }
    return n;
  }

  // The graticule is driven entirely by latitude: pick the LARGEST (coarsest,
  // roundest) standard step whose latitude line count lands in [2,3].
  // GRAT_STEPS is ordered largest-to-smallest, so the first match found is
  // the coarsest valid one. Returns an index into GRAT_STEPS (not the raw
  // value) so gratPickInterval can apply a manual density offset on top —
  // a smaller index means a smaller (finer/denser) step.
  function gratPickAutoIndex(south, north){
    for(var i=0;i<GRAT_STEPS.length;i++){
      var count = gratCountLines(south, north, GRAT_STEPS[i]);
      if(count >= GRAT_MIN_LINES && count <= GRAT_TARGET_MAX_LINES) return i;
    }
    // No standard step lands inside [2,3] (an extreme span) — fall back to
    // whichever step gets closest to the range from whichever side it misses on.
    var best = GRAT_STEPS.length-1, bestDiff = Infinity;
    for(var j=0;j<GRAT_STEPS.length;j++){
      var count2 = gratCountLines(south, north, GRAT_STEPS[j]);
      var diff2 = count2 < GRAT_MIN_LINES ? (GRAT_MIN_LINES - count2) : (count2 - GRAT_TARGET_MAX_LINES);
      if(diff2 < bestDiff){ bestDiff = diff2; best = j; }
    }
    return best;
  }

  // Applies the manual density offset on top of the auto pick. Pressing
  // "+" (denser) decreases the index (moves toward finer/smaller steps —
  // more lines); "−" (sparser) increases it (coarser — fewer lines).
  // A manually-entered D/M/S interval takes priority over both the auto
  // pick and the density offset — it is an explicit value, not a nudge.
  function gratPickInterval(south, north){
    if(gratManualInterval !== null && gratManualInterval > 0) return gratManualInterval;
    var autoIdx = gratPickAutoIndex(south, north);
    var idx = autoIdx - gratDensityOffset;
    if(idx < 0) idx = 0;
    if(idx > GRAT_STEPS.length-1) idx = GRAT_STEPS.length-1;
    return GRAT_STEPS[idx];
  }

  function gratFmt(val, isLat){
    var neg = val < 0; val = Math.abs(val);
    // Round to the nearest tenth of an arcsecond first, in total arcseconds,
    // then decompose into d/m/s from that single rounded value — this is
    // what keeps 59.95" from displaying as "60"" without carrying into the
    // minute (and 59' 59.95" from carrying into the degree).
    var totalTenthsOfSec = Math.round(val*3600*10);
    var d = Math.floor(totalTenthsOfSec / 36000);
    var remAfterDeg = totalTenthsOfSec - d*36000;
    var m = Math.floor(remAfterDeg / 600);
    var s = (remAfterDeg - m*600) / 10;
    var dir = isLat ? (neg?'S':'N') : (neg?'W':'E');
    if(m===0 && s===0) return d+'\u00b0'+dir;
    if(s===0) return d+'\u00b0'+m+'\u2032'+dir;
    return d+'\u00b0'+m+'\u2032'+s+'\u2033'+dir;
  }

  function gratLabel(text, lat, lng, iconSize, iconAnchor, alignClass){
    L.marker([lat, lng], {
      icon:L.divIcon({
        html:'<div class="grat-label '+alignClass+'" style="color:'+gratStyle.labelColor+';font-size:'+gratStyle.labelSize+'px">'+text+'</div>',
        className:'grat-label-wrap',
        iconSize:iconSize, iconAnchor:iconAnchor
      }),
      interactive:false
    }).addTo(graticuleLayer);
  }

  // Longitude line: vertical, labeled at both the top and bottom edges.
  function gratAddLonLine(lo, b, lineStyle){
    L.polyline([[b.getSouth(),lo],[b.getNorth(),lo]], lineStyle).addTo(graticuleLayer);
    var text = gratFmt(lo,false);
    var charW = gratStyle.labelSize * 0.62;
    var h = gratStyle.labelSize + 5;
    var w = text.length*charW+10;
    gratLabel(text, b.getNorth(), lo, [w,h], [w/2,-4], 'gl-center');
    gratLabel(text, b.getSouth(), lo, [w,h], [w/2,h+4], 'gl-center');
  }

  // Latitude line: horizontal, labeled at both the left and right edges.
  function gratAddLatLine(la, b, lineStyle){
    L.polyline([[la,b.getWest()],[la,b.getEast()]], lineStyle).addTo(graticuleLayer);
    var text = gratFmt(la,true);
    var charW = gratStyle.labelSize * 0.62;
    var h = gratStyle.labelSize + 5;
    var w = text.length*charW+10;
    gratLabel(text, la, b.getWest(), [w,h], [-6,h/2], 'gl-left');
    gratLabel(text, la, b.getEast(), [w,h], [w+6,h/2], 'gl-right');
  }

  function redrawGraticule(){
    graticuleLayer.clearLayers();
    if(!graticuleOn) return;
    var b = map.getBounds();
    var iv = gratPickInterval(b.getSouth(), b.getNorth());
    var lineStyle = { color:gratStyle.color, weight:gratStyle.weight, opacity:gratStyle.opacity, interactive:false };

    var sLon = Math.floor(b.getWest()/iv)*iv;
    var sLat = Math.floor(b.getSouth()/iv)*iv;
    var lonCount = 0, latCount = 0;

    for(var lo=sLon; lo<=b.getEast(); lo=gratNextStep(lo,iv)){
      gratAddLonLine(lo, b, lineStyle);
      lonCount++;
      if(lonCount >= GRAT_MAX_LINES) break;
    }
    for(var la=sLat; la<=b.getNorth(); la=gratNextStep(la,iv)){
      gratAddLatLine(la, b, lineStyle);
      latCount++;
      if(latCount >= GRAT_MAX_LINES) break;
    }

    // Safety net: guarantee at least GRAT_MIN_LINES (2) lines per axis are
    // always visible, independent of whatever gratPickInterval selected —
    // even in an edge case where the chosen interval places most grid
    // lines just outside the current viewport. Falls back to lines at the
    // 1/3 and 2/3 points of the viewport, which are always inside it.
    if(lonCount < GRAT_MIN_LINES){
      var lw = b.getWest(), le = b.getEast();
      for(var k=lonCount; k<GRAT_MIN_LINES; k++){
        var frac = (k+1) / (GRAT_MIN_LINES+1);
        gratAddLonLine(Math.round((lw + (le-lw)*frac)*1e6)/1e6, b, lineStyle);
      }
    }
    if(latCount < GRAT_MIN_LINES){
      var ls = b.getSouth(), ln = b.getNorth();
      for(var m=latCount; m<GRAT_MIN_LINES; m++){
        var fracL = (m+1) / (GRAT_MIN_LINES+1);
        gratAddLatLine(Math.round((ls + (ln-ls)*fracL)*1e6)/1e6, b, lineStyle);
      }
    }
  }

  graticuleLayer.addTo(map);
  map.on('moveend zoomend resize', redrawGraticule);
  map.whenReady(redrawGraticule);

  var graticuleBtn = document.getElementById('graticuleBtn');
  graticuleBtn.classList.toggle('active', graticuleOn);
  if(!graticuleOn){ map.removeLayer(graticuleLayer); }
  graticuleBtn.addEventListener('click', function(){
    graticuleOn = !graticuleOn;
    graticuleBtn.classList.toggle('active', graticuleOn);
    if(graticuleOn){ graticuleLayer.addTo(map); redrawGraticule(); }
    else { map.removeLayer(graticuleLayer); }
    saveSetting('graticuleOn', graticuleOn);
  });

  // ---- Graticule style settings dropdown ----
  var gratSettingsBtn = document.getElementById('gratSettingsBtn');
  var gratSettingsPanel = document.getElementById('gratSettingsPanel');
  function toggleGratSettings(){ gratSettingsPanel.classList.toggle('open'); }
  gratSettingsBtn.addEventListener('click', function(e){
    e.stopPropagation();
    toggleGratSettings();
  });
  document.addEventListener('click', function(e){
    if(!gratSettingsPanel.contains(e.target) && e.target !== gratSettingsBtn){
      gratSettingsPanel.classList.remove('open');
    }
  });

  var gsColor = document.getElementById('gsColor');
  var gsWeight = document.getElementById('gsWeight');
  var gsWeightVal = document.getElementById('gsWeightVal');
  var gsOpacity = document.getElementById('gsOpacity');
  var gsOpacityVal = document.getElementById('gsOpacityVal');
  var gsDensityMinus = document.getElementById('gsDensityMinus');
  var gsDensityPlus = document.getElementById('gsDensityPlus');
  var gsDensityVal = document.getElementById('gsDensityVal');

  function updateDensityLabel(){
    if(gratDensityOffset === 0){ gsDensityVal.textContent = 'Авто'; return; }
    gsDensityVal.textContent = (gratDensityOffset > 0 ? '+' : '') + gratDensityOffset;
  }
  gsDensityMinus.addEventListener('click', function(){
    gratDensityOffset--;
    updateDensityLabel();
    redrawGraticule();
    saveSetting('gratDensityOffset', gratDensityOffset);
  });
  gsDensityPlus.addEventListener('click', function(){
    gratDensityOffset++;
    updateDensityLabel();
    redrawGraticule();
    saveSetting('gratDensityOffset', gratDensityOffset);
  });
  updateDensityLabel();

  // ---- Manual degree/minute/second interval ----
  var gsManualToggle = document.getElementById('gsManualToggle');
  var gsManualRow = document.getElementById('gsManualRow');
  var gsManualDeg = document.getElementById('gsManualDeg');
  var gsManualMin = document.getElementById('gsManualMin');
  var gsManualSec = document.getElementById('gsManualSec');

  function applyManualInterval(){
    var d = parseFloat(gsManualDeg.value) || 0;
    var m = parseFloat(gsManualMin.value) || 0;
    var s = parseFloat(gsManualSec.value) || 0;
    var totalDeg = d + m/60 + s/3600;
    if(totalDeg <= 0){ gratManualInterval = null; return; }
    gratManualInterval = totalDeg;
  }

  gsManualToggle.addEventListener('change', function(){
    var on = this.checked;
    gsManualRow.style.display = on ? 'flex' : 'none';
    gsDensityMinus.disabled = on;
    gsDensityPlus.disabled = on;
    if(on){ applyManualInterval(); } else { gratManualInterval = null; }
    redrawGraticule();
    saveSetting('gratManualToggle', on);
    saveSetting('gratManualInterval', gratManualInterval);
  });
  [gsManualDeg, gsManualMin, gsManualSec].forEach(function(el){
    el.addEventListener('input', function(){
      if(!gsManualToggle.checked) return;
      applyManualInterval();
      redrawGraticule();
      saveSetting('gratManualInterval', gratManualInterval);
      saveSetting('gratManualDMS', { d:gsManualDeg.value, m:gsManualMin.value, s:gsManualSec.value });
    });
  });

  // Restore manual-interval UI state (checkbox + D/M/S fields) from settings.
  (function restoreManualInterval(){
    var dms = getSetting('gratManualDMS', null);
    if(dms){
      gsManualDeg.value = dms.d; gsManualMin.value = dms.m; gsManualSec.value = dms.s;
    }
    var wasOn = getSetting('gratManualToggle', false);
    if(wasOn){
      gsManualToggle.checked = true;
      gsManualRow.style.display = 'flex';
      gsDensityMinus.disabled = true;
      gsDensityPlus.disabled = true;
    }
  })();

  gsColor.value = gratStyle.color;
  gsWeight.value = gratStyle.weight;
  gsWeightVal.textContent = gratStyle.weight + 'px';
  gsOpacity.value = Math.round(gratStyle.opacity*100);
  gsOpacityVal.textContent = Math.round(gratStyle.opacity*100) + '%';

  gsColor.addEventListener('input', function(){
    gratStyle.color = this.value;
    redrawGraticule();
    saveSetting('gratStyle', gratStyle);
  });
  gsWeight.addEventListener('input', function(){
    gratStyle.weight = parseFloat(this.value);
    gsWeightVal.textContent = gratStyle.weight + 'px';
    redrawGraticule();
    saveSetting('gratStyle', gratStyle);
  });
  gsOpacity.addEventListener('input', function(){
    gratStyle.opacity = parseInt(this.value, 10) / 100;
    gsOpacityVal.textContent = this.value + '%';
    redrawGraticule();
    saveSetting('gratStyle', gratStyle);
  });

  var gsLabelColor = document.getElementById('gsLabelColor');
  var gsLabelSize = document.getElementById('gsLabelSize');
  var gsLabelSizeVal = document.getElementById('gsLabelSizeVal');

  gsLabelColor.value = gratStyle.labelColor;
  gsLabelSize.value = gratStyle.labelSize;
  gsLabelSizeVal.textContent = gratStyle.labelSize + 'px';

  gsLabelColor.addEventListener('input', function(){
    gratStyle.labelColor = this.value;
    redrawGraticule();
    saveSetting('gratStyle', gratStyle);
  });
  gsLabelSize.addEventListener('input', function(){
    gratStyle.labelSize = parseFloat(this.value);
    gsLabelSizeVal.textContent = gratStyle.labelSize + 'px';
    redrawGraticule();
    saveSetting('gratStyle', gratStyle);
  });

  // ---------- State ----------
  // shapes = array of { points: [{lat,lng}, ...] }. Tap mode edits shapes[tapShapeIndex].
  // Text mode can produce many shapes (one per blank-line-separated block).
  // Declared here, before the restore call below. It used to be declared further
  // down, so at this point it was still undefined and the restore looked up the
  // key "undefined" — nothing saved was ever found again after a reload.
  var SHAPES_KEY = 'talbaiHemjigchShapes_v1';
  var shapes = restorePersistedShapes() || [ { points: [] } ];
  var mode = 'tap'; // 'tap' | 'layers' | 'coords'
  var tapDrawActive = false;
  var tapShapeIndex = 0; // which shapes[] entry tap-draw currently edits
  var shapeEditActive = false; // vertex editing of an existing shape (js-10-edit.js)
  // Tap tools write into shapes[tapShapeIndex]; never let that be a shape of an imported batch.
  if(shapes[0] && shapes[0].batchId){
    shapes.push({ points: [] });
    tapShapeIndex = shapes.length - 1;
  }
  var lngLatOrder = getSetting('lngLatOrder', false); // false = lat,lng ; true = lng,lat
  var SHAPE_COLORS = ['#35d9b0', '#ff7a3d', '#5fb3ff', '#e8d05a', '#c792ea', '#ff6b9d', '#7ee787', '#ffb454'];

  // ---------- Undo / Redo ----------
  // Snapshot-based: before any destructive edit (adding/removing/clearing a
  // point, deleting or clearing a shape, replacing shapes[] from text mode),
  // the caller pushes a deep clone of the current { shapes, tapShapeIndex }
  // onto undoStack. Undo pops it back, pushing the pre-undo state onto
  // redoStack so it can be re-applied. Doing it this way (rather than
  // tracking each op type individually) covers every mutation site
  // uniformly and can't drift out of sync as new edit paths are added.
  var undoStack = [];
  var redoStack = [];
  var UNDO_MAX = 50;

  function snapshotState(){
    return { shapes: JSON.parse(JSON.stringify(shapes)), tapShapeIndex: tapShapeIndex };
  }
  // Undo keeps full copies, so with very large imports the stack is also
  // capped by the total number of points held (memory), not just by count.
  var UNDO_MAX_POINTS = 1500000;
  function snapshotPoints(snap){
    var n = 0;
    snap.shapes.forEach(function(s){ n += s.points.length; (s.holes || []).forEach(function(h){ n += h.length; }); });
    return n;
  }
  function pushUndo(){
    var snap = snapshotState();
    snap.nPts = snapshotPoints(snap);
    undoStack.push(snap);
    if(undoStack.length > UNDO_MAX) undoStack.shift();
    var total = 0;
    undoStack.forEach(function(sn){ total += sn.nPts || 0; });
    while(undoStack.length > 1 && total > UNDO_MAX_POINTS){ total -= undoStack.shift().nPts || 0; }
    redoStack = []; // a fresh edit invalidates the redo branch
    updateUndoRedoButtons();
  }
  function applySnapshot(snap){
    shapes = snap.shapes;
    tapShapeIndex = Math.min(snap.tapShapeIndex, shapes.length - 1);
    if(tapShapeIndex < 0) tapShapeIndex = 0;
    if(!shapes.length) shapes = [ { points: [] } ];
  }
  function doUndo(){
    if(undoStack.length === 0) return;
    if(trackActive){ toast('Идэвхтэй GPS замыг эхлээд зогсооно уу'); return; }
    if(tapDrawActive){ toast('Идэвхтэй товшиж зурсан талбайг эхлээд дуусгана уу'); return; }
    redoStack.push(snapshotState());
    applySnapshot(undoStack.pop());
    redrawAll();
    updateUndoRedoButtons();
    toast('Буцаагдлаа');
  }
  function doRedo(){
    if(redoStack.length === 0) return;
    if(trackActive){ toast('Идэвхтэй GPS замыг эхлээд зогсооно уу'); return; }
    if(tapDrawActive){ toast('Идэвхтэй товшиж зурсан талбайг эхлээд дуусгана уу'); return; }
    undoStack.push(snapshotState());
    applySnapshot(redoStack.pop());
    redrawAll();
    updateUndoRedoButtons();
    toast('Дахин хийгдлээ');
  }
  function updateUndoRedoButtons(){
    [globalUndoBtn, globalRedoBtn].forEach(function(){});
    if(globalUndoBtn) globalUndoBtn.disabled = undoStack.length === 0;
    if(globalRedoBtn) globalRedoBtn.disabled = redoStack.length === 0;
  }
  // Buttons are created in the toolbar markup below; declared here so the
  // functions above can reference them once assigned.
  var globalUndoBtn = document.getElementById('globalUndoBtn');
  var globalRedoBtn = document.getElementById('globalRedoBtn');
  globalUndoBtn.addEventListener('click', doUndo);
  globalRedoBtn.addEventListener('click', doRedo);
  document.addEventListener('keydown', function(e){
    var tag = (e.target && e.target.tagName || '').toLowerCase();
    if(tag === 'input' || tag === 'textarea') return; // don't hijack typing/editing
    var ctrl = e.ctrlKey || e.metaKey;
    if(!ctrl) return;
    if(e.key === 'z' || e.key === 'Z'){
      e.preventDefault();
      if(e.shiftKey) doRedo(); else doUndo();
    } else if(e.key === 'y' || e.key === 'Y'){
      e.preventDefault();
      doRedo();
    }
  });

  // GPS live-location + track-recording state
  var trackActive = false;
  var trackWatchId = null;
  var trackShapeIndex = null;
  var trackMarker = null;
  var lastTrackLatLng = null;
  var MIN_TRACK_DISTANCE = 4; // meters — filters GPS jitter while standing still

  // Diagnoses *why* geolocation failed, since "Байршил авах боломжгүй байна"
  // alone hides the real cause (insecure context, permission, signal, timeout).
  function geoErrorMessage(err){
    if(location.protocol === 'file:'){
      return 'Байршил ажиллахгүй байна: энэ файлыг шууд (file://) нээсэн байна. Байршлын үйлчилгээ зөвхөн https:// эсвэл localhost хаягаар нээсэн үед л ажилладаг тул файлыг вэб серверт байршуулж нээнэ үү.';
    }
    if(!window.isSecureContext){
      return 'Байршил ажиллахгүй байна: энэ хуудас "аюулгүй" (https://) орчинд нээгдээгүй байна.';
    }
    if(err && err.code === 1){
      return 'Байршлын зөвшөөрөл олгогдоогүй байна. Chrome-ийн сайтын тохиргооноос («i» товч → Байршил) зөвшөөрнө үү.';
    }
    if(err && err.code === 2){
      return 'Байршил тодорхойлогдсонгүй. Утасны GPS/Байршлын үйлчилгээ асаалттай эсэхээ шалгана уу.';
    }
    if(err && err.code === 3){
      return 'Байршил тодорхойлоход хугацаа хэтэрлээ. Дохио сул байж магадгүй — задгай орчинд дахин оролдоно уу.';
    }
    return 'Байршил авах боломжгүй байна.';
  }

  // ---------- Helpers ----------
  function fmt(n, d){ return Number(n).toFixed(d===undefined?6:d); }

  function toast(msg){
    var t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._tm);
    var duration = Math.min(7000, Math.max(2200, msg.length * 65));
    toast._tm = setTimeout(function(){ t.classList.remove('show'); }, duration);
  }

  var pointNumbersOn = getSetting('pointNumbersOn', false);

  function badgeIcon(num, color){
    if(!pointNumbersOn){
      return L.divIcon({
        html: '<div class="pt-dot" style="border-color:'+color+'"></div>',
        className:'', iconSize:[14,14], iconAnchor:[7,7]
      });
    }
    return L.divIcon({
      html: '<div class="pt-badge" style="border-color:'+color+'">'+num+'</div>',
      className:'', iconSize:[26,26], iconAnchor:[13,13]
    });
  }

  function distanceMeters(a,b){
    return turf.distance([a.lng,a.lat],[b.lng,b.lat], {units:'kilometers'}) * 1000;
  }

  // ---------- Area on the WGS84 ellipsoid ----------
  // turf.area treats the Earth as a sphere (radius 6378137 m), which in
  // Mongolia reads about 0.04–0.05 % smaller than ArcGIS / QGIS, which
  // measure on the WGS84 ellipsoid. Areas here use the ellipsoid too: on it,
  // dA = (a²/2) dq dλ with q the authalic-latitude function, so a ring's
  // area is (a²/4)·|Σ qᵢ (λᵢ₊₁ − λᵢ₋₁)| — the same shoelace sum turf uses,
  // with 2·sinφ replaced by q(φ).
  var WGS84_A = 6378137, WGS84_F = 1 / 298.257223563;
  var WGS84_E2 = WGS84_F * (2 - WGS84_F), WGS84_E = Math.sqrt(WGS84_E2);
  function authalicQ(latDeg){
    var s = Math.sin(latDeg * Math.PI / 180), es = WGS84_E * s;
    return (1 - WGS84_E2) * (s / (1 - es * es) - Math.log((1 - es) / (1 + es)) / (2 * WGS84_E));
  }
  // Edges longer than ~1 km are followed along the great circle (as ArcGIS
  // and QGIS treat edges as geodesics) rather than as a straight line in
  // degrees; short edges, like those of mapped areas, need no extra points.
  var AREA_DENSIFY_DEG = 0.01;   // edges longer than this get extra points…
  var AREA_STEP_DEG = 0.002;     // …about this far apart (≈200 m)
  // Points along the WGS84 geodesic from a to b (Vincenty's formulae, about
  // 0.1 mm accurate), dividing it into k equal parts; nearly antipodal ends,
  // where Vincenty does not converge, fall back to a great circle.
  var WGS84_B = WGS84_A * (1 - WGS84_F);
  function vincentyInverse(lat1, lon1, lat2, lon2){
    var f = WGS84_F, L = lon2 - lon1;
    var U1 = Math.atan((1 - f) * Math.tan(lat1)), U2 = Math.atan((1 - f) * Math.tan(lat2));
    var sU1 = Math.sin(U1), cU1 = Math.cos(U1), sU2 = Math.sin(U2), cU2 = Math.cos(U2);
    var lam = L, lamP, it = 0, sinS, cosS, sig, sinA, cos2A, cos2Sm, sl, cl;
    do{
      sl = Math.sin(lam); cl = Math.cos(lam);
      sinS = Math.sqrt((cU2*sl)*(cU2*sl) + (cU1*sU2 - sU1*cU2*cl)*(cU1*sU2 - sU1*cU2*cl));
      if(sinS === 0) return { s:0, az:0 };
      cosS = sU1*sU2 + cU1*cU2*cl;
      sig = Math.atan2(sinS, cosS);
      sinA = cU1*cU2*sl / sinS;
      cos2A = 1 - sinA*sinA;
      cos2Sm = cos2A !== 0 ? cosS - 2*sU1*sU2/cos2A : 0;
      var C = f/16 * cos2A * (4 + f*(4 - 3*cos2A));
      lamP = lam;
      lam = L + (1 - C) * f * sinA * (sig + C*sinS*(cos2Sm + C*cosS*(-1 + 2*cos2Sm*cos2Sm)));
    } while(Math.abs(lam - lamP) > 1e-12 && ++it < 200);
    if(it >= 200) return null;
    var uSq = cos2A * (WGS84_A*WGS84_A - WGS84_B*WGS84_B) / (WGS84_B*WGS84_B);
    var A = 1 + uSq/16384*(4096 + uSq*(-768 + uSq*(320 - 175*uSq)));
    var B = uSq/1024*(256 + uSq*(-128 + uSq*(74 - 47*uSq)));
    var dS = B*sinS*(cos2Sm + B/4*(cosS*(-1 + 2*cos2Sm*cos2Sm) - B/6*cos2Sm*(-3 + 4*sinS*sinS)*(-3 + 4*cos2Sm*cos2Sm)));
    return { s: WGS84_B*A*(sig - dS), az: Math.atan2(cU2*sl, cU1*sU2 - sU1*cU2*cl) };
  }
  function vincentyDirect(lat1, lon1, az, dist){
    var f = WGS84_F, sa1 = Math.sin(az), ca1 = Math.cos(az);
    var tU1 = (1 - f) * Math.tan(lat1), cU1 = 1 / Math.sqrt(1 + tU1*tU1), sU1 = tU1 * cU1;
    var s1 = Math.atan2(tU1, ca1), sinA = cU1*sa1, cos2A = 1 - sinA*sinA;
    var uSq = cos2A * (WGS84_A*WGS84_A - WGS84_B*WGS84_B) / (WGS84_B*WGS84_B);
    var A = 1 + uSq/16384*(4096 + uSq*(-768 + uSq*(320 - 175*uSq)));
    var B = uSq/1024*(256 + uSq*(-128 + uSq*(74 - 47*uSq)));
    var sig = dist / (WGS84_B*A), sigP, it = 0, cos2Sm, sinS, cosS;
    do{
      cos2Sm = Math.cos(2*s1 + sig); sinS = Math.sin(sig); cosS = Math.cos(sig);
      var dS = B*sinS*(cos2Sm + B/4*(cosS*(-1 + 2*cos2Sm*cos2Sm) - B/6*cos2Sm*(-3 + 4*sinS*sinS)*(-3 + 4*cos2Sm*cos2Sm)));
      sigP = sig; sig = dist / (WGS84_B*A) + dS;
    } while(Math.abs(sig - sigP) > 1e-12 && ++it < 100);
    var x = sU1*sinS - cU1*cosS*ca1;
    var lat2 = Math.atan2(sU1*cosS + cU1*sinS*ca1, (1 - f)*Math.sqrt(sinA*sinA + x*x));
    var lam = Math.atan2(sinS*sa1, cU1*cosS - sU1*sinS*ca1);
    var C = f/16 * cos2A * (4 + f*(4 - 3*cos2A));
    var Lr = lam - (1 - C)*f*sinA*(sig + C*sinS*(cos2Sm + C*cosS*(-1 + 2*cos2Sm*cos2Sm)));
    return [lon1 + Lr, lat2];
  }
  function greatCirclePoints(a, b, k){
    var r = Math.PI / 180, out = [];
    var inv = vincentyInverse(a[1]*r, a[0]*r, b[1]*r, b[0]*r);
    if(inv){
      for(var n=1;n<k;n++){
        var q = vincentyDirect(a[1]*r, a[0]*r, inv.az, inv.s * n / k);
        out.push([q[0] / r, q[1] / r]);
      }
      return out;
    }
    var la1 = a[1]*r, lo1 = a[0]*r, la2 = b[1]*r, lo2 = b[0]*r;
    var P = [Math.cos(la1)*Math.cos(lo1), Math.cos(la1)*Math.sin(lo1), Math.sin(la1)];
    var Q = [Math.cos(la2)*Math.cos(lo2), Math.cos(la2)*Math.sin(lo2), Math.sin(la2)];
    var d = Math.max(-1, Math.min(1, P[0]*Q[0] + P[1]*Q[1] + P[2]*Q[2])), w = Math.acos(d), sw = Math.sin(w);
    for(var i=1;i<k;i++){
      var t = i / k, fa = sw ? Math.sin((1-t)*w)/sw : 1-t, fb = sw ? Math.sin(t*w)/sw : t;
      var x = fa*P[0] + fb*Q[0], y = fa*P[1] + fb*Q[1], z = fa*P[2] + fb*Q[2];
      var lng = Math.atan2(y, x) / r;
      while(lng - a[0] > 180) lng -= 360;
      while(lng - a[0] < -180) lng += 360;
      out.push([lng, Math.atan2(z, Math.sqrt(x*x + y*y)) / r]);
    }
    return out;
  }
  // A ring with every edge longer than AREA_DENSIFY_DEG followed along the
  // geodesic (points AREA_STEP_DEG apart). Meridians are already geodesics
  // and are left alone. Returns the same array when nothing needs adding.
  // Clipping uses the densified outlines too, so the points where a clip
  // cuts a long edge lie on the geodesic and the pieces add up exactly.
  function densifyRingGeodesic(ring){
    var n = ring.length, closed = n > 1 && ring[0][0] === ring[n-1][0] && ring[0][1] === ring[n-1][1];
    if(closed) n--;
    var need = false;
    for(var e=0;e<n;e++){
      var p1 = ring[e], p2 = ring[(e + 1) % n];
      if(p1[0] !== p2[0] && Math.max(Math.abs(p2[0]-p1[0]), Math.abs(p2[1]-p1[1])) > AREA_DENSIFY_DEG){ need = true; break; }
    }
    if(!need) return ring;
    var out = [];
    for(var j=0;j<n;j++){
      var a = ring[j], b = ring[(j + 1) % n], span = Math.max(Math.abs(b[0]-a[0]), Math.abs(b[1]-a[1]));
      out.push(a);
      if(j === n - 1 && !closed && n < 3) break;
      if(a[0] !== b[0] && span > AREA_DENSIFY_DEG){
        var extra = greatCirclePoints(a, b, Math.min(20000, Math.ceil(span / AREA_STEP_DEG)));
        for(var x=0;x<extra.length;x++) out.push(extra[x]);
      }
    }
    if(closed) out.push(out[0]);
    return out;
  }
  function densifyGeometry(g){
    if(!g) return g;
    if(g.type === 'Polygon') return { type:'Polygon', coordinates: g.coordinates.map(densifyRingGeodesic) };
    if(g.type === 'MultiPolygon') return { type:'MultiPolygon', coordinates: g.coordinates.map(function(p){ return p.map(densifyRingGeodesic); }) };
    return g;
  }
  // Area (m²) of one ring of [lng, lat] positions, open or closed.
  function ringAreaEllipsoid(ring){
    var pts = densifyRingGeodesic(ring), n = pts.length;
    if(n > 1 && pts[0][0] === pts[n-1][0] && pts[0][1] === pts[n-1][1]) n--;
    if(n < 3) return 0;
    var sum = 0;
    for(var k=0;k<n;k++){
      var prev = pts[(k + n - 1) % n][0], next = pts[(k + 1) % n][0];
      sum += (next - prev) * authalicQ(pts[k][1]);
    }
    return Math.abs(sum) * (Math.PI / 180) * WGS84_A * WGS84_A / 4;
  }
  // Area (m²) of any GeoJSON Polygon / MultiPolygon / Feature / FeatureCollection;
  // holes are subtracted.
  function geoAreaM2(g){
    if(!g) return 0;
    if(g.type === 'FeatureCollection') return g.features.reduce(function(a, f){ return a + geoAreaM2(f); }, 0);
    if(g.type === 'Feature') return geoAreaM2(g.geometry);
    if(g.type === 'GeometryCollection') return (g.geometries || []).reduce(function(a, x){ return a + geoAreaM2(x); }, 0);
    var polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    var total = 0;
    polys.forEach(function(p){
      p.forEach(function(r, i){ total += (i ? -1 : 1) * ringAreaEllipsoid(r); });
    });
    return total;
  }

  // Memoised per points array: a redraw asks for the same areas several times,
  // and the check value catches points edited in place.
  var areaMemo = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
  function areaSqMeters(pts){
    var chk = pts.length;
    for(var i=0;i<pts.length;i++) chk = (chk * 31 + pts[i].lat * 1e7 + pts[i].lng * 3e7) % 1e15;
    var m = areaMemo && areaMemo.get(pts);
    if(m && m.chk === chk) return m.area;
    var area = ringAreaEllipsoid(pts.map(function(p){ return [p.lng, p.lat]; }));
    if(areaMemo) areaMemo.set(pts, { chk:chk, area:area });
    return area;
  }

  // ---------- Polygons with holes ----------
  // A polygon shape is { points:[outer ring], holes:[[ring], …] } (holes are
  // optional). Rings are stored open, as {lat,lng} points.
  function closedRing(pts){
    var r = pts.map(function(p){ return [p.lng, p.lat]; });
    if(r.length) r.push(r[0]);
    return r;
  }
  function shapeHoles(shape){ return shape.holes && shape.holes.length ? shape.holes : []; }
  // Closed [lng,lat] rings: outer first, then the holes.
  function shapeRings(shape){
    return [closedRing(shape.points)].concat(shapeHoles(shape).map(closedRing));
  }
  function shapeGeometry(shape){ return { type:'Polygon', coordinates: shapeRings(shape) }; }
  // Area with the holes taken out.
  function shapeAreaM2(shape){
    var a = areaSqMeters(shape.points), hs = shapeHoles(shape);
    for(var i=0;i<hs.length;i++) a -= areaSqMeters(hs[i]);
    return a > 0 ? a : 0;
  }
  // Length of the outline including the holes' outlines (as GIS reports it).
  function shapePerimeterM(shape){
    var t = perimeterMeters(shape.points), hs = shapeHoles(shape);
    for(var i=0;i<hs.length;i++) t += perimeterMeters(hs[i]);
    return t;
  }
  function shapeVertexCount(shape){
    var n = shape.points.length, hs = shapeHoles(shape);
    for(var i=0;i<hs.length;i++) n += hs[i].length;
    return n;
  }
  // Rings from a GeoJSON Polygon's coordinates -> { points, holes } (rings opened).
  function ringsToShapeParts(rings){
    var open = function(r){
      var pts = r.map(function(c){ return { lat:c[1], lng:c[0] }; });
      if(pts.length > 1){
        var a = pts[0], b = pts[pts.length-1];
        if(Math.abs(a.lat-b.lat) < 1e-12 && Math.abs(a.lng-b.lng) < 1e-12) pts.pop();
      }
      return pts;
    };
    var out = { points: open(rings[0]) };
    var holes = rings.slice(1).map(open).filter(function(h){ return h.length >= 3; });
    if(holes.length) out.holes = holes;
    return out;
  }

  function perimeterMeters(pts){
    var total = 0;
    for(var i=0;i<pts.length;i++){
      var a = pts[i], b = pts[(i+1)%pts.length];
      total += distanceMeters(a,b);
    }
    return total;
  }

  // Sum of consecutive segment lengths, WITHOUT closing the loop (open path/route).
  function pathLengthMeters(pts){
    var total = 0;
    for(var i=0;i<pts.length-1;i++){
      total += distanceMeters(pts[i], pts[i+1]);
    }
    return total;
  }

  var CLOSE_LOOP_METERS = 20; // if a recorded GPS track ends within this distance of its start, treat it as a closed area
  // Decide how a shape should be treated. Manually-entered shapes keep the
  // simple rule (1=point,2=line,3+=polygon). GPS-recorded tracks are treated
  // as an open route (line) unless the walked path loops back near its
  // starting point, in which case it's treated as a closed area (polygon).
  function shapeKind(shape){
    var pts = shape.points;
    if(pts.length === 0) return 'empty';
    if(pts.length === 1) return 'point';
    // Lines imported from a file (GeoJSON/KML LineString, GPX track or route)
    // stay lines whatever their number of points.
    if(shape.isLine) return 'line';
    if(shape.isTrack){
      if(pts.length >= 3 && distanceMeters(pts[0], pts[pts.length-1]) <= CLOSE_LOOP_METERS){
        return 'polygon';
      }
      return 'line';
    }
    return pts.length === 2 ? 'line' : 'polygon';
  }

  function humanArea(sqm){
    var ha = sqm/10000;
    if(sqm < 10000) return { big: fmt(sqm,1)+' м²', small: fmt(ha,2)+' га' };
    return { big: fmt(ha,2)+' га', small: fmt(sqm,0)+' м²' };
  }
  function humanLen(m){
    if(m < 1000) return { big: fmt(m,1)+' м', small: fmt(m/1000,2)+' км' };
    return { big: fmt(m/1000,2)+' км', small: fmt(m,0)+' м' };
  }

  // ---------- Per-shape layer properties (visibility / color / name) ----------
  // Lazily attach display props to a shape the first time it's touched, so
  // every existing shape-creation call site (tap mode, text mode, GPS track)
  // keeps working unchanged — this only adds fields, never requires them.
  function ensureLayerProps(shape, idx){
    if(shape.visible === undefined) shape.visible = true;
    if(!shape.color) shape.color = shape.isTrack ? '#4285f4' : SHAPE_COLORS[idx % SHAPE_COLORS.length];
    if(!shape.name){
      var k = shapeKind(shape);
      var kindLabel = shape.isTrack ? 'GPS зам' : (k === 'point' ? 'Цэг' : k === 'line' ? 'Шугам' : 'Полигон');
      shape.name = kindLabel + ' ' + (idx + 1);
    }
    return shape;
  }

  // ---------- Persist drawn shapes across sessions ----------
  // Saves the full `shapes` array (points + per-shape color/name/visible)
  // so a refresh, closed tab, or crash never wipes out work someone spent
  // real time on in the field. Debounced since redrawAll() can fire many
  // times a second during active GPS tracking.
  var persistTooBigWarned = false;
  var persistShapesDebounced = debounce(function(){
    try{
      // Skip persisting an all-empty single default shape — no point
      // writing/restoring "nothing was ever drawn".
      var hasContent = shapes.some(function(s){ return s.points.length > 0; });
      if(hasContent){
        // Points are stored as one flat [lat,lng,lat,lng,…] array per shape
        // (7 decimals ≈ 1 cm): about half the size of {lat,lng} objects, so
        // large imported files still fit in the browser's storage quota.
        var packed = shapes.map(function(s){
          var o = {}, k;
          for(k in s){ if(k !== 'points' && k !== 'holes' && k.charAt(0) !== '_') o[k] = s[k]; }
          var pack = function(pts){
            var flat = new Array(pts.length * 2);
            pts.forEach(function(p, i){ flat[2*i] = +p.lat.toFixed(7); flat[2*i+1] = +p.lng.toFixed(7); });
            return flat;
          };
          o.p = pack(s.points);
          if(s.holes && s.holes.length) o.h = s.holes.map(pack);
          return o;
        });
        try{
          localStorage.setItem(SHAPES_KEY, JSON.stringify(packed));
          persistTooBigWarned = false;
        } catch(err){
          localStorage.removeItem(SHAPES_KEY);
          if(!persistTooBigWarned){ persistTooBigWarned = true; toast('Дүрсүүд хэт их тул энэ төхөөрөмжид хадгалагдсангүй — хуудсыг хаахаас өмнө экспортлоорой'); }
        }
      } else {
        localStorage.removeItem(SHAPES_KEY);
      }
    } catch(e){ /* quota / private mode / disabled — silently skip */ }
  }, 500);

  function restorePersistedShapes(){
    try{
      var raw = localStorage.getItem(SHAPES_KEY);
      if(!raw) return null;
      var restored = JSON.parse(raw);
      if(!Array.isArray(restored) || !restored.length) return null;
      restored.forEach(function(s){
        var unpack = function(flat){
          var pts = [];
          for(var i=0;i+1<flat.length;i+=2) pts.push({ lat:flat[i], lng:flat[i+1] });
          return pts;
        };
        if(s && Array.isArray(s.p) && !s.points){
          s.points = unpack(s.p);
          delete s.p;
        }
        if(s && Array.isArray(s.h)){
          s.holes = s.h.filter(Array.isArray).map(unpack).filter(function(h){ return h.length >= 3; });
          if(!s.holes.length) delete s.holes;
          delete s.h;
        }
      });
      // Basic shape validation so corrupted/foreign data can't crash the app.
      var valid = restored.every(function(s){
        var okPt = function(p){ return p && typeof p.lat === 'number' && typeof p.lng === 'number'; };
        return s && Array.isArray(s.points) && s.points.every(okPt)
          && (!s.holes || (Array.isArray(s.holes) && s.holes.every(function(h){ return Array.isArray(h) && h.every(okPt); })));
      });
      return valid ? restored : null;
    } catch(e){
      return null;
    }
  }

