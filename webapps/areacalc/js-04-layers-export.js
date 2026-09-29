  // ---------- Draw / recompute (multi-shape) ----------
  function redrawAll(){
    drawLayer.clearLayers();
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
        var showPts = shape.showVertices !== false || draggableHere;
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

      var showLine = shape.showOutline !== false;
      if(kind === 'point'){
        totals.pointCount++;
        if(sIdx === 0) tapTypeLabel = 'Цэг';
      } else if(kind === 'line'){
        if(showLine){
          L.polyline(pts.map(function(p){return [p.lat,p.lng];}), {
            color:color, weight:4, opacity: (shape.opacity===undefined?0.95:shape.opacity)
          }).addTo(drawLayer);
        }
        totals.lineCount++;
        totals.totalLineLen += pathLengthMeters(pts);
        if(sIdx === 0) tapTypeLabel = 'Шугам';
      } else {
        if(showLine){
          L.polygon(pts.map(function(p){return [p.lat,p.lng];}), {
            color:color, weight:3, fillColor:color,
            fillOpacity: (shape.opacity===undefined?0.22:shape.opacity*0.22)
          }).addTo(drawLayer);
        }
        totals.polyCount++;
        totals.totalPolyArea += areaSqMeters(pts);
        if(sIdx === 0) tapTypeLabel = 'Полигон';
      }
    });

    document.getElementById('tapType').textContent = tapTypeLabel;
    renderResultsPanel(totals);
    if(mode === 'layers') renderLayersPanel();
    if(mode === 'coords') renderCoordsPanel();
    renderLegend();

    if(allLatLngs.length && !trackActive && !tapDrawActive){
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

    if(visible.length === 0 && mrpamTypes.length === 0 && adminLevels.length === 0 && !showCadastre){
      legendBody.innerHTML = '<div class="leg-empty">Зурсан дүрс алга</div>';
      return;
    }

    var html = '';
    visible.forEach(function(s){
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
    nonEmpty.forEach(function(entry){
      var s = entry.shape, idx = entry.idx;
      var kind = shapeKind(s);
      var kindLabel = s.isTrack ? 'GPS' : (kind === 'point' ? 'ЦЭГ' : kind === 'line' ? 'ШУГАМ' : 'ПОЛИГОН');
      var visOn = s.visible !== false;
      var opacityPct = Math.round((s.opacity===undefined?1:s.opacity)*100);
      var meta = kind === 'polygon' ? humanArea(areaSqMeters(s.points)).big
               : kind === 'line' ? humanLen(pathLengthMeters(s.points)).big
               : s.points.length + ' цэг';
      var showVertices = s.showVertices !== false;
      var showOutline = s.showOutline !== false;
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
    });
    list.innerHTML = html;

    // Event delegation for all controls in the list
    list.querySelectorAll('.layer-card').forEach(function(card){
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
          var turningOff = shape.showVertices !== false;
          shape.showVertices = !turningOff;
          // Points and outline can't both be hidden — hiding one guarantees the other stays visible.
          if(!shape.showVertices) shape.showOutline = true;
          redrawAll();
        });
      }
      if(outlineBtn){
        outlineBtn.addEventListener('click', function(){
          var turningOff = shape.showOutline !== false;
          shape.showOutline = !turningOff;
          if(!shape.showOutline) shape.showVertices = true;
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
  function renderSplitMenu(menu, shapeIdx){
    var items = [
      { key:'aimag', label:'Аймгийн хилээр', ready: adminLoaded, hint:'Захиргааны хил ачаалаагүй байна' },
      { key:'soum',  label:'Сумын хилээр',   ready: adminLoaded, hint:'Захиргааны хил ачаалаагүй байна' },
      { key:'bag',   label:'Багийн хилээр',  ready: adminLoaded, hint:'Захиргааны хил ачаалаагүй байна' },
      { key:'mrpam', label:'MRPAM лицензийн хилээр', ready: mrpamLoaded, hint:'MRPAM лиценз ачаалаагүй байна' }
    ];
    var html = '';
    var anyReady = items.some(function(it){ return it.ready; });
    if(!anyReady){
      html += '<div class="lsm-hint">Хуваахын тулд эхлээд "Захиргааны хил" эсвэл "MRPAM лиценз" давхаргыг ачаална уу (⋯ цэснээс)</div>';
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
        splitShapeByBoundary(shapeIdx, btn.getAttribute('data-split-key'));
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
  var SPLIT_LEVEL_LABEL = { aimag:'Аймаг', soum:'Сум', bag:'Баг/Хороо', mrpam:'MRPAM' };

  function splitBoundarySourceFeatures(splitKey){
    if(splitKey === 'mrpam') return mrpamFeatures || [];
    if(!adminFeatures) return [];
    return adminFeatures.filter(function(f){ return f.properties && f.properties.LEVEL === splitKey; });
  }

  function splitPieceName(baseName, splitKey, props){
    var label;
    if(splitKey === 'mrpam'){
      var name = props && props.name;
      var holder = props && props.holder;
      if(name && holder) label = name + ' / ' + holder;
      else label = name || holder || 'нэргүй лиценз';
    } else {
      label = (props && props.NAME) || 'нэргүй';
    }
    return baseName + ' — ' + label;
  }

  // Converts one turf Feature/Geometry (Polygon or MultiPolygon) coming out
  // of turf.intersect back into this app's shape list. A MultiPolygon
  // result (the user polygon touches a boundary in two disjoint places)
  // becomes one shape per constituent ring, since this app's shape model
  // is single-ring only.
  function turfGeometryToShapes(geometry, name, sourceShape){
    var polys = geometry.type === 'MultiPolygon' ? geometry.coordinates : [geometry.coordinates];
    return polys.map(function(poly, i){
      var ring = poly[0]; // outer ring only — this app's shapes don't model holes
      var pts = ring.slice(0, ring.length - 1).map(function(c){ return { lat:c[1], lng:c[0] }; });
      return {
        points: pts,
        name: polys.length > 1 ? name + ' (' + (i+1) + ')' : name,
        color: sourceShape.color,
        opacity: sourceShape.opacity,
        showVertices: sourceShape.showVertices,
        showOutline: sourceShape.showOutline,
        visible: true
      };
    });
  }

  function splitShapeByBoundary(shapeIdx, splitKey){
    var shape = shapes[shapeIdx];
    if(!shape || shapeKind(shape) !== 'polygon'){
      toast('Зөвхөн полигоныг хуваах боломжтой');
      return;
    }
    var sourceFeatures = splitBoundarySourceFeatures(splitKey);
    if(sourceFeatures.length === 0){
      toast(SPLIT_LEVEL_LABEL[splitKey] + ' давхарга ачаалагдаагүй байна');
      return;
    }

    var userCoords = shape.points.map(function(p){ return [p.lng, p.lat]; });
    userCoords.push(userCoords[0]);
    var userPoly;
    try{
      userPoly = turf.polygon([userCoords]);
    } catch(e){
      toast('Энэ полигон буруу хэлбэртэй тул хуваах боломжгүй байна');
      return;
    }
    var userBbox = turf.bbox(userPoly); // [minX,minY,maxX,maxY]

    var pieces = [];
    var touchedNames = [];
    for(var i=0;i<sourceFeatures.length;i++){
      var f = sourceFeatures[i];
      if(!bboxIntersects(f.bbox, userBbox)) continue;
      var boundaryPoly;
      try{
        boundaryPoly = f.geometry.type === 'MultiPolygon' ? turf.multiPolygon(f.geometry.coordinates) : turf.polygon(f.geometry.coordinates);
      } catch(e){ continue; } // skip malformed boundary geometry rather than aborting the whole split
      var clipped;
      try{
        // Turf 6.5.0 (loaded by this page) takes two geometries directly —
        // turf.intersect(featureCollection) is a v7-only signature.
        clipped = turf.intersect(userPoly, boundaryPoly);
      } catch(e){ continue; } // topology edge case (shared-edge, self-touching) — skip this one boundary
      if(!clipped) continue;
      var pieceName = splitPieceName(shape.name, splitKey, f.properties);
      var newShapes = turfGeometryToShapes(clipped.geometry, pieceName, shape);
      if(newShapes.length){
        pieces = pieces.concat(newShapes);
        touchedNames.push(pieceName.split(' — ')[1]);
      }
    }

    if(pieces.length === 0){
      toast(SPLIT_LEVEL_LABEL[splitKey] + ' давхаргатай огтлолцсонгүй — полигон уг давхаргын хамрах хүрээнээс гадуур байж болзошгүй');
      return;
    }

    pushUndo();
    // splice(shapeIdx, 1, pieces[0]) replaces the original shape in place
    // with the first piece — the array is never emptied, so (unlike the
    // delete button) there's no need to special-case shape 0's role as the
    // permanent tap-draw fallback slot.
    shapes.splice(shapeIdx, 1, pieces[0]);
    for(var j=1;j<pieces.length;j++){
      shapes.splice(shapeIdx + j, 0, pieces[j]);
    }
    if(tapShapeIndex >= shapes.length) tapShapeIndex = 0;
    redrawAll();
    var namesPreview = touchedNames.length > 6
      ? touchedNames.slice(0,6).join(', ') + ' +' + (touchedNames.length-6)
      : touchedNames.join(', ');
    toast('"'+shape.name+'" → ' + pieces.length + ' хэсэг болж хуваагдлаа (' + namesPreview + ')');
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

  function renderResultsPanel(totals){
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
        html += '<div class="summary-line">Нийт талбай: <b>'+fmt(totals.totalPolyArea/10000,2)+' га</b> ('+fmt(totals.totalPolyArea,0)+' м²)</div>';
      }
      if(totals.lineCount){
        html += '<div class="summary-line">Нийт урт: <b>'+fmt(totals.totalLineLen,1)+' м</b> ('+fmt(totals.totalLineLen/1000,2)+' км)</div>';
      }
      html += '</div>';
    }

    nonEmpty.forEach(function(entry, idx){
      var pts = entry.shape.points;
      var isTrack = !!entry.shape.isTrack;
      var color = entry.shape.color || (isTrack ? '#4285f4' : SHAPE_COLORS[entry.colorIdx % SHAPE_COLORS.length]);
      var shapeName = entry.shape.name;
      var isHidden = entry.shape.visible === false;
      var kind = shapeKind(entry.shape);
      var typeLabel, big, small, grid;

      if(kind === 'point'){
        typeLabel = 'ЦЭГ';
        big = 'Ганц цэг';
        small = 'Талбай/урт тооцоологдохгүй';
        grid = [
          {k:'ӨРГӨРӨГ', v: fmt(pts[0].lat,6)},
          {k:'УРТРАГ', v: fmt(pts[0].lng,6)}
        ];
      } else if(kind === 'line'){
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
        var area = areaSqMeters(pts);
        var per = perimeterMeters(pts);
        var ha = humanArea(area);
        big = ha.big; small = ha.small;
        grid = [
          {k:'ОРОЙН ТОО', v: pts.length},
          {k:'ТОЙРОГ (М)', v: fmt(per,1)},
          {k:'ГА', v: fmt(area/10000,2)},
          {k:'М²', v: fmt(area,0)}
        ];
      }

      html += '<div class="result-card" style="border:1px solid '+color+'55; background:linear-gradient(135deg,'+color+'22, transparent)'+(isHidden?';opacity:0.55':'')+'">';
      if(nonEmpty.length > 1){
        html += '<div class="shape-tag"><span class="swatch" style="background:'+color+'"></span>'+escapeXml(shapeName)+(isTrack?' · GPS':'')+(isHidden?' · нуугдсан':'')+'</div>';
      }
      html += '<span class="type" style="background:'+color+'; color:#0b1210">'+typeLabel+'</span>';
      html += '<div class="big">'+big+'</div>';
      html += '<div class="small">'+small+'</div>';
      html += '<div class="result-grid">';
      grid.forEach(function(g){
        html += '<div class="item"><div class="k">'+g.k+'</div><div class="v">'+g.v+'</div></div>';
      });
      html += '</div>';
      html += '<div class="mini-coords">';
      if(isTrack && pts.length > 6){
        [pts[0], pts[1]].forEach(function(p, i){
          html += '<div class="mini-coord-row"><span class="n">'+(i+1)+'</span>'+fmt(p.lat,6)+', '+fmt(p.lng,6)+'</div>';
        });
        html += '<div class="mini-coord-row" style="opacity:0.6">⋯ дунд зэргийн '+(pts.length-4)+' цэг ⋯</div>';
        [pts[pts.length-2], pts[pts.length-1]].forEach(function(p, i){
          html += '<div class="mini-coord-row"><span class="n">'+(pts.length-1+i)+'</span>'+fmt(p.lat,6)+', '+fmt(p.lng,6)+'</div>';
        });
      } else {
        pts.forEach(function(p, i){
          html += '<div class="mini-coord-row"><span class="n">'+(i+1)+'</span>'+fmt(p.lat,6)+', '+fmt(p.lng,6)+'</div>';
        });
      }
      html += '</div>';
      html += '</div>';
    });

    results.innerHTML = html;
  }

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
      var geometry;
      if(pts.length === 1){
        props.TYPE = 'point';
        geometry = { type:'Point', coordinates:[pts[0].lng, pts[0].lat] };
      } else if(pts.length === 2){
        props.TYPE = 'line';
        props.LENGTH_M = Math.round(distanceMeters(pts[0], pts[1]) * 10) / 10;
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
      var geomXml = '';
      if(pts.length === 1){
        name += ' (Цэг)';
        geomXml = '<Point><coordinates>'+toKmlCoords(pts,false)+'</coordinates></Point>';
      } else if(pts.length === 2){
        var d = distanceMeters(pts[0], pts[1]);
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
        var closed = pts.length >= 3;
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
    toast('SHP сан ачааллаж байна…');
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

