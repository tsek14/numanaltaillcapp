# -*- coding: utf-8 -*-
"""Давхцлын шинжилгээний таб, шууд хэвлэх, тусламжийн цонх (MapMakerDialog-ийн mixin)."""
import os

from qgis.PyQt.QtCore import QMarginsF, QSizeF, Qt
from qgis.PyQt.QtGui import QColor, QPageLayout, QPageSize
from qgis.PyQt.QtPrintSupport import QPrintDialog, QPrinter
from qgis.PyQt.QtWidgets import (
    QApplication,
    QCheckBox,
    QComboBox,
    QDialog,
    QDialogButtonBox,
    QDoubleSpinBox,
    QFileDialog,
    QFormLayout,
    QGroupBox,
    QHBoxLayout,
    QHeaderView,
    QLabel,
    QMessageBox,
    QPushButton,
    QTableWidget,
    QTableWidgetItem,
    QTextBrowser,
    QVBoxLayout,
    QWidget,
)
from qgis.core import (
    QgsEmbeddedSymbolRenderer,
    QgsLayoutExporter,
    QgsMapLayerProxyModel,
    QgsProject,
    QgsRuleBasedRenderer,
    QgsSettings,
    QgsSingleSymbolRenderer,
    QgsVectorLayer,
    QgsWkbTypes,
)
from qgis.gui import QgsColorButton, QgsFieldComboBox, QgsMapLayerComboBox

from . import fastload, overlap, tasks

