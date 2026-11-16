# -*- coding: utf-8 -*-
"""Тестүүдийн нийтлэг суурь: QGIS-ийг дэлгэцгүй асаах, туршилтын өгөгдөл үүсгэх,
файл сонгох / асуух цонхнуудыг орлуулах, шалгалтын үр дүнг цуглуулах.

Тест бүр тусдаа процесс (run_tests.py) бөгөөд QGIS-ийн тохиргоог түр хавтсанд
хадгалдаг тул таны жинхэнэ QGIS-ийн тохиргоонд хүрэхгүй. Сүлжээ шаардахгүй.
"""
import json
import math
import os
import sys
import tempfile
import time
import traceback
import zipfile

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))           # numan_map_maker багц

TMP = tempfile.mkdtemp(prefix="nmm_test_")
PROFILE = os.path.join(TMP, "profile")
os.makedirs(PROFILE, exist_ok=True)
# QGIS-ийн профайл, тохиргоог түр хавтсанд: жинхэнэ QGIS-ийн тохиргоонд хүрэхгүй
os.environ["XDG_DATA_HOME"] = os.path.join(TMP, "xdg_data")
os.environ["XDG_CONFIG_HOME"] = os.path.join(TMP, "xdg_config")
os.environ["XDG_CACHE_HOME"] = os.path.join(TMP, "xdg_cache")
os.environ.setdefault("XDG_RUNTIME_DIR", os.path.join(TMP, "xdg_runtime"))
for _d in ("xdg_data", "xdg_config", "xdg_cache", "xdg_runtime"):
    os.makedirs(os.path.join(TMP, _d), mode=0o700, exist_ok=True)

from qgis.core import (  # noqa: E402
    QgsApplication, QgsCategorizedSymbolRenderer, QgsCoordinateReferenceSystem,
    QgsCoordinateTransform, QgsFeature, QgsFillSymbol, QgsGeometry, QgsLayoutExporter,
    QgsLineSymbol, QgsMarkerSymbol, QgsPointXY, QgsProject, QgsRectangle,
    QgsRendererCategory, QgsSettings, QgsSingleSymbolRenderer, QgsVectorFileWriter,
    QgsVectorLayer,
)
from qgis.PyQt.QtGui import QImage  # noqa: E402

APP = QgsApplication([], True, PROFILE)
APP.initQgis()

_results = []


def check(name, cond, detail=""):
    """Нэг шалгалт. Үр дүнг цуглуулж, эцэст нь finish() хэвлэнэ."""
    ok = bool(cond)
    _results.append((ok, name, detail))
    print(("  ok    " if ok else "  FAIL  ") + name + ("" if ok else f"   [{detail}]"),
          flush=True)
    return ok


def finish():
    failed = [r for r in _results if not r[0]]
    print(f"RESULT {len(_results) - len(failed)}/{len(_results)} passed", flush=True)
    if not os.environ.get("NMM_KEEP_TMP"):
        import shutil
        shutil.rmtree(TMP, ignore_errors=True)
    else:
        print(f"files kept in {TMP}", flush=True)
    os._exit(1 if failed or not _results else 0)


def run(main):
    """Тестийн үндсэн функцийг ажиллуулна; гэнэтийн алдааг FAIL гэж тооцно."""
    try:
        main()
    except Exception:
        traceback.print_exc()
        check("unexpected exception", False, "see traceback above")
    finish()


def process(seconds=0.0):
    end = time.time() + seconds
    while True:
        APP.processEvents()
        if time.time() >= end:
            break
        time.sleep(0.01)


# ---------------------------------------------------------------------------
# Төсөл, цонх
# ---------------------------------------------------------------------------
def project(crs="EPSG:32648"):
    prj = QgsProject.instance()
    prj.clear()
    prj.setCrs(QgsCoordinateReferenceSystem(crs))
    prj.setEllipsoid("WGS84")
    return prj


class FakeIface:
    """QGIS-ийн iface-ийн плагинд хэрэгтэй хэсэг."""

    def __init__(self, extent=None):
        from qgis.gui import QgsMapCanvas
        self.canvas = QgsMapCanvas()
        if extent is not None:
            self.canvas.setExtent(extent)
        self.designer = []

    def mapCanvas(self):
        return self.canvas

    def mainWindow(self):
        return None

    def openLayoutDesigner(self, layout):
        self.designer.append(layout.name())

    def addProject(self, path):
        return QgsProject.instance().read(path)


def to_project_rect(rect, prj, src="EPSG:4326", grow=1.0):
    ct = QgsCoordinateTransform(QgsCoordinateReferenceSystem(src), prj.crs(), prj)
    r = ct.transformBoundingBox(rect)
    r.scale(grow)
    return r


def dialog(extent=None):
    """Плагины цонхыг нээж, автомат шинэчлэлтийг унтраана (тест өөрөө rebuild дуудна)."""
    QgsSettings().remove("numan_map_maker")
    from numan_map_maker import dialog as D
    dlg = D.MapMakerDialog(FakeIface(extent))
    dlg.chk_auto.setChecked(False)
    dlg.show()
    process()
    dlg.rebuild()
    return dlg


