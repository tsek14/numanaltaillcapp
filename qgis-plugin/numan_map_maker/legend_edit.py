# -*- coding: utf-8 -*-
"""Таних тэмдгийн мөрүүдийг (нэр, өнгө, дүрс) засварлах логик.

Энэ модуль нь цонхноос (GUI) хамааралгүй. Засвар нь давхаргын загвар
(renderer) дээр шууд хийгддэг тул газрын зураг болон таних тэмдэг хоёр
нэг эх сурвалжаас зурагдаж, хамт өөрчлөгдөнө.
"""
from qgis.core import (
    QgsFeatureRequest,
    QgsSymbolLayerUtils,
    QgsCategorizedSymbolRenderer,
    QgsGraduatedSymbolRenderer,
    QgsProject,
    QgsRuleBasedRenderer,
    QgsSingleSymbolRenderer,
    QgsVectorLayer,
)

from . import composer

# Загварын төрөл
SINGLE = "single"
CATEGORIZED = "categorized"
GRADUATED = "graduated"
RULE = "rule"
OTHER = "other"


class Entry:
    """Таних тэмдгийн нэг мөр: нэр + тэмдэг (symbol)."""

    __slots__ = ("key", "label", "symbol")

    def __init__(self, key, label, symbol):
        self.key = key
        self.label = label
        self.symbol = symbol


def editable_layers(project=None, skip_basemap=True):
    """Төсөлд харагдаж буй, суурь зураг биш давхаргуудыг (давхаргын модны дарааллаар) буцаана."""
    project = project or QgsProject.instance()
    out = []
    for node in project.layerTreeRoot().findLayers():
        lyr = node.layer()
        if lyr is None or not node.isVisible():
            continue
        if skip_basemap and composer.is_basemap(lyr):
            continue
        out.append(lyr)
    return out


def renderer_kind(layer):
    if not isinstance(layer, QgsVectorLayer):
        return OTHER
    r = layer.renderer()
    if isinstance(r, QgsSingleSymbolRenderer):
        return SINGLE
    if isinstance(r, QgsCategorizedSymbolRenderer):
        return CATEGORIZED
    if isinstance(r, QgsGraduatedSymbolRenderer):
        return GRADUATED
    if isinstance(r, QgsRuleBasedRenderer):
        return RULE
    return OTHER


def _leaf_rules(rule):
    out = []
    for child in rule.children():
        if child.symbol() is not None:
            out.append(child)
        out.extend(_leaf_rules(child))
    return out


def list_entries(layer):
    """Давхаргын загварын мөрүүд. Нэг тэмдэгтэй загварт нэг мөр (key=0), label нь хоосон."""
    kind = renderer_kind(layer)
    r = layer.renderer() if kind != OTHER else None
    out = []
    if kind == SINGLE:
        sym = r.symbol()
        if sym is not None:
            out.append(Entry(0, "", sym.clone()))
    elif kind == CATEGORIZED:
        for i, c in enumerate(r.categories()):
            sym = c.symbol()
            out.append(Entry(i, c.label(), sym.clone() if sym is not None else None))
    elif kind == GRADUATED:
        for i, rg in enumerate(r.ranges()):
            sym = rg.symbol()
            out.append(Entry(i, rg.label(), sym.clone() if sym is not None else None))
    elif kind == RULE:
        for rule in _leaf_rules(r.rootRule()):
            out.append(Entry(rule.ruleKey(), rule.label() or rule.description() or "",
                             rule.symbol().clone()))
    return out


def _find_rule(root, key):
    for rule in [root] + _leaf_rules(root):
        if rule.ruleKey() == key:
            return rule
    return None


