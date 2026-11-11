# -*- coding: utf-8 -*-
import os
import sys

from qgis.PyQt.QtGui import QIcon
from qgis.PyQt.QtWidgets import QAction
from qgis.core import Qgis, QgsMessageLog

from .version import plugin_version

MENU = "&Газрын зураг бэлтгэгч"


def _purge_stale_modules():
    """ZIP-ээс дахин суулгасны дараа QGIS-ийг дахин асаахгүй байхад хуучин код
    санах ойд үлдэхээс сэргийлж дэд модулиудыг дахин ачаалуулна."""
    pkg = __package__ or __name__.rpartition(".")[0]
    for name in list(sys.modules):
        if name.startswith(pkg + ".") and name != __name__ and not name.endswith(".version"):
            del sys.modules[name]


class NumanMapMaker:
    def __init__(self, iface):
        self.iface = iface
        self.action = None
        self.dialog = None

    def initGui(self):
        _purge_stale_modules()
        QgsMessageLog.logMessage(
            f"Газрын зураг бэлтгэгч v{plugin_version()} ачааллаа ({os.path.dirname(__file__)})",
            "Numan Map Maker", Qgis.Info)
        icon = QIcon(os.path.join(os.path.dirname(__file__), "icon.svg"))
        self.action = QAction(icon, f"Газрын зураг бэлтгэгч (v{plugin_version()})",
                              self.iface.mainWindow())
        self.action.setToolTip("Газрын зургийг автоматаар бэлдэж, урьдчилан харж, экспортлох")
        self.action.triggered.connect(self.run)
        self.iface.addToolBarIcon(self.action)
        self.iface.addPluginToMenu(MENU, self.action)

    def unload(self):
        if self.action is not None:
            self.iface.removeToolBarIcon(self.action)
            self.iface.removePluginMenu(MENU, self.action)
            self.action = None
        if self.dialog is not None:
            try:
                self.dialog.shutdown()
                self.dialog.close()
                self.dialog.deleteLater()
            except RuntimeError:
                pass
            self.dialog = None

    def run(self):
        if self.dialog is None:
            from .dialog import MapMakerDialog
            self.dialog = MapMakerDialog(self.iface, self.iface.mainWindow())
        self.dialog.show()
        self.dialog.raise_()
        self.dialog.activateWindow()
