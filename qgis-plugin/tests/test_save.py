# -*- coding: utf-8 -*-
"""«Хадгалах… / Ачаалах…»: зургийг бүхэлд нь хадгалаад, хадгалсан байдлаар нь сэргээх."""
import os

import _common as C
from qgis.PyQt.QtCore import Qt
from qgis.core import QgsLayoutPoint, QgsProject, QgsRectangle


def main():
    prj = C.project()
    area, lu, gol = C.study_area(), C.land_use(), C.river()
    prj.addMapLayers([gol, lu, area])
    dlg = C.dialog(C.to_project_rect(QgsRectangle(100.5, 49.2, 102.2, 49.9), prj, grow=1.6))
    from numan_map_maker import composer, dialog as D, vertices
    qgz = os.path.join(C.TMP, "миний_зураг.qgz")
    C.patch_dialogs(save_path=qgz, open_path=qgz)

    # Давхцал (санах ойн давхарга), булангийн цэг, таних тэмдгээс хассан давхарга, ангилал
    admin = C.nested_admin()
    prj.addMapLayer(admin)
    dlg.lc_ov_target.setLayer(area)
    dlg.lc_ov_bound.setLayer(admin)
    dlg.fc_ov_name.setField("name")
    dlg._overlap_run()
    s = dlg.settings()
    s.update(title="ХАДГАЛАХ ТУРШИЛТ", caption="Зураг 2.5. Хадгалсан зураг", north_pos="TL",
             coord_table=True, coord_layer=area.id(), coord_pos="BL")
    dlg._apply_settings(s)
    dlg.rebuild()
    dlg._refresh_legend_editor(force=True)
    T = dlg.tree_legend
    for i in range(T.topLevelItemCount()):
        if T.topLevelItem(i).text(0) == "Гол":
            T.topLevelItem(i).setCheckState(0, Qt.CheckState.Unchecked)
    C.process()
    dlg._items["nm_legend"].attemptMove(QgsLayoutPoint(150, 40), True)
    dlg._items["nm_map"].moveContent(12, -6)
    dlg.rebuild()
    before = C.export_png(dlg, os.path.join(C.TMP, "before.png"))
    legend_pos = composer.item_geom(dlg._items["nm_legend"])[1:3]
    ext = dlg._items["nm_map"].extent()
    names = sorted(l.name() for l in prj.mapLayers().values())
    mem = sum(l.providerType() == "memory" for l in prj.mapLayers().values())

    C.check("save", dlg.save_map_project() and os.path.exists(qgz))
    C.check("memory layers written beside the project",
            mem > 0 and os.path.exists(qgz[:-4] + "_data.gpkg")
            and not [l for l in prj.mapLayers().values() if l.providerType() == "memory"])

    prj.clear()
    C.process()
    dlg._apply_settings({})
    dlg.reset_positions()
    C.check("project really cleared", not prj.mapLayers() and dlg.settings()["title"] == "")

    C.check("load", dlg.load_map_project())
    C.process()
    s2 = dlg.settings()
    C.check("layers restored", sorted(l.name() for l in prj.mapLayers().values()) == names,
            str(sorted(l.name() for l in prj.mapLayers().values())))
    C.check("settings restored", s2["title"] == "ХАДГАЛАХ ТУРШИЛТ" and s2["north_pos"] == "TL"
            and s2["coord_table"] and s2["table"] and len(s2["legend_hidden"]) == 1)
    C.check("dragged legend position restored",
            composer.item_geom(dlg._items["nm_legend"])[1:3] == legend_pos)
    e2 = dlg._items["nm_map"].extent()
    C.check("map extent restored", abs(ext.xMinimum() - e2.xMinimum()) < 1
            and abs(ext.yMaximum() - e2.yMaximum()) < 1)
    C.check("overlap table restored", "nm_table" in dlg._items and "nm_coords" in dlg._items)
    C.check("numbered corners not duplicated",
            len([l for l in prj.mapLayers().values() if l.customProperty(vertices.ROLE)]) == 1)
    after = C.export_png(dlg, os.path.join(C.TMP, "after.png"))
    diff = C.image_diff(before, after)
    C.check("picture after loading matches the saved one", diff < 0.5, f"mean diff {diff:.2f}")

    d2 = D.MapMakerDialog(C.FakeIface())
    C.check("reopening the plugin on the saved project restores it",
            d2.settings()["title"] == "ХАДГАЛАХ ТУРШИЛТ" and "nm_legend" in d2._overrides)
    d2.shutdown()
    dlg.shutdown()


C.run(main)
