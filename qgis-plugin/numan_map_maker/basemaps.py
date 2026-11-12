# -*- coding: utf-8 -*-
"""Онлайн суурь зураг (фон) болон дээр нь давхарлах overlay давхаргууд.

Сонгосон давхаргуудыг XYZ tile хэлбэрээр төсөлд нэмж, сонголт өөрчлөгдөхөд
плагины өмнө нэмсэн давхаргуудыг сольж өгнө. Хэрэглэгчийн өөрийн давхаргад
огт хүрэхгүй.
"""
from urllib.parse import quote

from qgis.core import QgsRasterLayer

ROLE = "numan_map_maker/role"      # basemap | overlay
SIGN = "numan_map_maker/signature"

_ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/{}/MapServer/tile/{{z}}/{{y}}/{{x}}"
_GOOGLE = "https://mt1.google.com/vt/lyrs={}&x={{x}}&y={{y}}&z={{z}}"
_BING = "https://ecn.t3.tiles.virtualearth.net/tiles/{}{{q}}.{}?g=1"
_MAPBOX = ("https://api.mapbox.com/styles/v1/mapbox/{}/tiles/256/{{z}}/{{x}}/{{y}}@2x"
           "?access_token={{token}}")
_CARTO = "https://basemaps.cartocdn.com/{}/{{z}}/{{x}}/{{y}}@2x.png"

# key: (нэр, бүлэг, url, хамгийн их zoom, эх сурвалжийн бичвэр)
BASEMAPS = {
    "google_sat": ("Google — Сансрын зураг", "Google", _GOOGLE.format("s"), 20, "© Google"),
    "google_hybrid": ("Google — Hybrid (сансар + нэр)", "Google", _GOOGLE.format("y"), 20,
                      "© Google"),
    "google_road": ("Google — Замын зураг", "Google", _GOOGLE.format("m"), 20, "© Google"),
    "google_terrain": ("Google — Topo / гадаргуу", "Google", _GOOGLE.format("p"), 20,
                       "© Google"),
    "osm": ("OpenStreetMap", "OpenStreetMap", "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
            19, "© OpenStreetMap contributors"),
    "opentopo": ("OpenTopoMap — Topo", "OpenStreetMap",
                 "https://tile.opentopomap.org/{z}/{x}/{y}.png", 17,
                 "© OpenStreetMap contributors, SRTM | © OpenTopoMap (CC-BY-SA)"),
    "bing_sat": ("Bing — Сансрын зураг", "Bing", _BING.format("a", "jpeg"), 19, "© Microsoft"),
    "bing_hybrid": ("Bing — Hybrid (сансар + нэр)", "Bing", _BING.format("h", "jpeg"), 19,
                    "© Microsoft"),
    "bing_road": ("Bing — Замын зураг", "Bing", _BING.format("r", "png"), 19, "© Microsoft"),
    "esri_sat": ("Esri — Сансрын зураг (World Imagery)", "Esri",
                 _ESRI.format("World_Imagery"), 19, "Esri, Maxar, Earthstar Geographics"),
    "esri_topo": ("Esri — Topo", "Esri", _ESRI.format("World_Topo_Map"), 19,
                  "Esri, HERE, Garmin, FAO, NOAA, USGS"),
    "esri_street": ("Esri — Замын зураг", "Esri", _ESRI.format("World_Street_Map"), 19,
                    "Esri, HERE, Garmin, USGS"),
    "esri_natgeo": ("Esri — National Geographic", "Esri", _ESRI.format("NatGeo_World_Map"), 16,
                    "National Geographic, Esri, Garmin, HERE, UNEP-WCMC, USGS, NASA, ESA, "
                    "METI, NRCAN, GEBCO, NOAA"),
    "esri_relief": ("Esri — Сүүдэрт рельеф", "Esri", _ESRI.format("World_Shaded_Relief"), 13,
                    "Esri, USGS"),
    "esri_gray": ("Esri — Саарал суурь", "Esri",
                  _ESRI.format("Canvas/World_Light_Gray_Base"), 16, "Esri, HERE, Garmin"),
    "mapbox_sat": ("Mapbox — Сансрын зураг", "Mapbox (token шаардана)",
                   _MAPBOX.format("satellite-v9"), 22, "© Mapbox © Maxar"),
    "mapbox_hybrid": ("Mapbox — Hybrid (сансар + зам)", "Mapbox (token шаардана)",
                      _MAPBOX.format("satellite-streets-v12"), 22,
                      "© Mapbox © OpenStreetMap © Maxar"),
    "mapbox_streets": ("Mapbox — Замын зураг", "Mapbox (token шаардана)",
                       _MAPBOX.format("streets-v12"), 22, "© Mapbox © OpenStreetMap"),
    "mapbox_outdoors": ("Mapbox — Topo (Outdoors)", "Mapbox (token шаардана)",
                        _MAPBOX.format("outdoors-v12"), 22, "© Mapbox © OpenStreetMap"),
    "carto_light": ("CARTO — Цайвар", "CARTO", _CARTO.format("light_all"), 20,
                    "© OpenStreetMap contributors © CARTO"),
    "carto_dark": ("CARTO — Бараан", "CARTO", _CARTO.format("dark_all"), 20,
                   "© OpenStreetMap contributors © CARTO"),
}

