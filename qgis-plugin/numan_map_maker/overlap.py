# -*- coding: utf-8 -*-
"""Давхцлын шинжилгээ: судалгааны талбай аль хилийн (аймаг, сум, лиценз, ТХГ …)
талбайд хэдэн га, хэдэн хувиар хамаарч байгааг тооцож, сэдэвчилсэн давхарга үүсгэнэ.

Энэ модуль цонхноос (GUI) хамааралгүй.
"""
import hashlib
import os
import zipfile

from qgis.PyQt.QtCore import QVariant
from qgis.PyQt.QtGui import QColor, QFont
from qgis.core import (
    QgsApplication,
    QgsCategorizedSymbolRenderer,
    QgsCoordinateReferenceSystem,
    QgsCoordinateTransform,
    QgsDistanceArea,
    QgsFeature,
    QgsFeatureRequest,
    QgsField,
    QgsFillSymbol,
    QgsGeometry,
    QgsLineSymbol,
    QgsPalLayerSettings,
    QgsProviderRegistry,
    QgsProviderSublayerDetails,
    QgsRendererCategory,
    QgsSimpleFillSymbolLayer,
    QgsSimpleLineSymbolLayer,
    QgsTextBufferSettings,
    QgsTextFormat,
    QgsVectorLayer,
    QgsVectorLayerFeatureSource,
    QgsVectorLayerSimpleLabeling,
    QgsWkbTypes,
)

from . import fastload

ROLE = "numan_map_maker/overlap"       # үр дүнгийн давхаргад: хилийн давхаргын id
REST = "Давхцаагүй хэсэг"
F_NAME, F_HA, F_PCT = "ner", "talbai_ga", "huvi"

FILE_FILTER = ("Хилийн файл (*.kml *.kmz *.geojson *.json *.shp *.gpkg *.tab *.gml);;"
               "Бүх файл (*)")

PALETTE = ["#e41a1c", "#377eb8", "#4daf4a", "#984ea3", "#ff7f00", "#ffd92f", "#a65628",
           "#f781bf", "#1b9e77", "#66c2a5", "#8da0cb", "#e78ac3", "#a6d854", "#b3b3b3",
           "#fc8d62", "#7570b3"]

NAME_HINTS = ("name", "ner", "нэр", "aimag", "аймаг", "sum", "сум", "bag", "баг", "title",
              "license", "licence", "code", "dugaar", "id")


# ---------------------------------------------------------------------------
# Файл ачаалах
# ---------------------------------------------------------------------------
def _kmz_to_kml(path):
    """KMZ-ийг задалж доторх KML-ийн замыг буцаана (GDAL-д LIBKML байхгүй үед)."""
    st = os.stat(path)
    key = hashlib.md5(f"{path}|{st.st_size}|{int(st.st_mtime)}".encode("utf-8")).hexdigest()[:12]
    out_dir = os.path.join(QgsApplication.qgisSettingsDirPath(), "numan_map_maker", "kmz",
                           key)
    os.makedirs(out_dir, exist_ok=True)
    with zipfile.ZipFile(path) as z:
        names = [n for n in z.namelist() if n.lower().endswith(".kml")]
        if not names:
            return None
        names.sort(key=lambda n: (n.lower() != "doc.kml", len(n)))
        target = os.path.join(out_dir, os.path.splitext(os.path.basename(path))[0] + ".kml")
        if not os.path.exists(target):
            with open(target, "wb") as fh:
                fh.write(z.read(names[0]))
    return target


def _sublayers(path, project):
    out = []
    for d in QgsProviderRegistry.instance().querySublayers(path):
        lyr = d.toLayer(QgsProviderSublayerDetails.LayerOptions(
            fastload.transform_context(project)))
        if isinstance(lyr, QgsVectorLayer) and lyr.isValid() and lyr.geometryType() in (
                QgsWkbTypes.PolygonGeometry, QgsWkbTypes.LineGeometry):
            out.append(lyr)
    return out


