# -*- coding: utf-8 -*-
"""Газрын зураг бэлтгэгчийн үндсэн цонх: тохиргоо + шууд урьдчилан харах."""
import json
import os

from qgis.PyQt.QtCore import QSize, Qt, QTimer, QUrl
from qgis.PyQt.QtGui import QDesktopServices, QKeySequence
from qgis.PyQt.QtWidgets import (
    QAbstractItemView,
    QApplication,
    QCheckBox,
    QComboBox,
    QDialog,
    QDoubleSpinBox,
    QFileDialog,
    QFontComboBox,
    QFormLayout,
    QGroupBox,
    QHBoxLayout,
    QHeaderView,
    QLabel,
    QLineEdit,
    QListWidget,
    QListWidgetItem,
    QMessageBox,
    QPlainTextEdit,
    QPushButton,
    QScrollArea,
    QShortcut,
    QSizePolicy,
    QSpinBox,
    QSplitter,
    QTabWidget,
    QTableWidget,
    QTableWidgetItem,
    QToolButton,
    QTreeWidget,
    QTreeWidgetItem,
    QVBoxLayout,
    QWidget,
)
from qgis.core import (
    QgsApplication,
    QgsExifTools,
    QgsLayoutExporter,
    QgsLayoutItem,
    QgsLayoutItemMap,
    QgsMapLayerProxyModel,
    QgsPrintLayout,
    QgsProject,
    QgsRectangle,
    QgsSettings,
    QgsStyle,
    QgsSymbolLayerUtils,
)
from qgis.gui import (
    QgsColorButton,
    QgsFieldComboBox,
    QgsLayoutView,
    QgsLayoutViewToolMoveItemContent,
    QgsLayoutViewToolPan,
    QgsLayoutViewToolSelect,
    QgsMapLayerComboBox,
    QgsScaleWidget,
    QgsSymbolSelectorDialog,
)

from . import basemaps, composer, legend_edit
from .analysis_ui import AnalysisMixin
from .extras import ExtrasMixin
from .version import plugin_version

SETTINGS_KEY = "numan_map_maker/last_settings"
PROJECT_SCOPE = "numan_map_maker"
TITLES_KEY = "legend_titles"
ORDER_KEY = "legend_order"
HIDDEN_KEY = "legend_hidden"
SETTINGS_VERSION = 3  # анхдагч утга өөрчлөгдөх бүрд нэмнэ

POSITIONS = [("Зүүн дээд", "TL"), ("Баруун дээд", "TR"),
             ("Зүүн доод", "BL"), ("Баруун доод", "BR")]

GEO_INTERVALS = [
    ("Авто", 0.0), ("10°", 10.0), ("5°", 5.0), ("2°", 2.0), ("1°", 1.0),
    ("30′", 1 / 2), ("20′", 1 / 3), ("15′", 1 / 4), ("10′", 1 / 6), ("5′", 1 / 12),
    ("2′", 1 / 30), ("1′", 1 / 60), ("30″", 1 / 120), ("10″", 1 / 360), ("5″", 1 / 720),
]

EXPORT_FORMATS = [
    ("PNG зураг (*.png)", "png"),
    ("JPEG зураг (*.jpg)", "jpg"),
    ("TIFF зураг (*.tif)", "tif"),
    ("PDF баримт (*.pdf)", "pdf"),
    ("SVG вектор (*.svg)", "svg"),
]


def _combo(pairs):
    cb = QComboBox()
    for text, data in pairs:
        cb.addItem(text, data)
    return cb


def _dspin(lo, hi, step=1.0, decimals=1, suffix=""):
    sp = QDoubleSpinBox()
    sp.setRange(lo, hi)
    sp.setSingleStep(step)
    sp.setDecimals(decimals)
    if suffix:
        sp.setSuffix(suffix)
    return sp


def _spin(lo, hi):
    sp = QSpinBox()
    sp.setRange(lo, hi)
    return sp


