  console.log('Талбай хэмжигч — grat-fix-v2 (2<=latitude lines<=3, range-based search + draw-time safety net)');

  // ---------- Persisted settings (localStorage) ----------
  // Small wrapper so a missing/broken localStorage (private browsing,
  // storage quota, disabled by browser policy) never throws and breaks
  // the rest of the app — it just silently stops persisting.
  var SETTINGS_KEY = 'talbaiHemjigchSettings_v1';
  var settingsCache = null;
  function loadSettings(){
    if(settingsCache) return settingsCache;
    try{
      var raw = localStorage.getItem(SETTINGS_KEY);
      settingsCache = raw ? JSON.parse(raw) : {};
    } catch(e){
      settingsCache = {};
    }
    return settingsCache;
  }
  function saveSetting(key, value){
    var s = loadSettings();
    s[key] = value;
    try{ localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch(e){ /* quota / disabled — ignore */ }
  }
  function getSetting(key, fallback){
    var s = loadSettings();
    return (key in s) ? s[key] : fallback;
  }

  // ---------- Theme (dark / high-contrast light for outdoor use) ----------
  // Applied immediately (before map setup / first paint) to avoid a flash
  // of the wrong theme. Defaults to the OS light/dark preference the first
  // time the app runs; the manual toggle overrides that from then on.
  var osPrefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
  var lightThemeOn = getSetting('lightTheme', osPrefersLight);
  document.body.classList.toggle('light-theme', lightThemeOn);

  // ---------- Map setup ----------
  var map = L.map('map', { zoomControl:false, attributionControl:false }).setView([47.9184, 106.9177], 14);
  L.control.zoom({ position:'bottomright' }).addTo(map);
  L.control.scale({ position:'bottomleft', metric:true, imperial:false, maxWidth:120 }).addTo(map);

  // ---------- Basemap layers ----------
  var attrCtrl = L.control.attribution({ position:'bottomleft', prefix:false }).addTo(map);
  var currentAttribution = null;

  var BASEMAPS = [
    {
      id:'osm', label:'OpenStreetMap', attribution:'© OpenStreetMap',
      make: function(){ return L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { subdomains:['a','b','c'], maxZoom:19 }); }
    },
    {
      id:'esri_imagery', label:'ESRI World Imagery', attribution:'© Esri',
      make: function(){ return L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom:20 }); }
    },
    {
      id:'esri_clarity', label:'ESRI Clarity (HD)', attribution:'© Esri',
      make: function(){ return L.tileLayer('https://clarity.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom:20 }); }
    },
    {
      id:'bing_sat', label:'Microsoft Bing Satellite', attribution:'© Microsoft',
      make: null // set below — Bing needs quadkey tiling, not a simple {x}/{y}/{z} URL template
    },
    {
      id:'google_sat', label:'Google Satellite', attribution:'© Google',
      make: function(){ return L.tileLayer('https://{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', { subdomains:['mt0','mt1','mt2','mt3'], maxZoom:21 }); }
    },
    {
      id:'google_hybrid', label:'Google Hybrid', attribution:'© Google',
      make: function(){ return L.tileLayer('https://{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', { subdomains:['mt0','mt1','mt2','mt3'], maxZoom:21 }); }
    },
    {
      id:'google_terrain', label:'Google Terrain', attribution:'© Google',
      make: function(){ return L.tileLayer('https://{s}.google.com/vt/lyrs=p&x={x}&y={y}&z={z}', { subdomains:['mt0','mt1','mt2','mt3'], maxZoom:21 }); }
    },
    {
      id:'opentopo', label:'OpenTopoMap', attribution:'© OpenTopoMap',
      make: function(){ return L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { subdomains:['a','b','c'], maxZoom:17 }); }
    },
    {
      // Sentinel-2 true-color imagery via the user's own Sentinel Hub
      // (Copernicus Data Space Ecosystem) configuration. Needs an Instance
      // ID the person creates for free at dataspace.copernicus.eu — we
      // never ship a shared key, since embedding one in a public HTML file
      // would let anyone drain that account's quota.
      id:'sentinel2', label:'Sentinel-2 (хиймэл дагуул)', attribution:'Sentinel Hub / Copernicus (Sentinel-2)',
      make: function(silent){ return makeSentinel2Layer(silent); }
    }
  ];

  // Bing uses quadkey-based tile addressing, not {x}/{y}/{z} — implement a
  // tiny Leaflet.TileLayer subclass that converts to a quadkey URL.
  var BingLayer = L.TileLayer.extend({
    getTileUrl: function(coords){
      var quad = '';
      for(var i = coords.z; i > 0; i--){
        var digit = 0, mask = 1 << (i - 1);
        if((coords.x & mask) !== 0) digit += 1;
        if((coords.y & mask) !== 0) digit += 2;
        quad += digit;
      }
      var sub = this.options.subdomains[(coords.x + coords.y) % this.options.subdomains.length];
      return 'https://ecn.t' + sub + '.tiles.virtualearth.net/tiles/a' + quad + '.jpeg?g=1&n=z';
    }
  });
  BASEMAPS[3].make = function(){
    return new BingLayer('', { subdomains:['0','1','2','3'], maxZoom:19, tileSize:256 });
  };

  // ---------- Sentinel-2 (Sentinel Hub / Copernicus Data Space) ----------
  // Requires the user's own free Sentinel Hub Instance ID — see the modal
  // wired up below. Stored in localStorage like every other setting.
  var SENTINEL2_DEFAULT_LAYER = 'TRUE_COLOR';
  var SENTINEL2_LOOKBACK_DAYS = 60; // how far back from the chosen date to search for a cloud-filtered scene
  function todayIso(){ return new Date().toISOString().slice(0,10); }
  function getSentinelConfig(){
    return {
      instanceId: getSetting('sentinelInstanceId', ''),
      layerId: getSetting('sentinelLayerId', SENTINEL2_DEFAULT_LAYER)
    };
  }
  // Date + cloud-coverage are viewing preferences (not part of the account
  // setup), so they live in their own settings and can change freely
  // without reopening the Instance ID modal.
  var sentinelDate = getSetting('sentinelDate', todayIso());
  var sentinelMaxCC = getSetting('sentinelMaxCC', 30);
  function isoDateMinusDays(iso, days){
    var d = new Date(iso + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - days);
    return d.toISOString().slice(0,10);
  }
  function makeSentinel2Layer(silentFallback){
    var cfg = getSentinelConfig();
    if(!cfg.instanceId){
      // Defensive fallback only — setBasemap() already checks for a
      // configured instance ID before ever calling make(), so this really
      // only matters if make() is invoked directly some other way.
      if(!silentFallback) openSentinelSetupModal();
      return L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom:20 });
    }
    var base = 'https://sh.dataspace.copernicus.eu/ogc/wms/' + encodeURIComponent(cfg.instanceId);
    return L.tileLayer.wms(base, {
      layers: cfg.layerId || SENTINEL2_DEFAULT_LAYER,
      format: 'image/png',
      transparent: false,
      version: '1.3.0',
      maxZoom: 18,
      tileSize: 512, // matches Sentinel Hub's PopularWebMercator512 tile grid, avoids soft/blurry tiles
      attribution: 'Sentinel Hub / Copernicus (Sentinel-2)',
      // Custom Sentinel Hub params, passed through as extra WMS query
      // params: TIME picks the acquisition window (Sentinel Hub returns
      // the most recent cloud-filtered scene within it), MAXCC filters by
      // cloud coverage percentage, SHOWLOGO removes the Sentinel Hub
      // watermark that's otherwise burned into every tile.
      time: isoDateMinusDays(sentinelDate, SENTINEL2_LOOKBACK_DAYS) + '/' + sentinelDate,
      maxcc: sentinelMaxCC,
      showlogo: false
    });
  }

  var sentinelModal = document.getElementById('sentinelSetupModal');
  var sentinelInput = document.getElementById('sentinelInstanceIdInput');
  var sentinelLayerInput = document.getElementById('sentinelLayerIdInput');
  var sentinelDateSection = document.getElementById('sentinelDateSection');
  var sentinelCloudSlider = document.getElementById('sentinelCloudSlider');
  var sentinelCloudVal = document.getElementById('sentinelCloudVal');
  var sentinelDiagPanel = document.getElementById('sentinelDiagPanel');
  var sentinelDiagLink = document.getElementById('sentinelDiagLink');
  var sentinelMapDateBar = document.getElementById('sentinelMapDateBar');
  var sentinelMapDateInput = document.getElementById('sentinelMapDateInput');

  function updateSentinelDateSectionVisibility(){
    // The cloud-coverage control (inside the modal) only makes sense once
    // an Instance ID is configured — shown any time that's true, not just
    // while Sentinel-2 happens to be the active basemap, since the person
    // may be setting it up for the first time or fine-tuning it while
    // looking at a different basemap.
    sentinelDateSection.classList.toggle('show', !!getSentinelConfig().instanceId);
  }

  function updateSentinelMapDateBarVisibility(){
    // The date-navigation bar lives on the map itself (below the search
    // box), so unlike the cloud slider it should only appear while
    // Sentinel-2 is actually the layer being looked at — otherwise it'd be
    // a confusing floating control with no visible effect.
    var showing = currentBasemapId === 'sentinel2';
    sentinelMapDateBar.classList.toggle('show', showing);
    // The legend panel's default position sits just below the search box
    // alone — with the date bar now also occupying that space, push the
    // legend further down so the two don't overlap. Looked up by ID here
    // (rather than relying on the module-level `legendPanel` variable)
    // because this function can run during initial page load, before that
    // variable's own declaration further down the script has executed.
    var legendPanelEl = document.getElementById('legendPanel');
    if(legendPanelEl) legendPanelEl.classList.toggle('below-sentinel-bar', showing);
  }

  function openSentinelSetupModal(){
    var cfg = getSentinelConfig();
    sentinelInput.value = cfg.instanceId;
    sentinelLayerInput.value = cfg.layerId;
    sentinelLayerIdSelect.style.display = 'none';
    updateSentinelDateSectionVisibility();
    sentinelDiagPanel.style.display = 'none'; // only shown by toastSentinelError() when a real failure occurred
    sentinelModal.classList.add('show');
  }
  function closeSentinelSetupModal(){ sentinelModal.classList.remove('show'); }

  // Called when Sentinel-2 tiles fail to load. Shows a short toast, and
  // opens the setup modal with a diagnostic panel containing a direct link
  // to the failing tile URL — that's the only way to see Sentinel Hub's
  // actual error text, since a browser <img> load failure never exposes
  // the HTTP status or response body to JavaScript.
  function toastSentinelError(failedUrl){
    toast('Sentinel-2 ачаалагдсангүй — тохиргооны цонхон дахь холбоос дээр дарж шалтгааныг харна уу.');
    var cfg = getSentinelConfig();
    sentinelInput.value = cfg.instanceId;
    sentinelLayerInput.value = cfg.layerId;
    sentinelLayerIdSelect.style.display = 'none';
    updateSentinelDateSectionVisibility();
    if(failedUrl){
      sentinelDiagLink.href = failedUrl;
      sentinelDiagLink.textContent = failedUrl;
      sentinelDiagPanel.style.display = 'block';
    } else {
      sentinelDiagPanel.style.display = 'none';
    }
    sentinelModal.classList.add('show');
  }

  document.getElementById('sentinelSetupClose').addEventListener('click', closeSentinelSetupModal);
  document.getElementById('sentinelSetupCancel').addEventListener('click', closeSentinelSetupModal);
  document.getElementById('sentinelSetupSave').addEventListener('click', function(){
    var id = sentinelInput.value.trim();
    var layerId = sentinelLayerInput.value.trim() || SENTINEL2_DEFAULT_LAYER;
    if(!id){ toast('Instance ID оруулна уу'); return; }
    saveSetting('sentinelInstanceId', id);
    saveSetting('sentinelLayerId', layerId);
    closeSentinelSetupModal();
    setBasemap('sentinel2');
    toast('Sentinel-2 тохиргоо хадгалагдлаа');
  });
  document.getElementById('sentinelSetupClear').addEventListener('click', function(){
    saveSetting('sentinelInstanceId', '');
    sentinelInput.value = '';
    updateSentinelDateSectionVisibility();
    if(currentBasemapId === 'sentinel2'){
      closeSentinelSetupModal();
      setBasemap('esri_imagery');
    }
    toast('Instance ID устгагдлаа');
  });

  // ---- Fetch the user's actual layer list via WMS GetCapabilities ----
  // "TRUE_COLOR" is only a common convention, not something that exists
  // automatically — Sentinel Hub layer IDs are whatever the person named
  // them in their own Configuration Utility, so guessing a hardcoded
  // default causes exactly the "Layer ... not found" error this avoids.
  var sentinelFetchLayersBtn = document.getElementById('sentinelFetchLayersBtn');
  var sentinelLayerIdSelect = document.getElementById('sentinelLayerIdSelect');
  var sentinelLayerIdHint = document.getElementById('sentinelLayerIdHint');

  function fetchSentinelLayers(){
    var id = sentinelInput.value.trim();
    if(!id){ toast('Эхлээд Instance ID оруулна уу'); return; }
    sentinelFetchLayersBtn.disabled = true;
    sentinelFetchLayersBtn.textContent = 'Ачааллаж байна…';
    var url = 'https://sh.dataspace.copernicus.eu/ogc/wms/' + encodeURIComponent(id) + '?REQUEST=GetCapabilities&SERVICE=WMS&VERSION=1.3.0';
    fetch(url).then(function(res){
      if(!res.ok) throw new Error('HTTP ' + res.status);
      return res.text();
    }).then(function(text){
      var xml = new DOMParser().parseFromString(text, 'application/xml');
      if(xml.querySelector('parsererror')) throw new Error('parse error');
      var exception = xml.querySelector('ServiceException');
      if(exception){ throw new Error(exception.textContent.trim()); }
      // Layer names live in <Layer><Name>...</Name></Layer> — the root
      // <Layer> element itself usually has no <Name>, only its children do.
      var names = [];
      xml.querySelectorAll('Layer > Name').forEach(function(nameEl){
        var n = nameEl.textContent.trim();
        if(n && names.indexOf(n) === -1) names.push(n);
      });
      if(names.length === 0){
        toast('Энэ Instance ID дээр давхарга олдсонгүй. Sentinel Hub Dashboard дээрээ эхлээд давхарга (layer) үүсгэнэ үү.');
        sentinelLayerIdSelect.style.display = 'none';
        return;
      }
      sentinelLayerIdSelect.innerHTML = names.map(function(n){
        return '<option value="'+n.replace(/"/g,'&quot;')+'">'+n+'</option>';
      }).join('');
      sentinelLayerIdSelect.style.display = 'block';
      sentinelLayerIdHint.textContent = names.length + ' давхарга олдлоо — доороос сонгоно уу (эсвэл дээрх талбарт өөрөө бичиж болно).';
      // Pick whichever the person already had typed, if it's in the list;
      // otherwise default to the first one found.
      var current = sentinelLayerInput.value.trim();
      sentinelLayerIdSelect.value = names.indexOf(current) !== -1 ? current : names[0];
      sentinelLayerInput.value = sentinelLayerIdSelect.value;
      toast(names.length + ' давхарга олдлоо');
    }).catch(function(err){
      // A network/CORS-level failure (as opposed to a Sentinel Hub service
      // exception, which is caught above and re-thrown with its own
      // message) can't be told apart from JS with certainty — fetch()
      // rejects with a generic "Failed to fetch" either way, especially
      // from a file:// origin where CORS behavior is inconsistent across
      // browsers. Give a manual fallback either way rather than a dead end.
      var msg = (err && err.message) ? err.message : 'алдаа гарлаа';
      sentinelLayerIdHint.innerHTML = 'Автоматаар татаж чадсангүй (' + escapeXml(msg) + '). Дараах холбоосыг шинэ tab дээр нээгээд, гарч ирэх XML доtorh <b>&lt;Layer&gt;&lt;Name&gt;...&lt;/Name&gt;&lt;/Layer&gt;</b> хэсгүүдээс өөрийн давхаргын нэрийг олж, дээрх талбарт гараар бичнэ үү: <a href="'+url+'" target="_blank" rel="noopener" style="word-break:break-all;">'+url+'</a>';
      toast('Автоматаар татаж чадсангүй — доорх зааврыг үзнэ үү');
    }).finally(function(){
      sentinelFetchLayersBtn.disabled = false;
      sentinelFetchLayersBtn.textContent = 'Жагсаалт татах';
    });
  }
  sentinelFetchLayersBtn.addEventListener('click', fetchSentinelLayers);
  sentinelLayerIdSelect.addEventListener('change', function(){
    sentinelLayerInput.value = this.value;
  });

  // ---- Sentinel-2 date / cloud-coverage controls ----
  // Live inside the setup modal, right below the Instance ID fields.
  // Changing either updates the active WMS layer in place via setParams()
  // (when Sentinel-2 is the current basemap) rather than tearing down and
  // recreating the whole tile layer; if some other basemap is active the
  // new values are simply saved for next time Sentinel-2 is selected.
  function refreshSentinelLayerParams(){
    if(currentBasemapId !== 'sentinel2' || !currentLayer || typeof currentLayer.setParams !== 'function') return;
    currentLayer.setParams({
      time: isoDateMinusDays(sentinelDate, SENTINEL2_LOOKBACK_DAYS) + '/' + sentinelDate,
      maxcc: sentinelMaxCC
    });
  }

  sentinelMapDateInput.value = sentinelDate;
  sentinelMapDateInput.max = todayIso();
  sentinelCloudSlider.value = sentinelMaxCC;
  sentinelCloudVal.textContent = sentinelMaxCC + '%';

  sentinelMapDateInput.addEventListener('change', function(){
    if(!this.value) return;
    var v = this.value > todayIso() ? todayIso() : this.value;
    sentinelDate = v;
    sentinelMapDateInput.value = v;
    saveSetting('sentinelDate', sentinelDate);
    refreshSentinelLayerParams();
  });
  document.getElementById('sentinelMapDatePrev').addEventListener('click', function(){
    sentinelDate = isoDateMinusDays(sentinelDate, 1);
    sentinelMapDateInput.value = sentinelDate;
    saveSetting('sentinelDate', sentinelDate);
    refreshSentinelLayerParams();
  });
  document.getElementById('sentinelMapDateNext').addEventListener('click', function(){
    var next = isoDateMinusDays(sentinelDate, -1);
    if(next > todayIso()) return; // no imagery from the future
    sentinelDate = next;
    sentinelMapDateInput.value = sentinelDate;
    saveSetting('sentinelDate', sentinelDate);
    refreshSentinelLayerParams();
  });
  document.getElementById('sentinelMapDateToday').addEventListener('click', function(){
    sentinelDate = todayIso();
    sentinelMapDateInput.value = sentinelDate;
    saveSetting('sentinelDate', sentinelDate);
    refreshSentinelLayerParams();
  });
  sentinelCloudSlider.addEventListener('input', function(){
    sentinelMaxCC = parseInt(this.value, 10);
    sentinelCloudVal.textContent = sentinelMaxCC + '%';
    saveSetting('sentinelMaxCC', sentinelMaxCC);
    refreshSentinelLayerParams();
  });

  // ---------- Overlay layers ----------
  // These are transparent overlays that stack ON TOP of whichever basemap
  // (satellite, terrain, etc.) is currently active — not a standalone
  // basemap themselves. Independently toggled with checkboxes.
  var OVERLAYS = [
    {
      id:'google_roads', label:'Google хаяг', attribution:'© Google',
      // lyrs=h = Google's transparent "hybrid" layer: roads + place labels only, no imagery.
      make: function(){ return L.tileLayer('https://{s}.google.com/vt/lyrs=h&x={x}&y={y}&z={z}', { subdomains:['mt0','mt1','mt2','mt3'], maxZoom:21, pane:'overlayPane' }); }
    },
    {
      id:'esri_roads', label:'ESRI зам', attribution:'© Esri',
      // Reference/World_Transportation is ESRI's transparent roads-only overlay.
      make: function(){ return L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}', { maxZoom:19, pane:'overlayPane' }); }
    }
  ];
  var overlayLayers = {}; // id -> active Leaflet layer instance (or absent if off)
  var overlayAttributions = {}; // id -> attribution string currently added

  function setOverlay(id, on){
    var def = OVERLAYS.filter(function(o){ return o.id === id; })[0];
    if(!def) return;
    if(on){
      if(overlayLayers[id]) return; // already on
      var layer = def.make();
      layer.addTo(map);
      overlayLayers[id] = layer;
      overlayAttributions[id] = def.attribution;
      attrCtrl.addAttribution(def.attribution);
    } else {
      if(!overlayLayers[id]) return; // already off
      map.removeLayer(overlayLayers[id]);
      delete overlayLayers[id];
      if(overlayAttributions[id]){
        attrCtrl.removeAttribution(overlayAttributions[id]);
        delete overlayAttributions[id];
      }
    }
    renderLayerPanel();
    var onIds = OVERLAYS.filter(function(o){ return !!overlayLayers[o.id]; }).map(function(o){ return o.id; });
    saveSetting('overlayIds', onIds);
  }

  var currentLayer = null;
  var currentBasemapId = null;
  var basemapLabelEl = document.getElementById('basemapLabel');

  // If a basemap's tiles fail to load (dead endpoint, offline, blocked
  // domain, etc.), most requests within a short window will error out.
  // Rather than leaving the user staring at a blank/black map with no
  // explanation, warn them and suggest switching basemap.
  var tileErrorCount = 0, tileOkCount = 0, tileHealthTimer = null;
  function watchTileHealth(layer, label){
    tileErrorCount = 0; tileOkCount = 0;
    clearTimeout(tileHealthTimer);
    var firstFailedUrl = null;
    layer.on('tileerror', function(e){
      tileErrorCount++;
      if(!firstFailedUrl && e.tile && e.tile.src) firstFailedUrl = e.tile.src;
    });
    layer.on('tileload', function(){ tileOkCount++; });
    tileHealthTimer = setTimeout(function(){
      if(tileErrorCount > 0 && tileOkCount === 0){
        if(currentBasemapId === 'sentinel2'){
          // A generic "check your internet" message is actively misleading
          // here — Sentinel-2 tile failures are almost always either an
          // Instance ID that's wrong/expired, a domain/referrer restriction
          // set on that Sentinel Hub configuration, or the free quota being
          // used up — none of which a network check would fix. A browser
          // <img> error never exposes the HTTP status or response body, so
          // the only way to see Sentinel Hub's actual error text is to open
          // one of the failing tile URLs directly — logged here, and shown
          // as a clickable link in the setup modal's diagnostic panel.
          if(firstFailedUrl){
            console.warn('Sentinel-2 tile failed, open this URL directly to see the real error from Sentinel Hub:', firstFailedUrl);
          }
          toastSentinelError(firstFailedUrl);
        } else {
          toast('"' + label + '" давхарга ачаалагдсангүй. Сүлжээгээ шалгаад өөр давхарга сонгож үзнэ үү.');
        }
      }
    }, 4000);
  }

  function setBasemap(id, silent){
    var def = BASEMAPS.filter(function(b){ return b.id === id; })[0];
    if(!def) return;
    if(id === 'sentinel2' && !getSentinelConfig().instanceId){
      // Never let an unconfigured Sentinel-2 become "the" saved basemap —
      // redirect to setup (or a safe fallback on silent/restore calls)
      // before touching currentLayer at all, so there's no flash of an
      // empty layer and no chance of persisting a broken basemapId.
      if(!silent) openSentinelSetupModal();
      setBasemap('esri_imagery', true);
      return;
    }
    if(currentLayer) map.removeLayer(currentLayer);
    currentLayer = def.make(silent);
    currentLayer.addTo(map);
    if(currentLayer.bringToBack) currentLayer.bringToBack();
    currentBasemapId = id;
    basemapLabelEl.textContent = def.label.toUpperCase();
    if(currentAttribution) attrCtrl.removeAttribution(currentAttribution);
    currentAttribution = def.attribution;
    attrCtrl.addAttribution(currentAttribution);
    renderLayerPanel();
    watchTileHealth(currentLayer, def.label);
    saveSetting('basemapId', id);
    updateSentinelMapDateBarVisibility();
  }

  var layerPanel = document.getElementById('layerPanel');
  function renderLayerPanel(){
    layerPanel.innerHTML = '';
    BASEMAPS.forEach(function(def){
      var row = document.createElement('div');
      row.className = 'layer-opt' + (def.id === currentBasemapId ? ' active' : '');
      row.innerHTML = '<span class="dot"></span><span>' + def.label + '</span>';
      if(def.id === 'sentinel2'){
        var gearBtn = document.createElement('span');
        gearBtn.textContent = '⚙';
        gearBtn.className = 'sentinel-gear';
        gearBtn.title = 'Sentinel-2 тохиргоо';
        gearBtn.addEventListener('click', function(e){
          e.stopPropagation();
          openSentinelSetupModal();
          closeLayerPanel();
        });
        row.appendChild(gearBtn);
      }
      row.addEventListener('click', function(){
        if(def.id === 'sentinel2' && !getSentinelConfig().instanceId){
          openSentinelSetupModal();
          closeLayerPanel();
          return;
        }
        setBasemap(def.id);
        closeLayerPanel();
      });
      layerPanel.appendChild(row);
    });

    var sep = document.createElement('div');
    sep.className = 'layer-sep';
    sep.textContent = 'Давхарлах давхарга';
    layerPanel.appendChild(sep);

    OVERLAYS.forEach(function(def){
      var isOn = !!overlayLayers[def.id];
      var row = document.createElement('label');
      row.className = 'layer-overlay-opt' + (isOn ? ' on' : '');
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = isOn;
      cb.addEventListener('change', function(){
        setOverlay(def.id, cb.checked);
      });
      var span = document.createElement('span');
      span.textContent = def.label;
      row.appendChild(cb);
      row.appendChild(span);
      layerPanel.appendChild(row);
    });
  }

  var basemapToggleBtn = document.getElementById('basemapToggle');
  function openLayerPanel(){ layerPanel.classList.add('open'); basemapToggleBtn.classList.add('open'); }
  function closeLayerPanel(){ layerPanel.classList.remove('open'); basemapToggleBtn.classList.remove('open'); }
  basemapToggleBtn.addEventListener('click', function(e){
    e.stopPropagation();
    if(layerPanel.classList.contains('open')) closeLayerPanel(); else openLayerPanel();
  });
  document.addEventListener('click', function(e){
    if(!layerPanel.contains(e.target) && e.target !== basemapToggleBtn) closeLayerPanel();
  });

