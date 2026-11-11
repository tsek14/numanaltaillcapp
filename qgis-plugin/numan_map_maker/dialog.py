# -*- coding: utf-8 -*-
"""Газрын зураг бэлтгэгчийн үндсэн цонх: тохиргоо + шууд урьдчилан харах."""
import json
import os

from qgis.PyQt.QtCore import Qt, QTimer, QUrl
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
    QMessageBox,
    QPlainTextEdit,
    QPushButton,
    QScrollArea,
    QShortcut,
    QSpinBox,
    QSplitter,
    QTabWidget,
    QTableWidget,
    QTableWidgetItem,
    QToolButton,
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
)

from . import composer

SETTINGS_KEY = "numan_map_maker/last_settings"

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


class MapMakerDialog(QDialog):
    def __init__(self, iface, parent=None):
        super().__init__(parent)
        self.iface = iface
        self.setWindowTitle("Газрын зураг бэлтгэгч — Нуман-Алтай")
        self.setWindowFlags(self.windowFlags() | Qt.WindowType.WindowMaximizeButtonHint
                            | Qt.WindowType.WindowMinimizeButtonHint)
        self.resize(1360, 820)

        self._bindings = {}     # key -> (getter, setter)
        self._loading = False
        self._building = False
        self._items = {}
        self._snapshot = {}
        self._extent_snapshot = None
        self._overrides = {}
        self._extent_override = None
        self._first_build = True

        self.layout_ = QgsPrintLayout(QgsProject.instance())
        self.layout_.initializeDefaults()
        self.layout_.setName("Нуман зураг")

        self._timer = QTimer(self)
        self._timer.setSingleShot(True)
        self._timer.setInterval(450)
        self._timer.timeout.connect(self.rebuild)

        self._build_ui()
        self._apply_settings(self._load_last())
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
        lv.addWidget(self.tabs, 1)
        self.tabs.addTab(self._scroll(self._tab_page()), "Хуудас")
        self.tabs.addTab(self._scroll(self._tab_map()), "Зураг")
        self.tabs.addTab(self._scroll(self._tab_elements()), "Элемент")
        self.tabs.addTab(self._scroll(self._tab_table()), "Хүснэгт")
        self.tabs.addTab(self._scroll(self._tab_photos()), "Фото")

        row = QHBoxLayout()
        self.btn_refresh = QPushButton("Шинэчлэх")
        self.btn_refresh.setToolTip("Тохиргооны дагуу зургийг дахин угсарна")
        self.btn_refresh.clicked.connect(self.rebuild)
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
        b = QPushButton("Загвар хадгалах…")
        b.clicked.connect(self.save_preset)
        row.addWidget(b)
        b = QPushButton("Загвар ачаалах…")
        b.clicked.connect(self.load_preset)
        row.addWidget(b)
        b = QPushButton("Анхны тохиргоо")
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
        tb.setText("Бүтнээр харах")
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
        b = QPushButton("Layout Designer-т нээх")
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
        self.lbl_status.setTextInteractionFlags(Qt.TextInteractionFlag.TextBrowserInteraction)
        self.lbl_status.linkActivated.connect(
            lambda href: QDesktopServices.openUrl(QUrl(href)))
        ex.addWidget(self.lbl_status, 1)
        self.btn_export = QPushButton("Экспортлох…")
        self.btn_export.setDefault(True)
        self.btn_export.clicked.connect(self.export)
        ex.addWidget(self.btn_export)
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
        cb = _combo(POSITIONS)
        self._bind("table_pos", cb)
        f.addRow("Байрлал:", cb)
        sp = _dspin(4, 30, 0.5, 1, " pt")
        self._bind("table_font_size", sp)
        f.addRow("Бичгийн хэмжээ:", sp)
        v.addWidget(g)
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
                    out.append((os.path.splitext(name)[0], os.path.join(d, name)))
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
        canvas.extentsChanged.connect(self._canvas_changed)
        prj = QgsProject.instance()
        prj.layerTreeRoot().visibilityChanged.connect(self._changed)
        prj.layersAdded.connect(self._changed)
        prj.layersRemoved.connect(self._changed)
        prj.crsChanged.connect(self._project_reset)
        prj.cleared.connect(self._project_reset)

    def _canvas_changed(self):
        if self.isVisible() and self.cb_extent.currentData() == "canvas" \
                and self._extent_override is None:
            self._changed()

    def _project_reset(self, *_):
        self._overrides = {}
        self._snapshot = {}
        self._extent_override = None
        self._extent_snapshot = None
        self._changed()

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

    def rebuild(self):
        if self._building:
            return
        self._building = True
        self._timer.stop()
        try:
            self._collect_overrides()
            s = self.settings()
            self.layout_.deselectAll()
            self._items = composer.build(
                self.layout_, s, self.iface.mapCanvas().extent(),
                self._overrides, self._extent_override)
            self._snapshot = {k: composer.item_geom(v) for k, v in self._items.items()}
            m = self._items.get("nm_map")
            if m is not None:
                self._extent_snapshot = QgsRectangle(m.extent())
                self.lbl_scale.setText("1 : {:,.0f}".format(m.scale()).replace(",", " "))
            QgsSettings().setValue(SETTINGS_KEY, json.dumps(s, ensure_ascii=False))
            if self._first_build:
                self._first_build = False
                self.view.zoomFull()
        except Exception as e:  # урьдчилан харалт унасан ч цонх ажилласаар байна
            self.lbl_status.setText(f"<span style='color:#b00'>Алдаа: {e}</span>")
            raise
        finally:
            self._building = False

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
            for k in ("photos", "extent_layer", "table_layer", "table_field"):
                s.pop(k, None)
            if "extent_mode" in s and s["extent_mode"] == "layer":
                s["extent_mode"] = "canvas"
            s["table"] = False
            return s
        except Exception:
            return {}

    def save_preset(self):
        path, _ = QFileDialog.getSaveFileName(
            self, "Загвар хадгалах", "zurgiin_zagvar.json", "Загвар (*.json)")
        if not path:
            return
        if not path.lower().endswith(".json"):
            path += ".json"
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(self.settings(), fh, ensure_ascii=False, indent=2)
        self.lbl_status.setText(f"Загвар хадгалагдлаа: {os.path.basename(path)}")

    def load_preset(self):
        path, _ = QFileDialog.getOpenFileName(
            self, "Загвар ачаалах", "", "Загвар (*.json);;Бүх файл (*)")
        if not path:
            return
        try:
            with open(path, "r", encoding="utf-8") as fh:
                s = json.load(fh)
            if not isinstance(s, dict):
                raise ValueError("буруу бүтэцтэй файл")
        except Exception as e:
            QMessageBox.warning(self, "Загвар ачаалах", f"Файлыг уншиж чадсангүй:\n{e}")
            return
        self._apply_settings(s)
        self.reset_positions()

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