class MapMakerDialog(ExtrasMixin, AnalysisMixin, QDialog):
    def __init__(self, iface, parent=None):
        super().__init__(parent)
        self.iface = iface
        self.setWindowTitle(f"Газрын зураг бэлтгэгч — Нуман-Алтай ХХК · v{plugin_version()}")
        self.setWindowFlags(self.windowFlags() | Qt.WindowType.WindowMaximizeButtonHint
                            | Qt.WindowType.WindowMinimizeButtonHint)
        # Дэлгэцэнд багтах хэмжээгээр нээнэ (жижиг дэлгэц, томруулсан Windows-д ч)
        w, h = 1280, 720
        try:
            scr = (parent.screen() if parent is not None else None) or \
                QApplication.primaryScreen()
            avail = scr.availableGeometry()
            w = max(900, min(w, avail.width() - 40))
            h = max(480, min(h, avail.height() - 90))
        except Exception:
            pass
        self.resize(w, h)

        self._bindings = {}     # key -> (getter, setter)
        self._loading = False
        self._building = False
        self._items = {}
        self._snapshot = {}
        self._extent_snapshot = None
        self._overrides = {}
        self._extent_override = None
        self._first_build = True
        self._map_dirty = True        # газрын зургийг шинээр зурах шаардлагатай эсэх
        self._conns = []             # (signal, slot) — shutdown() үед салгана
        self._legend_titles = {}     # layer_id -> таних тэмдэг дэх давхаргын нэр
        self._legend_order = []      # [layer_id] — хэрэглэгчийн тогтоосон дараалал
        self._legend_hidden = []     # [layer_id] — таних тэмдэгт оруулахгүй
        self._style_backup = {}      # layer_id -> анхны renderer (буцаахад)
        self._legend_busy = False    # засвар хийж байх үед жагсаалтыг дахин зурахгүй
        self._legend_dirty = True
        self._legend_cbs = {}
        self._legend_btns = {}

        self.layout_ = QgsPrintLayout(QgsProject.instance())
        self.layout_.initializeDefaults()
        self.layout_.setName("Нуман зураг")

        self._timer = QTimer(self)
        self._timer.setSingleShot(True)
        self._timer.setInterval(450)
        self._timer.timeout.connect(self.rebuild)

        self._legend_timer = QTimer(self)
        self._legend_timer.setSingleShot(True)
        self._legend_timer.setInterval(400)
        self._legend_timer.timeout.connect(self._legend_refresh_if_idle)

        self._build_ui()
        self._apply_settings(self._load_last())
        self._load_titles_from_project()
        self._restore_state()       # энэ төсөлд хадгалсан зураг байвал түүгээр эхэлнэ
        self._connect_project()
        QTimer.singleShot(0, self.rebuild)

    # ------------------------------------------------------------------
    # UI
    # ------------------------------------------------------------------
    def _build_ui(self):
        root = QHBoxLayout(self)
        split = QSplitter(Qt.Orientation.Horizontal)
        root.addWidget(split)

        # ---- Зүүн тал: тохиргоо --------------------------------------
        left = QWidget()
        lv = QVBoxLayout(left)
        lv.setContentsMargins(0, 0, 0, 0)
        self.tabs = QTabWidget()
        self.tabs.setUsesScrollButtons(True)
        self._job_override = None
        self._jobs = []
        tpl_holder = QVBoxLayout()
        lv.addLayout(tpl_holder)
        lv.addWidget(self.tabs, 1)
        self.tabs.addTab(self._scroll(self._tab_page()), "Хуудас")
        self.tabs.addTab(self._scroll(self._tab_map()), "Зураг")
        self.tabs.addTab(self._scroll(self._tab_basemap()), "Суурь зураг")
        self.tabs.addTab(self._scroll(self._tab_elements()), "Элемент")
        self._legend_tab = self.tabs.addTab(self._scroll(self._tab_legend_edit()), "Тэмдэг")
        self.tabs.currentChanged.connect(self._tab_changed)
        self.tabs.addTab(self._scroll(self._tab_table()), "Хүснэгт")
        self.tabs.addTab(self._scroll(self._tab_overlap()), "Давхцал")
        self.tabs.addTab(self._scroll(self._tab_photos()), "Фото")
        self.tabs.addTab(self._scroll(self._tab_extras()), "Нэмэлт")
        self.tabs.addTab(self._scroll(self._tab_batch()), "Цуврал")
        tpl_holder.addLayout(self._template_bar())

        row = QHBoxLayout()
        self.btn_refresh = QPushButton("Шинэчлэх")
        self.btn_refresh.setToolTip("Тохиргооны дагуу зургийг дахин угсарч, газрын зургийг "
                                    "(суурь зураг, давхаргууд) шинээр зурна")
        self.btn_refresh.clicked.connect(lambda _=False: self.rebuild(force=True))
        self.chk_auto = QCheckBox("Автоматаар")
        self.chk_auto.setChecked(True)
        self.chk_auto.setToolTip("Тохиргоо өөрчлөгдөх бүрд урьдчилан харалтыг шинэчилнэ")
        self.btn_reset_pos = QPushButton("Байрлал сэргээх")
        self.btn_reset_pos.setToolTip(
            "Гараар зөөсөн элемент, хамрах хүрээг автомат байрлалд буцаана")
        self.btn_reset_pos.clicked.connect(self.reset_positions)
        row.addWidget(self.btn_refresh)
        row.addWidget(self.chk_auto)
        row.addStretch(1)
        row.addWidget(self.btn_reset_pos)
        lv.addLayout(row)

        row = QHBoxLayout()
        row.addWidget(QLabel("Тохиргоо:"))
        b = QPushButton("Хадгалах…")
        b.setToolTip("Зургийг бүхэлд нь хадгална: тохиргоо, гараар зөөсөн байрлал, "
                     "давхаргууд, ачаалсан хил, давхцлын үр дүн, суурь зураг (QGIS төсөл .qgz)")
        b.clicked.connect(self.save_preset)
        row.addWidget(b)
        b = QPushButton("Ачаалах…")
        b.setToolTip("Хадгалсан зургийг (.qgz) хамгийн сүүлд хадгалсан байдлаар нь нээнэ")
        b.clicked.connect(self.load_preset)
        row.addWidget(b)
        b = QPushButton("Анхных")
        b.setToolTip("Бүх тохиргоог анхны утгад нь буцаана")
        b.clicked.connect(self.restore_defaults)
        row.addWidget(b)
        lv.addLayout(row)
        split.addWidget(left)

        # ---- Баруун тал: урьдчилан харах ------------------------------
        right = QWidget()
        rv = QVBoxLayout(right)
        rv.setContentsMargins(0, 0, 0, 0)

        bar = QHBoxLayout()
        self.view = QgsLayoutView()
        self.view.setCurrentLayout(self.layout_)
        self.tool_select = QgsLayoutViewToolSelect(self.view)
        # Сонгох хэрэгсэл layout-аа мэдэхгүй бол хулгана хөдөлмөгц QGIS унадаг
        # (чирэх бариулууд нь setLayout дотор үүсдэг).
        self.tool_select.setLayout(self.layout_)
        self.tool_pan = QgsLayoutViewToolPan(self.view)
        self.tool_content = QgsLayoutViewToolMoveItemContent(self.view)
        self._tool_buttons = []
        for text, tip, tool in (
                ("Сонгох / зөөх", "Элементийг дарж сонгоод чирж зөөнө, булангаас нь "
                                  "татаж хэмжээг өөрчилнө", self.tool_select),
                ("Гүйлгэх", "Хуудсыг чирж гүйлгэнэ (дунд товч мөн адил)", self.tool_pan),
                ("Зургийн агуулга", "Газрын зургийн хүрээн доторх агуулгыг чирж зөөнө, "
                                    "хулганы дугуйгаар томруулна", self.tool_content)):
            tb = QToolButton()
            tb.setText(text)
            tb.setToolTip(tip)
            tb.setCheckable(True)
            tb.clicked.connect(lambda _=False, t=tool: self._set_tool(t))
            bar.addWidget(tb)
            self._tool_buttons.append((tb, tool))
        tb = QToolButton()
        tb.setText("Бүтэн")
        tb.setToolTip("Хуудсыг бүтнээр нь цонхонд багтааж харуулна")
        tb.clicked.connect(self.view.zoomFull)
        bar.addWidget(tb)
        tb = QToolButton()
        tb.setText("+")
        tb.clicked.connect(self.view.zoomIn)
        bar.addWidget(tb)
        tb = QToolButton()
        tb.setText("−")
        tb.clicked.connect(self.view.zoomOut)
        bar.addWidget(tb)
        tb = QToolButton()
        tb.setText("Устгах")
        tb.setToolTip("Сонгосон элементийг устгана (Delete)")
        tb.clicked.connect(self.view.deleteSelectedItems)
        bar.addWidget(tb)
        bar.addStretch(1)
        b = QPushButton("Тусламж")
        b.setToolTip("Товчлуур, табуудын тайлбар, ажлын дараалал")
        b.clicked.connect(self.show_help)
        bar.addWidget(b)
        b = QPushButton("Designer…")
        b.setToolTip("Зургийг төсөлд хадгалж, QGIS-ийн Layout Designer-т нээж "
                     "нарийвчлан засварлана")
        b.clicked.connect(self.open_in_designer)
        bar.addWidget(b)
        rv.addLayout(bar)
        rv.addWidget(self.view, 1)
        sc = QShortcut(QKeySequence(Qt.Key.Key_Delete), self.view)
        sc.activated.connect(self.view.deleteSelectedItems)
        self._set_tool(self.tool_select)

        ex = QHBoxLayout()
        ex.addWidget(QLabel("Формат:"))
        self.cb_format = _combo(EXPORT_FORMATS)
        for i, (_text, ext_) in enumerate(EXPORT_FORMATS):
            self.cb_format.setItemText(i, ext_.upper())
        ex.addWidget(self.cb_format)
        ex.addWidget(QLabel("Нягтрал:"))
        self.sp_dpi = _spin(72, 1200)
        self.sp_dpi.setValue(300)
        self.sp_dpi.setSuffix(" dpi")
        self.sp_dpi.setSingleStep(50)
        ex.addWidget(self.sp_dpi)
        self.chk_world = QCheckBox("World файл")
        self.chk_world.setToolTip("Зургийг газарзүйн холболттой болгох world файл "
                                  "(.pgw / .jgw / .tfw) хамт үүсгэнэ")
        ex.addWidget(self.chk_world)
        self.lbl_status = QLabel("")
        # Урт мэдэгдэл цонхыг тэлэхгүй: багтахгүй хэсэг нь тайрагдана
        self.lbl_status.setSizePolicy(QSizePolicy.Policy.Ignored, QSizePolicy.Policy.Preferred)
        self.lbl_status.setMinimumWidth(60)
        self.lbl_status.setTextInteractionFlags(Qt.TextInteractionFlag.TextBrowserInteraction)
        self.lbl_status.linkActivated.connect(
            lambda href: QDesktopServices.openUrl(QUrl(href)))
        ex.addWidget(self.lbl_status, 1)
        self.btn_export = QPushButton("Экспортлох…")
        self.btn_export.setDefault(True)
        self.btn_export.clicked.connect(self.export)
        ex.addWidget(self.btn_export)
        self.btn_print = QPushButton("Хэвлэх…")
        self.btn_print.setToolTip("Зургийг хэвлэгч рүү шууд илгээнэ")
        self.btn_print.clicked.connect(self.print_map)
        ex.addWidget(self.btn_print)
        rv.addLayout(ex)
        split.addWidget(right)
        split.setStretchFactor(0, 0)
        split.setStretchFactor(1, 1)
        split.setSizes([430, 930])

    @staticmethod
    def _scroll(widget):
        sa = QScrollArea()
        sa.setWidgetResizable(True)
        sa.setFrameShape(QScrollArea.Shape.NoFrame)
        sa.setWidget(widget)
        return sa

    def _set_tool(self, tool):
        self.view.setTool(tool)
        for tb, t in self._tool_buttons:
            tb.setChecked(t is tool)

    # ---- Таб бүр -------------------------------------------------------
    def _tab_page(self):
        w = QWidget()
        v = QVBoxLayout(w)

        g = QGroupBox("Хуудас")
        f = QFormLayout(g)
        cb = _combo([(k, k) for k in composer.PAGE_SIZES] + [("Өөрөө заах", "custom")])
        self._bind("page_size", cb)
        f.addRow("Хэмжээ:", cb)
        self.cb_page = cb
        cb = _combo([("Хэвтээ", "landscape"), ("Босоо", "portrait")])
        self._bind("orientation", cb)
        f.addRow("Чиглэл:", cb)
        self.cb_orient = cb
        h = QHBoxLayout()
        self.sp_pw = _dspin(50, 3000, 10, 0, " мм")
        self.sp_ph = _dspin(50, 3000, 10, 0, " мм")
        self._bind("page_w", self.sp_pw)
        self._bind("page_h", self.sp_ph)
        h.addWidget(self.sp_pw)
        h.addWidget(QLabel("×"))
        h.addWidget(self.sp_ph)
        f.addRow("Өргөн × өндөр:", h)
        self.cb_page.currentIndexChanged.connect(self._update_enabled)
        sp = _dspin(0, 60, 1, 1, " мм")
        self._bind("margin", sp)
        f.addRow("Захын зай:", sp)
        fc = QFontComboBox()
        self._bind("font", fc)
        f.addRow("Фонт:", fc)
        ch = QCheckBox("Зургийг хүрээлэх шугам")
        self._bind("map_frame", ch)
        f.addRow(ch)
        v.addWidget(g)

        g = QGroupBox("Гарчиг")
        f = QFormLayout(g)
        te = QPlainTextEdit()
        te.setFixedHeight(64)
        te.setPlaceholderText("Жишээ: ХӨВСГӨЛ НУУР – ЭГИЙН ГОЛЫН САВ ГАЗРЫН\n"
                              "ГАЗАР АШИГЛАЛТЫН ӨӨРЧЛӨЛТ")
        self._bind("title", te)
        f.addRow("Гарчиг:", te)
        le = QLineEdit()
        le.setPlaceholderText("Жишээ: (2001 болон 2024 он, харьцуулалт)")
        self._bind("subtitle", le)
        f.addRow("Дэд гарчиг:", le)
        h = QHBoxLayout()
        sp = _dspin(6, 96, 1, 1, " pt")
        self._bind("title_size", sp)
        h.addWidget(sp)
        cbtn = QgsColorButton()
        self._bind("title_color", cbtn)
        h.addWidget(cbtn)
        f.addRow("Хэмжээ, өнгө:", h)
        cb = _combo([("Зургийн дээр (гадна)", "outside"), ("Зураг дотор, дээд талд", "inside")])
        self._bind("title_place", cb)
        f.addRow("Байрлал:", cb)
        v.addWidget(g)

        g = QGroupBox("Тайлбар бичвэр")
        f = QFormLayout(g)
        le = QLineEdit()
        le.setPlaceholderText("Жишээ: Зураг 1.66. Сав газрын газар ашиглалт…")
        self._bind("caption", le)
        f.addRow("Зургийн доор:", le)
        sp = _dspin(5, 48, 1, 1, " pt")
        self._bind("caption_size", sp)
        f.addRow("Хэмжээ:", sp)
        self._caption_number_rows(f)
        le = QLineEdit()
        le.setPlaceholderText("Жишээ: Эх сурвалж: Esri, Sentinel-2, НУМАН-АЛТАЙ ХХК")
        self._bind("credits", le)
        f.addRow("Эх сурвалж:", le)
        v.addWidget(g)
        v.addStretch(1)
        return w

    def _tab_map(self):
        w = QWidget()
        v = QVBoxLayout(w)

        g = QGroupBox("Хамрах хүрээ")
        f = QFormLayout(g)
        cb = _combo([("QGIS-ийн үндсэн цонхны харагдац", "canvas"),
                     ("Харагдаж буй бүх давхарга", "visible"),
                     ("Сонгосон давхарга", "layer")])
        self._bind("extent_mode", cb, clears_extent=True)
        self.cb_extent = cb
        cb.currentIndexChanged.connect(self._update_enabled)
        f.addRow("Хүрээ:", cb)
        lc = QgsMapLayerComboBox()
        self._bind("extent_layer", lc, clears_extent=True)
        self.lc_extent = lc
        f.addRow("Давхарга:", lc)
        sp = _dspin(0, 100, 1, 1, " %")
        self._bind("extent_buffer", sp, clears_extent=True)
        self.sp_buffer = sp
        f.addRow("Захын нөөц:", sp)
        cb = _combo([("Хүрээнд тааруулах", "auto"),
                     ("Бүхэл тоо руу дугуйлах", "round"),
                     ("Тогтмол масштаб", "fixed")])
        self._bind("scale_mode", cb, clears_extent=True)
        self.cb_scale = cb
        cb.currentIndexChanged.connect(self._update_enabled)
        f.addRow("Масштаб:", cb)
        sw = QgsScaleWidget()
        sw.setShowCurrentScaleButton(False)
        self._bind("scale", sw, clears_extent=True)
        self.sw_scale = sw
        f.addRow("1 : N", sw)
        self.lbl_scale = QLabel("")
        f.addRow("Одоогийн:", self.lbl_scale)
        v.addWidget(g)

        g = QGroupBox("Солбицлын тор")
        g.setCheckable(True)
        self._bind("grid", g)
        f = QFormLayout(g)
        cb = _combo([("Газарзүйн (градус, минут, секунд)", "geo"),
                     ("Зургийн проекц (метр)", "map")])
        self._bind("grid_crs", cb)
        self.cb_grid_crs = cb
        cb.currentIndexChanged.connect(self._update_enabled)
        f.addRow("Солбицол:", cb)
        cb = _combo(GEO_INTERVALS)
        self._bind("grid_interval_geo", cb)
        self.cb_grid_geo = cb
        f.addRow("Алхам (градус):", cb)
        sp = _dspin(0, 1e7, 1000, 0, " м")
        sp.setSpecialValueText("Авто")
        self._bind("grid_interval_map", sp)
        self.sp_grid_map = sp
        f.addRow("Алхам (метр):", sp)
        cb = _combo([("Зөвхөн хүрээ, тоо", "frame"), ("Загалмай", "cross"), ("Шугам", "lines")])
        self._bind("grid_style", cb)
        f.addRow("Торны хэлбэр:", cb)
        cb = _combo([("Зураас", "ticks"), ("Алаг хүрээ (зебра)", "zebra"), ("Энгийн шугам", "line")])
        self._bind("grid_frame", cb)
        f.addRow("Хүрээний хэлбэр:", cb)
        ch = QCheckBox("Солбицлын тоо бичих")
        self._bind("grid_labels", ch)
        f.addRow(ch)
        sp = _dspin(4, 30, 0.5, 1, " pt")
        self._bind("grid_font_size", sp)
        f.addRow("Тооны хэмжээ:", sp)
        v.addWidget(g)
        v.addStretch(1)
        return w

    def _tab_basemap(self):
        w = QWidget()
        v = QVBoxLayout(w)

        g = QGroupBox("Суурь зураг (фон)")
        f = QFormLayout(g)
        cb = QComboBox()
        cb.addItem("Суурь зураггүй", "")
        cb.addItem("Офлайн файл (OsmAnd .sqlitedb, .mbtiles)", basemaps.FILE_KEY)
        group = None
        for key, (name, grp, _url, _z, _a) in basemaps.BASEMAPS.items():
            if grp != group:
                group = grp
                cb.insertSeparator(cb.count())
            cb.addItem(name, key)
        cb.setMaxVisibleItems(30)
        self._bind("basemap", cb)
        self.cb_basemap = cb
        cb.currentIndexChanged.connect(self._update_enabled)
        f.addRow("Фон:", cb)
        h = QHBoxLayout()
        le = QLineEdit()
        le.setPlaceholderText("OsmAnd-ийн .sqlitedb эсвэл .mbtiles файл")
        le.setReadOnly(True)
        self._bind("basemap_file", le)
        self.le_basemap_file = le
        h.addWidget(le, 1)
        b = QPushButton("…")
        b.setFixedWidth(32)
        b.setToolTip("Офлайн зургийн сангийн файл сонгох")
        b.clicked.connect(self._pick_basemap_file)
        self.btn_basemap_file = b
        h.addWidget(b)
        f.addRow("Офлайн файл:", h)
        le = QLineEdit()
        le.setPlaceholderText("pk.… (mapbox.com дээрх өөрийн access token)")
        self._bind("mapbox_token", le)
        self.le_token = le
        f.addRow("Mapbox token:", le)
        self.lbl_token = QLabel("Mapbox-ын зураг харуулахын тулд access token оруулна уу.")
        self.lbl_token.setWordWrap(True)
        self.lbl_token.setStyleSheet("color:#b00")
        f.addRow(self.lbl_token)
        v.addWidget(g)

        g = QGroupBox("Overlay давхарга")
        gv = QVBoxLayout(g)
        lw = QListWidget()
        for key, (name, _url, _z, _a) in basemaps.OVERLAYS.items():
            it = QListWidgetItem(name)
            it.setData(Qt.ItemDataRole.UserRole, key)
            it.setFlags(it.flags() | Qt.ItemFlag.ItemIsUserCheckable)
            it.setCheckState(Qt.CheckState.Unchecked)
            lw.addItem(it)
        lw.setFixedHeight(lw.sizeHintForRow(0) * lw.count() + 8)
        lw.itemChanged.connect(self._changed)
        self.lw_overlays = lw
        self._bindings["overlays"] = (self._get_overlays, self._set_overlays)
        gv.addWidget(lw)
        ch = QCheckBox("Overlay-г миний давхаргуудын дээр гаргах")
        ch.setToolTip("Сонгоогүй бол overlay нь суурь зургийн яг дээр, таны "
                      "давхаргуудын доор байрлана.")
        self._bind("overlays_on_top", ch)
        gv.addWidget(ch)
        v.addWidget(g)

        ch = QCheckBox("Эх сурвалжийн бичвэрийг зурагт автоматаар нэмэх")
        ch.setToolTip("«Хуудас» табын «Эх сурвалж» хоосон бол сонгосон суурь "
                      "зургийн зохиогчийн эрхийн бичвэрийг зургийн буланд бичнэ.")
        self._bind("basemap_credit", ch)
        v.addWidget(ch)
        note = QLabel(
            "Сонгосон зураг төслийн давхаргын жагсаалтад «плагины» давхарга болж "
            "нэмэгдэх бөгөөд сонголтоо солиход автоматаар солигдоно. Интернэт "
            "холболт шаардана. Үйлчилгээ тус бүр өөрийн ашиглалтын нөхцөлтэй тул "
            "хэвлэн нийтлэхдээ эх сурвалжийг заавал дурдана уу.")
        note.setWordWrap(True)
        v.addWidget(note)
        v.addStretch(1)
        return w

    def _pick_basemap_file(self):
        """Офлайн зургийн сан сонгоно. .sqlitedb бол хөрвүүлсэн файлыг хаана хадгалахыг
        асууж, нэг удаа хөрвүүлээд, цаашид тэр бэлэн файлыг шууд уншина."""
        from . import osmand
        st = QgsSettings()
        start = os.path.dirname(self.le_basemap_file.text()) or \
            st.value("numan_map_maker/offline_dir", "") or os.path.expanduser("~")
        path, _ = QFileDialog.getOpenFileName(self, "Офлайн зургийн сан сонгох", start,
                                              osmand.FILE_FILTER)
        if not path:
            return
        st.setValue("numan_map_maker/offline_dir", os.path.dirname(path))
        ready = self._offline_ready_file(path)
        if not ready:
            return
        self._loading = True
        try:
            # Тохиргоонд бэлэн .mbtiles-ийн замыг хадгална: дараа нь хөрвүүлэлтгүй нээгдэнэ
            self._bindings["basemap_file"][1](ready)
            self._bindings["basemap"][1](basemaps.FILE_KEY)
        finally:
            self._loading = False
        self._update_enabled()
        self.rebuild()

    def _offline_ready_file(self, path):
        """QGIS-д уншигдах (.mbtiles) файлын замыг буцаана; болиулсан / амжилтгүй бол ''."""
        from . import osmand
        try:
            ready = osmand.known(path)
        except Exception:
            ready = ""
        if ready:
            if ready != path:
                self.lbl_status.setText(
                    f"Өмнө хөрвүүлсэн бэлэн файлыг ашиглалаа: {os.path.basename(ready)}")
            return ready

        default = osmand.default_output(path)
        if os.path.isfile(default) and os.path.getsize(default) > 0:
            ans = QMessageBox.question(
                self, "Офлайн зураг",
                f"Эх файлын хажууд «{os.path.basename(default)}» нэртэй хөрвүүлсэн файл "
                "байна.\n\nТүүнийг дахин хөрвүүлэлгүй шууд ашиглах уу?",
                QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
                QMessageBox.StandardButton.Yes)
            if ans == QMessageBox.StandardButton.Yes:
                osmand.remember(path, default)
                return default

        out, _ = QFileDialog.getSaveFileName(
            self, "Хөрвүүлсэн файлыг хаана хадгалах вэ?", default, "MBTiles (*.mbtiles)")
        if not out:
            return ""
        if not out.lower().endswith(".mbtiles"):
            out += ".mbtiles"
        return self._prepare_offline(path, out)

    def _prepare_offline(self, path, out):
        """path-ийг out руу хөрвүүлнэ (явцын цонхтой). Амжилттай бол out, эс бөгөөс ''."""
        from qgis.PyQt.QtWidgets import QProgressDialog
        from . import osmand
        prog = QProgressDialog("Офлайн зургийн санг QGIS-д уншигдах хэлбэрт нэг удаа "
                               "хөрвүүлж байна…", "Зогсоох", 0, 100, self)
        prog.setWindowModality(Qt.WindowModality.WindowModal)
        prog.setMinimumDuration(0)
        prog.setValue(0)

        def step(done, total):
            prog.setValue(int(done * 100 / max(1, total)))
            QApplication.processEvents()
            return not prog.wasCanceled()

        try:
            ready = osmand.to_mbtiles(path, step, out)
        except osmand.OsmandError as e:
            prog.close()
            QMessageBox.warning(self, "Офлайн зураг", str(e))
            return ""
        except Exception as e:
            prog.close()
            QMessageBox.warning(
                self, "Офлайн зураг",
                f"Хөрвүүлж чадсангүй:\n{e}\n\nХадгалах хавтсанд бичих эрх, дискний "
                "сул зай байгаа эсэхийг шалгана уу.")
            return ""
        prog.setValue(100)
        self.lbl_status.setText(f"Хөрвүүлж хадгаллаа: {ready}")
        return ready

    def _get_overlays(self):
        lw = self.lw_overlays
        return [lw.item(i).data(Qt.ItemDataRole.UserRole) for i in range(lw.count())
                if lw.item(i).checkState() == Qt.CheckState.Checked]

    def _set_overlays(self, keys):
        keys = set(keys or [])
        lw = self.lw_overlays
        lw.blockSignals(True)
        for i in range(lw.count()):
            it = lw.item(i)
            it.setCheckState(Qt.CheckState.Checked if it.data(Qt.ItemDataRole.UserRole) in keys
                             else Qt.CheckState.Unchecked)
        lw.blockSignals(False)

    def _tab_elements(self):
        w = QWidget()
        v = QVBoxLayout(w)

        g = QGroupBox("Таних тэмдэг")
        g.setCheckable(True)
        self._bind("legend", g)
        f = QFormLayout(g)
        le = QLineEdit()
        self._bind("legend_title", le)
        f.addRow("Гарчиг:", le)
        cb = _combo(POSITIONS + [("Зургийн гадна, баруун талд", "OUT")])
        self._bind("legend_pos", cb)
        f.addRow("Байрлал:", cb)
        sp = _dspin(30, 200, 5, 0, " мм")
        self._bind("legend_out_width", sp)
        f.addRow("Гаднах өргөн:", sp)
        sp = _spin(1, 6)
        self._bind("legend_cols", sp)
        f.addRow("Баганын тоо:", sp)
        sp = _dspin(4, 30, 0.5, 1, " pt")
        self._bind("legend_font_size", sp)
        f.addRow("Бичгийн хэмжээ:", sp)
        ch = QCheckBox("Зөвхөн зурагт харагдаж буй тэмдгийг оруулах")
        self._bind("legend_filter", ch)
        f.addRow(ch)
        ch = QCheckBox("KML-ийн шугам, дүрсийн загварыг таних тэмдэгт гаргах")
        ch.setToolTip("KML-ээс импортолсон давхарга загвараа объект бүртээ агуулдаг тул QGIS "
                      "түүнд таних тэмдгийн дүрс үүсгэдэггүй. Чагттай бол загварыг нь ижил "
                      "харагдах энгийн загвар руу хөрвүүлнэ («Тэмдэг» табаас буцааж болно).")
        self._bind("legend_kml", ch)
        f.addRow(ch)
        ch = QCheckBox("Онлайн суурь зургийг (XYZ / WMS) хасах")
        self._bind("legend_skip_basemap", ch)
        f.addRow(ch)
        ch = QCheckBox("Цагаан дэвсгэр, хүрээтэй")
        self._bind("legend_bg", ch)
        f.addRow(ch)
        v.addWidget(g)

        g = QGroupBox("Хойд зүгийн сум")
        g.setCheckable(True)
        self._bind("north", g)
        f = QFormLayout(g)
        cb = _combo(POSITIONS)
        self._bind("north_pos", cb)
        f.addRow("Байрлал:", cb)
        sp = _dspin(5, 80, 1, 0, " мм")
        self._bind("north_size", sp)
        f.addRow("Хэмжээ:", sp)
        cb = _combo(self._north_arrows())
        self._bind("north_svg", cb)
        f.addRow("Загвар:", cb)
        v.addWidget(g)

        g = QGroupBox("Масштабын шугам")
        g.setCheckable(True)
        self._bind("scalebar", g)
        f = QFormLayout(g)
        cb = _combo(POSITIONS)
        self._bind("scalebar_pos", cb)
        f.addRow("Байрлал:", cb)
        cb = _combo([("Хайрцаг", "Single Box"), ("Давхар хайрцаг", "Double Box"),
                     ("Зураас (дээш)", "Line Ticks Up"), ("Зураас (дунд)", "Line Ticks Middle"),
                     ("Шатлал", "stepped")])
        self._bind("scalebar_style", cb)
        f.addRow("Загвар:", cb)
        sp = _spin(1, 10)
        self._bind("scalebar_segments", sp)
        f.addRow("Хэсгийн тоо:", sp)
        v.addWidget(g)

        ch = QCheckBox("Тоон масштаб бичих (1:N)")
        self._bind("scale_text", ch)
        v.addWidget(ch)
        v.addStretch(1)
        return w

    def _tab_legend_edit(self):
        w = QWidget()
        v = QVBoxLayout(w)
        note = QLabel(
            "Таних тэмдгийн нэр, өнгө, дүрсийг эндээс засна. Засвар нь давхаргын "
            "загварт шууд хэрэгжих тул газрын зураг дээрх өнгө, дүрс болон таних "
            "тэмдэг хамт өөрчлөгдөнө (QGIS-ийн үндсэн цонхонд ч мөн адил). "
            "Нэр дээр давхар товшиж бичнэ. Давхаргыг сонгоод ▲ ▼ товчоор таних "
            "тэмдэг дэх дарааллыг солино. Давхарга эсвэл ангиллын чагтыг авбал тэр нь "
            "таних тэмдгээс ч, газрын зураг дээрээс ч хасагдана.")
        note.setWordWrap(True)
        v.addWidget(note)
        t = QTreeWidget()
        t.setColumnCount(3)
        t.setHeaderLabels(["Нэр", "Өнгө", "Дүрс"])
        t.setRootIsDecorated(True)
        t.setUniformRowHeights(False)
        t.setEditTriggers(QAbstractItemView.EditTrigger.DoubleClicked
                          | QAbstractItemView.EditTrigger.EditKeyPressed)
        hd = t.header()
        hd.setSectionResizeMode(0, QHeaderView.ResizeMode.Stretch)
        hd.setSectionResizeMode(1, QHeaderView.ResizeMode.ResizeToContents)
        hd.setSectionResizeMode(2, QHeaderView.ResizeMode.ResizeToContents)
        t.itemChanged.connect(self._legend_item_edited)
        self.tree_legend = t
        t.setMinimumHeight(170)
        v.addWidget(t, 1)
        h = QHBoxLayout()
        h.addWidget(QLabel("Дараалал:"))
        for text, tip, step in (("▲ Дээш", "Сонгосон давхаргыг таних тэмдэгт дээшлүүлнэ", -1),
                                ("▼ Доош", "Сонгосон давхаргыг таних тэмдэгт доошлуулна", 1)):
            b = QPushButton(text)
            b.setToolTip(tip)
            b.clicked.connect(lambda _=False, st=step: self._legend_move(st))
            h.addWidget(b)
        b = QPushButton("Анхны дараалал")
        b.setToolTip("Давхаргын самбарын дараалал, бүлгүүд рүү буцаана")
        b.clicked.connect(self._legend_reset_order)
        h.addWidget(b)
        h.addStretch(1)
        v.addLayout(h)
        v.addLayout(self._style_buttons())
        h = QHBoxLayout()
        b = QPushButton("Жагсаалт шинэчлэх")
        b.clicked.connect(lambda: self._refresh_legend_editor(force=True))
        h.addWidget(b)
        b = QPushButton("Сонгосныг анхных руу")
        b.setToolTip("Сонгосон давхаргын загвар, нэрийг засахаас өмнөх байдалд нь буцаана")
        b.clicked.connect(self._legend_revert_selected)
        h.addWidget(b)
        b = QPushButton("Бүгдийг анхных руу")
        b.clicked.connect(self._legend_revert_all)
        h.addWidget(b)
        v.addLayout(h)
        warn = QLabel("Анхаар: засвар нь төслийн давхаргын загварыг өөрчилдөг тул төслөө "
                      "хадгалбал хамт хадгалагдана.")
        warn.setWordWrap(True)
        warn.setStyleSheet("color:#666")
        v.addWidget(warn)
        return w

    # ---- Таних тэмдэг засварлагч ---------------------------------------
    def _tab_changed(self, idx):
        if self.tabs.tabText(idx) == "Нэмэлт":
            self._cache_refresh()       # хөрвүүлэлтийн дараах хэмжээг шинээр харуулна
        if idx == self._legend_tab:
            self._refresh_legend_editor()

    def _legend_mark_dirty(self, *_):
        self._legend_dirty = True
        if self.isVisible() and self.tabs.currentIndex() == self._legend_tab:
            self._legend_timer.start()

    def _legend_refresh_if_idle(self):
        if self._legend_busy:
            self._legend_timer.start()  # засвар дуустал хүлээнэ
        elif self._legend_dirty:
            self._refresh_legend_editor()

    @staticmethod
    def _exec(dlg):
        return (dlg.exec if hasattr(dlg, "exec") else dlg.exec_)()

    def _refresh_legend_editor(self, force=False):
        if self._legend_busy:
            return
        if not (force or self._legend_dirty):
            return
        self._legend_dirty = False
        t = self.tree_legend
        self._legend_busy = True
        t.blockSignals(True)
        try:
            t.clear()
            self._legend_cbs = {}
            self._legend_btns = {}
            skip = bool(self._bindings["legend_skip_basemap"][0]())
            for lyr in self._legend_layers(skip):
                lid = lyr.id()
                kind = legend_edit.renderer_kind(lyr)
                top = QTreeWidgetItem([self._legend_titles.get(lid) or lyr.name(), "", ""])
                top.setFlags(top.flags() | Qt.ItemFlag.ItemIsEditable
                             | Qt.ItemFlag.ItemIsUserCheckable)
                top.setCheckState(0, Qt.CheckState.Unchecked if lid in self._legend_hidden
                                  else Qt.CheckState.Checked)
                top.setData(0, Qt.ItemDataRole.UserRole, ["layer", lid, 0])
                top.setToolTip(0, f"Давхарга: {lyr.name()}")
                t.addTopLevelItem(top)
                entries = legend_edit.list_entries(lyr)
                if kind == legend_edit.SINGLE and entries:
                    self._legend_widgets(top, lid, 0, entries[0].symbol)
                else:
                    for e in entries:
                        child = QTreeWidgetItem([e.label, "", ""])
                        child.setFlags(child.flags() | Qt.ItemFlag.ItemIsEditable
                                       | Qt.ItemFlag.ItemIsUserCheckable)
                        child.setCheckState(0, Qt.CheckState.Checked if e.active
                                            else Qt.CheckState.Unchecked)
                        child.setData(0, Qt.ItemDataRole.UserRole, ["entry", lid, e.key])
                        top.addChild(child)
                        self._legend_widgets(child, lid, e.key, e.symbol)
                    if kind == legend_edit.OTHER:
                        top.setToolTip(0, "Энэ төрлийн загварыг QGIS-ийн Layer Styling "
                                          "самбараас засна")
                top.setExpanded(True)
        finally:
            t.blockSignals(False)
            self._legend_busy = False

    def _legend_widgets(self, item, lid, key, symbol):
        if symbol is None:
            return
        t = self.tree_legend
        cb = QgsColorButton()
        cb.setAllowOpacity(True)
        cb.setColor(symbol.color())
        cb.colorChanged.connect(
            lambda c, lid=lid, key=key: self._legend_color(lid, key, c))
        t.setItemWidget(item, 1, cb)
        btn = QToolButton()
        btn.setText("Өөрчлөх…")
        btn.setIconSize(QSize(28, 16))
        btn.setIcon(QgsSymbolLayerUtils.symbolPreviewIcon(symbol, QSize(28, 16)))
        btn.setToolButtonStyle(Qt.ToolButtonStyle.ToolButtonTextBesideIcon)
        btn.clicked.connect(lambda _=False, lid=lid, key=key: self._legend_symbol(lid, key))
        t.setItemWidget(item, 2, btn)
        self._legend_cbs[(lid, str(key))] = cb
        self._legend_btns[(lid, str(key))] = btn

    def _legend_sync_widgets(self, lid, key, symbol):
        """Засварын дараа өнгө, дүрсийн урьдчилсан харалтыг шинэчилнэ."""
        cb = self._legend_cbs.get((lid, str(key)))
        btn = self._legend_btns.get((lid, str(key)))
        try:
            if cb is not None:
                cb.blockSignals(True)
                cb.setColor(symbol.color())
                cb.blockSignals(False)
            if btn is not None:
                btn.setIcon(QgsSymbolLayerUtils.symbolPreviewIcon(symbol, QSize(28, 16)))
        except RuntimeError:
            pass

    def _legend_entry_symbol(self, layer, key):
        for e in legend_edit.list_entries(layer):
            if str(e.key) == str(key):
                return e.key, e.symbol
        return None, None

    def _legend_color(self, lid, key, color):
        layer = QgsProject.instance().mapLayer(lid)
        if layer is None:
            return
        real_key, _sym = self._legend_entry_symbol(layer, key)
        if real_key is None:
            return
        legend_edit.backup_renderer(self._style_backup, layer)
        if legend_edit.apply_color(layer, real_key, color):
            _k, sym = self._legend_entry_symbol(layer, key)
            if sym is not None:
                btn = self._legend_btns.get((lid, str(key)))
                if btn is not None:
                    btn.setIcon(QgsSymbolLayerUtils.symbolPreviewIcon(sym, QSize(28, 16)))
            self._changed()

    def _legend_symbol(self, lid, key):
        layer = QgsProject.instance().mapLayer(lid)
        if layer is None:
            return
        real_key, sym = self._legend_entry_symbol(layer, key)
        if sym is None:
            return
        self._legend_busy = True
        try:
            dlg = QgsSymbolSelectorDialog(sym, QgsStyle.defaultStyle(), layer, self)
            accepted = self._exec(dlg)
        finally:
            self._legend_busy = False
        if not accepted:
            return
        legend_edit.backup_renderer(self._style_backup, layer)
        if legend_edit.apply_entry(layer, real_key, symbol=sym):
            self._legend_sync_widgets(lid, key, sym)
            self._changed()

    def _legend_item_edited(self, item, col):
        if self._legend_busy or col != 0:
            return
        data = item.data(0, Qt.ItemDataRole.UserRole)
        if not data:
            return
        what, lid, key = data[0], data[1], data[2]
        layer = QgsProject.instance().mapLayer(lid)
        if layer is None:
            return
        text = item.text(0).strip()
        if what == "layer":
            shown = item.checkState(0) != Qt.CheckState.Unchecked
            if shown and lid in self._legend_hidden:
                self._legend_hidden.remove(lid)
            elif not shown and lid not in self._legend_hidden:
                self._legend_hidden.append(lid)
            if text and text != layer.name():
                self._legend_titles[lid] = text
            else:
                self._legend_titles.pop(lid, None)
            self._save_titles_to_project()
        else:
            real_key, _sym = self._legend_entry_symbol(layer, key)
            if real_key is None:
                return
            legend_edit.backup_renderer(self._style_backup, layer)
            entry = next((e for e in legend_edit.list_entries(layer)
                          if str(e.key) == str(key)), None)
            shown = item.checkState(0) != Qt.CheckState.Unchecked
            if entry is not None and entry.active != shown:
                # Чагтыг авсан ангилал зураг дээр ч, таних тэмдэгт ч харагдахгүй
                legend_edit.set_entry_active(layer, real_key, shown)
            if entry is None or entry.label != item.text(0):
                legend_edit.apply_entry(layer, real_key, label=item.text(0))
            self._map_dirty = True
        self._changed()

    def _legend_layers(self, skip_basemap=True):
        """Таних тэмдэгт орох давхаргууд — хэрэглэгчийн дарааллаар."""
        lyrs = legend_edit.editable_layers(QgsProject.instance(), skip_basemap)
        if self._legend_order:
            rank = {lid: i for i, lid in enumerate(self._legend_order)}
            lyrs.sort(key=lambda l: rank.get(l.id(), len(rank)))
        return lyrs

    def _legend_move(self, step):
        ids = self._legend_selected_layer_ids()
        if not ids:
            self.lbl_status.setText("Эхлээд жагсаалтаас давхаргаа сонгоно уу.")
            return
        skip = bool(self._bindings["legend_skip_basemap"][0]())
        order = [l.id() for l in self._legend_layers(skip)]
        moving = [i for i in order if i in ids]
        seq = moving if step < 0 else list(reversed(moving))
        for lid in seq:
            i = order.index(lid)
            j = i + step
            if 0 <= j < len(order) and order[j] not in ids:
                order[i], order[j] = order[j], order[i]
        self._legend_order = order
        self._save_titles_to_project()
        self._refresh_legend_editor(force=True)
        self._legend_select(ids)
        self._changed()

    def _legend_reset_order(self):
        self._legend_order = []
        self._save_titles_to_project()
        self._refresh_legend_editor(force=True)
        self._changed()

    def _legend_select(self, ids):
        t = self.tree_legend
        for i in range(t.topLevelItemCount()):
            it = t.topLevelItem(i)
            data = it.data(0, Qt.ItemDataRole.UserRole)
            if data and data[1] in ids:
                it.setSelected(True)
                t.setCurrentItem(it)

    def _legend_selected_layer_ids(self):
        ids = []
        for it in self.tree_legend.selectedItems():
            top = it.parent() or it
            data = top.data(0, Qt.ItemDataRole.UserRole)
            if data and data[1] not in ids:
                ids.append(data[1])
        return ids

    def _legend_revert(self, ids):
        prj = QgsProject.instance()
        for lid in ids:
            layer = prj.mapLayer(lid)
            if layer is not None:
                legend_edit.restore_renderer(self._style_backup, layer)
            self._legend_titles.pop(lid, None)
        self._save_titles_to_project()
        self._refresh_legend_editor(force=True)
        self._changed()

    def _legend_revert_selected(self):
        self._legend_revert(self._legend_selected_layer_ids())

    def _legend_revert_all(self):
        self._legend_revert(list(set(self._style_backup) | set(self._legend_titles)))

    def _save_titles_to_project(self):
        prj = QgsProject.instance()
        prj.writeEntry(PROJECT_SCOPE, TITLES_KEY,
                       json.dumps(self._legend_titles, ensure_ascii=False))
        prj.writeEntry(PROJECT_SCOPE, ORDER_KEY, json.dumps(self._legend_order))
        prj.writeEntry(PROJECT_SCOPE, HIDDEN_KEY, json.dumps(self._legend_hidden))
        prj.setDirty(True)

    def _load_titles_from_project(self):
        raw, ok = QgsProject.instance().readEntry(PROJECT_SCOPE, TITLES_KEY, "")
        try:
            d = json.loads(raw) if ok and raw else {}
            self._legend_titles = d if isinstance(d, dict) else {}
        except ValueError:
            self._legend_titles = {}
        for key, attr in ((ORDER_KEY, "_legend_order"), (HIDDEN_KEY, "_legend_hidden")):
            raw, ok = QgsProject.instance().readEntry(PROJECT_SCOPE, key, "")
            try:
                d = json.loads(raw) if ok and raw else []
                setattr(self, attr, [str(x) for x in d] if isinstance(d, list) else [])
            except ValueError:
                setattr(self, attr, [])
        self._legend_dirty = True

    def _set_legend_list(self, attr, v):
        setattr(self, attr, [str(x) for x in v] if isinstance(v, list) else [])
        self._legend_mark_dirty()

    def _set_legend_titles(self, v):
        self._legend_titles = dict(v) if isinstance(v, dict) else {}
        self._legend_mark_dirty()

    def _tab_table(self):
        w = QWidget()
        v = QVBoxLayout(w)
        g = QGroupBox("Талбайн хүснэгт")
        g.setCheckable(True)
        self._bind("table", g)
        f = QFormLayout(g)
        lc = QgsMapLayerComboBox()
        lc.setFilters(QgsMapLayerProxyModel.PolygonLayer)
        self._bind("table_layer", lc)
        f.addRow("Полигон давхарга:", lc)
        fc = QgsFieldComboBox()
        fc.setAllowEmptyFieldName(True)
        fc.setLayer(lc.currentLayer())
        lc.layerChanged.connect(fc.setLayer)
        self._bind("table_field", fc)
        f.addRow("Ангилах талбар:", fc)
        note = QLabel("Талбар сонгоогүй бол давхаргын ангилсан загварын (Categorized) "
                      "ангилал, өнгийг ашиглана.")
        note.setWordWrap(True)
        f.addRow(note)
        cb = _combo([("км²", "km2"), ("га", "ha"), ("м²", "m2")])
        self._bind("table_unit", cb)
        f.addRow("Нэгж:", cb)
        sp = _spin(0, 6)
        self._bind("table_decimals", sp)
        f.addRow("Бутархай орон:", sp)
        le = QLineEdit()
        self._bind("table_head1", le)
        f.addRow("1-р баганын нэр:", le)
        le = QLineEdit()
        le.setPlaceholderText("Хоосон бол: Талбай, <нэгж>")
        self._bind("table_head2", le)
        f.addRow("2-р баганын нэр:", le)
        ch = QCheckBox("«Нийт» мөр нэмэх")
        self._bind("table_total", ch)
        f.addRow(ch)
        ch = QCheckBox("«Хувь, %» багана нэмэх")
        self._bind("table_percent", ch)
        f.addRow(ch)
        cb = _combo(POSITIONS)
        self._bind("table_pos", cb)
        f.addRow("Байрлал:", cb)
        sp = _dspin(4, 30, 0.5, 1, " pt")
        self._bind("table_font_size", sp)
        f.addRow("Бичгийн хэмжээ:", sp)
        v.addWidget(g)
        v.addWidget(self._table_export_button())
        note = QLabel("Талбайг төслийн эллипсоид (тохируулаагүй бол WGS84) дээр "
                      "тооцоолно.")
        note.setWordWrap(True)
        v.addWidget(note)
        v.addStretch(1)
        return w

    def _tab_photos(self):
        w = QWidget()
        v = QVBoxLayout(w)
        note = QLabel("Газар дээр авсан фото зургийг газрын зурагт байрлуулж, авсан "
                      "цэг рүү нь шугам татна. GPS-тэй зургийн солбицлыг автоматаар уншина.")
        note.setWordWrap(True)
        v.addWidget(note)
        t = QTableWidget(0, 5)
        t.setHorizontalHeaderLabels(["Файл", "Уртраг", "Өргөрөг", "Байрлал", "Өргөн, мм"])
        t.horizontalHeader().setSectionResizeMode(0, QHeaderView.ResizeMode.Stretch)
        t.setSelectionBehavior(QAbstractItemView.SelectionBehavior.SelectRows)
        t.verticalHeader().setVisible(False)
        t.itemChanged.connect(self._changed)
        self.tbl_photos = t
        v.addWidget(t, 1)
        h = QHBoxLayout()
        b = QPushButton("Зураг нэмэх…")
        b.clicked.connect(self._add_photos)
        h.addWidget(b)
        b = QPushButton("Хасах")
        b.clicked.connect(self._remove_photo)
        h.addWidget(b)
        h.addStretch(1)
        v.addLayout(h)
        f = QFormLayout()
        ch = QCheckBox("Цэг рүү шугам татах")
        self._bind("photo_lines", ch)
        cbtn = QgsColorButton()
        self._bind("photo_line_color", cbtn)
        hh = QHBoxLayout()
        hh.addWidget(ch)
        hh.addWidget(cbtn)
        hh.addStretch(1)
        f.addRow(hh)
        ch = QCheckBox("Цэгийн солбицлыг бичих")
        self._bind("photo_coord_label", ch)
        f.addRow(ch)
        v.addLayout(f)
        self._bindings["photos"] = (self._get_photos, self._set_photos)
        self._bindings["legend_titles"] = (lambda: dict(self._legend_titles),
                                           self._set_legend_titles)
        self._bindings["legend_order"] = (
            lambda: list(self._legend_order),
            lambda v: self._set_legend_list("_legend_order", v))
        self._bindings["legend_hidden"] = (
            lambda: list(self._legend_hidden),
            lambda v: self._set_legend_list("_legend_hidden", v))
        return w

    @staticmethod
    def _north_arrows():
        out = [("QGIS-ийн үндсэн сум", "")]
        seen = set()
        for base in QgsApplication.svgPaths():
            for sub in ("arrows", "north_arrows", "wind_roses"):
                d = os.path.join(base, sub)
                if not os.path.isdir(d):
                    continue
                for name in sorted(os.listdir(d)):
                    if not name.lower().endswith(".svg") or name in seen:
                        continue
                    low = name.lower()
                    if sub == "arrows" and "north" not in low:
                        continue
                    seen.add(name)
                    # Харьцангуй нэрээр хадгална: загварыг өөр компьютерт ч ашиглаж болно
                    out.append((os.path.splitext(name)[0], f"{sub}/{name}"))
        return out

    # ------------------------------------------------------------------
    # Тохиргоо ↔ виджет
    # ------------------------------------------------------------------
    def _bind(self, key, w, clears_extent=False):
        def changed(*_):
            if clears_extent and not self._loading:
                self._extent_override = None
            self._changed()

        if isinstance(w, QGroupBox):
            get, set_ = w.isChecked, lambda v: w.setChecked(bool(v))
            w.toggled.connect(changed)
        elif isinstance(w, QCheckBox):
            get, set_ = w.isChecked, lambda v: w.setChecked(bool(v))
            w.toggled.connect(changed)
        elif isinstance(w, QgsMapLayerComboBox):
            def get():
                lyr = w.currentLayer()
                return lyr.id() if lyr is not None else ""

            def set_(v):
                lyr = QgsProject.instance().mapLayer(v) if v else None
                if lyr is not None:
                    w.setLayer(lyr)
                elif w.allowEmptyLayer():
                    w.setLayer(None)
            w.layerChanged.connect(changed)
        elif isinstance(w, QgsFieldComboBox):
            get, set_ = w.currentField, lambda v: w.setField(v or "")
            w.fieldChanged.connect(changed)
        elif isinstance(w, QFontComboBox):
            get = lambda: w.currentFont().family()

            def set_(v):
                f = w.currentFont()
                f.setFamily(v)
                w.setCurrentFont(f)
            w.currentFontChanged.connect(changed)
        elif isinstance(w, QComboBox):
            get = w.currentData

            def set_(v):
                i = w.findData(v)
                if i < 0 and isinstance(v, float):
                    for j in range(w.count()):
                        d = w.itemData(j)
                        if isinstance(d, float) and abs(d - v) < 1e-9:
                            i = j
                            break
                if i >= 0:
                    w.setCurrentIndex(i)
            w.currentIndexChanged.connect(changed)
        elif isinstance(w, (QSpinBox, QDoubleSpinBox)):
            get, set_ = w.value, lambda v: w.setValue(v)
            w.valueChanged.connect(changed)
        elif isinstance(w, QgsScaleWidget):
            get, set_ = w.scale, lambda v: w.setScale(float(v))
            w.scaleChanged.connect(changed)
        elif isinstance(w, QgsColorButton):
            w.setAllowOpacity(False)
            get = lambda: w.color().name()

            def set_(v):
                from qgis.PyQt.QtGui import QColor
                w.setColor(QColor(v))
            w.colorChanged.connect(changed)
        elif isinstance(w, QPlainTextEdit):
            get, set_ = w.toPlainText, lambda v: w.setPlainText(v or "")
            w.textChanged.connect(changed)
        elif isinstance(w, QLineEdit):
            get, set_ = w.text, lambda v: w.setText(v or "")
            w.textChanged.connect(changed)
        else:
            raise TypeError(type(w))
        self._bindings[key] = (get, set_)

    def settings(self):
        s = dict(composer.DEFAULTS)
        for key, (get, _set) in self._bindings.items():
            s[key] = get()
        return s

    def _apply_settings(self, s):
        s = composer.merged(s)
        self._loading = True
        try:
            for key, (_get, set_) in self._bindings.items():
                if key in s:
                    try:
                        set_(s[key])
                    except Exception:
                        pass
        finally:
            self._loading = False
        self._update_enabled()

    def _update_enabled(self, *_):
        custom = self.cb_page.currentData() == "custom"
        self.sp_pw.setEnabled(custom)
        self.sp_ph.setEnabled(custom)
        self.cb_orient.setEnabled(not custom)
        mode = self.cb_extent.currentData()
        self.lc_extent.setEnabled(mode == "layer")
        self.sp_buffer.setEnabled(mode != "canvas")
        self.sw_scale.setEnabled(self.cb_scale.currentData() == "fixed")
        geo = self.cb_grid_crs.currentData() == "geo"
        self.cb_grid_geo.setEnabled(geo)
        self.sp_grid_map.setEnabled(not geo)
        offline = self.cb_basemap.currentData() == basemaps.FILE_KEY
        self.le_basemap_file.setEnabled(offline)
        mb = basemaps.needs_token(self.cb_basemap.currentData() or "")
        self.le_token.setEnabled(mb)
        self.lbl_token.setVisible(mb and not self.le_token.text().strip())

    def _changed(self, *_):
        if self._loading:
            return
        if self.chk_auto.isChecked():
            self._timer.start()

    # ---- Фото хүснэгт ---------------------------------------------------
    def _photo_row(self, ph):
        t = self.tbl_photos
        r = t.rowCount()
        t.insertRow(r)
        it = QTableWidgetItem(os.path.basename(ph.get("path", "")))
        it.setData(Qt.ItemDataRole.UserRole, ph.get("path", ""))
        it.setToolTip(ph.get("path", ""))
        it.setFlags(it.flags() & ~Qt.ItemFlag.ItemIsEditable)
        t.setItem(r, 0, it)
        for col, key in ((1, "lon"), (2, "lat")):
            val = ph.get(key)
            t.setItem(r, col, QTableWidgetItem("" if val in (None, "") else f"{float(val):.6f}"))
        cb = _combo(POSITIONS)
        i = cb.findData(ph.get("pos") or "TL")
        cb.setCurrentIndex(max(0, i))
        cb.currentIndexChanged.connect(self._changed)
        t.setCellWidget(r, 3, cb)
        t.setItem(r, 4, QTableWidgetItem(str(ph.get("width") or 55)))

    def _get_photos(self):
        t = self.tbl_photos
        out = []
        for r in range(t.rowCount()):
            def num(col, default=None):
                it = t.item(r, col)
                try:
                    return float(it.text().replace(",", ".")) if it and it.text().strip() \
                        else default
                except ValueError:
                    return default
            it = t.item(r, 0)
            cb = t.cellWidget(r, 3)
            out.append({
                "path": it.data(Qt.ItemDataRole.UserRole) if it else "",
                "lon": num(1), "lat": num(2),
                "pos": cb.currentData() if cb is not None else "TL",
                "width": num(4, 55.0),
            })
        return out

    def _set_photos(self, photos):
        self.tbl_photos.blockSignals(True)
        self.tbl_photos.setRowCount(0)
        for ph in photos or []:
            self._photo_row(ph)
        self.tbl_photos.blockSignals(False)

    def _add_photos(self):
        paths, _ = QFileDialog.getOpenFileNames(
            self, "Фото зураг сонгох", "",
            "Зураг (*.jpg *.jpeg *.png *.tif *.tiff *.bmp *.webp);;Бүх файл (*)")
        if not paths:
            return
        slots = ["TL", "TR", "BL", "BR"]
        self.tbl_photos.blockSignals(True)
        for p in paths:
            ph = {"path": p, "pos": slots[self.tbl_photos.rowCount() % 4], "width": 55}
            try:
                pt, ok = QgsExifTools.getGeoTag(p)
                if ok and not pt.isEmpty():
                    ph["lon"], ph["lat"] = pt.x(), pt.y()
            except Exception:
                pass
            self._photo_row(ph)
        self.tbl_photos.blockSignals(False)
        self._changed()

    def _remove_photo(self):
        rows = sorted({i.row() for i in self.tbl_photos.selectedIndexes()}, reverse=True)
        for r in rows:
            self.tbl_photos.removeRow(r)
        # Мөрийн дугаар шилжих тул гараар зөөсөн фотоны байрлалыг мартана
        self._overrides = {k: v for k, v in self._overrides.items()
                           if not k.startswith(("nm_photo_", "nm_coord_"))}
        self._snapshot = {k: v for k, v in self._snapshot.items()
                          if not k.startswith(("nm_photo_", "nm_coord_"))}
        self._changed()

    # ------------------------------------------------------------------
    # Угсрах
    # ------------------------------------------------------------------
    def _connect_project(self):
        canvas = self.iface.mapCanvas()
        prj = QgsProject.instance()
        root = prj.layerTreeRoot()
        pairs = [
            (canvas.extentsChanged, self._canvas_changed),
            (root.visibilityChanged, self._changed),
            (root.visibilityChanged, self._legend_mark_dirty),
            (prj.layersAdded, self._changed),
            (prj.layersAdded, self._legend_mark_dirty),
            (prj.layersRemoved, self._changed),
            (prj.layersRemoved, self._legend_mark_dirty),
            (prj.crsChanged, self._project_reset),
            (prj.cleared, self._project_cleared),
            (prj.readProject, self._project_loaded),
        ]
        pairs += [
            (root.visibilityChanged, self._mark_map_dirty),
            (root.layerOrderChanged, self._mark_map_dirty),
            (prj.layersAdded, self._mark_map_dirty),
            (prj.layersRemoved, self._mark_map_dirty),
            (prj.crsChanged, self._mark_map_dirty),
            (prj.layersAdded, self._watch_layers),
        ]
        for sig, slot in pairs:
            sig.connect(slot)
            self._conns.append((sig, slot))
        self._watch_layers(list(prj.mapLayers().values()))

    def shutdown(self):
        """Плагин унтрах / дахин ачаалах үед QGIS-ийн дохионоос салгана."""
        self._timer.stop()
        self._legend_timer.stop()
        for sig, slot in self._conns:
            try:
                sig.disconnect(slot)
            except (TypeError, RuntimeError):
                pass
        self._conns = []

    def _canvas_changed(self):
        if self.isVisible() and self.cb_extent.currentData() == "canvas" \
                and self._extent_override is None:
            self._changed()

    def _project_loaded(self, *_):
        self._set_basemap_state(basemaps.from_project(QgsProject.instance()))
        self._style_backup = {}
        self._load_titles_from_project()
        self._legend_mark_dirty()
        if self._restore_state():
            # «Хадгалах…»-аар хадгалсан зураг: яг хадгалсан байдлаар нь сэргээнэ
            self.rebuild(force=True)
            self.view.zoomFull()
        else:
            self._changed()

    def _set_basemap_state(self, state):
        self._loading = True
        try:
            for key in ("basemap", "overlays", "overlays_on_top"):
                self._bindings[key][1](state[key])
            if state.get("basemap_file"):
                self._bindings["basemap_file"][1](state["basemap_file"])
        finally:
            self._loading = False
        self._update_enabled()

    def _project_reset(self, *_):
        self._job_override = None
        self._jobs = []
        self._overlap_layer_id = ""
        try:
            self.lw_jobs.clear()
            self.tbl_overlap.setRowCount(0)
            self.lbl_overlap.setText("")
        except (AttributeError, RuntimeError):
            pass
        self._set_basemap_state({"basemap": "", "overlays": [], "overlays_on_top": False})
        self._overrides = {}
        self._snapshot = {}
        self._extent_override = None
        self._extent_snapshot = None
        self._changed()

    def _project_cleared(self, *_):
        # Төсөл цэвэрлэгдэхэд давхаргууд устах тул нэр, нөөц загварыг мартана
        # (CRS солигдоход мартахгүй).
        self._legend_titles = {}
        self._legend_order = []
        self._legend_hidden = []
        self._style_backup = {}
        self._legend_mark_dirty()
        self._project_reset()

    def _alive(self, item):
        try:
            return item is not None and item.layout() is self.layout_ \
                and item.scene() is not None
        except RuntimeError:
            return False

    def _collect_overrides(self):
        """Хэрэглэгч урьдчилан харах талбарт гараар зөөсөн зүйлсийг тэмдэглэнэ."""
        for key, item in self._items.items():
            if key.startswith("nm_line_") or key not in self._snapshot:
                continue
            if not self._alive(item):
                continue
            now = composer.item_geom(item)
            if composer.geom_changed(item, now, self._snapshot[key]):
                self._overrides[key] = now
        m = self._items.get("nm_map")
        if self._alive(m) and self._extent_snapshot is not None:
            e, o = m.extent(), self._extent_snapshot
            tol = max(o.width(), o.height(), 1e-9) * 1e-6
            if (abs(e.xMinimum() - o.xMinimum()) > tol or abs(e.xMaximum() - o.xMaximum()) > tol
                    or abs(e.yMinimum() - o.yMinimum()) > tol
                    or abs(e.yMaximum() - o.yMaximum()) > tol):
                self._extent_override = QgsRectangle(e)

    def _mark_map_dirty(self, *_):
        """Газрын зургийн агуулга (давхарга, загвар) өөрчлөгдсөн: дараагийн угсралтад
        нэгэнт зурсан дүрсийг ашиглалгүй шинээр зурна."""
        self._map_dirty = True

    def _layer_changed(self, *_):
        self._map_dirty = True
        self._changed()

    def _watch_layers(self, layers):
        for lyr in layers or []:
            for name in ("styleChanged", "repaintRequested"):
                sig = getattr(lyr, name, None)
                if sig is None:
                    continue
                try:
                    sig.connect(self._layer_changed)
                    self._conns.append((sig, self._layer_changed))
                except (TypeError, RuntimeError):
                    pass

    def rebuild(self, force=False):
        if self._building:
            return
        self._building = True
        self._timer.stop()
        try:
            self._collect_overrides()
            s = self.settings()
            # Суурь зураг нэмэх/хасахад төслийн дохио дахин угсралт дуудуулахгүй
            self._loading = True
            try:
                if basemaps.sync(QgsProject.instance(), s):
                    self._map_dirty = True
            finally:
                self._loading = False
            self.lbl_token.setVisible(
                basemaps.needs_token(s["basemap"] or "") and not s["mapbox_token"].strip())
            if s["legend"] and s["legend_kml"]:
                self._convert_kml_styles()
            self.layout_.deselectAll()
            job = self._job_override
            self._items = composer.build(
                self.layout_, dict(s, **job) if job else s,
                self.iface.mapCanvas().extent(), self._overrides,
                None if job else self._extent_override,
                reuse_map=True, map_dirty=bool(force or self._map_dirty))
            self._map_dirty = False
            self._snapshot = {k: composer.item_geom(v) for k, v in self._items.items()}
            m = self._items.get("nm_map")
            if m is not None:
                self._extent_snapshot = QgsRectangle(m.extent())
                self.lbl_scale.setText("1 : {:,.0f}".format(m.scale()).replace(",", " "))
            QgsSettings().setValue(
                SETTINGS_KEY, json.dumps(dict(s, _v=SETTINGS_VERSION), ensure_ascii=False))
            # Торны гаднах солбицлын тоо эхний зурагдалтын дараа л хэмжигддэг
            # хувилбарт зориулж дахин нэг удаа зай гаргана.
            QTimer.singleShot(250, self._refresh_map_bounds)
            if self._first_build:
                self._first_build = False
                self.view.zoomFull()
        except Exception as e:  # урьдчилан харалт унасан ч цонх ажилласаар байна
            self.lbl_status.setText(f"<span style='color:#b00'>Алдаа: {e}</span>")
            raise
        finally:
            self._building = False

    def _convert_kml_styles(self):
        """KML-ийн объектод шингэсэн загварыг таних тэмдэгт гарах загвар руу хөрвүүлнэ."""
        done = []
        self._loading = True
        try:
            for lyr in legend_edit.editable_layers(QgsProject.instance()):
                if not composer.has_embedded_symbols(lyr):
                    continue
                backup = lyr.renderer().clone()
                if legend_edit.convert_embedded(lyr):
                    self._style_backup.setdefault(lyr.id(), backup)
                    done.append(lyr.name())
        finally:
            self._loading = False
        if done:
            self._legend_mark_dirty()
            self.lbl_status.setText(
                "KML-ийн загварыг таних тэмдэгт гаргахаар хөрвүүллээ: " + ", ".join(done))

    def _refresh_map_bounds(self):
        m = self._items.get("nm_map")
        if self._alive(m):
            composer.refresh_map_bounds(m, invalidate=False)
            self.layout_.update()
            self.view.viewport().update()

    def reset_positions(self):
        self._overrides = {}
        self._snapshot = {}
        self._extent_override = None
        self._extent_snapshot = None
        self.rebuild()
        self.view.zoomFull()

    def showEvent(self, ev):
        super().showEvent(ev)
        QTimer.singleShot(50, self._on_shown)

    def _on_shown(self):
        self.rebuild()
        self.view.zoomFull()

    # ------------------------------------------------------------------
    # Загвар (preset)
    # ------------------------------------------------------------------
    def _load_last(self):
        try:
            raw = QgsSettings().value(SETTINGS_KEY, "")
            s = json.loads(raw) if raw else {}
            # Давхарга, фото нь төсөл бүрд өөр тул өмнөх төслөөс зөөхгүй
            for k in ("photos", "extent_layer", "table_layer", "table_field", "legend_titles",
                      "legend_order", "legend_hidden", "inset_layer", "map_hidden_layers",
                      "map_shown_layers",
                      "extent_rect"):
                s.pop(k, None)
            # Хуучин хувилбарын хадгалсан утга шинэ анхдагч утгыг дарахгүй
            if int(s.pop("_v", 1) or 1) < SETTINGS_VERSION:
                for k in ("north_svg", "scalebar_style", "legend_filter"):
                    s.pop(k, None)
            if "extent_mode" in s and s["extent_mode"] == "layer":
                s["extent_mode"] = "canvas"
            s["table"] = False
        except Exception:
            s = {}
        # Суурь зураг нь төсөл бүрийн сонголт: өмнөх төслийнхийг шинэ төсөлд
        # өөрөө нэмэхгүй, харин энэ төсөлд байгааг нь таньж үргэлжлүүлнэ.
        s.update(basemaps.from_project(QgsProject.instance()))
        return s

    def save_preset(self):
        """«Хадгалах…» — зургийг бүхэлд нь (тохиргоо, давхарга, хил, суурь зураг) хадгална."""
        self.save_map_project()

    def load_preset(self):
        """«Ачаалах…» — хадгалсан зургийг хамгийн сүүлд хадгалсан байдлаар нь нээнэ."""
        self.load_map_project()

    def restore_defaults(self):
        self._apply_settings({})
        self.reset_positions()

    # ------------------------------------------------------------------
    # Layout Designer, экспорт
    # ------------------------------------------------------------------
    def _unique_name(self):
        base = (self.settings()["title"].strip().split("\n")[0] or "Нуман зураг")[:60]
        mgr = QgsProject.instance().layoutManager()
        name, i = base, 2
        while mgr.layoutByName(name) is not None:
            name = f"{base} ({i})"
            i += 1
        return name

    def open_in_designer(self):
        self.rebuild()
        clone = self.layout_.clone()
        clone.setName(self._unique_name())
        if not QgsProject.instance().layoutManager().addLayout(clone):
            QMessageBox.warning(self, "Layout Designer", "Layout-ыг төсөлд нэмж чадсангүй.")
            return
        self.iface.openLayoutDesigner(clone)
        self.lbl_status.setText(f"Төсөлд «{clone.name()}» нэртэй layout нэмэгдлээ.")

    @staticmethod
    def _settle(timeout_ms=15000):
        """Арын тооцоо (таних тэмдгийн шүүлтүүр гэх мэт) дуустал хүлээнэ.

        Layout өөрчлөгдсөний дараа шууд экспортолбол таних тэмдгийн «зурагт
        харагдаж буйг шүүх» тооцоо эхлээгүй байж, QGIS түүнийг хүлээн гацдаг.
        """
        from qgis.PyQt.QtCore import QElapsedTimer, QEventLoop
        timer = QElapsedTimer()
        timer.start()
        tm = QgsApplication.taskManager()
        for _ in range(3):
            QApplication.processEvents(QEventLoop.ProcessEventsFlag.ExcludeUserInputEvents)
        while tm.countActiveTasks() > 0 and timer.elapsed() < timeout_ms:
            QApplication.processEvents(
                QEventLoop.ProcessEventsFlag.ExcludeUserInputEvents, 50)

    def export(self):
        idx = self.cb_format.currentIndex()
        filt, ext = EXPORT_FORMATS[idx]
        st = QgsSettings()
        folder = st.value("numan_map_maker/export_dir", "") or \
            QgsProject.instance().homePath() or os.path.expanduser("~")
        base = (self.settings()["title"].strip().split("\n")[0] or "gazriin_zurag")
        base = "".join(c for c in base if c not in '\\/:*?"<>|').strip()[:80] or "gazriin_zurag"
        path, _ = QFileDialog.getSaveFileName(
            self, "Газрын зураг экспортлох", os.path.join(folder, base + "." + ext), filt)
        if not path:
            return
        if not os.path.splitext(path)[1]:
            path += "." + ext
        st.setValue("numan_map_maker/export_dir", os.path.dirname(path))

        self.rebuild()
        dpi = self.sp_dpi.value()
        # Хуулбараас экспортолно: урьдчилан харах талбарын сонголт, тэмдэглэгээ
        # зурагт орохгүй, экспортын явцад харагдац хөдлөхгүй.
        clone = self.layout_.clone()
        exporter = QgsLayoutExporter(clone)
        self._settle()
        kind = os.path.splitext(path)[1].lower().lstrip(".")
        QApplication.setOverrideCursor(Qt.CursorShape.WaitCursor)
        self.lbl_status.setText("Экспортлож байна…")
        QApplication.processEvents()
        try:
            if kind == "pdf":
                es = QgsLayoutExporter.PdfExportSettings()
                es.dpi = dpi
                res = exporter.exportToPdf(path, es)
            elif kind == "svg":
                es = QgsLayoutExporter.SvgExportSettings()
                es.dpi = dpi
                res = exporter.exportToSvg(path, es)
            else:
                es = QgsLayoutExporter.ImageExportSettings()
                es.dpi = dpi
                es.generateWorldFile = self.chk_world.isChecked()
                res = exporter.exportToImage(path, es)
        finally:
            QApplication.restoreOverrideCursor()
            del exporter
            clone.deleteLater()

        if res == QgsLayoutExporter.Success:
            self._after_export(1)
            url = QUrl.fromLocalFile(path).toString()
            durl = QUrl.fromLocalFile(os.path.dirname(path)).toString()
            self.lbl_status.setText(
                f"Хадгаллаа: <a href='{url}'>{os.path.basename(path)}</a> "
                f"({dpi} dpi) · <a href='{durl}'>хавтас нээх</a>")
        else:
            reasons = {
                QgsLayoutExporter.MemoryError: "Санах ой хүрэлцсэнгүй — нягтралыг (dpi) "
                                               "багасгаж эсвэл хуудсыг жижигрүүлнэ үү.",
                QgsLayoutExporter.FileError: "Файл руу бичиж чадсангүй — файл өөр "
                                             "программд нээлттэй эсэхийг шалгана уу.",
                QgsLayoutExporter.PrintError: "Хэвлэх үед алдаа гарлаа.",
            }
            msg = reasons.get(res, "Экспорт амжилтгүй боллоо.")
            self.lbl_status.setText(f"<span style='color:#b00'>{msg}</span>")
            QMessageBox.warning(self, "Экспорт", msg)
