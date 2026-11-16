# -*- coding: utf-8 -*-
"""QGIS-д плагин болж ачаалагдах, цонх нээгдэх, унтрах (metadata.txt-ийг QGIS шиг уншина)."""
import configparser
import os

import _common as C


class Iface(C.FakeIface):
    def __init__(self):
        super().__init__()
        self.actions, self.menus = [], []

    def addToolBarIcon(self, a):
        self.actions.append(a)

    def removeToolBarIcon(self, a):
        self.actions.remove(a)

    def addPluginToMenu(self, m, a):
        self.menus.append((m, a))

    def removePluginMenu(self, m, a):
        self.menus.remove((m, a))


def main():
    C.project()
    cp = configparser.ConfigParser(interpolation=None)
    path = os.path.join(os.path.dirname(C.HERE), "numan_map_maker", "metadata.txt")
    with open(path, encoding="utf-8") as fh:
        cp.read_file(fh)
    g = cp["general"]
    C.check("metadata readable like QGIS reads it",
            g["name"] and g["version"] and g["qgisMinimumVersion"] == "3.28"
            and g["qgisMaximumVersion"] == "3.99" and g["changelog"].startswith(g["version"]))
    import numan_map_maker
    iface = Iface()
    plugin = numan_map_maker.classFactory(iface)
    plugin.initGui()
    C.check("toolbar button and menu entry", len(iface.actions) == 1 and len(iface.menus) == 1
            and g["version"] in iface.actions[0].text())
    plugin.run()
    C.process(0.3)
    C.check("dialog opens", plugin.dialog is not None and plugin.dialog.isVisible()
            and "Нуман-Алтай ХХК" in plugin.dialog.windowTitle())
    plugin.unload()
    C.check("unload removes button and menu", not iface.actions and not iface.menus
            and plugin.dialog is None)


C.run(main)
