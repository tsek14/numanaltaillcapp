# -*- coding: utf-8 -*-
"""Тохиргооны толь бичгээс (dict) QGIS-ийн хэвлэлийн layout угсрах логик.

Энэ модуль нь цонх (GUI)-оос хамааралгүй тул headless орчинд ч ажиллана.
"""
import datetime
import math
import os

from qgis.PyQt.QtCore import Qt, QPointF, QRectF
from qgis.PyQt.QtGui import QColor, QFont, QImageReader, QPolygonF
from qgis.core import (
    QgsCategorizedSymbolRenderer,
    QgsCentroidFillSymbolLayer,
    QgsCoordinateReferenceSystem,
    QgsCoordinateTransform,
    QgsDistanceArea,
    QgsEmbeddedSymbolRenderer,
    QgsExpression,
    QgsExpressionContext,
    QgsExpressionContextUtils,
    QgsFillSymbol,
    QgsLayoutFrame,
    QgsLayoutItem,
    QgsLayoutItemLabel,
    QgsLayoutItemLegend,
    QgsLayoutItemManualTable,
    QgsLayoutItemMap,
    QgsLayoutItemMapGrid,
    QgsLayoutItemMapOverview,
    QgsLayoutItemPage,
    QgsLayoutItemPicture,
    QgsLayoutItemPolyline,
    QgsLayoutItemScaleBar,
    QgsLayoutMeasurement,
    QgsLayoutMultiFrame,
    QgsLayoutPoint,
    QgsLayoutSize,
    QgsLegendStyle,
    QgsLineSymbol,
    QgsMapLayerLegendUtils,
    QgsMarkerSymbol,
    QgsPathResolver,
    QgsPointXY,
    QgsProject,
    QgsRasterLayer,
    QgsRectangle,
    QgsSymbolLayerUtils,
    QgsTableCell,
    QgsTextFormat,
    QgsUnitTypes,
    QgsVectorLayer,
)

from . import basemaps

PAGE_SIZES = {  # мм, босоо чиглэлээр
    "A5": (148, 210),
    "A4": (210, 297),
    "A3": (297, 420),
    "A2": (420, 594),
    "A1": (594, 841),
    "A0": (841, 1189),
}

DEFAULT_NORTH_ARROW = ":/images/north_arrows/layout_default_north_arrow.svg"

DEFAULTS = {
    # Хуудас
    "page_size": "A4",
    "page_w": 297.0,
    "page_h": 210.0,
    "orientation": "landscape",
    "margin": 8.0,
    "font": "Arial",
    "map_frame": True,
    # Гарчиг, тайлбар
    "title": "",
    "subtitle": "",
    "title_size": 16.0,
    "title_color": "#000000",
    "title_place": "outside",  # outside | inside
    "caption": "",
    "caption_size": 11.0,
    "credits": "",
    # Суурь зураг (фон), overlay
    "basemap": "",
    "basemap_file": "",   # basemap == "file" үед: OsmAnd .sqlitedb эсвэл .mbtiles
    "overlays": [],
    "overlays_on_top": False,
    "mapbox_token": "",
    "basemap_credit": True,
    # Зургийн хамрах хүрээ
    "extent_mode": "canvas",  # canvas | visible | layer
    "extent_layer": "",
    "extent_buffer": 5.0,
    "scale_mode": "auto",  # auto | round | fixed
    "scale": 100000.0,
    # Солбицлын тор
    "grid": True,
    "grid_crs": "geo",  # geo | map
    "grid_interval_geo": 0.0,  # градус, 0 = авто
    "grid_interval_map": 0.0,  # зургийн нэгж, 0 = авто
    "grid_style": "frame",  # frame | cross | lines
    "grid_frame": "ticks",  # ticks | zebra | line
    "grid_labels": True,
    "grid_font_size": 7.0,
    # Таних тэмдэг
    "legend": True,
    "legend_title": "Таних тэмдэг",
    "legend_pos": "BL",  # TL | TR | BL | BR | OUT
    "legend_out_width": 62.0,
    "legend_cols": 1,
    "legend_font_size": 8.0,
    "legend_filter": False,
    "legend_skip_basemap": True,
    "legend_bg": True,
    "legend_titles": {},  # {layer_id: таних тэмдэг дэх давхаргын нэр}
    "legend_order": [],   # [layer_id] — хоосон бол давхаргын модны дарааллаар
    "legend_hidden": [],  # [layer_id] — таних тэмдэгт оруулахгүй давхаргууд
    "legend_kml": True,   # KML-ийн объект бүрийн загварыг таних тэмдэгт гаргах
    # Хойд зүгийн сум
    "north": True,
    "north_pos": "TR",
    "north_size": 16.0,
    "north_svg": "arrows/NorthArrow_10.svg",  # "" = QGIS-ийн үндсэн сум
    # Масштабын шугам
    "scalebar": True,
    "scalebar_pos": "BR",
    "scalebar_style": "Double Box",
    "scalebar_segments": 4,
    "scale_text": False,
    # Талбайн хүснэгт
    "table": False,
    "table_layer": "",
    "table_field": "",
    "table_unit": "km2",  # km2 | ha | m2
    "table_decimals": 2,
    "table_head1": "Ангилал",
    "table_head2": "",
    "table_total": True,
    "table_percent": False,  # «Хувь, %» багана нэмэх
    "table_pos": "TR",
    "table_font_size": 8.0,
    # Зургийн дугаар (Зураг 1.66. …)
    "caption_auto": False,
    "caption_prefix": "Зураг",
    "fig_chapter": "1",
    "fig_no": 1,
    "fig_increment": True,
    # Газрын зурагт оруулахгүй давхаргууд (цуврал зурагт ашиглана)
    "map_hidden_layers": [],
    "map_shown_layers": [],   # давхаргын самбарт нуугдсан ч зурагт оруулах
    "extent_rect": [],  # extent_mode == "rect" үед [xmin, ymin, xmax, ymax]
    # Байршлын жижиг зураг
    "inset": False,
    "inset_pos": "TL",
    "inset_size": 55.0,
    "inset_extent": "mongolia",  # mongolia | factor | layer
    "inset_factor": 10.0,
    "inset_layer": "",
    "inset_base": "esri_natgeo",
    # Лого
    "logo": "",
    "logo_pos": "TL",
    "logo_size": 28.0,
    # Мэдээллийн хүснэгт
    "info": False,
    "info_org": "",
    "info_author": "",
    "info_date": "",       # хоосон бол өнөөдрийн огноо
    "info_crs": True,
    "info_scale": True,
    "info_source": "",
    "info_pos": "BR",
    "info_font_size": 7.0,
    # Фото зураг
    "photos": [],  # [{path, lon, lat, pos, width}]
    "photo_lines": True,
    "photo_line_color": "#b000ff",
    "photo_coord_label": False,
}

UNITS = {
    "km2": (1e6, "км²"),
    "ha": (1e4, "га"),
    "m2": (1.0, "м²"),
}

_REF = {
    "TL": QgsLayoutItem.UpperLeft,
    "TR": QgsLayoutItem.UpperRight,
    "BL": QgsLayoutItem.LowerLeft,
    "BR": QgsLayoutItem.LowerRight,
}

