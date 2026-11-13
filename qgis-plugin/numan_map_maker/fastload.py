# -*- coding: utf-8 -*-
"""Том хилийн файлыг хөнгөн уншуулах.

KML, KMZ, GeoJSON зэрэг текст форматад орон зайн индекс байдаггүй тул QGIS
зураг зурах, давхцал тооцох бүрдээ файлыг бүхэлд нь уншдаг. Иймд том файлыг
нэг удаа орон зайн индекстэй GeoPackage болгон хөрвүүлж (QGIS-ийн профайлын
кэш хавтсанд) дараа нь зөвхөн дэлгэцэнд харагдаж буй хэсгийн объектыг уншина.
Эх файлд огт хүрэхгүй; эх файл өөрчлөгдвөл кэш автоматаар шинэчлэгдэнэ.
"""
import hashlib
import os

from qgis.PyQt.QtCore import QUrl
from qgis.core import (
    QgsApplication,
    QgsProviderRegistry,
    QgsProviderSublayerDetails,
    QgsVectorFileWriter,
    QgsVectorLayer,
    QgsVectorSimplifyMethod,
    QgsWkbTypes,
)

# Индексгүй (бүхлээр нь уншдаг) форматууд
TEXT_FORMATS = (".kml", ".kmz", ".geojson", ".json", ".gml", ".gpx", ".csv", ".tab", ".mif")
MIN_BYTES = 1 * 1024 * 1024      # үүнээс жижиг файлыг шууд уншина (хөрвүүлэх нь илүүц)
SOURCE_PROP = "numan_map_maker/source_file"


def cache_dir():
    d = os.path.join(QgsApplication.qgisSettingsDirPath(), "numan_map_maker", "cache")
    os.makedirs(d, exist_ok=True)
    return d


def cache_roots():
    """Плагины кэш хадгалдаг хавтаснууд: хөрвүүлсэн давхарга / офлайн зураг, задалсан KMZ."""
    base = os.path.join(QgsApplication.qgisSettingsDirPath(), "numan_map_maker")
    return [cache_dir(), os.path.join(base, "kmz")]


def _cache_files():
    for root in cache_roots():
        if not os.path.isdir(root):
            continue
        for folder, _dirs, files in os.walk(root):
            for name in files:
                yield os.path.join(folder, name)


def cache_usage():
    """(нийт байт, файлын тоо)"""
    total = count = 0
    for path in _cache_files():
        try:
            total += os.path.getsize(path)
            count += 1
        except OSError:
            pass
    return total, count


def format_size(n):
    for unit in ("Б", "КБ", "МБ", "ГБ"):
        if n < 1024 or unit == "ГБ":
            return f"{n:.0f} {unit}" if unit == "Б" else f"{n:.1f} {unit}"
        n /= 1024.0


def layers_in_cache(project):
    """Одоогийн төсөлд ашиглагдаж буй кэшийн файлуудын зам (жижиг үсгээр, бүтэн зам)."""
    roots = [os.path.normcase(os.path.abspath(r)) for r in cache_roots()]
    used = set()
    for lyr in project.mapLayers().values():
        src = lyr.source() or ""
        for part in src.replace("&", "|").split("|"):
            part = part.strip()
            if part.startswith("url=file:"):
                part = QUrl(part[4:]).toLocalFile()
            if not part:
                continue
            p = os.path.normcase(os.path.abspath(part))
            if any(p.startswith(r + os.sep) for r in roots):
                used.add(p)
    return used


def clear_cache(project=None):
    """Кэшийг цэвэрлэнэ. Одоогийн төсөлд ашиглагдаж буй файлыг үлдээнэ.

    Буцаах утга: (чөлөөлсөн байт, устгасан файл, үлдээсэн файл)
    """
    keep = layers_in_cache(project) if project is not None else set()
    freed = removed = skipped = 0
    for path in list(_cache_files()):
        base = os.path.normcase(os.path.abspath(path))
        # SQLite-ийн дагалдах файл (-wal, -shm, -journal) эзэнтэйгээ хамт үлдэнэ
        owner = base
        for suffix in ("-wal", "-shm", "-journal"):
            if owner.endswith(suffix):
                owner = owner[:-len(suffix)]
        if owner in keep:
            skipped += 1
            continue
        try:
            size = os.path.getsize(path)
            os.remove(path)
            freed += size
            removed += 1
        except OSError:           # Windows-д өөр программ нээсэн файл устахгүй
            skipped += 1
    for root in cache_roots():    # хоосорсон дэд хавтсуудыг арилгана
        if not os.path.isdir(root):
            continue
        for folder, _dirs, _files in os.walk(root, topdown=False):
            if folder != root:
                try:
                    os.rmdir(folder)
                except OSError:
                    pass
    return freed, removed, skipped


def cache_path(path):
    st = os.stat(path)
    key = hashlib.md5(f"{os.path.abspath(path)}|{st.st_size}|{int(st.st_mtime)}"
                      .encode("utf-8")).hexdigest()[:16]
    base = "".join(c if c.isalnum() else "_" for c in
                   os.path.splitext(os.path.basename(path))[0])[:40]
    return os.path.join(cache_dir(), f"{base}_{key}.gpkg")


def is_heavy(path):
    """Хөрвүүлбэл хурдсах файл эсэх: индексгүй формат бөгөөд хангалттай том."""
    try:
        return path.lower().endswith(TEXT_FORMATS) and os.path.getsize(path) >= MIN_BYTES
    except OSError:
        return False


