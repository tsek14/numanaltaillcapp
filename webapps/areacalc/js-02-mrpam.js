  // ---- "..." overflow menu (secondary toolbar tools) ----
  var moreBtn = document.getElementById('moreBtn');
  var morePanel = document.getElementById('morePanel');
  function openMorePanel(){ morePanel.classList.add('open'); moreBtn.classList.add('open'); }
  function closeMorePanel(){
    morePanel.classList.remove('open');
    moreBtn.classList.remove('open');
    // Closing the overflow menu should also close any dropdown nested
    // inside it, so re-opening later starts from a clean state.
    closeLayerPanel();
    gratSettingsPanel.classList.remove('open');
  }
  moreBtn.addEventListener('click', function(e){
    e.stopPropagation();
    if(morePanel.classList.contains('open')) closeMorePanel(); else openMorePanel();
  });
  document.addEventListener('click', function(e){
    if(!morePanel.contains(e.target) && e.target !== moreBtn) closeMorePanel();
  });

  (function restoreBasemapAndOverlays(){
    var savedBasemap = getSetting('basemapId', 'google_sat');
    var validIds = BASEMAPS.map(function(b){ return b.id; });
    setBasemap(validIds.indexOf(savedBasemap) !== -1 ? savedBasemap : 'google_sat', true);
    var savedOverlays = getSetting('overlayIds', []);
    if(Array.isArray(savedOverlays)){
      savedOverlays.forEach(function(id){ setOverlay(id, true); });
    }
  })();

  // ---------- CMCS (MRPAM) mining-license overlay (local file) ----------
  // Reads a cmcs_licenses.geojson file the person picks from disk (produced
  // by the cmcs_scraper.py tool). To avoid burdening the app with a
  // country-wide dataset:
  //   1. JSON.parse of the (potentially large) file happens inside a Web
  //      Worker, off the main thread, so the UI never freezes while loading.
  //   2. Each feature's bounding box is precomputed once at load time.
  //   3. On every map move/zoom, only features whose bbox intersects the
  //      current viewport are rendered (a plain min/max scan over a few
  //      thousand bboxes takes low single-digit milliseconds).
  //   4. Below a minimum zoom, or above a render cap, nothing is drawn and
  //      a small hint is shown instead of dumping hundreds of polygons on
  //      the map at once.
  var MRPAM_MIN_ZOOM = 9;
  var MRPAM_MAX_RENDER = 250;

  var mrpamLoaded = false;
  var mrpamVisible = false;
  var mrpamFeatures = null;      // [{bbox:[w,s,e,n], geometry, properties}, ...]
  var mrpamLayerGroup = L.layerGroup();
  var mrpamWorker = null;
  var mrpamTypeColors = {};      // { <type string>: '#hex', ... } — built from the loaded file
  var MRPAM_TYPE_PALETTE = ['#e0526b', '#f5a623', '#5fb3ff', '#7ee787', '#c792ea', '#ffd23f', '#ff7a3d', '#35d9b0', '#ff6b9d', '#94a3b8'];
  var MRPAM_DEFAULT_COLOR = '#e0526b'; // used when a feature has no 'type' property at all

  // ---- Manual style overrides (color per type, line weight, opacities) ----
  // Persisted via saveSetting/getSetting so they survive reloads. Per-type
  // color overrides are keyed by the type string itself, so they carry over
  // to a new file as long as the same type names appear in it.
  var mrpamTypeColorOverrides = getSetting('mrpamTypeColorOverrides', {}) || {};
  // Types the person has switched off in the settings list (show/hide per
  // type, same idea as the Аймаг / Сум / Баг checkboxes on the boundary layer).
  // Keyed by type string like the color overrides, so it also carries over
  // to a new file that uses the same type names.
  var mrpamTypesHidden = getSetting('mrpamTypesHidden', {}) || {};
  function isMrpamTypeHidden(props){
    var t = props && props.type;
    if(t === undefined || t === null || t === '') return false; // untyped licenses have no toggle, so they stay visible
    return !!mrpamTypesHidden[String(t)];
  }
  var mrpamWeight      = getSetting('mrpamWeight', 1.5);
  var mrpamLineOpacity = getSetting('mrpamLineOpacity', 1);   // 0..1
  var mrpamFillOpacity = getSetting('mrpamFillOpacity', 0.12); // 0..1

  // ---- Select-and-export mode ----
  // Lets the user click individual MRPAM licenses on the map to build a
  // subset, then export just that subset instead of everything loaded.
  // Selection is keyed by each feature's index in mrpamFeatures (stable
  // across re-renders since that array itself is never reordered).
  var mrpamSelectMode = false;
  var mrpamSelected = {}; // { <featureIndex>: true, ... }

  function mrpamSelectedCount(){ return Object.keys(mrpamSelected).length; }

  // Scans the loaded features for distinct 'type' values and assigns each
  // one a stable color from the palette, in first-seen order. Re-run every
  // time a file loads (types are specific to that file's contents). A saved
  // manual override for a type (if any) takes priority over the palette.
  function buildMrpamTypeColors(){
    mrpamTypeColors = {};
    var next = 0;
    for(var i=0;i<mrpamFeatures.length;i++){
      var t = mrpamFeatures[i].properties && mrpamFeatures[i].properties.type;
      if(t === undefined || t === null || t === '') continue;
      t = String(t);
      if(!(t in mrpamTypeColors)){
        mrpamTypeColors[t] = mrpamTypeColorOverrides[t] || MRPAM_TYPE_PALETTE[next % MRPAM_TYPE_PALETTE.length];
        next++;
      }
    }
  }

  function mrpamColorForType(props){
    var t = props && props.type;
    if(t === undefined || t === null || t === '') return mrpamTypeColorOverrides['__default__'] || MRPAM_DEFAULT_COLOR;
    return mrpamTypeColors[String(t)] || MRPAM_DEFAULT_COLOR;
  }

  var mrpamBtn = document.getElementById('licenseLayerToggle');
  var mrpamFileInput = document.getElementById('mrpamFileInput');
  var supportsFSAccess = typeof window.showOpenFilePicker === 'function';

  // ---- tiny IndexedDB helper: persists the picked file handle + on/off
  // preference across page reloads, so MRPAM can auto-restore itself next
  // time the app is opened (Chrome/Edge only — the File System Access API
  // isn't available elsewhere, and the app quietly falls back to the normal
  // one-off file picker on browsers that don't support it).
  var MRPAM_DB = 'talbaiHemjigchDB', MRPAM_STORE = 'kv';
  var MRPAM_HANDLE_KEY = 'mrpamGeojsonHandle', MRPAM_ENABLED_KEY = 'mrpamEnabled';

  function idbOpen(){
    return new Promise(function(resolve, reject){
      if(!('indexedDB' in window)){ reject(new Error('no indexedDB')); return; }
      var req = indexedDB.open(MRPAM_DB, 1);
      req.onupgradeneeded = function(){ req.result.createObjectStore(MRPAM_STORE); };
      req.onsuccess = function(){ resolve(req.result); };
      req.onerror = function(){ reject(req.error); };
    });
  }
  function idbSet(key, val){
    return idbOpen().then(function(db){
      return new Promise(function(resolve, reject){
        var tx = db.transaction(MRPAM_STORE, 'readwrite');
        tx.objectStore(MRPAM_STORE).put(val, key);
        tx.oncomplete = function(){ resolve(); };
        tx.onerror = function(){ reject(tx.error); };
      });
    });
  }
  function idbGet(key){
    return idbOpen().then(function(db){
      return new Promise(function(resolve, reject){
        var tx = db.transaction(MRPAM_STORE, 'readonly');
        var req = tx.objectStore(MRPAM_STORE).get(key);
        req.onsuccess = function(){ resolve(req.result); };
        req.onerror = function(){ reject(req.error); };
      });
    });
  }

  function mrpamHint(msg){
    var el = document.getElementById('mrpamHint');
    if(!msg){ el.classList.remove('show'); return; }
    el.textContent = msg;
    el.classList.add('show');
  }

  // Worker source is inlined as a string and loaded via a Blob URL, so the
  // whole app still ships as a single HTML file with no extra script file.
  var MRPAM_WORKER_SRC = [
    'function computeBbox(geometry){',
    '  var minLon=Infinity, minLat=Infinity, maxLon=-Infinity, maxLat=-Infinity;',
    '  var depthByType = {Point:0,MultiPoint:1,LineString:1,MultiLineString:2,Polygon:2,MultiPolygon:3};',
    '  var d = depthByType[geometry.type];',
    '  if(d === undefined) return null;',
    '  (function walk(coords, depth){',
    '    if(depth === 0){',
    '      var lon = coords[0], lat = coords[1];',
    '      if(lon<minLon) minLon=lon; if(lon>maxLon) maxLon=lon;',
    '      if(lat<minLat) minLat=lat; if(lat>maxLat) maxLat=lat;',
    '    } else {',
    '      for(var i=0;i<coords.length;i++) walk(coords[i], depth-1);',
    '    }',
    '  })(geometry.coordinates, d);',
    '  if(!isFinite(minLon)) return null;',
    '  return [minLon, minLat, maxLon, maxLat];',
    '}',
    'self.onmessage = function(e){',
    '  try{',
    '    var fc = JSON.parse(e.data);',
    '    var out = [];',
    '    var feats = fc.features || [];',
    '    for(var i=0;i<feats.length;i++){',
    '      var f = feats[i];',
    '      if(!f.geometry) continue;',
    '      var bbox = computeBbox(f.geometry);',
    '      if(!bbox) continue;',
    '      out.push({ bbox:bbox, geometry:f.geometry, properties:f.properties||{} });',
    '    }',
    '    self.postMessage({ ok:true, features:out });',
    '  } catch(err){',
    '    self.postMessage({ ok:false, error:String(err && err.message || err) });',
    '  }',
    '};'
  ].join('\n');

  function getMrpamWorker(){
    if(mrpamWorker) return mrpamWorker;
    try{
      var blob = new Blob([MRPAM_WORKER_SRC], { type:'application/javascript' });
      mrpamWorker = new Worker(URL.createObjectURL(blob));
      return mrpamWorker;
    } catch(e){
      // Workers created from a Blob URL are blocked entirely when the page
      // itself is opened as a local file:// document (Chrome: "file: URLs
      // are treated as unique security origins") — there is no workaround,
      // so callers must fall back to parsing on the main thread instead.
      return null;
    }
  }

  // Mirrors MRPAM_WORKER_SRC's logic exactly, but runs synchronously on the
  // main thread — used when a Worker can't be created (typically: the app
  // was opened via file:// instead of http(s)://). Slightly blocks the UI
  // during parsing, but the feature still works rather than silently
  // failing.
  function computeMrpamBbox(geometry){
    var minLon=Infinity, minLat=Infinity, maxLon=-Infinity, maxLat=-Infinity;
    var depthByType = {Point:0,MultiPoint:1,LineString:1,MultiLineString:2,Polygon:2,MultiPolygon:3};
    var d = depthByType[geometry.type];
    if(d === undefined) return null;
    (function walk(coords, depth){
      if(depth === 0){
        var lon = coords[0], lat = coords[1];
        if(lon<minLon) minLon=lon; if(lon>maxLon) maxLon=lon;
        if(lat<minLat) minLat=lat; if(lat>maxLat) maxLat=lat;
      } else {
        for(var i=0;i<coords.length;i++) walk(coords[i], depth-1);
      }
    })(geometry.coordinates, d);
    if(!isFinite(minLon)) return null;
    return [minLon, minLat, maxLon, maxLat];
  }

  function parseGeojsonSync(text){
    try{
      var fc = JSON.parse(text);
      var out = [];
      var feats = fc.features || [];
      for(var i=0;i<feats.length;i++){
        var f = feats[i];
        if(!f.geometry) continue;
        var bbox = computeMrpamBbox(f.geometry);
        if(!bbox) continue;
        out.push({ bbox:bbox, geometry:f.geometry, properties:f.properties||{} });
      }
      return { ok:true, features:out };
    } catch(err){
      return { ok:false, error:String(err && err.message || err) };
    }
  }

  function bboxIntersects(a, b){
    return !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3]);
  }

  function debounce(fn, wait){
    var t;
    return function(){
      clearTimeout(t);
      var args = arguments;
      t = setTimeout(function(){ fn.apply(null, args); }, wait);
    };
  }

  // ---------- On-demand script loading with CDN fallback ----------
  // Some libraries (SHP read/write) are only needed occasionally, so they
  // load lazily on first use rather than blocking initial page load. Each
  // entry tries its URLs in order — if the first CDN is unreachable or
  // blocked, the next one is tried automatically before giving up.
  var _scriptLoadCache = {}; // url-list-key -> Promise, so repeated clicks reuse the same in-flight/completed load

  function loadScriptOnce(url, timeoutMs){
    return new Promise(function(resolve, reject){
      var el = document.createElement('script');
      var done = false;
      var timer = setTimeout(function(){
        if(done) return;
        done = true;
        el.remove();
        reject(new Error('timeout loading ' + url));
      }, timeoutMs || 8000);
      el.src = url;
      el.async = true;
      el.onload = function(){
        if(done) return;
        done = true;
        clearTimeout(timer);
        resolve();
      };
      el.onerror = function(){
        if(done) return;
        done = true;
        clearTimeout(timer);
        el.remove();
        reject(new Error('failed to load ' + url));
      };
      document.head.appendChild(el);
    });
  }

  function loadScriptWithFallback(urls, checkLoaded){
    var key = urls.join('|');
    if(_scriptLoadCache[key]) return _scriptLoadCache[key];
    var p = (function tryNext(i){
      if(checkLoaded && checkLoaded()) return Promise.resolve();
      if(i >= urls.length) return Promise.reject(new Error('all CDN sources failed'));
      return loadScriptOnce(urls[i]).catch(function(){ return tryNext(i+1); });
    })(0);
    _scriptLoadCache[key] = p;
    // A failed attempt shouldn't be cached forever — let a later click retry
    // (e.g. the network may have recovered since).
    p.catch(function(){ delete _scriptLoadCache[key]; });
    return p;
  }

  function mrpamPopupHtml(props){
    function row(label, val){
      if(val === undefined || val === null || val === '') return '';
      return '<dt>'+escapeXml(label)+'</dt><dd>'+escapeXml(val)+'</dd>';
    }
    var area = props.area_ha ? (Number(props.area_ha).toFixed(2)+' га') : '';
    return '<dl>'
      + row('Нэр', props.name)
      + row('Код', props.code)
      + row('Төрөл', props.type)
      + row('Статус', props.status)
      + row('Эзэмшигч', props.holder)
      + row('Талбай', area)
      + row('Аймаг / Сум', [props.aimag, props.soum].filter(Boolean).join(' / '))
      + '</dl>';
  }

  function updateMrpamOverlay(){
    mrpamLayerGroup.clearLayers();
    if(!mrpamLoaded || !mrpamVisible){ mrpamHint(''); renderLegend(); return; }

    var zoom = map.getZoom();
    if(zoom < MRPAM_MIN_ZOOM){
      mrpamHint('Лиценз харахын тулд ойртуулна уу (zoom ' + MRPAM_MIN_ZOOM + '+)');
      renderLegend();
      return;
    }

    var b = map.getBounds();
    var view = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
    var visible = [];
    for(var i=0;i<mrpamFeatures.length;i++){
      if(isMrpamTypeHidden(mrpamFeatures[i].properties)) continue;
      if(bboxIntersects(mrpamFeatures[i].bbox, view)) visible.push({ feat:mrpamFeatures[i], idx:i });
    }

    if(visible.length > MRPAM_MAX_RENDER){
      mrpamHint(visible.length + ' лиценз олдлоо — цөөрүүлэхийн тулд ойртуулна уу');
      renderLegend();
      return;
    }

    mrpamHint(mrpamSelectMode ? 'Сонгох горим: лиценз дээр товшиж сонгоно уу (' + mrpamSelectedCount() + ' сонгосон)' : '');
    visible.forEach(function(entry){
      var feat = entry.feat, idx = entry.idx;
      var c = mrpamColorForType(feat.properties);
      var isSel = !!mrpamSelected[idx];
      var layer = L.geoJSON(feat.geometry, {
        style: isSel
          ? { color:'#ffffff', weight:Math.max(mrpamWeight+1.5, 3), opacity:1, dashArray:null, fillColor:c, fillOpacity:Math.max(mrpamFillOpacity, 0.35) }
          : { color:c, weight:mrpamWeight, opacity:mrpamLineOpacity, dashArray:'4,3', fillColor:c, fillOpacity:mrpamFillOpacity },
        pointToLayer: function(g, latlng){
          return isSel
            ? L.circleMarker(latlng, { radius:7, color:'#ffffff', weight:3, opacity:1, fillColor:c, fillOpacity:0.9 })
            : L.circleMarker(latlng, { radius:5, color:c, weight:Math.max(mrpamWeight,1), opacity:mrpamLineOpacity, fillColor:c, fillOpacity:Math.max(mrpamFillOpacity, 0.6) });
        }
      }).addTo(mrpamLayerGroup);

      if(mrpamSelectMode){
        layer.on('click', function(e){
          L.DomEvent.stopPropagation(e);
          if(mrpamSelected[idx]) delete mrpamSelected[idx];
          else mrpamSelected[idx] = true;
          updateMrpamOverlay();
        });
      } else {
        layer.bindPopup(mrpamPopupHtml(feat.properties), { className:'mrpam-popup', maxWidth:260 });
      }
    });
    renderLegend();
    updateMrpamExportButton();
  }

  var debouncedMrpamUpdate = debounce(updateMrpamOverlay, 250);
  map.on('moveend zoomend', debouncedMrpamUpdate);

  // Shared by both the file-picker path (loadMrpamFile) and the bundled
  // auto-load path (loadMrpamText): takes raw GeoJSON text, runs it through
  // the worker (or a main-thread fallback), and applies the result to the
  // map the same way regardless of where the text came from.
  function loadMrpamText(text, silent, sourceLabel){
    mrpamBtn.classList.add('loading');
    if(!silent) toast('Файл уншиж байна…');

    function handleResult(data){
      mrpamBtn.classList.remove('loading');
      if(!data.ok){
        if(silent){ mrpamAutoLoadFailedHint(); }
        else { toast('GeoJSON файл уншихад алдаа гарлаа. cmcs_licenses.geojson файлыг сонгосон эсэхээ шалгана уу.'); }
        return;
      }
      mrpamFeatures = data.features;
      mrpamLoaded = true;
      mrpamVisible = true;
      mrpamSelected = {};
      buildMrpamTypeColors();
      renderMrpamTypeColorList();
      mrpamLayerGroup.addTo(map);
      mrpamBtn.classList.add('active');
      toast(mrpamFeatures.length + ' лиценз ачааллагдлаа' + (sourceLabel ? ' (' + sourceLabel + ')' : ''));
      idbSet(MRPAM_ENABLED_KEY, true).catch(function(){});
      updateMrpamOverlay();
    }

    var worker = getMrpamWorker();
    if(worker){
      worker.onmessage = function(e){ handleResult(e.data); };
      worker.onerror = function(){
        // Worker exists but failed at runtime for some reason — fall back
        // to a synchronous parse rather than leaving the load hanging.
        handleResult(parseGeojsonSync(text));
      };
      worker.postMessage(text);
    } else {
      // No Worker support in this context (typically: opened via
      // file:// instead of http(s)://, where Chrome blocks Blob-URL
      // Workers entirely) — parse on the main thread instead. This
      // briefly blocks the UI during parsing, but the feature keeps
      // working rather than silently failing.
      setTimeout(function(){ handleResult(parseGeojsonSync(text)); }, 0);
    }
  }

  function loadMrpamFile(file, silent){
    file.text().then(function(text){
      loadMrpamText(text, silent, silent ? 'өмнөх файлаас' : null);
    }).catch(function(){
      mrpamBtn.classList.remove('loading');
      if(silent){ mrpamAutoLoadFailedHint(); }
      else { toast('Файл уншихад алдаа гарлаа'); }
    });
  }

  // The GeoJSON file bundled alongside this HTML page (same folder, same
  // origin). Tried first on every load — before the remembered-file-handle
  // and manual-picker paths — so the license layer is available out of the
  // box with zero clicks, on any browser, with no prior file selection.
  var MRPAM_BUNDLED_URL = 'cmcs_licenses.geojson';

  function tryLoadBundledMrpam(){
    return fetch(MRPAM_BUNDLED_URL, { cache:'no-cache' }).then(function(res){
      if(!res.ok) throw new Error('http ' + res.status);
      return res.text();
    }).then(function(text){
      loadMrpamText(text, true, 'дотоод файлаас');
      return true;
    }).catch(function(){
      return false; // not found / blocked by CORS (e.g. opened via file://) — caller falls back
    });
  }



  // Opens a fresh file picker (File System Access API when available, so the
  // resulting handle can be persisted for next time; otherwise the plain
  // <input type="file"> as a universal fallback).
  function pickMrpamFile(){
    if(supportsFSAccess){
      window.showOpenFilePicker({
        types: [{ description:'GeoJSON', accept: { 'application/geo+json':['.geojson'], 'application/json':['.json'] } }],
        excludeAcceptAllOption: false,
        multiple: false
      }).then(function(handles){
        var handle = handles[0];
        idbSet(MRPAM_HANDLE_KEY, handle).catch(function(){});
        return handle.getFile();
      }).then(function(file){
        loadMrpamFile(file, false);
      }).catch(function(err){
        if(err && err.name === 'AbortError') return; // person cancelled the picker
        toast('Файл сонгоход алдаа гарлаа');
      });
    } else {
      mrpamFileInput.value = '';
      mrpamFileInput.click();
    }
  }

  // On startup: first try the GeoJSON file bundled next to this page (no
  // permissions, no prior selection needed — works everywhere the two files
  // are kept together). Only if that's unavailable do we fall back to the
  // previous approach: silently re-reading a remembered file handle, and if
  // that also fails, offering the person a way to pick a file manually.
  function tryAutoLoadMrpam(){
    tryLoadBundledMrpam().then(function(loadedBundled){
      if(loadedBundled) return;
      tryAutoLoadFromRememberedHandle();
    });
  }

  function tryAutoLoadFromRememberedHandle(){
    if(!supportsFSAccess){
      return;
    }
    idbGet(MRPAM_ENABLED_KEY).then(function(wasEnabled){
      if(!wasEnabled) return;
      return idbGet(MRPAM_HANDLE_KEY).then(function(handle){
        if(!handle){
          // Nothing was ever saved — nothing to retry, nothing to report.
          return;
        }
        return handle.queryPermission({ mode:'read' }).then(function(perm){
          if(perm === 'granted') return handle;
          if(perm === 'prompt'){
            return handle.requestPermission({ mode:'read' }).then(function(p2){
              if(p2 === 'granted') return handle;
              throw new Error('permission not granted');
            });
          }
          throw new Error('permission denied');
        }).then(function(h){
          return h.getFile();
        }).then(function(file){
          loadMrpamFile(file, true);
        }).catch(function(){
          // The remembered file could not be re-read (moved, deleted, or
          // permission denied) — offer to pick it again instead of giving
          // up silently.
          mrpamAutoLoadFailedHint();
        });
      });
    }).catch(function(){
      // idbGet itself failed (e.g. IndexedDB unavailable) — nothing saved
      // to retry, so there's nothing meaningful to prompt about.
    });
  }

  // Shown only when a previously-remembered MRPAM file could not be
  // re-opened automatically. Offers a one-tap way to pick it again, rather
  // than leaving the person to notice MRPAM silently didn't turn on.
  function mrpamAutoLoadFailedHint(){
    var el = document.getElementById('mrpamHint');
    el.innerHTML = 'Өмнөх GeoJSON файлыг дахин ачаалж чадсангүй. <a href="#" id="mrpamRetryLink" style="color:var(--teal); text-decoration:underline;">Дахин сонгох</a>';
    el.classList.add('show');
    document.getElementById('mrpamRetryLink').addEventListener('click', function(e){
      e.preventDefault();
      mrpamHint('');
      pickMrpamFile();
    });
  }
  map.whenReady(tryAutoLoadMrpam);

  mrpamBtn.addEventListener('click', function(){
    if(!mrpamLoaded){
      pickMrpamFile();
      return;
    }
    mrpamVisible = !mrpamVisible;
    mrpamBtn.classList.toggle('active', mrpamVisible);
    idbSet(MRPAM_ENABLED_KEY, mrpamVisible).catch(function(){});
    if(mrpamVisible){ mrpamLayerGroup.addTo(map); updateMrpamOverlay(); }
    else {
      map.removeLayer(mrpamLayerGroup);
      mrpamHint('');
      renderLegend();
      if(mrpamSelectMode){
        mrpamSelectMode = false;
        mrpamSelected = {};
        mrpamSelectModeBtn.classList.remove('active');
        mrpamSelectModeBtn.textContent = 'Асаах';
        updateMrpamExportButton();
      }
    }
  });

  mrpamFileInput.addEventListener('change', function(){
    var file = this.files && this.files[0];
    if(file) loadMrpamFile(file, false);
  });

  // ---- MRPAM style settings dropdown (color per type, weight, opacity) ----
  var mrpamSettingsBtn = document.getElementById('mrpamSettingsBtn');
  var mrpamSettingsPanel = document.getElementById('mrpamSettingsPanel');
  mrpamSettingsBtn.addEventListener('click', function(e){
    e.stopPropagation();
    var willOpen = !mrpamSettingsPanel.classList.contains('open');
    mrpamSettingsPanel.classList.toggle('open');
    if(willOpen) renderMrpamTypeColorList();
  });
  document.addEventListener('click', function(e){
    if(!mrpamSettingsPanel.contains(e.target) && e.target !== mrpamSettingsBtn && !mrpamSettingsBtn.contains(e.target)){
      mrpamSettingsPanel.classList.remove('open');
    }
  });

  var msWeight = document.getElementById('msWeight');
  var msWeightVal = document.getElementById('msWeightVal');
  var msLineOpacity = document.getElementById('msLineOpacity');
  var msLineOpacityVal = document.getElementById('msLineOpacityVal');
  var msFillOpacity = document.getElementById('msFillOpacity');
  var msFillOpacityVal = document.getElementById('msFillOpacityVal');
  var msResetColors = document.getElementById('msResetColors');
  var msTypeColorsList = document.getElementById('msTypeColorsList');
  var msTypeColorsEmpty = document.getElementById('msTypeColorsEmpty');

  // ---- MRPAM select-and-export ----
  var mrpamSelectModeBtn = document.getElementById('mrpamSelectModeBtn');
  var mrpamSelectInfoRow = document.getElementById('mrpamSelectInfoRow');
  var mrpamSelectExportRow = document.getElementById('mrpamSelectExportRow');
  var mrpamSelectedCountLbl = document.getElementById('mrpamSelectedCountLbl');
  var mrpamSelectClearBtn = document.getElementById('mrpamSelectClearBtn');

  function updateMrpamExportButton(){
    var n = mrpamSelectedCount();
    mrpamSelectedCountLbl.textContent = n;
    mrpamSelectInfoRow.style.display = mrpamSelectMode ? '' : 'none';
    mrpamSelectExportRow.style.display = (mrpamSelectMode && n > 0) ? 'flex' : 'none';
  }

  mrpamSelectModeBtn.addEventListener('click', function(){
    if(!mrpamLoaded){ toast('Эхлээд MRPAM файл ачаална уу'); return; }
    mrpamSelectMode = !mrpamSelectMode;
    mrpamSelectModeBtn.classList.toggle('active', mrpamSelectMode);
    mrpamSelectModeBtn.textContent = mrpamSelectMode ? 'Унтраах' : 'Асаах';
    if(!mrpamSelectMode){
      // Leaving select mode also clears the selection — a fresh session
      // starts clean next time, and stale highlights never linger.
      mrpamSelected = {};
    }
    updateMrpamOverlay();
  });

  mrpamSelectClearBtn.addEventListener('click', function(){
    mrpamSelected = {};
    updateMrpamOverlay();
  });

  function selectedMrpamFeatures(){
    return Object.keys(mrpamSelected).map(function(k){ return mrpamFeatures[parseInt(k,10)]; }).filter(Boolean);
  }

  function mrpamSelectionToGeoJSON(){
    var features = selectedMrpamFeatures().map(function(f){
      return { type:'Feature', properties: f.properties || {}, geometry: f.geometry };
    });
    return { type:'FeatureCollection', features: features };
  }

  // Converts a raw GeoJSON geometry (as found in MRPAM's own data — Point,
  // LineString, Polygon, or MultiPolygon) into KML geometry markup. This is
  // separate from the app's own toKmlCoords()/generateKML(), which work
  // from the app's internal {lat,lng} point-array shape rather than GeoJSON.
  function geoJSONCoordsToKml(coords){
    return coords.map(function(c){ return c[0].toFixed(7)+','+c[1].toFixed(7)+',0'; }).join(' ');
  }
  function geoJSONPolygonRingsToKml(rings){
    var outer = '<outerBoundaryIs><LinearRing><coordinates>'+geoJSONCoordsToKml(rings[0])+'</coordinates></LinearRing></outerBoundaryIs>';
    var inner = rings.slice(1).map(function(ring){
      return '<innerBoundaryIs><LinearRing><coordinates>'+geoJSONCoordsToKml(ring)+'</coordinates></LinearRing></innerBoundaryIs>';
    }).join('');
    return outer + inner;
  }
  function geoJSONGeometryToKml(geometry){
    if(!geometry) return '';
    if(geometry.type === 'Point'){
      return '<Point><coordinates>'+geometry.coordinates[0].toFixed(7)+','+geometry.coordinates[1].toFixed(7)+',0</coordinates></Point>';
    }
    if(geometry.type === 'LineString'){
      return '<LineString><tessellate>1</tessellate><coordinates>'+geoJSONCoordsToKml(geometry.coordinates)+'</coordinates></LineString>';
    }
    if(geometry.type === 'Polygon'){
      return '<Polygon>'+geoJSONPolygonRingsToKml(geometry.coordinates)+'</Polygon>';
    }
    if(geometry.type === 'MultiPolygon'){
      var polys = geometry.coordinates.map(function(rings){
        return '<Polygon>'+geoJSONPolygonRingsToKml(rings)+'</Polygon>';
      }).join('');
      return '<MultiGeometry>'+polys+'</MultiGeometry>';
    }
    if(geometry.type === 'MultiLineString'){
      var lines = geometry.coordinates.map(function(coords){
        return '<LineString><tessellate>1</tessellate><coordinates>'+geoJSONCoordsToKml(coords)+'</coordinates></LineString>';
      }).join('');
      return '<MultiGeometry>'+lines+'</MultiGeometry>';
    }
    return '';
  }

  document.getElementById('mrpamExportSelGeoJSON').addEventListener('click', function(){
    var fc = mrpamSelectionToGeoJSON();
    if(fc.features.length === 0){ toast('Лиценз сонгоогүй байна'); return; }
    downloadTextFile(JSON.stringify(fc, null, 2), 'mrpam-songosonluud.geojson', 'application/geo+json;charset=utf-8');
    toast('GeoJSON татагдлаа (' + fc.features.length + ' лиценз)');
  });

  document.getElementById('mrpamExportSelKML').addEventListener('click', function(){
    var feats = selectedMrpamFeatures();
    if(feats.length === 0){ toast('Лиценз сонгоогүй байна'); return; }
    var placemarks = feats.map(function(f){
      var props = f.properties || {};
      var name = props.name || props.code || 'MRPAM';
      var color = mrpamColorForType(props);
      var bgr = colorToKmlBgr(color);
      var descRows = ['name','code','type','status','holder','aimag','soum'].map(function(k){
        return props[k] ? ('<b>'+escapeXml(k)+':</b> '+escapeXml(props[k])+'<br/>') : '';
      }).join('');
      var geomXml = geoJSONGeometryToKml(f.geometry);
      return '<Placemark><name>'+escapeXml(name)+'</name>'
        + (descRows ? ('<description><![CDATA['+descRows+']]></description>') : '')
        + '<Style><LineStyle><color>ff'+bgr+'</color><width>2</width></LineStyle>'
        + '<PolyStyle><color>4d'+bgr+'</color></PolyStyle></Style>'
        + geomXml + '</Placemark>';
    }).join('');
    var kml = '<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>MRPAM сонгосон лицензүүд</name>'
      + placemarks + '</Document></kml>';
    downloadTextFile(kml, 'mrpam-songosonluud.kml', 'application/vnd.google-earth.kml+xml;charset=utf-8');
    toast('KML татагдлаа (' + feats.length + ' лиценз)');
  });

  msWeight.value = mrpamWeight;
  msWeightVal.textContent = mrpamWeight + 'px';
  msLineOpacity.value = Math.round(mrpamLineOpacity*100);
  msLineOpacityVal.textContent = Math.round(mrpamLineOpacity*100) + '%';
  msFillOpacity.value = Math.round(mrpamFillOpacity*100);
  msFillOpacityVal.textContent = Math.round(mrpamFillOpacity*100) + '%';

  msWeight.addEventListener('input', function(){
    mrpamWeight = parseFloat(msWeight.value);
    msWeightVal.textContent = mrpamWeight + 'px';
    saveSetting('mrpamWeight', mrpamWeight);
    updateMrpamOverlay();
  });
  msLineOpacity.addEventListener('input', function(){
    mrpamLineOpacity = parseInt(msLineOpacity.value,10)/100;
    msLineOpacityVal.textContent = Math.round(mrpamLineOpacity*100) + '%';
    saveSetting('mrpamLineOpacity', mrpamLineOpacity);
    updateMrpamOverlay();
  });
  msFillOpacity.addEventListener('input', function(){
    mrpamFillOpacity = parseInt(msFillOpacity.value,10)/100;
    msFillOpacityVal.textContent = Math.round(mrpamFillOpacity*100) + '%';
    saveSetting('mrpamFillOpacity', mrpamFillOpacity);
    updateMrpamOverlay();
  });

  // Renders one color-picker row per currently-known MRPAM type, so users
  // can override the auto-assigned palette color individually. Called after
  // a file loads and whenever the settings panel is opened, since the type
  // list is only known once features are read.
  function renderMrpamTypeColorList(){
    var types = Object.keys(mrpamTypeColors);
    if(types.length === 0){
      msTypeColorsList.innerHTML = '';
      msTypeColorsEmpty.style.display = '';
      return;
    }
    msTypeColorsEmpty.style.display = 'none';
    // One row per type: name, color picker, and a show/hide checkbox — the
    // shared helper below builds it identically for MRPAM and the cadastre.
    renderTypeFilterRows(msTypeColorsList, types, {
      colorOf: function(t){ return mrpamTypeColors[t]; },
      isHidden: function(t){ return !!mrpamTypesHidden[t]; },
      onColor: function(t, value){
        mrpamTypeColors[t] = value;
        mrpamTypeColorOverrides[t] = value;
        saveSetting('mrpamTypeColorOverrides', mrpamTypeColorOverrides);
        updateMrpamOverlay();
      },
      onToggle: function(t, shown){
        if(shown) delete mrpamTypesHidden[t]; else mrpamTypesHidden[t] = true;
        saveSetting('mrpamTypesHidden', mrpamTypesHidden);
        updateMrpamOverlay();
      }
    });
  }

  msResetColors.addEventListener('click', function(){
    mrpamTypeColorOverrides = {};
    saveSetting('mrpamTypeColorOverrides', mrpamTypeColorOverrides);
    if(mrpamLoaded){
      buildMrpamTypeColors();
      renderMrpamTypeColorList();
      updateMrpamOverlay();
    }
  });

  renderMrpamTypeColorList(); // initial state (empty-state message until a file loads)


  // ---------- Shared helpers (MRPAM, Administrative boundaries, Cadastre) ----------

  // One settings row per type/category: name, color picker and a show/hide
  // checkbox. Used by MRPAM (license types) and the cadastre (parcel types) so
  // both lists look and behave exactly like the Аймаг / Сум / Баг checkboxes
  // on the boundary layer's settings panel.
  //   cfg.colorOf(type) -> '#rrggbb'      cfg.isHidden(type) -> bool
  //   cfg.onColor(type, '#rrggbb')        cfg.onToggle(type, shownBool)
  function renderTypeFilterRows(container, types, cfg){
    var html = '';
    types.forEach(function(t){
      var esc = escapeXml(t);
      html += '<div class="gs-type-row">';
      html += '  <span class="gs-type-name" title="'+esc+'">'+esc+'</span>';
      html += '  <input type="color" data-type="'+esc+'" value="'+cfg.colorOf(t)+'">';
      html += '  <input type="checkbox" class="gs-type-show" data-type="'+esc+'" title="Харуулах / нуух"'+(cfg.isHidden(t) ? '' : ' checked')+'>';
      html += '</div>';
    });
    container.innerHTML = html;
    Array.prototype.forEach.call(container.querySelectorAll('input[type=color]'), function(inp){
      inp.addEventListener('input', function(){ cfg.onColor(inp.getAttribute('data-type'), inp.value); });
    });
    Array.prototype.forEach.call(container.querySelectorAll('input.gs-type-show'), function(cb){
      cb.addEventListener('change', function(){ cfg.onToggle(cb.getAttribute('data-type'), cb.checked); });
    });
  }

  // The "Сонгож экспортлох" behaviour MRPAM has (turn select mode on, tap
  // features to build a subset, export just that subset as KML / GeoJSON),
  // packaged so the boundary and cadastre layers can offer exactly the same
  // thing. It renders its own three settings rows into the element `slotId`,
  // so every layer gets identical markup and wording. Selection is keyed by
  // each feature's index in the layer's feature array (stable for as long as
  // that array isn't replaced — layers call reset() when a new file loads).
  //
  //   opts.slotId, opts.modeTitle, opts.notLoadedMsg, opts.unit ('хил', …)
  //   opts.isLoaded(), opts.getFeatures(), opts.onChange()  (re-render layer)
  //   opts.nameOf(props, idx), opts.colorOf(props), opts.descOf(props) -> [[k,v],…]
  //   opts.fileBase ('administration-songoson'), opts.docName (KML <Document> name)
  function createSelectExport(opts){
    var selected = {};
    var mode = false;
    var slot = document.getElementById(opts.slotId);
    slot.innerHTML =
        '<div class="gs-row">'
      +   '<label>Сонгож экспортлох</label>'
      +   '<button type="button" class="gs-mini-btn" data-role="mode" title="'+opts.modeTitle+'">Асаах</button>'
      + '</div>'
      + '<div class="gs-row" data-role="info" style="display:none">'
      +   '<label style="flex:1;">Сонгосон: <span data-role="count">0</span></label>'
      +   '<button type="button" class="gs-mini-btn" data-role="clear" title="Сонголтыг цэвэрлэх">Цэвэрлэх</button>'
      + '</div>'
      + '<div class="gs-row" data-role="exportRow" style="display:none; gap:6px;">'
      +   '<button type="button" class="export-btn" data-role="kml" style="flex:1;">KML</button>'
      +   '<button type="button" class="export-btn" data-role="geojson" style="flex:1;">GeoJSON</button>'
      + '</div>';
    function q(role){ return slot.querySelector('[data-role="'+role+'"]'); }
    var modeBtn = q('mode'), infoRow = q('info'), countLbl = q('count'), exportRow = q('exportRow');

    function count(){ return Object.keys(selected).length; }
    function refreshUi(){
      var n = count();
      countLbl.textContent = n;
      infoRow.style.display = mode ? '' : 'none';
      exportRow.style.display = (mode && n > 0) ? 'flex' : 'none';
      modeBtn.classList.toggle('active', mode);
      modeBtn.textContent = mode ? 'Унтраах' : 'Асаах';
    }

    modeBtn.addEventListener('click', function(){
      if(!opts.isLoaded()){ toast(opts.notLoadedMsg); return; }
      mode = !mode;
      // Leaving select mode also clears the selection, so a fresh session
      // starts clean and stale highlights never linger.
      if(!mode) selected = {};
      refreshUi();
      opts.onChange();
    });
    q('clear').addEventListener('click', function(){
      selected = {};
      refreshUi();
      opts.onChange();
    });

    function selectedEntries(){
      var all = opts.getFeatures() || [];
      return Object.keys(selected).map(function(k){
        var idx = parseInt(k, 10);
        return { idx: idx, feat: all[idx] };
      }).filter(function(e){ return !!e.feat; });
    }

    q('geojson').addEventListener('click', function(){
      var entries = selectedEntries();
      if(entries.length === 0){ toast('Юу ч сонгоогүй байна'); return; }
      var fc = { type:'FeatureCollection', features: entries.map(function(e){
        return { type:'Feature', properties: e.feat.properties || {}, geometry: e.feat.geometry };
      }) };
      downloadTextFile(JSON.stringify(fc, null, 2), opts.fileBase + '.geojson', 'application/geo+json;charset=utf-8');
      toast('GeoJSON татагдлаа (' + entries.length + ' ' + opts.unit + ')');
    });

    q('kml').addEventListener('click', function(){
      var entries = selectedEntries();
      if(entries.length === 0){ toast('Юу ч сонгоогүй байна'); return; }
      var placemarks = entries.map(function(e){
        var props = e.feat.properties || {};
        var bgr = colorToKmlBgr(opts.colorOf(props));
        var descRows = (opts.descOf(props) || []).map(function(kv){
          return '<b>'+escapeXml(kv[0])+':</b> '+escapeXml(kv[1])+'<br/>';
        }).join('');
        return '<Placemark><name>'+escapeXml(opts.nameOf(props, e.idx))+'</name>'
          + (descRows ? ('<description><![CDATA['+descRows+']]></description>') : '')
          + '<Style><LineStyle><color>ff'+bgr+'</color><width>2</width></LineStyle>'
          + '<PolyStyle><color>4d'+bgr+'</color></PolyStyle></Style>'
          + geoJSONGeometryToKml(e.feat.geometry) + '</Placemark>';
      }).join('');
      var kml = '<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>'
        + escapeXml(opts.docName) + '</name>' + placemarks + '</Document></kml>';
      downloadTextFile(kml, opts.fileBase + '.kml', 'application/vnd.google-earth.kml+xml;charset=utf-8');
      toast('KML татагдлаа (' + entries.length + ' ' + opts.unit + ')');
    });

    return {
      isOn: function(){ return mode; },
      isSelected: function(idx){ return !!selected[idx]; },
      toggle: function(idx){ if(selected[idx]) delete selected[idx]; else selected[idx] = true; refreshUi(); },
      count: count,
      // Leave select mode and drop the selection (used when the layer is
      // switched off or a different file is loaded).
      reset: function(){ mode = false; selected = {}; refreshUi(); },
      refreshUi: refreshUi
    };
  }
