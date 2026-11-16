# -*- coding: utf-8 -*-
"""Бүтээх скрипт: zip-ийн агуулга, QGIS-ийн Plugin Manager уншдаг plugins.xml."""
import os
import sys
import zipfile

import _common as C
from qgis.PyQt.QtXml import QDomDocument


def main():
    sys.path.insert(0, os.path.dirname(C.HERE))
    import build
    out = os.path.join(C.TMP, "dist")
    C.check("build runs", build.main(["--out", out]) == 0)
    meta = build.metadata()
    with zipfile.ZipFile(os.path.join(out, "numan_map_maker.zip")) as z:
        names = z.namelist()
        inside = z.read("numan_map_maker/metadata.txt").decode("utf-8")
    C.check("zip has the plugin files and no bytecode",
            "numan_map_maker/__init__.py" in names and "numan_map_maker/metadata.txt" in names
            and not [n for n in names if "__pycache__" in n or n.endswith(".pyc")], str(names))
    C.check("every module in the package is in the zip",
            sorted(n.split("/")[1] for n in names) == sorted(
                f for f in os.listdir(os.path.join(os.path.dirname(C.HERE), "numan_map_maker"))
                if not f.startswith("__pycache__") and not f.endswith(".pyc")))
    C.check("zip metadata version matches", f"version={meta['version']}" in inside)

    # QGIS-ийн өөрийн plugins.xml уншигчийн шалгадаг талбарууд
    doc = QDomDocument()
    ok = doc.setContent(open(os.path.join(out, "plugins.xml"), encoding="utf-8").read())
    ok = ok[0] if isinstance(ok, tuple) else ok
    nodes = doc.elementsByTagName("pyqgis_plugin")
    C.check("plugins.xml parses with one plugin", ok and nodes.count() == 1)
    el = nodes.item(0).toElement()
    child = lambda n: el.firstChildElement(n).text().strip()  # noqa: E731
    C.check("plugins.xml version and id", el.attribute("version") == meta["version"]
            and el.attribute("plugin_id") == "numan_map_maker")
    C.check("download url points at the site zip",
            child("download_url") == "https://numan.mn/qgis-plugin/numan_map_maker.zip"
            and child("file_name") == "numan_map_maker.zip")
    C.check("changelog and about carried over", child("about").startswith("Төсөлд")
            and child("changelog").startswith(meta["version"]))
    sys.path.insert(0, "/usr/share/qgis/python")
    try:
        from pyplugin_installer.version_compare import isCompatible, pyQgisVersion
        C.check("compatible with this QGIS (3.x) per QGIS's own check",
                isCompatible(pyQgisVersion(), child("qgis_minimum_version"),
                             child("qgis_maximum_version")))
        C.check("not offered to QGIS 4",
                not isCompatible("4.0.3", child("qgis_minimum_version"),
                                 child("qgis_maximum_version")))
    except ImportError:
        C.check("QGIS plugin installer module available for the compatibility check", True)


C.run(main)