def apply_entry(layer, key, label=None, symbol=None):
    """Нэг мөрийн нэр (label) болон/эсвэл тэмдгийг (symbol) давхаргын загварт хэрэгжүүлнэ.

    Загварыг хуулж, өөрчлөөд буцааж оноодог тул QGIS бүх дохио (давхаргын
    самбар, үндсэн зураг, таних тэмдэг) зөв шинэчлэгдэнэ. Амжилттай бол True.
    """
    kind = renderer_kind(layer)
    if kind == OTHER:
        return False
    r = layer.renderer().clone()
    ok = False
    if kind == SINGLE:
        if symbol is not None:
            r.setSymbol(symbol.clone())
            ok = True
    elif kind == CATEGORIZED:
        if 0 <= key < len(r.categories()):
            if label is not None:
                ok = r.updateCategoryLabel(key, label) or ok
            if symbol is not None:
                ok = r.updateCategorySymbol(key, symbol.clone()) or ok
    elif kind == GRADUATED:
        if 0 <= key < len(r.ranges()):
            if label is not None:
                ok = r.updateRangeLabel(key, label) or ok
            if symbol is not None:
                ok = r.updateRangeSymbol(key, symbol.clone()) or ok
    elif kind == RULE:
        rule = _find_rule(r.rootRule(), key)
        if rule is not None:
            if label is not None:
                rule.setLabel(label)
                ok = True
            if symbol is not None:
                rule.setSymbol(symbol.clone())
                ok = True
    if not ok:
        return False
    layer.setRenderer(r)
    layer.triggerRepaint()
    QgsProject.instance().setDirty(True)
    return True


def apply_color(layer, key, color):
    """Тэмдгийн үндсэн өнгийг солино (бусад шинж чанар хэвээр)."""
    for e in list_entries(layer):
        if e.key == key and e.symbol is not None:
            e.symbol.setColor(color)
            return apply_entry(layer, key, symbol=e.symbol)
    return False


def backup_renderer(store, layer):
    """Анхны загварыг нэг л удаа хадгална (буцаахад хэрэглэнэ)."""
    if layer.id() not in store and layer.renderer() is not None:
        store[layer.id()] = layer.renderer().clone()


def restore_renderer(store, layer):
    r = store.pop(layer.id(), None)
    if r is None:
        return False
    layer.setRenderer(r)
    layer.triggerRepaint()
    QgsProject.instance().setDirty(True)
    return True


MAX_EMBEDDED_FEATURES = 20000
MAX_EMBEDDED_STYLES = 15


def convert_embedded(layer):
    """KML зэрэг объект бүр өөрийн загвартай давхаргыг ижил харагдах энгийн
    загвар руу хөрвүүлнэ.

    QGIS «Embedded Symbols» загвартай давхаргад таних тэмдгийн дүрс огт
    үүсгэдэггүй. Иймд объектуудын жинхэнэ загварыг уншиж, бүгд ижил бол нэг
    тэмдэгтэй, ялгаатай бол загвар бүрд нэг дүрэмтэй (rule-based) загвар
    болгоно. Газрын зураг дээрх харагдац өөрчлөгдөхгүй. Хөрвүүлсэн бол True.
    """
    if not composer.has_embedded_symbols(layer):
        return False
    if layer.featureCount() > MAX_EMBEDDED_FEATURES:
        return False
    default = layer.renderer().defaultSymbol()
    name_idx = -1
    for cand in ("Name", "name", "NAME"):
        name_idx = layer.fields().lookupField(cand)
        if name_idx >= 0:
            break
    req = QgsFeatureRequest()
    req.setFlags(QgsFeatureRequest.EmbeddedSymbols | QgsFeatureRequest.NoGeometry)
    styles = {}  # загварын түлхүүр -> [symbol, нэр, [fid]]
    for feat in layer.getFeatures(req):
        sym = feat.embeddedSymbol() or default
        if sym is None:
            continue
        key = str(QgsSymbolLayerUtils.symbolProperties(sym))
        if key not in styles:
            if len(styles) >= MAX_EMBEDDED_STYLES:
                return False
            label = ""
            if name_idx >= 0:
                val = feat.attribute(name_idx)
                label = "" if val is None or str(val) == "NULL" else str(val)
            styles[key] = [sym.clone(), label, []]
        styles[key][2].append(feat.id())
    if not styles:
        return False
    if len(styles) == 1:
        renderer = QgsSingleSymbolRenderer(next(iter(styles.values()))[0])
    else:
        root = QgsRuleBasedRenderer.Rule(None)
        for i, (sym, label, fids) in enumerate(styles.values()):
            flt = "$id IN ({})".format(",".join(str(f) for f in fids))
            root.appendChild(QgsRuleBasedRenderer.Rule(
                sym, 0, 0, flt, label or f"Төрөл {i + 1}"))
        renderer = QgsRuleBasedRenderer(root)
    layer.setRenderer(renderer)
    layer.triggerRepaint()
    return True
