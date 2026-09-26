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
      if(bboxIntersects(cadastreFeatures[i].bbox, view)) visible.push(cadastreFeatures[i]);
    }

    if(visible.length > CADASTRE_MAX_RENDER){
      cadastreHint(visible.length + ' нэгж талбар олдлоо — цөөрүүлэхийн тулд ойртуулна уу');
      renderLegend();
      return;
    }

    cadastreHint('');
    visible.forEach(function(feat){
      L.geoJSON(feat.geometry, {
        style: { color:CADASTRE_COLOR, weight:cadastreWeight, opacity:0.9, fillColor:CADASTRE_COLOR, fillOpacity:cadastreFillOpacity },
        pointToLayer: function(g, latlng){
          return L.circleMarker(latlng, { radius:5, color:CADASTRE_COLOR, weight:Math.max(cadastreWeight,1), opacity:0.9, fillColor:CADASTRE_COLOR, fillOpacity:Math.max(cadastreFillOpacity, 0.6) });
        }
      }).bindPopup(cadastrePopupHtml(feat.properties), { className:'mrpam-popup', maxWidth:260 })
        .addTo(cadastreLayerGroup);
    });
    renderLegend();
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
    else { map.removeLayer(cadastreLayerGroup); cadastreHint(''); renderLegend(); }
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
