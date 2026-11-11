  // ---------- Edit the vertices of a drawn or imported shape ----------
  // Started from the pencil button on a shape's card (or a batch's card, then
  // a tap on the member to edit). While editing:
  //   - drag a vertex to move it
  //   - tap a vertex to delete it
  //   - tap or drag the small "+" handle in the middle of an edge to add one
  // Holes are edited the same way. Every change is one undo step. Big
  // imported outlines can have tens of thousands of vertices, so handles are
  // only made for the part in view, and only when few enough fit on screen.

  var EDIT_MAX_HANDLES = 300;
  var editShape = null;       // the shape object being edited
  var editIdx = -1;           // its index, to find it again after an undo
  var editEid = null;         // tag put on the shape while it is edited
  var editPicking = false;    // waiting for a tap on the shape to edit
  var editLayer = L.layerGroup().addTo(map);
  var editBar = document.getElementById('editBar');
  var editBarText = document.getElementById('editBarText');

  function editRings(shape){ return [shape.points].concat(shape.holes || []); }
  function editIsClosed(shape){ return shapeKind(shape) === 'polygon'; }

  function editHandleIcon(color, mid){
    return L.divIcon({
      html: mid ? '<div class="edit-mid">+</div>' : '<div class="edit-vtx" style="border-color:'+color+'"></div>',
      className:'', iconSize:[26,26], iconAnchor:[13,13]
    });
  }

  function setEditBar(text){
    editBarText.textContent = text;
    editBar.classList.add('show');
  }

  function startShapeEdit(idx){
    var s = shapes[idx];
    if(!s || s.points.length === 0) return;
    if(trackActive && idx === trackShapeIndex){ toast('Идэвхтэй GPS замыг эхлээд зогсооно уу'); return; }
    if(tapDrawActive) stopTapDraw();
    if(typeof measureActive !== 'undefined' && measureActive) stopMeasuring();
    if(s.visible === false) s.visible = true;
    if(editShape) delete editShape._eid;
    editShape = s; editIdx = idx; editPicking = false;
    s._eid = editEid = Date.now() + ':' + Math.random().toString(36).slice(2, 7); // survives undo copies
    shapeEditActive = true;
    map.off('click', editMapClick); map.on('click', editMapClick);
    map.off('moveend', refreshEditHandles); map.on('moveend', refreshEditHandles);
    collapseSheetForMap();
    redrawAll({ noFit:true });
    // Bring the shape into view if none of it is on screen.
    var b = L.latLngBounds(s.points.map(function(p){ return [p.lat, p.lng]; }));
    if(!map.getBounds().intersects(b)) map.fitBounds(b, { padding:[60,60], maxZoom:18 });
  }

  // Batch cards: the person taps the member they want to edit.
  function startShapeEditPick(){
    if(tapDrawActive) stopTapDraw();
    if(typeof measureActive !== 'undefined' && measureActive) stopMeasuring();
    if(editShape) delete editShape._eid;
    editShape = null; editIdx = -1; editPicking = true;
    shapeEditActive = true;
    map.off('click', editMapClick); map.on('click', editMapClick);
    map.off('moveend', refreshEditHandles); map.on('moveend', refreshEditHandles);
    collapseSheetForMap();
    map.getContainer().style.cursor = 'pointer';
    editLayer.clearLayers();
    setEditBar('Засах дүрсээ газрын зураг дээр товшино уу');
  }

  function stopShapeEdit(){
    if(!shapeEditActive) return;
    if(editShape) delete editShape._eid;
    shapeEditActive = false; editShape = null; editIdx = -1; editPicking = false;
    map.off('click', editMapClick);
    map.off('moveend', refreshEditHandles);
    map.getContainer().style.cursor = '';
    editLayer.clearLayers();
    editBar.classList.remove('show');
    redrawAll({ noFit:true });
  }

  // Which shape is under a tap: the smallest polygon containing it, else a
  // line or point within a few pixels.
  function editPointInRing(lat, lng, pts){
    var inside = false;
    for(var i=0, j=pts.length-1; i<pts.length; j=i++){
      var a = pts[i], b = pts[j];
      if((a.lat > lat) !== (b.lat > lat) && lng < (b.lng - a.lng) * (lat - a.lat) / (b.lat - a.lat) + a.lng) inside = !inside;
    }
    return inside;
  }
  function editShapeAt(latlng){
    var best = -1, bestArea = Infinity, lat = latlng.lat, lng = latlng.lng;
    shapes.forEach(function(s, i){
      if(s.visible === false || s.points.length < 3 || shapeKind(s) !== 'polygon') return;
      if(!editPointInRing(lat, lng, s.points)) return;
      if((s.holes || []).some(function(h){ return editPointInRing(lat, lng, h); })) return;
      var a = shapeAreaM2(s);
      if(a < bestArea){ bestArea = a; best = i; }
    });
    if(best >= 0) return best;
    var p = map.latLngToContainerPoint(latlng), bestD = 12;
    shapes.forEach(function(s, i){
      if(s.visible === false || s.points.length === 0 || shapeKind(s) === 'polygon') return;
      for(var k=0;k<s.points.length;k++){
        var a = map.latLngToContainerPoint([s.points[k].lat, s.points[k].lng]);
        var d = s.points.length === 1 || k === s.points.length - 1 ? p.distanceTo(a)
          : L.LineUtil.pointToSegmentDistance(p, a, map.latLngToContainerPoint([s.points[k+1].lat, s.points[k+1].lng]));
        if(d < bestD){ bestD = d; best = i; }
      }
    });
    return best;
  }
  function editMapClick(e){
    var i = editShapeAt(e.latlng);
    if(i < 0 || shapes[i] === editShape) return;
    map.getContainer().style.cursor = '';
    startShapeEdit(i);
  }

  // Rebuilds the outline and the handles of the shape being edited. Called
  // after every redraw and whenever the map stops moving.
  function refreshEditHandles(){
    if(!shapeEditActive) return;
    editLayer.clearLayers();
    if(editPicking) return;
    // After an undo/redo the shapes are fresh copies: find ours again by its tag.
    var idx = shapes.indexOf(editShape);
    if(idx < 0){
      for(var q=0;q<shapes.length;q++){ if(shapes[q]._eid === editEid){ idx = q; break; } }
      if(idx < 0){ editShape = null; stopShapeEdit(); return; } // deleted, or undone to before the edit began
      editShape = shapes[idx];
    }
    editIdx = idx;
    var s = editShape, closed = editIsClosed(s), color = s.color || '#35d9b0';
    if(s.points.length === 0){ stopShapeEdit(); return; }

    var rings = editRings(s);
    rings.forEach(function(ring){
      var ll = ring.map(function(p){ return [p.lat, p.lng]; });
      if(closed && ll.length) ll.push(ll[0]);
      if(ll.length > 1){
        L.polyline(ll, { color:'#ffffff', weight:5, opacity:0.9, interactive:false, smoothFactor:0.5 }).addTo(editLayer);
        L.polyline(ll, { color:color, weight:2.5, opacity:1, interactive:false, smoothFactor:0.5 }).addTo(editLayer);
      }
    });

    var view = map.getBounds().pad(0.05), inView = [], total = 0;
    rings.forEach(function(ring, r){
      total += ring.length;
      for(var k=0;k<ring.length;k++){
        if(view.contains([ring[k].lat, ring[k].lng])) inView.push([r, k]);
      }
    });
    var kindWord = closed ? 'полигон' : (shapeKind(s) === 'line' ? 'шугам' : 'цэг');
    var label = '✎ ' + (s.name || kindWord) + ' — ';
    if(inView.length > EDIT_MAX_HANDLES){
      setEditBar(label + 'оройг засахын тулд ойртуулна уу (харагдах хэсэгт ' + inView.length + ' орой)');
      return;
    }
    setEditBar(label + 'оройг чирж зөөнө, товшиж устгана, + дээр товшиж нэмнэ');

    var preview = null;
    function ringOf(r){ return r === 0 ? s.points : s.holes[r - 1]; }
    function neighbours(ring, k){
      var n = ring.length, out = [];
      if(closed || k > 0) out.push(ring[(k + n - 1) % n]);
      if(closed || k < n - 1) out.push(ring[(k + 1) % n]);
      return out;
    }
    function showPreview(nb, ll){
      var path = nb.length === 2 ? [[nb[0].lat, nb[0].lng], ll, [nb[1].lat, nb[1].lng]]
               : nb.length === 1 ? [[nb[0].lat, nb[0].lng], ll] : [ll];
      if(!preview) preview = L.polyline(path, { color:color, weight:2, dashArray:'5 5', interactive:false }).addTo(editLayer);
      else preview.setLatLngs(path);
    }

    inView.forEach(function(rk){
      var ring = ringOf(rk[0]), k = rk[1], pt = ring[k];
      var mk = L.marker([pt.lat, pt.lng], { icon: editHandleIcon(color, false), draggable:true, zIndexOffset:1000, bubblingMouseEvents:false }).addTo(editLayer);
      mk.on('dragstart', function(){ pushUndo(); });
      mk.on('drag', function(){ var ll = mk.getLatLng(); showPreview(neighbours(ring, k), [ll.lat, ll.lng]); });
      mk.on('dragend', function(){
        var ll = mk.getLatLng();
        pt.lat = ll.lat; pt.lng = ll.lng;
        redrawAll({ noFit:true });
      });
      mk.on('click', function(){ editDeleteVertex(rk[0], k); });
    });

    // "+" handles: only on edges long enough on screen to aim at.
    rings.forEach(function(ring, r){
      var n = ring.length, last = closed ? n : n - 1;
      if(n < 2) return;
      for(var k=0;k<last;k++){
        var a = ring[k], b = ring[(k + 1) % n];
        var mid = [(a.lat + b.lat) / 2, (a.lng + b.lng) / 2];
        if(!view.contains(mid)) continue;
        if(map.latLngToContainerPoint([a.lat, a.lng]).distanceTo(map.latLngToContainerPoint([b.lat, b.lng])) < 44) continue;
        (function(r, k, a, b, mid){
          var mm = L.marker(mid, { icon: editHandleIcon(color, true), draggable:true, zIndexOffset:900, bubblingMouseEvents:false }).addTo(editLayer);
          var added = null;
          function insert(ll){
            pushUndo();
            added = { lat: ll[0], lng: ll[1] };
            ringOf(r).splice(k + 1, 0, added);
          }
          mm.on('dragstart', function(){ insert(mid); });
          mm.on('drag', function(){ var ll = mm.getLatLng(); showPreview([a, b], [ll.lat, ll.lng]); });
          mm.on('dragend', function(){
            var ll = mm.getLatLng();
            added.lat = ll.lat; added.lng = ll.lng;
            redrawAll({ noFit:true });
          });
          mm.on('click', function(){ insert(mid); redrawAll({ noFit:true }); });
        })(r, k, a, b, mid);
      }
    });
  }

  function editDeleteVertex(r, k){
    var s = editShape;
    if(!s) return;
    var isHole = r > 0, ring = isHole ? s.holes[r - 1] : s.points;
    if(!isHole){
      var min = editIsClosed(s) ? 3 : (shapeKind(s) === 'line' ? 2 : 1);
      if(ring.length <= min){
        toast(min === 3 ? 'Полигон дор хаяж 3 оройтой байх ёстой' : min === 2 ? 'Шугам дор хаяж 2 цэгтэй байх ёстой' : 'Сүүлчийн цэгийг устгах боломжгүй — дүрсийг устгана уу');
        return;
      }
    }
    pushUndo();
    if(isHole && ring.length <= 3){
      s.holes.splice(r - 1, 1);
      if(!s.holes.length) delete s.holes;
      toast('Цоорхой устгагдлаа');
    } else {
      ring.splice(k, 1);
    }
    redrawAll({ noFit:true });
  }

  document.getElementById('editBarDone').addEventListener('click', stopShapeEdit);
  document.addEventListener('keydown', function(e){
    var tag = (e.target && e.target.tagName || '').toLowerCase();
    if(e.key === 'Escape' && shapeEditActive && tag !== 'input' && tag !== 'textarea') stopShapeEdit();
  });