def _kmz_read_path(path, project):
    """KMZ-ийг GDAL шууд уншиж чадахгүй бол задалсан KML-ийн замыг буцаана (эс бөгөөс None)."""
    if not path.lower().endswith(".kmz"):
        return None
    try:
        if _sublayers(path, project):
            return None
    except Exception:
        pass
    return _kmz_to_kml(path)


def prepare_file(path, context, task=None):
    """Арын урсгалд: том файлыг индекстэй кэш болгон бэлдэнэ (дараа нь load_boundary_file
    шууд уншина). context — үндсэн урсгалд авсан QgsCoordinateTransformContext."""
    if not fastload.is_heavy(path):
        return ""
    if task is not None:
        task.setProgress(5.0)
    return fastload.convert(path, context, read_path=_kmz_read_path(path, context))


def load_boundary_file(path, project):
    """KML / KMZ / GeoJSON / SHP … файлаас полигон, шугаман давхаргуудыг уншина.

    Төсөлд нэмэхгүй — дуудсан тал нэмнэ. Хоосон жагсаалт = хил олдсонгүй.
    """
    base = os.path.splitext(os.path.basename(path))[0]
    # Том KML / KMZ / GeoJSON-ийг нэг удаа индекстэй кэш рүү хөрвүүлж, дараа нь зөвхөн
    # харагдаж буй хэсгийг уншина (fastload-ийг үз).
    layers, cached = [], False
    if fastload.is_heavy(path):
        layers, cached = fastload.load(path, project, read_path=_kmz_read_path(path, project))
    if not cached:
        try:
            layers = _sublayers(path, project)
        except Exception:
            layers = []
        if not layers and path.lower().endswith(".kmz"):
            kml = _kmz_to_kml(path)
            if kml:
                layers = _sublayers(kml, project)
        for lyr in layers:
            fastload.ensure_index(lyr)
            fastload.tune(lyr)
    # Полигон нь шугамаас түрүүлнэ; хоосон давхаргыг хасна
    layers = [l for l in layers if l.featureCount() != 0]
    layers.sort(key=lambda l: l.geometryType() != QgsWkbTypes.PolygonGeometry)
    for lyr in layers:
        if len(layers) > 1:
            kind = "талбай" if lyr.geometryType() == QgsWkbTypes.PolygonGeometry else "шугам"
            sub = kind if cached or not lyr.name() or lyr.name() == base else lyr.name()
            lyr.setName(f"{base} — {sub}")
        else:
            lyr.setName(base)
    return layers


def guess_name_field(layer):
    """Нэр агуулсан байх магадлалтай талбарыг таамаглана ('' = олдсонгүй)."""
    fields = layer.fields()
    names = [f.name() for f in fields]
    for hint in NAME_HINTS:
        for n in names:
            if n.lower() == hint:
                return n
    for hint in NAME_HINTS:
        for n in names:
            if hint in n.lower() and fields.field(n).type() == QVariant.String:
                return n
    for f in fields:
        if f.type() == QVariant.String:
            return f.name()
    return names[0] if names else ""


# ---------------------------------------------------------------------------
# Геометр
# ---------------------------------------------------------------------------
def as_polygon(geom):
    """Полигон бол хэвээр; битүү (эсвэл битүүлж болох) шугам бол полигон болгоно.

    KML-ээс импортолсон хил ихэвчлэн шугам хэлбэртэй ирдэг.
    """
    if geom is None or geom.isEmpty():
        return None
    t = geom.type()
    if t == QgsWkbTypes.PolygonGeometry:
        g = geom
    elif t == QgsWkbTypes.LineGeometry:
        parts = geom.asMultiPolyline() if geom.isMultipart() else [geom.asPolyline()]
        polys = []
        for pts in parts:
            if len(pts) < 3:
                continue
            ring = list(pts)
            if ring[0] != ring[-1]:
                ring.append(ring[0])
            if len(ring) >= 4:
                polys.append([ring])
        if not polys:
            return None
        g = QgsGeometry.fromMultiPolygonXY(polys)
    else:
        return None
    if not g.isGeosValid():
        g = g.makeValid()
    if g is None or g.isEmpty() or g.type() != QgsWkbTypes.PolygonGeometry:
        # makeValid цуглуулга буцаавал зөвхөн полигон хэсгийг авна
        if g is not None and not g.isEmpty():
            polys = [p for p in g.asGeometryCollection()
                     if p.type() == QgsWkbTypes.PolygonGeometry]
            g = QgsGeometry.unaryUnion(polys) if polys else None
        else:
            g = None
    return g