_GEO_STEPS = [
    20, 10, 5, 2, 1, 1 / 2, 1 / 3, 1 / 4, 1 / 6, 1 / 12, 1 / 30, 1 / 60,
    1 / 120, 1 / 180, 1 / 360, 1 / 720, 1 / 1800, 1 / 3600,
]

PAD = 3.0  # зургийн хүрээнээс элемент хүртэлх зай, мм
GAP = 2.5  # нэг буланд давхарласан элементүүдийн хоорондох зай, мм


def merged(settings):
    """Дутуу түлхүүрийг анхны утгаар нөхсөн тохиргоо буцаана."""
    s = dict(DEFAULTS)
    s.update(settings or {})
    return s


def nice_scale(scale):
    """Масштабын хуваарийг дээш нь «бүхэл» утга руу дугуйлна."""
    if scale <= 0:
        return scale
    mag = 10 ** math.floor(math.log10(scale))
    for m in (1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 7.5, 10):
        if scale <= m * mag * 1.0000001:
            return m * mag
    return 10 * mag


def nice_floor(v):
    """Утгыг доош нь 1-2-2.5-5 цувралын «бүхэл» тоо руу дугуйлна."""
    if v <= 0:
        return v
    mag = 10 ** math.floor(math.log10(v))
    best = mag
    for m in (1, 2, 2.5, 5, 10):
        if m * mag <= v * 1.0000001:
            best = m * mag
    return best


def nice_step(span, target=5):
    """Метрийн торны алхмыг 1-2-5 цувралаас сонгоно."""
    if span <= 0:
        return 1.0
    raw = span / target
    mag = 10 ** math.floor(math.log10(raw))
    for m in (1, 2, 2.5, 5, 10):
        if raw <= m * mag:
            return m * mag
    return 10 * mag


def geo_step(span_deg):
    for st in _GEO_STEPS:
        if span_deg / st >= 3:
            return st
    return _GEO_STEPS[-1]


def text_format(family, size, bold=False, color="#000000", italic=False):
    f = QFont(family)
    f.setBold(bold)
    f.setItalic(italic)
    tf = QgsTextFormat()
    tf.setFont(f)
    tf.setSize(size)
    tf.setColor(QColor(color))
    if bold and hasattr(tf, "setForcedBold"):
        tf.setForcedBold(True)
    if italic and hasattr(tf, "setForcedItalic"):
        tf.setForcedItalic(True)
    return tf


def is_basemap(layer):
    """XYZ / WMS / WMTS зэрэг онлайн суурь зураг эсэх."""
    if layer.customProperty(basemaps.ROLE):
        return True
    return isinstance(layer, QgsRasterLayer) and layer.providerType() in (
        "wms", "arcgismapserver", "xyzvectortiles", "vectortile")


def clear_layout(layout, keep=None):
    """Хуудаснаас бусад бүх элементийг арилгана. keep-ийг (газрын зургийн элемент) үлдээнэ."""
    for mf in list(layout.multiFrames()):
        layout.removeMultiFrame(mf)
    for it in list(layout.items()):
        if it is keep:
            continue
        if isinstance(it, QgsLayoutItem) and not isinstance(it, QgsLayoutItemPage):
            layout.removeLayoutItem(it)


def find_map(layout):
    for it in layout.items():
        if isinstance(it, QgsLayoutItemMap) and it.id() == "nm_map":
            return it
    return None


def item_rect(item):
    """Элементийн хуудсан дээрх тэгш өнцөгт (мм)."""
    return item.mapRectToScene(item.rect())


def item_geom(item):
    """(тулах цэгийн төрөл, x, y, өргөн, өндөр) — мм.

    Таних тэмдэг зэрэг хэмжээгээ өөрөө тохируулдаг элемент тулах цэгээсээ
    тэлдэг тул зөөгдсөн эсэхийг зүүн дээд булангаар бус тулах цэгээр хэмжинэ.
    """
    p = item.positionWithUnits()
    r = item.rect()
    return (int(item.referencePoint()), p.x(), p.y(), r.width(), r.height())


AUTO_SIZED = (QgsLayoutItemLegend, QgsLayoutItemScaleBar)


def geom_changed(item, now, was):
    """Хэрэглэгч элементийг гараар зөөсөн / хэмжээг нь өөрчилсөн эсэх."""
    if abs(now[1] - was[1]) > 0.05 or abs(now[2] - was[2]) > 0.05:
        return True
    if isinstance(item, AUTO_SIZED):
        return False
    return abs(now[3] - was[3]) > 0.05 or abs(now[4] - was[4]) > 0.05


def _apply_override(item, ov):
    ref, ox, oy, ow, oh = ov
    item.setReferencePoint(QgsLayoutItem.ReferencePoint(int(ref)))
    item.attemptMove(QgsLayoutPoint(ox, oy))
    if not isinstance(item, AUTO_SIZED):
        item.attemptResize(QgsLayoutSize(ow, oh))


def _transform_rect(rect, src, dst, project):
    if not src.isValid() or not dst.isValid() or src == dst:
        return QgsRectangle(rect)
    ct = QgsCoordinateTransform(src, dst, project)
    ct.setBallparkTransformsAreAppropriate(True)
    try:
        return ct.transformBoundingBox(rect)
    except Exception:
        return QgsRectangle()


def compute_extent(project, s, canvas_extent=None):
    """Тохиргооны дагуу зургийн хамрах хүрээг төслийн CRS-ээр буцаана."""
    crs = project.crs()
    mode = s["extent_mode"]
    ext = QgsRectangle()
    hidden = set(s.get("map_hidden_layers") or []) | set(s.get("legend_hidden") or [])
    if mode == "rect" and len(s.get("extent_rect") or []) == 4:
        ext = QgsRectangle(*[float(v) for v in s["extent_rect"]])
    elif mode == "layer":
        lyr = project.mapLayer(s["extent_layer"])
        if lyr is not None:
            ext = _transform_rect(lyr.extent(), lyr.crs(), crs, project)
    elif mode == "visible":
        root = project.layerTreeRoot()
        for node in root.findLayers():
            lyr = node.layer()
            if lyr is None or is_basemap(lyr) or lyr.id() in hidden:
                continue
            if not node.isVisible() and lyr.id() not in (s.get("map_shown_layers") or []):
                continue
            if not lyr.isSpatial() or lyr.extent().isEmpty() and lyr.extent().width() == 0 \
                    and lyr.extent().height() == 0 and lyr.extent().isNull():
                continue
            r = _transform_rect(lyr.extent(), lyr.crs(), crs, project)
            if r.isNull() or not r.isFinite():
                continue
            if ext.isNull():
                ext = QgsRectangle(r)
            else:
                ext.combineExtentWith(r)
    if ext.isNull() or not ext.isFinite() or (ext.width() == 0 and ext.height() == 0):
        if canvas_extent is not None and not canvas_extent.isNull():
            return QgsRectangle(canvas_extent)
        ext = QgsRectangle()
        for lyr in project.mapLayers().values():
            if is_basemap(lyr) or not lyr.isSpatial():
                continue
            r = _transform_rect(lyr.extent(), lyr.crs(), crs, project)
            if r.isNull() or not r.isFinite():
                continue
            if ext.isNull():
                ext = QgsRectangle(r)
            else:
                ext.combineExtentWith(r)
        if ext.isNull():
            return QgsRectangle(0, 0, 1, 1)
    if mode in ("layer", "visible", "rect"):
        k = max(0.0, float(s["extent_buffer"])) / 100.0
        dx = (ext.width() or ext.height() or 1.0) * k
        dy = (ext.height() or ext.width() or 1.0) * k
        ext = QgsRectangle(ext.xMinimum() - dx, ext.yMinimum() - dy,
                           ext.xMaximum() + dx, ext.yMaximum() + dy)
    return ext