# key: (нэр, url, хамгийн их zoom, эх сурвалжийн бичвэр)
OVERLAYS = {
    "google_labels": ("Google — Нэр, зам (labels)", _GOOGLE.format("h"), 20, "© Google"),
    "esri_places": ("Esri — Хил, газрын нэр",
                    _ESRI.format("Reference/World_Boundaries_and_Places"), 19, "Esri"),
    "esri_roads": ("Esri — Зам (roads)", _ESRI.format("Reference/World_Transportation"), 19,
                   "Esri"),
    "carto_labels": ("CARTO — Газрын нэр (хар)", _CARTO.format("light_only_labels"), 20,
                     "© OpenStreetMap contributors © CARTO"),
    "carto_labels_dark": ("CARTO — Газрын нэр (цагаан)", _CARTO.format("dark_only_labels"), 20,
                          "© OpenStreetMap contributors © CARTO"),
    "opentopo_hike": ("Waymarked Trails — Явган аялалын зам",
                      "https://tile.waymarkedtrails.org/hiking/{z}/{x}/{y}.png", 18,
                      "© waymarkedtrails.org"),
}


def needs_token(key):
    return key.startswith("mapbox_")


def _layer(name, url, zmax, token):
    url = url.replace("{token}", quote(token or "", safe=""))
    # «/» ба «:»-г кодлохгүй: QGIS %2F, %3F-г буцааж тайлдаггүй тул tile татагдахгүй болно
    uri = "type=xyz&zmin=0&zmax={}&url={}".format(zmax, quote(url, safe="/:?@,;+"))
    return QgsRasterLayer(uri, name, "wms")


def _wanted(s):
    """[(role, key, нэр, url, zmax)] — доороос дээш дарааллаар."""
    token = (s.get("mapbox_token") or "").strip()
    out = []
    key = s.get("basemap") or ""
    if key in BASEMAPS and not (needs_token(key) and not token):
        name, _grp, url, zmax, _a = BASEMAPS[key]
        out.append(("basemap", key, name, url, zmax))
    for key in s.get("overlays") or []:
        if key in OVERLAYS:
            name, url, zmax, _a = OVERLAYS[key]
            out.append(("overlay", key, name, url, zmax))
    # Байршлын жижиг зургийн фон: төсөлд нуугдмал (чагтгүй) давхарга болж нэмэгдэнэ
    key = s.get("inset_base") or ""
    if s.get("inset") and key in BASEMAPS and not (needs_token(key) and not token):
        name, _grp, url, zmax, _a = BASEMAPS[key]
        out.append(("inset", key, "Байршлын зургийн фон — " + name, url, zmax))
    return out, token


def attribution(s):
    """Сонгосон суурь зураг, overlay-н эх сурвалжийн бичвэр."""
    parts = []
    key = s.get("basemap") or ""
    if key in BASEMAPS:
        parts.append(BASEMAPS[key][4])
    for key in s.get("overlays") or []:
        if key in OVERLAYS and OVERLAYS[key][3] not in ", ".join(parts):
            parts.append(OVERLAYS[key][3])
    return ", ".join(parts)


def from_project(project):
    """Төсөлд плагины өмнө нэмсэн суурь зураг, overlay-н сонголтыг уншина."""
    out = {"basemap": "", "overlays": [], "overlays_on_top": False}
    for lyr in plugin_layers(project):
        for part in str(lyr.customProperty(SIGN) or "").split("|"):
            if part.startswith("basemap:") and part[8:] in BASEMAPS:
                out["basemap"] = part[8:]
            elif part.startswith("overlay:") and part[8:] in OVERLAYS \
                    and part[8:] not in out["overlays"]:
                out["overlays"].append(part[8:])
            elif part == "top=1":
                out["overlays_on_top"] = True
        break
    return out


def plugin_layers(project):
    return [l for l in project.mapLayers().values() if l.customProperty(ROLE)]


def sync(project, s):
    """Төслийн суурь зураг, overlay-г тохиргоотой тааруулна.

    Юм өөрчлөгдсөн бол True буцаана.
    """
    wanted, token = _wanted(s)
    on_top = bool(s.get("overlays_on_top"))
    sign = "|".join(f"{r}:{k}" for r, k, *_ in wanted) + f"|top={int(on_top)}|{token}"
    root = project.layerTreeRoot()
    present = plugin_layers(project)
    # Хэрэглэгч давхаргын модноос гараар устгасан бол дахин нэмнэ
    alive = [l for l in present if root.findLayer(l.id()) is not None]
    if len(alive) == len(wanted) and all(l.customProperty(SIGN) == sign for l in alive) \
            and len(alive) == len(present):
        return False

    if present:
        project.removeMapLayers([l.id() for l in present])

    top_index = 0
    for role, key, name, url, zmax in wanted:
        lyr = _layer(name, url, zmax, token)
        if not lyr.isValid():
            continue
        lyr.setCustomProperty(ROLE, role)
        lyr.setCustomProperty(SIGN, sign)
        project.addMapLayer(lyr, False)
        if role == "inset":
            node = root.addLayer(lyr)
            node.setItemVisibilityChecked(False)    # үндсэн зурагт харагдахгүй
        elif role == "basemap":
            # хамгийн доод талд (байршлын зургийн нуугдмал фоны дээр)
            children = root.children()
            idx = len(children)
            for i, nd in enumerate(children):
                l = nd.layer() if hasattr(nd, "layer") else None
                if l is not None and l.customProperty(ROLE) == "inset":
                    idx = i
                    break
            root.insertLayer(idx, lyr)
        elif on_top:
            root.insertLayer(top_index, lyr)        # хэрэглэгчийн давхаргуудын дээр
        else:
            # Суурь зургийн яг дээр, хэрэглэгчийн давхаргуудын доор
            children = root.children()
            idx = len(children)
            for i, node in enumerate(children):
                l = node.layer() if hasattr(node, "layer") else None
                if l is not None and l.customProperty(ROLE) == "basemap":
                    idx = i
                    break
            for i, node in enumerate(children):
                l = node.layer() if hasattr(node, "layer") else None
                if l is not None and l.customProperty(ROLE) == "overlay":
                    idx = min(idx, i)
                    break
            root.insertLayer(idx, lyr)
    return True