def _union_source(source, fids=None):
    """Feature source-оос полигонуудыг нэгтгэнэ (арын урсгалд ажиллах боломжтой)."""
    geoms = []
    req = QgsFeatureRequest()
    if fids is not None:
        req.setFilterFids(fids)
    for feat in source.getFeatures(req):
        g = as_polygon(feat.geometry())
        if g is not None:
            geoms.append(g)
    if not geoms:
        return None
    u = QgsGeometry.unaryUnion(geoms)
    return u if u is not None and not u.isEmpty() else None


def _union(layer, only_selected=False, transform=None):
    geoms = []
    req = QgsFeatureRequest()
    if only_selected and layer.selectedFeatureCount() > 0:
        req.setFilterFids(layer.selectedFeatureIds())
    for feat in layer.getFeatures(req):
        g = as_polygon(feat.geometry())
        if g is None:
            continue
        if transform is not None:
            g = QgsGeometry(g)
            g.transform(transform)
        geoms.append(g)
    if not geoms:
        return None
    u = QgsGeometry.unaryUnion(geoms)
    return u if u is not None and not u.isEmpty() else None


F_LEVEL, F_PARENT, F_KIDS = "tuvshin", "ehlel", "huuhed"
INDENT = "\u2003"          # таних тэмдэг, хүснэгтэд доод түвшний нэрийг догол мөрөөр


class Unit:
    """Нэг давхцсан нэгж (аймаг, сум, лиценз …)."""
    __slots__ = ("name", "geom", "ha", "share", "full", "level", "parent", "kids")

    def __init__(self, name, geom, ha, share, full=0.0):
        self.name, self.geom, self.ha, self.share, self.full = name, geom, ha, share, full
        self.level, self.parent, self.kids = 0, "", 0


class Result:
    """rows: [(нэр, га, хувь)], target_ha: талбайн нийт хэмжээ, layer: үр дүнгийн давхарга.

    units: [Unit] — шаталсан дарааллаар (эцэг нь хүүхдүүдийнхээ өмнө).
    nested: нэгжүүд бие биеэ агуулж байгаа (аймаг ⊃ сум ⊃ баг) эсэх.
    """

    def __init__(self):
        self.rows = []
        self.units = []
        self.target_ha = 0.0
        self.total_m2 = 0.0
        self.layer = None
        self.error = ""
        self.nested = False
        self.boundary_name = ""
        self.boundary_id = ""


def prepare(project, target, boundary, name_field="", only_selected=False,
            include_rest=True, min_share=0.0):
    """Үндсэн урсгалд: арын урсгалд хэрэгтэй бүх зүйлийг бэлдэнэ (давхаргын хуулбар эх үүсвэр)."""
    ell = project.ellipsoid()
    return {
        "tsrc": QgsVectorLayerFeatureSource(target),
        "tcrs": QgsCoordinateReferenceSystem(target.crs()),
        "tfids": list(target.selectedFeatureIds())
        if only_selected and target.selectedFeatureCount() > 0 else None,
        "bsrc": QgsVectorLayerFeatureSource(boundary),
        "bcrs": QgsCoordinateReferenceSystem(boundary.crs()),
        "bname": boundary.name(),
        "bid": boundary.id(),
        "name_idx": boundary.fields().lookupField(name_field) if name_field else -1,
        "ctx": project.transformContext(),
        "ellipsoid": ell if ell and ell != "NONE" else "WGS84",
        "include_rest": include_rest,
        "min_share": min_share,
    }


