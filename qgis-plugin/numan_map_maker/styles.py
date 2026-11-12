# -*- coding: utf-8 -*-
"""Давхаргын стандарт загварын сан.

Давхаргын нэр дэх түлхүүр үгээр (гол, зам, хил …) таньж, тогтсон өнгө, дүрсийг
оноодог. Суулгасан дүрмүүдээс гадна хэрэглэгч өөрийн давхаргын загварыг түлхүүр
үгтэй нь санд хадгалж, дараагийн төсөлд автоматаар хэрэглүүлж болно.
"""
import json
import os

from qgis.PyQt.QtXml import QDomDocument
from qgis.core import (
    QgsApplication,
    QgsFillSymbol,
    QgsLineSymbol,
    QgsMarkerSymbol,
    QgsReadWriteContext,
    QgsSingleSymbolRenderer,
    QgsSymbolLayerUtils,
    QgsVectorLayer,
    QgsWkbTypes,
)

POINT, LINE, POLYGON = "point", "line", "polygon"

# (нэр, түлхүүр үгс, {геометр: simple symbol-ийн шинж чанар})
# Дээрээс доош эхний таарсан дүрэм хэрэглэгдэнэ: нарийн үг нь өмнө байх ёстой.
BUILTIN = [
    ("Судалгааны / төслийн талбай",
     ["судалгааны талбай", "төслийн талбай", "талбайн хил", "study area", "project area", "aoi"],
     {POLYGON: {"color": "255,0,0,0", "style": "no", "outline_color": "#e60000",
                "outline_width": "0.9"},
      LINE: {"color": "#e60000", "width": "0.9"}}),
    ("Улсын хил", ["улсын хил", "country", "national boundary"],
     {POLYGON: {"style": "no", "outline_color": "#000000", "outline_width": "1.0",
                "outline_style": "dash dot"},
      LINE: {"color": "#000000", "width": "1.0", "line_style": "dash dot"}}),
    ("Аймгийн хил", ["аймгийн хил", "аймаг", "aimag", "province"],
     {POLYGON: {"style": "no", "outline_color": "#7a3b00", "outline_width": "0.7",
                "outline_style": "dash"},
      LINE: {"color": "#7a3b00", "width": "0.7", "line_style": "dash"}}),
    ("Сумын хил", ["сумын хил", "сум", "soum", "sum_"],
     {POLYGON: {"style": "no", "outline_color": "#d9b300", "outline_width": "0.5"},
      LINE: {"color": "#d9b300", "width": "0.5"}}),
    ("Тусгай хамгаалалттай газар", ["тхг", "хамгаалалт", "дцг", "бцг", "protected", "spa"],
     {POLYGON: {"color": "76,175,80,70", "outline_color": "#1b5e20", "outline_width": "0.5"},
      LINE: {"color": "#1b5e20", "width": "0.6"}}),
    ("Түймэрт өртсөн талбай", ["түймэр", "шатсан", "өртсөн", "fire", "burn"],
     {POLYGON: {"color": "255,87,34,90", "outline_color": "#bf360c", "outline_width": "0.4"},
      POINT: {"name": "cross_fill", "color": "#e60000", "size": "4",
              "outline_color": "#7f0000"}}),
    ("Лиценз / тусгай зөвшөөрөл", ["лиценз", "тусгай зөвшөөр", "license", "licence", "mv-", "xv-"],
     {POLYGON: {"color": "233,30,99,35", "outline_color": "#ad1457", "outline_width": "0.6"},
      LINE: {"color": "#ad1457", "width": "0.6"}}),
    ("Нуур, усан сан", ["нуур", "усан сан", "lake", "water body", "waterbody"],
     {POLYGON: {"color": "#a6d5f5", "outline_color": "#2b7bba", "outline_width": "0.3"}}),
    ("Гол, горхи", ["гол", "горхи", "river", "stream", "усны сүлжээ", "hydro"],
     {LINE: {"color": "#2b7bba", "width": "0.5"},
      POLYGON: {"color": "#a6d5f5", "outline_color": "#2b7bba", "outline_width": "0.3"}}),
    ("Төмөр зам", ["төмөр зам", "rail"],
     {LINE: {"color": "#222222", "width": "0.7", "line_style": "dash"}}),
    ("Авто зам", ["зам", "road", "track", "маршрут", "route"],
     {LINE: {"color": "#8d4a1a", "width": "0.6"}}),
    ("Ой", ["ой", "forest", "мод"],
     {POLYGON: {"color": "56,142,60,120", "outline_color": "#1b5e20", "outline_width": "0.2"}}),
    ("Суурин газар", ["суурин", "хот", "тосгон", "сумын төв", "settlement", "town", "city"],
     {POINT: {"name": "circle", "color": "#ffffff", "size": "3", "outline_color": "#000000",
              "outline_width": "0.5"},
      POLYGON: {"color": "#bdbdbd", "outline_color": "#616161", "outline_width": "0.3"}}),
    ("Шалгах / дээж авсан цэг", ["цэг", "дээж", "байршил", "point", "sample", "station"],
     {POINT: {"name": "star", "color": "#ff00cc", "size": "4", "outline_color": "#000000"}}),
    ("Өндрийн шугам", ["горизонтал", "өндрийн шугам", "contour"],
     {LINE: {"color": "#a1785a", "width": "0.2"}}),
]


