# -*- coding: utf-8 -*-
"""Булангийн цэгийн солбицол: хэлбэрүүд, олон объект, хүснэгт, дугаар, Excel."""
import os

import _common as C
from qgis.core import QgsFeature, QgsGeometry, QgsPointXY, QgsRectangle, QgsVectorLayer


def main():
    prj = C.project()
    lic = C.memory("Polygon", "Лиценз", "&field=name:string")
    f = QgsFeature(lic.fields())
    # 49°12′00″N 100°30′00″E орчим; нэг орой нь бүхэл секундгүй
    f.setGeometry(QgsGeometry.fromPolygonXY([[
        QgsPointXY(100.5, 49.2), QgsPointXY(100.75, 49.2), QgsPointXY(100.75, 49.35),
        QgsPointXY(100.5123456, 49.3456789), QgsPointXY(100.5, 49.2)]]))
    f["name"] = "MV-000123"
    lic.dataProvider().addFeatures([f])
    lic.updateExtents()
    prj.addMapLayer(lic)
    dlg = C.dialog(C.to_project_rect(QgsRectangle(100.4, 49.1, 100.9, 49.45), prj))
    from numan_map_maker import vertices

    s = dlg.settings()
    s.update(coord_table=True, coord_layer=lic.id(), coord_format="dms", coord_order="latlon",
             coord_marks=True)
    dlg._apply_settings(s)
    dlg.rebuild()
    data = vertices.table(prj, lic, dlg.settings())
    C.check("closing vertex not repeated: 4 corners", len(data["rows"]) == 4, str(data["rows"]))
    C.check("DMS, latitude first", data["rows"][0] == ["1", "49°12′00.00″N", "100°30′00.00″E"],
            str(data["rows"][0]))
    C.check("DMS seconds rounding", data["rows"][3][1:] == ["49°20′44.44″N", "100°30′44.44″E"],
            str(data["rows"][3]))
    C.check("headers", data["head"] == ["№", "Өргөрөг", "Уртраг"], str(data["head"]))
    item = dlg._items.get("nm_coords")
    C.check("coordinate table added to the map", item is not None)
    if item is not None:
        cells = [[c.content() for c in row] for row in item.multiFrame().tableContents()]
        C.check("table header names the datum", cells[0] == ["№", "Өргөрөг (WGS 84)", "Уртраг"],
                str(cells[0]))
    marks = [l for l in prj.mapLayers().values() if l.customProperty(vertices.ROLE)]
    C.check("corners numbered on the map",
            len(marks) == 1 and sorted(ft["no"] for ft in marks[0].getFeatures()) == [1, 2, 3, 4])
    legend = [n.name() for n in dlg._items["nm_legend"].model().rootGroup().findLayers()]
    C.check("numbered points kept out of the legend", "Булангийн цэг" not in legend, str(legend))
    n = len(prj.mapLayers())
    dlg.rebuild()
    C.check("marks not recreated when nothing changed", len(prj.mapLayers()) == n
            and marks[0].id() in prj.mapLayers())

    for fmt, order, first in (("dd", "latlon", ["1", "49.200000", "100.500000"]),
                              ("dm", "lonlat", ["1", "100°30.0000′E", "49°12.0000′N"])):
        s = dlg.settings()
        s.update(coord_format=fmt, coord_order=order)
        row = vertices.table(prj, lic, s)["rows"][0]
        C.check(f"{fmt} / {order}", row == first, str(row))
    s = dlg.settings()
    s.update(coord_format="utm")
    d = vertices.table(prj, lic, s)
    x = float(d["rows"][0][1].replace(" ", ""))
    y = float(d["rows"][0][2].replace(" ", ""))
    C.check("UTM zone picked from longitude (47N)", d["crs_short"] == "UTM 47N", d["crs_short"])
    # 47-р бүсийн төв меридиан 99°E. 100.5°E нь 1.5° зүүн: 49.2°N-д 1° ≈ 72.8 км тул
    # X ≈ 500 000 + 109 000 = 609 000 м; Y нь экватороос меридианы нум ≈ 5 450 км
    C.check("UTM values plausible", 608500 < x < 610000 and 5450000 < y < 5451500, f"{x} {y}")

    # Олон объект: «Талбай» багана, дугаар объект бүрээр
    f2 = QgsFeature(lic.fields())
    f2.setGeometry(QgsGeometry.fromRect(QgsRectangle(100.8, 49.2, 100.85, 49.25)))
    f2["name"] = "XV-000777"
    lic.dataProvider().addFeatures([f2])
    lic.updateExtents()
    s = dlg.settings()
    s.update(coord_format="dms", coord_rows=5)
    d = vertices.table(prj, lic, s)
    C.check("several features: name column, numbering restarts",
            d["head"][0] == "Талбай" and d["rows"][4][:2] == ["XV-000777", "1"]
            and d["rows"][5][0] == "", str(d["rows"][3:6]))
    dlg._apply_settings(s)
    dlg.rebuild()
    cells = [[c.content() for c in row] for row in
             dlg._items["nm_coords"].multiFrame().tableContents()]
    C.check("long lists continue in a second column block",
            len(cells) == 6 and len(cells[0]) == 8, f"{len(cells)} rows x {len(cells[0])}")
    marks = [l for l in prj.mapLayers().values() if l.customProperty(vertices.ROLE)]
    C.check("marks follow geometry edits", marks and marks[0].featureCount() == 8)

    # Excel
    path = os.path.join(C.TMP, "coords.xlsx")
    C.patch_dialogs(save_path=path)
    dlg._coord_export()
    back = QgsVectorLayer(path, "x", "ogr")
    # Бүх багана бичвэр тул OGR толгой мөрийг өгөгдөл гэж уншина: эхний мөр = гарчиг
    rows = [ft.attributes() for ft in back.getFeatures()]
    C.check("coordinates exported to Excel with datum note",
            back.isValid() and rows[0][:2] == ["Талбай", "№"]
            and rows[1][:3] == ["MV-000123", "1", "49°12′00.00″N"]
            and "WGS 84" in rows[-1][0], str(rows[:2] + rows[-1:]))

    # Унтраахад дугаарын давхарга арилна
    s = dlg.settings()
    s["coord_table"] = False
    dlg._apply_settings(s)
    dlg.rebuild()
    C.check("switching off removes the numbered points",
            not [l for l in prj.mapLayers().values() if l.customProperty(vertices.ROLE)]
            and "nm_coords" not in dlg._items)
    dlg.shutdown()


C.run(main)
