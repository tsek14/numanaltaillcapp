# -*- coding: utf-8 -*-
"""Зураг угсрах, гараар зөөсөн байрлал, хуудасны хэмжээ, 5 формат экспорт, хэвлэх,
Layout Designer, тусламж, хоосон төсөл, хуучин тохиргооны шилжилт, цонхны хэмжээ."""
import json
import os

import _common as C
from qgis.PyQt.QtGui import QImage
from qgis.PyQt.QtPrintSupport import QPrinter
from qgis.core import QgsLayoutExporter, QgsLayoutPoint, QgsRectangle, QgsSettings


def main():
    prj = C.project()
    area, lu, gol, pts = C.study_area(), C.land_use(), C.river(), C.points()
    prj.addMapLayers([gol, lu, pts, area])
    dlg = C.dialog(C.to_project_rect(QgsRectangle(100.5, 49.2, 102.2, 49.9), prj, grow=1.4))
    from numan_map_maker import composer, dialog as D

    # Товчны мөрүүд багтахгүй бол шилждэг тул фонтоос үл хамааран жижиг дэлгэцэнд багтана
    # (жишээ нь 1366 px дэлгэцийг 125%-иар томруулсан Windows = 1093 px)
    C.check("window fits a small, scaled laptop screen", dlg.minimumSizeHint().width() <= 800,
            str(dlg.minimumSizeHint()))
    dlg.resize(700, 560)
    C.process(0.2)
    C.check("button rows wrap instead of widening the window",
            dlg.btn_print.geometry().right() <= dlg.btn_print.parentWidget().width()
            and dlg.width() <= 760, f"{dlg.width()} {dlg.btn_print.geometry()}")
    dlg.resize(1280, 720)
    C.process(0.2)
    C.check("default items", {"nm_map", "nm_legend", "nm_north", "nm_scalebar"}
            <= set(dlg._items), str(sorted(dlg._items)))
    C.check("default north arrow and scale bar",
            dlg._items["nm_north"].picturePath().endswith("NorthArrow_10.svg")
            and dlg._items["nm_scalebar"].style() == "Double Box")

    photo = os.path.join(C.TMP, "photo.jpg")
    img = QImage(400, 250, QImage.Format.Format_RGB32)
    img.fill(0x6c8ebf)
    img.save(photo)
    s = dlg.settings()
    s.update(title="ТУРШИЛТ {project}", subtitle="(2025 он)", caption="Зураг 1.1. Туршилт",
             credits="Эх сурвалж: туршилт", table=True, table_layer=lu.id(), scale_text=True,
             extent_mode="visible", scale_mode="round",
             photos=[{"path": photo, "lon": 101.7, "lat": 49.6, "pos": "TL", "width": 45}],
             photo_coord_label=True)
    dlg._apply_settings(s)
    dlg.rebuild()
    want = {"nm_title", "nm_subtitle", "nm_caption", "nm_credits", "nm_table", "nm_scale_text",
            "nm_photo_0", "nm_line_0", "nm_coord_0"}
    C.check("all optional elements built", want <= set(dlg._items), str(sorted(dlg._items)))
    C.check("rounded scale", dlg._items["nm_map"].scale() in (500000, 600000, 750000, 1000000,
                                                              1250000, 1500000, 2000000),
            str(dlg._items["nm_map"].scale()))

    # Гараар зөөсөн байрлал тохиргоо өөрчлөхөд хадгалагдана
    dlg._items["nm_legend"].attemptMove(QgsLayoutPoint(120, 60), True)
    dlg._items["nm_map"].moveContent(10, 5)
    e1 = dlg._items["nm_map"].extent()
    s = dlg.settings()
    s["legend_font_size"] = 9
    dlg._apply_settings(s)
    dlg.rebuild()
    from numan_map_maker import composer as comp
    g = comp.item_geom(dlg._items["nm_legend"])
    e2 = dlg._items["nm_map"].extent()
    C.check("dragged legend keeps its place", (round(g[1]), round(g[2])) == (120, 60), str(g))
    C.check("panned map keeps its extent", abs(e1.xMinimum() - e2.xMinimum()) < 1)
    dlg.reset_positions()
    C.check("reset positions", not dlg._overrides and dlg._extent_override is None)

    # Хуудасны хэмжээ, гадна таних тэмдэг
    s = dlg.settings()
    s.update(page_size="A3", orientation="portrait", legend_pos="OUT", grid_crs="map",
             grid_style="lines", grid_frame="zebra", title_place="inside", photos=[])
    dlg._apply_settings(s)
    dlg.rebuild()
    pg = dlg.layout_.pageCollection().page(0).pageSize()
    leg = comp.item_rect(dlg._items["nm_legend"])
    mp = comp.item_rect(dlg._items["nm_map"])
    C.check("A3 portrait page", (pg.width(), pg.height()) == (297, 420))
    C.check("legend outside the map frame", leg.left() >= mp.right())

    # 5 формат экспорт (жинхэнэ товчны кодоор)
    s.update(page_size="A4", orientation="landscape", legend_pos="BL", title_place="outside")
    dlg._apply_settings(s)
    dlg.rebuild()
    for k, (_f, ext) in enumerate(D.EXPORT_FORMATS):
        path = os.path.join(C.TMP, "e." + ext)
        C.patch_dialogs(save_path=path)
        dlg.cb_format.setCurrentIndex(k)
        dlg.sp_dpi.setValue(150)
        dlg.chk_world.setChecked(ext == "tif")
        dlg.export()
        C.check(f"export {ext}", os.path.exists(path) and os.path.getsize(path) > 1000)
    C.check("world file written", os.path.exists(os.path.join(C.TMP, "e.tfw")))
    w = QImage(os.path.join(C.TMP, "e.png")).width()
    C.check("PNG at 150 dpi is A4 sized", abs(w - 297 / 25.4 * 150) <= 2, str(w))
    fig = dlg.settings()["fig_no"]

    # Хэвлэх (PDF хэвлэгчээр)
    pr = QPrinter(QPrinter.PrinterMode.HighResolution)
    pr.setOutputFormat(QPrinter.OutputFormat.PdfFormat)
    pdf = os.path.join(C.TMP, "print.pdf")
    pr.setOutputFileName(pdf)
    pr.setPageLayout(dlg._page_layout())
    pr.setFullPage(True)
    C.check("print to printer", dlg._print_to(pr) == QgsLayoutExporter.Success
            and os.path.getsize(pdf) > 1000)
    C.check("print page matches map page",
            round(dlg._page_layout().fullRect().width()) == 297)

    dlg.open_in_designer()
    C.check("open in Layout Designer", dlg.iface.designer and
            prj.layoutManager().layoutByName(dlg.iface.designer[-1]) is not None)
    dlg.show_help()
    C.process()
    C.check("help window", dlg._help_dialog.isVisible())
    dlg._help_dialog.close()
    C.check("figure number not auto-advanced unless enabled", fig == dlg.settings()["fig_no"])

    # Хуучин хувилбарын хадгалсан тохиргоо шинэ анхдагчийг дарахгүй
    QgsSettings().setValue(D.SETTINGS_KEY, json.dumps({
        "north_svg": "", "scalebar_style": "Single Box", "legend_filter": True,
        "title": "хуучин", "margin": 12}))
    d2 = D.MapMakerDialog(C.FakeIface())
    s2 = d2.settings()
    C.check("old saved settings migrate", s2["north_svg"].endswith("NorthArrow_10.svg")
            and s2["scalebar_style"] == "Double Box" and not s2["legend_filter"]
            and s2["title"] == "хуучин" and s2["margin"] == 12)
    d2.shutdown()

    prj.clear()
    C.process()
    dlg.rebuild()
    C.check("empty project does not break", "nm_map" in dlg._items)
    dlg.shutdown()


C.run(main)
