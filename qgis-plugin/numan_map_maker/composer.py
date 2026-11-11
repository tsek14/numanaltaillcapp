# -*- coding: utf-8 -*-
"""Тохиргооны толь бичгээс (dict) QGIS-ийн хэвлэлийн layout угсрах логик.

Энэ модуль нь цонх (GUI)-оос хамааралгүй тул headless орчинд ч ажиллана.
"""
import math
import os

from qgis.PyQt.QtCore import Qt, QPointF, QRectF
from qgis.PyQt.QtGui import QColor, QFont, QImageReader, QPolygonF
from qgis.core import (
    QgsCategorizedSymbolRenderer,
    QgsCoordinateReferenceSystem,
    QgsCoordinateTransform,
    QgsDistanceArea,
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
    QgsPointXY,
    QgsProject,
    QgsRasterLayer,
    QgsRectangle,
    QgsTableCell,
    QgsTextFormat,
    QgsUnitTypes,
    QgsVectorLayer,
)

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
    "legend_filter": True,
    "legend_skip_basemap": True,
    "legend_bg": True,
    # Хойд зүгийн сум
    "north": True,
    "north_pos": "TR",
    "north_size": 16.0,
    "north_svg": "",
    # Масштабын шугам
    "scalebar": True,
    "scalebar_pos": "BR",
    "scalebar_style": "Single Box",
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
    "table_pos": "TR",
    "table_font_size": 8.0,
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
    return isinstance(layer, QgsRasterLayer) and layer.providerType() in (
        "wms", "arcgismapserver", "xyzvectortiles", "vectortile")


def clear_layout(layout):
    for mf in list(layout.multiFrames()):
        layout.removeMultiFrame(mf)
    for it in list(layout.items()):
        if isinstance(it, QgsLayoutItem) and not isinstance(it, QgsLayoutItemPage):
            layout.removeLayoutItem(it)


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
    if mode == "layer":
        lyr = project.mapLayer(s["extent_layer"])
        if lyr is not None:
            ext = _transform_rect(lyr.extent(), lyr.crs(), crs, project)
    elif mode == "visible":
        root = project.layerTreeRoot()
        for node in root.findLayers():
            lyr = node.layer()
            if lyr is None or not node.isVisible() or is_basemap(lyr):
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
    if mode in ("layer", "visible"):
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


def build(layout, settings, canvas_extent=None, overrides=None, extent_override=None):
    """Layout-ыг цэвэрлээд тохиргооны дагуу дахин угсарна.

    overrides: {item_id: item_geom(...)} — хэрэглэгч гараар зөөсөн элементүүд.
    extent_override: QgsRectangle — хэрэглэгч гараар тохируулсан хамрах хүрээ.
    Буцаах утга: {item_id: item}
    """
    s = merged(settings)
    overrides = overrides or {}
    project = layout.project() or QgsProject.instance()
    items = {}

    stack = layout.undoStack()
    stack.blockCommands(True)
    try:
        clear_layout(layout)

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
        def make_titles():
            out = []
            if s["title"].strip():
                tf = text_format(font, float(s["title_size"]), True, s["title_color"])
                lb = _label(layout, s["title"].strip(), tf,
                            Qt.AlignmentFlag.AlignHCenter, item_id="nm_title")
                out.append(lb)
                items["nm_title"] = lb
            if s["subtitle"].strip():
                tf = text_format(font, float(s["title_size"]) * 0.7, False, s["title_color"])
                lb = _label(layout, s["subtitle"].strip(), tf,
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
        if s["caption"].strip():
            tf = text_format(font, float(s["caption_size"]), True)
            lb = _label(layout, s["caption"].strip(), tf,
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

        map_item = QgsLayoutItemMap(layout)
        map_item.setId("nm_map")
        layout.addLayoutItem(map_item)
        map_item.attemptMove(QgsLayoutPoint(mx, my))
        map_item.attemptResize(QgsLayoutSize(mw, mh))
        if "nm_map" in overrides:
            _apply_override(map_item, overrides["nm_map"])
            r = item_rect(map_item)
            mx, my, mw, mh = r.x(), r.y(), r.width(), r.height()
        map_item.setCrs(project.crs())
        map_item.setFrameEnabled(bool(s["map_frame"]))
        map_item.setFrameStrokeWidth(QgsLayoutMeasurement(0.4))
        map_item.setBackgroundColor(QColor(255, 255, 255))

        if extent_override is not None and not extent_override.isNull():
            map_item.zoomToExtent(extent_override)
        else:
            map_item.zoomToExtent(compute_extent(project, s, canvas_extent))
            if s["scale_mode"] == "fixed" and float(s["scale"]) > 0:
                map_item.setScale(float(s["scale"]))
            elif s["scale_mode"] == "round":
                sc = map_item.scale()
                if sc > 0 and math.isfinite(sc):
                    map_item.setScale(nice_scale(sc))
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

        if s["credits"].strip():
            tf = text_format(font, 6.5, False, "#333333")
            lb = _label(layout, s["credits"].strip(), tf,
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
            path = s["north_svg"] or DEFAULT_NORTH_ARROW
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
                drop = lyr is None or not _layer_visible(project, lyr)
                if not drop and s["legend_skip_basemap"] and is_basemap(lyr):
                    drop = True
                if drop:
                    parent = node.parent()
                    if parent is not None:
                        parent.removeChildNode(node)
            _prune_empty_groups(root)
            legend.setLegendFilterByMapEnabled(bool(s["legend_filter"]))
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

        # Буланд давхарлах дараалал
        if north is not None:
            corner.append((north, s["north_pos"]))
        if scalebar is not None:
            corner.append((scalebar, s["scalebar_pos"]))
        if scale_text is not None:
            corner.append((scale_text, s["scalebar_pos"]))
        for pic, ph, _pid in photos:
            corner.append((pic, ph.get("pos") or "TL"))
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
    layout.refresh()
    return items


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


def _add_table(layout, project, layer, s):
    rows = area_statistics(project, layer, s["table_field"])
    if not rows:
        return None
    div, unit = UNITS.get(s["table_unit"], UNITS["km2"])
    font = s["font"]
    size = float(s["table_font_size"])
    dec = int(s["table_decimals"])
    head2 = s["table_head2"].strip() or f"Талбай, {unit}"

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

    contents = [[cell(s["table_head1"], "#ffffff", True),
                 cell(head2, "#ffffff", True, True)]]
    total = 0.0
    for label, color, area in rows:
        total += area
        bg = color if color is not None else "#ffffff"
        contents.append([cell(label, bg), cell(_fmt_number(area / div, dec), bg, False, True)])
    if s["table_total"] and len(rows) > 1:
        contents.append([cell("Нийт", "#ffffff", True),
                         cell(_fmt_number(total / div, dec), "#ffffff", True, True)])

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
    frame.setId("nm_table")
    frame.attemptResize(QgsLayoutSize(60, 30))
    table.addFrame(frame)
    table.refresh()
    sz = table.totalSize()
    if sz.width() > 0 and sz.height() > 0:
        frame.attemptResize(QgsLayoutSize(sz.width(), sz.height()))
    return frame