def area_statistics(project, layer, field):
    """Полигон давхаргын талбайг ангиллаар нэгтгэнэ.

    Буцаах утга: [(нэр, QColor | None, талбай м²), ...]
    field хоосон бол давхаргын ангилсан (categorized) загварыг ашиглана.
    """
    da = QgsDistanceArea()
    da.setSourceCrs(layer.crs(), project.transformContext())
    ell = project.ellipsoid()
    da.setEllipsoid(ell if ell and ell != "NONE" else "WGS84")

    renderer = layer.renderer()
    cats = None
    expr_text = field
    if isinstance(renderer, QgsCategorizedSymbolRenderer) and (
            not field or field == renderer.classAttribute()):
        cats = renderer.categories()
        expr_text = renderer.classAttribute()

    expr = None
    ctx = QgsExpressionContext(QgsExpressionContextUtils.globalProjectLayerScopes(layer))
    if expr_text:
        expr = QgsExpression(expr_text)
        if layer.fields().lookupField(expr_text) >= 0:
            expr = QgsExpression(QgsExpression.quotedColumnRef(expr_text))
        expr.prepare(ctx)

    sums = {}
    order = []
    for feat in layer.getFeatures():
        geom = feat.geometry()
        if geom is None or geom.isEmpty():
            continue
        key = ""
        if expr is not None:
            ctx.setFeature(feat)
            val = expr.evaluate(ctx)
            key = "" if val is None or str(val) == "NULL" else str(val)
        if key not in sums:
            sums[key] = 0.0
            order.append(key)
        sums[key] += da.measureArea(geom)

    rows = []
    if cats is not None:
        used = set()
        default = None
        for c in cats:
            val = c.value()
            vals = val if isinstance(val, (list, tuple)) else [val]
            keys = ["" if v is None else str(v) for v in vals]
            if keys == [""] and val in (None, ""):
                default = c
                continue
            area = 0.0
            hit = False
            for k in keys:
                if k in sums:
                    area += sums[k]
                    used.add(k)
                    hit = True
            if not c.renderState() or not hit:
                continue
            color = c.symbol().color() if c.symbol() is not None else None
            rows.append((c.label() or ", ".join(keys), color, area))
        rest = sum(v for k, v in sums.items() if k not in used)
        if rest > 0:
            label = (default.label() if default is not None and default.label() else "Бусад")
            color = default.symbol().color() if default is not None and default.symbol() else None
            rows.append((label, color, rest))
    elif expr is not None:
        for k in order:
            rows.append((k or "—", None, sums[k]))
    else:
        color = None
        try:
            color = renderer.symbol().color()
        except Exception:
            pass
        rows.append((layer.name(), color, sum(sums.values())))
    return rows


def _fmt_number(v, decimals):
    return f"{v:,.{int(decimals)}f}".replace(",", " ")


def _label(layout, text, tf, halign=Qt.AlignmentFlag.AlignLeft, bg=None, item_id=""):
    lb = QgsLayoutItemLabel(layout)
    lb.setText(text)
    lb.setTextFormat(tf)
    lb.setHAlign(halign)
    lb.setVAlign(Qt.AlignmentFlag.AlignVCenter)
    lb.setMarginX(1.0)
    lb.setMarginY(0.6)
    if bg is not None:
        lb.setBackgroundEnabled(True)
        lb.setBackgroundColor(QColor(bg))
    lb.setId(item_id)
    layout.addLayoutItem(lb)
    return lb


def _wrapped_height(lb, width):
    """Өгөгдсөн өргөнд мөр хугарсан текстийн ойролцоо өндөр (мм)."""
    text = lb.text()
    lines = text.split("\n")
    sz = lb.sizeForText()
    line_h = sz.height() / max(1, len(lines))
    longest = max((len(l) for l in lines), default=1) or 1
    avail = max(10.0, width - 3.0)
    n = 0
    for l in lines:
        w = sz.width() * (len(l) / longest)
        n += max(1, int(math.ceil(w / avail)))
    return n * line_h + 1.5


def _legend_fonts(legend, family, size):
    specs = (
        (QgsLegendStyle.Title, size + 2, True),
        (QgsLegendStyle.Group, size + 0.5, True),
        (QgsLegendStyle.Subgroup, size, False),
        (QgsLegendStyle.SymbolLabel, size, False),
    )
    for which, sz, bold in specs:
        st = legend.rstyle(which)
        if hasattr(st, "setTextFormat"):
            st.setTextFormat(text_format(family, sz, bold))
        else:
            f = QFont(family)
            f.setPointSizeF(sz)
            f.setBold(bold)
            st.setFont(f)


def _add_grid(map_item, s, project):
    grid = QgsLayoutItemMapGrid("nm_grid", map_item)
    map_item.grids().addGrid(grid)
    ext = map_item.extent()
    map_crs = map_item.crs()
    geo = s["grid_crs"] == "geo"
    if geo:
        wgs = QgsCoordinateReferenceSystem("EPSG:4326")
        grid.setCrs(wgs)
        g = _transform_rect(ext, map_crs, wgs, project)
        step = float(s["grid_interval_geo"])
        if step <= 0:
            span = g.width() if not g.isNull() else 1.0
            step = geo_step(span)
        grid.setAnnotationFormat(QgsLayoutItemMapGrid.DegreeMinuteSecond)
        grid.setAnnotationPrecision(0)
    else:
        grid.setCrs(map_crs)
        step = float(s["grid_interval_map"])
        if step <= 0:
            step = nice_step(ext.width())
        grid.setAnnotationFormat(QgsLayoutItemMapGrid.Decimal)
        grid.setAnnotationPrecision(0 if step >= 1 else 4)
    grid.setIntervalX(step)
    grid.setIntervalY(step)

    style = s["grid_style"]
    if style == "lines":
        grid.setStyle(QgsLayoutItemMapGrid.Solid)
        grid.setLineSymbol(QgsLineSymbol.createSimple(
            {"color": "90,90,90,150", "width": "0.12"}))
    elif style == "cross":
        grid.setStyle(QgsLayoutItemMapGrid.Cross)
        grid.setCrossLength(2.0)
        grid.setLineSymbol(QgsLineSymbol.createSimple(
            {"color": "40,40,40,255", "width": "0.18"}))
    else:
        grid.setStyle(QgsLayoutItemMapGrid.FrameAnnotationsOnly)

    frame = s["grid_frame"]
    if frame == "zebra":
        grid.setFrameStyle(QgsLayoutItemMapGrid.Zebra)
        grid.setFrameWidth(1.2)
        grid.setFramePenSize(0.15)
    elif frame == "ticks":
        grid.setFrameStyle(QgsLayoutItemMapGrid.InteriorTicks)
        grid.setFrameWidth(1.6)
        grid.setFramePenSize(0.25)
    else:
        grid.setFrameStyle(QgsLayoutItemMapGrid.LineBorder)
        grid.setFramePenSize(0.25)

    grid.setAnnotationEnabled(bool(s["grid_labels"]))
    if s["grid_labels"]:
        tf = text_format(s["font"], float(s["grid_font_size"]))
        if hasattr(grid, "setAnnotationTextFormat"):
            grid.setAnnotationTextFormat(tf)
        else:
            f = QFont(s["font"])
            f.setPointSizeF(float(s["grid_font_size"]))
            grid.setAnnotationFont(f)
        grid.setAnnotationFrameDistance(1.0)
        sides = (
            (QgsLayoutItemMapGrid.Left, QgsLayoutItemMapGrid.Vertical,
             QgsLayoutItemMapGrid.LatitudeOnly),
            (QgsLayoutItemMapGrid.Right, QgsLayoutItemMapGrid.Vertical,
             QgsLayoutItemMapGrid.LatitudeOnly),
            (QgsLayoutItemMapGrid.Top, QgsLayoutItemMapGrid.Horizontal,
             QgsLayoutItemMapGrid.LongitudeOnly),
            (QgsLayoutItemMapGrid.Bottom, QgsLayoutItemMapGrid.Horizontal,
             QgsLayoutItemMapGrid.LongitudeOnly),
        )
        for side, direction, display in sides:
            grid.setAnnotationPosition(QgsLayoutItemMapGrid.OutsideMapFrame, side)
            grid.setAnnotationDirection(direction, side)
            grid.setAnnotationDisplay(display, side)
    return grid


