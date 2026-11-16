# -*- coding: utf-8 -*-
"""Том файлыг кэшээр хөнгөн унших, кэш цэвэрлэх, онлайн зургийн кэш, OsmAnd .sqlitedb."""
import math
import os
import sqlite3
import time

import _common as C
from qgis.PyQt.QtCore import QBuffer, QByteArray, QIODevice, QSize
from qgis.PyQt.QtGui import QColor, QImage
from qgis.core import (QgsCoordinateReferenceSystem, QgsMapRendererSequentialJob, QgsMapSettings,
                       QgsNetworkAccessManager, QgsRectangle, QgsSettings, QgsVectorLayer)


def tile_color(z, x, y):
    return QColor((x * 37 + z * 11) % 256, (y * 53 + z * 7) % 256, (z * 40) % 256)


def png(color):
    img = QImage(256, 256, QImage.Format.Format_RGB32)
    img.fill(color)
    ba = QByteArray()
    buf = QBuffer(ba)
    buf.open(QIODevice.OpenModeFlag.WriteOnly)
    img.save(buf, "PNG")
    return bytes(ba)


def tile_xy(lon, lat, z):
    n = 1 << z
    return (int((lon + 180) / 360 * n),
            int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n))


def make_sqlitedb(path, inverted, info=True, numbering=True):
    if os.path.exists(path):
        os.remove(path)
    con = sqlite3.connect(path)
    con.execute("CREATE TABLE tiles (x int, y int, z int, s int, image blob, "
                "PRIMARY KEY (x,y,z,s))")
    if info:
        if numbering:
            con.execute("CREATE TABLE info (minzoom int, maxzoom int, tilenumbering text)")
            con.execute("INSERT INTO info VALUES (?,?,?)", (9, 11, "BigPlanet" if inverted else ""))
        else:
            con.execute("CREATE TABLE info (minzoom int, maxzoom int)")
            con.execute("INSERT INTO info VALUES (9, 11)")
    for z in (6, 7, 8):
        x0, y0 = tile_xy(100.0, 50.5, z)
        x1, y1 = tile_xy(102.5, 48.8, z)
        for x in range(x0, x1 + 1):
            for y in range(y0, y1 + 1):
                con.execute("INSERT INTO tiles VALUES (?,?,?,0,?)",
                            (x, y, 17 - z if inverted else z, png(tile_color(z, x, y))))
    con.commit()
    con.close()


def tile_bounds_3857(z, x, y):
    world = 20037508.342789244
    size = 2 * world / (1 << z)
    return QgsRectangle(-world + x * size, world - (y + 1) * size,
                        -world + (x + 1) * size, world - y * size)


def render_center(layer, rect):
    ms = QgsMapSettings()
    ms.setLayers([layer])
    ms.setDestinationCrs(QgsCoordinateReferenceSystem("EPSG:3857"))
    ms.setOutputSize(QSize(256, 256))
    ms.setExtent(rect)
    job = QgsMapRendererSequentialJob(ms)
    job.start()
    job.waitForFinished()
    return QColor(job.renderedImage().pixel(128, 128))


