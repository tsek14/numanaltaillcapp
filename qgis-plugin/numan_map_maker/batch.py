# -*- coding: utf-8 -*-
"""Цуврал зураг: нэг тохиргоогоор олон зургийг дараалан гаргах ажлын жагсаалт.

Ажил (job) бүр нь үндсэн тохиргоон дээр давхарлах өөрчлөлт:
  {"name": нэр, "settings": {...}}
"""
import re

from qgis.core import QgsCoordinateTransform, QgsFeatureRequest, QgsVectorLayer


def by_features(project, layer, name_field="", only_selected=False, limit=500):
    """Давхаргын объект бүрд нэг зураг (объектын хүрээгээр томруулна)."""
    jobs = []
    if not isinstance(layer, QgsVectorLayer):
        return jobs
    ct = QgsCoordinateTransform(layer.crs(), project.crs(), project)
    ct.setBallparkTransformsAreAppropriate(True)
    idx = layer.fields().lookupField(name_field) if name_field else -1
    req = QgsFeatureRequest()
    if only_selected:
        req.setFilterFids(layer.selectedFeatureIds())
    for feat in layer.getFeatures(req):
        geom = feat.geometry()
        if geom is None or geom.isEmpty():
            continue
        try:
            r = ct.transformBoundingBox(geom.boundingBox())
        except Exception:
            continue
        if r.isNull() or not r.isFinite():
            continue
        if r.width() == 0 and r.height() == 0:      # цэг: орчмыг нь харуулна
            pad = 2000.0 if not project.crs().isGeographic() else 0.02
            r.grow(pad)
        name = ""
        if idx >= 0:
            val = feat.attribute(idx)
            name = "" if val is None or str(val) == "NULL" else str(val)
        name = name or f"{layer.name()} {feat.id()}"
        jobs.append({"name": name, "settings": {
            "extent_mode": "rect",
            "extent_rect": [r.xMinimum(), r.yMinimum(), r.xMaximum(), r.yMaximum()],
            "_tokens": {"name": name, "layer": layer.name()},
        }})
        if len(jobs) >= limit:
            break
    return jobs


def by_layers(project, layer_ids):
    """Сонгосон давхарга бүрд нэг зураг: тухайн үед бусад сонгосон давхарга нуугдана."""
    jobs = []
    for lid in layer_ids:
        lyr = project.mapLayer(lid)
        if lyr is None:
            continue
        st = {
            "map_hidden_layers": [i for i in layer_ids if i != lid],
            "map_shown_layers": [lid],      # самбарт нуугдсан байсан ч энэ зурагт гарна
            "_tokens": {"name": lyr.name(), "layer": lyr.name()},
        }
        # Давхцлын үр дүнгийн давхарга бол хүснэгтийг нь тухайн зурагт харуулна
        own = lyr.customProperty("numan_map_maker/overlap")
        if own:
            st.update({"table": True, "table_layer": lid, "table_field": "",
                       "table_percent": True})
            # Бусад давхцлын хилийн давхаргууд (аймаг, ТХГ …) энэ сэдвийн зурагт орохгүй
            for other in project.mapLayers().values():
                b = other.customProperty("numan_map_maker/overlap")
                if b and b != own and b not in st["map_hidden_layers"]:
                    st["map_hidden_layers"].append(b)
        jobs.append({"name": lyr.name(), "settings": st})
    return jobs


def job_settings(base, job, index, start_no=None):
    """Ажлын эцсийн тохиргоо: үндсэн тохиргоо + ажлын өөрчлөлт + зургийн дугаар."""
    s = dict(base)
    s.update(job["settings"])
    first = int(base.get("fig_no") or 1) if start_no is None else int(start_no)
    s["fig_no"] = first + index
    return s


def file_name(pattern, job, s, index):
    """Файлын нэрийн загвар: {i} дугаар, {n} зургийн дугаар, {name} нэр."""
    chapter = str(s.get("fig_chapter") or "").strip()
    n = f"{chapter}.{s['fig_no']}" if chapter else str(s["fig_no"])
    name = (pattern or "{i}_{name}")
    name = name.replace("{i}", f"{index + 1:02d}").replace("{n}", n).replace("{name}", job["name"])
    name = re.sub(r'[\\/:*?"<>|\r\n]+', "_", name).strip(" .")
    return name[:120] or f"zurag_{index + 1:02d}"
