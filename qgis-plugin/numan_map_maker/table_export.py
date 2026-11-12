# -*- coding: utf-8 -*-
"""Талбайн хүснэгтийг Excel (.xlsx) эсвэл CSV файл руу гаргана."""
import csv
import os

from qgis.PyQt.QtCore import QVariant
from qgis.core import (
    QgsCoordinateTransformContext,
    QgsFeature,
    QgsField,
    QgsVectorFileWriter,
    QgsVectorLayer,
)


PCT_HEAD = "Хувь, %"


def _rows(head1, head2, rows, total, decimals, with_total):
    """[(нэр, утга, хувь)]"""
    def share(v):
        return round(v / total * 100.0, 2) if total > 0 else 0.0
    out = [(label, round(value, decimals), share(value)) for label, value, _c in rows]
    if with_total and len(rows) > 1:
        out.append(("Нийт", round(total, decimals), 100.0))
    return out


def write_csv(path, head1, head2, rows, total, decimals=2, with_total=True, percent=False):
    with open(path, "w", encoding="utf-8-sig", newline="") as fh:
        w = csv.writer(fh)
        w.writerow([head1, head2] + ([PCT_HEAD] if percent else []))
        for label, value, pct in _rows(head1, head2, rows, total, decimals, with_total):
            w.writerow([label, f"{value:.{decimals}f}"] + ([f"{pct:.2f}"] if percent else []))
    return path


def write_xlsx(path, head1, head2, rows, total, decimals=2, with_total=True, percent=False):
    """GDAL-ийн XLSX драйвераар бичнэ. Амжилтгүй бол алдааны бичвэр буцаана ('' = амжилттай)."""
    lyr = QgsVectorLayer("None", "Талбай", "memory")
    pr = lyr.dataProvider()
    fields = [QgsField(head1 or "Ангилал", QVariant.String),
              QgsField(head2 or "Талбай", QVariant.Double, "double", 20, decimals)]
    if percent:
        fields.append(QgsField(PCT_HEAD, QVariant.Double, "double", 10, 2))
    pr.addAttributes(fields)
    lyr.updateFields()
    feats = []
    for label, value, pct in _rows(head1, head2, rows, total, decimals, with_total):
        f = QgsFeature(lyr.fields())
        f.setAttributes([label, float(value)] + ([float(pct)] if percent else []))
        feats.append(f)
    pr.addFeatures(feats)
    if os.path.exists(path):
        os.remove(path)
    opts = QgsVectorFileWriter.SaveVectorOptions()
    opts.driverName = "XLSX"
    opts.fileEncoding = "UTF-8"
    opts.layerName = "Талбай"
    res = QgsVectorFileWriter.writeAsVectorFormatV3(
        lyr, path, QgsCoordinateTransformContext(), opts)
    err, msg = res[0], res[1]
    if err != QgsVectorFileWriter.NoError:
        return msg or "XLSX бичих боломжгүй"
    return ""


def write(path, head1, head2, rows, total, decimals=2, with_total=True, percent=False):
    """Өргөтгөлөөр нь xlsx эсвэл csv бичнэ. Бодитоор бичсэн файлын зам буцаана.

    XLSX драйвер энэ QGIS-д байхгүй бол ижил нэртэй CSV бичнэ.
    """
    if path.lower().endswith(".xlsx"):
        err = write_xlsx(path, head1, head2, rows, total, decimals, with_total, percent)
        if not err:
            return path
        path = os.path.splitext(path)[0] + ".csv"
    return write_csv(path, head1, head2, rows, total, decimals, with_total, percent)