def _photo_size(path, width):
    reader = QImageReader(path)
    reader.setAutoTransform(True)
    size = reader.size()
    w, h = size.width(), size.height()
    try:
        tr = int(reader.transformation())
    except TypeError:
        tr = reader.transformation().value
    if tr & 4:  # 90° эргүүлэлттэй EXIF
        w, h = h, w
    if w <= 0 or h <= 0:
        return width, width * 0.75
    return width, width * h / w


def _map_to_layout(map_item, rect, x, y):
    ext = map_item.extent()
    if ext.width() == 0 or ext.height() == 0:
        return None
    fx = (x - ext.xMinimum()) / ext.width()
    fy = (ext.yMaximum() - y) / ext.height()
    return QPointF(rect.left() + fx * rect.width(), rect.top() + fy * rect.height())


def refresh_map_bounds(map_item, invalidate=False):
    """Торны хүрээний гаднах солбицлын тоонд зай гаргаж, дахин зуруулна.

    Зургийн элементийн зурагдах муж (bounding rect) тор тохируулсны дараа
    шинэчлэгдээгүй бол урьдчилан харалтад гаднах тоонууд тайрагдаж харагдахгүй.
    """
    if map_item is None:
        return
    try:
        map_item.updateBoundingRect()
        if invalidate:
            map_item.invalidateCache()
        map_item.update()
    except (RuntimeError, AttributeError):
        pass


MAP_SIG = "nm_signature"