def _contains_share(outer, inner):
    """inner-ийн хэдэн хувь нь outer дотор байна (хавтгай талбайгаар, 0..1)."""
    a = inner.area()
    if a <= 0:
        return 0.0
    try:
        x = inner.intersection(outer)
    except Exception:
        return 0.0
    return (x.area() / a) if x is not None and not x.isEmpty() else 0.0


def build_hierarchy(units, tolerance=0.99, max_units=300):
    """Нэгжүүд бие биеэ агуулж байвал (аймаг ⊃ сум ⊃ баг) мод болгож эрэмбэлнэ.

    B нь A-д багтана: B-ийн давхцсан хэсгийн ≥99% нь A дотор, мөн хилийн бүтэн
    нэгжээрээ A нь B-ээс том. Хамгийн жижиг багтаах нэгж нь эцэг болно.
    Буцаах утга: (шаталсан дараалалтай нэгжүүд, давхар нэгж байгаа эсэх)
    """
    real = [u for u in units if u.name != REST]
    rest = [u for u in units if u.name == REST]
    if len(real) < 2 or len(real) > max_units:
        return sorted(real, key=lambda u: -u.ha) + rest, False
    for b in real:
        best = None
        for a in real:
            if a is b:
                continue
            bigger = a.full > b.full * 1.000001 if (a.full > 0 and b.full > 0) \
                else a.ha > b.ha * 1.000001
            if not bigger:
                continue
            if _contains_share(a.geom, b.geom) >= tolerance:
                key = a.full if a.full > 0 else a.ha
                if best is None or key < (best.full if best.full > 0 else best.ha):
                    best = a
        b.parent = best.name if best is not None else ""
    by_name = {u.name: u for u in real}
    kids = {}
    for u in real:
        kids.setdefault(u.parent, []).append(u)
    nested = any(u.parent for u in real)
    out = []

    def walk(parent, level, seen):
        for u in sorted(kids.get(parent, []), key=lambda x: -x.ha):
            if u.name in seen:          # тойрог үүсэхээс хамгаалах
                continue
            u.level = level
            u.kids = len(kids.get(u.name, []))
            out.append(u)
            walk(u.name, level + 1, seen | {u.name})

    walk("", 0, frozenset())
    # Ямар нэг шалтгаанаар модонд ороогүй нэгжийг (тойрог) эхний түвшинд нэмнэ
    missing = [u for u in real if u not in out]
    for u in missing:
        u.parent, u.level, u.kids = "", 0, 0
        out.append(u)
    del by_name
    return out + rest, nested