def tune(layer):
    """Зурах үеийн хялбарчлалыг асаана: жижиг масштабт олон оройг алгасаж хурдан зурна."""
    try:
        m = QgsVectorSimplifyMethod()
        m.setSimplifyHints(QgsVectorSimplifyMethod.GeometrySimplification
                           | QgsVectorSimplifyMethod.AntialiasingSimplification)
        m.setThreshold(1.0)
        m.setForceLocalOptimization(False)
        layer.setSimplifyMethod(m)
    except Exception:
        pass
    return layer


def _geometry_sublayers(path, project, kinds):
    out = []
    for d in QgsProviderRegistry.instance().querySublayers(path):
        lyr = d.toLayer(QgsProviderSublayerDetails.LayerOptions(project.transformContext()))
        if isinstance(lyr, QgsVectorLayer) and lyr.isValid() and lyr.geometryType() in kinds:
            out.append(lyr)
    return out


def convert(path, project, kinds=(QgsWkbTypes.PolygonGeometry, QgsWkbTypes.LineGeometry),
            read_path=None):
    """Файлыг индекстэй GeoPackage болгож, кэшийн замыг буцаана ('' = амжилтгүй).

    read_path: бодитоор унших файл (KMZ-ийг задалсан KML гэх мэт); кэшийн түлхүүр нь
    эх файл (path)-аар тооцогдоно.
    """
    out = cache_path(path)
    if os.path.exists(out) and os.path.getsize(out) > 0:
        return out
    tmp = out + ".part"
    for stale in (tmp, tmp + "-journal", tmp + "-wal", tmp + "-shm"):
        if os.path.exists(stale):
            os.remove(stale)
    layers = _geometry_sublayers(read_path or path, project, kinds)
    if not layers:
        return ""
    used = set()
    first = True
    for lyr in layers:
        name = "".join(c if c.isalnum() else "_" for c in (lyr.name() or "layer"))[:50]
        kind = {QgsWkbTypes.PolygonGeometry: "poly", QgsWkbTypes.LineGeometry: "line",
                QgsWkbTypes.PointGeometry: "point"}.get(lyr.geometryType(), "geom")
        name = f"{name}_{kind}"
        while name in used:
            name += "_"
        used.add(name)
        opts = QgsVectorFileWriter.SaveVectorOptions()
        opts.driverName = "GPKG"
        opts.layerName = name
        opts.fileEncoding = "UTF-8"
        opts.layerOptions = ["SPATIAL_INDEX=YES"]
        opts.actionOnExistingFile = QgsVectorFileWriter.CreateOrOverwriteFile if first \
            else QgsVectorFileWriter.CreateOrOverwriteLayer
        res = QgsVectorFileWriter.writeAsVectorFormatV3(
            lyr, tmp, project.transformContext(), opts)
        if res[0] != QgsVectorFileWriter.NoError:
            continue
        first = False
    if first:                       # нэг ч давхарга бичигдээгүй
        return ""
    # GDAL ".part" өргөтгөлд ".gpkg" залгаж бичсэн байж болно
    written = tmp if os.path.exists(tmp) else tmp + ".gpkg"
    if not os.path.exists(written):
        return ""
    os.replace(written, out)
    return out


def load(path, project, kinds=(QgsWkbTypes.PolygonGeometry, QgsWkbTypes.LineGeometry),
         read_path=None):
    """Том файлыг кэшээр дамжуулан ачаална. Буцаах утга: (давхаргууд, кэш ашигласан эсэх).

    Жижиг эсвэл аль хэдийн индекстэй (SHP, GPKG) файлд ([], False) буцаана — дуудсан тал
    ердийн аргаар уншина.
    """
    if not is_heavy(path):
        return [], False
    try:
        gpkg = convert(path, project, kinds, read_path)
    except Exception:
        gpkg = ""
    if not gpkg:
        return [], False
    layers = _geometry_sublayers(gpkg, project, kinds)
    for lyr in layers:
        lyr.setCustomProperty(SOURCE_PROP, path)
        tune(lyr)
    return layers, bool(layers)


def ensure_index(layer):
    """SHP зэрэг индекс үүсгэж болдог эх үүсвэрт орон зайн индекс үүсгэнэ (байхгүй бол)."""
    try:
        pr = layer.dataProvider()
        src = layer.source().split("|")[0]
        if src.lower().endswith(".shp") and not os.path.exists(src[:-4] + ".qix") \
                and os.access(os.path.dirname(src) or ".", os.W_OK):
            return bool(pr.createSpatialIndex())
    except Exception:
        pass
    return False


def lighten(layer, project):
    """Төсөлд аль хэдийн байгаа том давхаргын эх үүсвэрийг кэшийн GeoPackage руу шилжүүлнэ.

    Амжилттай бол True. Давхаргын нэр, id хэвээр үлдэнэ.
    """
    if not isinstance(layer, QgsVectorLayer) or layer.providerType() != "ogr":
        return False
    src = layer.source().split("|")[0]
    if not os.path.isfile(src) or not src.lower().endswith(TEXT_FORMATS):
        return ensure_index(layer)
    kind = layer.geometryType()
    gpkg = convert(src, project, (kind,))
    if not gpkg:
        return False
    subs = _geometry_sublayers(gpkg, project, (kind,))
    if not subs:
        return False
    # Олон дэд давхаргатай бол нэрээр нь, эс бөгөөс эхнийхийг авна
    want = "".join(c if c.isalnum() else "_" for c in (layer.name() or ""))
    pick = next((s for s in subs if s.name().startswith(want) and want), subs[0])
    name = layer.name()
    layer.setDataSource(pick.source(), name, "ogr")
    if not layer.isValid():
        return False
    layer.setCustomProperty(SOURCE_PROP, src)
    tune(layer)
    return True
