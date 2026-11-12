# -*- coding: utf-8 -*-
"""OsmAnd-ийн офлайн зургийн сан (*.sqlitedb)-г QGIS-ийн суурь зураг болгох.

OsmAnd / MOBAC / SAS.Planet-ийн үүсгэдэг .sqlitedb нь SQLite сан бөгөөд
tiles(x, y, z, s, image) хүснэгтэд зургийн хэсгүүдийг (tile) хадгалдаг. QGIS энэ
форматыг шууд уншдаггүй тул нэг удаа MBTiles (QGIS-ийн уншдаг стандарт) болгон
кэш хавтсанд хөрвүүлнэ. Эх файлд хүрэхгүй (зөвхөн уншихаар нээнэ).
"""
import hashlib
import math
import os
import sqlite3

from qgis.PyQt.QtCore import QUrl
from qgis.core import QgsRasterLayer

from . import fastload

EXTENSIONS = (".sqlitedb", ".mbtiles")
FILE_FILTER = "Офлайн зургийн сан (*.sqlitedb *.mbtiles);;Бүх файл (*)"


class OsmandError(Exception):
    pass


def cache_path(path):
    st = os.stat(path)
    key = hashlib.md5(f"{os.path.abspath(path)}|{st.st_size}|{int(st.st_mtime)}"
                      .encode("utf-8")).hexdigest()[:16]
    base = "".join(c if c.isalnum() else "_" for c in
                   os.path.splitext(os.path.basename(path))[0])[:40]
    return os.path.join(fastload.cache_dir(), f"{base}_{key}.mbtiles")


def is_converted(path):
    if path.lower().endswith(".mbtiles"):
        return True
    try:
        out = cache_path(path)
        return os.path.exists(out) and os.path.getsize(out) > 0
    except OSError:
        return False


def _columns(con, table):
    return [r[1].lower() for r in con.execute(f"PRAGMA table_info({table})")]


def inspect(path):
    """Сангийн бүтцийг уншина: {inverted, zooms: {zoom: тоо}, tiles, ellipsoid, format}."""
    uri = QUrl.fromLocalFile(os.path.abspath(path)).toString() + "?mode=ro"
    try:
        con = sqlite3.connect(uri, uri=True)
    except sqlite3.Error as e:
        raise OsmandError(f"Файлыг нээж чадсангүй: {e}")
    try:
        try:
            cols = _columns(con, "tiles")
        except sqlite3.Error as e:
            raise OsmandError(f"SQLite сан биш эсвэл гэмтсэн файл: {e}")
        if not {"x", "y", "z", "image"} <= set(cols):
            raise OsmandError("Энэ файлд OsmAnd-ийн tiles(x, y, z, image) хүснэгт алга.")
        info = {}
        try:
            icols = _columns(con, "info")
            row = con.execute("SELECT * FROM info LIMIT 1").fetchone()
            if row:
                info = dict(zip(icols, row))
        except sqlite3.Error:
            icols = []
        ellipsoid = 0
        try:
            ellipsoid = int(info.get("ellipsoid") or 0)
        except (TypeError, ValueError):
            pass
        stats = con.execute(
            "SELECT z, COUNT(*), MIN(x), MAX(x), MIN(y), MAX(y) FROM tiles GROUP BY z").fetchall()
        if not stats:
            raise OsmandError("Сан хоосон байна (tile алга).")

        def valid(inv):
            for z, _n, _x0, x1, _y0, y1 in stats:
                zoom = 17 - z if inv else z
                if zoom < 0 or zoom > 24 or max(x1, y1) >= (1 << zoom):
                    return False
            return True

        numbering = str(info.get("tilenumbering") or "").strip().lower()
        if numbering:
            inverted = numbering == "bigplanet"
        else:
            # OsmAnd: tilenumbering багана байхгүй бол урвуу (BigPlanet) дугаарлалт гэж үздэг
            inverted = valid(True) or not valid(False)
        if not valid(inverted) and valid(not inverted):
            inverted = not inverted
        zooms = {(17 - z if inverted else z): n for z, n, *_ in stats}
        blob = con.execute("SELECT image FROM tiles WHERE image IS NOT NULL LIMIT 1").fetchone()
        head = bytes(blob[0][:12]) if blob and blob[0] else b""
        fmt = "png" if head.startswith(b"\x89PNG") else \
            "webp" if head[:4] == b"RIFF" and head[8:12] == b"WEBP" else "jpg"
        return {"inverted": inverted, "zooms": zooms, "tiles": sum(zooms.values()),
                "ellipsoid": ellipsoid, "format": fmt, "stats": stats}
    finally:
        con.close()