def compute(job, task=None):
    """Арын урсгалд ажиллах тооцоо: давхцсан хэсэг, талбай, хувь, шатлал. Result буцаана."""
    res = Result()
    res.boundary_name, res.boundary_id = job["bname"], job["bid"]
    tgt = _union_source(job["tsrc"], job["tfids"])
    if tgt is None:
        res.error = "Судалгааны талбайн давхаргад полигон (эсвэл битүү шугам) олдсонгүй."
        return res
    tcrs, bcrs, ctx = job["tcrs"], job["bcrs"], job["ctx"]
    # Эллипсоид дээрх талбайг оройнуудын хоорондох геодезийн шугамаар хэмждэг тул
    # цөөн оройтой урт ирмэгийг огтлоход хэсгүүдийн нийлбэр бүхэлтэйгээ зөрдөг.
    # Ирмэгийг нягтруулснаар хэсгүүдийн нийлбэр = нийт талбай болно.
    step = 0.01 if tcrs.isGeographic() else 1000.0
    tgt = tgt.densifyByDistance(step)

    da = QgsDistanceArea()
    da.setSourceCrs(tcrs, ctx)
    da.setEllipsoid(job["ellipsoid"])
    total = da.measureArea(tgt)
    if total <= 0:
        res.error = "Судалгааны талбайн хэмжээ тэг байна."
        return res
    res.target_ha = total / 1e4
    res.total_m2 = total

    to_target = QgsCoordinateTransform(bcrs, tcrs, ctx)
    to_target.setBallparkTransformsAreAppropriate(True)
    to_boundary = QgsCoordinateTransform(tcrs, bcrs, ctx)
    to_boundary.setBallparkTransformsAreAppropriate(True)
    req = QgsFeatureRequest()
    try:
        req.setFilterRect(to_boundary.transformBoundingBox(tgt.boundingBox()))
    except Exception:
        pass
    src = job["bsrc"]
    try:
        n_total = max(1, int(src.featureCount()))
    except Exception:
        n_total = 0

    idx = job["name_idx"]
    engine = QgsGeometry.createGeometryEngine(tgt.constGet())
    engine.prepareGeometry()
    pieces, full, order = {}, {}, []
    for n, feat in enumerate(src.getFeatures(req)):
        if task is not None:
            if task.isCanceled():
                return res
            if n_total and n % 50 == 0:
                task.setProgress(min(90.0, 90.0 * n / n_total))
        g = as_polygon(feat.geometry())
        if g is None:
            continue
        g = QgsGeometry(g)
        try:
            g.transform(to_target)
        except Exception:
            continue
        if not engine.intersects(g.constGet()):
            continue
        g = g.densifyByDistance(step)
        part = tgt.intersection(g)
        if part is None or part.isEmpty():
            continue
        if part.type() != QgsWkbTypes.PolygonGeometry:
            polys = [p for p in part.asGeometryCollection()
                     if p.type() == QgsWkbTypes.PolygonGeometry]
            if not polys:
                continue
            part = QgsGeometry.unaryUnion(polys)
        name = ""
        if idx >= 0:
            val = feat.attribute(idx)
            name = "" if val is None or str(val) == "NULL" else str(val).strip()
        name = name or f"{job['bname']} {feat.id()}"
        if name not in pieces:
            pieces[name] = []
            full[name] = 0.0
            order.append(name)
        pieces[name].append(part)
        try:
            full[name] += da.measureArea(g)
        except Exception:
            pass

    units, covered = [], []
    for name in order:
        geom = QgsGeometry.unaryUnion(pieces[name]) if len(pieces[name]) > 1 \
            else pieces[name][0]
        area = da.measureArea(geom)
        share = area / total * 100.0
        # Хилийн зөрүүнээс үүсэх нарийн зурвасыг хасна. Гэхдээ том талбайд жижиг нэгж
        # (жишээ нь улсын хэмжээнд лиценз) хувиараа бага ч 1 га-аас том бол үлдээнэ.
        if area <= 0 or (share < job["min_share"] and area < 1e4):
            continue
        covered.append(geom)
        units.append(Unit(name, geom, area / 1e4, share, full.get(name, 0.0)))

    if job["include_rest"]:
        rest = tgt.difference(QgsGeometry.unaryUnion(covered)) if covered else QgsGeometry(tgt)
        if rest is not None and not rest.isEmpty():
            area = da.measureArea(rest)
            share = area / total * 100.0
            if share >= max(job["min_share"], 0.01):
                units.append(Unit(REST, rest, area / 1e4, share))
    if task is not None:
        task.setProgress(95.0)
    res.units, res.nested = build_hierarchy(units)
    res.rows = [(u.name, u.ha, u.share) for u in res.units]
    if not any(u.name != REST for u in res.units):
        res.error = "Талбай энэ хилийн давхаргатай огт давхцаагүй байна."
    return res


