  // ---------- Import: KML / GPX / SHP(zip) / GeoJSON ----------
  // Every importer below normalizes its source format down to a small list
  // of { name, color, points:[{lat,lng},...] } shapes, which then get pushed
  // onto shapes[] the same way any other shape-creation path does (pushUndo
  // + redrawAll), so imported data is fully editable afterwards.

  function shapeFromGeoJSONGeometry(geom, name, color){
    if(!geom) return [];
    var out = [];
    function ring2pts(ring){
      // GeoJSON rings repeat the first point as the last; drop the closing
      // duplicate since shapes[] stores polygons open (see toKmlCoords/shapesToGeoJSON).
      var pts = ring.map(function(c){ return { lat:c[1], lng:c[0] }; });
      if(pts.length > 1){
        var a = pts[0], b = pts[pts.length-1];
        if(Math.abs(a.lat-b.lat) < 1e-12 && Math.abs(a.lng-b.lng) < 1e-12) pts.pop();
      }
      return pts;
    }
    switch(geom.type){
      case 'Point':
        out.push({ name:name, color:color, points:[{ lat:geom.coordinates[1], lng:geom.coordinates[0] }] });
        break;
      case 'MultiPoint':
        geom.coordinates.forEach(function(c, i){
          out.push({ name:name+(geom.coordinates.length>1?' '+(i+1):''), color:color, points:[{ lat:c[1], lng:c[0] }] });
        });
        break;
      case 'LineString':
        out.push({ name:name, color:color, points: geom.coordinates.map(function(c){ return { lat:c[1], lng:c[0] }; }) });
        break;
      case 'MultiLineString':
        geom.coordinates.forEach(function(line, i){
          out.push({ name:name+(geom.coordinates.length>1?' '+(i+1):''), color:color, points: line.map(function(c){ return { lat:c[1], lng:c[0] }; }) });
        });
        break;
      case 'Polygon':
        out.push({ name:name, color:color, points: ring2pts(geom.coordinates[0]) });
        break;
      case 'MultiPolygon':
        geom.coordinates.forEach(function(poly, i){
          out.push({ name:name+(geom.coordinates.length>1?' '+(i+1):''), color:color, points: ring2pts(poly[0]) });
        });
        break;
      case 'GeometryCollection':
        (geom.geometries||[]).forEach(function(g){
          out = out.concat(shapeFromGeoJSONGeometry(g, name, color));
        });
        break;
    }
    return out;
  }

  function normalizeHexColor(c){
    if(!c) return null;
    c = String(c).trim();
    if(/^#[0-9a-fA-F]{6}$/.test(c)) return c;
    if(/^#[0-9a-fA-F]{3}$/.test(c)){
      return '#'+c[1]+c[1]+c[2]+c[2]+c[3]+c[3];
    }
    return null;
  }

  function geojsonToImportedShapes(fc){
    var features = fc.type === 'FeatureCollection' ? fc.features : (fc.type === 'Feature' ? [fc] : [{ type:'Feature', properties:{}, geometry:fc }]);
    var result = [];
    (features||[]).forEach(function(f, idx){
      var props = f.properties || {};
      var name = props.NAME || props.name || props.Name || props.title || null;
      var color = normalizeHexColor(props.COLOR || props.color || props.stroke || props['marker-color']);
      var shapes2 = shapeFromGeoJSONGeometry(f.geometry, name || ('Импорт '+(idx+1)), color);
      result = result.concat(shapes2);
    });
    return result;
  }

  function kmlColorToHex(kmlColor){
    // KML colors are aabbggrr; we want #rrggbb.
    if(!kmlColor || kmlColor.length < 8) return null;
    var bb = kmlColor.substr(2,2), gg = kmlColor.substr(4,2), rr = kmlColor.substr(6,2);
    return '#'+rr+gg+bb;
  }

  function parseKML(text){
    var xml = new DOMParser().parseFromString(text, 'application/xml');
    if(xml.querySelector('parsererror')) throw new Error('KML parse error');

    // Collect <Style id="..."> line colors so Placemarks that reference them via styleUrl pick up a color.
    var styleColors = {};
    xml.querySelectorAll('Style').forEach(function(styleEl){
      var id = styleEl.getAttribute('id');
      if(!id) return;
      var lineColor = styleEl.querySelector('LineStyle > color, PolyStyle > color');
      if(lineColor) styleColors[id] = kmlColorToHex(lineColor.textContent.trim());
    });

    var results = [];
    xml.querySelectorAll('Placemark').forEach(function(pm, idx){
      var nameEl = pm.querySelector('name');
      var name = nameEl ? nameEl.textContent.trim() : ('Импорт '+(idx+1));
      var color = null;
      var inlineColor = pm.querySelector('LineStyle > color, PolyStyle > color');
      if(inlineColor) color = kmlColorToHex(inlineColor.textContent.trim());
      if(!color){
        var styleUrl = pm.querySelector('styleUrl');
        if(styleUrl){
          var ref = styleUrl.textContent.trim().replace(/^#/, '');
          if(styleColors[ref]) color = styleColors[ref];
        }
      }

      function coordsToPts(coordText){
        return coordText.trim().split(/\s+/).filter(Boolean).map(function(tuple){
          var parts = tuple.split(',');
          return { lat: parseFloat(parts[1]), lng: parseFloat(parts[0]) };
        }).filter(function(p){ return isFinite(p.lat) && isFinite(p.lng); });
      }
      function dedupeClosingPt(pts){
        if(pts.length > 1){
          var a = pts[0], b = pts[pts.length-1];
          if(Math.abs(a.lat-b.lat) < 1e-9 && Math.abs(a.lng-b.lng) < 1e-9) pts.pop();
        }
        return pts;
      }

      pm.querySelectorAll('Point > coordinates').forEach(function(el, i){
        var pts = coordsToPts(el.textContent);
        if(pts.length) results.push({ name: name+(i>0?' '+(i+1):''), color:color, points:[pts[0]] });
      });
      pm.querySelectorAll('LineString > coordinates').forEach(function(el, i){
        var pts = coordsToPts(el.textContent);
        if(pts.length) results.push({ name: name+(i>0?' '+(i+1):''), color:color, points:pts });
      });
      pm.querySelectorAll('Polygon').forEach(function(polyEl, i){
        var outerEl = polyEl.querySelector('outerBoundaryIs coordinates');
        if(!outerEl) return;
        var pts = dedupeClosingPt(coordsToPts(outerEl.textContent));
        if(pts.length) results.push({ name: name+(i>0?' '+(i+1):''), color:color, points:pts });
      });
    });
    return results;
  }

  function parseGPX(text){
    var xml = new DOMParser().parseFromString(text, 'application/xml');
    if(xml.querySelector('parsererror')) throw new Error('GPX parse error');
    var results = [];

    xml.querySelectorAll('wpt').forEach(function(el, idx){
      var lat = parseFloat(el.getAttribute('lat')), lng = parseFloat(el.getAttribute('lon'));
      if(!isFinite(lat) || !isFinite(lng)) return;
      var nameEl = el.querySelector('name');
      var name = nameEl ? nameEl.textContent.trim() : ('Импорт цэг '+(idx+1));
      results.push({ name:name, color:null, points:[{ lat:lat, lng:lng }] });
    });

    xml.querySelectorAll('trk').forEach(function(trkEl, idx){
      var nameEl = trkEl.querySelector('name');
      var name = nameEl ? nameEl.textContent.trim() : ('Импорт зам '+(idx+1));
      var pts = [];
      trkEl.querySelectorAll('trkpt').forEach(function(pt){
        var lat = parseFloat(pt.getAttribute('lat')), lng = parseFloat(pt.getAttribute('lon'));
        if(isFinite(lat) && isFinite(lng)) pts.push({ lat:lat, lng:lng });
      });
      if(pts.length > 1){
        var a = pts[0], b = pts[pts.length-1];
        if(pts.length >= 3 && Math.abs(a.lat-b.lat) < 1e-9 && Math.abs(a.lng-b.lng) < 1e-9) pts.pop();
        results.push({ name:name, color:null, points:pts });
      } else if(pts.length === 1){
        results.push({ name:name, color:null, points:pts });
      }
    });

    xml.querySelectorAll('rte').forEach(function(rteEl, idx){
      var nameEl = rteEl.querySelector('name');
      var name = nameEl ? nameEl.textContent.trim() : ('Импорт маршрут '+(idx+1));
      var pts = [];
      rteEl.querySelectorAll('rtept').forEach(function(pt){
        var lat = parseFloat(pt.getAttribute('lat')), lng = parseFloat(pt.getAttribute('lon'));
        if(isFinite(lat) && isFinite(lng)) pts.push({ lat:lat, lng:lng });
      });
      if(pts.length) results.push({ name:name, color:null, points:pts });
    });

    return results;
  }

  // Adds parsed { name, color, points } entries to shapes[] and refreshes the map.
  function commitImportedShapes(imported, sourceLabel){
    imported = imported.filter(function(s){ return s.points && s.points.length > 0; });
    if(imported.length === 0){
      toast(sourceLabel+' файлаас дүрс олдсонгүй');
      return;
    }
    pushUndo();
    // If the only existing shape is the untouched blank starter shape, replace it instead of leaving an empty entry around.
    if(shapes.length === 1 && shapes[0].points.length === 0 && !shapes[0].name){
      shapes = [];
    }
    imported.forEach(function(s){
      var shape = { points: s.points };
      if(s.name) shape.name = s.name;
      if(s.color) shape.color = s.color;
      shapes.push(shape);
    });
    tapShapeIndex = shapes.length - 1;
    redrawAll();
    toast(sourceLabel+' импортлогдлоо ('+imported.length+' дүрс)');
  }

  function readFileAsText(file){
    return new Promise(function(resolve, reject){
      var reader = new FileReader();
      reader.onload = function(){ resolve(reader.result); };
      reader.onerror = function(){ reject(reader.error); };
      reader.readAsText(file);
    });
  }
  function readFileAsArrayBuffer(file){
    return new Promise(function(resolve, reject){
      var reader = new FileReader();
      reader.onload = function(){ resolve(reader.result); };
      reader.onerror = function(){ reject(reader.error); };
      reader.readAsArrayBuffer(file);
    });
  }

  function importOneFile(file){
    var lowerName = file.name.toLowerCase();
    var ext = lowerName.substring(lowerName.lastIndexOf('.') + 1);

    if(ext === 'kml'){
      return readFileAsText(file).then(function(text){
        commitImportedShapes(parseKML(text), 'KML');
      });
    }
    if(ext === 'gpx'){
      return readFileAsText(file).then(function(text){
        commitImportedShapes(parseGPX(text), 'GPX');
      });
    }
    if(ext === 'kmz'){
      return loadScriptWithFallback([
        'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
        'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js'
      ], function(){ return typeof JSZip !== 'undefined'; }).catch(function(){
        throw new Error('KMZ уншигч сан ачаалагдсангүй (интернэт холболтоо шалгана уу)');
      }).then(function(){
        return readFileAsArrayBuffer(file);
      }).then(function(buf){
        return JSZip.loadAsync(buf);
      }).then(function(zip){
        // KMZ is a zip with one main .kml file — conventionally doc.kml at
        // the root, but any top-level .kml works; prefer the shortest path
        // (root-level) if more than one is present.
        var kmlEntries = Object.keys(zip.files)
          .filter(function(name){ return /\.kml$/i.test(name) && !zip.files[name].dir; })
          .sort(function(a, b){ return a.split('/').length - b.split('/').length; });
        if(kmlEntries.length === 0) throw new Error('KMZ файлд .kml олдсонгүй');
        return zip.files[kmlEntries[0]].async('text');
      }).then(function(text){
        commitImportedShapes(parseKML(text), 'KMZ');
      });
    }
    if(ext === 'geojson' || ext === 'json'){
      return readFileAsText(file).then(function(text){
        var data = JSON.parse(text);
        commitImportedShapes(geojsonToImportedShapes(data), 'GeoJSON');
      });
    }
    if(ext === 'zip'){
      return loadScriptWithFallback([
        'https://cdnjs.cloudflare.com/ajax/libs/shpjs/6.2.0/shp.min.js',
        'https://cdn.jsdelivr.net/npm/shpjs@6.2.0/dist/shp.min.js'
      ], function(){ return typeof shp !== 'undefined'; }).catch(function(){
        throw new Error('SHP уншигч сан ачаалагдсангүй (интернэт холболтоо шалгана уу)');
      }).then(function(){
        return readFileAsArrayBuffer(file);
      }).then(function(buf){
        return shp(buf);
      }).then(function(data){
        // shpjs resolves to a FeatureCollection, or an array of them when the
        // zip bundles multiple layers.
        var all = [];
        var collections = Array.isArray(data) ? data : [data];
        collections.forEach(function(fc){ all = all.concat(geojsonToImportedShapes(fc)); });
        commitImportedShapes(all, 'SHP');
      });
    }

    toast('Дэмжигдэхгүй файлын төрөл: .'+ext);
    return Promise.resolve();
  }

  var btnImportFile = document.getElementById('btnImportFile');
  var importFileInput = document.getElementById('importFileInput');
  btnImportFile.addEventListener('click', function(){ importFileInput.click(); });
  importFileInput.addEventListener('change', function(){
    var files = Array.prototype.slice.call(this.files || []);
    if(files.length === 0) return;
    var chain = Promise.resolve();
    files.forEach(function(file){
      chain = chain.then(function(){ return importOneFile(file); }).catch(function(err){
        toast((err && err.message) || (file.name+' файлыг унших үед алдаа гарлаа'));
      });
    });
    importFileInput.value = ''; // allow re-selecting the same file later
  });

