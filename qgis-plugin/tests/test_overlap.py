# -*- coding: utf-8 -*-
"""Давхцлын шинжилгээ: файл ачаалах, хувь, давхар нэгж (аймаг ⊃ сум ⊃ баг), олон хил,
хилийн шугам, арын горим, сэдэвчилсэн цуврал."""
import os

import _common as C
from qgis.PyQt.QtCore import Qt, QTimer
from qgis.PyQt.QtGui import QColor
from qgis.core import QgsProject, QgsRectangle, QgsVectorLayer, QgsWkbTypes


def main():
    prj = C.project()
    area = C.study_area()
    prj.addMapLayer(area)
    files = C.boundary_files()
    dlg = C.dialog(C.to_project_rect(QgsRectangle(100.5, 49.2, 102.2, 49.9), prj, grow=1.6))
    from numan_map_maker import composer, overlap
    msgs = C.patch_dialogs(folder=os.path.join(C.TMP, "batch"))
    os.makedirs(os.path.join(C.TMP, "batch"), exist_ok=True)
    dlg.lc_ov_target.setLayer(area)

    # --- 1. Дөрвөн форматын файл, нэгжүүдийн нийлбэр 100%
    expect = {"kml": ("Polygon", 3), "kmz": ("Line", 2), "geojson": ("Polygon", 1),
              "shp": ("Polygon", 2)}
    for kind in ("kml", "kmz", "geojson", "shp"):
        added = dlg._overlap_load_files([files[kind]])
        geom = QgsWkbTypes.geometryDisplayString(added[0].geometryType()) if added else ""
        C.check(f"{kind}: loaded as {expect[kind]}",
                added and (geom, added[0].featureCount()) == expect[kind],
                f"{[(a.name(), a.featureCount()) for a in added]} {geom}")
        res = dlg._overlap_run()
        C.check(f"{kind}: overlap ran", res is not None and res.layer is not None,
                str(msgs[-1:]))
        if res is not None:
            C.check(f"{kind}: shares add up to 100%",
                    abs(sum(p for _n, _h, p in res.rows) - 100.0) < 0.05,
                    str([(n, round(p, 2)) for n, _h, p in res.rows]))
    res_sum = None
    for lyr in prj.mapLayers().values():
        if lyr.customProperty(overlap.ROLE) and lyr.name() == "Давхцал — sum":
            res_sum = lyr
    C.check("one result layer per boundary",
            sorted(l.name() for l in prj.mapLayers().values() if l.customProperty(overlap.ROLE))
            == ["Давхцал — aimag", "Давхцал — license", "Давхцал — sum", "Давхцал — thg"])
    C.check("older results hidden, newest visible",
            not prj.layerTreeRoot().findLayer(res_sum.id()).isVisible()
            and prj.layerTreeRoot().findLayer(dlg._overlap_layer_id).isVisible())
    n = len(prj.mapLayers())
    dlg._overlap_run()
    C.check("re-running the same boundary replaces its result", n == len(prj.mapLayers()))

    # --- 2. Давхар нэгж: аймаг ⊃ сум ⊃ баг нэг давхаргад
    admin = C.nested_admin()
    prj.addMapLayer(admin)
    dlg.lc_ov_bound.setLayer(admin)
    dlg.fc_ov_name.setField("name")
    dlg.cb_ov_label.setCurrentIndex(0)
    res = dlg._overlap_run()
    tree = [(u.name, u.level, u.parent) for u in res.units]
    C.check("nesting detected", res.nested, str(tree))
    C.check("tree order and levels", tree == [
        ("Дорнод", 0, ""), ("Халхгол", 1, "Дорнод"),
        ("1-р баг Цогтсүмбэр", 2, "Халхгол"), ("3-р баг Ташгай", 2, "Халхгол")], str(tree))
    shares = {u.name: round(u.share, 2) for u in res.units}
    C.check("nested shares are each of the study area",
            shares["Дорнод"] == 100.0 and shares["Халхгол"] == 100.0
            and abs(shares["1-р баг Цогтсүмбэр"] + shares["3-р баг Ташгай"] - 100) < 0.05,
            str(shares))
    s = dlg.settings()
    rl = prj.mapLayer(s["table_layer"])
    _h1, _h2, rows, total = composer.table_data(prj, rl, s)
    pct = [round(v / total * 100, 1) for _n, v, _c in rows]
    C.check("map table percent uses the study area, not the row sum",
            pct[:2] == [100.0, 100.0] and composer.table_total_label(rl) == "Судалгааны талбай",
            str(pct))
    C.check("ancestors have no fill colour in the table",
            [c is None for _n, _v, c in rows] == [True, True, False, False],
            str([c.name() if c else None for _n, _v, c in rows]))
    C.check("child rows indented", rows[1][0].startswith(overlap.INDENT)
            and rows[2][0].startswith(overlap.INDENT * 2), repr([r[0] for r in rows]))
    lab = rl.labeling().settings().fieldName if rl.labelsEnabled() else ""
    C.check("labels skip parent units", "huuhed" in lab, lab)
    cat_list = rl.renderer().categories()          # копийг барина: symbol() түүнээс хамаарна
    cats = {c.value(): c.symbol() for c in cat_list}
    C.check("parents drawn as outlines on top, leaves filled",
            cats["Дорнод"].symbolLayer(0).brushStyle() == Qt.BrushStyle.NoBrush
            and cats["1-р баг Цогтсүмбэр"].symbolLayer(0).brushStyle() != Qt.BrushStyle.NoBrush
            and rl.renderer().usingSymbolLevels())
    flat = overlap.analyse(prj, area, prj.mapLayersByName("aimag")[0], "aimag")
    C.check("side-by-side units are not treated as nested", not flat.nested
            and all(u.level == 0 for u in flat.units))

    # --- 3. Хилийн шугам харуулах / нуух
    b = dlg.lc_ov_bound.currentLayer()
    node = prj.layerTreeRoot().findLayer(b.id())
    dlg.chk_ov_bound_show.setChecked(False)
    C.process()
    C.check("boundary line can be hidden", not node.isVisible())
    dlg.chk_ov_bound_show.setChecked(True)
    dlg.cb_ov_bound_color.setColor(QColor("#ff0000"))
    C.process()
    C.check("boundary line shown with chosen colour", node.isVisible()
            and b.renderer().symbol().symbolLayer(1).strokeColor().name() == "#ff0000")

    # --- 4. Арын горим: тооцоо явах хооронд QGIS-ийн үйл явдал боловсруулагдсаар
    ticks = []
    timer = QTimer()
    timer.timeout.connect(lambda: ticks.append(1))
    timer.start(5)
    big = C.big_geojson(4000)
    biglyr = QgsVectorLayer(big, "uls", "ogr")
    prj.addMapLayer(biglyr)
    wide = C.memory("Polygon", "Өргөн талбай")
    C.add_rects(wide, [(88, 42, 119, 52)])
    prj.addMapLayer(wide)
    dlg.lc_ov_target.setLayer(wide)
    dlg.lc_ov_bound.setLayer(biglyr)
    dlg.chk_ov_rest.setChecked(False)
    res = dlg._overlap_run()
    timer.stop()
    C.check("runs in the background (event loop kept running); small units kept",
            res is not None and len(res.units) > 3500 and len(ticks) > 3,
            f"units {len(res.units) if res else None}, ticks {len(ticks)}")
    dlg.chk_ov_rest.setChecked(True)
    dlg.lc_ov_target.setLayer(area)
    prj.removeMapLayers([biglyr.id(), wide.id()])

    # --- 5. Олон хилийг нэг дор, дараа нь сэдэвчилсэн цуврал
    dlg._multi_fill()
    t = dlg.tbl_multi
    want = {"sum", "aimag", "thg"}
    for r in range(t.rowCount()):
        it = t.item(r, 0)
        it.setCheckState(Qt.CheckState.Checked if it.text() in want else Qt.CheckState.Unchecked)
    names = {t.item(r, 0).text(): t.cellWidget(r, 1).currentField() for r in range(t.rowCount())}
    C.check("multi list guesses name fields",
            names.get("sum") == "Name" and names.get("aimag") == "aimag", str(names))
    results = dlg._multi_run()
    C.check("multi run gives one result per boundary",
            sorted(r.boundary_name for r in results) == sorted(want),
            str([r.boundary_name for r in results]))
    heads = [dlg.tbl_overlap.item(r, 0).text() for r in range(dlg.tbl_overlap.rowCount())
             if dlg.tbl_overlap.columnSpan(r, 0) == 3]
    C.check("combined table has a header per boundary", sorted(heads) == sorted(want), str(heads))
    dlg._multi_to_batch()
    jobs = [j["name"] for j in dlg._jobs]
    C.check("results handed to the batch tab", sorted(jobs) == sorted(
        f"Давхцал — {w}" for w in want), str(jobs))
    dlg.le_batch_name.setText("{i}_{name}")
    dlg.sp_dpi.setValue(60)
    dlg.cb_format.setCurrentIndex(0)
    dlg._batch_export()
    pngs = sorted(f for f in os.listdir(os.path.join(C.TMP, "batch")) if f.endswith(".png"))
    C.check("one thematic map per boundary exported", len(pngs) == 3, str(pngs))

    dlg._overlap_clear()
    C.check("clear removes every result layer",
            not [l for l in prj.mapLayers().values() if l.customProperty(overlap.ROLE)])
    dlg.shutdown()


C.run(main)