def build_layer(res, target_crs):
    """Үндсэн урсгалд: тооцооны үр дүнгээс өнгөт давхарга үүсгэнэ (res.layer-т онооно)."""
    layer = QgsVectorLayer(f"MultiPolygon?crs={target_crs.authid()}",
                           f"Давхцал — {res.boundary_name}", "memory")
    if not layer.crs().isValid():
        layer.setCrs(target_crs)
    pr = layer.dataProvider()
    pr.addAttributes([QgsField(F_NAME, QVariant.String),
                      QgsField(F_HA, QVariant.Double, "double", 20, 4),
                      QgsField(F_PCT, QVariant.Double, "double", 10, 3),
                      QgsField(F_LEVEL, QVariant.Int),
                      QgsField(F_PARENT, QVariant.String),
                      QgsField(F_KIDS, QVariant.Int)])
    layer.updateFields()
    out = []
    for u in res.units:
        f = QgsFeature(layer.fields())
        geom = QgsGeometry(u.geom)
        if not geom.isMultipart():
            geom.convertToMultiType()
        f.setGeometry(geom)
        f.setAttributes([u.name, round(u.ha, 4), round(u.share, 3), u.level, u.parent,
                         u.kids])
        out.append(f)
    pr.addFeatures(out)
    layer.updateExtents()
    layer.setCustomProperty(ROLE, res.boundary_id)
    # Хүснэгтийн хувийг энэ нийт хэмжээнээс тооцно (composer.table_data-г үз)
    layer.setCustomProperty("numan_map_maker/overlap_total_m2", res.total_m2)
    layer.setCustomProperty("numan_map_maker/overlap_nested", bool(res.nested))
    style_result(layer)
    res.layer = layer
    return layer


def analyse(project, target, boundary, name_field="", only_selected=False,
            include_rest=True, min_share=0.0):
    """Талбай (target)-г хилийн давхарга (boundary)-тай давхцуулна (нэг урсгалд, шууд).

    Цонхноос арын горимд ажиллуулахдаа prepare → compute (арын урсгал) → build_layer.
    """
    res = compute(prepare(project, target, boundary, name_field, only_selected,
                          include_rest, min_share))
    if res.units:
        build_layer(res, target.crs())
    return res


# ---------------------------------------------------------------------------
# Загвар, бичээс
# ---------------------------------------------------------------------------
def style_result(layer, opacity=150):
    """Нэгж бүрд өнгө онооно. Давхар нэгжтэй (аймаг ⊃ сум ⊃ баг) бол хамгийн доод түвшний
    нэгжүүдийг өнгөөр дүүргэж, тэдгээрийг агуулах дээд нэгжүүдийг (аймаг, сум) зөвхөн
    хүрээ шугамаар — өнгө нь бие биеэ дарж бүдгэрэхгүй."""
    fields = layer.fields()
    has_tree = fields.lookupField(F_KIDS) >= 0
    feats = list(layer.getFeatures())
    max_level = max([int(f[F_LEVEL] or 0) for f in feats] + [0]) if has_tree else 0
    cats = []
    i = 0
    edge_colors = ["#222222", "#7b1fa2", "#00695c", "#bf360c"]
    for feat in feats:
        name = feat[F_NAME]
        level = int(feat[F_LEVEL] or 0) if has_tree else 0
        kids = int(feat[F_KIDS] or 0) if has_tree else 0
        label = (INDENT * level) + str(name)
        if name == REST:
            sym = QgsFillSymbol.createSimple({
                "color": "200,200,200,90", "outline_color": "#777777", "outline_width": "0.3",
                "style": "b_diagonal"})
        elif kids > 0:
            width = max(0.5, 1.4 - 0.35 * level)
            sym = QgsFillSymbol.createSimple({
                "style": "no", "outline_color": edge_colors[level % len(edge_colors)],
                "outline_width": f"{width:.2f}",
                "outline_style": "solid" if level == 0 else "dash"})
            # Дээд түвшний хүрээ доод нэгжүүдийн өнгөн дээр зурагдана
            sym.symbolLayer(0).setRenderingPass(1 + max_level - level)
        else:
            c = QColor(PALETTE[i % len(PALETTE)])
            i += 1
            sym = QgsFillSymbol.createSimple({
                "color": f"{c.red()},{c.green()},{c.blue()},{opacity}",
                "outline_color": c.darker(160).name(), "outline_width": "0.4"})
        cats.append(QgsRendererCategory(name, sym, label))
    renderer = QgsCategorizedSymbolRenderer(F_NAME, cats)
    if has_tree and any(int(f[F_KIDS] or 0) > 0 for f in feats):
        renderer.setUsingSymbolLevels(True)
    layer.setRenderer(renderer)