def patch_dialogs(answer_yes=True, save_path=None, open_path=None, folder=None):
    """Файл сонгох, асуух цонхнуудыг автомат хариултаар орлуулна."""
    from qgis.PyQt.QtWidgets import QFileDialog, QMessageBox
    msgs = []
    QMessageBox.information = staticmethod(lambda *a, **k: msgs.append(("info", a[2])))
    QMessageBox.warning = staticmethod(lambda *a, **k: msgs.append(("warn", a[2])))
    QMessageBox.question = staticmethod(
        lambda *a, **k: QMessageBox.StandardButton.Yes if answer_yes
        else QMessageBox.StandardButton.No)
    if save_path is not None:
        QFileDialog.getSaveFileName = staticmethod(
            lambda *a, **k: (save_path() if callable(save_path) else save_path, ""))
    if open_path is not None:
        QFileDialog.getOpenFileName = staticmethod(
            lambda *a, **k: (open_path() if callable(open_path) else open_path, ""))
    if folder is not None:
        QFileDialog.getExistingDirectory = staticmethod(lambda *a, **k: folder)
    return msgs


def export_png(dlg, path, dpi=80):
    """Урьдчилан харах layout-ын хуулбарыг PNG болгон гаргаж, QImage буцаана."""
    dlg._settle()
    clone = dlg.layout_.clone()
    dlg._settle()
    es = QgsLayoutExporter.ImageExportSettings()
    es.dpi = dpi
    res = QgsLayoutExporter(clone).exportToImage(path, es)
    assert res == QgsLayoutExporter.Success, res
    return QImage(path).convertToFormat(QImage.Format.Format_RGB32)


def image_diff(a, b, step=5):
    if a.size() != b.size():
        return 999.0
    tot = n = 0
    for y in range(0, a.height(), step):
        for x in range(0, a.width(), step):
            p, q = a.pixel(x, y), b.pixel(x, y)
            tot += abs(((p >> 16) & 255) - ((q >> 16) & 255)) + \
                abs(((p >> 8) & 255) - ((q >> 8) & 255)) + abs((p & 255) - (q & 255))
            n += 3
    return tot / max(1, n)


# ---------------------------------------------------------------------------
# Туршилтын өгөгдөл
# ---------------------------------------------------------------------------
def memory(kind, name, fields="", crs="EPSG:4326"):
    return QgsVectorLayer(f"{kind}?crs={crs}{fields}", name, "memory")


def add_rects(layer, rects, field=None):
    feats = []
    for item in rects:
        if field:
            name, r = item
        else:
            name, r = None, item
        f = QgsFeature(layer.fields())
        f.setGeometry(QgsGeometry.fromRect(QgsRectangle(*r)))
        if field:
            f[field] = name
        feats.append(f)
    layer.dataProvider().addFeatures(feats)
    layer.updateExtents()
    return layer


def study_area():
    lyr = memory("Polygon", "Судалгааны талбай")
    return add_rects(lyr, [(100.5, 49.2, 102.2, 49.9)])


def land_use():
    lyr = memory("Polygon", "Газар ашиглалт", "&field=cls:string")
    add_rects(lyr, [("Ой", (100.6, 49.3, 101.0, 49.8)), ("Бэлчээр", (101.1, 49.3, 101.5, 49.8)),
                    ("Тариалан", (101.6, 49.3, 102.0, 49.8))], "cls")
    cats = [QgsRendererCategory(n, QgsFillSymbol.createSimple({"color": c}), n)
            for n, c in (("Ой", "#2e7d32"), ("Бэлчээр", "#dce775"), ("Тариалан", "#ff8f00"))]
    lyr.setRenderer(QgsCategorizedSymbolRenderer("cls", cats))
    return lyr


def river():
    lyr = memory("LineString", "Гол")
    f = QgsFeature()
    f.setGeometry(QgsGeometry.fromPolylineXY([QgsPointXY(100.4, 49.3), QgsPointXY(102.3, 49.8)]))
    lyr.dataProvider().addFeatures([f])
    lyr.updateExtents()
    lyr.setRenderer(QgsSingleSymbolRenderer(QgsLineSymbol.createSimple(
        {"color": "#2b7bba", "width": "0.6"})))
    return lyr


def points():
    lyr = memory("Point", "Шалгах цэг")
    feats = []
    for x, y in ((100.8, 49.5), (101.7, 49.6)):
        f = QgsFeature()
        f.setGeometry(QgsGeometry.fromPointXY(QgsPointXY(x, y)))
        feats.append(f)
    lyr.dataProvider().addFeatures(feats)
    lyr.updateExtents()
    lyr.setRenderer(QgsSingleSymbolRenderer(QgsMarkerSymbol.createSimple(
        {"name": "star", "color": "#ff00cc", "size": "4"})))
    return lyr


def nested_admin():
    """Нэг давхаргад аймаг ⊃ сум ⊃ хоёр баг (хэрэглэгчийн Дорнод/Халхгол жишээ шиг)."""
    lyr = memory("Polygon", "Засаг захиргаа", "&field=name:string")
    add_rects(lyr, [("Дорнод", (99, 48, 104, 51)), ("Халхгол", (100, 48.5, 103, 50.5)),
                    ("1-р баг Цогтсүмбэр", (100, 48.5, 102.0445, 50.5)),
                    ("3-р баг Ташгай", (102.0445, 48.5, 103, 50.5))], "name")
    return lyr


