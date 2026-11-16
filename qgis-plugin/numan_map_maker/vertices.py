# -*- coding: utf-8 -*-
"""Булангийн цэгийн солбицол: полигоны оройнуудыг дугаарлаж, зураг дээр тэмдэглэж,
солбицлыг хүснэгтээр (градус-минут-секунд, аравтын градус, UTM, төслийн проекц) гаргана.

Хэлбэрийг Нуман-Алтайн «Талбай тооцоологч» аппын солбицлын табтай ижил байлгасан.
"""
import hashlib

from qgis.PyQt.QtCore import QVariant
from qgis.PyQt.QtGui import QColor, QFont
from qgis.core import (
    QgsCoordinateReferenceSystem,
    QgsCoordinateTransform,
    QgsFeature,
    QgsFeatureRequest,
    QgsField,
    QgsGeometry,
    QgsMarkerSymbol,
    QgsPalLayerSettings,
    QgsPointXY,
    QgsSingleSymbolRenderer,
    QgsTextBufferSettings,
    QgsTextFormat,
    QgsVectorLayer,
    QgsVectorLayerSimpleLabeling,
    QgsWkbTypes,
)

ROLE = "numan_map_maker/vertices"     # тэмдэглэгээний давхаргад: эх давхаргын id
SIGN = "numan_map_maker/vertices_sign"
WGS84 = QgsCoordinateReferenceSystem("EPSG:4326")
MAX_POINTS = 3000                     # үүнээс олон оройтой бол хүснэгт уншигдахгүй

FORMATS = [
    ("Градус, минут, секунд (49°12′34.56″N)", "dms"),
    ("Градус, минут (49°12.5760′N)", "dm"),
    ("Аравтын градус (49.209600)", "dd"),
    ("UTM, метр (бүсийг автоматаар)", "utm"),
    ("Төслийн проекц", "project"),
]


# ---------------------------------------------------------------------------
# Оройнуудыг гаргах
# ---------------------------------------------------------------------------
def _rings(geom):
    """Полигоны гадна, дотор хүрээ; шугамын хэсгүүд; цэг — оройн жагсаалтууд."""
    t = geom.type()
    if t == QgsWkbTypes.PolygonGeometry:
        polys = geom.asMultiPolygon() if geom.isMultipart() else [geom.asPolygon()]
        for poly in polys:
            for ring in poly:
                pts = list(ring)
                if len(pts) > 1 and pts[0] == pts[-1]:
                    pts = pts[:-1]          # битүүлэх давхар оройг хасна
                if pts:
                    yield pts
    elif t == QgsWkbTypes.LineGeometry:
        lines = geom.asMultiPolyline() if geom.isMultipart() else [geom.asPolyline()]
        for line in lines:
            pts = list(line)
            if len(pts) > 2 and pts[0] == pts[-1]:
                pts = pts[:-1]
            if pts:
                yield pts
    elif t == QgsWkbTypes.PointGeometry:
        pts = geom.asMultiPoint() if geom.isMultipart() else [geom.asPoint()]
        if pts:
            yield list(pts)


def name_field(layer):
    from . import overlap
    return overlap.guess_name_field(layer)


def extract(layer, only_selected=False, limit=MAX_POINTS):
    """[(объектын нэр, [QgsPointXY давхаргын проекцоор])] — объект бүрийн дугаарлалт 1-ээс.

    Нэг объектын олон хэсэг / нүхний оройнууд дугаараа үргэлжлүүлнэ.
    limit-ээс олон орой байвал (None, нийт тоо) буцаана.
    """
    req = QgsFeatureRequest()
    if only_selected and layer.selectedFeatureCount() > 0:
        req.setFilterFids(layer.selectedFeatureIds())
    nf = name_field(layer)
    idx = layer.fields().lookupField(nf) if nf else -1
    out, total = [], 0
    for feat in layer.getFeatures(req):
        g = feat.geometry()
        if g is None or g.isEmpty():
            continue
        pts = [QgsPointXY(p) for ring in _rings(g) for p in ring]
        if not pts:
            continue
        total += len(pts)
        if total > limit:
            return None, total
        name = ""
        if idx >= 0:
            v = feat.attribute(idx)
            name = "" if v is None or str(v) == "NULL" else str(v)
        out.append((name or f"{layer.name()} {feat.id()}", pts))
    return out, total


