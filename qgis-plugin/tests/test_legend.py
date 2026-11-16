# -*- coding: utf-8 -*-
"""Таних тэмдэг: KML-ийн загвар, дараалал, хасахад зургаас ч хасагдах, ангиллын чагт."""
import _common as C
from qgis.PyQt.QtCore import Qt
from qgis.core import (QgsProviderRegistry, QgsProviderSublayerDetails, QgsRectangle)


def legend_names(dlg):
    return [n.name() for n in dlg._items["nm_legend"].model().rootGroup().findLayers()]


def legend_entries(dlg, name):
    m = dlg._items["nm_legend"].model()
    for n in m.rootGroup().findLayers():
        if n.name() == name:
            return [x.data(0) for x in m.layerLegendNodes(n)]
    return None


def map_layers(dlg, prj):
    lyrs = dlg._items["nm_map"].layers() or prj.mapThemeCollection().masterVisibleLayers()
    return [l.name() for l in lyrs]


def main():
    prj = C.project()
    kml = C.styled_kml()
    hil = [d.toLayer(QgsProviderSublayerDetails.LayerOptions(prj.transformContext()))
           for d in QgsProviderRegistry.instance().querySublayers(kml)]
    hil = [l for l in hil if l.isValid()]
    lu, gol = C.land_use(), C.river()
    prj.addMapLayers(hil + [lu, gol])
    dlg = C.dialog(C.to_project_rect(QgsRectangle(99.5, 48.7, 103.7, 50.8), prj))
    from numan_map_maker import composer

    hl = hil[0]
    hl.setName("Хилийн шугам")
    dlg.rebuild()
    C.check("KML layer converted from embedded symbols",
            not composer.has_embedded_symbols(hl), type(hl.renderer()).__name__)
    C.check("KML line drawn in its own red colour",
            hl.renderer().symbol().color().name() == "#ff0000",
            hl.renderer().symbol().color().name())
    C.check("KML layer appears in the legend with a symbol",
            "Хилийн шугам" in legend_names(dlg) and dlg._items["nm_legend"].model().layerLegendNodes(
                dlg._items["nm_legend"].model().rootGroup().findLayer(hl)) != [])
    C.check("all visible layers listed (no map filter by default)",
            set(legend_names(dlg)) == {"Хилийн шугам", "Газар ашиглалт", "Гол"}, str(legend_names(dlg)))

    dlg.tabs.setCurrentIndex(dlg._legend_tab)
    C.process()
    dlg._refresh_legend_editor(force=True)
    T = dlg.tree_legend
    tops = [T.topLevelItem(i).text(0) for i in range(T.topLevelItemCount())]
    last = T.topLevelItem(T.topLevelItemCount() - 1)
    T.setCurrentItem(last)
    last.setSelected(True)
    dlg._legend_move(-1)
    dlg._legend_move(-1)
    dlg.rebuild()
    C.check("reorder: last layer moved to the top", legend_names(dlg)[0] == tops[-1],
            f"{tops} -> {legend_names(dlg)}")
    C.check("order stored in the project",
            prj.readEntry("numan_map_maker", "legend_order", "")[0].startswith("[\""))
    dlg._legend_reset_order()
    dlg.rebuild()
    C.check("reset order", legend_names(dlg) == tops, str(legend_names(dlg)))

    tops = {T.topLevelItem(i).text(0): T.topLevelItem(i) for i in range(T.topLevelItemCount())}
    tops["Гол"].setCheckState(0, Qt.CheckState.Unchecked)
    C.process()
    dlg.rebuild()
    C.check("unchecked layer leaves the legend", "Гол" not in legend_names(dlg))
    C.check("unchecked layer leaves the map too", "Гол" not in map_layers(dlg, prj),
            str(map_layers(dlg, prj)))
    C.check("QGIS layer panel untouched", prj.layerTreeRoot().findLayer(gol.id()).isVisible())

    dlg._refresh_legend_editor(force=True)
    T = dlg.tree_legend
    item = [T.topLevelItem(i) for i in range(T.topLevelItemCount())
            if T.topLevelItem(i).text(0) == "Газар ашиглалт"][0]
    kid = [item.child(i) for i in range(item.childCount()) if item.child(i).text(0) == "Бэлчээр"][0]
    kid.setCheckState(0, Qt.CheckState.Unchecked)
    C.process()
    dlg.rebuild()
    states = {c.label(): c.renderState() for c in lu.renderer().categories()}
    C.check("unchecked category is not drawn", states == {"Ой": True, "Бэлчээр": False,
                                                          "Тариалан": True}, str(states))
    C.check("unchecked category leaves the legend",
            legend_entries(dlg, "Газар ашиглалт") == ["Ой", "Тариалан"],
            str(legend_entries(dlg, "Газар ашиглалт")))
    kid.setCheckState(0, Qt.CheckState.Checked)
    C.process()
    dlg.rebuild()
    C.check("category can be switched back on",
            legend_entries(dlg, "Газар ашиглалт") == ["Ой", "Бэлчээр", "Тариалан"])
    dlg._legend_revert_all()
    C.check("revert restores the original style", all(
        c.renderState() for c in lu.renderer().categories()))
    dlg.shutdown()


C.run(main)