def geom_kind(layer):
    if not isinstance(layer, QgsVectorLayer):
        return None
    g = layer.geometryType()
    if g == QgsWkbTypes.PointGeometry:
        return POINT
    if g == QgsWkbTypes.LineGeometry:
        return LINE
    if g == QgsWkbTypes.PolygonGeometry:
        return POLYGON
    return None


def _simple(kind, props):
    cls = {POINT: QgsMarkerSymbol, LINE: QgsLineSymbol, POLYGON: QgsFillSymbol}[kind]
    return cls.createSimple(props)


# ---- Хэрэглэгчийн сан --------------------------------------------------
def user_path():
    d = os.path.join(QgsApplication.qgisSettingsDirPath(), "numan_map_maker")
    os.makedirs(d, exist_ok=True)
    return os.path.join(d, "layer_styles.json")


def load_user():
    """[{name, keywords, geom, symbol_xml}]"""
    try:
        with open(user_path(), "r", encoding="utf-8") as fh:
            data = json.load(fh)
        return [e for e in data if isinstance(e, dict) and e.get("keywords")]
    except (OSError, ValueError):
        return []


def _save_user(entries):
    with open(user_path(), "w", encoding="utf-8") as fh:
        json.dump(entries, fh, ensure_ascii=False, indent=1)


def symbol_to_xml(symbol):
    doc = QDomDocument("s")
    el = QgsSymbolLayerUtils.saveSymbol("s", symbol, doc, QgsReadWriteContext())
    doc.appendChild(el)
    return doc.toString()


def symbol_from_xml(xml):
    doc = QDomDocument()
    if not doc.setContent(xml):
        return None
    return QgsSymbolLayerUtils.loadSymbol(doc.documentElement(), QgsReadWriteContext())


def save_layer_style(layer, keywords, name=""):
    """Нэг тэмдэгтэй (single symbol) давхаргын загварыг түлхүүр үгтэй нь санд хадгална."""
    kind = geom_kind(layer)
    r = layer.renderer() if kind else None
    if not isinstance(r, QgsSingleSymbolRenderer) or r.symbol() is None:
        return False
    kws = [k.strip().lower() for k in keywords if k.strip()]
    if not kws:
        return False
    entries = [e for e in load_user()
               if not (e.get("geom") == kind and set(e.get("keywords", [])) == set(kws))]
    entries.insert(0, {"name": name or layer.name(), "keywords": kws, "geom": kind,
                       "symbol_xml": symbol_to_xml(r.symbol())})
    _save_user(entries)
    return True


def delete_user_style(index):
    entries = load_user()
    if 0 <= index < len(entries):
        del entries[index]
        _save_user(entries)
        return True
    return False


# ---- Таних, оноох ------------------------------------------------------
def match(layer):
    """Давхаргад тохирох загварыг олно: (дүрмийн нэр, symbol) эсвэл None.

    Хэрэглэгчийн сан суулгасан дүрмээс түрүүлж шалгагдана.
    """
    kind = geom_kind(layer)
    if kind is None:
        return None
    name = layer.name().lower().replace("_", " ")
    for e in load_user():
        if e.get("geom") == kind and any(k in name for k in e.get("keywords", [])):
            sym = symbol_from_xml(e.get("symbol_xml") or "")
            if sym is not None:
                return (e.get("name") or "Миний загвар", sym)
    for rule_name, keywords, by_geom in BUILTIN:
        if kind in by_geom and any(k in name for k in keywords):
            return (rule_name, _simple(kind, by_geom[kind]))
    return None


def apply(layer):
    """Тохирох стандарт загварыг давхаргад онооно. Оноосон дүрмийн нэр эсвэл None.

    Ангилсан (categorized) зэрэг олон тэмдэгтэй загвартай давхаргад хүрэхгүй:
    хэрэглэгчийн хийсэн ангиллыг устгахгүйн тулд.
    """
    if not isinstance(layer, QgsVectorLayer) or \
            not isinstance(layer.renderer(), QgsSingleSymbolRenderer):
        return None
    m = match(layer)
    if m is None:
        return None
    layer.setRenderer(QgsSingleSymbolRenderer(m[1]))
    layer.triggerRepaint()
    return m[0]