def _lonlat(x, y, zoom):
    n = float(1 << zoom)
    lon = x / n * 360.0 - 180.0
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))
    return lon, lat


def to_mbtiles(path, progress=None):
    """.sqlitedb-г MBTiles болгон кэшид хөрвүүлж, замыг нь буцаана.

    progress(хийсэн, нийт) -> False буцаавал зогсооно. .mbtiles бол өөрийг нь буцаана.
    """
    if path.lower().endswith(".mbtiles"):
        return path
    out = cache_path(path)
    if os.path.exists(out) and os.path.getsize(out) > 0:
        return out
    meta = inspect(path)
    if meta["ellipsoid"] == 1:
        raise OsmandError("Энэ сан эллипс Меркатор (Yandex) проекцтой тул дэмжигдэхгүй.")
    tmp = out + ".part"
    for stale in (tmp, tmp + "-journal"):
        if os.path.exists(stale):
            os.remove(stale)
    dst = sqlite3.connect(tmp)
    ok = False
    try:
        dst.execute("PRAGMA journal_mode=OFF")
        dst.execute("PRAGMA synchronous=OFF")
        dst.execute("CREATE TABLE metadata (name TEXT, value TEXT)")
        dst.execute("CREATE TABLE tiles (zoom_level INTEGER, tile_column INTEGER, "
                    "tile_row INTEGER, tile_data BLOB)")
        dst.execute("ATTACH DATABASE ? AS src", (os.path.abspath(path),))
        total = meta["tiles"]
        done = 0
        for z, n, *_rest in sorted(meta["stats"]):
            zoom = 17 - z if meta["inverted"] else z
            # MBTiles нь TMS дугаарлалттай: мөрийг доороос нь тоолно
            dst.execute(
                "INSERT INTO tiles SELECT ?, x, ? - y, image FROM src.tiles "
                "WHERE z = ? AND image IS NOT NULL GROUP BY x, y",
                (zoom, (1 << zoom) - 1, z))
            dst.commit()
            done += n
            if progress is not None and progress(done, total) is False:
                raise OsmandError("Хөрвүүлэлтийг зогсоолоо.")
        dst.execute("DETACH DATABASE src")
        dst.execute("CREATE UNIQUE INDEX tile_index ON tiles "
                    "(zoom_level, tile_column, tile_row)")
        zmin, zmax = min(meta["zooms"]), max(meta["zooms"])
        # Хамрах хүрээг хамгийн нарийн түвшний tile-аас тооцно
        zstat = next(s for s in meta["stats"]
                     if (17 - s[0] if meta["inverted"] else s[0]) == zmax)
        _z, _n, x0, x1, y0, y1 = zstat
        west, north = _lonlat(x0, y0, zmax)
        east, south = _lonlat(x1 + 1, y1 + 1, zmax)
        name = os.path.splitext(os.path.basename(path))[0]
        dst.executemany("INSERT INTO metadata VALUES (?, ?)", [
            ("name", name), ("type", "baselayer"), ("version", "1"),
            ("description", "OsmAnd sqlitedb-ээс хөрвүүлсэн"), ("format", meta["format"]),
            ("minzoom", str(zmin)), ("maxzoom", str(zmax)),
            ("bounds", f"{west:.6f},{south:.6f},{east:.6f},{north:.6f}"),
        ])
        dst.commit()
        ok = True
    finally:
        dst.close()
        if not ok and os.path.exists(tmp):
            os.remove(tmp)
    os.replace(tmp, out)
    return out


def layer(path, name=None):
    """Офлайн зургийн сангаас (шаардлагатай бол хөрвүүлээд) растер давхарга үүсгэнэ."""
    mb = to_mbtiles(path)
    name = name or os.path.splitext(os.path.basename(path))[0]
    url = QUrl.fromLocalFile(os.path.abspath(mb)).toString()
    lyr = QgsRasterLayer(f"type=mbtiles&url={url}", name, "wms")
    if not lyr.isValid():
        lyr = QgsRasterLayer(mb, name, "gdal")
    return lyr
