  // ---------- Cadastre parcels overlay (egazar_parcels.geojson) ----------
  // Mirrors the MRPAM and Administrative-boundary layers above exactly:
  // Worker-based off-thread parsing (falls back to a main-thread parse
  // under file://), precomputed bboxes, viewport-only rendering, a zoom
  // floor, and a render cap. Nationwide cadastral parcel data can run into
  // the hundreds of thousands of features, so the same discipline is even
  // more important here than for MRPAM/Admin.
  var CADASTRE_MIN_ZOOM = 14; // parcels are small polygons — only useful zoomed in close
  var CADASTRE_MAX_RENDER = 300;
  var CADASTRE_COLOR = '#f5a623';

  var cadastreLoaded = false;
  var cadastreVisible = false;
  var cadastreFeatures = null; // [{bbox:[w,s,e,n], geometry, properties}, ...]
  var cadastreFileName = null;
  var cadastreLayerGroup = L.layerGroup();
  var cadastreWorker = null;

  var cadastreWeight = getSetting('cadastreWeight', 1.5);
  var cadastreFillOpacity = getSetting('cadastreFillOpacity', 0.08);

  var cadastreBtn = document.getElementById('cadastreLayerToggle');
  var cadastreFileInput = document.getElementById('cadastreFileInput');
  var CADASTRE_HANDLE_KEY = 'cadastreGeojsonHandle', CADASTRE_ENABLED_KEY = 'cadastreEnabled';

  function cadastreHint(msg){
    var el = document.getElementById('cadastreHint');
    if(!msg){ el.classList.remove('show'); return; }
    el.textContent = msg;
    el.classList.add('show');
  }

  // Reuses the exact same worker source shape as MRPAM's — a fresh Worker
  // instance, since a Blob-URL worker can only run the script it was built
  // from, but built from the identical logic (parse + per-feature bbox).
  function getCadastreWorker(){
    if(cadastreWorker) return cadastreWorker;
    try{
      var blob = new Blob([MRPAM_WORKER_SRC], { type:'application/javascript' });
      cadastreWorker = new Worker(URL.createObjectURL(blob));
      return cadastreWorker;
    } catch(e){
      return null; // file:// origin — caller falls back to parseGeojsonSync
    }
  }

  // Parcel data can come from different exports with different property
  // naming conventions, so rather than assuming specific key names (as
  // MRPAM/Admin do, since their schemas are known), every non-empty
  // property on the clicked feature is listed. Keys are lightly
  // prettified (underscores -> spaces, capitalized) so raw field names
  // like "parcel_area" still read naturally without hardcoding a mapping
  // that could silently drop fields the source file happens to use.
  function prettifyKey(key){
    var s = String(key).replace(/[_\-]+/g, ' ').trim();
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  function cadastrePopupHtml(props){
    props = props || {};
    var keys = Object.keys(props).filter(function(k){
      var v = props[k];
      return v !== undefined && v !== null && String(v).trim() !== '';
    });
    if(keys.length === 0){
      return '<dl><dt>Мэдээлэл</dt><dd>Энэ нэгж талбарт мэдээлэл байхгүй</dd></dl>';
    }
    var rows = keys.map(function(k){
      return '<dt>'+escapeXml(prettifyKey(k))+'</dt><dd>'+escapeXml(props[k])+'</dd>';
    }).join('');
    return '<dl>'+rows+'</dl>';
  }

  // ---- Coloring / filtering by parcel type ----
  // The parcel file's property names aren't known ahead of time, so the layer
  // looks at the loaded data and offers every property that behaves like a
  // category (2..CADASTRE_MAX_TYPES distinct short values) as a candidate
  // "type" field. One is picked automatically (names like land use / purpose /
  // type / category / зориулалт / төрөл first); the person can switch it, or
  // choose a single color, from the settings panel. The choice is remembered.
  var CADASTRE_MAX_TYPES = 40;
  var CADASTRE_NO_TYPE = 'Тодорхойгүй';
  var CADASTRE_TYPE_PALETTE = ['#e6194b','#3cb44b','#4363d8','#f58231','#911eb4','#42d4f4','#f032e6','#bfef45',
                               '#fabed4','#469990','#dcbeff','#9a6324','#fffac8','#800000','#aaffc3','#808000'];
  var CADASTRE_TYPE_KEY_TIERS = [
    /land.?use|landuse|zoriul|зориулалт|purpose|land.?type|ангилал|categor/i,
    /type|төрөл|turul|class|kind|use|usage|ownership|эзэмшил/i
  ];

  var cadastreTypeKeyPref = getSetting('cadastreTypeKey', null); // null = auto, '' = single color, else a property name
  var cadastreColorOverrides = getSetting('cadastreTypeColorOverrides', {}) || {}; // { <typeKey>: { <value>: '#hex' } }
  var cadastreTypesHidden = getSetting('cadastreTypesHidden', {}) || {};           // { <typeKey>: { <value>: true } }
  var cadastreTypeCandidates = []; // [{ key, distinct }] for the loaded file
  var cadastreTypeKey = '';        // property actually used for coloring ('' = one color)
  var cadastreTypeOrder = [];      // type values, most common first
  var cadastreTypeColors = {};     // { <value>: '#hex' }

  function hslToHex(h, s, l){
    s /= 100; l /= 100;
    var a = s * Math.min(l, 1 - l);
    function f(n){
      var k = (n + h / 30) % 12;
      var c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
      return ('0' + Math.round(255 * c).toString(16)).slice(-2);
    }
    return '#' + f(0) + f(8) + f(4);
  }
  function cadastreTypeColorAt(i){
    if(i < CADASTRE_TYPE_PALETTE.length) return CADASTRE_TYPE_PALETTE[i];
    return hslToHex((i * 137.508) % 360, 62, 55); // golden-angle hues keep extra types distinct
  }

  // Which of the file's properties look like categories.
  function analyzeCadastreProps(){
    var stats = Object.create(null), keyOrder = [];
    for(var i=0;i<cadastreFeatures.length;i++){
      var props = cadastreFeatures[i].properties;
      if(!props) continue;
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
          if(st.distinct >= CADASTRE_MAX_TYPES){ st.bad = true; st.freq = null; continue; } // too many distinct values: an id/name/area, not a category
          st.distinct++; st.freq[sv] = 0;
        }
        st.freq[sv]++;
      }
    }
    cadastreTypeCandidates = keyOrder.filter(function(k){ return !stats[k].bad && stats[k].distinct >= 2; })
      .map(function(k){ return { key:k, distinct:stats[k].distinct }; });
  }

  function autoPickCadastreTypeKey(){
    for(var t=0;t<CADASTRE_TYPE_KEY_TIERS.length;t++){
      for(var i=0;i<cadastreTypeCandidates.length;i++){
        if(CADASTRE_TYPE_KEY_TIERS[t].test(cadastreTypeCandidates[i].key)) return cadastreTypeCandidates[i].key;
      }
    }
    // No name hint: fall back to the property with the fewest categories.
    var best = null;
    cadastreTypeCandidates.forEach(function(c){ if(!best || c.distinct < best.distinct) best = c; });
    return best ? best.key : '';
  }

  function cadastreTypeOf(props){
    if(!cadastreTypeKey) return null;
    var v = props ? props[cadastreTypeKey] : null;
    if(v === null || v === undefined || typeof v === 'object') return CADASTRE_NO_TYPE;
    v = String(v).trim();
    return v || CADASTRE_NO_TYPE;
  }

  // Decides the type field, then (re)builds the ordered value list and colors.
  function buildCadastreTypes(){
    var keys = cadastreTypeCandidates.map(function(c){ return c.key; });
    if(cadastreTypeKeyPref === '') cadastreTypeKey = '';
    else if(cadastreTypeKeyPref && keys.indexOf(cadastreTypeKeyPref) !== -1) cadastreTypeKey = cadastreTypeKeyPref;
    else cadastreTypeKey = autoPickCadastreTypeKey();

    var counts = Object.create(null);
    if(cadastreTypeKey){
      for(var i=0;i<cadastreFeatures.length;i++){
        var t = cadastreTypeOf(cadastreFeatures[i].properties);
        counts[t] = (counts[t] || 0) + 1;
      }
    }
    cadastreTypeOrder = Object.keys(counts).sort(function(a, b){ return counts[b] - counts[a] || (a < b ? -1 : a > b ? 1 : 0); });
    var overrides = cadastreColorOverrides[cadastreTypeKey] || {};
    cadastreTypeColors = {};
    cadastreTypeOrder.forEach(function(t, i){ cadastreTypeColors[t] = overrides[t] || cadastreTypeColorAt(i); });
  }

  function isCadastreTypeHidden(t){
    if(!cadastreTypeKey) return false;
    var h = cadastreTypesHidden[cadastreTypeKey];
    return !!(h && h[t]);
  }
  function cadastreColorOfType(t){
    return (t !== null && cadastreTypeColors[t]) || CADASTRE_COLOR;
  }
  function cadastreColorOfProps(props){ return cadastreColorOfType(cadastreTypeOf(props)); }

  // Legend rows (type -> color) for the types currently shown, or null when
  // the layer is drawn in a single color.
  function cadastreLegendEntries(){
    if(!cadastreTypeKey) return null;
    return cadastreTypeOrder.filter(function(t){ return !isCadastreTypeHidden(t); })
      .map(function(t){ return { label:t, color:cadastreTypeColors[t] }; });
  }

  // ---- Select-and-export (same behaviour as MRPAM; see createSelectExport) ----
  var CADASTRE_NAME_KEYS = ['name','parcel_name','parcelname','parcel_id','parcelid','parcel_no','parcelno','parcel','code','id','gazar_id','нэр','дугаар','код'];
  function cadastreNameOf(props, idx){
    var lower = {};
    Object.keys(props || {}).forEach(function(k){ lower[k.toLowerCase()] = props[k]; });
    for(var i=0;i<CADASTRE_NAME_KEYS.length;i++){
      var v = lower[CADASTRE_NAME_KEYS[i]];
      if(v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
    }
    return 'Нэгж талбар ' + (idx + 1);
  }
  var cadastreSel = createSelectExport({
    slotId: 'cadastreSelectSlot',
    modeTitle: 'Газрын зураг дээр нэгж талбар дээр товшиж сонгоно',
    notLoadedMsg: 'Эхлээд кадастрын файл ачаална уу',
    unit: 'нэгж талбар',
    fileBase: 'kadastr-songoson',
    docName: 'Кадастр — сонгосон нэгж талбарууд',
    isLoaded: function(){ return cadastreLoaded; },
    getFeatures: function(){ return cadastreFeatures; },
    onChange: function(){ updateCadastreOverlay(); },
    nameOf: cadastreNameOf,
    colorOf: cadastreColorOfProps,
    descOf: function(props){
      return Object.keys(props || {}).filter(function(k){
        var v = props[k];
        return v !== undefined && v !== null && typeof v !== 'object' && String(v).trim() !== '';
      }).slice(0, 60).map(function(k){ return [prettifyKey(k), props[k]]; });
    }
  });

  function updateCadastreOverlay(){
    cadastreLayerGroup.clearLayers();
    if(!cadastreLoaded || !cadastreVisible){ cadastreHint(''); renderLegend(); return; }

    var zoom = map.getZoom();
    if(zoom < CADASTRE_MIN_ZOOM){
      cadastreHint('Кадастрын зураг харахын тулд ойртуулна уу (zoom ' + CADASTRE_MIN_ZOOM + '+)');
      renderLegend();
      return;
    }

    var b = map.getBounds();
    var view = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
    var visible = [];
    for(var i=0;i<cadastreFeatures.length;i++){
      var f = cadastreFeatures[i];
      if(!bboxIntersects(f.bbox, view)) continue;
      var t = cadastreTypeOf(f.properties); // null when drawn in a single color
      if(t !== null && isCadastreTypeHidden(t)) continue;
      visible.push({ feat:f, idx:i, type:t });
    }

    if(visible.length > CADASTRE_MAX_RENDER){
      cadastreHint(visible.length + ' нэгж талбар олдлоо — цөөрүүлэхийн тулд ойртуулна уу эсвэл зарим төрлийг унтраана уу');
      renderLegend();
      return;
    }

    cadastreHint(cadastreSel.isOn() ? 'Сонгох горим: нэгж талбар дээр товшиж сонгоно уу (' + cadastreSel.count() + ' сонгосон)' : '');
    visible.forEach(function(e){
      var c = cadastreColorOfType(e.type);
      var isSel = cadastreSel.isSelected(e.idx);
      var layer = L.geoJSON(e.feat.geometry, {
        style: isSel
          ? { color:'#ffffff', weight:Math.max(cadastreWeight+1.5, 3), opacity:1, fillColor:c, fillOpacity:Math.max(cadastreFillOpacity, 0.35) }
          : { color:c, weight:cadastreWeight, opacity:0.9, fillColor:c, fillOpacity:cadastreFillOpacity },
        pointToLayer: function(g, latlng){
          return L.circleMarker(latlng, { radius:5, color:isSel ? '#ffffff' : c, weight:Math.max(cadastreWeight,1), opacity:0.9, fillColor:c, fillOpacity:Math.max(cadastreFillOpacity, 0.6) });
        }
      }).addTo(cadastreLayerGroup);
      if(cadastreSel.isOn()){
        layer.on('click', function(ev){
          L.DomEvent.stopPropagation(ev);
          cadastreSel.toggle(e.idx);
          updateCadastreOverlay();
        });
      } else {
        layer.bindPopup(cadastrePopupHtml(e.feat.properties), { className:'mrpam-popup', maxWidth:260 });
      }
    });
    renderLegend();
    cadastreSel.refreshUi();
  }

  var debouncedCadastreUpdate = debounce(updateCadastreOverlay, 250);
  map.on('moveend zoomend', debouncedCadastreUpdate);

  function loadCadastreText(text, silent, sourceLabel, fileName){
    cadastreBtn.classList.add('loading');
    if(!silent) toast('Файл уншиж байна…');

    function handleResult(data){
      cadastreBtn.classList.remove('loading');
      if(!data.ok){
        if(silent){ cadastreAutoLoadFailedHint(); }
        else { toast('GeoJSON файл уншихад алдаа гарлаа. egazar_parcels.geojson файлыг сонгосон эсэхээ шалгана уу.'); }
        return;
      }
      // Replaces whatever was loaded before outright — switching to a
      // different soum/aimag file shouldn't leave the previous area's
      // parcels mixed in on the map.
      cadastreFeatures = data.features;
      cadastreLoaded = true;
      cadastreVisible = true;
      cadastreSel.reset(); // indexes belong to the previous file's features
      analyzeCadastreProps();
      buildCadastreTypes();
      renderCadastreTypeUi();
      cadastreLayerGroup.addTo(map);
      cadastreBtn.classList.add('active');
      setCadastreFileLabel(fileName);
      toast(cadastreFeatures.length + ' нэгж талбар ачааллагдлаа' + (sourceLabel ? ' (' + sourceLabel + ')' : ''));
      idbSet(CADASTRE_ENABLED_KEY, true).catch(function(){});
      updateCadastreOverlay();
    }

    var worker = getCadastreWorker();
    if(worker){
      worker.onmessage = function(e){ handleResult(e.data); };
      worker.onerror = function(){ handleResult(parseGeojsonSync(text)); };
      worker.postMessage(text);
    } else {
      setTimeout(function(){ handleResult(parseGeojsonSync(text)); }, 0);
    }
  }

  function setCadastreFileLabel(fileName){
    cadastreFileName = fileName || null;
    var row = document.getElementById('cadastreFileInfoRow');
    var lbl = document.getElementById('cadastreFileNameLbl');
    if(fileName){
      lbl.textContent = fileName;
      lbl.title = fileName;
      row.style.display = 'flex';
    } else {
      row.style.display = 'none';
    }
  }

  function loadCadastreFile(file, silent){
    file.text().then(function(text){
      loadCadastreText(text, silent, silent ? 'өмнөх файлаас' : null, file.name);
    }).catch(function(){
      cadastreBtn.classList.remove('loading');
      if(silent){ cadastreAutoLoadFailedHint(); }
      else { toast('Файл уншихад алдаа гарлаа'); }
    });
  }

  // Same "bundled next to the page" convenience as MRPAM/Admin — if
  // egazar_parcels.geojson sits alongside this HTML file, it loads with
  // zero clicks and no prior file selection needed.
  var CADASTRE_BUNDLED_URL = 'egazar_parcels.geojson';
  function tryLoadBundledCadastre(){
    return fetch(CADASTRE_BUNDLED_URL, { cache:'no-cache' }).then(function(res){
      if(!res.ok) throw new Error('http ' + res.status);
      return res.text();
    }).then(function(text){
      loadCadastreText(text, true, 'дотоод файлаас', CADASTRE_BUNDLED_URL);
      return true;
    }).catch(function(){
      return false; // not found / blocked by CORS (e.g. file://) — caller falls back
    });
  }

  function pickCadastreFile(){
    if(supportsFSAccess){
      window.showOpenFilePicker({
        types: [{ description:'GeoJSON', accept: { 'application/geo+json':['.geojson'], 'application/json':['.json'] } }],
        excludeAcceptAllOption: false,
        multiple: false
      }).then(function(handles){
        var handle = handles[0];
        idbSet(CADASTRE_HANDLE_KEY, handle).catch(function(){});
        return handle.getFile();
      }).then(function(file){
        loadCadastreFile(file, false);
      }).catch(function(err){
        if(err && err.name === 'AbortError') return;
        toast('Файл сонгоход алдаа гарлаа');
      });
    } else {
      cadastreFileInput.value = '';
      cadastreFileInput.click();
    }
  }

  function tryAutoLoadCadastre(){
    tryLoadBundledCadastre().then(function(loadedBundled){
      if(loadedBundled) return;
      tryAutoLoadCadastreFromRememberedHandle();
    });
  }

  function tryAutoLoadCadastreFromRememberedHandle(){
    if(!supportsFSAccess) return;
    idbGet(CADASTRE_ENABLED_KEY).then(function(wasEnabled){
      if(!wasEnabled) return;
      return idbGet(CADASTRE_HANDLE_KEY).then(function(handle){
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
          .then(function(file){ loadCadastreFile(file, true); })
          .catch(function(){ cadastreAutoLoadFailedHint(); });
      });
    }).catch(function(){});
  }

  function cadastreAutoLoadFailedHint(){
    var el = document.getElementById('cadastreHint');
    el.innerHTML = 'Өмнөх GeoJSON файлыг дахин ачаалж чадсангүй. <a href="#" id="cadastreRetryLink" style="color:var(--teal); text-decoration:underline;">Дахин сонгох</a>';
    el.classList.add('show');
    document.getElementById('cadastreRetryLink').addEventListener('click', function(e){
      e.preventDefault();
      cadastreHint('');
      pickCadastreFile();
    });
  }
  map.whenReady(tryAutoLoadCadastre);

  cadastreBtn.addEventListener('click', function(){
    if(!cadastreLoaded){
      pickCadastreFile();
      return;
    }
    cadastreVisible = !cadastreVisible;
    cadastreBtn.classList.toggle('active', cadastreVisible);
    idbSet(CADASTRE_ENABLED_KEY, cadastreVisible).catch(function(){});
    if(cadastreVisible){ cadastreLayerGroup.addTo(map); updateCadastreOverlay(); }
    else { map.removeLayer(cadastreLayerGroup); cadastreHint(''); renderLegend(); cadastreSel.reset(); }
  });

  cadastreFileInput.addEventListener('change', function(){
    var file = this.files && this.files[0];
    if(file) loadCadastreFile(file, false);
  });

  // Lets the person swap in a different soum/aimag's parcel file at any
  // time — unlike the main toggle button (which, once a file is loaded,
  // only shows/hides the layer), this always reopens the file picker.
  document.getElementById('cadastreSwitchFileBtn').addEventListener('click', function(){
    pickCadastreFile();
  });

  // ---- Cadastre settings dropdown (line weight, fill opacity) ----
  var cadastreSettingsBtn = document.getElementById('cadastreSettingsBtn');
  var cadastreSettingsPanel = document.getElementById('cadastreSettingsPanel');
  cadastreSettingsBtn.addEventListener('click', function(e){
    e.stopPropagation();
    cadastreSettingsPanel.classList.toggle('open');
  });
  document.addEventListener('click', function(e){
    if(!cadastreSettingsPanel.contains(e.target) && e.target !== cadastreSettingsBtn && !cadastreSettingsBtn.contains(e.target)){
      cadastreSettingsPanel.classList.remove('open');
    }
  });

  var caWeight = document.getElementById('caWeight');
  var caWeightVal = document.getElementById('caWeightVal');
  var caFillOpacity = document.getElementById('caFillOpacity');
  var caFillOpacityVal = document.getElementById('caFillOpacityVal');
  caWeight.value = cadastreWeight;
  caWeightVal.textContent = cadastreWeight + 'px';
  caFillOpacity.value = Math.round(cadastreFillOpacity*100);
  caFillOpacityVal.textContent = Math.round(cadastreFillOpacity*100) + '%';
  caWeight.addEventListener('input', function(){
    cadastreWeight = parseFloat(this.value);
    caWeightVal.textContent = cadastreWeight + 'px';
    saveSetting('cadastreWeight', cadastreWeight);
    updateCadastreOverlay();
  });
  caFillOpacity.addEventListener('input', function(){
    cadastreFillOpacity = parseInt(this.value, 10) / 100;
    caFillOpacityVal.textContent = this.value + '%';
    saveSetting('cadastreFillOpacity', cadastreFillOpacity);
    updateCadastreOverlay();
  });

  // ---- Type field + per-type color / show-hide list ----
  var caTypeKeySelect = document.getElementById('caTypeKeySelect');
  var caTypeList = document.getElementById('caTypeList');
  var caTypeEmpty = document.getElementById('caTypeEmpty');
  var caResetColors = document.getElementById('caResetColors');

  function renderCadastreTypeUi(){
    var opts = '<option value="">— Нэг өнгө —</option>';
    cadastreTypeCandidates.forEach(function(c){
      opts += '<option value="'+escapeXml(c.key)+'">'+escapeXml(c.key)+' ('+c.distinct+')</option>';
    });
    caTypeKeySelect.innerHTML = opts;
    caTypeKeySelect.value = cadastreTypeKey;

    if(!cadastreTypeKey || cadastreTypeOrder.length === 0){
      caTypeList.innerHTML = '';
      caTypeEmpty.style.display = '';
      caTypeEmpty.querySelector('label').textContent = cadastreLoaded
        ? 'Төрлөөр ялгах талбар сонгоогүй — нэг өнгөөр харуулж байна'
        : 'Файл ачаалагдсаны дараа төрөл тус бүрийн өнгө энд гарна';
      return;
    }
    caTypeEmpty.style.display = 'none';
    // Same row as MRPAM's type list: name, color picker, show/hide checkbox.
    renderTypeFilterRows(caTypeList, cadastreTypeOrder, {
      colorOf: function(t){ return cadastreTypeColors[t]; },
      isHidden: function(t){ return isCadastreTypeHidden(t); },
      onColor: function(t, value){
        cadastreTypeColors[t] = value;
        (cadastreColorOverrides[cadastreTypeKey] = cadastreColorOverrides[cadastreTypeKey] || {})[t] = value;
        saveSetting('cadastreTypeColorOverrides', cadastreColorOverrides);
        updateCadastreOverlay();
      },
      onToggle: function(t, shown){
        var h = (cadastreTypesHidden[cadastreTypeKey] = cadastreTypesHidden[cadastreTypeKey] || {});
        if(shown) delete h[t]; else h[t] = true;
        saveSetting('cadastreTypesHidden', cadastreTypesHidden);
        updateCadastreOverlay();
      }
    });
  }

  caTypeKeySelect.addEventListener('change', function(){
    if(!cadastreLoaded) return;
    cadastreTypeKeyPref = this.value;   // '' is an explicit "single color" choice
    saveSetting('cadastreTypeKey', cadastreTypeKeyPref);
    buildCadastreTypes();
    renderCadastreTypeUi();
    updateCadastreOverlay();
  });

  caResetColors.addEventListener('click', function(){
    if(!cadastreLoaded || !cadastreTypeKey) return;
    delete cadastreColorOverrides[cadastreTypeKey];
    saveSetting('cadastreTypeColorOverrides', cadastreColorOverrides);
    buildCadastreTypes();
    renderCadastreTypeUi();
    updateCadastreOverlay();
  });

  renderCadastreTypeUi(); // initial empty state until a file loads
