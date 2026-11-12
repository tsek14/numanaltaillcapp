# -*- coding: utf-8 -*-
"""Бэлэн загварууд: суулгасан (плагинтай хамт ирдэг) болон хэрэглэгчийн хадгалсан.

Загвар нь тохиргооны зөвхөн хэсэг (хуудас, байрлал, фонт гэх мэт) тул оноход
төслийн давхарга, фото, таних тэмдгийн дараалалд хүрэхгүй.
"""
import json
import os
import re

from qgis.core import QgsApplication

# Төсөл бүрд өөр байдаг тул загварт хэзээ ч хадгалахгүй түлхүүрүүд
PROJECT_KEYS = (
    "photos", "extent_layer", "extent_rect", "table_layer", "table_field",
    "legend_titles", "legend_order", "legend_hidden", "map_hidden_layers",
    "inset_layer", "mapbox_token", "fig_no",
)

BUILTIN = {
    "Байршлын зураг (A4 хэвтээ)": {
        "page_size": "A4", "orientation": "landscape", "title_place": "outside",
        "grid": True, "grid_crs": "geo", "grid_style": "frame", "grid_frame": "ticks",
        "legend": True, "legend_pos": "BL", "north": True, "north_pos": "TR",
        "scalebar": True, "scalebar_pos": "BR", "scale_text": False,
        "inset": True, "inset_pos": "TL", "inset_extent": "mongolia",
        "table": False, "info": False,
    },
    "Түймэр / хээрийн судалгааны зураг (сансрын фон)": {
        "page_size": "A4", "orientation": "landscape", "title_place": "outside",
        "basemap": "esri_natgeo", "overlays": [],
        "grid": True, "grid_crs": "geo", "grid_style": "frame", "grid_frame": "ticks",
        "legend": True, "legend_pos": "BL", "legend_bg": True,
        "north": True, "north_pos": "TR", "scalebar": True, "scalebar_pos": "BR",
        "photo_lines": True, "photo_line_color": "#b000ff", "photo_coord_label": True,
        "inset": False, "table": False,
    },
    "Газар ашиглалтын өөрчлөлт (талбайн хүснэгттэй)": {
        "page_size": "A4", "orientation": "landscape", "title_place": "inside",
        "grid": True, "grid_crs": "geo", "grid_style": "frame", "grid_frame": "ticks",
        "legend": True, "legend_pos": "BR", "north": True, "north_pos": "TL",
        "scalebar": True, "scalebar_pos": "BL", "scale_text": True,
        "table": True, "table_pos": "TR", "table_unit": "km2", "table_decimals": 3,
        "caption_auto": True, "inset": False,
    },
    "Тайлангийн зураг (A4 босоо, дугаартай)": {
        "page_size": "A4", "orientation": "portrait", "title_place": "outside",
        "margin": 10.0, "grid": True, "grid_style": "frame", "grid_frame": "ticks",
        "legend": True, "legend_pos": "BL", "north": True, "north_pos": "TR",
        "scalebar": True, "scalebar_pos": "BR", "caption_auto": True,
        "info": True, "info_pos": "BR", "scalebar_pos": "BL", "legend_pos": "TL",
    },
    "Ханын зураг (A1 хэвтээ)": {
        "page_size": "A1", "orientation": "landscape", "margin": 15.0,
        "title_size": 44.0, "caption_size": 22.0, "grid_font_size": 14.0,
        "legend_font_size": 18.0, "table_font_size": 16.0, "info_font_size": 14.0,
        "north_size": 45.0, "inset_size": 150.0, "logo_size": 70.0,
        "legend": True, "legend_pos": "OUT", "legend_out_width": 150.0,
        "north": True, "scalebar": True, "inset": True, "info": True,
    },
}


def user_dir():
    d = os.path.join(QgsApplication.qgisSettingsDirPath(), "numan_map_maker", "templates")
    os.makedirs(d, exist_ok=True)
    return d


def _safe_name(name):
    return re.sub(r'[\\/:*?"<>|]+', "_", name).strip()[:80] or "zagvar"


def list_user():
    """{нэр: файлын зам}"""
    out = {}
    try:
        for fn in sorted(os.listdir(user_dir())):
            if fn.lower().endswith(".json"):
                out[os.path.splitext(fn)[0]] = os.path.join(user_dir(), fn)
    except OSError:
        pass
    return out


def strip_project_keys(settings):
    return {k: v for k, v in settings.items()
            if k not in PROJECT_KEYS and not k.startswith("_")}


def save_user(name, settings):
    path = os.path.join(user_dir(), _safe_name(name) + ".json")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(strip_project_keys(settings), fh, ensure_ascii=False, indent=2)
    return path


def delete_user(name):
    path = list_user().get(name)
    if path and os.path.exists(path):
        os.remove(path)
        return True
    return False


def load(name):
    """Загварын тохиргоог (хэсэгчилсэн dict) буцаана; олдохгүй бол None."""
    if name in BUILTIN:
        return dict(BUILTIN[name])
    path = list_user().get(name)
    if not path:
        return None
    with open(path, "r", encoding="utf-8") as fh:
        data = json.load(fh)
    return strip_project_keys(data) if isinstance(data, dict) else None
