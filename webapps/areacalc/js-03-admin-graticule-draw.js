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
      if(wr.height > 0 && wr.bottom > mr.top) R.y0 = Math.min(Math.max(R.y0, wr.bottom - mr.top + 4), R.y1);
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

    // 2) Place them. When several units share the same middle (e.g. a bag, its
    //    soum and its aimag all fill the screen) the labels stack vertically
    //    instead of hiding one another; a shifted label must stay inside its own
    //    unit's on-screen extent, and a label that still collides is dropped.
    var placed = [], slots = [0, -1, 1, -2, 2];
    cands.forEach(function(c){
      var p = adminLabelAnchor(c, R);
      if(!p) return;
      for(var s=0; s<slots.length; s++){
        var cx = p.x, cy = p.y + slots[s]*(c.h + 1);
        var rc = { x0:cx - c.w/2, x1:cx + c.w/2, y0:cy - c.h/2, y1:cy + c.h/2 };
        if(rc.x0 < R.x0 || rc.x1 > R.x1 || rc.y0 < R.y0 || rc.y1 > R.y1) continue;
        if(slots[s] !== 0 && (rc.x0 < c.ext.x0 || rc.x1 > c.ext.x1 || rc.y0 < c.ext.y0 || rc.y1 > c.ext.y1)) continue;
        var clash = placed.some(function(q){ return rc.x0 < q.x1 + 2 && rc.x1 > q.x0 - 2 && rc.y0 < q.y1 + 2 && rc.y1 > q.y0 - 2; });
        if(clash) continue;
        placed.push(rc);
        var f = ADMIN_LABEL_FONT[c.lvl], col = ADMIN_LEVEL_COLOR[c.lvl] || '#ffffff';
        L.marker(map.containerPointToLatLng([cx, cy]), {
          icon: L.divIcon({
            className: 'admin-label', iconSize: [0, 0],
            html: '<span class="admin-label-txt" style="font-size:'+f.px+'px;font-weight:'+f.weight+';color:'+col+'">'+escapeXml(c.name)+'</span>'
          }),
          interactive: false, keyboard: false, zIndexOffset: -1000
        }).addTo(adminLayerGroup);
        break;
      }
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
      toast(adminFeatures.length + ' захиргааны хил ачааллагдлаа' + (sourceLabel ? ' (' + sourceLabel + ')' : ''));
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
  var shapes = restorePersistedShapes() || [ { points: [] } ];
  var mode = 'tap'; // 'tap' | 'text'
  var tapDrawActive = false;
  var tapShapeIndex = 0; // which shapes[] entry tap-draw currently edits
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
  function pushUndo(){
    undoStack.push(snapshotState());
    if(undoStack.length > UNDO_MAX) undoStack.shift();
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
      return 'Байршил ажиллахгүй байна: энэ файлыг шууд (file://) нээсэн байна. Байршлын үйлчилгээ зөвхөн https:// эсвэл localhost хаягаар нээсэн үед л ажилладаг тул файлыг вэб сервэрт байршуулж нээнэ үү.';
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

  function areaSqMeters(pts){
    var coords = pts.map(function(p){return [p.lng,p.lat];});
    coords.push(coords[0]);
    var poly = turf.polygon([coords]);
    return turf.area(poly);
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
  var SHAPES_KEY = 'talbaiHemjigchShapes_v1';
  var persistShapesDebounced = debounce(function(){
    try{
      // Skip persisting an all-empty single default shape — no point
      // writing/restoring "nothing was ever drawn".
      var hasContent = shapes.some(function(s){ return s.points.length > 0; });
      if(hasContent){
        localStorage.setItem(SHAPES_KEY, JSON.stringify(shapes));
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
      // Basic shape validation so corrupted/foreign data can't crash the app.
      var valid = restored.every(function(s){
        return s && Array.isArray(s.points) && s.points.every(function(p){
          return typeof p.lat === 'number' && typeof p.lng === 'number';
        });
      });
      return valid ? restored : null;
    } catch(e){
      return null;
    }
  }

