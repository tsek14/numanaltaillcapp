#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Плагины zip болон QGIS-ийн Plugin Manager-т зориулсан plugins.xml-ийг үүсгэнэ.

    python build.py            # zip + plugins.xml
    python build.py --test     # эхлээд бүх тестийг ажиллуулж, амжилттай бол бүтээнэ

QGIS-д нэг удаа «Plugins → Manage and Install Plugins → Settings → Add…» хэсэгт
https://numan.mn/qgis-plugin/plugins.xml хаягийг нэмбэл шинэ хувилбар гарах бүрд QGIS
«шинэчлэл бий» гэж мэдэгдэнэ (сайт main салбараас нийтлэгдсэний дараа).
"""
import argparse
import configparser
import datetime
import os
import subprocess
import sys
import zipfile
from xml.sax.saxutils import escape

HERE = os.path.dirname(os.path.abspath(__file__))
PLUGIN = "numan_map_maker"
BASE_URL = "https://numan.mn/qgis-plugin/"


def metadata():
    cp = configparser.ConfigParser(interpolation=None)
    with open(os.path.join(HERE, PLUGIN, "metadata.txt"), encoding="utf-8") as fh:
        cp.read_file(fh)
    return dict(cp["general"])


def build_zip(out_dir=HERE):
    path = os.path.join(out_dir, PLUGIN + ".zip")
    if os.path.exists(path):
        os.remove(path)
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        src = os.path.join(HERE, PLUGIN)
        for name in sorted(os.listdir(src)):
            full = os.path.join(src, name)
            if name == "__pycache__" or name.endswith(".pyc") or not os.path.isfile(full):
                continue
            z.write(full, f"{PLUGIN}/{name}")
    return path


def _ver3(v):
    parts = (v.strip().split(".") + ["0", "0"])[:3]
    return ".".join(parts)


def plugins_xml(meta, base_url=BASE_URL):
    today = datetime.date.today().isoformat()
    fields = {
        "description": meta.get("description", ""),
        "about": meta.get("about", ""),
        "changelog": meta.get("changelog", ""),
    }
    cdata = {k: "<![CDATA[" + v.replace("]]>", "]] >") + "]]>" for k, v in fields.items()}
    return f'''<?xml version="1.0" encoding="UTF-8"?>
<plugins>
  <pyqgis_plugin name="{escape(meta['name'], {'"': '&quot;'})}" version="{escape(meta['version'])}" plugin_id="{PLUGIN}">
    <description>{cdata['description']}</description>
    <about>{cdata['about']}</about>
    <changelog>{cdata['changelog']}</changelog>
    <version>{escape(meta['version'])}</version>
    <qgis_minimum_version>{_ver3(meta.get('qgisminimumversion', '3.28'))}</qgis_minimum_version>
    <qgis_maximum_version>{_ver3(meta.get('qgismaximumversion', '3.99'))}</qgis_maximum_version>
    <homepage>{escape(meta.get('homepage', ''))}</homepage>
    <file_name>{PLUGIN}.zip</file_name>
    <icon>{escape(base_url + PLUGIN + '/' + meta.get('icon', 'icon.svg'))}</icon>
    <author_name>{escape(meta.get('author', ''))}</author_name>
    <download_url>{escape(base_url + PLUGIN + '.zip')}</download_url>
    <uploaded_by>{escape(meta.get('author', ''))}</uploaded_by>
    <create_date>2026-11-11</create_date>
    <update_date>{today}</update_date>
    <experimental>{meta.get('experimental', 'False')}</experimental>
    <deprecated>{meta.get('deprecated', 'False')}</deprecated>
    <tracker>{escape(meta.get('tracker', ''))}</tracker>
    <repository>{escape(meta.get('repository', ''))}</repository>
    <tags>{escape(meta.get('tags', ''))}</tags>
    <category>{escape(meta.get('category', 'Plugins'))}</category>
  </pyqgis_plugin>
</plugins>
'''


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--test", action="store_true", help="эхлээд тестүүдийг ажиллуулна")
    ap.add_argument("--out", default=HERE, help="гаралтын хавтас (анхдагч: энэ хавтас)")
    ap.add_argument("--base-url", default=BASE_URL, help="zip байрлах вэб хаяг")
    args = ap.parse_args(argv)
    if args.test:
        rc = subprocess.call([sys.executable, os.path.join(HERE, "tests", "run_tests.py")])
        if rc:
            print("Тест амжилтгүй — бүтээхгүй.")
            return rc
    meta = metadata()
    os.makedirs(args.out, exist_ok=True)
    z = build_zip(args.out)
    xml_path = os.path.join(args.out, "plugins.xml")
    with open(xml_path, "w", encoding="utf-8") as fh:
        fh.write(plugins_xml(meta, args.base_url))
    print(f"{meta['name']} v{meta['version']}\n  {z}\n  {xml_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
