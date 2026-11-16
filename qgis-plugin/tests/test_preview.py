# -*- coding: utf-8 -*-
"""Урьдчилан харах талбар: хулганаар чирэхэд унахгүй (1.0.0-ийн алдаа), газрын зургийг
шаардлагагүй үед дахин зурахгүй."""
import time

import _common as C
from qgis.PyQt.QtCore import QEvent, QPoint, QPointF, Qt
from qgis.PyQt.QtGui import QMouseEvent
from qgis.PyQt.QtWidgets import QApplication
from qgis.core import QgsFillSymbol, QgsRectangle, QgsSingleSymbolRenderer


def main():
    prj = C.project()
    area, lu = C.study_area(), C.land_use()
    prj.addMapLayers([lu, area])
    dlg = C.dialog(C.to_project_rect(QgsRectangle(100.5, 49.2, 102.2, 49.9), prj, grow=1.4))
    vp = dlg.view.viewport()

    def ev(kind, p, btn=Qt.MouseButton.NoButton, btns=Qt.MouseButton.NoButton):
        e = QMouseEvent(kind, QPointF(p), QPointF(vp.mapToGlobal(p)), btn, btns,
                        Qt.KeyboardModifier.NoModifier)
        QApplication.sendEvent(vp, e)
        C.process()

    def drag(a, b):
        ev(QEvent.Type.MouseMove, a)
        ev(QEvent.Type.MouseButtonPress, a, Qt.MouseButton.LeftButton, Qt.MouseButton.LeftButton)
        for i in range(1, 6):
            ev(QEvent.Type.MouseMove, a + (b - a) * i / 5, Qt.MouseButton.NoButton,
               Qt.MouseButton.LeftButton)
        ev(QEvent.Type.MouseButtonRelease, b, Qt.MouseButton.LeftButton)

    c = vp.rect().center()
    for name, tool in (("select", dlg.tool_select), ("pan", dlg.tool_pan),
                       ("content", dlg.tool_content)):
        dlg._set_tool(tool)
        for p in (QPoint(5, 5), c, c + QPoint(40, 30)):
            ev(QEvent.Type.MouseMove, p)
        drag(c, c + QPoint(60, 40))
        drag(QPoint(3, 3), QPoint(30, 30))
        C.check(f"mouse drag with the {name} tool does not crash", True)
    dlg._set_tool(dlg.tool_select)
    ev(QEvent.Type.MouseButtonPress, c, Qt.MouseButton.LeftButton, Qt.MouseButton.LeftButton)
    ev(QEvent.Type.MouseButtonRelease, c, Qt.MouseButton.LeftButton)
    C.check("click selects an item", len(dlg.layout_.selectedLayoutItems()) == 1)
    dlg.rebuild()
    dlg.view.deleteSelectedItems()
    dlg.rebuild()
    C.check("rebuild with a selection and after delete", "nm_map" in dlg._items)
    dlg.reset_positions()

    # Дахин зурахгүй байх: previewRefreshed дохиог тоолно
    renders = [0]
    seen = set()

    def hook():
        m = dlg._items.get("nm_map")
        if m is not None and id(m) not in seen:
            seen.add(id(m))
            m.previewRefreshed.connect(lambda: renders.__setitem__(0, renders[0] + 1))

    def settle(maxs=30, quiet=2.0):
        t0 = time.time()
        last_act, last = time.time(), renders[0]
        while time.time() - t0 < maxs:
            dlg.view.grab()
            C.process(0.02)
            m = dlg._items.get("nm_map")
            if (m is not None and m.isDrawing()) or renders[0] != last:
                last_act = time.time()
            last = renders[0]
            if time.time() - last_act > quiet:
                break

    def step(fn):
        before = renders[0]
        fn()
        dlg.rebuild()
        hook()
        settle()
        return renders[0] - before

    def setv(**kw):
        s = dlg.settings()
        s.update(kw)
        dlg._apply_settings(s)

    # Гарчиг анх нэмэхэд зургийн хүрээ богиносдог тул дахин зурна (зөв); харин гарчгийн
    # бичвэрийг солиход зураг өөрчлөгдөхгүй
    setv(title="ГАРЧИГ")
    dlg.rebuild()
    hook()
    settle()
    same = id(dlg._items["nm_map"])
    C.check("changing the title text does not redraw the map",
            step(lambda: setv(title="ШИНЭ ГАРЧИГ")) == 0)
    C.check("legend option does not redraw the map",
            step(lambda: setv(legend_font_size=10, north_pos="TL")) == 0)
    C.check("map item reused", id(dlg._items["nm_map"]) == same)
    node = prj.layerTreeRoot().findLayer(lu.id())
    C.check("hiding a layer redraws the map",
            step(lambda: node.setItemVisibilityChecked(False)) >= 1)
    C.check("restyling a layer redraws the map",
            step(lambda: (area.setRenderer(QgsSingleSymbolRenderer(QgsFillSymbol.createSimple(
                {"color": "255,0,0,60"}))), area.triggerRepaint())) >= 1)
    C.check("refresh button forces a redraw",
            step(lambda: setattr(dlg, "_map_dirty", True)) >= 1)
    dlg.shutdown()


C.run(main)