def build(layout, settings, canvas_extent=None, overrides=None, extent_override=None,
          reuse_map=False, map_dirty=True):
    """Layout-ыг цэвэрлээд тохиргооны дагуу дахин угсарна.

    overrides: {item_id: item_geom(...)} — хэрэглэгч гараар зөөсөн элементүүд.
    extent_override: QgsRectangle — хэрэглэгч гараар тохируулсан хамрах хүрээ.
    Буцаах утга: {item_id: item}
    """
    s = merged(settings)
    overrides = overrides or {}
    project = layout.project() or QgsProject.instance()
    items = {}

    map_changed = True
    stack = layout.undoStack()
    stack.blockCommands(True)
    try:
        # Өмнөх газрын зургийн элементийг үлдээвэл түүний нэгэнт зурсан (суурь зураг,
        # хилийн шугам бүхий) дүрс хэвээр үлдэж, зураг өөрчлөгдөөгүй үед дахин зурахгүй.
        old_map = find_map(layout) if reuse_map else None
        clear_layout(layout, keep=old_map)

        # ---- Хуудас -------------------------------------------------
        if s["page_size"] in PAGE_SIZES:
            pw, ph = PAGE_SIZES[s["page_size"]]
        else:
            pw, ph = float(s["page_w"]), float(s["page_h"])
        if s["page_size"] in PAGE_SIZES:
            if s["orientation"] == "landscape":
                pw, ph = max(pw, ph), min(pw, ph)
            else:
                pw, ph = min(pw, ph), max(pw, ph)
        pages = layout.pageCollection()
        if pages.pageCount() == 0:
            page = QgsLayoutItemPage(layout)
            pages.addPage(page)
        while pages.pageCount() > 1:
            pages.deletePage(pages.pageCount() - 1)
        pages.page(0).setPageSize(QgsLayoutSize(pw, ph))
        pages.reflow()

        m = float(s["margin"])
        font = s["font"]
        left, right = m, pw - m
        top, bottom = m, ph - m
        width = right - left

        # ---- Гарчиг ------------------------------------------------
        title_text = expand_tokens(s["title"], s, project).strip()
        subtitle_text = expand_tokens(s["subtitle"], s, project).strip()

        def make_titles():
            out = []
            if title_text:
                tf = text_format(font, float(s["title_size"]), True, s["title_color"])
                lb = _label(layout, title_text, tf,
                            Qt.AlignmentFlag.AlignHCenter, item_id="nm_title")
                out.append(lb)
                items["nm_title"] = lb
            if subtitle_text:
                tf = text_format(font, float(s["title_size"]) * 0.7, False, s["title_color"])
                lb = _label(layout, subtitle_text, tf,
                            Qt.AlignmentFlag.AlignHCenter, item_id="nm_subtitle")
                out.append(lb)
                items["nm_subtitle"] = lb
            return out

        if s["title_place"] == "outside":
            title_items = make_titles()
            for lb in title_items:
                h = _wrapped_height(lb, width)
                lb.attemptMove(QgsLayoutPoint(left, top))
                lb.attemptResize(QgsLayoutSize(width, h))
                top += h
            if title_items:
                top += 1.0

        # ---- Зургийн доорх тайлбар ----------------------------------
        caption_text = caption_string(s, project)
        if caption_text:
            tf = text_format(font, float(s["caption_size"]), True)
            lb = _label(layout, caption_text, tf,
                        Qt.AlignmentFlag.AlignHCenter, item_id="nm_caption")
            h = _wrapped_height(lb, width)
            lb.attemptMove(QgsLayoutPoint(left, bottom - h))
            lb.attemptResize(QgsLayoutSize(width, h))
            bottom -= h + 1.0
            items["nm_caption"] = lb

        # ---- Зургийн талбар ----------------------------------------
        ann = 0.0
        if s["grid"] and s["grid_labels"]:
            ann = float(s["grid_font_size"]) * 0.3528 * 1.25 + 2.0
        mx, my = left + ann, top + ann
        mw, mh = width - 2 * ann, (bottom - top) - 2 * ann
        if s["legend"] and s["legend_pos"] == "OUT":
            mw -= float(s["legend_out_width"]) + 2.0
        mw, mh = max(mw, 20.0), max(mh, 20.0)

        map_item = old_map
        map_new = map_item is None
        if map_new:
            map_item = QgsLayoutItemMap(layout)
            map_item.setId("nm_map")
            layout.addLayoutItem(map_item)
            map_item.setBackgroundColor(QColor(255, 255, 255))
        else:
            for g in list(map_item.grids().asList()):
                map_item.grids().removeGrid(g.id())
        if "nm_map" in overrides:
            _ref, mx, my, mw, mh = overrides["nm_map"]

        if extent_override is not None and not extent_override.isNull():
            target = QgsRectangle(extent_override)
            scale_key = ("override",)
        else:
            target = compute_extent(project, s, canvas_extent)
            scale_key = (s["scale_mode"], float(s["scale"]) if s["scale_mode"] == "fixed" else 0)
        # Таних тэмдгээс хассан давхарга зураг дээр ч хасагдана
        hidden_map = set(s.get("map_hidden_layers") or []) | set(s.get("legend_hidden") or [])
        shown_map = set(s.get("map_shown_layers") or []) - hidden_map
        # Газрын зургийн агуулгыг тодорхойлох бүх оролт: аль нэг нь өөрчлөгдвөл л дахин зурна
        sig = repr((round(mx, 3), round(my, 3), round(mw, 3), round(mh, 3),
                    [round(v, 6) for v in (target.xMinimum(), target.yMinimum(),
                                           target.xMaximum(), target.yMaximum())],
                    scale_key, project.crs().authid(),
                    sorted(hidden_map), sorted(shown_map)))
        map_changed = map_new or map_dirty or map_item.customProperty(MAP_SIG) != sig
        if map_changed:
            map_item.setReferencePoint(QgsLayoutItem.UpperLeft)
            map_item.attemptMove(QgsLayoutPoint(mx, my))
            map_item.attemptResize(QgsLayoutSize(mw, mh))
            map_item.setCrs(project.crs())
            map_item.zoomToExtent(target)
            if scale_key[0] == "fixed" and scale_key[1] > 0:
                map_item.setScale(scale_key[1])
            elif scale_key[0] == "round":
                sc = map_item.scale()
                if sc > 0 and math.isfinite(sc):
                    map_item.setScale(nice_scale(sc))
            if hidden_map or shown_map:
                root_tree = project.layerTreeRoot()
                lyrs = []
                for lyr in root_tree.layerOrder():
                    node = root_tree.findLayer(lyr.id())
                    if node is None or lyr.id() in hidden_map:
                        continue
                    if node.isVisible() or lyr.id() in shown_map:
                        lyrs.append(lyr)
                map_item.setLayers(lyrs)
                map_item.setKeepLayerSet(True)
            elif map_item.keepLayerSet():
                map_item.setKeepLayerSet(False)
                map_item.setLayers([])
            map_item.setCustomProperty(MAP_SIG, sig)
        map_item.setFrameEnabled(bool(s["map_frame"]))
        map_item.setFrameStrokeWidth(QgsLayoutMeasurement(0.4))
        items["nm_map"] = map_item
        map_rect = QRectF(mx, my, mw, mh)

        if s["grid"]:
            _add_grid(map_item, s, project)

        # ---- Гарчиг (зураг дотор) -----------------------------------
        if s["title_place"] == "inside":
            # Зургийн дараа үүсгэснээр газрын зургийн дээр давхарлагдана
            y = my + PAD
            for lb in make_titles():
                w = mw * 0.7
                h = _wrapped_height(lb, w)
                lb.attemptMove(QgsLayoutPoint(mx + (mw - w) / 2, y))
                lb.attemptResize(QgsLayoutSize(w, h))
                fmt = lb.textFormat()
                buf = fmt.buffer()
                buf.setEnabled(True)
                buf.setSize(0.7)
                buf.setColor(QColor(255, 255, 255))
                fmt.setBuffer(buf)
                lb.setTextFormat(fmt)
                y += h

        # ---- Буланд байрлах элементүүд -----------------------------
        corner = []  # (item, pos, key)
        offsets = {"TL": 0.0, "TR": 0.0, "BL": 0.0, "BR": 0.0}

        credits = s["credits"].strip()
        if not credits and s["basemap_credit"]:
            credits = basemaps.attribution(s)
        if credits:
            tf = text_format(font, 6.5, False, "#333333")
            lb = _label(layout, credits, tf,
                        Qt.AlignmentFlag.AlignRight, bg="#ffffffc8", item_id="nm_credits")
            lb.setBackgroundColor(QColor(255, 255, 255, 200))
            w = min(mw * 0.6, lb.sizeForText().width() + 3)
            h = _wrapped_height(lb, w)
            lb.attemptResize(QgsLayoutSize(w, h))
            lb.setReferencePoint(QgsLayoutItem.LowerRight)
            lb.attemptMove(QgsLayoutPoint(map_rect.right() - 0.4, map_rect.bottom() - 0.4))
            offsets["BR"] = h
            items["nm_credits"] = lb

        north = None
        if s["north"]:
            north = QgsLayoutItemPicture(layout)
            north.setId("nm_north")
            layout.addLayoutItem(north)
            path = resolve_svg(s["north_svg"])
            if not path.startswith(":") and not os.path.exists(path):
                path = DEFAULT_NORTH_ARROW
            north.setPicturePath(path)
            north.setResizeMode(QgsLayoutItemPicture.Zoom)
            north.setLinkedMap(map_item)
            size = float(s["north_size"])
            north.attemptResize(QgsLayoutSize(size, size))
            items["nm_north"] = north

        scalebar = None
        if s["scalebar"]:
            scalebar = QgsLayoutItemScaleBar(layout)
            scalebar.setId("nm_scalebar")
            layout.addLayoutItem(scalebar)
            scalebar.setStyle(s["scalebar_style"])
            scalebar.setLinkedMap(map_item)
            scalebar.setNumberOfSegments(int(s["scalebar_segments"]))
            scalebar.setNumberOfSegmentsLeft(0)
            scalebar.setMaximumBarWidth(min(90.0, mw * 0.35))
            scalebar.setMinimumBarWidth(min(40.0, mw * 0.18))
            scalebar.applyDefaultSize(QgsUnitTypes.DistanceMeters)
            unit = "м"
            if scalebar.unitsPerSegment() * scalebar.numberOfSegments() >= 2000:
                scalebar.applyDefaultSize(QgsUnitTypes.DistanceKilometers)
                unit = "км"
            total = scalebar.unitsPerSegment() * scalebar.numberOfSegments()
            n = max(1, int(s["scalebar_segments"]))
            if total > 0:
                scalebar.setNumberOfSegments(n)
                scalebar.setUnitsPerSegment(nice_floor(total / n))
            scalebar.setUnitLabel(unit)
            scalebar.setTextFormat(text_format(font, 7.5))
            scalebar.setHeight(2.0)
            scalebar.setBackgroundEnabled(True)
            scalebar.setBackgroundColor(QColor(255, 255, 255, 215))
            scalebar.update()
            items["nm_scalebar"] = scalebar

        scale_text = None
        if s["scale_text"]:
            tf = text_format(font, 8.5, True)
            scale_text = _label(
                layout,
                "1:[% replace(format_number(map_get(item_variables('nm_map'),"
                "'map_scale'),0),',',' ') %]",
                tf, Qt.AlignmentFlag.AlignHCenter, bg="#ffffff", item_id="nm_scale_text")
            scale_text.setBackgroundColor(QColor(255, 255, 255, 215))
            scale_text.attemptResize(QgsLayoutSize(34.0, 5.5))
            items["nm_scale_text"] = scale_text

        table_frame = None
        if s["table"]:
            lyr = project.mapLayer(s["table_layer"])
            if isinstance(lyr, QgsVectorLayer) and lyr.isValid():
                table_frame = _add_table(layout, project, lyr, s)
                if table_frame is not None:
                    items["nm_table"] = table_frame

        legend = None
        if s["legend"]:
            legend = QgsLayoutItemLegend(layout)
            legend.setId("nm_legend")
            layout.addLayoutItem(legend)
            legend.setLinkedMap(map_item)
            legend.setTitle(s["legend_title"])
            legend.setColumnCount(max(1, int(s["legend_cols"])))
            legend.setSymbolWidth(6.0)
            legend.setSymbolHeight(3.5)
            _legend_fonts(legend, font, float(s["legend_font_size"]))
            legend.setBackgroundEnabled(bool(s["legend_bg"]))
            legend.setBackgroundColor(QColor(255, 255, 255, 235))
            legend.setFrameEnabled(bool(s["legend_bg"]))
            legend.setFrameStrokeWidth(QgsLayoutMeasurement(0.2))
            legend.setAutoUpdateModel(False)
            root = legend.model().rootGroup()
            for node in list(root.findLayers()):
                lyr = node.layer()
                drop = lyr is None or lyr.id() in hidden_map or not (
                    _layer_visible(project, lyr) or lyr.id() in shown_map)
                if not drop and s["legend_skip_basemap"] and is_basemap(lyr):
                    drop = True
                if drop:
                    parent = node.parent()
                    if parent is not None:
                        parent.removeChildNode(node)
            hidden = set(s.get("legend_hidden") or [])
            for node in list(root.findLayers()):
                if node.layerId() in hidden and node.parent() is not None:
                    node.parent().removeChildNode(node)
            _prune_empty_groups(root)
            order = list(s.get("legend_order") or [])
            if order:
                # Хэрэглэгчийн дараалал: бүлгийг задалж нэг жагсаалт болгоно.
                # Жагсаалтад байхгүй (шинээр нэмэгдсэн) давхарга төгсгөлд орно.
                rank = {lid: i for i, lid in enumerate(order)}
                lyrs = [n.layer() for n in root.findLayers() if n.layer() is not None]
                lyrs.sort(key=lambda l: rank.get(l.id(), len(rank)))
                root.removeAllChildren()
                for lyr in lyrs:
                    root.addLayer(lyr)
            embedded = False
            for node in root.findLayers():
                if has_embedded_symbols(node.layer()):
                    embedded = True
            # Чагтыг нь авсан (зураг дээр зурагдахгүй) ангилал таних тэмдэгт ч орохгүй
            for node in root.findLayers():
                originals = legend.model().layerOriginalLegendNodes(node)
                keep = [i for i, n in enumerate(originals)
                        if n.data(Qt.ItemDataRole.CheckStateRole)
                        not in (0, Qt.CheckState.Unchecked)]
                if originals and len(keep) != len(originals):
                    QgsMapLayerLegendUtils.setLegendNodeOrder(node, keep)
                    legend.model().refreshLayerLegend(node)
            titles = s.get("legend_titles") or {}
            for node in root.findLayers():
                t = (titles.get(node.layerId()) or "").strip()
                if t:
                    node.setCustomProperty("legend/title-label", t)
            # KML зэрэг объект бүр өөрийн загвартай давхаргыг QGIS-ийн «зурагт
            # харагдаж буйг шүүх» горим таних тэмдгээс хасдаг тул тийм давхарга
            # байвал шүүлтүүрийг хэрэглэхгүй: харагдаж буй давхарга бүр орно.
            legend.setLegendFilterByMapEnabled(bool(s["legend_filter"]) and not embedded)
            legend.updateLegend()
            legend.adjustBoxSize()
            items["nm_legend"] = legend

        # Фото зураг
        photos = []
        for i, ph in enumerate(s["photos"] or []):
            path = (ph.get("path") or "").strip()
            if not path or not os.path.exists(path):
                continue
            pic = QgsLayoutItemPicture(layout)
            pid = f"nm_photo_{i}"
            pic.setId(pid)
            layout.addLayoutItem(pic)
            pic.setPicturePath(path)
            pic.setResizeMode(QgsLayoutItemPicture.Zoom)
            w, h = _photo_size(path, float(ph.get("width") or 55.0))
            pic.attemptResize(QgsLayoutSize(w, h))
            pic.setFrameEnabled(True)
            pic.setFrameStrokeColor(QColor(255, 255, 255))
            items[pid] = pic
            photos.append((pic, ph, pid))

        inset = _add_inset(layout, project, map_item, s) if s["inset"] else None
        if inset is not None:
            items["nm_inset"] = inset

        logo = None
        logo_path = (s["logo"] or "").strip()
        if logo_path and os.path.exists(logo_path):
            logo = QgsLayoutItemPicture(layout)
            logo.setId("nm_logo")
            layout.addLayoutItem(logo)
            logo.setPicturePath(logo_path)
            logo.setResizeMode(QgsLayoutItemPicture.Zoom)
            w, h = _photo_size(logo_path, float(s["logo_size"]))
            logo.attemptResize(QgsLayoutSize(w, h))
            items["nm_logo"] = logo

        info = _add_info(layout, project, map_item, s) if s["info"] else None
        if info is not None:
            items["nm_info"] = info

        # Буланд давхарлах дараалал
        if logo is not None:
            corner.append((logo, s["logo_pos"]))
        if inset is not None:
            corner.append((inset, s["inset_pos"]))
        if north is not None:
            corner.append((north, s["north_pos"]))
        if scalebar is not None:
            corner.append((scalebar, s["scalebar_pos"]))
        if scale_text is not None:
            corner.append((scale_text, s["scalebar_pos"]))
        for pic, ph, _pid in photos:
            corner.append((pic, ph.get("pos") or "TL"))
        if info is not None:
            corner.append((info, s["info_pos"]))
        if table_frame is not None:
            corner.append((table_frame, s["table_pos"]))
        if legend is not None and s["legend_pos"] != "OUT":
            corner.append((legend, s["legend_pos"]))

        for item, pos in corner:
            if pos not in _REF:
                pos = "TL"
            r = item.rect()
            x = map_rect.left() + PAD if pos[1] == "L" else map_rect.right() - PAD
            if pos[0] == "T":
                y = map_rect.top() + PAD + offsets[pos]
            else:
                y = map_rect.bottom() - PAD - offsets[pos]
            item.setReferencePoint(_REF[pos])
            item.attemptMove(QgsLayoutPoint(x, y))
            offsets[pos] += r.height() + GAP

        if legend is not None and s["legend_pos"] == "OUT":
            legend.setReferencePoint(QgsLayoutItem.UpperLeft)
            legend.attemptMove(QgsLayoutPoint(map_rect.right() + ann + 2.0, map_rect.top()))

        # Хэрэглэгчийн гараар зөөсөн байрлалыг сэргээх
        for key, item in items.items():
            if key == "nm_map" or key not in overrides:
                continue
            _apply_override(item, overrides[key])

        # Фото зургаас газрын цэг рүү татах шугам
        wgs = QgsCoordinateReferenceSystem("EPSG:4326")
        for pic, ph, pid in photos:
            try:
                lon = float(ph.get("lon"))
                lat = float(ph.get("lat"))
            except (TypeError, ValueError):
                continue
            if not (-180 <= lon <= 180 and -90 <= lat <= 90) or (lon == 0 and lat == 0):
                continue
            try:
                ct = QgsCoordinateTransform(wgs, map_item.crs(), project)
                pt = ct.transform(QgsPointXY(lon, lat))
            except Exception:
                continue
            target = _map_to_layout(map_item, map_rect, pt.x(), pt.y())
            if target is None or not map_rect.contains(target):
                continue
            pr = item_rect(pic)
            if s["photo_lines"] and not pr.contains(target):
                if target.x() > pr.right():
                    a, b = pr.topRight(), pr.bottomRight()
                elif target.x() < pr.left():
                    a, b = pr.topLeft(), pr.bottomLeft()
                elif target.y() > pr.bottom():
                    a, b = pr.bottomLeft(), pr.bottomRight()
                else:
                    a, b = pr.topLeft(), pr.topRight()
                line = QgsLayoutItemPolyline(QPolygonF([a, target, b]), layout)
                line.setSymbol(QgsLineSymbol.createSimple({
                    "color": QColor(s["photo_line_color"]).name(),
                    "width": "0.5", "capstyle": "round", "joinstyle": "round"}))
                line.setId(pid.replace("photo", "line"))
                layout.addLayoutItem(line)
                items[line.id()] = line
            if s["photo_coord_label"]:
                tf = text_format(font, 7.0)
                lid = pid.replace("photo", "coord")
                lb = _label(layout, f"{lon:.6f}, {lat:.6f}", tf,
                            Qt.AlignmentFlag.AlignLeft, item_id=lid)
                lb.setBackgroundEnabled(True)
                lb.setBackgroundColor(QColor(255, 255, 255, 190))
                sz = lb.sizeForText()
                lb.attemptResize(QgsLayoutSize(sz.width() + 3, sz.height() + 1.5))
                if lid in overrides:
                    _apply_override(lb, overrides[lid])
                else:
                    lb.attemptMove(QgsLayoutPoint(target.x() + 1.5, target.y() + 1.0))
                items[lid] = lb
    finally:
        stack.blockCommands(False)
    # layout.refresh() нь газрын зургийн зурсан дүрсийг хүчингүй болгодог тул элемент
    # бүрийг тусад нь шинэчилж, газрын зургийг зөвхөн өөрчлөгдсөн үед дахин зуруулна.
    the_map = items.get("nm_map")
    for item in items.values():
        if item is the_map and not map_changed:
            continue
        try:
            item.refresh()
        except (RuntimeError, AttributeError):
            pass
    layout.updateBounds()
    refresh_map_bounds(the_map, invalidate=map_changed)
    return items


