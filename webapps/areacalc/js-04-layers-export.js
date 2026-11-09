  // ---------- Draw / recompute (multi-shape) ----------
  // opts.noFit: redraw without zooming the map to the shapes (used when the
  // person is looking somewhere on purpose, e.g. right after stopping a GPS track).
  // Polygons default to "fill only" (corner points and outline hidden) —
  // undefined means hidden for them. Lines keep both shown by default, since
  // a line with nothing drawn would simply vanish.
  function shapeShowsVertices(s){
    // Imported batches and lines can have thousands of points: their vertex
    // markers start hidden (the «Цэгүүд» toggle shows them).
    if((s.batchId || s.isLine) && s.showVertices === undefined) return false;
    return shapeKind(s) === 'polygon' ? s.showVertices === true : s.showVertices !== false;
  }

  // ---------- Batches ----------
  // An imported file with several shapes becomes one batch: its shapes carry
  // the same batchId / batchName. The panels show a batch as one entry, and
  // show/hide, colour, opacity, export, split and delete act on all of it.
  // Batch shapes are drawn on one shared canvas, which is much faster than
  // one SVG element each when a file holds hundreds of polygons.
  var batchRenderer = L.canvas({ padding: 0.5 });
  function newBatchId(){ return 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function batchIdxs(id){
    var out = [];
    shapes.forEach(function(s, i){ if(s.batchId === id && s.points.length > 0) out.push(i); });
    return out;
  }
  // What the panels list: single shapes, plus one entry per batch at the
  // position of its first shape.
  function displayEntries(){
    var out = [], seen = {};
    shapes.forEach(function(s, i){
      if(s.points.length === 0) return;
      if(s.batchId){
        if(seen[s.batchId]){ seen[s.batchId].idxs.push(i); return; }
        var e = { batch:true, id:s.batchId, name:s.batchName || 'Багц', idxs:[i] };
        seen[s.batchId] = e;
        out.push(e);
      } else {
        out.push({ batch:false, idx:i, shape:s });
      }
    });
    return out;
  }
  function batchStats(idxs){
    var st = { poly:0, line:0, point:0, area:0, len:0, per:0, pts:0 };
    idxs.forEach(function(i){
      var s = shapes[i], k = shapeKind(s);
      st.pts += s.points.length;
      if(k === 'polygon'){ st.poly++; st.area += shownAreaSqMeters(i); st.per += perimeterMeters(s.points); }
      else if(k === 'line'){ st.line++; st.len += pathLengthMeters(s.points); }
      else if(k === 'point') st.point++;
    });
    if(st.poly){ var na = batchNetArea(idxs); st.full = na.full; st.net = na.net; }
    return st;
  }
  function batchKindText(st){
    var p = [];
    if(st.poly) p.push(st.poly + ' полигон');
    if(st.line) p.push(st.line + ' шугам');
    if(st.point) p.push(st.point + ' цэг');
    return p.join(' · ');
  }
  // Removes the shapes at the given indexes, keeping the tap/GPS targets
  // pointing at the same shapes (or at a fresh empty shape if theirs went).
  function replaceShapes(newShapes){
    var tapShape = shapes[tapShapeIndex];
    var trackShape = (trackActive && trackShapeIndex !== null) ? shapes[trackShapeIndex] : null;
    shapes = newShapes.length ? newShapes : [ { points: [] } ];
    tapShapeIndex = shapes.indexOf(tapShape);
    if(tapShapeIndex < 0){ shapes.push({ points: [] }); tapShapeIndex = shapes.length - 1; }
    if(trackShape) trackShapeIndex = shapes.indexOf(trackShape);
  }
  function deleteBatch(id){
    var idxs = batchIdxs(id);
    if(!idxs.length) return;
    var name = shapes[idxs[0]].batchName;
    pushUndo();
    replaceShapes(shapes.filter(function(s){ return s.batchId !== id; }));
    redrawAll({ noFit:true });
    toast('"' + name + '" багц устгагдлаа (' + idxs.length + ' дүрс)');
  }
  function ungroupBatch(id){
    var idxs = batchIdxs(id);
    if(!idxs.length) return;
    var name = shapes[idxs[0]].batchName;
    pushUndo();
    shapes.forEach(function(s){ if(s.batchId === id){ delete s.batchId; delete s.batchName; } });
    redrawAll({ noFit:true });
    toast('"' + name + '" багцыг задаллаа — ' + idxs.length + ' тусдаа дүрс');
  }
  function exportBatch(id, format){
    var idxs = batchIdxs(id);
    if(!idxs.length) return;
    var name = shapes[idxs[0]].batchName || 'Багц';
    var entries = idxs.map(function(i){ return { shape: shapes[i], colorIdx: i }; });
    var base = safeFileName(name);
    if(format === 'geojson'){
      downloadTextFile(JSON.stringify(shapesToGeoJSON(entries), null, 2), base+'.geojson', 'application/geo+json;charset=utf-8');
      toast('"'+name+'" татагдлаа (GEOJSON)');
    } else if(format === 'kml'){
      downloadTextFile(generateKML(entries), base+'.kml', 'application/vnd.google-earth.kml+xml;charset=utf-8');
      toast('"'+name+'" татагдлаа (KML)');
    } else if(format === 'gpx'){
      downloadTextFile(generateGPX(entries), base+'.gpx', 'application/gpx+xml;charset=utf-8');
      toast('"'+name+'" татагдлаа (GPX)');
    } else if(format === 'shp'){
      exportShpZip(shapesToGeoJSON(entries), shpBaseName(name, 'batch'), base, '"'+name+'" татагдлаа (SHP)');
    }
  }
  // Clips every polygon of the batch along the chosen boundaries (same
  // rules as splitting one polygon). Pieces stay in the batch; polygons that
  // lie fully outside the boundaries are removed; lines and points are kept.
  // Same three groups for a batch: the original batch is kept but hidden, and
  // two new batches hold the pieces inside the boundaries and the rest
  // (including polygons the boundaries do not touch at all).
  function splitBatchByBoundary(id, splitKey){
    var src = splitSource(splitKey), sourceFeatures = src.features;
    if(sourceFeatures.length === 0){
      toast(src.typing ? 'Идэвхтэй төрөл алга — давхаргын тохиргооноос төрлөө идэвхжүүлнэ үү' : SPLIT_LEVEL_LABEL[splitKey] + ' давхарга ачаалагдаагүй байна');
      return;
    }
    toast('Хувааж байна…');
    setTimeout(function(){
      var idxs = batchIdxs(id);
      if(!idxs.length) return;
      var first = shapes[idxs[0]], last = idxs[idxs.length - 1], name = first.batchName, color = first.color;
      var inside = [], outsideShapes = [], kept = 0, bad = 0;
      idxs.forEach(function(i){
        var s = shapes[i];
        if(shapeKind(s) !== 'polygon'){ kept++; return; }
        var r = clipShapeByBoundary(s, splitKey, sourceFeatures);
        if(r.error){ bad++; return; }
        if(!r.pieces.length){
          outsideShapes.push({ points: s.points.map(function(p){ return { lat:p.lat, lng:p.lng }; }), name: s.name,
            opacity: s.opacity, showVertices: s.showVertices, showOutline: s.showOutline, visible: true });
          return;
        }
        inside = inside.concat(r.pieces);
        outsideShapes = outsideShapes.concat(r.outside);
      });
      if(!inside.length){
        toast(SPLIT_LEVEL_LABEL[splitKey] + ' давхаргатай огтлолцсонгүй — полигон уг давхаргын хамрах хүрээнээс гадуур байж болзошгүй');
        return;
      }
      var outId = newBatchId(), oc = otherColor(color);
      var groups = batchPiecesByType(inside, name, color, src.typing);
      outsideShapes.forEach(function(p){ p.batchId = outId; p.batchName = name + ' — ' + overlapLabel(false); p.color = oc; });
      inside = [];
      groups.forEach(function(g){ inside = inside.concat(g.list); });
      pushUndo();
      idxs.forEach(function(i){ shapes[i].visible = false; });
      var out = [];
      shapes.forEach(function(s, i){
        out.push(s);
        if(i === last) out = out.concat(inside, outsideShapes);
      });
      replaceShapes(out);
      redrawAll({ noFit:true });
      var msg = '"' + name + '" → ' + groupsText(groups, outsideShapes.length) + '; анхны багц нуугдсан';
      if(kept) msg += ', ' + kept + ' шугам/цэг анхны багцад үлдлээ';
      if(bad) msg += ', ' + bad + ' полигоныг хувааж чадсангүй';
      toast(msg);
    }, 30);
  }
  function shapeShowsOutline(s){
    return shapeKind(s) === 'polygon' ? s.showOutline === true : s.showOutline !== false;
  }

  // ---- "Knock out" overlaps between polygons ----
  // When on, any area covered by two or more visible polygons gets no fill
  // from any of them, so the base map shows straight through. Each polygon's
  // fill becomes "itself minus every other polygon it overlaps" (turf
  // difference). Areas shown in the app then count only that visible part
  // (see shownAreaSqMeters); outlines, vertices and exports are unchanged. The
  // result is cached on the polygons' coordinates, so moving a slider or
  // renaming doesn't recompute it.
  var polyKnockoutOn = getSetting('polyKnockout', false);
  var knockoutCache = { sig:null, fills:null, areas:null };

  function knockoutPolygonIdxs(){
    var out = [];
    shapes.forEach(function(s, i){
      if(s.visible !== false && !s.isTrack && s.points.length >= 3 && shapeKind(s) === 'polygon') out.push(i);
    });
    return out;
  }

  // ---- Fast overlap search ----
  // Thousands of polygons (e.g. a burned area cut into pieces) made the old
  // all-pairs clip freeze the page. Now: a spatial grid finds neighbours, a
  // cheap exact test keeps only pairs whose interiors really overlap (pieces
  // that merely share an edge are skipped), and only those pairs are clipped.
  // Results are memoised on a hash of the coordinates.
  var OV_EPS = 1e-16;          // orientation tolerance (degrees²)
  var OV_TOL2 = 1e-18;         // "on the boundary" distance² (≈0.1 mm)
  var ovMemo = {}, ovMemoKeys = [];

  function geomHash(idxs){
    var h = idxs.length | 0;
    for(var a=0;a<idxs.length;a++){
      var pts = shapes[idxs[a]].points;
      h = (h * 31 + idxs[a]) | 0;
      for(var k=0;k<pts.length;k++){
        h = (h * 31 + Math.round(pts[k].lat * 1e7)) | 0;
        h = (h * 31 + Math.round(pts[k].lng * 1e7)) | 0;
      }
    }
    return h;
  }
  function ovItems(idxs){
    var out = [];
    idxs.forEach(function(i){
      var pts = shapes[i].points;
      if(pts.length < 3) return;
      var ring = new Array(pts.length + 1), w = Infinity, so = Infinity, e = -Infinity, n = -Infinity;
      for(var k=0;k<pts.length;k++){
        var x = pts[k].lng, y = pts[k].lat;
        ring[k] = [x, y];
        if(x<w) w=x; if(x>e) e=x; if(y<so) so=y; if(y>n) n=y;
      }
      ring[pts.length] = ring[0];
      out.push({ idx:i, ring:ring, bbox:[w, so, e, n] });
    });
    return out;
  }
  function ovOrient(a, b, c){ return (b[0]-a[0])*(c[1]-a[1]) - (b[1]-a[1])*(c[0]-a[0]); }
  // Segments cross through each other's interiors (touching or collinear does not count).
  function ovProperCross(p1, p2, q1, q2){
    var d1 = ovOrient(q1, q2, p1), d2 = ovOrient(q1, q2, p2);
    if(!((d1 > OV_EPS && d2 < -OV_EPS) || (d1 < -OV_EPS && d2 > OV_EPS))) return false;
    var d3 = ovOrient(p1, p2, q1), d4 = ovOrient(p1, p2, q2);
    return (d3 > OV_EPS && d4 < -OV_EPS) || (d3 < -OV_EPS && d4 > OV_EPS);
  }
  // Large outlines get an index of their edges by horizontal band, so a
  // point test or an edge search only looks at the few edges near it — one
  // big burned area surrounded by thousands of small patches used to cost
  // patches × all its vertices.
  var OV_INDEX_MIN = 65;
  function ovIndex(it){
    if(it.ix) return it.ix;
    var r = it.ring, m = r.length - 1, nb = Math.max(1, Math.min(8192, Math.ceil(m / 8)));
    var y0 = it.bbox[1], h = (it.bbox[3] - it.bbox[1]) / nb || 1e-12, bands = new Array(nb);
    for(var b=0;b<nb;b++) bands[b] = [];
    for(var k=0;k<m;k++){
      var a = r[k][1], c = r[k+1][1], lo = Math.min(a, c) - 1e-9, hi = Math.max(a, c) + 1e-9;
      var b0 = Math.max(0, Math.floor((lo - y0) / h)), b1 = Math.min(nb - 1, Math.floor((hi - y0) / h));
      for(var q=b0;q<=b1;q++) bands[q].push(k);
    }
    return (it.ix = { y0:y0, h:h, nb:nb, bands:bands });
  }
  // 1 = strictly inside the item's ring, -1 = outside, 0 = on its boundary.
  function ovPointClass(pt, it){
    var ring = it.ring, x = pt[0], y = pt[1], inside = false, list = null;
    if(ring.length > OV_INDEX_MIN){
      var ix = ovIndex(it), bi = Math.floor((y - ix.y0) / ix.h);
      if(bi < 0 || bi >= ix.nb) return -1;
      list = ix.bands[bi];
    }
    var cnt = list ? list.length : ring.length - 1;
    for(var q=0;q<cnt;q++){
      var k = list ? list[q] : q;
      var a = ring[k], b = ring[k+1], dx = b[0]-a[0], dy = b[1]-a[1], len2 = dx*dx + dy*dy;
      var t = len2 ? ((x-a[0])*dx + (y-a[1])*dy) / len2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      var ex = a[0] + t*dx - x, ey = a[1] + t*dy - y;
      if(ex*ex + ey*ey < OV_TOL2) return 0;
      if((a[1] > y) !== (b[1] > y) && x < dx * (y - a[1]) / dy + a[0]) inside = !inside;
    }
    return inside ? 1 : -1;
  }
  // 1: some vertex or edge midpoint of A is strictly inside B;
  // 0: all of them lie on B's boundary; -1: none inside, some outside.
  function ovAnyInside(A, B){
    var r = A.ring, box = B.bbox, allOn = true;
    for(var k=0;k<r.length-1;k++){
      var v = r[k], m = [(v[0]+r[k+1][0])/2, (v[1]+r[k+1][1])/2];
      for(var q=0;q<2;q++){
        var pt = q ? m : v;
        if(pt[0] < box[0] || pt[0] > box[2] || pt[1] < box[1] || pt[1] > box[3]){ allOn = false; continue; }
        var c = ovPointClass(pt, B);
        if(c === 1) return 1;
        if(c === -1) allOn = false;
      }
    }
    return allOn ? 0 : -1;
  }
  // Edges of the item's ring whose box meets `box`.
  function ovEdgesIn(it, box){
    var r = it.ring, out = [], cand = null;
    if(r.length > OV_INDEX_MIN){
      var ix = ovIndex(it), seen = {};
      var b0 = Math.max(0, Math.floor((box[1] - ix.y0) / ix.h)), b1 = Math.min(ix.nb - 1, Math.floor((box[3] - ix.y0) / ix.h));
      cand = [];
      for(var q=b0;q<=b1;q++) ix.bands[q].forEach(function(k){ if(!seen[k]){ seen[k] = 1; cand.push(k); } });
    }
    var cnt = cand ? cand.length : r.length - 1;
    for(var i=0;i<cnt;i++){
      var k = cand ? cand[i] : i, a = r[k], b = r[k+1];
      if(Math.max(a[0],b[0]) < box[0] || Math.min(a[0],b[0]) > box[2] || Math.max(a[1],b[1]) < box[1] || Math.min(a[1],b[1]) > box[3]) continue;
      out.push(k);
    }
    return out;
  }
  // Do the interiors of two polygons overlap?
  function ovRingsOverlap(A, B){
    var ea = ovEdgesIn(A, B.bbox), eb = ovEdgesIn(B, A.bbox);
    // Two big outlines crossing over a wide area: measure the intersection
    // with the clipper rather than testing edge against edge.
    if(ea.length * eb.length > 200000){
      try{
        var big = turf.intersect(turf.polygon([A.ring]), turf.polygon([B.ring]));
        return !!big && geoAreaM2(big) > 0.01;
      } catch(e){ return false; }
    }
    for(var i=0;i<ea.length;i++){
      var p1 = A.ring[ea[i]], p2 = A.ring[ea[i]+1];
      for(var j=0;j<eb.length;j++){
        if(ovProperCross(p1, p2, B.ring[eb[j]], B.ring[eb[j]+1])) return true;
      }
    }
    var a = ovAnyInside(A, B);
    if(a === 1) return true;
    var b = ovAnyInside(B, A);
    if(b === 1) return true;
    if(a === 0 || b === 0){
      // One polygon lies entirely on the other's boundary (e.g. an exact duplicate): measure it.
      try{
        var x = turf.intersect(turf.polygon([A.ring]), turf.polygon([B.ring]));
        return !!x && geoAreaM2(x) > 0.01;
      } catch(e){ return false; }
    }
    return false;
  }
  // Pairs of items (by position) whose interiors overlap, found through a spatial grid.
  function ovPairs(items){
    var n = items.length, pairs = [];
    if(n < 2) return pairs;
    var sizes = items.map(function(it){ return Math.max(it.bbox[2]-it.bbox[0], it.bbox[3]-it.bbox[1]); }).sort(function(a, b){ return a - b; });
    var cell = Math.max(sizes[n >> 1] * 2, 1e-7), grid = new Map(), big = [], seen = new Set();
    items.forEach(function(it, k){
      var x0 = Math.floor(it.bbox[0]/cell), x1 = Math.floor(it.bbox[2]/cell), y0 = Math.floor(it.bbox[1]/cell), y1 = Math.floor(it.bbox[3]/cell);
      if((x1-x0+1) * (y1-y0+1) > 256){ big.push(k); return; } // much larger than the rest: checked against everything
      for(var x=x0;x<=x1;x++) for(var y=y0;y<=y1;y++){
        var key = x + ',' + y, list = grid.get(key);
        if(list) list.push(k); else grid.set(key, [k]);
      }
    });
    function consider(a, b){
      if(a === b) return;
      var key = a < b ? a * n + b : b * n + a;
      if(seen.has(key)) return;
      seen.add(key);
      var A = items[a].bbox, B = items[b].bbox;
      // boxes must share some area, not just an edge
      if(Math.min(A[2], B[2]) - Math.max(A[0], B[0]) <= 1e-12 || Math.min(A[3], B[3]) - Math.max(A[1], B[1]) <= 1e-12) return;
      if(ovRingsOverlap(items[a], items[b])) pairs.push(a < b ? [a, b] : [b, a]);
    }
    grid.forEach(function(list){
      for(var i=0;i<list.length;i++) for(var j=i+1;j<list.length;j++) consider(list[i], list[j]);
    });
    big.forEach(function(a){ for(var b=0;b<n;b++) consider(a, b); });
    return pairs;
  }
  // For the polygons at `idxs`: { fills:{idx: geometry|'empty'}, areas:{idx: m²}, pairs:[[idx,idx]] }.
  // Only polygons that really overlap another one appear in fills/areas.
  function computeOverlapFills(idxs){
    var key = geomHash(idxs) + ':' + idxs.length;
    if(ovMemo[key]) return ovMemo[key];
    var items = ovItems(idxs), pairs = ovPairs(items), nb = {};
    pairs.forEach(function(p){ (nb[p[0]] = nb[p[0]] || []).push(p[1]); (nb[p[1]] = nb[p[1]] || []).push(p[0]); });
    var fills = {}, areas = {};
    Object.keys(nb).forEach(function(k){
      var it = items[k];
      try{
        var diff = turf.polygon([it.ring]);
        for(var j=0;j<nb[k].length;j++){
          diff = turf.difference(diff, turf.polygon([items[nb[k][j]].ring]));
          if(!diff) break; // completely covered by others
        }
        fills[it.idx] = diff ? diff.geometry : 'empty';
        areas[it.idx] = diff ? geoAreaM2(diff) : 0;
      } catch(err){ /* e.g. a self-intersecting polygon turf can't process — draw that one normally */ }
    });
    var res = { fills:fills, areas:areas, pairs: pairs.map(function(p){ return [items[p[0]].idx, items[p[1]].idx]; }) };
    ovMemo[key] = res; ovMemoKeys.push(key);
    if(ovMemoKeys.length > 30) delete ovMemo[ovMemoKeys.shift()];
    return res;
  }

  // Returns { <shapeIndex>: geometry | 'empty' } for visible polygons that
  // overlap another one; polygons missing from the map are drawn normally.
  // Computed once per redraw; areas are read from knockoutCache afterwards.
  function computeKnockoutFills(){
    var idxs = knockoutPolygonIdxs();
    if(idxs.length < 2){ knockoutCache = { sig:null, fills:null, areas:null }; return null; }
    var r = computeOverlapFills(idxs);
    knockoutCache = { sig:null, fills:r.fills, areas:r.areas, pairs:r.pairs };
    return r.fills;
  }

  // Area of a polygon as shown on the map: with "cut out overlaps" on, only the
  // part no other visible polygon covers (a 10 ha polygon with a 3 ha one
  // inside it shows 7 ha, and the inner one 0 ha); otherwise the whole polygon.
  function shownAreaSqMeters(sIdx){
    var s = shapes[sIdx], full = areaSqMeters(s.points);
    if(!polyKnockoutOn || s.visible === false || !knockoutCache.areas) return full;
    return (sIdx in knockoutCache.areas) ? knockoutCache.areas[sIdx] : full;
  }

  // A batch's own area with overlaps between its polygons removed (each
  // overlap counted for none of them, as the "cut out overlaps" view shows).
  function batchNetArea(idxs){
    var polys = idxs.filter(function(i){ return shapeKind(shapes[i]) === 'polygon'; }), full = 0, net = 0;
    polys.forEach(function(i){ full += areaSqMeters(shapes[i].points); });
    if(polys.length < 2) return { full:full, net:full };
    var r = computeOverlapFills(polys);
    polys.forEach(function(i){ net += (i in r.areas) ? r.areas[i] : areaSqMeters(shapes[i].points); });
    return { full:full, net:net };
  }

  function redrawAll(opts){
    drawLayer.clearLayers();
    var knockoutFills = polyKnockoutOn ? computeKnockoutFills() : null;
    document.getElementById('tapCount').textContent = shapes[tapShapeIndex] ? shapes[tapShapeIndex].points.length : 0;

    var totals = { totalPolyArea:0, totalLineLen:0, polyCount:0, lineCount:0, pointCount:0 };
    var allLatLngs = [];
    var tapTypeLabel = '—';

    shapes.forEach(function(shape, sIdx){
      var pts = shape.points;
      if(pts.length === 0) return;
      ensureLayerProps(shape, sIdx);
      var color = shape.color;
      var kind = shapeKind(shape);

      // Hidden shapes still count in stats/results but are not drawn on the map.
      if(shape.visible === false) return;

      if(shape.isTrack){
        pts.forEach(function(p){ allLatLngs.push([p.lat, p.lng]); });
        L.circleMarker([pts[0].lat, pts[0].lng], {
          radius:5, color:'#fff', weight:2, fillColor:color, fillOpacity:1
        }).addTo(drawLayer);
      } else {
        var draggableHere = tapDrawActive && sIdx === tapShapeIndex;
        // Vertices stay visible while actively being drawn/dragged even if
        // the layer's "show points" toggle is off, so editing never breaks.
        var showPts = shapeShowsVertices(shape) || draggableHere;
        pts.forEach(function(p, i){
          allLatLngs.push([p.lat, p.lng]);
          if(!showPts) return;
          var mk = L.marker([p.lat, p.lng], {
            icon: badgeIcon(i+1, color),
            draggable: draggableHere
          }).addTo(drawLayer);
          if(draggableHere){
            mk.on('dragstart', function(){
              pushUndo();
            });
            mk.on('dragend', function(){
              var ll = mk.getLatLng();
              shape.points[i].lat = ll.lat;
              shape.points[i].lng = ll.lng;
              redrawAll();
            });
          }
        });
      }

      // The shape being tap-drawn keeps its outline too, so the edges being placed stay visible.
      var showLine = shapeShowsOutline(shape) || (tapDrawActive && sIdx === tapShapeIndex && !shape.isTrack);
      if(kind === 'point'){
        totals.pointCount++;
        if(sIdx === 0) tapTypeLabel = 'Цэг';
      } else if(kind === 'line'){
        if(showLine){
          L.polyline(pts.map(function(p){return [p.lat,p.lng];}), {
            color:color, weight:4, opacity: (shape.opacity===undefined?0.95:shape.opacity),
            renderer: shape.batchId ? batchRenderer : undefined
          }).addTo(drawLayer);
        }
        totals.lineCount++;
        totals.totalLineLen += pathLengthMeters(pts);
        if(sIdx === 0) tapTypeLabel = 'Шугам';
      } else {
        // The fill is always drawn; the outline (stroke) only when switched on.
        // Without an outline the fill gets a stronger base so the area stays
        // readable; the ТУНГАЛАГ slider scales it either way.
        var op = (shape.opacity===undefined ? 1 : shape.opacity);
        var fillOp = op * (showLine ? 0.22 : 0.45);
        var kFill = knockoutFills ? knockoutFills[sIdx] : undefined;
        if(kFill === undefined){
          L.polygon(pts.map(function(p){return [p.lat,p.lng];}), {
            stroke: showLine, color:color, weight:3, fillColor:color, fillOpacity: fillOp,
            renderer: shape.batchId ? batchRenderer : undefined
          }).addTo(drawLayer);
        } else {
          // Overlap knocked out: fill = only the part no other polygon covers.
          if(kFill !== 'empty'){
            L.geoJSON(kFill, { style:{ stroke:false, fillColor:color, fillOpacity:fillOp } }).addTo(drawLayer);
          }
          if(showLine){
            L.polygon(pts.map(function(p){return [p.lat,p.lng];}), {
              color:color, weight:3, fill:false
            }).addTo(drawLayer);
          }
        }
        totals.polyCount++;
        var fullA = areaSqMeters(pts), shownA = shownAreaSqMeters(sIdx);
        totals.totalPolyArea += shownA;
        if(shownA < fullA - 0.01) totals.cutOverlap = true;
        if(sIdx === 0) tapTypeLabel = 'Полигон';
      }
    });

    document.getElementById('tapType').textContent = tapTypeLabel;
    renderResultsPanel(totals);
    if(mode === 'layers') renderLayersPanel();
    if(mode === 'coords') renderCoordsPanel();
    renderLegend();

    if(allLatLngs.length && !trackActive && !tapDrawActive && !(opts && opts.noFit)){
      map.fitBounds(L.latLngBounds(allLatLngs), { padding:[60,60], maxZoom:18 });
    }

    persistShapesDebounced();
  }

  // ---------- Legend ----------
  var legendPanel = document.getElementById('legendPanel');
  var legendBody = document.getElementById('legendBody');
  var legendOn = getSetting('legendOn', true);

  function renderLegend(){
    var visible = shapes.filter(function(s){ return s.points.length > 0 && s.visible !== false; });
    // Types switched off in the MRPAM settings list drop out of the legend too.
    var mrpamTypes = (mrpamLoaded && mrpamVisible) ? Object.keys(mrpamTypeColors).filter(function(t){ return !mrpamTypesHidden[t]; }) : [];
    var adminLevels = (adminLoaded && adminVisible) ? ['aimag','soum','bag'].filter(function(l){ return adminLevelsOn[l]; }) : [];
    var showCadastre = (typeof cadastreLoaded !== 'undefined' && cadastreLoaded && cadastreVisible);
    var showUserGj = (typeof userGjLoaded !== 'undefined' && userGjLoaded && userGjVisible);

    if(visible.length === 0 && mrpamTypes.length === 0 && adminLevels.length === 0 && !showCadastre && !showUserGj){
      legendBody.innerHTML = '<div class="leg-empty">Зурсан дүрс алга</div>';
      return;
    }

    var html = '', legendBatches = {};
    visible.forEach(function(s){ if(s.batchId) legendBatches[s.batchId] = (legendBatches[s.batchId] || 0) + 1; });
    visible.forEach(function(s){
      if(s.batchId){
        if(legendBatches[s.batchId] === 'done') return;
        html += '<div class="leg-row">';
        html += '  <span class="leg-sw" style="background:'+s.color+'33;border-color:'+s.color+'"></span>';
        html += '  <span class="leg-lbl">'+escapeXml(s.batchName || 'Багц')+' ('+legendBatches[s.batchId]+')</span>';
        html += '</div>';
        legendBatches[s.batchId] = 'done';
        return;
      }
      var kind = shapeKind(s);
      var shapeClass = kind === 'point' ? 'pt' : '';
      html += '<div class="leg-row">';
      html += '  <span class="leg-sw '+shapeClass+'" style="background:'+(kind==='point'?s.color:s.color+'33')+';border-color:'+s.color+'"></span>';
      html += '  <span class="leg-lbl">'+escapeXml(s.name || '')+'</span>';
      html += '</div>';
    });

    if(mrpamTypes.length > 0){
      if(visible.length > 0) html += '<div class="leg-sep">MRPAM — төрлөөр</div>';
      mrpamTypes.forEach(function(t){
        var c = mrpamTypeColors[t];
        html += '<div class="leg-row">';
        html += '  <span class="leg-sw" style="background:'+c+'33;border-color:'+c+'"></span>';
        html += '  <span class="leg-lbl">'+escapeXml(t)+'</span>';
        html += '</div>';
      });
    }

    if(adminLevels.length > 0){
      if(visible.length > 0 || mrpamTypes.length > 0) html += '<div class="leg-sep">Захиргааны хил</div>';
      adminLevels.forEach(function(lvl){
        var c = ADMIN_LEVEL_COLOR[lvl];
        html += '<div class="leg-row">';
        html += '  <span class="leg-sw" style="background:'+c+'33;border-color:'+c+'"></span>';
        html += '  <span class="leg-lbl">'+escapeXml(ADMIN_LEVEL_LABEL[lvl])+'</span>';
        html += '</div>';
      });
    }

    if(showCadastre){
      var hasPrev = visible.length > 0 || mrpamTypes.length > 0 || adminLevels.length > 0;
      var cEntries = cadastreLegendEntries(); // null = single-color mode
      if(cEntries){
        // Coloured by type: a heading with the file name, then one row per shown type.
        var head = 'Кадастр' + (cadastreFileName ? ' — ' + escapeXml(cadastreFileName) : '');
        html += '<div class="leg-sep"' + (hasPrev ? '' : ' style="border-top:none; margin-top:0; padding-top:0;"') + '>' + head + '</div>';
        cEntries.forEach(function(en){
          html += '<div class="leg-row">';
          html += '  <span class="leg-sw" style="background:'+en.color+'33;border-color:'+en.color+'"></span>';
          html += '  <span class="leg-lbl">'+escapeXml(en.label)+'</span>';
          html += '</div>';
        });
      } else {
        if(hasPrev) html += '<div class="leg-sep">Кадастр</div>';
        html += '<div class="leg-row">';
        html += '  <span class="leg-sw" style="background:'+CADASTRE_COLOR+'33;border-color:'+CADASTRE_COLOR+'"></span>';
        html += '  <span class="leg-lbl">Нэгж талбар'+(cadastreFileName ? ' — '+escapeXml(cadastreFileName) : '')+'</span>';
        html += '</div>';
      }
    }

    if(showUserGj){
      var hasPrevG = html !== '';
      var gEntries = userGjLegendEntries(); // null = one color
      var gHead = 'GeoJSON' + (userGjFileName ? ' — ' + escapeXml(userGjFileName) : '');
      if(gEntries){
        html += '<div class="leg-sep"' + (hasPrevG ? '' : ' style="border-top:none; margin-top:0; padding-top:0;"') + '>' + gHead + '</div>';
        gEntries.forEach(function(en){
          html += '<div class="leg-row">';
          html += '  <span class="leg-sw" style="background:'+en.color+'33;border-color:'+en.color+'"></span>';
          html += '  <span class="leg-lbl">'+escapeXml(en.label)+'</span>';
          html += '</div>';
        });
      } else {
        if(hasPrevG) html += '<div class="leg-sep">GeoJSON</div>';
        html += '<div class="leg-row">';
        html += '  <span class="leg-sw" style="background:'+userGjColor+'33;border-color:'+userGjColor+'"></span>';
        html += '  <span class="leg-lbl">'+(userGjFileName ? escapeXml(userGjFileName) : 'GeoJSON файл')+'</span>';
        html += '</div>';
      }
    }

    legendBody.innerHTML = html;
  }

  var legendBtn = document.getElementById('legendBtn');
  legendBtn.addEventListener('click', function(){
    legendOn = !legendOn;
    legendBtn.classList.toggle('active', legendOn);
    legendPanel.classList.toggle('show', legendOn);
    saveSetting('legendOn', legendOn);
  });
  legendBtn.classList.toggle('active', legendOn);
  if(legendOn) legendPanel.classList.add('show'); // legend visibility restored from settings (defaults to on)

  // ---- Theme toggle (dark / high-contrast light) ----
  var themeBtn = document.getElementById('themeBtn');
  themeBtn.classList.toggle('active', lightThemeOn);
  themeBtn.textContent = lightThemeOn ? 'Асаалттай' : 'Асаах';
  themeBtn.addEventListener('click', function(){
    lightThemeOn = !lightThemeOn;
    document.body.classList.toggle('light-theme', lightThemeOn);
    themeBtn.classList.toggle('active', lightThemeOn);
    themeBtn.textContent = lightThemeOn ? 'Асаалттай' : 'Асаах';
    saveSetting('lightTheme', lightThemeOn);
  });

  // ---- Point number badges toggle ----
  var pointNumBtn = document.getElementById('pointNumBtn');
  pointNumBtn.classList.toggle('active', pointNumbersOn);
  pointNumBtn.addEventListener('click', function(){
    pointNumbersOn = !pointNumbersOn;
    pointNumBtn.classList.toggle('active', pointNumbersOn);
    redrawAll();
    saveSetting('pointNumbersOn', pointNumbersOn);
  });

  // ---------- Export the main (visible) areas and the holes as two files ----------
  // Main: each visible polygon minus the parts other polygons cover, holes
  // included (what the "cut out overlaps" fill shows). Holes: every place
  // where two or more polygons overlap, one polygon per separate patch, with
  // the names of the polygons that meet there.
  function round4(v){ return Math.round(v * 10000) / 10000; }
  function overlapExportData(){
    var idxs = knockoutPolygonIdxs();
    if(idxs.length < 2) return null;
    var fills = computeKnockoutFills() || {};
    var en = window.APP_LANG === 'en';
    var items = [];
    idxs.forEach(function(i){
      var ring = shapes[i].points.map(function(p){ return [p.lng, p.lat]; });
      ring.push(ring[0]);
      try{
        var feat = turf.polygon([ring]);
        items.push({ idx:i, name: shapes[i].name || ((en ? 'Polygon ' : 'Полигон ') + (i+1)), color: shapes[i].color, feat: feat, bbox: turf.bbox(feat) });
      } catch(e){ /* malformed polygon: leave it out */ }
    });
    var main = [], covered = 0;
    items.forEach(function(it){
      var f = fills[it.idx];
      if(f === 'empty'){ covered++; return; }
      var geom = f === undefined ? it.feat.geometry : f;
      var full = geoAreaM2(it.feat), vis = geoAreaM2(geom);
      main.push({ type:'Feature', geometry: geom, properties:{
        NAME: it.name, AREA_HA: round4(vis/10000), AREA_M2: Math.round(vis),
        FULL_HA: round4(full/10000), CUT_HA: round4((full - vis)/10000), COLOR: it.color || ''
      }});
    });
    var union = null, byIdx = {};
    items.forEach(function(it){ byIdx[it.idx] = it; });
    (knockoutCache.pairs || []).forEach(function(pr){
      var A = byIdx[pr[0]], B = byIdx[pr[1]];
      if(!A || !B) return;
      try{
        var x = turf.intersect(A.feat, B.feat);
        if(x) union = union ? turf.union(union, x) : x;
      } catch(e){ /* topology edge case: skip this pair */ }
    });
    var holes = [];
    if(union){
      turf.flatten(union).features.forEach(function(piece){
        var area = geoAreaM2(piece);
        if(area < 0.01) return; // polygons that only touch along an edge
        var pb = turf.bbox(piece);
        var names = items.filter(function(it){
          if(!bboxIntersects(it.bbox, pb)) return false;
          try{ var y = turf.intersect(piece, it.feat); return !!y && geoAreaM2(y) > 0.01; } catch(e){ return false; }
        }).map(function(it){ return it.name; });
        holes.push({ type:'Feature', geometry: piece.geometry, properties:{
          NAME: (en ? 'Hole ' : 'Цоорхой ') + (holes.length + 1),
          AREA_HA: round4(area/10000), AREA_M2: Math.round(area), POLYGONS: names.join(', ')
        }});
      });
    }
    return { main: main, holes: holes, covered: covered };
  }

  function overlapKml(features, docName, isHole){
    var coords = function(r){ return r.map(function(c){ return c[0].toFixed(7)+','+c[1].toFixed(7)+',0'; }).join(' '); };
    var placemarks = features.map(function(f){
      var g = f.geometry, polys = g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates];
      var geomXml = polys.map(function(p){
        return '<Polygon><outerBoundaryIs><LinearRing><coordinates>'+coords(p[0])+'</coordinates></LinearRing></outerBoundaryIs>'
          + p.slice(1).map(function(h){ return '<innerBoundaryIs><LinearRing><coordinates>'+coords(h)+'</coordinates></LinearRing></innerBoundaryIs>'; }).join('')
          + '</Polygon>';
      }).join('');
      var bgr = colorToKmlBgr(isHole ? '#e03131' : (f.properties.COLOR || '#3388ff'));
      var desc = Object.keys(f.properties).filter(function(k){ return k !== 'NAME' && k !== 'COLOR'; })
        .map(function(k){ return k + ': ' + f.properties[k]; }).join('\n');
      return '<Placemark><name>'+escapeXml(f.properties.NAME)+'</name><description>'+escapeXml(desc)+'</description>'
        + '<Style><LineStyle><color>ff'+bgr+'</color><width>2</width></LineStyle><PolyStyle><color>77'+bgr+'</color></PolyStyle></Style>'
        + '<MultiGeometry>'+geomXml+'</MultiGeometry></Placemark>';
    }).join('\n');
    return '<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>'
      + escapeXml(docName) + '</name>\n' + placemarks + '\n</Document></kml>';
  }

  function writeOverlapFile(format, features, name, shpName, isHole){
    // GeoJSON/KML: outer rings counter-clockwise (RFC 7946); Shapefile: outer clockwise.
    var fc = { type:'FeatureCollection', features: features.map(function(f){ return turf.rewind(f); }) };
    var base = safeFileName(name);
    if(format === 'geojson'){
      downloadTextFile(JSON.stringify(fc, null, 2), base+'.geojson', 'application/geo+json;charset=utf-8');
      toast('"'+name+'" татагдлаа (GEOJSON)');
    } else if(format === 'kml'){
      downloadTextFile(overlapKml(fc.features, name, isHole), base+'.kml', 'application/vnd.google-earth.kml+xml;charset=utf-8');
      toast('"'+name+'" татагдлаа (KML)');
    } else if(format === 'shp'){
      // One Polygon record per part keeps every GIS reader happy.
      var flat = [];
      features.forEach(function(f){
        turf.flatten(f).features.forEach(function(p){ p.properties = f.properties; flat.push(turf.rewind(p, { reverse:true })); });
      });
      exportShpZip({ type:'FeatureCollection', features: flat }, shpName, base, '"'+name+'" татагдлаа (SHP)');
    }
  }

  function exportOverlapSplit(format){
    var d = overlapExportData();
    if(!d) return toast('Хоёр ба түүнээс олон полигон хэрэгтэй');
    if(!d.holes.length) return toast('Полигонууд давхцаагүй тул цоорхой алга');
    var en = window.APP_LANG === 'en';
    var mainName = en ? 'Main area' : 'Үндсэн талбай', holeName = en ? 'Holes' : 'Цоорхой';
    writeOverlapFile(format, d.main, mainName, 'main_area', false);
    // A short gap so the browser does not drop the second download.
    setTimeout(function(){
      writeOverlapFile(format, d.holes, holeName, 'holes', true);
      if(d.covered) setTimeout(function(){
        toast(d.covered + ' полигон бүхэлдээ давхцсан тул үндсэн талбайн файлд ороогүй, цоорхой файлд бий');
      }, 1800);
    }, 800);
  }
  document.getElementById('splitExportRow').addEventListener('click', function(e){
    var b = e.target.closest('[data-ko-fmt]');
    if(b) exportOverlapSplit(b.getAttribute('data-ko-fmt'));
  });

  document.getElementById('knockoutSwitch').addEventListener('click', function(){
    polyKnockoutOn = !polyKnockoutOn;
    saveSetting('polyKnockout', polyKnockoutOn);
    this.classList.toggle('on', polyKnockoutOn);
    redrawAll({ noFit:true });
    toast(polyKnockoutOn ? 'Давхцсан хэсгүүд нэвт харагдана — талбайг давхцлыг хасч тооцно' : 'Давхцсан хэсгүүд энгийнээр будагдана — талбайг бүтнээр нь тооцно');
  });

  // ---------- Layers panel (visibility / color / opacity / rename) ----------
  function renderLayersPanel(){
    var empty = document.getElementById('layersEmpty');
    var list = document.getElementById('layersList');
    var nonEmpty = [];
    shapes.forEach(function(s, i){
      if(s.points.length === 0) return;
      ensureLayerProps(s, i);
      nonEmpty.push({ shape:s, idx:i });
    });

    var koRow = document.getElementById('knockoutRow');
    koRow.style.display = knockoutPolygonIdxs().length >= 2 ? 'flex' : 'none';
    document.getElementById('splitExportRow').style.display = (polyKnockoutOn && koRow.style.display === 'flex') ? 'flex' : 'none';
    document.getElementById('knockoutSwitch').classList.toggle('on', polyKnockoutOn);

    if(nonEmpty.length === 0){
      empty.style.display = '';
      list.innerHTML = '';
      return;
    }
    empty.style.display = 'none';

    var eyeOpen = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>';
    var trashIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>';
    var vertexIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="5" cy="19" r="2.3" fill="currentColor" stroke="none"/><circle cx="19" cy="19" r="2.3" fill="currentColor" stroke="none"/><circle cx="12" cy="5" r="2.3" fill="currentColor" stroke="none"/></svg>';
    var outlineIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 4 20 19 4 19"/></svg>';
    var downloadIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
    var scissorsIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/></svg>';

    var html = '';
    var exportMenuHtml = '      <div class="layer-export-menu" data-act="export-menu">'
          + '        <button type="button" data-fmt="geojson">GeoJSON</button>'
          + '        <button type="button" data-fmt="kml">KML</button>'
          + '        <button type="button" data-fmt="gpx">GPX</button>'
          + '        <button type="button" data-fmt="shp">SHP (zip)</button>'
          + '      </div>';
    var ungroupIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/><path d="M15 3h6v6M3 15v6h6"/></svg>';
    displayEntries().forEach(function(entry){
      if(!entry.batch){ return renderShapeCard(entry); }
      var first = shapes[entry.idxs[0]], st = batchStats(entry.idxs);
      var visOn = entry.idxs.some(function(i){ return shapes[i].visible !== false; });
      var opacityPct = Math.round((first.opacity===undefined?1:first.opacity)*100);
      var meta = batchKindText(st) + (st.poly ? ' · ' + humanArea(st.net).big : st.line ? ' · ' + humanLen(st.len).big : '');
      var hasGeo = st.poly || st.line;
      html += '<div class="layer-card batch-card'+(visOn?'':' hidden-shape')+'" data-batch="'+escapeXml(entry.id)+'">';
      html += '  <div class="layer-row1">';
      html += '    <button class="layer-vis'+(visOn?' on':'')+'" data-act="vis" title="Харуулах/нуух">'+eyeOpen+'</button>';
      html += '    <input type="color" class="layer-color" data-act="color" value="'+(normalizeHexColor(first.color)||'#3388ff')+'" title="Өнгө">';
      html += '    <input type="text" class="layer-name" data-act="name" value="'+escapeXml(entry.name)+'" title="Нэр өөрчлөх">';
      html += '    <span class="layer-kind-badge batch-badge">БАГЦ</span>';
      if(st.poly){
        html += '    <div class="layer-split">'
              + '      <button type="button" class="layer-split-btn" data-act="split" title="Багцыг хилээр тайрах">'+scissorsIcon+'</button>'
              + '      <div class="layer-split-menu" data-act="split-menu"></div>'
              + '    </div>';
      }
      html += '    <div class="layer-export">'
            + '      <button type="button" class="layer-export-btn" data-act="export" title="Багцыг экспортлох">'+downloadIcon+'</button>'
            + exportMenuHtml
            + '    </div>';
      html += '    <button class="layer-del" data-act="del" title="Багцыг устгах">'+trashIcon+'</button>';
      html += '  </div>';
      html += '  <div class="layer-row2">';
      html += '    <label>ТУНГАЛАГ</label>';
      html += '    <input type="range" class="layer-opacity" data-act="opacity" min="10" max="100" value="'+opacityPct+'">';
      html += '    <span class="layer-meta">'+meta+'</span>';
      html += '  </div>';
      html += '  <div class="layer-row3">';
      if(hasGeo){
        html += '    <button class="layer-geo-toggle'+(shapeShowsVertices(first)?' on':'')+'" data-act="vertices" title="Цэгүүдийг харуулах/нуух">'+vertexIcon+'<span>Цэгүүд</span></button>';
        html += '    <button class="layer-geo-toggle'+(shapeShowsOutline(first)?' on':'')+'" data-act="outline" title="Хүрээг харуулах/нуух">'+outlineIcon+'<span>Хүрээ</span></button>';
      }
      html += '    <button class="layer-geo-toggle" data-act="ungroup" title="Багцыг тусдаа дүрсүүд болгох">'+ungroupIcon+'<span>Задлах</span></button>';
      html += '  </div>';
      html += '</div>';
    });
    function renderShapeCard(entry){
      var s = entry.shape, idx = entry.idx;
      var kind = shapeKind(s);
      var kindLabel = s.isTrack ? 'GPS' : (kind === 'point' ? 'ЦЭГ' : kind === 'line' ? 'ШУГАМ' : 'ПОЛИГОН');
      var visOn = s.visible !== false;
      var opacityPct = Math.round((s.opacity===undefined?1:s.opacity)*100);
      var meta = kind === 'polygon' ? humanArea(shownAreaSqMeters(idx)).big
               : kind === 'line' ? humanLen(pathLengthMeters(s.points)).big
               : s.points.length + ' цэг';
      var showVertices = shapeShowsVertices(s);
      var showOutline = shapeShowsOutline(s);
      var hasOutline = (kind === 'line' || kind === 'polygon') && !s.isTrack;
      var isPolygon = kind === 'polygon';

      html += '<div class="layer-card'+(visOn?'':' hidden-shape')+'" data-idx="'+idx+'">';
      html += '  <div class="layer-row1">';
      html += '    <button class="layer-vis'+(visOn?' on':'')+'" data-act="vis" title="Харуулах/нуух">'+eyeOpen+'</button>';
      html += '    <input type="color" class="layer-color" data-act="color" value="'+s.color+'" title="Өнгө">';
      html += '    <input type="text" class="layer-name" data-act="name" value="'+escapeXml(s.name)+'" title="Нэр өөрчлөх">';
      html += '    <span class="layer-kind-badge">'+kindLabel+'</span>';
      if(isPolygon){
        html += '    <div class="layer-split">'
              + '      <button type="button" class="layer-split-btn" data-act="split" title="Хилээр хуваах">'+scissorsIcon+'</button>'
              + '      <div class="layer-split-menu" data-act="split-menu"></div>'
              + '    </div>';
      }
      html += '    <div class="layer-export">'
            + '      <button type="button" class="layer-export-btn" data-act="export" title="Энэ дүрсийг экспортлох">'+downloadIcon+'</button>'
            + '      <div class="layer-export-menu" data-act="export-menu">'
            + '        <button type="button" data-fmt="geojson">GeoJSON</button>'
            + '        <button type="button" data-fmt="kml">KML</button>'
            + '        <button type="button" data-fmt="gpx">GPX</button>'
            + '        <button type="button" data-fmt="shp">SHP (zip)</button>'
            + '      </div>'
            + '    </div>';
      html += '    <button class="layer-del" data-act="del" title="Устгах">'+trashIcon+'</button>';
      html += '  </div>';
      html += '  <div class="layer-row2">';
      html += '    <label>ТУНГАЛАГ</label>';
      html += '    <input type="range" class="layer-opacity" data-act="opacity" min="10" max="100" value="'+opacityPct+'">';
      html += '    <span class="layer-meta">'+meta+'</span>';
      html += '  </div>';
      if(hasOutline){
        html += '  <div class="layer-row3">';
        html += '    <button class="layer-geo-toggle'+(showVertices?' on':'')+'" data-act="vertices" title="Цэгүүдийг харуулах/нуух">'+vertexIcon+'<span>Цэгүүд</span></button>';
        html += '    <button class="layer-geo-toggle'+(showOutline?' on':'')+'" data-act="outline" title="Хүрээг харуулах/нуух">'+outlineIcon+'<span>Хүрээ</span></button>';
        html += '  </div>';
      }
      html += '</div>';
    }
    list.innerHTML = html;

    // Batch cards: every control applies to all shapes of the batch.
    list.querySelectorAll('.batch-card').forEach(function(card){
      var id = card.getAttribute('data-batch');
      function each(fn){ batchIdxs(id).forEach(function(i){ fn(shapes[i]); }); }
      var first = function(){ return shapes[batchIdxs(id)[0]]; };
      card.querySelector('[data-act="vis"]').addEventListener('click', function(){
        var on = !batchIdxs(id).some(function(i){ return shapes[i].visible !== false; });
        each(function(s){ s.visible = on; });
        redrawAll({ noFit:true });
      });
      card.querySelector('[data-act="color"]').addEventListener('input', function(){
        var c = this.value;
        each(function(s){ s.color = c; });
        redrawAll({ noFit:true });
      });
      card.querySelector('[data-act="name"]').addEventListener('input', function(){
        var v = this.value.trim();
        if(v) each(function(s){ s.batchName = v; });
        renderLegend();
      });
      card.querySelector('[data-act="opacity"]').addEventListener('input', function(){
        var o = parseInt(this.value, 10) / 100;
        each(function(s){ s.opacity = o; });
        redrawAll({ noFit:true });
      });
      var vb = card.querySelector('[data-act="vertices"]'), ob = card.querySelector('[data-act="outline"]');
      if(vb) vb.addEventListener('click', function(){
        var on = !shapeShowsVertices(first()), outl = shapeShowsOutline(first());
        each(function(s){
          s.showVertices = on; s.showOutline = outl;
          if(shapeKind(s) === 'line' && !on) s.showOutline = true;
        });
        redrawAll({ noFit:true });
      });
      if(ob) ob.addEventListener('click', function(){
        var on = !shapeShowsOutline(first()), vert = shapeShowsVertices(first());
        each(function(s){
          s.showOutline = on; s.showVertices = vert;
          if(shapeKind(s) === 'line' && !on) s.showVertices = true;
        });
        redrawAll({ noFit:true });
      });
      card.querySelector('[data-act="ungroup"]').addEventListener('click', function(){ ungroupBatch(id); });
      card.querySelector('[data-act="del"]').addEventListener('click', function(){ deleteBatch(id); });
      var exportBtn = card.querySelector('[data-act="export"]'), exportMenu = card.querySelector('[data-act="export-menu"]');
      exportBtn.addEventListener('click', function(e){
        e.stopPropagation();
        var willOpen = !exportMenu.classList.contains('open');
        list.querySelectorAll('.layer-export-menu.open, .layer-split-menu.open').forEach(function(m){ m.classList.remove('open'); });
        if(willOpen) exportMenu.classList.add('open');
      });
      exportMenu.querySelectorAll('button[data-fmt]').forEach(function(btn){
        btn.addEventListener('click', function(e){
          e.stopPropagation();
          exportMenu.classList.remove('open');
          exportBatch(id, btn.getAttribute('data-fmt'));
        });
      });
      var splitBtn = card.querySelector('[data-act="split"]'), splitMenu = card.querySelector('[data-act="split-menu"]');
      if(splitBtn && splitMenu){
        splitBtn.addEventListener('click', function(e){
          e.stopPropagation();
          var willOpen = !splitMenu.classList.contains('open');
          list.querySelectorAll('.layer-export-menu.open, .layer-split-menu.open').forEach(function(m){ m.classList.remove('open'); });
          if(willOpen){ renderSplitMenu(splitMenu, null, id); splitMenu.classList.add('open'); }
        });
      }
    });

    // Event delegation for all controls in the list
    list.querySelectorAll('.layer-card:not(.batch-card)').forEach(function(card){
      var idx = parseInt(card.getAttribute('data-idx'), 10);
      var shape = shapes[idx];

      card.querySelector('[data-act="vis"]').addEventListener('click', function(){
        shape.visible = !(shape.visible !== false);
        redrawAll();
      });
      card.querySelector('[data-act="color"]').addEventListener('input', function(){
        shape.color = this.value;
        redrawAll();
      });
      card.querySelector('[data-act="name"]').addEventListener('input', function(){
        shape.name = this.value.trim() || shape.name;
        renderLegend();
      });
      card.querySelector('[data-act="opacity"]').addEventListener('input', function(){
        shape.opacity = parseInt(this.value, 10) / 100;
        redrawAll();
      });
      var vertBtn = card.querySelector('[data-act="vertices"]');
      var outlineBtn = card.querySelector('[data-act="outline"]');
      if(vertBtn){
        vertBtn.addEventListener('click', function(){
          shape.showVertices = !shapeShowsVertices(shape);
          shape.showOutline = shapeShowsOutline(shape); // pin the current state explicitly
          // A line with neither points nor line would vanish, so hiding one shows the other.
          // Polygons may hide both — the fill alone stays on the map.
          if(shapeKind(shape) === 'line' && !shape.showVertices) shape.showOutline = true;
          redrawAll();
        });
      }
      if(outlineBtn){
        outlineBtn.addEventListener('click', function(){
          shape.showOutline = !shapeShowsOutline(shape);
          shape.showVertices = shapeShowsVertices(shape);
          if(shapeKind(shape) === 'line' && !shape.showOutline) shape.showVertices = true;
          redrawAll();
        });
      }
      card.querySelector('[data-act="del"]').addEventListener('click', function(){
        if(trackActive && idx === trackShapeIndex){
          toast('Идэвхтэй GPS замыг эхлээд зогсооно уу');
          return;
        }
        if(tapDrawActive && idx === tapShapeIndex){
          toast('Идэвхтэй товшиж зурсан талбайг эхлээд дуусгана уу');
          return;
        }
        pushUndo();
        // Shape 0 is the permanent fallback tap slot — clear it instead of
        // removing it from the array, so tap mode always has somewhere to write.
        if(idx === 0 || shapes.length === 1){
          shapes[idx].points = [];
          shapes[idx].visible = true;
          shapes[idx].color = null;
          shapes[idx].name = null;
        } else {
          shapes.splice(idx, 1);
          if(trackActive && trackShapeIndex !== null && idx < trackShapeIndex){
            trackShapeIndex--;
          }
          if(idx < tapShapeIndex){
            tapShapeIndex--;
          }
        }
        redrawAll();
      });

      var exportBtn = card.querySelector('[data-act="export"]');
      var exportMenu = card.querySelector('[data-act="export-menu"]');
      exportBtn.addEventListener('click', function(e){
        e.stopPropagation();
        var willOpen = !exportMenu.classList.contains('open');
        // Close any other open export menus first so only one shows at a time.
        list.querySelectorAll('.layer-export-menu.open, .layer-split-menu.open').forEach(function(m){ m.classList.remove('open'); });
        if(willOpen) exportMenu.classList.add('open');
      });
      exportMenu.querySelectorAll('button[data-fmt]').forEach(function(btn){
        btn.addEventListener('click', function(e){
          e.stopPropagation();
          exportMenu.classList.remove('open');
          exportSingleShape(idx, btn.getAttribute('data-fmt'));
        });
      });

      var splitBtn = card.querySelector('[data-act="split"]');
      var splitMenu = card.querySelector('[data-act="split-menu"]');
      if(splitBtn && splitMenu){
        splitBtn.addEventListener('click', function(e){
          e.stopPropagation();
          var willOpen = !splitMenu.classList.contains('open');
          list.querySelectorAll('.layer-export-menu.open, .layer-split-menu.open').forEach(function(m){ m.classList.remove('open'); });
          if(willOpen){
            renderSplitMenu(splitMenu, idx);
            splitMenu.classList.add('open');
          }
        });
      }
    });
  }

  // Builds the "Хуваах" dropdown contents for one shape: one entry per
  // administrative level that's currently loaded (Аймаг/Сум/Баг) plus one
  // for the MRPAM license layer, each disabled with an explanatory hint if
  // that layer hasn't been loaded yet. Rebuilt fresh on every open since
  // layer availability can change between opens (a layer can be loaded
  // after the panel was first rendered).
  function renderSplitMenu(menu, shapeIdx, batchId){
    var items = [
      { key:'aimag', label:'Аймгийн хилээр', ready: adminLoaded, hint:'Захиргааны хил ачаалаагүй байна' },
      { key:'soum',  label:'Сумын хилээр',   ready: adminLoaded, hint:'Захиргааны хил ачаалаагүй байна' },
      { key:'bag',   label:'Багийн хилээр',  ready: adminLoaded, hint:'Захиргааны хил ачаалаагүй байна' },
      { key:'mrpam', label:'MRPAM лицензийн хилээр', ready: mrpamLoaded, hint:'MRPAM лиценз ачаалаагүй байна' },
      { key:'cadastre', label:'Кадастрын нэгж талбараар', ready: cadastreReady(), hint:'Кадастрын зураг ачаалаагүй байна' },
      userGjSplitItem()
    ];
    // Layers coloured by type clip into one batch per switched-on type.
    items.forEach(function(it){
      if(!it.ready || ['mrpam','cadastre','usergj'].indexOf(it.key) < 0) return;
      var src = splitSource(it.key);
      if(!src.typing) return;
      var on = {};
      src.features.forEach(function(f){ if(isPolygonal(f)) on[f._t] = 1; });
      var n = Object.keys(on).length;
      if(!n){ it.ready = false; it.hint = 'Идэвхтэй төрөл алга — давхаргын тохиргооноос төрлөө идэвхжүүлнэ үү'; return; }
      it.label += ' — ' + n + ' төрлөөр';
    });
    var html = '';
    var anyReady = items.some(function(it){ return it.ready; });
    if(!anyReady){
      html += '<div class="lsm-hint">Хуваахын тулд эхлээд "Захиргааны хил", "MRPAM лиценз", "Кадастрын зураг" эсвэл "GeoJSON файл" давхаргыг ачаална уу (⋯ цэснээс)</div>';
    } else {
      items.forEach(function(it, i){
        if(i === 3) html += '<div class="lsm-sep"></div>'; // separates admin levels from MRPAM
        html += '<button type="button" class="lsm-item" data-split-key="'+it.key+'"'+(it.ready?'':' disabled title="'+escapeXml(it.hint)+'"')+'>'+it.label+'</button>';
      });
    }
    menu.innerHTML = html;
    menu.querySelectorAll('.lsm-item[data-split-key]:not(:disabled)').forEach(function(btn){
      btn.addEventListener('click', function(e){
        e.stopPropagation();
        menu.classList.remove('open');
        if(batchId) splitBatchByBoundary(batchId, btn.getAttribute('data-split-key'));
        else splitShapeByBoundary(shapeIdx, btn.getAttribute('data-split-key'));
      });
    });
  }

  // ---------- Split a drawn polygon along administrative or MRPAM boundaries ----------
  // Clips the shape at `shapeIdx` against every boundary polygon of the
  // chosen kind ('aimag' | 'soum' | 'bag' | 'mrpam') that it overlaps, and
  // replaces the original shape with one new shape per resulting piece —
  // each named after the boundary it fell inside (so "Талбай 3" split by
  // soum becomes "Талбай 3 — Баянзүрх", "Талбай 3 — Хан-Уул", etc).
  // Uses turf.intersect (polygon-clipping under the hood) rather than a
  // hand-rolled clip, since boundary polygons here can have holes, many
  // vertices, and touch the user polygon along partial edges — all cases a
  // simple point-in-polygon split would get wrong.
  var SPLIT_LEVEL_LABEL = { aimag:'Аймаг', soum:'Сум', bag:'Баг/Хороо', mrpam:'MRPAM', cadastre:'Кадастр', usergj:'GeoJSON' };

  // The cadastre and GeoJSON layers live in later script files (js-07, js-08),
  // so they are looked up when the menu opens rather than when this file loads.
  function isPolygonal(f){
    var t = f && f.geometry && f.geometry.type;
    return t === 'Polygon' || t === 'MultiPolygon';
  }
  function cadastreReady(){
    return typeof cadastreLoaded !== 'undefined' && cadastreLoaded && !!cadastreFeatures && cadastreFeatures.length > 0;
  }
  function userGjSplitItem(){
    var loaded = typeof userGjLoaded !== 'undefined' && userGjLoaded && !!userGjFeatures;
    var hasPoly = loaded && userGjFeatures.some(isPolygonal);
    return {
      key:'usergj',
      label:'GeoJSON файлын хилээр' + (loaded && userGjFileName ? ' (' + escapeXml(userGjFileName) + ')' : ''),
      ready: hasPoly,
      hint: loaded ? 'GeoJSON файлд полигон алга' : 'GeoJSON файл ачаалаагүй байна'
    };
  }

  // The layer's own "colour by type" setting (⋯ menu → layer settings), if it
  // has one: GeoJSON and cadastre use the property chosen there, MRPAM its
  // licence type. Clipping then makes one batch per type that is switched
  // on, and leaves switched-off types out entirely.
  function splitTyping(splitKey){
    if(splitKey === 'usergj' && typeof userGjTypeKey !== 'undefined' && userGjTypeKey){
      return { key:userGjTypeKey, typeOf:userGjTypeOf, hidden:isUserGjTypeHidden, order:userGjTypeOrder, color:function(t){ return userGjTypeColors[t]; } };
    }
    if(splitKey === 'cadastre' && typeof cadastreTypeKey !== 'undefined' && cadastreTypeKey){
      return { key:cadastreTypeKey, typeOf:cadastreTypeOf, hidden:isCadastreTypeHidden, order:cadastreTypeOrder, color:function(t){ return cadastreTypeColors[t]; } };
    }
    if(splitKey === 'mrpam' && typeof mrpamTypeColors !== 'undefined' && Object.keys(mrpamTypeColors).length){
      return {
        key:'type',
        typeOf:function(props){ var t = props && props.type; return (t === undefined || t === null || t === '') ? null : String(t); },
        hidden:function(t){ return t !== null && !!mrpamTypesHidden[t]; },
        order:Object.keys(mrpamTypeColors),
        color:function(t){ return mrpamTypeColors[t]; }
      };
    }
    return null;
  }
  // Boundaries to clip with, as { bbox, geometry, properties, _i (index in
  // the layer), _t (type or null) }: switched-off types removed, and ordered
  // by the type list so that where two types overlap, the one listed first
  // in the layer settings gets the area (no area is counted twice).
  function splitSource(splitKey){
    var raw = splitBoundarySourceFeatures(splitKey), typing = splitTyping(splitKey), out = [];
    var rank = {};
    if(typing) typing.order.forEach(function(t, k){ rank[t] = k; });
    for(var i=0;i<raw.length;i++){
      var f = raw[i], t = typing ? typing.typeOf(f.properties) : null;
      if(typing && typing.hidden(t)) continue;
      out.push({ bbox:f.bbox, geometry:f.geometry, properties:f.properties, _i:i, _t:t });
    }
    if(typing){
      out.sort(function(a, b){
        var ra = a._t in rank ? rank[a._t] : 1e9, rb = b._t in rank ? rank[b._t] : 1e9;
        return ra - rb || a._i - b._i;
      });
    }
    return { features: out, typing: typing };
  }
  // Puts clipped pieces into batches: one per type (in the type list's order)
  // when the layer is coloured by type, otherwise a single "overlapping" one.
  // Returns [{ label, count }] for the message.
  function batchPiecesByType(pieces, baseName, color, typing){
    var groups = [], byKey = {};
    pieces.forEach(function(p){
      var k = p.splitType === undefined || p.splitType === null ? '' : p.splitType;
      if(!byKey[k]){
        byKey[k] = { key:k, id:newBatchId(), label: k || overlapLabel(true), color: (k && typing && typing.color(k)) || color, list:[] };
        groups.push(byKey[k]);
      }
      byKey[k].list.push(p);
    });
    if(typing){
      var rank = {}; typing.order.forEach(function(t, k){ rank[t] = k; });
      groups.sort(function(a, b){ return (a.key in rank ? rank[a.key] : 1e9) - (b.key in rank ? rank[b.key] : 1e9); });
    }
    groups.forEach(function(g){
      g.list.forEach(function(p){ p.batchId = g.id; p.batchName = baseName + ' — ' + g.label; p.color = g.color; delete p.splitType; });
    });
    return groups;
  }
  function groupsText(groups, outsideCount){
    var parts = groups.map(function(g){ return g.label + ' (' + g.list.length + ')'; });
    if(outsideCount) parts.push(overlapLabel(false) + ' (' + outsideCount + ')');
    return parts.length + ' багц: ' + parts.join(', ');
  }

  function splitBoundarySourceFeatures(splitKey){
    if(splitKey === 'mrpam') return mrpamFeatures || [];
    if(splitKey === 'cadastre') return cadastreReady() ? cadastreFeatures : [];
    if(splitKey === 'usergj') return (typeof userGjLoaded !== 'undefined' && userGjLoaded && userGjFeatures) || [];
    if(!adminFeatures) return [];
    return adminFeatures.filter(function(f){ return f.properties && f.properties.LEVEL === splitKey; });
  }

  function splitPieceName(baseName, splitKey, props, idx){
    var label;
    if(splitKey === 'cadastre'){
      label = cadastreNameOf(props, idx);
    } else if(splitKey === 'usergj'){
      label = userGjNameOf(props, idx);
    } else if(splitKey === 'mrpam'){
      var name = props && props.name;
      var holder = props && props.holder;
      if(name && holder) label = name + ' / ' + holder;
      else label = name || holder || 'нэргүй лиценз';
    } else {
      label = (props && props.NAME) || 'нэргүй';
    }
    return baseName + ' — ' + label;
  }

  // This app's shapes are a single ring, so a polygon with holes (a burned
  // area with unburned islands, a boundary with a hole) is cut into hole-free
  // pieces instead of dropping the holes and filling them in (which counted
  // that area twice). Each step cuts along the meridian through the median
  // hole, which opens that hole and leaves about half of the others on each
  // side, so the work grows with vertices × log(holes) rather than
  // vertices × holes — a big burned area with thousands of holes imports in
  // about a second. Cuts always follow meridians: a meridian is a geodesic,
  // so the two sides of a cut add up to exactly the original area on the
  // ellipsoid (see ringAreaEllipsoid), whichever points each side keeps on it.
  // Returns closed [lng,lat] outer rings.
  function holeFreeRings(geometry){
    geometry = densifyGeometry(geometry); // cut points on long edges then lie on the geodesic
    var stack = (geometry.type === 'MultiPolygon' ? geometry.coordinates : [geometry.coordinates]).slice();
    var out = [], steps = 0;
    while(stack.length){
      var poly = stack.pop();
      if(poly.length <= 1 || ++steps > 20000){ out.push(poly[0]); continue; }
      var feat = turf.polygon(poly), b = turf.bbox(feat), vertical = true;
      var centres = poly.slice(1).map(function(h){
        var lo = Infinity, hi = -Infinity, k = vertical ? 0 : 1;
        for(var q=0;q<h.length;q++){ if(h[q][k] < lo) lo = h[q][k]; if(h[q][k] > hi) hi = h[q][k]; }
        return (lo + hi) / 2;
      }).sort(function(a, c){ return a - c; });
      var cut = centres[centres.length >> 1], rects = vertical
        ? [[b[0]-1, b[1]-1, cut, b[3]+1], [cut, b[1]-1, b[2]+1, b[3]+1]]
        : [[b[0]-1, b[1]-1, b[2]+1, cut], [b[0]-1, cut, b[2]+1, b[3]+1]];
      var halves = [];
      try{
        rects.forEach(function(bb){
          var r = turf.intersect(feat, turf.bboxPolygon(bb));
          if(r) halves = halves.concat(r.geometry.type === 'MultiPolygon' ? r.geometry.coordinates : [r.geometry.coordinates]);
        });
      } catch(e){ out.push(poly[0]); continue; } // topology edge case: keep the outline as before
      halves.forEach(function(h){ stack.push(h); });
    }
    return out.filter(function(r){ return r.length >= 4 && geoAreaM2(turf.polygon([r])) > 0.01; });
  }

  // Converts one turf geometry (Polygon or MultiPolygon) coming out of a
  // clip back into this app's shape list: one shape per hole-free piece.
  function turfGeometryToShapes(geometry, name, sourceShape){
    var rings = holeFreeRings(geometry);
    return rings.map(function(ring, i){
      var pts = ring.slice(0, ring.length - 1).map(function(c){ return { lat:c[1], lng:c[0] }; });
      return {
        points: pts,
        name: rings.length > 1 ? name + ' (' + (i+1) + ')' : name,
        color: sourceShape.color,
        opacity: sourceShape.opacity,
        showVertices: sourceShape.showVertices,
        showOutline: sourceShape.showOutline,
        visible: true
      };
    });
  }

  // Clips one polygon shape against the boundary features. Returns
  // { pieces:[shape…], names:[boundary name…], outside:[shape…] }, or
  // { error:true } when the polygon itself is malformed. Shared by
  // single-shape and batch splitting.
  // Each part of the polygon goes to one boundary only — the first one in the
  // layer that covers it — so boundaries that overlap each other (licences,
  // protected areas, GeoJSON zones) never produce duplicate pieces, and what
  // no boundary covers is returned as `outside`. Pieces + outside always add
  // up to the original area.
  function clipShapeByBoundary(shape, splitKey, sourceFeatures){
    var userCoords = shape.points.map(function(p){ return [p.lng, p.lat]; });
    userCoords.push(userCoords[0]);
    userCoords = densifyRingGeodesic(userCoords); // long edges follow the geodesic, so pieces add up exactly
    var userPoly;
    try{
      userPoly = turf.polygon([userCoords]);
    } catch(e){
      return { error:true, pieces:[], names:[], outside:[] };
    }
    var userBbox = turf.bbox(userPoly); // [minX,minY,maxX,maxY]
    var partition = true;
    var remaining = userPoly;

    var pieces = [];
    var touchedNames = [];
    for(var i=0;i<sourceFeatures.length;i++){
      if(partition && !remaining) break; // everything is assigned already
      var f = sourceFeatures[i];
      if(!isPolygonal(f) || !bboxIntersects(f.bbox, userBbox)) continue; // lines/points in a GeoJSON file cannot clip
      var boundaryPoly;
      try{
        var bg = f._dg || (f._dg = densifyGeometry(f.geometry));
        boundaryPoly = bg.type === 'MultiPolygon' ? turf.multiPolygon(bg.coordinates) : turf.polygon(bg.coordinates);
      } catch(e){ continue; } // skip malformed boundary geometry rather than aborting the whole split
      var clipped;
      try{
        // Turf 6.5.0 (loaded by this page) takes two geometries directly —
        // turf.intersect(featureCollection) is a v7-only signature.
        clipped = turf.intersect(partition ? remaining : userPoly, boundaryPoly);
      } catch(e){ continue; } // topology edge case (shared-edge, self-touching) — skip this one boundary
      if(!clipped) continue;
      if(partition){
        try{ remaining = turf.difference(remaining, boundaryPoly); } catch(e){}
      }
      var pieceName = splitPieceName(shape.name, splitKey, f.properties, f._i === undefined ? i : f._i);
      var newShapes = turfGeometryToShapes(clipped.geometry, pieceName, shape);
      if(f._t !== undefined) newShapes.forEach(function(ns){ ns.splitType = f._t; });
      if(newShapes.length){
        pieces = pieces.concat(newShapes);
        touchedNames.push(pieceName.split(' — ')[1]);
      }
    }
    var outside = [];
    if(partition && pieces.length && remaining){
      outside = turfGeometryToShapes(remaining.geometry, shape.name + ' — ' + overlapLabel(false), shape);
    }
    return { error:false, pieces:pieces, names:touchedNames, outside:outside };
  }

  // Batch names after a clip: the part inside the boundaries and the rest.
  function overlapLabel(inside){
    var en = window.APP_LANG === 'en';
    return inside ? (en ? 'overlapping' : 'давхцсан') : (en ? 'not overlapping' : 'давхцаагүй');
  }
  function otherColor(c){
    var k = SHAPE_COLORS.indexOf(c);
    return SHAPE_COLORS[(k < 0 ? 1 : k + 3) % SHAPE_COLORS.length];
  }

  // Clipping leaves three groups: the original polygon (kept, but hidden, so
  // it is not counted twice), a batch of the pieces inside the boundaries and
  // a batch of the rest.
  function splitShapeByBoundary(shapeIdx, splitKey){
    var shape = shapes[shapeIdx];
    if(!shape || shapeKind(shape) !== 'polygon'){
      toast('Зөвхөн полигоныг хуваах боломжтой');
      return;
    }
    var src = splitSource(splitKey), sourceFeatures = src.features;
    if(sourceFeatures.length === 0){
      toast(src.typing ? 'Идэвхтэй төрөл алга — давхаргын тохиргооноос төрлөө идэвхжүүлнэ үү' : SPLIT_LEVEL_LABEL[splitKey] + ' давхарга ачаалагдаагүй байна');
      return;
    }
    var res = clipShapeByBoundary(shape, splitKey, sourceFeatures);
    if(res.error){
      toast('Энэ полигон буруу хэлбэртэй тул хуваах боломжгүй байна');
      return;
    }
    if(res.pieces.length === 0){
      toast(SPLIT_LEVEL_LABEL[splitKey] + ' давхаргатай огтлолцсонгүй — полигон уг давхаргын хамрах хүрээнээс гадуур байж болзошгүй');
      return;
    }
    var outId = newBatchId(), oc = otherColor(shape.color);
    var groups = batchPiecesByType(res.pieces, shape.name, shape.color, src.typing);
    res.outside.forEach(function(p){ p.batchId = outId; p.batchName = shape.name + ' — ' + overlapLabel(false); p.color = oc; });
    var ordered = [];
    groups.forEach(function(g){ ordered = ordered.concat(g.list); });

    pushUndo();
    shape.visible = false;
    var out = shapes.slice(0, shapeIdx + 1).concat(ordered, res.outside, shapes.slice(shapeIdx + 1));
    replaceShapes(out);
    // Tap tools (centre point, GPS, remove point) must not edit a batch member.
    shapes.push({ points: [] });
    tapShapeIndex = shapes.length - 1;
    redrawAll();
    toast('"' + shape.name + '" → ' + groupsText(groups, res.outside.length) + '; анхны полигон нуугдсан');
  }


  // Any open per-shape export dropdown should close on an outside click —
  // renderLayersPanel re-creates the cards each time, so this is wired once
  // globally rather than per-card.
  document.addEventListener('click', function(e){
    if(!e.target.closest('.layer-export')){
      document.querySelectorAll('.layer-export-menu.open').forEach(function(m){ m.classList.remove('open'); });
    }
    if(!e.target.closest('.layer-split')){
      document.querySelectorAll('.layer-split-menu.open').forEach(function(m){ m.classList.remove('open'); });
    }
  });

  // The single line shown when the panel is folded down to its "peek" state.
  function renderSheetSummary(totals){
    var el = document.getElementById('sheetSummaryText');
    if(!el) return;
    var n = totals.polyCount + totals.lineCount + totals.pointCount;
    if(!n){ el.textContent = 'Дүрс алга'; return; }
    var parts = [n + ' дүрс'];
    if(totals.polyCount) parts.push(fmt(totals.totalPolyArea / 10000, 2) + ' га');
    if(totals.lineCount) parts.push(humanLen(totals.totalLineLen).big);
    el.textContent = parts.join(' · ');
  }

  // Which result rows are open (by shape index) — kept across redraws, otherwise
  // every new point would fold them shut again.
  var resultRowsOpen = {};

  function renderResultsPanel(totals){
    renderSheetSummary(totals);
    var results = document.getElementById('results');
    var exportBar = document.getElementById('exportBar');
    var nonEmpty = [];
    shapes.forEach(function(s, i){ if(s.points.length > 0) nonEmpty.push({ shape:s, colorIdx:i }); });

    if(nonEmpty.length === 0){
      results.classList.remove('show');
      results.innerHTML = '';
      exportBar.classList.remove('show');
      return;
    }
    results.classList.add('show');
    exportBar.classList.add('show');

    var html = '';

    if(nonEmpty.length > 1){
      var parts = [];
      if(totals.polyCount) parts.push(totals.polyCount+' полигон');
      if(totals.lineCount) parts.push(totals.lineCount+' шугам');
      if(totals.pointCount) parts.push(totals.pointCount+' цэг');
      html += '<div class="summary-card">';
      html += '<div class="summary-title">Нийт '+nonEmpty.length+' дүрс · '+parts.join(', ')+'</div>';
      if(totals.polyCount){
        html += '<div class="summary-line">Нийт талбай: <b>'+fmt(totals.totalPolyArea/10000,2)+' га</b> ('+fmt(totals.totalPolyArea,0)+' м²)'+(totals.cutOverlap?' · давхцал хассан':'')+'</div>';
        // With "cut out overlaps" off the total counts overlaps in every polygon;
        // show the overlap-free figure next to it when polygons do overlap.
        if(!polyKnockoutOn){
          var koIdxs = knockoutPolygonIdxs();
          if(koIdxs.length >= 2){
            var ov = computeOverlapFills(koIdxs), cut = 0;
            Object.keys(ov.areas).forEach(function(i){ cut += areaSqMeters(shapes[i].points) - ov.areas[i]; });
            if(cut > 0.01) html += '<div class="summary-line">Давхцал хассан талбай: <b>'+fmt((totals.totalPolyArea-cut)/10000,2)+' га</b> (давхцал '+fmt(cut/10000,2)+' га)</div>';
          }
        }
      }
      if(totals.lineCount){
        html += '<div class="summary-line">Нийт урт: <b>'+fmt(totals.totalLineLen,1)+' м</b> ('+fmt(totals.totalLineLen/1000,2)+' км)</div>';
      }
      html += '</div>';
    }

    // The cards below are measurements only (area, length, perimeter, vertex
    // count). The coordinates themselves are shown once, in the «Солбицол» tab,
    // in whichever format is chosen there — repeating them here (and again for
    // single points) just duplicated that list. A lone point has nothing to
    // measure, so it gets no card; it still counts in the summary above.
    var resultBatchDone = {};
    nonEmpty.forEach(function(entry, idx){
      if(entry.shape.batchId){
        var bid = entry.shape.batchId;
        if(resultBatchDone[bid]) return;
        resultBatchDone[bid] = true;
        var bIdxs = batchIdxs(bid), bst = batchStats(bIdxs), bColor = entry.shape.color || '#3388ff';
        var bHidden = !bIdxs.some(function(i){ return shapes[i].visible !== false; });
        // Area with overlaps between the batch's polygons removed.
        var bBig = bst.poly ? humanArea(bst.net) : humanLen(bst.len);
        var bGrid = [{k:'ДҮРС', v: bIdxs.length}];
        if(bst.poly) bGrid.push({k:'ПОЛИГОН', v: fmt(bst.poly,0)});
        bGrid.push({k:'ОРОЙН ТОО', v: fmt(bst.pts,0)});
        if(bst.poly){
          bGrid.push({k:'ГА', v: fmt(bst.net/10000,2)}); bGrid.push({k:'М²', v: fmt(bst.net,0)});
          if(bst.full - bst.net > 0.01){
            bGrid.push({k:'БҮТЭН ТАЛБАЙ (ГА)', v: fmt(bst.full/10000,2)});
            bGrid.push({k:'ДАВХЦАЛ (ГА)', v: fmt((bst.full-bst.net)/10000,2)});
          }
        }
        if(bst.line) bGrid.push({k:'УРТ (М)', v: fmt(bst.len,1)});
        var bKey = 'b:' + bid, bOpen = !!resultRowsOpen[bKey];
        html += '<div class="result-card result-row'+(bOpen?' open':'')+'" data-idx="'+escapeXml(bKey)+'" style="border:1px solid '+bColor+'55; background:linear-gradient(135deg,'+bColor+'18, transparent)'+(bHidden?';opacity:0.55':'')+'">';
        html += '<button type="button" class="rr-head" aria-expanded="'+(bOpen?'true':'false')+'">';
        html +=   '<span class="swatch" style="background:'+bColor+'"></span>';
        html +=   '<span class="rr-name">'+escapeXml(entry.shape.batchName || 'Багц')+(bHidden?' · нуугдсан':'')+'</span>';
        html +=   '<span class="rr-type" style="background:'+bColor+'">БАГЦ</span>';
        html +=   '<span class="rr-big">'+bBig.big+'</span><span class="rr-chev">▾</span>';
        html += '</button>';
        html += '<div class="rr-body"><div class="small">'+batchKindText(bst)+(bst.poly && bst.full - bst.net > 0.01 ? ' · давхцал хассан' : '')+'</div><div class="result-grid">';
        bGrid.forEach(function(g){ html += '<div class="item"><div class="k">'+g.k+'</div><div class="v">'+g.v+'</div></div>'; });
        html += '</div></div></div>';
        return;
      }
      var pts = entry.shape.points;
      var isTrack = !!entry.shape.isTrack;
      var color = entry.shape.color || (isTrack ? '#4285f4' : SHAPE_COLORS[entry.colorIdx % SHAPE_COLORS.length]);
      var shapeName = entry.shape.name;
      var isHidden = entry.shape.visible === false;
      var kind = shapeKind(entry.shape);
      if(kind === 'point') return;
      var typeLabel, big, small, grid;

      if(kind === 'line'){
        typeLabel = isTrack ? 'GPS ЗАМ' : 'ШУГАМ';
        var d = pathLengthMeters(pts);
        var hl = humanLen(d);
        big = hl.big; small = hl.small;
        grid = [
          {k:'ЦЭГИЙН ТОО', v: pts.length},
          {k:'УРТ (М)', v: fmt(d,1)}
        ];
      } else {
        typeLabel = isTrack ? 'GPS ТАЛБАЙ' : 'ПОЛИГОН';
        var fullArea = areaSqMeters(pts);
        var area = shownAreaSqMeters(entry.colorIdx);
        var per = perimeterMeters(pts);
        var ha = humanArea(area);
        big = ha.big; small = ha.small;
        grid = [
          {k:'ОРОЙН ТОО', v: pts.length},
          {k:'ТОЙРОГ (М)', v: fmt(per,1)},
          {k:'ГА', v: fmt(area/10000,2)},
          {k:'М²', v: fmt(area,0)}
        ];
        // "Cut out overlaps" removed part of this polygon: show what was taken off.
        if(area < fullArea - 0.01){
          small += ' · давхцал хассан';
          grid.push({k:'БҮТЭН ТАЛБАЙ (ГА)', v: fmt(fullArea/10000,2)});
          grid.push({k:'ДАВХЦАЛ (ГА)', v: fmt((fullArea-area)/10000,2)});
        }
      }

      var isOpen = !!resultRowsOpen[entry.colorIdx];
      html += '<div class="result-card result-row'+(isOpen?' open':'')+'" data-idx="'+entry.colorIdx+'" style="border:1px solid '+color+'55; background:linear-gradient(135deg,'+color+'18, transparent)'+(isHidden?';opacity:0.55':'')+'">';
      html += '<button type="button" class="rr-head" aria-expanded="'+(isOpen?'true':'false')+'">';
      html +=   '<span class="swatch" style="background:'+color+'"></span>';
      html +=   '<span class="rr-name">'+escapeXml(shapeName)+(isHidden?' · нуугдсан':'')+'</span>';
      html +=   '<span class="rr-type" style="background:'+color+'">'+typeLabel+'</span>';
      html +=   '<span class="rr-big">'+big+'</span><span class="rr-chev">▾</span>';
      html += '</button>';
      html += '<div class="rr-body"><div class="small">'+small+'</div><div class="result-grid">';
      grid.forEach(function(g){
        html += '<div class="item"><div class="k">'+g.k+'</div><div class="v">'+g.v+'</div></div>';
      });
      html += '</div></div>';
      html += '</div>';
    });

    if(!html){ results.classList.remove('show'); results.innerHTML = ''; return; }
    results.innerHTML = html;
  }

  document.getElementById('results').addEventListener('click', function(e){
    var head = e.target.closest ? e.target.closest('.rr-head') : null;
    if(!head) return;
    var row = head.parentNode, open = row.classList.toggle('open');
    head.setAttribute('aria-expanded', open ? 'true' : 'false');
    resultRowsOpen[row.getAttribute('data-idx')] = open;
  });

  // ---------- Export: KML / GPX / SHP ----------
  function escapeXml(str){
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
  }

  function getNonEmptyShapes(){
    var out = [];
    shapes.forEach(function(s, i){ if(s.points.length > 0) out.push({ shape:s, colorIdx:i }); });
    return out;
  }

  function shapesToGeoJSON(entries){
    var nonEmpty = entries || getNonEmptyShapes();
    var features = nonEmpty.map(function(entry, idx){
      var pts = entry.shape.points;
      var name = entry.shape.name || ('Shape_'+(idx+1));
      var props = { NAME: name };
      if(entry.shape.color) props.COLOR = entry.shape.color;
      var geometry, kind = shapeKind(entry.shape);
      if(kind === 'point'){
        props.TYPE = 'point';
        geometry = { type:'Point', coordinates:[pts[0].lng, pts[0].lat] };
      } else if(kind === 'line'){
        props.TYPE = 'line';
        props.LENGTH_M = Math.round(pathLengthMeters(pts) * 10) / 10;
        geometry = { type:'LineString', coordinates: pts.map(function(p){ return [p.lng, p.lat]; }) };
      } else {
        props.TYPE = 'polygon';
        var area = areaSqMeters(pts);
        props.AREA_M2 = Math.round(area);
        props.AREA_HA = Math.round(area/10000 * 10000) / 10000;
        var ring = pts.map(function(p){ return [p.lng, p.lat]; });
        ring.push(ring[0]);
        geometry = { type:'Polygon', coordinates:[ring] };
      }
      return { type:'Feature', properties: props, geometry: geometry };
    });
    return { type:'FeatureCollection', features: features };
  }

  function colorToKmlBgr(hex){
    hex = hex.replace('#','');
    var r = hex.substring(0,2), g = hex.substring(2,4), b = hex.substring(4,6);
    return (b+g+r).toLowerCase();
  }

  function toKmlCoords(pts, close){
    var list = pts.map(function(p){ return p.lng.toFixed(7)+','+p.lat.toFixed(7)+',0'; });
    if(close) list.push(list[0]);
    return list.join(' ');
  }

  function generateKML(entries){
    var nonEmpty = entries || getNonEmptyShapes();
    var placemarks = nonEmpty.map(function(entry, idx){
      var pts = entry.shape.points;
      var color = entry.shape.color || SHAPE_COLORS[entry.colorIdx % SHAPE_COLORS.length];
      var bgr = colorToKmlBgr(color);
      var name = entry.shape.name || ('Дүрс '+(idx+1));
      var desc = '';
      var geomXml = '', kind = shapeKind(entry.shape);
      if(kind === 'point'){
        name += ' (Цэг)';
        geomXml = '<Point><coordinates>'+toKmlCoords(pts,false)+'</coordinates></Point>';
      } else if(kind === 'line'){
        var d = pathLengthMeters(pts);
        name += ' (Шугам)';
        desc = 'Урт: '+fmt(d,1)+' м';
        geomXml = '<LineString><tessellate>1</tessellate><coordinates>'+toKmlCoords(pts,false)+'</coordinates></LineString>';
      } else {
        var area = areaSqMeters(pts);
        name += ' (Полигон)';
        desc = 'Талбай: '+fmt(area,0)+' м\u00b2 ('+fmt(area/10000,2)+' га)';
        geomXml = '<Polygon><outerBoundaryIs><LinearRing><coordinates>'+toKmlCoords(pts,true)+'</coordinates></LinearRing></outerBoundaryIs></Polygon>';
      }
      return '<Placemark><name>'+escapeXml(name)+'</name>'
        + (desc ? '<description>'+escapeXml(desc)+'</description>' : '')
        + '<Style><LineStyle><color>ff'+bgr+'</color><width>3</width></LineStyle>'
        + '<PolyStyle><color>77'+bgr+'</color></PolyStyle></Style>'
        + geomXml + '</Placemark>';
    }).join('\n');

    return '<?xml version="1.0" encoding="UTF-8"?>\n'
      + '<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Талбай хэмжигч</name>\n'
      + placemarks
      + '\n</Document></kml>';
  }

  function generateGPX(entries){
    var nonEmpty = entries || getNonEmptyShapes();
    var wpts = '', trks = '';
    nonEmpty.forEach(function(entry, idx){
      var pts = entry.shape.points;
      var name = entry.shape.name || ('Дүрс '+(idx+1));
      if(pts.length === 1){
        wpts += '<wpt lat="'+pts[0].lat.toFixed(7)+'" lon="'+pts[0].lng.toFixed(7)+'"><name>'+escapeXml(name+' (Цэг)')+'</name></wpt>\n';
      } else {
        var closed = shapeKind(entry.shape) === 'polygon';
        var segPts = pts.slice();
        if(closed) segPts.push(pts[0]);
        var trkptsXml = segPts.map(function(p){
          return '<trkpt lat="'+p.lat.toFixed(7)+'" lon="'+p.lng.toFixed(7)+'"></trkpt>';
        }).join('\n');
        var label = closed ? ' (Полигон)' : ' (Шугам)';
        trks += '<trk><name>'+escapeXml(name+label)+'</name><trkseg>\n'+trkptsXml+'\n</trkseg></trk>\n';
      }
    });
    return '<?xml version="1.0" encoding="UTF-8"?>\n'
      + '<gpx version="1.1" creator="Талбай хэмжигч" xmlns="http://www.topografix.com/GPX/1/1">\n'
      + wpts + trks
      + '</gpx>';
  }

  function downloadTextFile(content, filename, mime){
    var blob = new Blob([content], { type: mime });
    if(typeof saveAs === 'function'){
      saveAs(blob, filename);
    } else {
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function(){ URL.revokeObjectURL(url); }, 1500);
    }
  }

  // Strips characters that are invalid or awkward in filenames across
  // Windows/macOS/Android, so a shape's user-given name can be used
  // directly as the downloaded file's name.
  function safeFileName(name){
    return String(name).replace(/[\\/:*?"<>|]/g,'_').replace(/\s+/g,' ').trim().substring(0,80) || 'дүрс';
  }

  // Shapefile component names (.shp/.dbf/.shx/.prj inside the zip) are
  // safest as plain ASCII with no spaces — some GIS tools mishandle
  // Cyrillic or spaces in that internal name even though the outer
  // downloaded .zip filename itself can be anything. transliterate a
  // rough ASCII fallback rather than just stripping non-ASCII to empty.
  function shpBaseName(name, fallback){
    var ascii = String(name)
      .replace(/[^\x20-\x7E]/g, '')   // drop non-ASCII (Cyrillic, etc.)
      .replace(/[^a-zA-Z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '');
    return (ascii || fallback).substring(0, 60);
  }

  // Shared by both the bulk "Export SHP" button and the per-shape SHP
  // option — loads shpwrite on demand (with CDN fallback) and downloads
  // the resulting zip. `geojson` is whatever FeatureCollection to encode;
  // `shpName` becomes the .shp/.dbf/.shx names *inside* the zip (should be
  // ASCII, no spaces); `downloadName` is the zip file's own name on disk
  // (can be anything, including Cyrillic/spaces).
  function exportShpZip(geojson, shpName, downloadName, successMsg){
    toast('SHP сан ачаалж байна…');
    return loadScriptWithFallback([
      'https://unpkg.com/@mapbox/shp-write@0.4.3/shpwrite.js',
      'https://cdn.jsdelivr.net/npm/@mapbox/shp-write@0.4.3/shpwrite.js'
    ], function(){ return typeof shpwrite !== 'undefined'; }).then(function(){
      toast('SHP бэлтгэж байна…');
      return shpwrite.zip(geojson, { outputType:'blob', filename:shpName });
    }).then(function(blob){
      if(typeof saveAs === 'function'){
        saveAs(blob, downloadName+'.zip');
      } else {
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url; a.download = downloadName+'.zip';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(function(){ URL.revokeObjectURL(url); }, 1500);
      }
      toast(successMsg);
    }).catch(function(err){
      if(err && /CDN sources failed/.test(err.message)){
        toast('SHP сан ачаалагдсангүй (интернэт холболтоо шалгана уу)');
      } else {
        toast('SHP экспорт амжилтгүй боллоо');
      }
    });
  }

  // ---------- Export a single shape (one layer-card's export menu) ----------
  // Reuses the same generateKML/generateGPX/shapesToGeoJSON generators as
  // the "export everything" buttons below, just scoped to one shape's
  // { shape, colorIdx } entry, so a single tap/GPS shape or an imported
  // polygon can be pulled out on its own without exporting the whole map.
  function exportSingleShape(idx, format){
    var shape = shapes[idx];
    if(!shape || shape.points.length === 0) return;
    var entries = [{ shape: shape, colorIdx: idx }];
    var base = safeFileName(shape.name || ('дүрс_' + (idx+1)));
    if(format === 'geojson'){
      downloadTextFile(JSON.stringify(shapesToGeoJSON(entries), null, 2), base+'.geojson', 'application/geo+json;charset=utf-8');
      toast('"'+shape.name+'" татагдлаа (GEOJSON)');
    } else if(format === 'kml'){
      downloadTextFile(generateKML(entries), base+'.kml', 'application/vnd.google-earth.kml+xml;charset=utf-8');
      toast('"'+shape.name+'" татагдлаа (KML)');
    } else if(format === 'gpx'){
      downloadTextFile(generateGPX(entries), base+'.gpx', 'application/gpx+xml;charset=utf-8');
      toast('"'+shape.name+'" татагдлаа (GPX)');
    } else if(format === 'shp'){
      var shpName = shpBaseName(shape.name, 'shape_' + (idx+1));
      exportShpZip(shapesToGeoJSON(entries), shpName, base, '"'+shape.name+'" татагдлаа (SHP)');
    }
  }

  document.getElementById('btnExportKML').addEventListener('click', function(){
    if(getNonEmptyShapes().length === 0){ toast('Эхлээд дүрс зурна уу'); return; }
    downloadTextFile(generateKML(), 'talbai-hemjigch.kml', 'application/vnd.google-earth.kml+xml;charset=utf-8');
    toast('KML татагдлаа');
  });

  document.getElementById('btnExportGPX').addEventListener('click', function(){
    if(getNonEmptyShapes().length === 0){ toast('Эхлээд дүрс зурна уу'); return; }
    downloadTextFile(generateGPX(), 'talbai-hemjigch.gpx', 'application/gpx+xml;charset=utf-8');
    toast('GPX татагдлаа');
  });

  document.getElementById('btnExportSHP').addEventListener('click', function(){
    if(getNonEmptyShapes().length === 0){ toast('Эхлээд дүрс зурна уу'); return; }
    exportShpZip(shapesToGeoJSON(), 'talbai_hemjigch', 'talbai-hemjigch-shp', 'SHP татагдлаа');
  });

  document.getElementById('btnExportGeoJSON').addEventListener('click', function(){
    if(getNonEmptyShapes().length === 0){ toast('Эхлээд дүрс зурна уу'); return; }
    var json = JSON.stringify(shapesToGeoJSON(), null, 2);
    downloadTextFile(json, 'talbai-hemjigch.geojson', 'application/geo+json;charset=utf-8');
    toast('GeoJSON татагдлаа');
  });