LABEL_MODES = {
    "name": f'"{F_NAME}"',
    "ha": f'"{F_NAME}" || \'\\n\' || format_number("{F_HA}", 1) || \' га\'',
    "pct": f'"{F_NAME}" || \'\\n\' || format_number("{F_PCT}", 1) || \'%\'',
    "both": f'"{F_NAME}" || \'\\n\' || format_number("{F_HA}", 1) || \' га (\' || '
            f'format_number("{F_PCT}", 1) || \'%)\'',
}


def _text_format(family, size, bold=True):
    f = QFont(family)
    f.setBold(bold)
    tf = QgsTextFormat()
    tf.setFont(f)
    tf.setSize(size)
    tf.setColor(QColor("#000000"))
    if bold and hasattr(tf, "setForcedBold"):
        tf.setForcedBold(True)
    buf = QgsTextBufferSettings()
    buf.setEnabled(True)
    buf.setSize(0.8)
    buf.setColor(QColor(255, 255, 255))
    tf.setBuffer(buf)
    return tf


def set_labels(layer, expression, family="Arial", size=8.0, is_expression=True,
               skip_value=None):
    """Давхаргын объектуудын нэрийг зураг дээр бичнэ. expression хоосон бол бичээсийг унтраана."""
    if not expression:
        layer.setLabelsEnabled(False)
        layer.triggerRepaint()
        return
    pal = QgsPalLayerSettings()
    if skip_value is not None and is_expression:
        cond = f'"{F_NAME}" = \'{skip_value}\''
        # Дээд түвшний нэгжийн (аймаг, сум) нэрийг бичихгүй: доод нэгжүүдийн нэр давхцахгүй
        if layer.fields().lookupField(F_KIDS) >= 0:
            cond += f' OR coalesce("{F_KIDS}", 0) > 0'
        expression = f"CASE WHEN {cond} THEN '' ELSE {expression} END"
    pal.fieldName = expression
    pal.isExpression = is_expression
    pal.setFormat(_text_format(family, size))
    try:
        pal.placement = QgsPalLayerSettings.Horizontal
    except AttributeError:
        pass
    if layer.geometryType() == QgsWkbTypes.LineGeometry:
        try:
            pal.placement = QgsPalLayerSettings.Curved
        except AttributeError:
            pass
    layer.setLabeling(QgsVectorLayerSimpleLabeling(pal))
    layer.setLabelsEnabled(True)
    layer.triggerRepaint()


def outline_symbol(layer, color="#111111", width=0.6, dash=False, halo=True):
    """Хилийн давхаргыг дүүргэлтгүй хүрээ шугамаар харуулах тэмдэг (полигон, шугам).

    halo: шугамын доор цагаан зурвас тавина — сансрын зураг зэрэг бараан фон дээр ч,
    цайвар фон дээр ч ялгарч харагдана.
    """
    kind = layer.geometryType()
    style = "dash" if dash else "solid"
    under = str(float(width) + 0.9)
    if kind == QgsWkbTypes.PolygonGeometry:
        top = {"style": "no", "outline_color": color, "outline_width": str(width),
               "outline_style": style, "joinstyle": "round"}
        if not halo:
            return QgsFillSymbol.createSimple(top)
        sym = QgsFillSymbol.createSimple({"style": "no", "outline_color": "255,255,255,200",
                                          "outline_width": under, "joinstyle": "round"})
        # Давхаргыг шууд үүсгэнэ: түр symbol-оос авч хуулбарлавал санах ойн алдаа гарна
        sym.appendSymbolLayer(QgsSimpleFillSymbolLayer.create(top))
        return sym
    if kind == QgsWkbTypes.LineGeometry:
        top = {"color": color, "width": str(width), "line_style": style,
               "joinstyle": "round", "capstyle": "round"}
        if not halo:
            return QgsLineSymbol.createSimple(top)
        sym = QgsLineSymbol.createSimple({"color": "255,255,255,200", "width": under,
                                          "joinstyle": "round", "capstyle": "round"})
        sym.appendSymbolLayer(QgsSimpleLineSymbolLayer.create(top))
        return sym
    return None