def resolve_svg(name):
    """Хойд зүгийн сумын SVG-ийн замыг олно (QGIS-ийн SVG хавтаснаас нэрээр нь)."""
    if not name:
        return DEFAULT_NORTH_ARROW
    if name.startswith(":") or (os.path.isabs(name) and os.path.exists(name)):
        return name
    for cand in (name, "arrows/" + os.path.basename(name)):
        path = QgsSymbolLayerUtils.svgSymbolNameToPath(cand, QgsPathResolver())
        if path and os.path.exists(path):
            return path
    return DEFAULT_NORTH_ARROW


def has_embedded_symbols(layer):
    """KML зэрэг объект бүр өөрийн загвартай (Embedded Symbols) давхарга эсэх."""
    return isinstance(layer, QgsVectorLayer) and isinstance(
        layer.renderer(), QgsEmbeddedSymbolRenderer)


def _layer_visible(project, layer):
    node = project.layerTreeRoot().findLayer(layer.id())
    return node is not None and node.isVisible()


def _prune_empty_groups(group):
    for child in list(group.children()):
        if hasattr(child, "findLayers") and hasattr(child, "children") \
                and child.nodeType() == 0:
            _prune_empty_groups(child)
            if not child.children():
                group.removeChildNode(child)


def table_data(project, layer, s):
    """Талбайн хүснэгтийн өгөгдөл: (толгой1, толгой2, [(нэр, утга, QColor|None)], нийт).

    Утга нь сонгосон нэгжээр (км² / га / м²). Зураг дээрх хүснэгт болон Excel
    экспорт хоёул үүнийг ашиглана.
    """
    rows = area_statistics(project, layer, s["table_field"])
    div, unit = UNITS.get(s["table_unit"], UNITS["km2"])
    head2 = s["table_head2"].strip() or f"Талбай, {unit}"
    out = [(label, area / div, color) for label, color, area in rows]
    total = sum(v for _l, v, _c in out)
    # Давхцлын үр дүн: нэгжүүд хоорондоо давхцаж болно (аймаг ⊃ сум ⊃ баг), иймд хувийг
    # мөрүүдийн нийлбэрээс биш судалгааны талбайн нийт хэмжээнээс тооцно.
    base = overlap_base_m2(layer)
    if base > 0:
        total = base / div
    return s["table_head1"], head2, out, total