HELP_HTML = """
<h2>Газрын зураг бэлтгэгч — тусламж</h2>

<h3>Ажлын дараалал</h3>
<ol>
<li>Давхаргуудаа QGIS-т нээнэ (эсвэл «Давхцал» табаас хилийн файлаа нэмнэ).</li>
<li>Зүүн дээд талын <b>Загвар</b>-аас тохирохыг сонгоод «Хэрэглэх».</li>
<li>Зүүн талын табуудаас гарчиг, фон, элементүүдээ тохируулна — баруун талд шууд харагдана.</li>
<li>Баруун талын зураг дээр элементүүдийг чирж байрлуулна.</li>
<li>Доод талаас <b>Экспортлох…</b> эсвэл <b>Хэвлэх…</b> дарна.</li>
</ol>

<h3>Зургийн дээрх товчлуурууд</h3>
<table cellpadding="4">
<tr><td><b>Сонгох / зөөх</b></td><td>Үндсэн хэрэгсэл. Таних тэмдэг, сум, масштаб, хүснэгт, гарчиг
зэрэг элемент дээр дарж сонгоод <i>чирж зөөнө</i>. Сонгосон элементийн булан, ирмэгийн жижиг
дөрвөлжнөөс татаж <i>хэмжээг нь өөрчилнө</i>. Сумтай товчоор бага багаар зөөнө.</td></tr>
<tr><td><b>Гүйлгэх</b></td><td>Хуудсыг бүхэлд нь чирж харагдацаа шилжүүлнэ (томруулсан үед). Элемент
зөөхгүй, зураг өөрчлөгдөхгүй. Хулганы дунд товчийг дарж чирэхэд мөн адил.</td></tr>
<tr><td><b>Зургийн агуулга</b></td><td>Газрын зургийн <i>хүрээн доторх</i> агуулгыг чирж хамрах
хүрээг өөрчилнө; хулганы дугуйгаар масштабыг томруулж жижигрүүлнэ. Хүрээ өөрөө байрандаа
үлдэнэ.</td></tr>
<tr><td><b>Бүтэн</b></td><td>Хуудсыг бүтнээр нь цонхонд багтааж харуулна.</td></tr>
<tr><td><b>+ / −</b></td><td>Харагдацыг томруулна / жижигрүүлнэ (хэвлэгдэх хэмжээ өөрчлөгдөхгүй).</td></tr>
<tr><td><b>Устгах</b></td><td>Сонгосон элементийг зургаас хасна (Delete товч мөн адил). Буцаахдаа
зүүн талаас тухайн элементийг дахин асаах эсвэл «Шинэчлэх» дарна.</td></tr>
<tr><td><b>Designer…</b></td><td>Зургийг төсөлд хадгалж QGIS-ийн Layout Designer-т
нээнэ — тэнд бүх нарийн засварыг хийж болно.</td></tr>
</table>

<h3>Зүүн доод товчлуурууд</h3>
<ul>
<li><b>Шинэчлэх</b> — тохиргооны дагуу зургийг дахин угсарна. «Автоматаар» чагттай бол өөрөө шинэчлэгдэнэ.</li>
<li><b>Байрлал сэргээх</b> — гараар зөөсөн элемент, хамрах хүрээг автомат байрлалд буцаана.</li>
<li><b>Тохиргоо: Хадгалах…</b> — зургийг бүхэлд нь QGIS төслийн файл (.qgz) болгон хадгална:
бүх тохиргоо, гараар зөөсөн байрлал, хамрах хүрээ, давхаргууд, ачаалсан хил, давхцлын үр дүн,
суурь зураг. <b>Ачаалах…</b> — хадгалсан зургийг хамгийн сүүлд хадгалсан байдлаар нь нээнэ.
<b>Анхных</b> — тохиргоог анхны утгад буцаана.</li>
</ul>

<h3>Табууд</h3>
<ul>
<li><b>Хуудас</b> — хэмжээ, гарчиг, тайлбар, зургийн автомат дугаар.</li>
<li><b>Зураг</b> — хамрах хүрээ, масштаб, солбицлын тор.</li>
<li><b>Суурь зураг</b> — Google, Esri, OSM зэрэг фон, overlay.</li>
<li><b>Элемент</b> — таних тэмдэг, хойд зүгийн сум, масштабын шугам.</li>
<li><b>Тэмдэг</b> — таних тэмдгийн нэр, өнгө, дараалал; стандарт загвар оноох. Давхарга эсвэл
ангиллын чагтыг авбал таних тэмдгээс ч, газрын зураг дээрээс ч хасагдана.</li>
<li><b>Хүснэгт</b> — талбайн хүснэгт, Excel рүү гаргах.</li>
<li><b>Давхцал</b> — талбайг аймаг, сум, лиценз, ТХГ зэрэг хилтэй давхцуулж га, хувийг тооцно.</li>
<li><b>Фото</b> — газар дээр авсан зургийг цэгтэй нь холбож тавина.</li>
<li><b>Нэмэлт</b> — байршлын жижиг зураг, лого, мэдээллийн хүснэгт.</li>
<li><b>Цуврал</b> — олон зургийг нэг дор гаргана.</li>
</ul>

<h3>Давхцлын шинжилгээ</h3>
<ol>
<li>«Судалгааны талбай»-д шинжлэх талбайн давхаргаа сонгоно.</li>
<li>«Хилийн файл нэмэх…» товчоор KML, KMZ, GeoJSON, SHP файлаа нэмнэ (эсвэл төсөлд байгаа
давхаргаас сонгоно).</li>
<li>«Нэрийн талбар»-т хилийн нэр агуулсан баганыг сонгоно.</li>
<li>«Давхцал тооцоолох» дарна. Үр дүн хүснэгтээр гарч, зураг дээр өнгөөр ялгасан давхарга,
нэрийн бичээс, талбай-хувийн хүснэгт нэмэгдэнэ.</li>
</ol>
<p><b>Давхар нэгж.</b> Нэг хилийн файлд аймаг, сум, баг хамт байвал плагин нэг нь нөгөөдөө
багтаж байгааг таньж, хүснэгт, таних тэмдэгт шатлалаар (догол мөрөөр) харуулна. Хувийг судалгааны
талбайн өөрийн хэмжээнээс тооцно (аймаг 100%, сум 100%, багууд 91% + 9% гэх мэт). Зураг дээр
хамгийн доод түвшний нэгжүүд өнгөөр, тэдгээрийг агуулах аймаг, сум хүрээ шугамаар харагдана.</p>
<p><b>Олон хилийг нэг дор.</b> «Олон хилийг нэг дор тооцоолох» хэсэгт аймаг, лиценз, ТХГ зэрэг
хилүүдийг чагталж «Чагталсан бүх хилээр тооцоолох» дарна. Дараа нь «Сэдэвчилсэн зургуудыг
цувралаар гаргах…» товч хил бүрийн зургийг «Цуврал» табд бэлдэнэ.</p>
<p>Удаан тооцоо (том файл, улсын хэмжээний давхцал) арын горимд явна: энэ хооронд QGIS-ийн үндсэн
цонхыг ашиглаж болно, явцын цонхноос зогсооно.</p>
<p>«Хилийн шугам» хэсгийн чагтаар хилийн шугамыг зургийн бүх хэсэгт харуулна эсвэл нууна;
өнгө, өргөнийг нь тэндээс солино.</p>
<p>Хэд хэдэн хилтэй (аймаг, лиценз, ТХГ …) ээлжлэн тооцоолж болно. Дараа нь «Цуврал» табын
«Давхарга бүрээр» горимоор тус бүрд нь сэдэвчилсэн зураг гаргана.</p>

<h3>Офлайн суурь зураг</h3>
<p>«Суурь зураг» табын «Фон» жагсаалтаас «Офлайн файл»-ыг сонгоод «…» товчоор OsmAnd-ийн
<b>.sqlitedb</b> (эсвэл <b>.mbtiles</b>) файлаа заана. .sqlitedb файлыг плагин нэг удаа QGIS-д
уншигдах хэлбэрт (.mbtiles) хөрвүүлнэ: хөрвүүлэхийн өмнө хаана хадгалахыг асууж, дараа нь тэр
бэлэн файлыг шууд уншина. Эх файл өөрчлөгдөхгүй. Интернэтгүй үед ч ажиллана.</p>

<h3>Кэш</h3>
<p>Нэг удаа зурагдсан газрын зураг (суурь зураг, хилийн шугам, давхаргууд) санах ойд үлддэг тул
гарчиг, таних тэмдэг, тор зэргийг өөрчлөхөд дахин зурагдахгүй. Хамрах хүрээ, хуудасны хэмжээ,
давхарга, загвар өөрчлөгдөхөд л шинээр зурна; хүчээр шинэчлэх бол «Шинэчлэх» товчийг дарна.
Онлайн суурь зургийн татсан хэсгүүд диск дээр хадгалагдаж (анхдагчаар 1 ГБ хүртэл, 30 хоног),
дараа нь интернэтээс дахин татагдахгүй. Хэмжээг «Нэмэлт» табаас тохируулж, цэвэрлэнэ.</p>

<h3>Том файл</h3>
<p>Улсын хэмжээний олон мянган полигонтой KML, KMZ, GeoJSON файлыг «Хилийн файл нэмэх…»-ээр
нэмэхэд плагин түүнийг нэг удаа орон зайн индекстэй кэш болгон бэлтгэдэг (эхний удаа хэдэн
секундээс хэдэн минут). Дараа нь зураг зурах, давхцал тооцохдоо зөвхөн дэлгэцэнд харагдаж
буй хэсгийн объектыг уншдаг тул хөнгөн ажиллана. QGIS-ээр шууд нээсэн том давхаргад
«Сонгосон давхаргыг хөнгөлөх» товчийг дарна. Эх файлд өөрчлөлт орохгүй.</p>

<h3>Булангийн цэгийн солбицол</h3>
<p>«Хүснэгт» табын «Булангийн цэгийн солбицол» хэсгийг асааж, лиценз эсвэл талбайн давхаргаа
сонгоно. Оройнууд зураг дээр дугаарлагдаж, солбицол нь хүснэгтээр гарна: градус-минут-секунд,
градус-минут, аравтын градус, UTM (бүсийг автоматаар) эсвэл төслийн проекцоор; Өргөрөг, Уртраг
дарааллыг сонгоно. Олон объекттой бол дугаар объект бүрээр эхэлнэ. «Солбицлыг Excel рүү
гаргах…» товчоор хүснэгтийг файл болгоно.</p>

<h3>Хэвлэх</h3>
<p>«Хэвлэх…» товч хэвлэгчийн цонхыг нээнэ. Хуудасны хэмжээ, чиглэлийг зургийн хуудастай ижлээр
урьдчилан тохируулдаг. Зураг хэвлэгчийн цаасаас том бол PDF-ээр экспортлоод хэвлэхдээ
«хуудсанд багтаах» сонголтыг хэрэглээрэй.</p>
"""


