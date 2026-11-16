# -*- coding: utf-8 -*-
"""Бэлэн загвар (A5, A3 …), стандарт загварын сан, байршлын зураг, лого, мэдээллийн
хүснэгт, {name} тэмдэглэгээ, зургийн дугаар, Excel, цуврал зураг."""
import json
import os

import _common as C
from qgis.PyQt.QtCore import Qt
from qgis.PyQt.QtGui import QColor, QImage
from qgis.core import (QgsLineSymbol, QgsRectangle, QgsSingleSymbolRenderer, QgsVectorLayer)


def main():
    prj = C.project()
    sums = C.memory("Polygon", "Сумын хил", "&field=ner:string")
    C.add_rects(sums, [("Алаг-Эрдэнэ", (100, 49, 101, 49.7)), ("Түнэл", (101.2, 49.4, 102.2, 50.1)),
                       ("Эрдэнэбулган", (102.3, 50, 103.3, 50.7))], "ner")
    gol = C.memory("LineString", "Гол мөрөн")
    zam = C.memory("LineString", "Авто зам")
    from qgis.core import QgsFeature, QgsGeometry, QgsPointXY
    for lyr, pts in ((gol, [(100, 49.2), (101.5, 49.8), (103.2, 50.5)]),
                     (zam, [(100.2, 49.6), (102.5, 49.3)])):
        f = QgsFeature()
        f.setGeometry(QgsGeometry.fromPolylineXY([QgsPointXY(*p) for p in pts]))
        lyr.dataProvider().addFeatures([f])
        lyr.updateExtents()
    lu = C.land_use()
    prj.addMapLayers([zam, gol, lu, sums])
    dlg = C.dialog(C.to_project_rect(sums.extent(), prj))
    from numan_map_maker import composer, extras, styles, templates
    tmpd = os.path.join(C.TMP, "tpl")
    os.makedirs(tmpd, exist_ok=True)
    templates.user_dir = lambda: tmpd
    styles.user_path = lambda: os.path.join(tmpd, "styles.json")
    C.patch_dialogs()

    # --- Стандарт загвар
    rules = {l.name(): (styles.match(l) or [None])[0] for l in (zam, gol, sums, lu)}
    C.check("layers recognised by name", rules == {"Авто зам": "Авто зам",
                                                   "Гол мөрөн": "Гол, горхи",
                                                   "Сумын хил": "Сумын хил",
                                                   "Газар ашиглалт": None}, str(rules))
    dlg._styles_apply()
    C.check("standard colours applied, categorised layer untouched",
            gol.renderer().symbol().color().name() == "#2b7bba"
            and type(lu.renderer()).__name__ == "QgsCategorizedSymbolRenderer")
    zam.setRenderer(QgsSingleSymbolRenderer(QgsLineSymbol.createSimple(
        {"color": "#ff00ff", "width": "1.4"})))
    styles.save_layer_style(zam, ["авто зам"], "Миний зам")
    zam.setRenderer(QgsSingleSymbolRenderer(QgsLineSymbol.createSimple({"color": "#000000"})))
    C.check("user style library wins", styles.apply(zam) == "Миний зам"
            and zam.renderer().symbol().color().name() == "#ff00ff")

    # --- Нэмэлт элементүүд, тэмдэглэгээ, дугаар
    logo = os.path.join(C.TMP, "logo.png")
    img = QImage(300, 120, QImage.Format.Format_RGB32)
    img.fill(QColor("#1f3b57"))
    img.save(logo)
    s = dlg.settings()
    s.update(title="{name} СУМЫН ГАЗАР АШИГЛАЛТ", caption="{name} сумын газар ашиглалт",
             caption_auto=True, fig_chapter="1", fig_no=66, fig_increment=True,
             inset=True, inset_extent="mongolia", inset_layer=sums.id(), inset_base="",
             logo=logo, info=True, info_org="Нуман-Алтай ХХК", info_author="Б. Бат",
             table=True, table_layer=lu.id(), table_percent=True, extent_mode="visible")
    dlg._apply_settings(s)
    dlg.rebuild()
    C.check("inset, logo, info, table built",
            {"nm_inset", "nm_logo", "nm_info", "nm_table"} <= set(dlg._items))
    C.check("inset shows the study area frame",
            dlg._items["nm_inset"].overviews().size() == 1)
    C.check("caption numbered", dlg._items["nm_caption"].text().startswith("Зураг 1.66."),
            dlg._items["nm_caption"].text())
    info = [[c.content() for c in r] for r in
            dlg._items["nm_info"].multiFrame().tableContents()]
    C.check("info block rows", [r[0] for r in info][:3] == ["Гүйцэтгэгч", "Зураг үйлдсэн", "Огноо"],
            str(info))

    # --- Excel
    p = dlg._write_table(os.path.join(C.TMP, "t.xlsx"), lu, dlg.settings())
    back = QgsVectorLayer(p, "x", "ogr")
    C.check("area table to Excel with percent column",
            back.isValid() and [f.name() for f in back.fields()] == ["Ангилал", "Талбай, км²",
                                                                      "Хувь, %"],
            str([f.name() for f in back.fields()]))

    # --- Цуврал: объект бүрээр
    bdir = os.path.join(C.TMP, "batch")
    os.makedirs(bdir, exist_ok=True)
    C.patch_dialogs(folder=bdir)
    dlg.lc_batch.setLayer(sums)
    dlg.fc_batch.setField("ner")
    jobs = dlg._batch_plan()
    C.check("batch plan per feature", [j["name"] for j in jobs] ==
            ["Алаг-Эрдэнэ", "Түнэл", "Эрдэнэбулган"])
    dlg.lw_jobs.setCurrentRow(1)
    dlg._batch_preview()
    C.check("preview a batch job", dlg._items["nm_title"].text() ==
            "Түнэл СУМЫН ГАЗАР АШИГЛАЛТ" and "1.67." in dlg._items["nm_caption"].text(),
            dlg._items["nm_caption"].text())
    dlg._batch_preview_off()
    dlg.le_batch_name.setText("{n}_{name}")
    dlg.chk_batch_xlsx.setChecked(True)
    dlg.sp_dpi.setValue(60)
    dlg.cb_format.setCurrentIndex(0)
    dlg._batch_export()
    files = sorted(os.listdir(bdir))
    C.check("batch export files", files == ["1.66_Алаг-Эрдэнэ.png", "1.67_Түнэл.png",
                                           "1.68_Эрдэнэбулган.png", "talbain_husnegt.xlsx"],
            str(files))
    C.check("figure number advanced after export", dlg.settings()["fig_no"] == 69)

    # --- Цуврал: давхарга бүрээр
    dlg.cb_batch_mode.setCurrentIndex(1)
    C.process()
    lw = dlg.lw_batch_layers
    for i in range(lw.count()):
        if lw.item(i).text() in ("Гол мөрөн", "Авто зам"):
            lw.item(i).setCheckState(Qt.CheckState.Checked)
    jobs = dlg._batch_plan()
    dlg.lw_jobs.setCurrentRow(0)
    dlg._batch_preview()
    shown = [l.name() for l in dlg._items["nm_map"].layers()]
    C.check("thematic map shows only its own theme layer",
            jobs[0]["name"] in shown and jobs[1]["name"] not in shown, str(shown))
    dlg._batch_preview_off()

    # --- Бэлэн загварууд
    names = [dlg.cb_template.itemData(i)[1] for i in range(dlg.cb_template.count())
             if dlg.cb_template.itemData(i)]
    sizes = {}
    for name in names:
        dlg.cb_template.setCurrentIndex([dlg.cb_template.itemData(i)[1]
                                         if dlg.cb_template.itemData(i) else None
                                         for i in range(dlg.cb_template.count())].index(name))
        dlg._template_apply()
        pg = dlg.layout_.pageCollection().page(0).pageSize()
        sizes[name] = (pg.width(), pg.height())
    C.check("A5 and A3 templates", sizes.get("A5 хэвтээ (жижиг зураг)") == (210, 148)
            and sizes.get("A5 босоо (жижиг зураг)") == (148, 210)
            and sizes.get("A3 хэвтээ") == (420, 297) and sizes.get("A3 босоо") == (297, 420),
            str(sizes))
    C.check("templates keep project layers", dlg.settings()["table_layer"] == lu.id())
    templates.save_user("Миний тайлан", dlg.settings())
    saved = json.load(open(templates.list_user()["Миний тайлан"], encoding="utf-8"))
    C.check("user template saved without project-specific keys",
            "table_layer" not in saved and "coord_layer" not in saved)
    dlg.shutdown()


C.run(main)
