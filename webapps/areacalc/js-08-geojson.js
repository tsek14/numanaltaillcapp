  // ---------- Any GeoJSON file as a view-only overlay ----------
  // Works like the MRPAM / administrative-boundary / cadastre layers: the
  // file is parsed off the main thread (Blob-URL Worker, main-thread fallback
  // under file://), every feature gets a precomputed bbox and vertex count,
  // and only what is inside the current view is drawn, with a render cap.
  // Differences, because the file can be anything:
  //   • no fixed zoom floor — a small file is drawn whole once and is not
  //     redrawn on every pan; a big one switches to viewport-only drawing and
  //     asks to zoom in when the view holds more than the budget;
  //   • drawn on a canvas in its own pane (below the drawn shapes), which
  //     stays light even for thousands of vertices;
  //   • UTM (EPSG:326xx/327xx) and Web Mercator (EPSG:3857) files that
  //     declare their "crs" are converted to degrees while parsing.
  // Unlike «Импорт» (js-05), nothing is copied into the editable shapes —
  // the file is only shown, so it stays fast however big it is.
  var USERGJ_MAX_RENDER = 1000;    // features drawn at once
  var USERGJ_MAX_VERTS = 120000;   // vertices drawn at once
  var USERGJ_DEFAULT_COLOR = '#4fc3f7';

  var userGjLoaded = false;
  var userGjVisible = false;
  var userGjFeatures = null;  // [{bbox, geometry, properties, n}, ...]
  var userGjFileName = null;
  var userGjExtent = null;    // [w,s,e,n] of the whole file
  var userGjTotalVerts = 0;
  var userGjWholeDrawn = false; // small-file mode: already drawn, skip redraw on pan
  var userGjWorker = null;

  map.createPane('userGjPane');
  map.getPane('userGjPane').style.zIndex = 390; // just under overlayPane (400), so drawn shapes stay on top
  var userGjRenderer = L.canvas({ pane:'userGjPane', padding:0.3 });
  var userGjLayerGroup = L.layerGroup();

  var userGjColor = getSetting('userGjColor', USERGJ_DEFAULT_COLOR);
  var userGjWeight = getSetting('userGjWeight', 2);
  var userGjFillOpacity = getSetting('userGjFillOpacity', 0.15);

  var userGjBtn = document.getElementById('userGjLayerToggle');
  var userGjFileInput = document.getElementById('userGjFileInput');
  var USERGJ_HANDLE_KEY = 'userGeojsonHandle', USERGJ_ENABLED_KEY = 'userGeojsonEnabled';

  function userGjHint(msg){
    var el = document.getElementById('userGjHint');
    if(!msg){ el.classList.remove('show'); return; }
    el.textContent = msg;
    el.classList.add('show');
  }

  // ---- Parsing (same function runs inside the Worker and as the fallback) ----
  // Self-contained on purpose: it is turned into the Worker's source with
  // toString(), so it must not touch anything outside itself.
  function userGjProcess(text){
    try{
      var data = typeof text === 'string' ? JSON.parse(text) : text;
      var feats;
      if(Array.isArray(data)) feats = data;
      else if(data && data.type === 'FeatureCollection') feats = data.features || [];
      else if(data && data.type === 'Feature') feats = [data];
      else if(data && (data.coordinates || data.type === 'GeometryCollection')) feats = [{ type:'Feature', properties:{}, geometry:data }];
      else return { ok:false, error:'notgeojson' };

      // Declared CRS → converter to [lon, lat] degrees (null = already degrees).
      var crsName = (data && data.crs && data.crs.properties && data.crs.properties.name) || '';
      var em = /(\d{4,6})\s*$/.exec(crsName);
      var epsg = /CRS84/i.test(crsName) ? 4326 : (em ? +em[1] : null);
      var conv = null, projLabel = null;
      if(epsg && ((epsg >= 32601 && epsg <= 32660) || (epsg >= 32701 && epsg <= 32760))){
        var zone = epsg % 100, south = epsg > 32700;
        projLabel = 'UTM ' + zone + (south ? 'S' : 'N');
        var a = 6378137, f = 1/298.257223563, k0 = 0.9996, e2 = f*(2-f), ep2 = e2/(1-e2);
        var e1 = (1-Math.sqrt(1-e2))/(1+Math.sqrt(1-e2));
        var lon0 = ((zone-1)*6 - 180 + 3) * Math.PI/180;
        conv = function(c){
          var x = c[0] - 500000, y = south ? c[1] - 10000000 : c[1];
          var mu = (y/k0) / (a*(1 - e2/4 - 3*e2*e2/64 - 5*e2*e2*e2/256));
          var p1 = mu + (3*e1/2 - 27*e1*e1*e1/32)*Math.sin(2*mu) + (21*e1*e1/16 - 55*Math.pow(e1,4)/32)*Math.sin(4*mu)
                 + (151*Math.pow(e1,3)/96)*Math.sin(6*mu) + (1097*Math.pow(e1,4)/512)*Math.sin(8*mu);
          var s = Math.sin(p1), co = Math.cos(p1), t = Math.tan(p1);
          var N1 = a/Math.sqrt(1 - e2*s*s), T1 = t*t, C1 = ep2*co*co;
          var R1 = a*(1-e2)/Math.pow(1 - e2*s*s, 1.5), D = x/(N1*k0);
          var lat = p1 - (N1*t/R1)*(D*D/2 - (5 + 3*T1 + 10*C1 - 4*C1*C1 - 9*ep2)*Math.pow(D,4)/24
                  + (61 + 90*T1 + 298*C1 + 45*T1*T1 - 252*ep2 - 3*C1*C1)*Math.pow(D,6)/720);
          var lon = lon0 + (D - (1 + 2*T1 + C1)*Math.pow(D,3)/6 + (5 - 2*C1 + 28*T1 - 3*C1*C1 + 8*ep2 + 24*T1*T1)*Math.pow(D,5)/120)/co;
          return [lon*180/Math.PI, lat*180/Math.PI];
        };
      } else if(epsg === 3857 || epsg === 900913 || epsg === 102100 || epsg === 102113){
        projLabel = 'Web Mercator';
        conv = function(c){
          return [c[0]/6378137*180/Math.PI, (2*Math.atan(Math.exp(c[1]/6378137)) - Math.PI/2)*180/Math.PI];
        };
      }

      var DEPTH = { Point:0, MultiPoint:1, LineString:1, MultiLineString:2, Polygon:2, MultiPolygon:3 };
      var bb, n;
      function pos(c){
        if(conv) c = conv(c);
        var x = c[0], y = c[1];
        if(x < bb[0]) bb[0] = x; if(y < bb[1]) bb[1] = y;
        if(x > bb[2]) bb[2] = x; if(y > bb[3]) bb[3] = y;
        n++;
        return c;
      }
      function walk(c, d){
        if(d === 0) return pos(c);
        for(var i=0;i<c.length;i++) c[i] = walk(c[i], d-1);
        return c;
      }
      function geom(g){
        if(!g) return false;
        if(g.type === 'GeometryCollection'){
          var any = false;
          (g.geometries || []).forEach(function(x){ if(geom(x)) any = true; });
          return any;
        }
        var d = DEPTH[g.type];
        if(d === undefined || !g.coordinates) return false;
        g.coordinates = walk(g.coordinates, d);
        return true;
      }

      var out = [], ext = [Infinity, Infinity, -Infinity, -Infinity], verts = 0;
      for(var i=0;i<feats.length;i++){
        var ft = feats[i];
        if(!ft) continue;
        var g = ft.type === 'Feature' ? ft.geometry : (ft.coordinates || ft.type === 'GeometryCollection' ? ft : null);
        bb = [Infinity, Infinity, -Infinity, -Infinity]; n = 0;
        if(!geom(g) || !isFinite(bb[0])) continue;
        out.push({ bbox:bb, geometry:g, properties:(ft.type === 'Feature' && ft.properties) || {}, n:n });
        verts += n;
        if(bb[0] < ext[0]) ext[0] = bb[0]; if(bb[1] < ext[1]) ext[1] = bb[1];
        if(bb[2] > ext[2]) ext[2] = bb[2]; if(bb[3] > ext[3]) ext[3] = bb[3];
      }
      return { ok:true, features:out, extent: out.length ? ext : null, verts:verts, proj:projLabel };
    } catch(err){
      return { ok:false, error:String(err && err.message || err) };
    }
  }

  function getUserGjWorker(){
    if(userGjWorker) return userGjWorker;
    try{
      var src = userGjProcess.toString() + '\nself.onmessage = function(e){ self.postMessage(userGjProcess(e.data)); };';
      userGjWorker = new Worker(URL.createObjectURL(new Blob([src], { type:'application/javascript' })));
      return userGjWorker;
    } catch(e){
      return null; // file:// origin — fall back to parsing on the main thread
    }
  }

  // ---- Coloring / filtering by a property (same idea as the cadastre layer) ----
  var USERGJ_MAX_TYPES = 40;
  var USERGJ_NO_TYPE = 'Тодорхойгүй';
  var USERGJ_TYPE_KEY_HINT = /type|төрөл|turul|class|ангилал|categor|kind|зориулалт|zoriul|purpose|landuse|land.?use|status|төлөв/i;

  var userGjTypeKeyPref = getSetting('userGjTypeKey', null);  // null = auto, '' = one color, else property name
  var userGjColorOverrides = getSetting('userGjTypeColorOverrides', {}) || {};
  var userGjTypesHidden = getSetting('userGjTypesHidden', {}) || {};
  var userGjTypeCandidates = [];
  var userGjTypeKey = '';
  var userGjTypeOrder = [];
  var userGjTypeColors = {};

  function analyzeUserGjProps(){
    var stats = Object.create(null), keyOrder = [];
    for(var i=0;i<userGjFeatures.length;i++){
      var props = userGjFeatures[i].properties;
      for(var k in props){
        if(!Object.prototype.hasOwnProperty.call(props, k)) continue;
        var v = props[k];
        if(v === null || v === undefined || typeof v === 'object') continue;
        var sv = String(v).trim();
        if(sv === '') continue;
        var st = stats[k];
        if(!st){ st = stats[k] = { freq:Object.create(null), distinct:0, bad:false }; keyOrder.push(k); }
        if(st.bad) continue;
        if(sv.length > 80){ st.bad = true; st.freq = null; continue; }
        if(st.freq[sv] === undefined){
          if(st.distinct >= USERGJ_MAX_TYPES){ st.bad = true; st.freq = null; continue; }
          st.distinct++; st.freq[sv] = 0;
        }
        st.freq[sv]++;
      }
    }
    userGjTypeCandidates = keyOrder.filter(function(k){ return !stats[k].bad && stats[k].distinct >= 2; })
      .map(function(k){ return { key:k, distinct:stats[k].distinct }; });
  }

  function userGjTypeOf(props){
    if(!userGjTypeKey) return null;
    var v = props ? props[userGjTypeKey] : null;
    if(v === null || v === undefined || typeof v === 'object') return USERGJ_NO_TYPE;
    v = String(v).trim();
    return v || USERGJ_NO_TYPE;
  }

  function buildUserGjTypes(){
    var keys = userGjTypeCandidates.map(function(c){ return c.key; });
    if(userGjTypeKeyPref === '') userGjTypeKey = '';
    else if(userGjTypeKeyPref && keys.indexOf(userGjTypeKeyPref) !== -1) userGjTypeKey = userGjTypeKeyPref;
    else {
      // Auto: only a property whose name says it's a type/category — an
      // unknown file is otherwise shown in one color (or its own colors).
      userGjTypeKey = '';
      for(var i=0;i<userGjTypeCandidates.length;i++){
        if(USERGJ_TYPE_KEY_HINT.test(userGjTypeCandidates[i].key)){ userGjTypeKey = userGjTypeCandidates[i].key; break; }
      }
    }
    var counts = Object.create(null);
    if(userGjTypeKey){
      for(var j=0;j<userGjFeatures.length;j++){
        var t = userGjTypeOf(userGjFeatures[j].properties);
        counts[t] = (counts[t] || 0) + 1;
      }
    }
    userGjTypeOrder = Object.keys(counts).sort(function(a, b){ return counts[b] - counts[a] || (a < b ? -1 : a > b ? 1 : 0); });
    var overrides = userGjColorOverrides[userGjTypeKey] || {};
    userGjTypeColors = {};
    userGjTypeOrder.forEach(function(t, i){ userGjTypeColors[t] = overrides[t] || cadastreTypeColorAt(i); });
  }

  function isUserGjTypeHidden(t){
    if(!userGjTypeKey) return false;
    var h = userGjTypesHidden[userGjTypeKey];
    return !!(h && h[t]);
  }
  // In one-color mode a feature's own simplestyle color (stroke / fill /
  // marker-color, as written by geojson.io, QGIS, etc.) is respected.
  function userGjColorOfProps(props){
    var t = userGjTypeOf(props);
    if(t !== null) return userGjTypeColors[t] || userGjColor;
    props = props || {};
    return normalizeHexColor(props.stroke || props.fill || props['marker-color'] || props.color) || userGjColor;
  }

  function userGjLegendEntries(){
    if(!userGjTypeKey) return null;
    return userGjTypeOrder.filter(function(t){ return !isUserGjTypeHidden(t); })
      .map(function(t){ return { label:t, color:userGjTypeColors[t] }; });
  }

  // ---- Popup / naming ----
  var USERGJ_NAME_KEYS = ['name','нэр','title','label','name_mn','name_en','ner','code','код','id','дугаар'];
  function userGjNameOf(props, idx){
    var lower = {};
    Object.keys(props || {}).forEach(function(k){ lower[k.toLowerCase()] = props[k]; });
    for(var i=0;i<USERGJ_NAME_KEYS.length;i++){
      var v = lower[USERGJ_NAME_KEYS[i]];
      if(v !== undefined && v !== null && typeof v !== 'object' && String(v).trim() !== '') return String(v).trim();
    }
    return 'Дүрс ' + (idx + 1);
  }
  function userGjPopupHtml(props){
    props = props || {};
    var keys = Object.keys(props).filter(function(k){
      var v = props[k];
      return v !== undefined && v !== null && String(v).trim() !== '';
    });
    if(keys.length === 0) return '<dl><dt>Мэдээлэл</dt><dd>Энэ дүрсэд мэдээлэл байхгүй</dd></dl>';
    return '<dl>' + keys.map(function(k){
      var v = props[k];
      if(typeof v === 'object') v = JSON.stringify(v);
      return '<dt>'+escapeXml(prettifyKey(k))+'</dt><dd>'+escapeXml(v)+'</dd>';
    }).join('') + '</dl>';
  }

  var userGjSel = createSelectExport({
    slotId: 'userGjSelectSlot',
    modeTitle: 'Газрын зураг дээр дүрс дээр товшиж сонгоно',
    notLoadedMsg: 'Эхлээд GeoJSON файл ачаална уу',
    unit: 'дүрс',
    fileBase: 'geojson-songoson',
    docName: 'GeoJSON — сонгосон дүрсүүд',
    isLoaded: function(){ return userGjLoaded; },
    getFeatures: function(){ return userGjFeatures; },
    onChange: function(){ updateUserGjOverlay(true); },
    nameOf: userGjNameOf,
    colorOf: userGjColorOfProps,
    descOf: function(props){
      return Object.keys(props || {}).filter(function(k){
        var v = props[k];
        return v !== undefined && v !== null && typeof v !== 'object' && String(v).trim() !== '';
      }).slice(0, 60).map(function(k){ return [prettifyKey(k), props[k]]; });
    }
  });

  // ---- Drawing ----
  function userGjFitsWhole(){
    return userGjFeatures.length <= USERGJ_MAX_RENDER && userGjTotalVerts <= USERGJ_MAX_VERTS;
  }

  function userGjFeatureClick(ev){
    var idx = ev.layer && ev.layer.feature ? ev.layer.feature._i : -1;
    if(idx < 0) return;
    if(userGjSel.isOn()){
      L.DomEvent.stopPropagation(ev);
      userGjSel.toggle(idx);
      updateUserGjOverlay(true);
      return;
    }
    // While drawing / measuring, a tap belongs to that tool, not to a popup.
    if((typeof tapDrawActive !== 'undefined' && tapDrawActive) || (typeof measureActive !== 'undefined' && measureActive)) return;
    var f = userGjFeatures[idx];
    L.popup({ className:'mrpam-popup', maxWidth:260 })
      .setLatLng(ev.latlng)
      .setContent('<b style="display:block; margin-bottom:4px;">'+escapeXml(userGjNameOf(f.properties, idx))+'</b>' + userGjPopupHtml(f.properties))
      .openOn(map);
  }

  // force: redraw even in small-file mode (style/selection/filter changed).
  function updateUserGjOverlay(force){
    if(!userGjLoaded || !userGjVisible){
      userGjLayerGroup.clearLayers(); userGjWholeDrawn = false;
      userGjHint(''); renderLegend(); return;
    }
    var whole = userGjFitsWhole();
    if(whole && userGjWholeDrawn && force !== true) return; // nothing changes on pan/zoom

    var view = null;
    if(!whole){
      var b = map.getBounds();
      view = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
    }
    var picked = [], verts = 0;
    for(var i=0;i<userGjFeatures.length;i++){
      var f = userGjFeatures[i];
      if(view && !bboxIntersects(f.bbox, view)) continue;
      var t = userGjTypeOf(f.properties);
      if(t !== null && isUserGjTypeHidden(t)) continue;
      picked.push(i);
      verts += f.n;
    }

    userGjLayerGroup.clearLayers();
    userGjWholeDrawn = false;
    if(picked.length > USERGJ_MAX_RENDER || verts > USERGJ_MAX_VERTS){
      userGjHint(picked.length + ' дүрс харагдах хэсэгт байна — ойртуулна уу эсвэл зарим төрлийг унтраана уу');
      renderLegend();
      return;
    }
    userGjHint(userGjSel.isOn() ? 'Сонгох горим: дүрс дээр товшиж сонгоно уу (' + userGjSel.count() + ' сонгосон)' : '');

    var fc = { type:'FeatureCollection', features: picked.map(function(i){
      var f = userGjFeatures[i];
      return { type:'Feature', geometry:f.geometry, properties:f.properties, _i:i };
    }) };
    var layer = L.geoJSON(fc, {
      renderer: userGjRenderer,
      style: function(feat){
        var c = userGjColorOfProps(feat.properties);
        return userGjSel.isSelected(feat._i)
          ? { color:'#ffffff', weight:Math.max(userGjWeight+1.5, 3), opacity:1, fillColor:c, fillOpacity:Math.max(userGjFillOpacity, 0.35) }
          : { color:c, weight:userGjWeight, opacity:0.9, fillColor:c, fillOpacity:userGjFillOpacity };
      },
      pointToLayer: function(feat, latlng){
        var c = userGjColorOfProps(feat.properties), sel = userGjSel.isSelected(feat._i);
        return L.circleMarker(latlng, { renderer:userGjRenderer, radius:5, color: sel ? '#ffffff' : c, weight:Math.max(userGjWeight, 1),
          opacity:0.9, fillColor:c, fillOpacity:Math.max(userGjFillOpacity, 0.6) });
      }
    });
    layer.on('click', userGjFeatureClick);
    layer.addTo(userGjLayerGroup);
    userGjWholeDrawn = whole;
    renderLegend();
    userGjSel.refreshUi();
  }

  map.on('moveend zoomend', debounce(function(){ updateUserGjOverlay(false); }, 250));

  // ---- Loading ----
  function loadUserGjText(text, silent, sourceLabel, fileName){
    userGjBtn.classList.add('loading');
    if(!silent) toast('Файл уншиж байна…');

    function handleResult(data){
      userGjBtn.classList.remove('loading');
      if(!data || !data.ok){
        if(silent) userGjAutoLoadFailedHint();
        else toast('GeoJSON файл уншихад алдаа гарлаа. Файл зөв GeoJSON эсэхийг шалгана уу.');
        return;
      }
      if(data.features.length === 0){
        toast('Файлаас дүрс олдсонгүй');
        return;
      }
      var ex = data.extent;
      if(ex[0] < -180.5 || ex[2] > 180.5 || ex[1] < -90.5 || ex[3] > 90.5){
        // Projected coordinates without a recognised "crs" — drawing them as degrees would put them nowhere.
        toast('Координат нь градусаар (WGS84) биш байна. Файлаа EPSG:4326 (WGS84) рүү хөрвүүлж хадгалаад дахин нээнэ үү.');
        return;
      }
      userGjFeatures = data.features;
      userGjExtent = ex;
      userGjTotalVerts = data.verts;
      userGjLoaded = true;
      userGjVisible = true;
      userGjWholeDrawn = false;
      userGjSel.reset();
      analyzeUserGjProps();
      buildUserGjTypes();
      renderUserGjTypeUi();
      userGjLayerGroup.addTo(map);
      userGjBtn.classList.add('active');
      setUserGjFileLabel(fileName);
      toast(userGjFeatures.length + ' дүрс ачаалагдлаа' + (data.proj ? ' (' + data.proj + ' → градус)' : '') + (sourceLabel ? ' (' + sourceLabel + ')' : ''));
      idbSet(USERGJ_ENABLED_KEY, true).catch(function(){});
      // A file someone just opened may lie anywhere — show it. (Not on the
      // silent reload after a refresh, which keeps the remembered view.)
      if(!silent && !map.getBounds().intersects(userGjBounds())) userGjFit();
      updateUserGjOverlay(true);
    }

    var worker = getUserGjWorker();
    if(worker){
      worker.onmessage = function(e){ handleResult(e.data); };
      worker.onerror = function(e){ if(e && e.preventDefault) e.preventDefault(); handleResult(userGjProcess(text)); };
      worker.postMessage(text);
    } else {
      setTimeout(function(){ handleResult(userGjProcess(text)); }, 0);
    }
  }

  function userGjBounds(){
    return L.latLngBounds([userGjExtent[1], userGjExtent[0]], [userGjExtent[3], userGjExtent[2]]);
  }
  function userGjFit(){
    if(!userGjExtent) return;
    map.fitBounds(userGjBounds(), { padding:[40,40], maxZoom:17 });
  }

  function setUserGjFileLabel(fileName){
    userGjFileName = fileName || null;
    var row = document.getElementById('userGjFileInfoRow');
    var lbl = document.getElementById('userGjFileNameLbl');
    var cnt = document.getElementById('userGjCountLbl');
    if(fileName){
      lbl.textContent = fileName;
      lbl.title = fileName;
      cnt.textContent = userGjFeatures.length + ' дүрс';
      row.style.display = 'flex';
      document.getElementById('userGjActionsRow').style.display = 'flex';
    } else {
      row.style.display = 'none';
      document.getElementById('userGjActionsRow').style.display = 'none';
    }
  }

  function loadUserGjFile(file, silent){
    file.text().then(function(text){
      loadUserGjText(text, silent, silent ? 'өмнөх файлаас' : null, file.name);
    }).catch(function(){
      userGjBtn.classList.remove('loading');
      if(silent) userGjAutoLoadFailedHint();
      else toast('Файл уншихад алдаа гарлаа');
    });
  }

  function pickUserGjFile(){
    if(supportsFSAccess){
      window.showOpenFilePicker({
        types: [{ description:'GeoJSON', accept: { 'application/geo+json':['.geojson'], 'application/json':['.json'] } }],
        excludeAcceptAllOption: false,
        multiple: false
      }).then(function(handles){
        var handle = handles[0];
        idbSet(USERGJ_HANDLE_KEY, handle).catch(function(){});
        return handle.getFile();
      }).then(function(file){
        loadUserGjFile(file, false);
      }).catch(function(err){
        if(err && err.name === 'AbortError') return;
        toast('Файл сонгоход алдаа гарлаа');
      });
    } else {
      userGjFileInput.value = '';
      userGjFileInput.click();
    }
  }

  // After a refresh, reopen the last file automatically (Chrome/Edge remember
  // the file handle; elsewhere the file has to be picked again).
  function tryAutoLoadUserGj(){
    if(!supportsFSAccess) return;
    idbGet(USERGJ_ENABLED_KEY).then(function(wasEnabled){
      if(!wasEnabled) return;
      return idbGet(USERGJ_HANDLE_KEY).then(function(handle){
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
          .then(function(file){ loadUserGjFile(file, true); })
          .catch(function(){ userGjAutoLoadFailedHint(); });
      });
    }).catch(function(){});
  }

  function userGjAutoLoadFailedHint(){
    var el = document.getElementById('userGjHint');
    el.innerHTML = 'Өмнөх GeoJSON файлыг дахин нээж чадсангүй. <a href="#" id="userGjRetryLink" style="color:var(--teal); text-decoration:underline;">Дахин сонгох</a>';
    el.classList.add('show');
    document.getElementById('userGjRetryLink').addEventListener('click', function(e){
      e.preventDefault();
      userGjHint('');
      pickUserGjFile();
    });
  }
  map.whenReady(tryAutoLoadUserGj);

  function unloadUserGj(){
    userGjLayerGroup.clearLayers();
    map.removeLayer(userGjLayerGroup);
    userGjFeatures = null; userGjExtent = null; userGjTotalVerts = 0;
    userGjLoaded = false; userGjVisible = false; userGjWholeDrawn = false;
    userGjSel.reset();
    userGjTypeCandidates = []; userGjTypeKey = ''; userGjTypeOrder = [];
    setUserGjFileLabel(null);
    renderUserGjTypeUi();
    userGjBtn.classList.remove('active');
    userGjHint('');
    idbSet(USERGJ_ENABLED_KEY, false).catch(function(){});
    renderLegend();
  }

  userGjBtn.addEventListener('click', function(){
    if(!userGjLoaded){ pickUserGjFile(); return; }
    userGjVisible = !userGjVisible;
    userGjBtn.classList.toggle('active', userGjVisible);
    idbSet(USERGJ_ENABLED_KEY, userGjVisible).catch(function(){});
    if(userGjVisible){ userGjLayerGroup.addTo(map); updateUserGjOverlay(true); }
    else { map.removeLayer(userGjLayerGroup); userGjSel.reset(); updateUserGjOverlay(true); }
  });

  userGjFileInput.addEventListener('change', function(){
    var file = this.files && this.files[0];
    if(file) loadUserGjFile(file, false);
  });
  document.getElementById('userGjSwitchFileBtn').addEventListener('click', pickUserGjFile);
  document.getElementById('userGjFitBtn').addEventListener('click', function(){
    if(!userGjLoaded) return;
    if(!userGjVisible) userGjBtn.click();
    userGjFit();
  });
  document.getElementById('userGjRemoveBtn').addEventListener('click', unloadUserGj);

  // ---- Settings dropdown ----
  var userGjSettingsBtn = document.getElementById('userGjSettingsBtn');
  var userGjSettingsPanel = document.getElementById('userGjSettingsPanel');
  userGjSettingsBtn.addEventListener('click', function(e){
    e.stopPropagation();
    userGjSettingsPanel.classList.toggle('open');
  });
  document.addEventListener('click', function(e){
    if(!userGjSettingsPanel.contains(e.target) && e.target !== userGjSettingsBtn && !userGjSettingsBtn.contains(e.target)){
      userGjSettingsPanel.classList.remove('open');
    }
  });

  var gjColorInp = document.getElementById('gjColor');
  var gjWeightInp = document.getElementById('gjWeight');
  var gjWeightVal = document.getElementById('gjWeightVal');
  var gjFillInp = document.getElementById('gjFillOpacity');
  var gjFillVal = document.getElementById('gjFillOpacityVal');
  gjColorInp.value = userGjColor;
  gjWeightInp.value = userGjWeight;
  gjWeightVal.textContent = userGjWeight + 'px';
  gjFillInp.value = Math.round(userGjFillOpacity*100);
  gjFillVal.textContent = Math.round(userGjFillOpacity*100) + '%';
  gjColorInp.addEventListener('input', function(){
    userGjColor = this.value;
    saveSetting('userGjColor', userGjColor);
    updateUserGjOverlay(true);
  });
  gjWeightInp.addEventListener('input', function(){
    userGjWeight = parseFloat(this.value);
    gjWeightVal.textContent = userGjWeight + 'px';
    saveSetting('userGjWeight', userGjWeight);
    updateUserGjOverlay(true);
  });
  gjFillInp.addEventListener('input', function(){
    userGjFillOpacity = parseInt(this.value, 10) / 100;
    gjFillVal.textContent = this.value + '%';
    saveSetting('userGjFillOpacity', userGjFillOpacity);
    updateUserGjOverlay(true);
  });

  var gjTypeKeySelect = document.getElementById('gjTypeKeySelect');
  var gjTypeList = document.getElementById('gjTypeList');
  var gjTypeEmpty = document.getElementById('gjTypeEmpty');
  var gjResetColors = document.getElementById('gjResetColors');

  function renderUserGjTypeUi(){
    var opts = '<option value="">— Нэг өнгө —</option>';
    userGjTypeCandidates.forEach(function(c){
      opts += '<option value="'+escapeXml(c.key)+'">'+escapeXml(c.key)+' ('+c.distinct+')</option>';
    });
    gjTypeKeySelect.innerHTML = opts;
    gjTypeKeySelect.value = userGjTypeKey;
    document.getElementById('gjColorRow').style.display = userGjTypeKey ? 'none' : 'flex';

    if(!userGjTypeKey || userGjTypeOrder.length === 0){
      gjTypeList.innerHTML = '';
      gjTypeEmpty.style.display = '';
      gjTypeEmpty.querySelector('label').textContent = userGjLoaded
        ? 'Төрлөөр ялгах талбар сонгоогүй — нэг өнгөөр харуулж байна'
        : 'Файл ачаалагдсаны дараа төрөл тус бүрийн өнгө энд гарна';
      return;
    }
    gjTypeEmpty.style.display = 'none';
    renderTypeFilterRows(gjTypeList, userGjTypeOrder, {
      colorOf: function(t){ return userGjTypeColors[t]; },
      isHidden: function(t){ return isUserGjTypeHidden(t); },
      onColor: function(t, value){
        userGjTypeColors[t] = value;
        (userGjColorOverrides[userGjTypeKey] = userGjColorOverrides[userGjTypeKey] || {})[t] = value;
        saveSetting('userGjTypeColorOverrides', userGjColorOverrides);
        updateUserGjOverlay(true);
      },
      onToggle: function(t, shown){
        var h = (userGjTypesHidden[userGjTypeKey] = userGjTypesHidden[userGjTypeKey] || {});
        if(shown) delete h[t]; else h[t] = true;
        saveSetting('userGjTypesHidden', userGjTypesHidden);
        updateUserGjOverlay(true);
      }
    });
  }

  gjTypeKeySelect.addEventListener('change', function(){
    if(!userGjLoaded) return;
    userGjTypeKeyPref = this.value;
    saveSetting('userGjTypeKey', userGjTypeKeyPref);
    buildUserGjTypes();
    renderUserGjTypeUi();
    updateUserGjOverlay(true);
  });

  gjResetColors.addEventListener('click', function(){
    if(!userGjLoaded || !userGjTypeKey) return;
    delete userGjColorOverrides[userGjTypeKey];
    saveSetting('userGjTypeColorOverrides', userGjColorOverrides);
    buildUserGjTypes();
    renderUserGjTypeUi();
    updateUserGjOverlay(true);
  });

  renderUserGjTypeUi();