def main():
    prj = C.project()
    dlg = C.dialog()
    from numan_map_maker import fastload, osmand, overlap
    C.patch_dialogs()

    # --- Том файл: нэг удаа индекстэй кэш, дараа нь зөвхөн харагдах хэсэг
    big = C.big_geojson(12000)
    t0 = time.time()
    added = dlg._overlap_load_files([big])
    t_first = time.time() - t0
    lyr = added[0] if added else None
    C.check("large GeoJSON read through the indexed cache",
            lyr is not None and lyr.source().split("|")[0].endswith(".gpkg")
            and lyr.featureCount() == 12000 and lyr.hasSpatialIndex() == 2,
            lyr.source() if lyr else "not loaded")
    t0 = time.time()
    again = overlap.load_boundary_file(big, prj)
    C.check("second load is instant (cache reused)", time.time() - t0 < 1.0 and again,
            f"{time.time() - t0:.2f}s (first {t_first:.1f}s)")
    area = C.memory("Polygon", "Талбай")
    C.add_rects(area, [(100.5, 49.2, 101.2, 49.7)])
    prj.addMapLayer(area)
    direct = QgsVectorLayer(big, "direct", "ogr")
    a = overlap.analyse(prj, area, direct, "name")
    b = overlap.analyse(prj, area, lyr, "name")
    C.check("cached and direct reading give the same overlap",
            [(n, round(h, 2)) for n, h, _p in a.rows] == [(n, round(h, 2)) for n, h, _p in b.rows]
            and len(a.rows) > 5, f"{len(a.rows)} vs {len(b.rows)}")

    d = QgsVectorLayer(big, "Лиценз", "ogr")
    prj.addMapLayer(d)
    lid = d.id()
    C.check("an already open large layer can be lightened in place",
            fastload.lighten(d, prj) and d.id() == lid and d.isValid()
            and d.source().split("|")[0].endswith(".gpkg"))

    # --- Кэш цэвэрлэх: одоогийн төсөлд ашиглагдаж буйг үлдээнэ
    junk = os.path.join(fastload.cache_dir(), "old_unused.gpkg")
    with open(junk, "wb") as fh:
        fh.write(b"0" * 200000)
    delete, kept = fastload.cache_plan(prj)
    C.check("cache plan: unused file to delete, in-use kept",
            [os.path.basename(p) for p, _s in delete] == ["old_unused.gpkg"] and len(kept) >= 1,
            f"{[os.path.basename(p) for p, _ in delete]} / {len(kept)}")
    freed, removed, skipped = fastload.clear_cache(prj)
    C.check("cache cleared without breaking open layers",
            removed == 1 and not os.path.exists(junk) and lyr.isValid() and lyr.featureCount())
    shown = []
    from numan_map_maker import extras
    extras.QMessageBox.exec = lambda self: (shown.append(self.text()), [
        b for b in self.buttons() if b.text() == "Болих"][0].click())
    open(junk, "wb").write(b"0" * 1000)
    dlg._cache_clear()
    C.check("clearing asks first and Cancel keeps files", shown and os.path.exists(junk),
            str(shown))

    # --- Онлайн суурь зургийн кэш
    fastload.apply_tile_cache(1024, save=True)
    c = QgsNetworkAccessManager.instance().cache()
    C.check("online tile cache raised to 1 GB / 30 days",
            c.maximumCacheSize() == 1024 * 1024 * 1024
            and int(QgsSettings().value("qgis/defaultTileExpiry")) == 720)

    # --- OsmAnd .sqlitedb: дугаарлалтын хувилбар бүрт байршил, түвшин зөв эсэх
    z, (x, y) = 8, tile_xy(101.2, 49.6, 8)
    rect = tile_bounds_3857(z, x, y)
    want = tile_color(z, x, y).name()
    for label, inv, info, numbering in (("BigPlanet", True, True, True),
                                        ("plain numbering", False, True, True),
                                        ("no tilenumbering column", True, True, False),
                                        ("no info table", True, False, True)):
        path = os.path.join(C.TMP, f"osm_{int(inv)}{int(info)}{int(numbering)}.sqlitedb")
        make_sqlitedb(path, inv, info, numbering)
        meta = osmand.inspect(path)
        layer = osmand.layer(path)
        got = render_center(layer, rect).name()
        C.check(f"sqlitedb ({label}): zoom levels {sorted(meta['zooms'])}, tile in the right place",
                layer.isValid() and sorted(meta["zooms"]) == [6, 7, 8] and got == want,
                f"{got} vs {want}")
    bad = os.path.join(C.TMP, "bad.sqlitedb")
    open(bad, "w").write("not a database")
    try:
        osmand.to_mbtiles(bad)
        C.check("broken file reported", False)
    except osmand.OsmandError:
        C.check("broken file reported", True)

    # --- Хөрвүүлэх замыг асууж, дараа нь асуухгүй (арын горимд хөрвүүлнэ)
    src = os.path.join(C.TMP, "my_map.sqlitedb")
    make_sqlitedb(src, True)
    out = os.path.join(C.TMP, "saved", "my_converted.mbtiles")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    asked = []
    from qgis.PyQt.QtWidgets import QFileDialog
    QFileDialog.getOpenFileName = staticmethod(lambda *a, **k: (src, ""))
    QFileDialog.getSaveFileName = staticmethod(lambda *a, **k: (asked.append(a[2]) or out, ""))
    dlg._pick_basemap_file()
    C.check("asks where to save, offers the source folder",
            [os.path.basename(p) for p in asked] == ["my_map.mbtiles"] and os.path.exists(out)
            and dlg.settings()["basemap_file"] == out and dlg.settings()["basemap"] == "file")
    asked.clear()
    mtime = os.path.getmtime(out)
    dlg._pick_basemap_file()
    C.check("picking the same source again reuses the converted file",
            not asked and os.path.getmtime(out) == mtime)
    C.check("offline basemap added under the user's layers",
            prj.layerTreeRoot().findLayers()[-1].layer().name().startswith("Офлайн зураг"))
    dlg.shutdown()


C.run(main)