# ---------------------------------------------------------------------------
# Хэлбэржүүлэлт
# ---------------------------------------------------------------------------
def _split(val, minutes_only=False, decimals=2):
    v = abs(val)
    if minutes_only:
        total = round(v * 60, decimals + 2)
        d = int(total // 60)
        m = total - d * 60
        if round(m, decimals + 2) >= 60:
            d, m = d + 1, 0.0
        return d, m
    scale = 10 ** decimals
    tot = round(v * 3600 * scale)
    d = tot // (3600 * scale)
    rem = tot - d * 3600 * scale
    m = rem // (60 * scale)
    s = (rem - m * 60 * scale) / scale
    return int(d), int(m), s


def fmt_dms(val, is_lat, decimals=2):
    d, m, s = _split(val, False, decimals)
    hemi = ("S" if val < 0 else "N") if is_lat else ("W" if val < 0 else "E")
    return f"{d}°{m:02d}′{s:0{3 + decimals if decimals else 2}.{decimals}f}″{hemi}"


def fmt_dm(val, is_lat, decimals=4):
    d, m = _split(val, True, decimals)
    hemi = ("S" if val < 0 else "N") if is_lat else ("W" if val < 0 else "E")
    return f"{d}°{m:0{3 + decimals}.{decimals}f}′{hemi}"


def utm_crs(lon, lat):
    zone = int((lon + 180) // 6) + 1
    zone = min(60, max(1, zone))
    return QgsCoordinateReferenceSystem(f"EPSG:{(32600 if lat >= 0 else 32700) + zone}")


def _num(v, decimals):
    return f"{v:,.{decimals}f}".replace(",", " ")


def table(project, layer, s):
    """Хүснэгтийн өгөгдөл.

    Буцаах утга: dict(head=[...], rows=[[...]], multi=bool, crs_note=str, error=str)
    Мөр бүр: [объектын нэр эсвэл "", дугаар, утга1, утга2].
    """
    out = {"head": [], "rows": [], "multi": False, "crs_note": "", "crs_short": "",
           "metric": False, "error": ""}
    data, total = extract(layer, bool(s.get("coord_selected")))
    if data is None:
        out["error"] = (f"{total} орой байна — хүснэгт уншигдахгүй. Цөөн объект сонгоод "
                        "«Зөвхөн сонгогдсон объект»-ыг чагтална уу.")
        return out
    if not data:
        out["error"] = "Давхаргад объект алга."
        return out
    fmt = s.get("coord_format") or "dms"
    latlon = (s.get("coord_order") or "latlon") == "latlon"
    ctx = project.transformContext()
    to_wgs = QgsCoordinateTransform(layer.crs(), WGS84, ctx)
    target = None
    if fmt == "utm":
        # Бүх цэгийг нэг бүсэд: давхаргын төвийн уртрагаар
        try:
            c = to_wgs.transform(layer.extent().center())
        except Exception:
            c = QgsPointXY(105, 47)
        target = utm_crs(c.x(), c.y())
        zone = target.authid()[-2:].lstrip("0")
        out["crs_note"] = f"WGS 84 / UTM {zone}{'N' if c.y() >= 0 else 'S'} бүс ({target.authid()})"
        out["crs_short"] = f"UTM {zone}{'N' if c.y() >= 0 else 'S'}"
        out["metric"] = True
        head = ("X (зүүн), м", "Y (хойд), м")
    elif fmt == "project":
        target = project.crs()
        out["crs_note"] = f"{target.description()} ({target.authid()})"
        out["crs_short"] = target.authid()
        geo = target.isGeographic()
        out["metric"] = not geo
        head = ("Уртраг", "Өргөрөг") if geo else ("X, м", "Y, м")
    else:
        out["crs_note"] = "WGS 84 (EPSG:4326)"
        out["crs_short"] = "WGS 84"
        head = ("Уртраг", "Өргөрөг")
    tr = QgsCoordinateTransform(layer.crs(), target, ctx) if target is not None else to_wgs

    out["multi"] = len(data) > 1
    if fmt in ("dms", "dm", "dd") or (fmt == "project" and target.isGeographic()):
        cols = ("Өргөрөг", "Уртраг") if latlon else ("Уртраг", "Өргөрөг")
    else:
        cols = head
    out["head"] = (["Талбай"] if out["multi"] else []) + ["№"] + list(cols)
    for name, pts in data:
        for i, p in enumerate(pts, 1):
            try:
                q = tr.transform(p)
            except Exception:
                continue
            if fmt in ("dms", "dm", "dd") or (fmt == "project" and target.isGeographic()):
                lon, lat = q.x(), q.y()
                if fmt == "dm":
                    a, b = fmt_dm(lat, True), fmt_dm(lon, False)
                elif fmt == "dd" or fmt == "project":
                    a, b = f"{lat:.6f}", f"{lon:.6f}"
                else:
                    a, b = fmt_dms(lat, True), fmt_dms(lon, False)
                vals = [a, b] if latlon else [b, a]
            else:
                vals = [_num(q.x(), 2), _num(q.y(), 2)]
            row = ([name if i == 1 else ""] if out["multi"] else []) + [str(i)] + vals
            out["rows"].append(row)
    return out


# ---------------------------------------------------------------------------
# Зураг дээрх дугаар
# ---------------------------------------------------------------------------
def _signature(layer, s):
    h = hashlib.md5()
    h.update(f"{layer.id()}|{bool(s.get('coord_selected'))}|"
             f"{sorted(layer.selectedFeatureIds()) if s.get('coord_selected') else ''}|"
             f"{s.get('font')}|{s.get('coord_mark_size')}".encode("utf-8"))
    data, _total = extract(layer, bool(s.get("coord_selected")))
    for name, pts in data or []:
        h.update(name.encode("utf-8"))
        for p in pts:
            h.update(f"{p.x():.6f},{p.y():.6f};".encode())
    return h.hexdigest()


def marks_layers(project):
    return [l for l in project.mapLayers().values() if l.customProperty(ROLE)]


def sync_marks(project, s):
    """Булангийн цэгийн дугаарын давхаргыг тохиргоотой тааруулна. Өөрчлөгдсөн бол True."""
    want = bool(s.get("coord_table")) and bool(s.get("coord_marks"))
    layer = project.mapLayer(s.get("coord_layer") or "") if want else None
    present = marks_layers(project)
    if layer is None or not isinstance(layer, QgsVectorLayer):
        if present:
            project.removeMapLayers([l.id() for l in present])
            return True
        return False
    sign = _signature(layer, s)
    if len(present) == 1 and present[0].customProperty(SIGN) == sign and \
            project.layerTreeRoot().findLayer(present[0].id()) is not None:
        return False
    if present:
        project.removeMapLayers([l.id() for l in present])
    data, _total = extract(layer, bool(s.get("coord_selected")))
    if not data:
        return bool(present)
    marks = QgsVectorLayer(f"Point?crs={layer.crs().authid()}", "Булангийн цэг", "memory")
    if not marks.crs().isValid():
        marks.setCrs(layer.crs())
    pr = marks.dataProvider()
    pr.addAttributes([QgsField("no", QVariant.Int), QgsField("ner", QVariant.String)])
    marks.updateFields()
    feats = []
    for name, pts in data:
        for i, p in enumerate(pts, 1):
            f = QgsFeature(marks.fields())
            f.setGeometry(QgsGeometry.fromPointXY(p))
            f.setAttributes([i, name])
            feats.append(f)
    pr.addFeatures(feats)
    marks.updateExtents()
    size = float(s.get("coord_mark_size") or 1.6)
    marks.setRenderer(QgsSingleSymbolRenderer(QgsMarkerSymbol.createSimple({
        "name": "circle", "color": "#e60000", "size": f"{size:.2f}",
        "outline_color": "#ffffff", "outline_width": "0.3"})))
    pal = QgsPalLayerSettings()
    pal.fieldName = "no"
    tf = QgsTextFormat()
    font = QFont(s.get("font") or "Arial")
    font.setBold(True)
    tf.setFont(font)
    tf.setSize(max(5.0, float(s.get("coord_font_size") or 7.0)))
    tf.setColor(QColor("#b00000"))
    buf = QgsTextBufferSettings()
    buf.setEnabled(True)
    buf.setSize(0.8)
    buf.setColor(QColor(255, 255, 255))
    tf.setBuffer(buf)
    pal.setFormat(tf)
    try:
        pal.placement = QgsPalLayerSettings.OrderedPositionsAroundPoint
    except AttributeError:
        pass
    pal.dist = 0.8
    marks.setLabeling(QgsVectorLayerSimpleLabeling(pal))
    marks.setLabelsEnabled(True)
    marks.setCustomProperty(ROLE, layer.id())
    marks.setCustomProperty(SIGN, sign)
    project.addMapLayer(marks, False)
    project.layerTreeRoot().insertLayer(0, marks)
    return True
