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
        lyr = d.toLayer(QgsProviderSublayerDetails.LayerOptions(project.transformContext()))
        if isinstance(lyr, QgsVectorLayer) and lyr.isValid() and lyr.geometryType() in (
                QgsWkbTypes.PolygonGeometry, QgsWkbTypes.LineGeometry):
            out.append(lyr)
    return out


def load_boundary_file(path, project):
    """KML / KMZ / GeoJSON / SHP … файлаас полигон, шугаман давхаргуудыг уншина.

    Төсөлд нэмэхгүй — дуудсан тал нэмнэ. Хоосон жагсаалт = хил олдсонгүй.
    """
    base = os.path.splitext(os.path.basename(path))[0]
    # Том KML / KMZ / GeoJSON-ийг нэг удаа индекстэй кэш рүү хөрвүүлж, дараа нь зөвхөн
    # харагдаж буй хэсгийг уншина (fastload-ийг үз).
    layers, cached = [], False
    if fastload.is_heavy(path):
        read_path = None
        if path.lower().endswith(".kmz"):
            try:
                if not _sublayers(path, project):
                    read_path = _kmz_to_kml(path)
            except Exception:
                read_path = _kmz_to_kml(path)
        layers, cached = fastload.load(path, project, read_path=read_path)
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


class Result:
    """rows: [(нэр, га, хувь)], target_ha: талбайн нийт хэмжээ, layer: үр дүнгийн давхарга."""

    def __init__(self):
        self.rows = []
        self.target_ha = 0.0
        self.layer = None
        self.error = ""


def analyse(project, target, boundary, name_field="", only_selected=False,
            include_rest=True, min_share=0.0):
    """Талбай (target)-г хилийн давхарга (boundary)-тай давхцуулна.

    Талбайг WGS84 эллипсоид дээр хэмжинэ. min_share (%)-аас бага хэсгийг (хилийн
    зураглалын зөрүүнээс үүсэх нарийн зурвас) хасна.
    """
    res = Result()
    tgt = _union(target, only_selected)
    if tgt is None:
        res.error = "Судалгааны талбайн давхаргад полигон (эсвэл битүү шугам) олдсонгүй."
        return res
    # Эллипсоид дээрх талбайг оройнуудын хоорондох геодезийн шугамаар хэмждэг тул
    # цөөн оройтой урт ирмэгийг огтлоход хэсгүүдийн нийлбэр бүхэлтэйгээ зөрдөг.
    # Ирмэгийг нягтруулснаар хэсгүүдийн нийлбэр = нийт талбай болно.
    step = 0.01 if target.crs().isGeographic() else 1000.0
    tgt = tgt.densifyByDistance(step)

    da = QgsDistanceArea()
    da.setSourceCrs(target.crs(), project.transformContext())
    ell = project.ellipsoid()
    da.setEllipsoid(ell if ell and ell != "NONE" else "WGS84")
    total = da.measureArea(tgt)
    if total <= 0:
        res.error = "Судалгааны талбайн хэмжээ тэг байна."
        return res
    res.target_ha = total / 1e4

    to_target = QgsCoordinateTransform(boundary.crs(), target.crs(), project)
    to_target.setBallparkTransformsAreAppropriate(True)
    to_boundary = QgsCoordinateTransform(target.crs(), boundary.crs(), project)
    to_boundary.setBallparkTransformsAreAppropriate(True)
    req = QgsFeatureRequest()
    try:
        req.setFilterRect(to_boundary.transformBoundingBox(tgt.boundingBox()))
    except Exception:
        pass

    idx = boundary.fields().lookupField(name_field) if name_field else -1
    engine = QgsGeometry.createGeometryEngine(tgt.constGet())
    engine.prepareGeometry()
    pieces = {}   # нэр -> [geom]
    order = []
    for feat in boundary.getFeatures(req):
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
        name = name or f"{boundary.name()} {feat.id()}"
        if name not in pieces:
            pieces[name] = []
            order.append(name)
        pieces[name].append(part)

    feats = []
    covered = []
    for name in order:
        geom = QgsGeometry.unaryUnion(pieces[name]) if len(pieces[name]) > 1 \
            else pieces[name][0]
        area = da.measureArea(geom)
        share = area / total * 100.0
        if area <= 0 or share < min_share:
            continue
        covered.append(geom)
        feats.append((name, geom, area / 1e4, share))
    feats.sort(key=lambda r: -r[2])

    if include_rest:
        rest = tgt.difference(QgsGeometry.unaryUnion(covered)) if covered else QgsGeometry(tgt)
        if rest is not None and not rest.isEmpty():
            area = da.measureArea(rest)
            share = area / total * 100.0
            if share >= max(min_share, 0.01):
                feats.append((REST, rest, area / 1e4, share))

    geom_type = "MultiPolygon"
    layer = QgsVectorLayer(f"{geom_type}?crs={target.crs().authid()}",
                           f"Давхцал — {boundary.name()}", "memory")
    if not layer.crs().isValid():
        layer.setCrs(target.crs())
    pr = layer.dataProvider()
    pr.addAttributes([QgsField(F_NAME, QVariant.String),
                      QgsField(F_HA, QVariant.Double, "double", 20, 4),
                      QgsField(F_PCT, QVariant.Double, "double", 10, 3)])
    layer.updateFields()
    out = []
    for name, geom, ha, share in feats:
        f = QgsFeature(layer.fields())
        if not geom.isMultipart():
            geom.convertToMultiType()
        f.setGeometry(geom)
        f.setAttributes([name, round(ha, 4), round(share, 3)])
        out.append(f)
        res.rows.append((name, ha, share))
    pr.addFeatures(out)
    layer.updateExtents()
    layer.setCustomProperty(ROLE, boundary.id())
    # Хүснэгтийн хувийг энэ нийт хэмжээнээс тооцно (composer.table_data-г үз)
    layer.setCustomProperty("numan_map_maker/overlap_total_m2", total)
    style_result(layer)
    res.layer = layer
    if not res.rows:
        res.error = "Талбай энэ хилийн давхаргатай огт давхцаагүй байна."
    return res


# ---------------------------------------------------------------------------
# Загвар, бичээс
# ---------------------------------------------------------------------------
def style_result(layer, opacity=150):
    cats = []
    i = 0
    for feat in layer.getFeatures():
        name = feat[F_NAME]
        if name == REST:
            sym = QgsFillSymbol.createSimple({
                "color": "200,200,200,90", "outline_color": "#777777", "outline_width": "0.3",
                "style": "b_diagonal"})
        else:
            c = QColor(PALETTE[i % len(PALETTE)])
            i += 1
            sym = QgsFillSymbol.createSimple({
                "color": f"{c.red()},{c.green()},{c.blue()},{opacity}",
                "outline_color": c.darker(160).name(), "outline_width": "0.4"})
        cats.append(QgsRendererCategory(name, sym, name))
    layer.setRenderer(QgsCategorizedSymbolRenderer(F_NAME, cats))


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
        expression = (f'CASE WHEN "{F_NAME}" = \'{skip_value}\' THEN \'\' '
                      f'ELSE {expression} END')
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