OVERLAP_TOTAL = "numan_map_maker/overlap_total_m2"


def overlap_base_m2(layer):
    """Давхцлын үр дүнгийн давхаргад хадгалсан судалгааны талбайн нийт хэмжээ (м²); үгүй бол 0."""
    try:
        return float(layer.customProperty(OVERLAP_TOTAL) or 0)
    except (TypeError, ValueError):
        return 0.0


def table_total_label(layer):
    return "Судалгааны талбай" if overlap_base_m2(layer) > 0 else "Нийт"


def expand_tokens(text, s, project=None):
    """Гарчиг, тайлбар доторх {name} {layer} {n} {date} {project} тэмдэглэгээг орлуулна."""
    if not text or "{" not in text:
        return text or ""
    tokens = {"name": "", "layer": "", "n": figure_number(s),
              "date": datetime.date.today().strftime("%Y.%m.%d"), "project": ""}
    if project is not None:
        tokens["project"] = project.title() or project.baseName()
        lyr = project.mapLayer(s.get("extent_layer") or "")
        if lyr is not None and s.get("extent_mode") == "layer":
            tokens["layer"] = lyr.name()
    tokens.update({k: str(v) for k, v in (s.get("_tokens") or {}).items()})
    for k, v in tokens.items():
        text = text.replace("{" + k + "}", v)
    return text


def figure_number(s):
    chapter = str(s.get("fig_chapter") or "").strip()
    no = int(s.get("fig_no") or 1)
    return f"{chapter}.{no}" if chapter else str(no)