def _kml_poly(name, x0, y0, x1, y1):
    return (f"<Placemark><name>{name}</name><Polygon><outerBoundaryIs><LinearRing><coordinates>"
            f"{x0},{y0},0 {x1},{y0},0 {x1},{y1},0 {x0},{y1},0 {x0},{y0},0"
            "</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>")


def _kml_line(name, x0, y0, x1, y1, style=""):
    return (f"<Placemark><name>{name}</name>{style}<LineString><coordinates>"
            f"{x0},{y0},0 {x1},{y0},0 {x1},{y1},0 {x0},{y1},0 {x0},{y0},0"
            "</coordinates></LineString></Placemark>")


KML_HEAD = ('<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2">'
            "<Document><name>d</name>")


def boundary_files(folder=None):
    """KML (сум), KMZ (шугаман лиценз), GeoJSON (ТХГ), SHP (аймаг) файлууд."""
    folder = folder or os.path.join(TMP, "bounds")
    os.makedirs(folder, exist_ok=True)
    out = {}
    out["kml"] = os.path.join(folder, "sum.kml")
    with open(out["kml"], "w", encoding="utf-8") as fh:
        fh.write(KML_HEAD + _kml_poly("Алаг-Эрдэнэ", 100, 49, 101, 50)
                 + _kml_poly("Түнэл", 101, 49, 102, 50)
                 + _kml_poly("Эрдэнэбулган", 102, 49, 103, 50) + "</Document></kml>")
    doc = os.path.join(folder, "doc.kml")
    with open(doc, "w", encoding="utf-8") as fh:
        fh.write(KML_HEAD + _kml_line("MV-012345", 100.6, 49.3, 101.3, 49.6)
                 + _kml_line("XV-000777", 101.6, 49.5, 101.9, 49.8) + "</Document></kml>")
    out["kmz"] = os.path.join(folder, "license.kmz")
    with zipfile.ZipFile(out["kmz"], "w") as z:
        z.write(doc, "doc.kml")
    os.remove(doc)
    out["geojson"] = os.path.join(folder, "thg.geojson")
    with open(out["geojson"], "w", encoding="utf-8") as fh:
        json.dump({"type": "FeatureCollection", "features": [{
            "type": "Feature", "properties": {"name": "Хорьдол Сарьдагийн ДЦГ"},
            "geometry": {"type": "Polygon", "coordinates": [[
                [100.2, 49.55], [101.1, 49.55], [101.1, 50.2], [100.2, 50.2], [100.2, 49.55]]]}}]},
            fh, ensure_ascii=False)
    aimag = memory("Polygon", "aimag", "&field=aimag:string(50)")
    add_rects(aimag, [("Хөвсгөл", (99, 48, 101.5, 51)), ("Булган", (101.5, 48, 104, 51))],
              "aimag")
    out["shp"] = os.path.join(folder, "aimag.shp")
    opts = QgsVectorFileWriter.SaveVectorOptions()
    opts.driverName = "ESRI Shapefile"
    opts.fileEncoding = "UTF-8"
    QgsVectorFileWriter.writeAsVectorFormatV3(aimag, out["shp"],
                                              QgsProject.instance().transformContext(), opts)
    return out


def styled_kml(folder=None):
    """Объектдоо загвартай (KML Style) улаан хилийн шугам — QGIS-ийн Embedded Symbols."""
    folder = folder or TMP
    path = os.path.join(folder, "hil.kml")
    style = "<styleUrl>#s</styleUrl>"
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(KML_HEAD + '<Style id="s"><LineStyle><color>ff0000ff</color><width>3</width>'
                 "</LineStyle></Style>" + _kml_line("Хил", 100, 49, 103, 50.5, style)
                 + "</Document></kml>")
    return path


def big_geojson(n=12000, folder=None, seed=1):
    """Улсын хэмжээнд тархсан n полигонтой том GeoJSON (том файлыг хөнгөн уншихыг шалгах)."""
    import random
    folder = folder or TMP
    path = os.path.join(folder, f"uls_{n}.geojson")
    if os.path.exists(path):
        return path
    rnd = random.Random(seed)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write('{"type":"FeatureCollection","features":[\n')
        for i in range(n):
            cx, cy = 88 + rnd.random() * 31, 42 + rnd.random() * 9.5
            r = 0.01 + rnd.random() * 0.03
            ring = [[round(cx + r * math.cos(a / 30 * 2 * math.pi), 6),
                     round(cy + r * 0.7 * math.sin(a / 30 * 2 * math.pi), 6)] for a in range(30)]
            ring.append(ring[0])
            fh.write(json.dumps({"type": "Feature", "properties": {"name": f"MV-{i:06d}"},
                                 "geometry": {"type": "Polygon", "coordinates": [ring]}})
                     + (",\n" if i < n - 1 else "\n"))
        fh.write("]}")
    return path
