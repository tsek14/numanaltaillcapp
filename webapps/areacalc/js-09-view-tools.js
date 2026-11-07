  // ---------- View tools: hide the title/search, zoom to a drawn box ----------

  // ---- Show / hide the app title and the search box (⋮ menu) ----
  var headerToggleBtn = document.getElementById('headerToggleBtn');
  var headerShown = getSetting('headerShown', true);
  function applyHeaderShown(){
    document.body.classList.toggle('header-hidden', !headerShown);
    headerToggleBtn.classList.toggle('active', headerShown);
    headerToggleBtn.textContent = headerShown ? 'Асаалттай' : 'Асаах';
    map.invalidateSize();
  }
  headerToggleBtn.addEventListener('click', function(){
    headerShown = !headerShown;
    saveSetting('headerShown', headerShown);
    applyHeaderShown();
  });
  applyHeaderShown();

  // ---- Zoom to a box drawn with the mouse or a finger ----
  // While on, a press-and-drag on the map draws a rectangle instead of
  // panning; releasing zooms the map to it. The listeners run in the capture
  // phase on the map container, so Leaflet (and tap-draw clicks) never see
  // these pointer events.
  var boxZoomBtn = document.getElementById('boxZoomBtn');
  var mapEl = map.getContainer();
  var boxZoomOn = false, boxStart = null, boxEl = null, boxPointer = null, swallowClick = false;

  function setBoxZoom(on){
    boxZoomOn = on;
    if(on) map.dragging.disable(); else map.dragging.enable();
    boxZoomBtn.classList.toggle('active', on);
    mapEl.classList.toggle('box-zoom-on', on);
    if(on){
      if(typeof tapDrawActive !== 'undefined' && tapDrawActive) stopTapDraw();
      if(typeof measureActive !== 'undefined' && measureActive) stopMeasuring();
      toast('Томруулах талбайг газрын зураг дээр чирж зурна уу');
    } else {
      endBox();
    }
  }
  function endBox(){
    boxStart = null; boxPointer = null;
    if(boxEl){ boxEl.remove(); boxEl = null; }
  }
  function localPoint(e){
    var r = mapEl.getBoundingClientRect();
    return L.point(e.clientX - r.left, e.clientY - r.top);
  }
  function drawBox(p){
    var x = Math.min(boxStart.x, p.x), y = Math.min(boxStart.y, p.y);
    boxEl.style.left = x + 'px'; boxEl.style.top = y + 'px';
    boxEl.style.width = Math.abs(p.x - boxStart.x) + 'px';
    boxEl.style.height = Math.abs(p.y - boxStart.y) + 'px';
  }

  mapEl.addEventListener('pointerdown', function(e){
    if(!boxZoomOn || e.button > 0) return;
    // Leave the zoom buttons and other map controls working.
    if(e.target.closest && e.target.closest('.leaflet-control')) return;
    e.stopPropagation(); e.preventDefault();
    boxStart = localPoint(e); boxPointer = e.pointerId;
    boxEl = document.createElement('div');
    boxEl.className = 'box-zoom-rect';
    mapEl.appendChild(boxEl);
    drawBox(boxStart);
    try{ mapEl.setPointerCapture(e.pointerId); } catch(err){}
  }, true);
  mapEl.addEventListener('pointermove', function(e){
    if(!boxZoomOn || !boxStart || e.pointerId !== boxPointer) return;
    e.stopPropagation(); e.preventDefault();
    drawBox(localPoint(e));
  }, true);
  function finishBox(e){
    if(!boxZoomOn || !boxStart || e.pointerId !== boxPointer) return;
    e.stopPropagation(); e.preventDefault();
    var p = localPoint(e), a = boxStart;
    endBox();
    swallowClick = true;
    setTimeout(function(){ swallowClick = false; }, 400);
    if(Math.abs(p.x - a.x) < 8 || Math.abs(p.y - a.y) < 8) return; // a tap, not a box: keep waiting
    var bounds = L.latLngBounds(map.containerPointToLatLng(a), map.containerPointToLatLng(p));
    // Fill the part of the map you can see: on phones the bottom panel
    // covers the lower part of the map, so leave that out.
    var mr = mapEl.getBoundingClientRect(), padB = 0;
    var sheet = document.getElementById('sheet');
    if(sheet && sheet.offsetParent !== null){
      var sr = sheet.getBoundingClientRect();
      if(sr.left <= mr.left + 10 && sr.right >= mr.right - 10 && sr.top < mr.bottom) padB = Math.max(0, mr.bottom - sr.top);
    }
    map.fitBounds(bounds, { paddingTopLeft:[0, 0], paddingBottomRight:[0, padB] });
    setBoxZoom(false);
  }
  mapEl.addEventListener('pointerup', finishBox, true);
  mapEl.addEventListener('pointercancel', function(e){ if(boxStart && e.pointerId === boxPointer) endBox(); }, true);
  // The click that follows the drag must not reach Leaflet (tap-draw etc.).
  mapEl.addEventListener('click', function(e){
    if(boxZoomOn || swallowClick){
      if(e.target.closest && e.target.closest('.leaflet-control')) return;
      e.stopPropagation();
    }
  }, true);

  boxZoomBtn.addEventListener('click', function(){ setBoxZoom(!boxZoomOn); });
  document.addEventListener('keydown', function(e){ if(e.key === 'Escape' && boxZoomOn) setBoxZoom(false); });