def caption_string(s, project=None):
    """Зургийн доорх тайлбар; автомат дугаартай бол «Зураг 1.66. …» хэлбэртэй."""
    text = expand_tokens(s["caption"], s, project).strip()
    if s.get("caption_auto"):
        head = f"{(s.get('caption_prefix') or 'Зураг').strip()} {figure_number(s)}."
        return f"{head} {text}".strip()
    return text


MONGOLIA_WGS84 = (87.4, 41.4, 120.2, 52.3)


def _add_inset(layout, project, map_item, s):
    """Судалгааны талбайн байршлыг харуулах жижиг зураг (улаан хүрээ/цэгтэй)."""
    w = float(s["inset_size"])
    h = w * 0.7
    inset = QgsLayoutItemMap(layout)
    inset.setId("nm_inset")
    layout.addLayoutItem(inset)
    inset.attemptResize(QgsLayoutSize(w, h))
    inset.setCrs(project.crs())
    inset.setFrameEnabled(True)
    inset.setFrameStrokeWidth(QgsLayoutMeasurement(0.3))
    inset.setBackgroundColor(QColor(255, 255, 255))

    lyrs = []
    user = project.mapLayer(s.get("inset_layer") or "")
    if user is not None:
        lyrs.append(user)
    for lyr in project.mapLayers().values():
        if lyr.customProperty(basemaps.ROLE) == "inset":
            lyrs.append(lyr)
    inset.setLayers(lyrs)
    inset.setKeepLayerSet(True)

    main = map_item.extent()
    mode = s["inset_extent"]
    ext = QgsRectangle()
    if mode == "layer" and user is not None:
        ext = _transform_rect(user.extent(), user.crs(), project.crs(), project)
        ext.scale(1.06)
    elif mode == "mongolia":
        ext = _transform_rect(QgsRectangle(*MONGOLIA_WGS84),
                              QgsCoordinateReferenceSystem("EPSG:4326"), project.crs(), project)
    if ext.isNull() or not ext.isFinite() or ext.width() <= 0:
        ext = QgsRectangle(main)
        ext.scale(max(1.5, float(s["inset_factor"])))
    if not ext.contains(main):
        ext.combineExtentWith(main)
        ext.scale(1.1)
    inset.zoomToExtent(ext)

    ov = QgsLayoutItemMapOverview("nm_overview", inset)
    ov.setLinkedMap(map_item)
    sym = QgsFillSymbol.createSimple({"color": "255,0,0,45", "outline_color": "#e60000",
                                      "outline_width": "0.45"})
    # Талбай жижиг зурагт цэг шиг жижиг харагдах бол төвд нь улаан цэг нэмнэ
    ie = inset.extent()
    if ie.width() > 0 and (main.width() / ie.width()) * w < 3.0:
        cl = QgsCentroidFillSymbolLayer()
        cl.setSubSymbol(QgsMarkerSymbol.createSimple({
            "name": "circle", "color": "#e60000", "size": "2.4",
            "outline_color": "#ffffff", "outline_width": "0.3"}))
        sym.appendSymbolLayer(cl)
    ov.setFrameSymbol(sym)
    inset.overviews().addOverview(ov)
    return inset


def _manual_table(layout, contents, item_id, font, size):
    table = QgsLayoutItemManualTable.create(layout)
    layout.addMultiFrame(table)
    table.setIncludeTableHeader(False)
    table.setTableContents(contents)
    table.setContentTextFormat(text_format(font, size))
    table.setCellMargin(1.2)
    table.setGridStrokeWidth(0.2)
    table.setBackgroundColor(QColor(255, 255, 255))
    table.setResizeMode(QgsLayoutMultiFrame.UseExistingFrames)
    frame = QgsLayoutFrame(layout, table)
    frame.setId(item_id)
    frame.attemptResize(QgsLayoutSize(60, 30))
    table.addFrame(frame)
    table.refresh()
    sz = table.totalSize()
    if sz.width() > 0 and sz.height() > 0:
        frame.attemptResize(QgsLayoutSize(sz.width(), sz.height()))
    return frame


def info_rows(project, map_item, s):
    """Мэдээллийн хүснэгтийн мөрүүд: [(нэр, утга)]."""
    rows = []
    if s["info_org"].strip():
        rows.append(("Гүйцэтгэгч", s["info_org"].strip()))
    if s["info_author"].strip():
        rows.append(("Зураг үйлдсэн", s["info_author"].strip()))
    rows.append(("Огноо", s["info_date"].strip()
                 or datetime.date.today().strftime("%Y.%m.%d")))
    if s["info_crs"]:
        crs = project.crs()
        if crs.isValid():
            rows.append(("Проекц", f"{crs.description()} ({crs.authid()})"))
    if s["info_scale"] and map_item is not None:
        sc = map_item.scale()
        if sc > 0 and math.isfinite(sc):
            rows.append(("Масштаб", "1:" + f"{sc:,.0f}".replace(",", " ")))
    if s["info_source"].strip():
        rows.append(("Эх сурвалж", s["info_source"].strip()))
    return rows


def _add_info(layout, project, map_item, s):
    rows = info_rows(project, map_item, s)
    if not rows:
        return None
    font = s["font"]
    size = float(s["info_font_size"])
    contents = []
    for label, value in rows:
        a = QgsTableCell(label)
        a.setTextFormat(text_format(font, size, True))
        b = QgsTableCell(value)
        b.setTextFormat(text_format(font, size))
        contents.append([a, b])
    return _manual_table(layout, contents, "nm_info", font, size)


def _add_table(layout, project, layer, s):
    head1, head2, rows, total = table_data(project, layer, s)
    if not rows:
        return None
    font = s["font"]
    size = float(s["table_font_size"])
    dec = int(s["table_decimals"])

    def cell(text, bg=None, bold=False, right=False):
        c = QgsTableCell(text)
        color = "#000000"
        if bg is not None:
            c.setBackgroundColor(QColor(bg))
            q = QColor(bg)
            lum = 0.299 * q.red() + 0.587 * q.green() + 0.114 * q.blue()
            if lum < 110:
                color = "#ffffff"
        c.setTextFormat(text_format(font, size, bold, color))
        if right:
            c.setHorizontalAlignment(Qt.AlignmentFlag.AlignRight)
        return c

    pct = bool(s.get("table_percent")) and total > 0
    head = [cell(head1, "#ffffff", True), cell(head2, "#ffffff", True, True)]
    if pct:
        head.append(cell("Хувь, %", "#ffffff", True, True))
    contents = [head]
    for label, value, color in rows:
        bg = color if color is not None else "#ffffff"
        row = [cell(label, bg), cell(_fmt_number(value, dec), bg, False, True)]
        if pct:
            row.append(cell(f"{value / total * 100:.1f}", bg, False, True))
        contents.append(row)
    if s["table_total"] and len(rows) > 1:
        row = [cell(table_total_label(layer), "#ffffff", True),
               cell(_fmt_number(total, dec), "#ffffff", True, True)]
        if pct:
            row.append(cell("100.0", "#ffffff", True, True))
        contents.append(row)
    return _manual_table(layout, contents, "nm_table", font, size)