class AnalysisMixin:
    # ==================================================================
    # Давхцлын шинжилгээ
    # ==================================================================
    def _tab_overlap(self):
        w = QWidget()
        v = QVBoxLayout(w)
        note = QLabel(
            "Судалгааны талбайг аймаг, сум, баг, лиценз, тусгай хамгаалалттай газар зэрэг "
            "хилтэй давхцуулж, аль талбайд хэдэн га, хэдэн хувь нь хамаарахыг тооцно.")
        note.setWordWrap(True)
        v.addWidget(note)

        f = QFormLayout()
        vec = QgsMapLayerProxyModel.PolygonLayer | QgsMapLayerProxyModel.LineLayer
        self.lc_ov_target = QgsMapLayerComboBox()
        self.lc_ov_target.setFilters(vec)
        self.lc_ov_target.setToolTip("Шинжлэх талбай (полигон эсвэл битүү шугам)")
        f.addRow("Судалгааны талбай:", self.lc_ov_target)
        self.chk_ov_sel = QCheckBox("Зөвхөн сонгогдсон объект")
        f.addRow(self.chk_ov_sel)

        h = QHBoxLayout()
        self.lc_ov_bound = QgsMapLayerComboBox()
        self.lc_ov_bound.setFilters(vec)
        h.addWidget(self.lc_ov_bound, 1)
        b = QPushButton("Хилийн файл нэмэх…")
        b.setToolTip("KML, KMZ, GeoJSON, SHP, GPKG файлаас хилийн давхарга нэмнэ")
        b.clicked.connect(self._overlap_add_file)
        h.addWidget(b)
        f.addRow("Хилийн давхарга:", h)
        b = QPushButton("Сонгосон давхаргыг хөнгөлөх")
        b.setToolTip(
            "QGIS-ээр шууд нээсэн том KML / GeoJSON давхаргыг орон зайн индекстэй кэш рүү "
            "шилжүүлнэ: дараа нь зөвхөн дэлгэцэнд харагдаж буй хэсгийг уншина. "
            "«Хилийн файл нэмэх…»-ээр нэмсэн том файлд автоматаар хийгддэг.")
        b.clicked.connect(self._overlap_lighten)
        f.addRow(b)
        self.fc_ov_name = QgsFieldComboBox()
        self.fc_ov_name.setAllowEmptyFieldName(True)
        self.lc_ov_bound.layerChanged.connect(self._overlap_bound_changed)
        f.addRow("Нэрийн талбар:", self.fc_ov_name)

        self.cb_ov_unit = QComboBox()
        for text, data in (("га", "ha"), ("км²", "km2"), ("м²", "m2")):
            self.cb_ov_unit.addItem(text, data)
        f.addRow("Хүснэгтийн нэгж:", self.cb_ov_unit)
        self.cb_ov_label = QComboBox()
        for text, data in (("Нэр", "name"), ("Нэр + га", "ha"), ("Нэр + хувь", "pct"),
                           ("Нэр + га + хувь", "both"), ("Бичихгүй", "")):
            self.cb_ov_label.addItem(text, data)
        self.cb_ov_label.currentIndexChanged.connect(self._overlap_relabel)
        f.addRow("Зураг дээрх бичээс:", self.cb_ov_label)
        self.chk_ov_rest = QCheckBox("Давхцаагүй хэсгийг тусад нь харуулах")
        self.chk_ov_rest.setChecked(True)
        f.addRow(self.chk_ov_rest)
        g = QGroupBox("Хилийн шугам (зургийн бүх хэсэгт)")
        gf = QFormLayout(g)
        self.chk_ov_bound_show = QCheckBox("Хилийн шугамыг зургийн бүх хэсэгт харуулах")
        self.chk_ov_bound_show.setChecked(True)
        self.chk_ov_bound_show.setToolTip(
            "Чагттай бол сонгосон хилийн давхаргын шугам зөвхөн тайрагдсан талбайн дотор "
            "биш, зургийн хүрээнд бүхэлдээ харагдана. Чагтыг авбал нуугдана.")
        gf.addRow(self.chk_ov_bound_show)
        hh = QHBoxLayout()
        self.cb_ov_bound_color = QgsColorButton()
        self.cb_ov_bound_color.setColor(QColor("#111111"))
        self.cb_ov_bound_color.setAllowOpacity(False)
        hh.addWidget(self.cb_ov_bound_color)
        self.sp_ov_bound_width = QDoubleSpinBox()
        self.sp_ov_bound_width.setRange(0.1, 5.0)
        self.sp_ov_bound_width.setSingleStep(0.1)
        self.sp_ov_bound_width.setDecimals(1)
        self.sp_ov_bound_width.setValue(0.7)
        self.sp_ov_bound_width.setSuffix(" мм")
        hh.addWidget(self.sp_ov_bound_width)
        self.chk_ov_bound_dash = QCheckBox("Тасархай")
        hh.addWidget(self.chk_ov_bound_dash)
        hh.addStretch(1)
        gf.addRow("Өнгө, өргөн:", hh)
        self.chk_ov_bound_label = QCheckBox("Хилийн нэгжүүдийн нэрийг бичих")
        self.chk_ov_bound_label.setToolTip("Талбайтай давхцаагүй хөрш нэгжүүдийн нэрийг ч харуулна")
        gf.addRow(self.chk_ov_bound_label)
        f.addRow(g)
        self._ov_labelled = set()
        self.chk_ov_bound_show.toggled.connect(self._overlap_boundary_changed)
        self.chk_ov_bound_dash.toggled.connect(self._overlap_boundary_changed)
        self.chk_ov_bound_label.toggled.connect(self._overlap_boundary_changed)
        self.cb_ov_bound_color.colorChanged.connect(self._overlap_boundary_changed)
        self.sp_ov_bound_width.valueChanged.connect(self._overlap_boundary_changed)
        self.chk_ov_table = QCheckBox("Хүснэгтийг зурагт нэмэх")
        self.chk_ov_table.setChecked(True)
        f.addRow(self.chk_ov_table)
        v.addLayout(f)

        b = QPushButton("Давхцал тооцоолох")
        b.clicked.connect(self._overlap_run)
        v.addWidget(b)
        v.addWidget(self._multi_group())

        t = QTableWidget(0, 3)
        t.setHorizontalHeaderLabels(["Нэр", "Талбай, га", "Хувь, %"])
        t.horizontalHeader().setSectionResizeMode(0, QHeaderView.ResizeMode.Stretch)
        t.verticalHeader().setVisible(False)
        t.setEditTriggers(QTableWidget.EditTrigger.NoEditTriggers)
        t.setMinimumHeight(110)
        self.tbl_overlap = t
        v.addWidget(t, 1)
        self.lbl_overlap = QLabel("")
        self.lbl_overlap.setWordWrap(True)
        v.addWidget(self.lbl_overlap)
        h = QHBoxLayout()
        b = QPushButton("Excel рүү гаргах…")
        b.clicked.connect(self._table_export)
        h.addWidget(b)
        b = QPushButton("Үр дүнгийн давхаргыг устгах")
        b.clicked.connect(self._overlap_clear)
        h.addWidget(b)
        v.addLayout(h)
        self._overlap_layer_id = ""
        self._overlap_bound_changed(self.lc_ov_bound.currentLayer())
        return w

    def _overlap_bound_changed(self, layer):
        self.fc_ov_name.setLayer(layer)
        if isinstance(layer, QgsVectorLayer):
            self.fc_ov_name.setField(overlap.guess_name_field(layer))

    def _overlap_add_file(self):
        st = QgsSettings()
        start = st.value("numan_map_maker/boundary_dir", "") or \
            QgsProject.instance().homePath() or os.path.expanduser("~")
        paths, _ = QFileDialog.getOpenFileNames(self, "Хилийн файл сонгох", start,
                                                overlap.FILE_FILTER)
        if not paths:
            return
        st.setValue("numan_map_maker/boundary_dir", os.path.dirname(paths[0]))
        added = self._overlap_load_files(paths)
        if not added:
            QMessageBox.warning(
                self, "Хилийн файл",
                "Файлаас полигон эсвэл шугаман хил уншиж чадсангүй.\n\n"
                "KML/KMZ бол дотор нь Polygon эсвэл LineString байгаа эсэх, SHP бол .shx, "
                ".dbf файлууд нь хамт байгаа эсэхийг шалгана уу.")

    def _overlap_load_files(self, paths):
        prj = QgsProject.instance()
        # Том файлыг арын горимд бэлдэнэ: энэ хооронд QGIS хөлдөхгүй
        for path in paths:
            if fastload.is_heavy(path) and not os.path.exists(fastload.cache_path(path)):
                self.lbl_status.setText(
                    f"Том файл: {os.path.basename(path)} — хөнгөн уншихаар нэг удаа "
                    "бэлтгэж байна…")
                try:
                    tasks.run(f"Хилийн файл бэлтгэж байна: {os.path.basename(path)}",
                              lambda task, p, c: overlap.prepare_file(p, c, task),
                              path, prj.transformContext(),
                              parent=self, block=self._busy_widgets())
                except tasks.Cancelled:
                    self.lbl_status.setText("Файл бэлтгэхийг зогсоолоо.")
                    return []
                except Exception:
                    pass        # доор ердийн аргаар уншихыг оролдоно
        added = []
        self._loading = True
        QApplication.setOverrideCursor(Qt.CursorShape.WaitCursor)
        try:
            for path in paths:
                try:
                    layers = overlap.load_boundary_file(path, prj)
                except Exception:
                    layers = []
                for lyr in layers:
                    prj.addMapLayer(lyr)
                    added.append(lyr)
        finally:
            self._loading = False
            QApplication.restoreOverrideCursor()
        if added:
            # Олон хилийн жагсаалтад шинэ хилүүдийг чагттайгаар нэмнэ
            self._multi_fill()
            ids = {l.id() for l in added}
            t = self.tbl_multi
            for r in range(t.rowCount()):
                it = t.item(r, 0)
                if it is not None and it.data(Qt.ItemDataRole.UserRole) in ids:
                    it.setCheckState(Qt.CheckState.Checked)
            self.lc_ov_bound.setLayer(added[0])
            self._legend_mark_dirty()
            self._changed()
            self.lbl_status.setText("Хилийн давхарга нэмэгдлээ: "
                                    + ", ".join(l.name() for l in added))
        return added

    def _boundary_apply(self, bound, s=None):
        """Хилийн давхаргыг зургийн бүх хэсэгт харуулах / нуух, шугамын загвар, нэрийн бичээс."""
        prj = QgsProject.instance()
        root = prj.layerTreeRoot()
        node = root.findLayer(bound.id())
        if node is None:
            return
        s = s or self.settings()
        show = self.chk_ov_bound_show.isChecked()
        if not show:
            node.setItemVisibilityChecked(False)
            return
        node.setItemVisibilityCheckedParentRecursive(True)
        # KML-ээс ирсэн (объектдоо загвартай эсвэл түүнээс хөрвүүлсэн) давхаргад ч хэрэглэнэ;
        # хэрэглэгчийн ангилсан загварт хүрэхгүй.
        if isinstance(bound.renderer(), (QgsSingleSymbolRenderer, QgsRuleBasedRenderer,
                                         QgsEmbeddedSymbolRenderer)):
            sym = overlap.outline_symbol(bound, self.cb_ov_bound_color.color().name(),
                                         self.sp_ov_bound_width.value(),
                                         self.chk_ov_bound_dash.isChecked())
            if sym is not None:
                self._style_backup.setdefault(bound.id(), bound.renderer().clone())
                bound.setRenderer(QgsSingleSymbolRenderer(sym))
                bound.triggerRepaint()
        # Давхцлын өнгөт талбайн дээр гарч байж шугам нь тасралтгүй харагдана
        parent = node.parent()
        if parent is not None and not (parent is root and root.children()
                                       and root.children()[0] is node):
            clone = node.clone()
            root.insertChildNode(0, clone)
            parent.removeChildNode(node)
        name_field = self.fc_ov_name.currentField()
        if self.chk_ov_bound_label.isChecked() and name_field:
            overlap.set_labels(bound, name_field, s["font"],
                               max(6.0, float(s["legend_font_size"]) - 1), False)
            self._ov_labelled.add(bound.id())
        elif bound.id() in self._ov_labelled:
            overlap.set_labels(bound, "")
            self._ov_labelled.discard(bound.id())

    def _overlap_boundary_changed(self, *_):
        bound = self.lc_ov_bound.currentLayer()
        if not isinstance(bound, QgsVectorLayer):
            return
        self._loading = True
        try:
            self._boundary_apply(bound)
        finally:
            self._loading = False
        self._legend_mark_dirty()
        self._changed()

    def _overlap_lighten(self):
        lyr = self.lc_ov_bound.currentLayer()
        if not isinstance(lyr, QgsVectorLayer):
            return
        self.lbl_status.setText(f"{lyr.name()} — хөнгөн уншихаар бэлтгэж байна…")
        src = lyr.source().split("|")[0]
        if lyr.providerType() == "ogr" and os.path.isfile(src) and fastload.is_heavy(src):
            try:
                tasks.run(f"Давхарга хөнгөлж байна: {lyr.name()}", lambda task: fastload.convert(
                    src, QgsProject.instance().transformContext(), (lyr.geometryType(),)),
                          parent=self, block=self._busy_widgets())
            except tasks.Cancelled:
                self.lbl_status.setText("Зогсоолоо.")
                return
            except Exception:
                pass
        QApplication.setOverrideCursor(Qt.CursorShape.WaitCursor)
        self._loading = True
        try:
            ok = fastload.lighten(lyr, QgsProject.instance())
        except Exception:
            ok = False
        finally:
            self._loading = False
            QApplication.restoreOverrideCursor()
        if ok:
            self._style_backup.pop(lyr.id(), None)
            self._legend_mark_dirty()
            self._changed()
            self.lbl_status.setText(f"«{lyr.name()}» одоо зөвхөн харагдаж буй хэсгээ уншина.")
        else:
            self.lbl_status.setText(
                f"«{lyr.name()}» аль хэдийн хөнгөн форматтай эсвэл хөрвүүлэх боломжгүй.")

    def _overlap_result_layer(self):
        return QgsProject.instance().mapLayer(self._overlap_layer_id) \
            if self._overlap_layer_id else None

    def _overlap_relabel(self, *_):
        lyr = self._overlap_result_layer()
        if lyr is None:
            return
        mode = self.cb_ov_label.currentData()
        s = self.settings()
        overlap.set_labels(lyr, overlap.LABEL_MODES.get(mode, ""), s["font"],
                           max(6.0, float(s["legend_font_size"])), True, overlap.REST)
        self._changed()

    def _busy_widgets(self):
        """Удаан ажил явж байх хооронд идэвхгүй болгох хэсгүүд (давхар дарахаас сэргийлнэ)."""
        return [getattr(self, "_left_panel", None), getattr(self, "btn_export", None),
                getattr(self, "btn_print", None)]

    def _overlap_compute(self, target, bound, name_field):
        """Нэг хилтэй давхцлыг арын горимд тооцоолно. Result эсвэл None (зогсоосон/алдаа)."""
        job = overlap.prepare(QgsProject.instance(), target, bound, name_field,
                              self.chk_ov_sel.isChecked(), self.chk_ov_rest.isChecked(), 0.001)
        try:
            res = tasks.run(f"Давхцал тооцоолж байна: {bound.name()}",
                            lambda task, j: overlap.compute(j, task), job,
                            parent=self, block=self._busy_widgets(),
                            label=f"«{bound.name()}» хилтэй давхцлыг тооцоолж байна…")
        except tasks.Cancelled:
            self.lbl_status.setText("Давхцлын тооцоог зогсоолоо.")
            return None
        except Exception as e:
            QMessageBox.warning(self, "Давхцал", f"Тооцоолж чадсангүй:\n{e}")
            return None
        # Хүлээх хооронд давхарга устсан бол үр дүнг хаяна
        prj = QgsProject.instance()
        if prj.mapLayer(target.id()) is None or prj.mapLayer(bound.id()) is None:
            return None
        if res.units:
            overlap.build_layer(res, target.crs())
        return res

    def _overlap_show_rows(self, results):
        """Үр дүнг цонхны хүснэгтэд харуулна. Олон хил бол хил бүрийг гарчигтай бүлгээр."""
        t = self.tbl_overlap
        t.setRowCount(0)
        t.clearSpans()
        multi = len(results) > 1
        for res in results:
            if multi:
                r = t.rowCount()
                t.insertRow(r)
                head = QTableWidgetItem(res.boundary_name)
                f = head.font()
                f.setBold(True)
                head.setFont(f)
                head.setBackground(QColor("#e8eef5"))
                t.setItem(r, 0, head)
                t.setSpan(r, 0, 1, 3)
            for u in (res.units or []):
                r = t.rowCount()
                t.insertRow(r)
                t.setItem(r, 0, QTableWidgetItem(("    " * u.level) + u.name))
                for col, val in ((1, f"{u.ha:,.2f}".replace(",", " ")), (2, f"{u.share:.2f}")):
                    it = QTableWidgetItem(val)
                    it.setTextAlignment(Qt.AlignmentFlag.AlignRight
                                        | Qt.AlignmentFlag.AlignVCenter)
                    t.setItem(r, col, it)

    def _overlap_place(self, res, bound, name_field, s):
        """Үр дүнгийн давхаргыг төсөлд нэмж, бичээс, хилийн шугам, хүснэгтийг тохируулна."""
        prj = QgsProject.instance()
        # Энэ хилтэй өмнө нь хийсэн үр дүнг солино
        old = [l.id() for l in prj.mapLayers().values()
               if l.customProperty(overlap.ROLE) == bound.id()]
        if old:
            prj.removeMapLayers(old)
        # Өмнөх (өөр хилтэй) үр дүнгүүд шинэ зурагтай давхцаж бүдгэрүүлэхгүйн тулд
        # нуугдана; «Цуврал» табаар тус бүрд нь зураг гаргаж болно.
        root = prj.layerTreeRoot()
        for lyr in prj.mapLayers().values():
            if lyr.customProperty(overlap.ROLE):
                node = root.findLayer(lyr.id())
                if node is not None:
                    node.setItemVisibilityChecked(False)
        prj.addMapLayer(res.layer, False)
        root.insertLayer(0, res.layer)
        self._overlap_layer_id = res.layer.id()
        overlap.set_labels(res.layer,
                           overlap.LABEL_MODES.get(self.cb_ov_label.currentData(), ""),
                           s["font"], max(6.0, float(s["legend_font_size"])), True,
                           overlap.REST)
        prev = self.fc_ov_name.currentField()
        if self.lc_ov_bound.currentLayer() is not bound:
            self.lc_ov_bound.setLayer(bound)
        self.fc_ov_name.setField(name_field or prev)
        self._boundary_apply(bound, s)
        if self.chk_ov_table.isChecked():
            for key, val in (("table", True), ("table_layer", res.layer.id()),
                             ("table_field", ""), ("table_unit", self.cb_ov_unit.currentData()),
                             ("table_percent", True), ("table_head1", "Нэр")):
                self._bindings[key][1](val)

    def _overlap_summary(self, res):
        hit = sum(1 for u in res.units if u.name != overlap.REST)
        txt = "Судалгааны талбай: <b>{}</b> га · давхцсан нэгж: <b>{}</b>".format(
            f"{res.target_ha:,.2f}".replace(",", " "), hit)
        if res.nested:
            txt += (" · <i>давхар нэгжүүд (жишээ нь аймаг ⊃ сум ⊃ баг) илэрсэн тул "
                    "шатлалаар харууллаа</i>")
        return txt

    def _overlap_run(self):
        target = self.lc_ov_target.currentLayer()
        bound = self.lc_ov_bound.currentLayer()
        if not isinstance(target, QgsVectorLayer) or not isinstance(bound, QgsVectorLayer):
            QMessageBox.information(self, "Давхцал", "Судалгааны талбай болон хилийн "
                                                    "давхаргаа сонгоно уу.")
            return None
        if target.id() == bound.id():
            QMessageBox.information(self, "Давхцал", "Судалгааны талбай, хилийн давхарга "
                                                    "хоёр өөр байх ёстой.")
            return None
        name_field = self.fc_ov_name.currentField()
        res = self._overlap_compute(target, bound, name_field)
        if res is None:
            return None
        self._overlap_show_rows([res])
        self._multi_results = []
        if res.error:
            self.lbl_overlap.setText(f"<span style='color:#b00'>{res.error}</span>")
            if res.layer is None or not res.rows:
                return res
        else:
            self.lbl_overlap.setText(self._overlap_summary(res))
        s = self.settings()
        self._loading = True
        try:
            self._overlap_place(res, bound, name_field, s)
        finally:
            self._loading = False
        self._legend_mark_dirty()
        self.rebuild()
        return res

    # ---- Олон хилийг нэг дор ------------------------------------------------
    def _multi_group(self):
        g = QGroupBox("Олон хилийг нэг дор тооцоолох")
        v = QVBoxLayout(g)
        note = QLabel("Чагталсан хил бүртэй (аймаг, сум, лиценз, ТХГ …) ээлжлэн давхцуулж, "
                      "тус бүрийн үр дүнг гаргана. Дараа нь сэдэвчилсэн зургуудыг нэг дор "
                      "цувралаар гаргаж болно.")
        note.setWordWrap(True)
        v.addWidget(note)
        t = QTableWidget(0, 2)
        t.setHorizontalHeaderLabels(["Хилийн давхарга", "Нэрийн талбар"])
        t.horizontalHeader().setSectionResizeMode(0, QHeaderView.ResizeMode.Stretch)
        t.horizontalHeader().setSectionResizeMode(1, QHeaderView.ResizeMode.Stretch)
        t.verticalHeader().setVisible(False)
        t.setEditTriggers(QTableWidget.EditTrigger.NoEditTriggers)
        t.setMinimumHeight(110)
        self.tbl_multi = t
        v.addWidget(t)
        h = QHBoxLayout()
        b = QPushButton("Жагсаалт шинэчлэх")
        b.clicked.connect(self._multi_fill)
        h.addWidget(b)
        b = QPushButton("Чагталсан бүх хилээр тооцоолох")
        b.clicked.connect(self._multi_run)
        h.addWidget(b)
        v.addLayout(h)
        self.btn_multi_batch = QPushButton("Сэдэвчилсэн зургуудыг цувралаар гаргах…")
        self.btn_multi_batch.setToolTip(
            "Үр дүн бүрийг тусдаа зураг болгох жагсаалтыг «Цуврал» табд бэлдэнэ")
        self.btn_multi_batch.setEnabled(False)
        self.btn_multi_batch.clicked.connect(self._multi_to_batch)
        v.addWidget(self.btn_multi_batch)
        self._multi_results = []
        return g

    def _multi_fill(self):
        prj = QgsProject.instance()
        t = self.tbl_multi
        checked = set()
        for r in range(t.rowCount()):
            it = t.item(r, 0)
            if it is not None and it.checkState() == Qt.CheckState.Checked:
                checked.add(it.data(Qt.ItemDataRole.UserRole))
        target = self.lc_ov_target.currentLayer()
        t.setRowCount(0)
        for node in prj.layerTreeRoot().findLayers():
            lyr = node.layer()
            if not isinstance(lyr, QgsVectorLayer) or lyr.customProperty(overlap.ROLE):
                continue
            if lyr.customProperty("numan_map_maker/vertices"):
                continue
            if lyr.geometryType() not in (QgsWkbTypes.PolygonGeometry,
                                          QgsWkbTypes.LineGeometry):
                continue
            if target is not None and lyr.id() == target.id():
                continue
            r = t.rowCount()
            t.insertRow(r)
            it = QTableWidgetItem(lyr.name())
            it.setData(Qt.ItemDataRole.UserRole, lyr.id())
            it.setFlags(it.flags() | Qt.ItemFlag.ItemIsUserCheckable)
            it.setCheckState(Qt.CheckState.Checked if lyr.id() in checked
                             else Qt.CheckState.Unchecked)
            t.setItem(r, 0, it)
            fc = QgsFieldComboBox()
            fc.setAllowEmptyFieldName(True)
            fc.setLayer(lyr)
            fc.setField(overlap.guess_name_field(lyr))
            t.setCellWidget(r, 1, fc)

    def _multi_checked(self):
        prj = QgsProject.instance()
        out = []
        t = self.tbl_multi
        for r in range(t.rowCount()):
            it = t.item(r, 0)
            if it is None or it.checkState() != Qt.CheckState.Checked:
                continue
            lyr = prj.mapLayer(it.data(Qt.ItemDataRole.UserRole))
            fc = t.cellWidget(r, 1)
            if isinstance(lyr, QgsVectorLayer):
                out.append((lyr, fc.currentField() if fc is not None else ""))
        return out

    def _multi_run(self):
        target = self.lc_ov_target.currentLayer()
        if not isinstance(target, QgsVectorLayer):
            QMessageBox.information(self, "Давхцал", "Судалгааны талбайгаа сонгоно уу.")
            return []
        todo = [(b, f) for b, f in self._multi_checked() if b.id() != target.id()]
        if not todo:
            QMessageBox.information(self, "Давхцал", "Жагсаалтаас хилийн давхаргуудаа "
                                                    "чагтална уу.")
            return []
        results, failed = [], []
        s = self.settings()
        for bound, name_field in todo:
            res = self._overlap_compute(target, bound, name_field)
            if res is None:            # зогсоосон
                break
            if res.layer is None or not res.units:
                failed.append(f"{bound.name()}: {res.error or 'давхцал алга'}")
                continue
            self._loading = True
            try:
                self._overlap_place(res, bound, name_field, s)
            finally:
                self._loading = False
            results.append(res)
        self._multi_results = results
        self._overlap_show_rows(results)
        msg = f"{len(results)} хилтэй давхцлыг тооцооллоо."
        if results:
            msg += " Сүүлийнх нь зураг дээр харагдаж байна."
        if failed:
            msg += "<br><span style='color:#b00'>" + "<br>".join(failed) + "</span>"
        self.lbl_overlap.setText(msg)
        self.btn_multi_batch.setEnabled(len(results) > 0)
        self._legend_mark_dirty()
        self.rebuild()
        return results

    def _multi_to_batch(self):
        prj = QgsProject.instance()
        ids = {r.layer.id() for r in self._multi_results
               if r.layer is not None and prj.mapLayer(r.layer.id()) is not None}
        if not ids:
            return
        i = self.cb_batch_mode.findData("layers")
        self.cb_batch_mode.setCurrentIndex(i)
        self._batch_fill_layers()
        lw = self.lw_batch_layers
        for k in range(lw.count()):
            it = lw.item(k)
            it.setCheckState(Qt.CheckState.Checked if it.data(Qt.ItemDataRole.UserRole) in ids
                             else Qt.CheckState.Unchecked)
        self._batch_plan()
        for k in range(self.tabs.count()):
            if self.tabs.tabText(k) == "Цуврал":
                self.tabs.setCurrentIndex(k)
        self.lbl_status.setText("«Цуврал» табд сэдэвчилсэн зургуудын жагсаалт бэлэн боллоо — "
                                "«Цувралаар экспортлох…» дарна уу.")

    def _overlap_clear(self):
        prj = QgsProject.instance()
        ids = [l.id() for l in prj.mapLayers().values() if l.customProperty(overlap.ROLE)]
        if not ids:
            return
        self._loading = True
        try:
            prj.removeMapLayers(ids)
            self._bindings["table"][1](False)
        finally:
            self._loading = False
        self._overlap_layer_id = ""
        self.tbl_overlap.setRowCount(0)
        self.lbl_overlap.setText("")
        self._legend_mark_dirty()
        self.rebuild()

    # ==================================================================
    # Шууд хэвлэх
    # ==================================================================
    def _page_layout(self):
        page = self.layout_.pageCollection().page(0)
        size = page.pageSize()
        w, h = size.width(), size.height()
        orient = QPageLayout.Orientation.Landscape if w > h else QPageLayout.Orientation.Portrait
        return QPageLayout(QPageSize(QSizeF(min(w, h), max(w, h)), QPageSize.Unit.Millimeter),
                           orient, QMarginsF(0, 0, 0, 0), QPageLayout.Unit.Millimeter)

    def _print_to(self, printer):
        """Одоогийн зургийг өгөгдсөн хэвлэгч рүү илгээнэ. Үр дүнгийн код буцаана."""
        clone = self.layout_.clone()
        exporter = QgsLayoutExporter(clone)
        self._settle()
        ps = QgsLayoutExporter.PrintExportSettings()
        ps.dpi = self.sp_dpi.value()
        try:
            return exporter.print(printer, ps)
        finally:
            del exporter
            clone.deleteLater()

    def print_map(self):
        self._job_override = None
        self.rebuild()
        printer = QPrinter(QPrinter.PrinterMode.HighResolution)
        printer.setPageLayout(self._page_layout())
        printer.setFullPage(True)
        printer.setDocName(self.settings()["title"].strip().split("\n")[0] or "Газрын зураг")
        dlg = QPrintDialog(printer, self)
        dlg.setWindowTitle("Газрын зураг хэвлэх")
        accepted = (dlg.exec if hasattr(dlg, "exec") else dlg.exec_)()
        if not accepted:
            return
        QApplication.setOverrideCursor(Qt.CursorShape.WaitCursor)
        self.lbl_status.setText("Хэвлэж байна…")
        QApplication.processEvents()
        try:
            res = self._print_to(printer)
        except Exception as e:
            res = None
            err = str(e)
        finally:
            QApplication.restoreOverrideCursor()
        if res == QgsLayoutExporter.Success:
            self._after_export(1)
            self.lbl_status.setText(f"Хэвлэгч рүү илгээлээ: {printer.printerName() or 'PDF'}")
        else:
            msg = "Хэвлэж чадсангүй." + (f"\n{err}" if res is None else "") + \
                "\n\nХэвлэгч холбогдсон эсэхийг шалгах эсвэл PDF-ээр экспортлоод хэвлэнэ үү."
            self.lbl_status.setText("<span style='color:#b00'>Хэвлэж чадсангүй.</span>")
            QMessageBox.warning(self, "Хэвлэх", msg)

    # ==================================================================
    # Тусламж
    # ==================================================================
    def show_help(self):
        dlg = getattr(self, "_help_dialog", None)
        if dlg is None:
            dlg = QDialog(self)
            dlg.setWindowTitle("Тусламж — Газрын зураг бэлтгэгч")
            lay = QVBoxLayout(dlg)
            tb = QTextBrowser()
            tb.setOpenExternalLinks(True)
            tb.setHtml(HELP_HTML)
            lay.addWidget(tb)
            bb = QDialogButtonBox(QDialogButtonBox.StandardButton.Close)
            bb.rejected.connect(dlg.close)
            lay.addWidget(bb)
            dlg.resize(640, min(620, max(360, self.height() - 40)))
            self._help_dialog = dlg
        dlg.show()
        dlg.raise_()
        dlg.activateWindow()
