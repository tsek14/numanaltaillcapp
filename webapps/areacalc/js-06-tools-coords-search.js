  // ---------- Tab switching ----------
  document.querySelectorAll('.tab').forEach(function(tab){
    tab.addEventListener('click', function(){
      document.querySelectorAll('.tab').forEach(function(t){t.classList.remove('active');});
      document.querySelectorAll('.panel').forEach(function(p){p.classList.remove('active');});
      this.classList.add('active');
      mode = this.getAttribute('data-mode');
      document.getElementById('panel-'+mode).classList.add('active');
      document.getElementById('sheet').setAttribute('data-mode', mode);
      if(mode !== 'tap' && typeof tapDrawActive !== 'undefined' && tapDrawActive) stopTapDraw();
      document.getElementById('crosshair').style.display = (mode==='tap' && !tapDrawActive) ? 'block' : 'none';
      if(mode === 'layers') renderLayersPanel();
      if(mode === 'coords') renderCoordsPanel();
    });
  });
  // ---------- Fullscreen toggle ----------
  var expandIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>';
  var collapseIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/></svg>';

  var fsBtn = document.getElementById('fullscreenBtn');
  var fsActive = false;

  function setFsState(on){
    fsActive = on;
    document.body.classList.toggle('fs-active', on);
    fsBtn.innerHTML = on ? collapseIcon : expandIcon;
    fsBtn.title = on ? 'Дэлгэцээс гарах' : 'Дэлгэц дүүргэх';
    setTimeout(function(){ map.invalidateSize(); }, 260);
  }

  function requestFs(el){
    var fn = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
    if(fn) { try { fn.call(el); } catch(e){} }
  }
  function exitFs(){
    var fn = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
    if(fn) { try { fn.call(document); } catch(e){} }
  }

  fsBtn.addEventListener('click', function(){
    if(!fsActive){
      setFsState(true);
      requestFs(document.getElementById('app'));
    } else {
      setFsState(false);
      if(document.fullscreenElement || document.webkitFullscreenElement){ exitFs(); }
    }
  });

  ['fullscreenchange','webkitfullscreenchange','msfullscreenchange'].forEach(function(evt){
    document.addEventListener(evt, function(){
      var isFs = !!(document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement);
      if(!isFs && fsActive){ setFsState(false); }
    });
  });

  document.getElementById('crosshair').style.display = 'block';

  // ---------- Drag handle collapse ----------
  document.getElementById('dragHandle').addEventListener('click', function(){
    document.getElementById('sheet').classList.toggle('collapsed');
  });

  // ---------- Tap mode buttons ----------
  var btnTapDraw = document.getElementById('btnTapDraw');
  var crosshairEl = document.getElementById('crosshair');

  function mapTapDrawClick(e){
    pushUndo();
    shapes[tapShapeIndex].points.push({ lat:e.latlng.lat, lng:e.latlng.lng });
    redrawAll();
  }

  function startTapDraw(){
    // If the shape we last drew into already has points, this is a fresh
    // session — start a brand-new shape instead of continuing the old one.
    if(shapes[tapShapeIndex] && shapes[tapShapeIndex].points.length > 0){
      shapes.push({ points: [] });
      tapShapeIndex = shapes.length - 1;
    }
    tapDrawActive = true;
    btnTapDraw.classList.add('active');
    btnTapDraw.textContent = '✓ Дуусгах';
    map.getContainer().style.cursor = 'crosshair';
    crosshairEl.style.display = 'none'; // drag-to-center crosshair not needed in click-to-add mode
    // Exclusive with the distance-measure tool, which also listens for map clicks.
    if(typeof measureActive !== 'undefined' && measureActive) stopMeasuring();
    map.on('click', mapTapDrawClick);
    toast('Товшиж зурах горим: газрын зураг дээр товшиж цэг нэмнэ үү');
    redrawAll();
  }

  function stopTapDraw(){
    tapDrawActive = false;
    btnTapDraw.classList.remove('active');
    btnTapDraw.textContent = '✛ Товшиж зурах';
    map.getContainer().style.cursor = '';
    if(mode === 'tap') crosshairEl.style.display = 'block';
    map.off('click', mapTapDrawClick);
    redrawAll(); // markers lose their drag handles once the session ends
  }

  btnTapDraw.addEventListener('click', function(){
    if(!tapDrawActive){ startTapDraw(); } else { stopTapDraw(); }
  });

  document.getElementById('btnAddCenter').addEventListener('click', function(){
    pushUndo();
    var c = map.getCenter();
    shapes[tapShapeIndex].points.push({ lat:c.lat, lng:c.lng });
    redrawAll();
  });
  document.getElementById('btnUndo').addEventListener('click', function(){
    if(shapes[tapShapeIndex].points.length === 0) return;
    pushUndo();
    shapes[tapShapeIndex].points.pop();
    redrawAll();
  });
  document.getElementById('btnClearTap').addEventListener('click', function(){
    if(shapes[tapShapeIndex].points.length === 0) return;
    pushUndo();
    shapes[tapShapeIndex].points = [];
    redrawAll();
  });
  document.getElementById('btnGPS').addEventListener('click', function(){
    if(!navigator.geolocation){ toast('GPS дэмжигдэхгүй байна'); return; }
    if(location.protocol === 'file:'){ toast(geoErrorMessage()); return; }
    toast('Байршил тодорхойлж байна…');
    navigator.geolocation.getCurrentPosition(function(pos){
      var lat = pos.coords.latitude, lng = pos.coords.longitude;
      pushUndo();
      shapes[tapShapeIndex].points.push({lat:lat, lng:lng});
      map.setView([lat,lng], Math.max(map.getZoom(),17));
      redrawAll();
      toast('Байршил нэмэгдлээ');
    }, function(err){
      toast(geoErrorMessage(err));
    }, { enableHighAccuracy:true, timeout:12000 });
  });

  // ---------- Live location + GPS track recording (single toggle button) ----------
  var trackBtn = document.getElementById('trackBtn');

  function updateMeMarker(lat, lng){
    var latlng = [lat, lng];
    if(!trackMarker){
      trackMarker = L.marker(latlng, {
        icon: L.divIcon({
          html:'<div class="me-marker-wrap"><div class="me-pulse"></div><div class="me-dot"></div></div>',
          className:'', iconSize:[20,20], iconAnchor:[10,10]
        }),
        zIndexOffset: 1000,
        interactive:false
      }).addTo(map); // added directly to the map (not drawLayer) so redraws never clear it
    } else {
      trackMarker.setLatLng(latlng);
    }
  }

  // The shape being recorded is remembered by reference (not just by index), so
  // deleting an earlier layer or replacing the shapes from the coordinate box
  // while recording can never make the recorder write into the wrong shape.
  var trackShapeRef = null;
  var trackFirstFix = false;

  function startTracking(){
    if(!navigator.geolocation){ toast('GPS дэмжигдэхгүй байна'); return; }
    if(location.protocol === 'file:'){ toast(geoErrorMessage()); return; }

    var ts = { points: [], isTrack: true };
    shapes.push(ts);
    trackShapeRef = ts;
    trackShapeIndex = shapes.length - 1;
    lastTrackLatLng = null;
    trackFirstFix = true;
    trackActive = true;
    trackBtn.classList.add('active');
    trackBtn.title = 'Зам бичихийг зогсоох';
    toast('Байршил хайж байна…');

    trackWatchId = navigator.geolocation.watchPosition(function(pos){
      var lat = pos.coords.latitude, lng = pos.coords.longitude;
      updateMeMarker(lat, lng);

      // The map is the person's own while recording: only the very first fix
      // brings the view to where they are. After that every new fix just extends
      // the track — panning, zooming in/out or looking elsewhere never interrupts
      // it, and the map is never pulled back.
      if(trackFirstFix){
        trackFirstFix = false;
        map.setView([lat, lng], Math.max(map.getZoom(), 17));
      }

      var idx = trackShapeRef ? shapes.indexOf(trackShapeRef) : -1;
      if(idx === -1){ stopTracking(); return; } // the shape is gone (e.g. replaced from the coordinate box)
      trackShapeIndex = idx;

      var shouldAdd = true;
      if(lastTrackLatLng){
        var d = distanceMeters(lastTrackLatLng, {lat:lat, lng:lng});
        if(d < MIN_TRACK_DISTANCE) shouldAdd = false;
      }
      if(shouldAdd){
        trackShapeRef.points.push({ lat:lat, lng:lng });
        lastTrackLatLng = { lat:lat, lng:lng };
        redrawAll();
      }
    }, function(err){
      toast(geoErrorMessage(err));
      if(err && err.code === 1){ stopTracking(); }
    }, { enableHighAccuracy:true, maximumAge:2000, timeout:15000 });
  }

  // Remove one shape (by reference) and keep the "current shape" index valid.
  function removeShapeObject(sh){
    var i = shapes.indexOf(sh);
    if(i === -1) return;
    shapes.splice(i, 1);
    if(i < tapShapeIndex) tapShapeIndex--;
    if(!shapes.length) shapes = [ { points: [] } ]; // tap mode always needs a slot to write into
    if(tapShapeIndex >= shapes.length) tapShapeIndex = shapes.length - 1;
    if(tapShapeIndex < 0) tapShapeIndex = 0;
  }

  function stopTracking(){
    var ts = trackShapeRef;
    trackActive = false;
    trackBtn.classList.remove('active');
    trackBtn.title = 'Байршил + зам бичиж эхлэх';
    if(trackWatchId !== null){
      navigator.geolocation.clearWatch(trackWatchId);
      trackWatchId = null;
    }
    trackShapeIndex = null;
    trackShapeRef = null;
    lastTrackLatLng = null;

    if(!ts || shapes.indexOf(ts) === -1){ toast('Зам бичихийг зогсоолоо'); return; }
    if(ts.points.length < 2){
      // One fix (or none) is not a track — don't leave an empty/one-point layer behind.
      removeShapeObject(ts);
      redrawAll({ noFit:true });
      toast('Зам бичихийг зогсоолоо (хадгалах цэг хүрэлцсэнгүй)');
      return;
    }
    redrawAll({ noFit:true }); // no zoom-to-fit: the view stays exactly where the person left it
    askSaveTrack(ts);
  }

  // ---------- Saving a finished track (this device only, localStorage) ----------
  // On stop the person is asked whether to keep the track. Layers are already
  // auto-saved as a working session, so "keep" here means something more durable:
  // a named record in a separate list («Хадгалсан замууд») that survives clearing
  // the map, and "don't keep" really discards the track (Undo brings it back).
  var SAVED_TRACKS_KEY = 'talbaiHemjigchSavedTracks_v1';
  function readSavedTracks(){
    try{
      var arr = JSON.parse(localStorage.getItem(SAVED_TRACKS_KEY) || '[]');
      return Array.isArray(arr) ? arr.filter(function(t){ return t && t.id && Array.isArray(t.pts) && t.pts.length > 1; }) : [];
    } catch(e){ return []; }
  }
  function writeSavedTracks(list){
    try{ localStorage.setItem(SAVED_TRACKS_KEY, JSON.stringify(list)); return true; } catch(e){ return false; }
  }
  function two(n){ return (n < 10 ? '0' : '') + n; }
  function fmtStamp(d){ return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate()) + ' ' + two(d.getHours()) + ':' + two(d.getMinutes()); }
  function defaultTrackName(){ return 'GPS зам ' + fmtStamp(new Date()); }

  var trackSaveModal = document.getElementById('trackSaveModal');
  var trackSaveName = document.getElementById('trackSaveName');
  var pendingTrack = null;
  function askSaveTrack(ts){
    pendingTrack = ts;
    document.getElementById('trackSaveInfo').textContent = ts.points.length + ' цэг · ' + humanLen(pathLengthMeters(ts.points)).big;
    trackSaveName.value = defaultTrackName();
    trackSaveModal.classList.add('show');
    setTimeout(function(){ try{ trackSaveName.focus(); trackSaveName.select(); }catch(e){} }, 60);
  }
  function closeTrackSave(){ trackSaveModal.classList.remove('show'); pendingTrack = null; }

  document.getElementById('trackSaveYes').addEventListener('click', function(){
    var ts = pendingTrack;
    if(!ts) return;
    var name = (trackSaveName.value || '').replace(/\s+/g, ' ').trim().slice(0, 80) || defaultTrackName();
    var rec = {
      id: 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: name, savedAt: new Date().toISOString(),
      pts: ts.points.map(function(p){ return [Math.round(p.lat * 1e6) / 1e6, Math.round(p.lng * 1e6) / 1e6]; })
    };
    var list = readSavedTracks();
    list.push(rec);
    var ok = writeSavedTracks(list);
    closeTrackSave();
    if(ok){
      ts.name = name; ts.savedId = rec.id;
      toast('Зам хадгалагдлаа: ' + name);
    } else {
      toast('Хадгалж чадсангүй — хөтчийн санах ой дүүрсэн байна. Зам газрын зураг дээр хэвээр байна.');
    }
    redrawAll({ noFit:true });
    updateSavedTracksCount();
  });
  document.getElementById('trackSaveNo').addEventListener('click', function(){
    var ts = pendingTrack;
    closeTrackSave();
    if(!ts) return;
    pushUndo();               // so a mis-tap can be taken back with the Undo button
    removeShapeObject(ts);
    redrawAll({ noFit:true });
    toast('Зам хадгалагдсангүй. Буцаах (↶) товчоор сэргээж болно');
  });
  trackSaveName.addEventListener('keydown', function(e){
    if(e.key === 'Enter'){ e.preventDefault(); document.getElementById('trackSaveYes').click(); }
  });

  // ---------- Saved tracks list ----------
  var savedTracksModal = document.getElementById('savedTracksModal');
  var savedTracksList = document.getElementById('savedTracksList');
  var savedTracksEmpty = document.getElementById('savedTracksEmpty');
  function updateSavedTracksCount(){
    var n = readSavedTracks().length;
    document.getElementById('savedTracksCount').textContent = n ? '(' + n + ')' : '';
  }
  function renderSavedTracks(){
    var list = readSavedTracks().slice().reverse(); // newest first
    savedTracksEmpty.style.display = list.length ? 'none' : '';
    savedTracksList.innerHTML = list.map(function(t){
      var pts = t.pts.map(function(q){ return { lat:q[0], lng:q[1] }; });
      var when = t.savedAt ? fmtStamp(new Date(t.savedAt)) : '';
      return '<div class="saved-track" data-id="' + escapeXml(t.id) + '">'
        + '<div class="st-main"><div class="st-name">' + escapeXml(t.name) + '</div>'
        + '<div class="st-meta">' + escapeXml(when) + ' · ' + t.pts.length + ' цэг · ' + humanLen(pathLengthMeters(pts)).big + '</div></div>'
        + '<div class="st-actions"><button type="button" class="gs-mini-btn" data-act="show">Газрын зурагт</button>'
        + '<button type="button" class="gs-mini-btn st-del" data-act="del">Устгах</button></div></div>';
    }).join('');
  }
  function openSavedTracks(){ renderSavedTracks(); savedTracksModal.classList.add('show'); }
  function closeSavedTracks(){ savedTracksModal.classList.remove('show'); }
  function showSavedTrack(id){
    var rec = readSavedTracks().filter(function(t){ return t.id === id; })[0];
    if(!rec) return;
    var pts = rec.pts.map(function(q){ return { lat:q[0], lng:q[1] }; });
    var onMap = shapes.filter(function(sh){ return sh.savedId === rec.id; })[0];
    closeSavedTracks();
    if(onMap){
      toast('Энэ зам газрын зураг дээр байна');
    } else {
      pushUndo();
      shapes.push({ points: pts, isTrack: true, name: rec.name, savedId: rec.id });
      redrawAll({ noFit:true });
      toast('«' + rec.name + '» газрын зурагт нэмэгдлээ');
    }
    map.fitBounds(L.latLngBounds(pts.map(function(q){ return [q.lat, q.lng]; })), { padding:[60,60], maxZoom:18 });
  }
  savedTracksList.addEventListener('click', function(e){
    var btn = e.target.closest ? e.target.closest('button[data-act]') : null;
    if(!btn) return;
    var id = btn.closest('.saved-track').getAttribute('data-id');
    if(btn.getAttribute('data-act') === 'show'){ showSavedTrack(id); return; }
    // Delete asks twice (second tap within 3 s confirms) — no browser dialog needed.
    if(btn.getAttribute('data-confirm') !== '1'){
      btn.setAttribute('data-confirm', '1');
      btn.textContent = 'Баталгаажуулах';
      btn.classList.add('confirm');
      setTimeout(function(){
        if(btn.parentNode){ btn.removeAttribute('data-confirm'); btn.textContent = 'Устгах'; btn.classList.remove('confirm'); }
      }, 3000);
      return;
    }
    writeSavedTracks(readSavedTracks().filter(function(t){ return t.id !== id; }));
    renderSavedTracks();
    updateSavedTracksCount();
    toast('Хадгалсан зам устгагдлаа');
  });
  document.getElementById('savedTracksBtn').addEventListener('click', function(){ openSavedTracks(); closeMorePanel(); });
  document.getElementById('savedTracksClose').addEventListener('click', closeSavedTracks);
  savedTracksModal.addEventListener('click', function(e){ if(e.target === savedTracksModal) closeSavedTracks(); });
  document.addEventListener('keydown', function(e){
    if(e.key === 'Escape' && savedTracksModal.classList.contains('show')) closeSavedTracks();
  });
  updateSavedTracksCount();

  trackBtn.addEventListener('click', function(){
    if(!trackActive){ startTracking(); } else { stopTracking(); }
    closeMorePanel();
  });

  // ---------- Measure distance tool ----------
  var measureBtn = document.getElementById('measureBtn');
  var measureCard = document.getElementById('measureCard');
  var measureTotalEl = document.getElementById('measureTotal');
  var measureSubEl = document.getElementById('measureSub');
  var measureLayer = L.layerGroup();
  var measureActive = false;
  var measurePoints = []; // [{lat,lng}, ...]

  function fmtDistance(m){
    if(m >= 1000) return fmt(m/1000, 2) + ' км';
    return fmt(m, 1) + ' м';
  }

  function measureDotIcon(){
    return L.divIcon({ html:'<div class="measure-pt"></div>', className:'', iconSize:[10,10], iconAnchor:[5,5] });
  }

  function redrawMeasure(){
    measureLayer.clearLayers();
    var total = 0;
    for(var i=0;i<measurePoints.length;i++){
      var p = measurePoints[i];
      L.marker([p.lat, p.lng], { icon:measureDotIcon(), interactive:false }).addTo(measureLayer);
      if(i > 0){
        var prev = measurePoints[i-1];
        var seg = distanceMeters(prev, p);
        total += seg;
        L.polyline([[prev.lat,prev.lng],[p.lat,p.lng]], { color:'#35d9b0', weight:3, dashArray:'6,5' }).addTo(measureLayer);
        var midLat = (prev.lat + p.lat)/2, midLng = (prev.lng + p.lng)/2;
        var labelText = fmtDistance(seg);
        var labelWidth = Math.max(34, labelText.length * 6.5 + 14);
        L.marker([midLat, midLng], {
          icon: L.divIcon({
            html:'<div class="measure-label">'+labelText+'</div>',
            className:'measure-label-wrap',
            iconSize:[labelWidth, 18],
            iconAnchor:[labelWidth/2, 24]
          }),
          interactive:false
        }).addTo(measureLayer);
      }
    }
    measureTotalEl.textContent = fmtDistance(total);
    if(measurePoints.length === 0){
      measureSubEl.textContent = 'Газрын зураг дээр товшиж цэг нэмнэ үү';
    } else if(measurePoints.length === 1){
      measureSubEl.textContent = 'Дараагийн цэгээ товшино уу';
    } else {
      measureSubEl.textContent = measurePoints.length + ' цэг · ' + (measurePoints.length-1) + ' сегмент';
    }
    return total;
  }

  function measureMapClick(e){
    measurePoints.push({ lat:e.latlng.lat, lng:e.latlng.lng });
    redrawMeasure();
  }

  function startMeasuring(){
    measureActive = true;
    measureBtn.classList.add('active');
    measureCard.classList.add('show');
    measureLayer.addTo(map);
    // Measuring is exclusive with tap-drawing and GPS track recording.
    if(trackActive) stopTracking();
    if(typeof tapDrawActive !== 'undefined' && tapDrawActive) stopTapDraw();
    map.on('click', measureMapClick);
    toast('Зай хэмжих горим: газрын зураг дээр товшиж цэгүүд нэмнэ үү');
    redrawMeasure();
  }

  function stopMeasuring(){
    measureActive = false;
    measureBtn.classList.remove('active');
    measureCard.classList.remove('show');
    map.off('click', measureMapClick);
    map.removeLayer(measureLayer);
  }

  measureBtn.addEventListener('click', function(){
    if(!measureActive){ startMeasuring(); } else { stopMeasuring(); }
    closeMorePanel();
  });

  document.getElementById('measureUndo').addEventListener('click', function(){
    measurePoints.pop();
    redrawMeasure();
  });

  document.getElementById('measureClear').addEventListener('click', function(){
    measurePoints = [];
    redrawMeasure();
  });

  // ---------- Text mode ----------
  var orderSwitch = document.getElementById('orderSwitch');
  orderSwitch.classList.toggle('on', lngLatOrder);
  document.getElementById('orderLabel').textContent = lngLatOrder
    ? 'Дараалал: Уртраг, Өргөрөг (lng, lat)'
    : 'Дараалал: Өргөрөг, Уртраг (lat, lng)';
  orderSwitch.addEventListener('click', function(){
    lngLatOrder = !lngLatOrder;
    orderSwitch.classList.toggle('on', lngLatOrder);
    document.getElementById('orderLabel').textContent = lngLatOrder
      ? 'Дараалал: Уртраг, Өргөрөг (lng, lat)'
      : 'Дараалал: Өргөрөг, Уртраг (lat, lng)';
    saveSetting('lngLatOrder', lngLatOrder);
  });

  // Extract every number (with optional leading minus, decimal point) from a string
  function extractNumbers(str){
    var m = str.match(/-?\d+(?:\.\d+)?/g);
    return m ? m.map(Number) : [];
  }

  // Parse one "field" (everything belonging to one of the two coordinate values)
  // Handles: decimal degrees (49.7643567), degrees+decimal minutes (49 32.5),
  // full DMS (49 32 10.2), with or without °, ', " symbols, with or without N/S/E/W.
  function parseDegField(str){
    if(!str) return null;
    var dirMatch = str.match(/[NSEWnsew]/);
    var dir = dirMatch ? dirMatch[0].toUpperCase() : null;
    var nums = extractNumbers(str);
    if(nums.length === 0) return null;
    var rawNegative = nums[0] < 0;
    var d = Math.abs(nums[0]);
    var mnt = nums.length > 1 ? Math.abs(nums[1]) : 0;
    var sec = nums.length > 2 ? Math.abs(nums[2]) : 0;
    var value = d + mnt/60 + sec/3600;
    var negative = dir ? (dir === 'S' || dir === 'W') : rawNegative;
    if(negative) value = -value;
    return { value: value, dir: dir };
  }

  // Split one input line into two coordinate "fields" (lat-field, lng-field)
  function splitFields(line){
    line = line.trim();
    if(line.indexOf(',') !== -1){
      var idx = line.indexOf(',');
      return [line.slice(0, idx), line.slice(idx+1)];
    }
    // no comma: try splitting right after a direction letter (N/S/E/W)
    var re = /[NSEWnsew]/g;
    var pos = -1, mm;
    while((mm = re.exec(line))){ pos = mm.index; break; }
    if(pos !== -1){
      var a = line.slice(0, pos+1);
      var b = line.slice(pos+1);
      if(a.trim() && b.trim() && extractNumbers(b).length > 0) return [a, b];
    }
    // fallback: split whitespace-separated tokens evenly in half
    var tokens = line.split(/\s+/).filter(Boolean);
    if(tokens.length >= 2 && tokens.length % 2 === 0){
      var half = tokens.length/2;
      return [tokens.slice(0,half).join(' '), tokens.slice(half).join(' ')];
    }
    return [line, ''];
  }

  // ---------- UTM support ----------
  // A forgiving UTM reader. Every line below is the same spot in Ulaanbaatar:
  //   48N 636589.299 5303082.815          zone + hemisphere, Easting then Northing
  //   48N 636589.299 E 5303082.815 N      E / N labels written after the values
  //   48N E 636589.299 N 5303082.815      labels written before the values
  //   48T 636589.299 5303082.815          MGRS latitude-band letter instead of N/S
  //   5303082.815, 636589.299             no zone, Northing first (the Mongolian "X, Y" habit)
  //   636589.299, 5303082.815             no zone, Easting first
  //   X=5303082.815 Y=636589.299          X = Northing, Y = Easting
  // Which number is the Easting and which the Northing is decided from their
  // size first (an Easting is always 6 digits, a Northing 7), then from E/N/X/Y
  // labels, and only then from the order typed (Easting first). A missing zone
  // is taken from the centre of the map, and the result says so.
  var UTM_BAND_LETTERS = 'CDEFGHJKLMNPQRSTUVWX'; // C..X, skipping I and O
  // Bands N..X (index >=10) are the northern hemisphere; C..M are southern.
  function utmBandHemisphere(letter){
    var idx = UTM_BAND_LETTERS.indexOf(letter.toUpperCase());
    if(idx === -1) return null;
    return idx >= 10 ? 'N' : 'S';
  }
  function utmZoneOfLng(lng){ return Math.min(60, Math.max(1, Math.floor((lng + 180) / 6) + 1)); }
  // Words that say which of the two numbers is which. X is the Northing and Y the
  // Easting in Mongolian survey practice; Cyrillic Х is accepted as well as Latin X.
  var UTM_ROLE_WORDS = {
    'E':'e', 'EAST':'e', 'EASTING':'e', 'Y':'e', '\u0417\u04AE\u04AE\u041D':'e',
    'N':'n', 'NORTH':'n', 'NORTHING':'n', 'X':'n', '\u0425':'n', '\u0425\u041E\u0419\u0414':'n'
  };
  function utmRoleOf(segment){
    var w = String(segment).replace(/[^A-Za-z\u0410-\u044F\u04AE\u04AF\u04E8\u04E9]/g, '').toUpperCase();
    return Object.prototype.hasOwnProperty.call(UTM_ROLE_WORDS, w) ? UTM_ROLE_WORDS[w] : null;
  }
  function utmIsEasting(v){ return v >= 100000 && v < 1000000; }
  function utmIsNorthing(v){ return v >= 1000000 && v <= 10000000; }

  // -> null            not UTM at all (so other parsers get a go)
  //    {ok:false,...}  looks like UTM but the values make no sense
  //    {ok:true, lat, lng, zone, hemi, easting, northing, zoneAssumed, hemiAssumed, swapped}
  function parseUTMDetailed(text){
    var s = String(text == null ? '' : text).trim();
    if(!s) return null;
    var re = /\d+(?:\.\d+)?/g, nums = [], m;
    while((m = re.exec(s))) nums.push({ v:parseFloat(m[0]), raw:m[0], start:m.index, end:m.index + m[0].length });
    if(nums.length !== 2 && nums.length !== 3) return null;

    var zone = null, hemi = null, letterGiven = false, a, b, seg0Start = 0;
    if(nums.length === 3){
      // First number is the zone: an integer 1..60, optionally prefixed by "UTM"/"ZONE"
      // and followed by the hemisphere (N/S) or a latitude-band letter.
      var z = nums[0];
      if(z.raw.indexOf('.') !== -1 || z.v < 1 || z.v > 60) return null;
      var pre = s.slice(0, z.start).replace(/[^A-Za-z]/g, '').toUpperCase();
      if(pre && pre !== 'UTM' && pre !== 'UTMZONE' && pre !== 'ZONE') return null;
      zone = z.v;
      var between = s.slice(z.end, nums[1].start);
      var lm = between.match(/^\s*([A-Za-z])(?![A-Za-z])/);
      seg0Start = z.end;
      // An "E" right after the zone is a label for the Easting, not the (southern) band E.
      if(lm && lm[1].toUpperCase() !== 'E'){
        var Lt = lm[1].toUpperCase();
        hemi = (Lt === 'N' || Lt === 'S') ? Lt : utmBandHemisphere(Lt);
        if(!hemi) return null;
        letterGiven = true;
        seg0Start = z.end + lm[0].length;
      }
      a = nums[1]; b = nums[2];
    } else {
      a = nums[0]; b = nums[1];
    }

    // Without a zone letter there is nothing but the numbers to say this is UTM,
    // so insist they look like one (6-digit Easting + 7-digit Northing); this keeps
    // decimal degrees and DMS lines from ever being mistaken for UTM.
    var decisive = (utmIsNorthing(a.v) && utmIsEasting(b.v)) || (utmIsEasting(a.v) && utmIsNorthing(b.v));
    if(!letterGiven && !decisive) return null;

    var seg0 = s.slice(seg0Start, a.start), seg1 = s.slice(a.end, b.start), seg2 = s.slice(b.end);
    var roleA, roleB;
    if(utmRoleOf(seg0)){ roleA = utmRoleOf(seg0); roleB = utmRoleOf(seg1); }   // labels before the values
    else { roleA = utmRoleOf(seg1); roleB = utmRoleOf(seg2); }                 // labels after the values

    var aIsNorthing;
    if(utmIsNorthing(a.v) && utmIsEasting(b.v)) aIsNorthing = true;
    else if(utmIsEasting(a.v) && utmIsNorthing(b.v)) aIsNorthing = false;
    else if(roleA && roleB && roleA !== roleB) aIsNorthing = (roleA === 'n');
    else if(roleA && !roleB) aIsNorthing = (roleA === 'n');
    else if(roleB && !roleA) aIsNorthing = (roleB === 'e');
    else aIsNorthing = false; // nothing else to go on: Easting first, the usual order
    var easting = aIsNorthing ? b.v : a.v, northing = aIsNorthing ? a.v : b.v;

    if(!(easting > 0 && easting < 1000000) || !(northing >= 0 && northing <= 10000000)){
      return { ok:false, reason:'range', easting:easting, northing:northing };
    }

    // A missing hemisphere is taken from the map (north in Mongolia). A missing zone
    // cannot be known — the same numbers are valid in every zone — so the zones next
    // to the map's own are tried and the one that lands NEAREST the map centre wins;
    // the others are returned as `alternatives` for the caller to offer.
    var zoneAssumed = false, hemiAssumed = false, alternatives = [];
    var ctr = (typeof map !== 'undefined' && map) ? map.getCenter() : { lat:47.9, lng:106.9 };
    if(!hemi){ hemi = ctr.lat < 0 ? 'S' : 'N'; hemiAssumed = true; }
    if(zone === null){
      // Mongolia spans exactly six zones (45N-50N), so near Mongolia all six are
      // candidates (the right one is then always on offer, wherever the map is
      // looking); anywhere else just the map's own zone and its two neighbours.
      var zc = utmZoneOfLng(ctr.lng), cands = [], tryZones = (zc >= 43 && zc <= 52) ? [45, 46, 47, 48, 49, 50] : [zc - 1, zc, zc + 1];
      tryZones.forEach(function(zz){
        if(zz < 1 || zz > 60) return;
        var q = utmToLatLng(zz, hemi, easting, northing);
        if(!isFinite(q.lat) || !isFinite(q.lng) || Math.abs(q.lat) > 90) return;
        var dx = (q.lng - ctr.lng) * Math.cos(ctr.lat * Math.PI / 180), dy = q.lat - ctr.lat;
        cands.push({ zone:zz, hemi:hemi, easting:easting, northing:northing, lat:q.lat, lng:q.lng, d:dx*dx + dy*dy });
      });
      if(!cands.length) return { ok:false, reason:'range', easting:easting, northing:northing };
      cands.sort(function(x, y){ return x.d - y.d; });
      zone = cands[0].zone; zoneAssumed = true; alternatives = cands.slice(1, 3); // the nearest three in all
    }
    var ll = utmToLatLng(zone, hemi, easting, northing);
    if(!isFinite(ll.lat) || !isFinite(ll.lng) || Math.abs(ll.lat) > 90){ return { ok:false, reason:'range', easting:easting, northing:northing }; }
    return { ok:true, lat:ll.lat, lng:ll.lng, zone:zone, hemi:hemi, easting:easting, northing:northing,
             zoneAssumed:zoneAssumed, hemiAssumed:hemiAssumed, swapped:aIsNorthing, alternatives:alternatives };
  }
  // Kept for any caller that only wants a point: {lat,lng} or null.
  function parseUTMLine(line){
    var r = parseUTMDetailed(line);
    return (r && r.ok) ? { lat:r.lat, lng:r.lng } : null;
  }
  function utmDescribe(r){ return 'UTM ' + r.zone + r.hemi + ' \u00b7 E ' + r.easting + ' \u00b7 N ' + r.northing; }
  // What was guessed on the person's behalf (empty when they spelled everything out).
  function utmNote(r){
    var parts = [];
    if(r.zoneAssumed) parts.push('\u0431\u04af\u0441 \u0437\u0430\u0430\u0433\u0430\u0430\u0433\u04af\u0439 \u0442\u0443\u043b ' + r.zone + r.hemi + ' \u0433\u044d\u0436 \u04af\u0437\u043b\u044d\u044d (\u0433\u0430\u0437\u0440\u044b\u043d \u0437\u0443\u0440\u0433\u0438\u0439\u043d \u0442\u04e9\u0432\u0442 \u0445\u0430\u043c\u0433\u0438\u0439\u043d \u043e\u0439\u0440 \u0431\u04af\u0441)');
    if(r.swapped) parts.push('Northing, Easting \u0434\u0430\u0440\u0430\u0430\u043b\u043b\u0430\u0430\u0440 \u0442\u0430\u043d\u044c\u043b\u0430\u0430');
    return parts.join(' \u00b7 ');
  }
  // Two numbers, one of them 6+ digits: reads like an attempt at UTM.
  function utmInputLooksLike(text){
    var m = String(text).match(/\d+(?:\.\d+)?/g);
    return !!m && m.length >= 2 && m.some(function(x){ return x.split('.')[0].length >= 6; });
  }
  var UTM_FORMAT_HELP = 'UTM \u0443\u043d\u0448\u0438\u0433\u0434\u0441\u0430\u043d\u0433\u04af\u0439. \u0417\u04e9\u0432 \u0431\u0438\u0447\u0438\u0445: 48N 636589.299 5303082.815 (\u0431\u04af\u0441, Easting, Northing). \u0411\u04af\u0441\u0433\u04af\u0439 \u0431\u043e\u043b: 5303082.815, 636589.299';

  // Standard UTM (WGS84) inverse projection -> {lat, lng} in decimal degrees.
  function utmToLatLng(zone, hemisphere, easting, northing){
    var a = 6378137.0;
    var eccSq = 0.00669438;
    var e1 = (1 - Math.sqrt(1 - eccSq)) / (1 + Math.sqrt(1 - eccSq));
    var x = easting - 500000.0;
    var y = northing;
    if(hemisphere === 'S'){ y -= 10000000.0; }

    var longOrigin = (zone - 1) * 6 - 180 + 3;
    var eccPrimeSq = eccSq / (1 - eccSq);

    var M = y / 0.9996;
    var mu = M / (a * (1 - eccSq/4 - 3*eccSq*eccSq/64 - 5*eccSq*eccSq*eccSq/256));

    var phi1 = mu
      + (3*e1/2 - 27*Math.pow(e1,3)/32) * Math.sin(2*mu)
      + (21*e1*e1/16 - 55*Math.pow(e1,4)/32) * Math.sin(4*mu)
      + (151*Math.pow(e1,3)/96) * Math.sin(6*mu);

    var N1 = a / Math.sqrt(1 - eccSq*Math.sin(phi1)*Math.sin(phi1));
    var T1 = Math.tan(phi1)*Math.tan(phi1);
    var C1 = eccPrimeSq*Math.cos(phi1)*Math.cos(phi1);
    var R1 = a*(1-eccSq) / Math.pow(1 - eccSq*Math.sin(phi1)*Math.sin(phi1), 1.5);
    var D = x / (N1*0.9996);

    var lat = phi1 - (N1*Math.tan(phi1)/R1) * (
      D*D/2
      - (5+3*T1+10*C1-4*C1*C1-9*eccPrimeSq) * Math.pow(D,4)/24
      + (61+90*T1+298*C1+45*T1*T1-252*eccPrimeSq-3*C1*C1) * Math.pow(D,6)/720
    );
    lat = lat * (180/Math.PI);

    var lon = (
      D
      - (1+2*T1+C1) * Math.pow(D,3)/6
      + (5-2*C1+28*T1-3*C1*C1+8*eccPrimeSq+24*T1*T1) * Math.pow(D,5)/120
    ) / Math.cos(phi1);
    lon = longOrigin + lon * (180/Math.PI);

    return { lat: lat, lng: lon };
  }

  // Standard forward UTM (WGS84) projection: decimal degrees -> {zone, hemi, easting, northing}.
  // Uses the standard 6°-wide zone bands (no Norway/Svalbard exceptions),
  // matching the simple inverse projection above.
  function latLngToUTM(lat, lng){
    var a = 6378137.0;
    var eccSq = 0.00669438;
    var k0 = 0.9996;
    var latRad = lat * Math.PI/180;
    var lngRad = lng * Math.PI/180;

    var zone = Math.floor((lng + 180) / 6) + 1;
    var lngOrigin = (zone - 1) * 6 - 180 + 3;
    var lngOriginRad = lngOrigin * Math.PI/180;

    var eccPrimeSq = eccSq / (1 - eccSq);
    var N = a / Math.sqrt(1 - eccSq*Math.sin(latRad)*Math.sin(latRad));
    var T = Math.tan(latRad)*Math.tan(latRad);
    var C = eccPrimeSq*Math.cos(latRad)*Math.cos(latRad);
    var A = Math.cos(latRad)*(lngRad - lngOriginRad);

    var M = a*(
        (1 - eccSq/4 - 3*eccSq*eccSq/64 - 5*Math.pow(eccSq,3)/256)*latRad
      - (3*eccSq/8 + 3*eccSq*eccSq/32 + 45*Math.pow(eccSq,3)/1024)*Math.sin(2*latRad)
      + (15*eccSq*eccSq/256 + 45*Math.pow(eccSq,3)/1024)*Math.sin(4*latRad)
      - (35*Math.pow(eccSq,3)/3072)*Math.sin(6*latRad)
    );

    var easting = k0*N*(
        A + (1-T+C)*Math.pow(A,3)/6
      + (5-18*T+T*T+72*C-58*eccPrimeSq)*Math.pow(A,5)/120
    ) + 500000.0;

    var northing = k0*(
      M + N*Math.tan(latRad)*(
          A*A/2 + (5-T+9*C+4*C*C)*Math.pow(A,4)/24
        + (61-58*T+T*T+600*C-330*eccPrimeSq)*Math.pow(A,6)/720
      )
    );
    if(lat < 0) northing += 10000000.0; // southern hemisphere false northing

    return { zone: zone, hemi: (lat < 0 ? 'S' : 'N'), band: utmLatToBandLetter(lat), easting: easting, northing: northing };
  }

  // MGRS latitude band letter for a given decimal-degree latitude (C..X,
  // skipping I/O; each band is 8° except X which is 12°, covering -80..84).
  function utmLatToBandLetter(lat){
    if(lat < -80 || lat > 84) return null;
    if(lat === 84) return 'X';
    var idx = Math.floor((lat + 80) / 8);
    idx = Math.max(0, Math.min(UTM_BAND_LETTERS.length - 1, idx));
    return UTM_BAND_LETTERS[idx];
  }

  // ---------- Coordinate format helpers (for the Солбицол / Coordinates tab) ----------
  function fmtDD(lat, lng){
    return fmt(lat,6) + ', ' + fmt(lng,6);
  }
  function fmtDM(val, isLat){
    var neg = val < 0; val = Math.abs(val);
    var d = Math.floor(val);
    var m = (val - d) * 60;
    var dir = isLat ? (neg?'S':'N') : (neg?'W':'E');
    return d + '\u00b0' + fmt(m,3) + '\u2032' + dir;
  }
  function fmtDMS(val, isLat){
    var neg = val < 0; val = Math.abs(val);
    var totalTenthsOfSec = Math.round(val*3600*10);
    var d = Math.floor(totalTenthsOfSec / 36000);
    var remAfterDeg = totalTenthsOfSec - d*36000;
    var m = Math.floor(remAfterDeg / 600);
    var s = (remAfterDeg - m*600) / 10;
    var dir = isLat ? (neg?'S':'N') : (neg?'W':'E');
    return d+'\u00b0'+m+'\u2032'+fmt(s,1)+'\u2033'+dir;
  }
  function fmtUTM(lat, lng){
    var u = latLngToUTM(lat, lng);
    var letter = u.band || u.hemi;
    return u.zone + letter + ' ' + fmt(u.easting,2) + ', ' + fmt(u.northing,2);
  }
  function formatPoint(p, format){
    switch(format){
      case 'dm': return fmtDM(p.lat, true) + ', ' + fmtDM(p.lng, false);
      case 'dms': return fmtDMS(p.lat, true) + ', ' + fmtDMS(p.lng, false);
      case 'utm': return fmtUTM(p.lat, p.lng);
      default: return fmtDD(p.lat, p.lng);
    }
  }

  // ---------- Coordinates tab rendering ----------
  var coordsFormatSelect = document.getElementById('coordsFormatSelect');
  coordsFormatSelect.value = getSetting('coordsFormat', 'dd');
  coordsFormatSelect.addEventListener('change', function(){
    saveSetting('coordsFormat', this.value);
    renderCoordsPanel();
  });

  function renderCoordsPanel(){
    var empty = document.getElementById('coordsEmpty');
    var body = document.getElementById('coordsBody');
    var list = document.getElementById('coordsList');
    var nonEmpty = shapes.filter(function(s){ return s.points.length > 0; });

    if(nonEmpty.length === 0){
      empty.style.display = '';
      body.style.display = 'none';
      list.innerHTML = '';
      return;
    }
    empty.style.display = 'none';
    body.style.display = '';

    var format = coordsFormatSelect.value;
    var html = '';
    shapes.forEach(function(s, sIdx){
      if(s.points.length === 0) return;
      ensureLayerProps(s, sIdx);
      html += '<div class="coords-shape-group">';
      html += '  <div class="coords-shape-title"><span class="swatch" style="background:'+s.color+'"></span>'+escapeXml(s.name)+'</div>';
      s.points.forEach(function(p, i){
        html += '<div class="coords-pt-row"><span class="n">'+(i+1)+'</span><span class="val">'+formatPoint(p, format)+'</span></div>';
      });
      html += '</div>';
    });
    list.innerHTML = html;
  }

  document.getElementById('btnCopyCoords').addEventListener('click', function(){
    var format = coordsFormatSelect.value;
    var lines = [];
    shapes.forEach(function(s){
      if(s.points.length === 0) return;
      lines.push((s.name || '') + ':');
      s.points.forEach(function(p, i){
        lines.push('  ' + (i+1) + '. ' + formatPoint(p, format));
      });
    });
    var text = lines.join('\n');
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(text).then(function(){
        toast('Координатууд хууллаа');
      }).catch(function(){
        toast('Хуулж чадсангүй');
      });
    } else {
      toast('Таны хөтөч санах ойд хуулахыг дэмжихгүй байна');
    }
  });

  // ---------- Search: coordinates or place name (geocoding) ----------
  var searchWrap = document.getElementById('searchWrap');
  var searchInput = document.getElementById('searchInput');
  var searchClearBtn = document.getElementById('searchClearBtn');
  var searchResultsEl = document.getElementById('searchResults');
  var searchMarker = null;
  var searchDebounceTimer = null;
  var searchAbortController = null;
  var searchIconPin = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/></svg>';
  var searchIconPin2 = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
  var searchIconLicense = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="13" y2="17"/></svg>';

  function showUtmSearchHint(){
    searchResultsEl.innerHTML = '<div class="search-empty-row">' + escapeXml(UTM_FORMAT_HELP) + '</div>';
    openSearchResults();
  }
  function openSearchResults(){ searchResultsEl.classList.add('open'); }
  function closeSearchResults(){ searchResultsEl.classList.remove('open'); }

  function placeSearchMarker(lat, lng, label){
    if(searchMarker) map.removeLayer(searchMarker);
    searchMarker = L.marker([lat, lng], {
      icon: L.divIcon({
        html: '<div style="width:30px;height:30px;display:flex;align-items:center;justify-content:center;color:#ff7a3d;filter:drop-shadow(0 2px 5px rgba(0,0,0,0.6))">'+searchIconPin+'</div>',
        className:'', iconSize:[30,30], iconAnchor:[15,28]
      })
    }).addTo(map);
    if(label) searchMarker.bindPopup(escapeXml(label)).openPopup();
  }

  // Try to interpret the raw search text as a coordinate pair (any of the
  // formats the text-mode parser already understands: decimal degrees, DMS,
  // DM, with/without N/S/E/W letters, or UTM zone+hemisphere+easting/northing).
  function tryParseCoordinateSearch(text){
    text = text.trim();
    if(!text) return null;
    var utm = parseUTMDetailed(text);
    if(utm && utm.ok){
      return { lat: utm.lat, lng: utm.lng, label: utmDescribe(utm), utm: true, note: utmNote(utm), alts: utm.alternatives || [] };
    }
    var fields = splitFields(text);
    var fA = parseDegField(fields[0]);
    var fB = parseDegField(fields[1]);
    if(fA && fB){
      var lat, lng;
      var latField = (fA.dir === 'N' || fA.dir === 'S') ? fA : (fB.dir === 'N' || fB.dir === 'S') ? fB : null;
      var lngField = (fA.dir === 'E' || fA.dir === 'W') ? fA : (fB.dir === 'E' || fB.dir === 'W') ? fB : null;
      if(latField && lngField){
        lat = latField.value; lng = lngField.value;
      } else {
        lat = lngLatOrder ? fB.value : fA.value;
        lng = lngLatOrder ? fA.value : fB.value;
      }
      if(lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180){
        return { lat: lat, lng: lng, label: fmtDD(lat, lng) };
      }
    }
    return null;
  }

  // Search the locally-loaded MRPAM (mining license) data by its own
  // attributes — name, code, holder, aimag/soum, type, status — so a person
  // can jump straight to a license the same way they'd search a place name.
  // Purely local/synchronous: no network round trip, so results can appear
  // immediately alongside the coordinate check, before Nominatim responds.
  var MRPAM_SEARCH_MAX = 8;
  function searchMrpamFeatures(query){
    if(!mrpamFeatures || mrpamFeatures.length === 0) return [];
    var q = query.trim().toLowerCase();
    if(!q) return [];
    var out = [];
    for(var i=0; i<mrpamFeatures.length && out.length < MRPAM_SEARCH_MAX; i++){
      var f = mrpamFeatures[i];
      var p = f.properties || {};
      var haystack = [p.name, p.code, p.holder, p.aimag, p.soum, p.type, p.status]
        .filter(function(v){ return v !== undefined && v !== null && v !== ''; })
        .join(' ').toLowerCase();
      if(haystack.indexOf(q) === -1) continue;

      var bbox = f.bbox; // [minLon, minLat, maxLon, maxLat]
      var lat = (bbox[1] + bbox[3]) / 2, lng = (bbox[0] + bbox[2]) / 2;
      var subParts = [p.code, p.type, p.status, [p.aimag, p.soum].filter(Boolean).join(' / '), p.holder]
        .filter(Boolean);
      out.push({
        lat: lat, lng: lng, bbox: bbox,
        main: p.name || p.code || 'Лиценз',
        sub: subParts.join(' · '),
        kind: 'license'
      });
    }
    return out;
  }

  function renderSearchResults(items, isCoord){
    if(items.length === 0){
      searchResultsEl.innerHTML = '<div class="search-empty-row">Илэрц олдсонгүй</div>';
      openSearchResults();
      return;
    }
    var html = '';
    items.forEach(function(item, i){
      var icon = item.kind === 'license' ? searchIconLicense : (isCoord || item.kind === 'coord') ? searchIconPin2 : searchIconPin;
      html += '<div class="search-result-row" data-idx="'+i+'">';
      html += icon;
      html += '<div><div class="search-result-main">'+escapeXml(item.main)+'</div>';
      if(item.sub) html += '<div class="search-result-sub">'+escapeXml(item.sub)+'</div>';
      html += '</div></div>';
    });
    searchResultsEl.innerHTML = html;
    openSearchResults();
    searchResultsEl.querySelectorAll('.search-result-row').forEach(function(row){
      row.addEventListener('click', function(){
        var idx = parseInt(row.getAttribute('data-idx'), 10);
        var item = items[idx];
        if(item.kind === 'license' && mrpamLoaded && !mrpamVisible){
          // Jumping to a license result is only useful if the license layer
          // is actually turned on, so switch it on automatically.
          mrpamVisible = true;
          mrpamBtn.classList.add('active');
          mrpamLayerGroup.addTo(map);
          idbSet(MRPAM_ENABLED_KEY, true).catch(function(){});
        }
        if(item.bbox){
          // License features can be large polygons — fit to their extent
          // instead of just centering, so the whole boundary is visible.
          // The existing moveend/zoomend listener refreshes the MRPAM
          // overlay once this animation settles.
          var b = item.bbox;
          map.fitBounds(L.latLngBounds([[b[1], b[0]], [b[3], b[2]]]), { padding:[60,60], maxZoom:16 });
        } else {
          map.setView([item.lat, item.lng], item.zoom || 16);
        }
        placeSearchMarker(item.lat, item.lng, item.main);
        closeSearchResults();
      });
    });
  }

  // Free geocoding via OpenStreetMap's Nominatim public API (no API key
  // required; usage-policy: identify the app via a custom header isn't
  // possible from the browser, so we rely on the default anonymous quota,
  // fine for occasional interactive lookups).
  // `prefixItems` (e.g. MRPAM license matches found instantly, offline) are
  // shown right away and kept in place above the Nominatim results once
  // those arrive, instead of being replaced by them.
  function geocodeSearch(query, prefixItems){
    prefixItems = prefixItems || [];
    if(searchAbortController) searchAbortController.abort();
    searchAbortController = new AbortController();
    if(prefixItems.length){
      renderSearchResults(prefixItems, false);
    } else {
      searchResultsEl.innerHTML = '<div class="search-empty-row">Хайж байна…</div>';
      openSearchResults();
    }
    var url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&accept-language=mn&q=' + encodeURIComponent(query);
    fetch(url, { signal: searchAbortController.signal, headers: { 'Accept':'application/json' } })
      .then(function(r){ return r.json(); })
      .then(function(data){
        var items = (data || []).map(function(d){
          return {
            lat: parseFloat(d.lat), lng: parseFloat(d.lon),
            main: d.display_name.split(',')[0],
            sub: d.display_name,
            zoom: d.type === 'city' || d.type === 'administrative' ? 11 : 15
          };
        });
        renderSearchResults(prefixItems.concat(items), false);
      })
      .catch(function(err){
        if(err && err.name === 'AbortError') return;
        if(prefixItems.length){
          renderSearchResults(prefixItems, false);
        } else {
          searchResultsEl.innerHTML = '<div class="search-empty-row">Хайлт амжилтгүй боллоо (сүлжээгээ шалгана уу)</div>';
          openSearchResults();
        }
      });
  }

  searchInput.addEventListener('input', function(){
    var text = this.value;
    searchWrap.classList.toggle('has-text', text.length > 0);
    clearTimeout(searchDebounceTimer);
    if(!text.trim()){ closeSearchResults(); return; }

    // A parseable coordinate pair takes priority and shows instantly —
    // no need to wait on a network round trip for something we can already
    // read from the text.
    var coord = tryParseCoordinateSearch(text);
    if(coord){
      var sub = coord.utm ? ('UTM координат' + (coord.note ? ' · ' + coord.note : '')) : 'Координат';
      var coordItems = [{ lat:coord.lat, lng:coord.lng, main: coord.label, sub:sub, zoom:16, kind:'coord' }];
      // No zone was given: the same numbers exist in every zone, so the neighbouring
      // zones' positions are listed too — pick the one that is really meant.
      (coord.alts || []).forEach(function(a){
        coordItems.push({ lat:a.lat, lng:a.lng, main: utmDescribe(a), sub:'UTM координат · өөр бүс бол үүнийг сонгоно уу', zoom:16, kind:'coord' });
      });
      renderSearchResults(coordItems, true);
      return;
    }

    // MRPAM license matches are local/instant, so show them immediately
    // while the place-name search (network) is still debouncing.
    var licenseItems = searchMrpamFeatures(text);
    if(licenseItems.length) renderSearchResults(licenseItems, false);
    else if(utmInputLooksLike(text)){
      // Looks like an attempt at UTM that didn't read: say how to write it
      // rather than sending numbers off to the place-name search.
      showUtmSearchHint();
      return;
    }

    searchDebounceTimer = setTimeout(function(){
      if(text.trim().length >= 3) geocodeSearch(text.trim(), licenseItems);
    }, 500);
  });

  searchInput.addEventListener('keydown', function(e){
    if(e.key === 'Enter'){
      e.preventDefault();
      var text = this.value.trim();
      if(!text) return;
      var coord = tryParseCoordinateSearch(text);
      if(coord){
        map.setView([coord.lat, coord.lng], 16);
        placeSearchMarker(coord.lat, coord.lng, coord.label);
        closeSearchResults();
        if(coord.note) toast('UTM: ' + coord.note);
      } else if(utmInputLooksLike(text) && !searchMrpamFeatures(text).length){
        showUtmSearchHint();
      } else if(text.length >= 2){
        clearTimeout(searchDebounceTimer);
        geocodeSearch(text, searchMrpamFeatures(text));
      }
    } else if(e.key === 'Escape'){
      this.blur();
      closeSearchResults();
    }
  });

  searchClearBtn.addEventListener('click', function(){
    searchInput.value = '';
    searchWrap.classList.remove('has-text');
    closeSearchResults();
    searchInput.focus();
  });

  searchInput.addEventListener('focus', function(){
    if(this.value.trim() && searchResultsEl.innerHTML) openSearchResults();
  });

  document.addEventListener('click', function(e){
    if(!searchWrap.contains(e.target)) closeSearchResults();
  });

  // One line of the coordinate box -> a point, or the reason it isn't one.
  //   {ok:true, lat, lng, utm}   a coordinate (utm = the UTM details, when it was UTM)
  //   {ok:false, kind:'text'}    not a coordinate at all (a name, a note, ...)
  //   {ok:false, kind:'utm'|'range'}  reads like a coordinate but the values are unusable
  function readCoordLine(line){
    var u = parseUTMDetailed(line), lat, lng;
    if(u){
      if(!u.ok) return { ok:false, kind:'utm' };
      lat = u.lat; lng = u.lng;
    } else {
      // Cyrillic text is a label, never a coordinate (this also keeps a name such as
      // "Хашаа 1, 2-р хэсэг" from being read as lat 1, lng 2).
      if(/[\u0400-\u04FF]/.test(line)) return { ok:false, kind:'text' };
      var fields = splitFields(line);
      var fA = parseDegField(fields[0]);
      var fB = parseDegField(fields[1]);
      if(!fA || !fB) return { ok:false, kind:'text' };
      var latField = (fA.dir === 'N' || fA.dir === 'S') ? fA : (fB.dir === 'N' || fB.dir === 'S') ? fB : null;
      var lngField = (fA.dir === 'E' || fA.dir === 'W') ? fA : (fB.dir === 'E' || fB.dir === 'W') ? fB : null;
      if(latField && lngField){
        lat = latField.value; lng = lngField.value;
      } else {
        lat = lngLatOrder ? fB.value : fA.value;
        lng = lngLatOrder ? fA.value : fB.value;
      }
    }
    if(lat < -90 || lat > 90 || lng < -180 || lng > 180) return { ok:false, kind:'range' };
    return { ok:true, lat:lat, lng:lng, utm:u };
  }
  // The first line of a block may be a name instead of a coordinate: any line that
  // is not a coordinate and has at least one letter besides a hemisphere's N/S/E/W
  // ("Байшингийн зүүн хашаа", "худаг 1"). A line that is only numbers with a stray
  // N or E is far more likely a mistyped coordinate, so it stays an error.
  function isNameLine(line){
    return /[A-Za-z\u0400-\u04FF]/.test(line.replace(/[NSEWnsew]/g, ''));
  }

  // Parse the whole textarea into multiple shapes: blocks separated by one or
  // more blank lines become separate shapes. Within a block, 1 coordinate -> point,
  // 2 -> line, 3+ -> polygon. If a block's FIRST line is not a coordinate it is used
  // as that shape's name (shown in the legend and the layer list); without such a
  // line the shape gets the usual automatic name (Цэг / Шугам / Полигон + number).
  function parseMultiShapes(text){
    var blocks = text.split(/\n\s*\n+/).map(function(b){return b.trim();}).filter(Boolean);
    var parsedShapes = [];
    var errors = [];
    var assumedZones = {}, swappedCount = 0;
    blocks.forEach(function(block, bIdx){
      var lines = block.split('\n').map(function(l){return l.trim();}).filter(Boolean);
      var pts = [], name = null;
      lines.forEach(function(line, lIdx){
        var r = readCoordLine(line);
        var where = 'Дүрс '+(bIdx+1)+', мөр '+(lIdx+1)+': ';
        if(!r.ok){
          if(lIdx === 0 && r.kind === 'text' && isNameLine(line)){
            name = line.replace(/\s+/g, ' ').trim().slice(0, 80);
            return;
          }
          if(r.kind === 'utm') errors.push(where + 'UTM утга буруу — Easting 6 оронтой, Northing 7 оронтой байх ёстой ("'+line+'")');
          else if(r.kind === 'range') errors.push(where + 'утга хязгаараас гарсан ("'+line+'")');
          else errors.push(where + 'координат таньж чадсангүй ("'+line+'")' + (utmInputLooksLike(line) ? ' — ' + UTM_FORMAT_HELP : ''));
          return;
        }
        if(r.utm){
          if(r.utm.zoneAssumed){ var zk = r.utm.zone + r.utm.hemi; assumedZones[zk] = (assumedZones[zk] || 0) + 1; }
          if(r.utm.swapped) swappedCount++;
        }
        pts.push({ lat:r.lat, lng:r.lng });
      });
      if(pts.length > 0){
        var shape = { points: pts };
        if(name) shape.name = name;
        parsedShapes.push(shape);
      } else if(name){
        errors.push('Дүрс '+(bIdx+1)+': «'+name+'» нэрийн дараа координат олдсонгүй');
      }
    });
    // What was guessed on the person's behalf, so it is never silent.
    var notes = [];
    Object.keys(assumedZones).forEach(function(zk){
      notes.push('UTM: бүс заагаагүй ' + assumedZones[zk] + ' мөрийг ' + zk + ' гэж үзлээ (газрын зургийн төвт хамгийн ойр бүс)');
    });
    if(swappedCount) notes.push('UTM: ' + swappedCount + ' мөрийг Northing, Easting дарааллаар таньлаа');
    return { shapes:parsedShapes, errors:errors, notes:notes };
  }

  // ---------- Persist the coordinate-entry draft across sessions ----------
  // "Тооцоолох" is what actually turns text into shapes (which are already
  // persisted). Until that button is pressed, whatever's been typed lives
  // only in the textarea — so a crash or refresh mid-entry would otherwise
  // lose it. Saved on every keystroke (debounced) and restored on load;
  // cleared once the text is successfully turned into shapes or explicitly
  // cleared, so it doesn't linger and reappear after being used.
  var COORD_DRAFT_KEY = 'talbaiHemjigchCoordDraft_v1';
  var coordInputEl = document.getElementById('coordInput');
  var persistCoordDraftDebounced = debounce(function(){
    try{
      var v = coordInputEl.value;
      if(v){ localStorage.setItem(COORD_DRAFT_KEY, v); }
      else { localStorage.removeItem(COORD_DRAFT_KEY); }
    } catch(e){ /* quota / private mode — ignore */ }
  }, 500);
  coordInputEl.addEventListener('input', persistCoordDraftDebounced);
  (function restoreCoordDraft(){
    try{
      var saved = localStorage.getItem(COORD_DRAFT_KEY);
      if(saved) coordInputEl.value = saved;
    } catch(e){}
  })();

  document.getElementById('btnCalc').addEventListener('click', function(){
    var text = document.getElementById('coordInput').value;
    var errBox = document.getElementById('textError');
    errBox.innerHTML = '';
    var parsed = parseMultiShapes(text);
    if(parsed.errors.length){
      var box = document.createElement('div');
      box.className = 'error-box';
      box.textContent = parsed.errors.join(' · ');
      errBox.appendChild(box);
    }
    if(parsed.shapes.length === 0){
      toast('Хүчинтэй координат олдсонгүй');
      return;
    }
    if(parsed.notes.length){
      var noteBox = document.createElement('div');
      noteBox.className = 'note-box';
      noteBox.textContent = parsed.notes.join(' · ');
      errBox.appendChild(noteBox);
    }
    pushUndo();
    shapes = parsed.shapes;
    tapShapeIndex = 0;
    try{ localStorage.removeItem(COORD_DRAFT_KEY); } catch(e){}
    redrawAll();
  });

  document.getElementById('btnClearText').addEventListener('click', function(){
    document.getElementById('coordInput').value = '';
    document.getElementById('textError').innerHTML = '';
    try{ localStorage.removeItem(COORD_DRAFT_KEY); } catch(e){}
    pushUndo();
    shapes = [ { points: [] } ];
    tapShapeIndex = 0;
    redrawAll();
  });


  // initial state
  redrawAll();
  if(shapes.some(function(s){ return s.points.length > 0; })){
    toast('Өмнөх зурсан дүрс сэргээгдлээ');
  }
