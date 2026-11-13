# -*- coding: utf-8 -*-
"""Үндсэн цонхны нэмэлт боломжууд (MapMakerDialog-д mixin хэлбэрээр холбогдоно):

бэлэн загварын сан, зургийн автомат дугаар, байршлын жижиг зураг, лого,
мэдээллийн хүснэгт, давхаргын стандарт загвар, цуврал экспорт, Excel гаргалт.
"""
import os

from qgis.PyQt.QtCore import Qt, QUrl
from qgis.PyQt.QtWidgets import (
    QApplication,
    QCheckBox,
    QComboBox,
    QFileDialog,
    QFormLayout,
    QGroupBox,
    QHBoxLayout,
    QInputDialog,
    QLabel,
    QLineEdit,
    QListWidget,
    QListWidgetItem,
    QMessageBox,
    QProgressDialog,
    QPushButton,
    QSpinBox,
    QStackedWidget,
    QVBoxLayout,
    QWidget,
)
from qgis.core import (
    QgsLayoutExporter,
    QgsMapLayerProxyModel,
    QgsPrintLayout,
    QgsProject,
    QgsSettings,
    QgsVectorLayer,
)
from qgis.gui import QgsFieldComboBox, QgsMapLayerComboBox

from . import basemaps, batch, composer, fastload, legend_edit, styles, table_export, templates

POSITIONS = [("Зүүн дээд", "TL"), ("Баруун дээд", "TR"),
             ("Зүүн доод", "BL"), ("Баруун доод", "BR")]

TOKEN_TIP = ("Тэмдэглэгээ: {name} — цуврал зургийн объект/давхаргын нэр, {n} — зургийн "
             "дугаар, {layer} — давхаргын нэр, {date} — өнөөдрийн огноо, {project} — "
             "төслийн нэр.")


def _combo(pairs):
    cb = QComboBox()
    for text, data in pairs:
        cb.addItem(text, data)
    return cb


class ExtrasMixin:
    # ==================================================================
    # 2. Бэлэн загварын сан
    # ==================================================================
    def _template_bar(self):
        row = QHBoxLayout()
        row.addWidget(QLabel("Загвар:"))
        self.cb_template = QComboBox()
        # Урт нэртэй загвар зүүн самбарыг (цонхыг) тэлэхээс сэргийлнэ
        self.cb_template.setSizeAdjustPolicy(
            QComboBox.SizeAdjustPolicy.AdjustToMinimumContentsLengthWithIcon)
        self.cb_template.setMinimumContentsLength(8)
        self.cb_template.setToolTip(
            "Хуудас, байрлал, фонт зэргийг нэг дор тохируулна. Төслийн давхарга, фото, "
            "таних тэмдгийн дараалалд хүрэхгүй.")
        row.addWidget(self.cb_template, 1)
        b = QPushButton("Хэрэглэх")
        b.clicked.connect(self._template_apply)
        row.addWidget(b)
        b = QPushButton("＋")
        b.setToolTip("Одоогийн тохиргоог «Миний загвар» болгон нэртэй хадгална")
        b.setFixedWidth(32)
        b.clicked.connect(self._template_save)
        row.addWidget(b)
        b = QPushButton("−")
        b.setToolTip("Сонгосон «Миний загвар»-ыг устгана")
        b.setFixedWidth(32)
        b.clicked.connect(self._template_delete)
        row.addWidget(b)
        self._template_refresh()
        return row

    def _template_refresh(self, select=None):
        cb = self.cb_template
        cb.blockSignals(True)
        cb.clear()
        for name in templates.BUILTIN:
            cb.addItem(name, ("builtin", name))
        user = templates.list_user()
        if user:
            cb.insertSeparator(cb.count())
            for name in user:
                cb.addItem("★ " + name, ("user", name))
        if select:
            for i in range(cb.count()):
                d = cb.itemData(i)
                if d and d[1] == select:
                    cb.setCurrentIndex(i)
        cb.blockSignals(False)

    def _template_apply(self):
        d = self.cb_template.currentData()
        if not d:
            return
        try:
            tpl = templates.load(d[1])
        except Exception as e:
            QMessageBox.warning(self, "Бэлэн загвар", f"Загварыг уншиж чадсангүй:\n{e}")
            return
        if not tpl:
            return
        s = self.settings()
        s.update(tpl)
        self._apply_settings(s)
        self.reset_positions()
        self.lbl_status.setText(f"Загвар хэрэглэгдлээ: {d[1]}")

    def _template_save(self):
        name, ok = QInputDialog.getText(self, "Миний загвар", "Загварын нэр:")
        name = (name or "").strip()
        if not ok or not name:
            return
        try:
            templates.save_user(name, self.settings())
        except OSError as e:
            QMessageBox.warning(self, "Миний загвар", f"Хадгалж чадсангүй:\n{e}")
            return
        self._template_refresh(select=name)
        self.lbl_status.setText(f"«{name}» загвар хадгалагдлаа.")

    def _template_delete(self):
        d = self.cb_template.currentData()
        if not d or d[0] != "user":
            self.lbl_status.setText("Зөвхөн ★ тэмдэгтэй «Миний загвар»-ыг устгаж болно.")
            return
        if QMessageBox.question(self, "Миний загвар", f"«{d[1]}» загварыг устгах уу?") \
                != QMessageBox.StandardButton.Yes:
            return
        templates.delete_user(d[1])
        self._template_refresh()

    # ==================================================================
    # 5. Зургийн автомат дугаар
    # ==================================================================
    def _caption_number_rows(self, form):
        ch = QCheckBox("Зургийн дугаарыг автоматаар бичих")
        ch.setToolTip("Тайлбарын өмнө «Зураг 1.66.» хэлбэрийн дугаар нэмнэ.")
        self._bind("caption_auto", ch)
        form.addRow(ch)
        h = QHBoxLayout()
        le = QLineEdit()
        le.setFixedWidth(70)
        self._bind("caption_prefix", le)
        h.addWidget(le)
        le = QLineEdit()
        le.setFixedWidth(46)
        le.setToolTip("Бүлгийн дугаар. Хоосон бол «Зураг 66.» гэж бичнэ.")
        self._bind("fig_chapter", le)
        h.addWidget(le)
        h.addWidget(QLabel("."))
        sp = QSpinBox()
        sp.setRange(1, 9999)
        self._bind("fig_no", sp)
        self.sp_fig_no = sp
        h.addWidget(sp)
        h.addStretch(1)
        form.addRow("Дугаар:", h)
        ch = QCheckBox("Экспорт бүрийн дараа дугаарыг нэгээр нэмэх")
        self._bind("fig_increment", ch)
        form.addRow(ch)
        tip = QLabel(TOKEN_TIP)
        tip.setWordWrap(True)
        tip.setStyleSheet("color:#666")
        form.addRow(tip)

    def _after_export(self, count=1):
        s = self.settings()
        if s["caption_auto"] and s["fig_increment"] and count > 0:
            self.sp_fig_no.setValue(int(s["fig_no"]) + count)

    # ==================================================================
    # 4, 6. Байршлын жижиг зураг, лого, мэдээллийн хүснэгт
    # ==================================================================
    def _tab_extras(self):
        w = QWidget()
        v = QVBoxLayout(w)

        g = QGroupBox("Байршлын жижиг зураг")
        g.setCheckable(True)
        self._bind("inset", g)
        f = QFormLayout(g)
        note = QLabel("Судалгааны талбай улс, бүс нутгийн хаана байгааг улаан хүрээ "
                      "(жижиг бол улаан цэг)-ээр харуулна.")
        note.setWordWrap(True)
        f.addRow(note)
        cb = _combo([("Монгол улс бүхэлдээ", "mongolia"),
                     ("Үндсэн зургаас N дахин өргөн", "factor"),
                     ("Сонгосон давхаргын хүрээ", "layer")])
        self._bind("inset_extent", cb)
        f.addRow("Хамрах хүрээ:", cb)
        sp = self._dspin(1.5, 500, 1, 1, " дахин")
        self._bind("inset_factor", sp)
        f.addRow("Өргөтгөл:", sp)
        lc = QgsMapLayerComboBox()
        lc.setAllowEmptyLayer(True)
        lc.setToolTip("Жижиг зурагт харуулах давхарга (жишээ нь аймаг, сумын хил). "
                      "Заавал биш.")
        self._bind("inset_layer", lc)
        f.addRow("Давхарга:", lc)
        cb = QComboBox()
        cb.addItem("Фонгүй", "")
        for key, (name, _grp, _u, _z, _a) in basemaps.BASEMAPS.items():
            cb.addItem(name, key)
        self._bind("inset_base", cb)
        f.addRow("Фон:", cb)
        cb = _combo(POSITIONS)
        self._bind("inset_pos", cb)
        f.addRow("Байрлал:", cb)
        sp = self._dspin(20, 400, 5, 0, " мм")
        self._bind("inset_size", sp)
        f.addRow("Өргөн:", sp)
        v.addWidget(g)

        g = QGroupBox("Лого")
        f = QFormLayout(g)
        h = QHBoxLayout()
        le = QLineEdit()
        le.setPlaceholderText("Зургийн файл (PNG, JPG, SVG)")
        self._bind("logo", le)
        self.le_logo = le
        h.addWidget(le, 1)
        b = QPushButton("…")
        b.setFixedWidth(32)
        b.clicked.connect(self._pick_logo)
        h.addWidget(b)
        f.addRow("Файл:", h)
        cb = _combo(POSITIONS)
        self._bind("logo_pos", cb)
        f.addRow("Байрлал:", cb)
        sp = self._dspin(5, 300, 2, 0, " мм")
        self._bind("logo_size", sp)
        f.addRow("Өргөн:", sp)
        v.addWidget(g)

        g = QGroupBox("Мэдээллийн хүснэгт")
        g.setCheckable(True)
        self._bind("info", g)
        f = QFormLayout(g)
        le = QLineEdit()
        le.setPlaceholderText("Жишээ: Нуман-Алтай ХХК")
        self._bind("info_org", le)
        f.addRow("Гүйцэтгэгч:", le)
        le = QLineEdit()
        self._bind("info_author", le)
        f.addRow("Зураг үйлдсэн:", le)
        le = QLineEdit()
        le.setPlaceholderText("Хоосон бол өнөөдрийн огноо")
        self._bind("info_date", le)
        f.addRow("Огноо:", le)
        ch = QCheckBox("Проекцийг бичих")
        self._bind("info_crs", ch)
        f.addRow(ch)
        ch = QCheckBox("Масштабыг бичих")
        self._bind("info_scale", ch)
        f.addRow(ch)
        le = QLineEdit()
        self._bind("info_source", le)
        f.addRow("Эх сурвалж:", le)
        cb = _combo(POSITIONS)
        self._bind("info_pos", cb)
        f.addRow("Байрлал:", cb)
        sp = self._dspin(4, 40, 0.5, 1, " pt")
        self._bind("info_font_size", sp)
        f.addRow("Бичгийн хэмжээ:", sp)
        v.addWidget(g)

        g = QGroupBox("Кэш (хөрвүүлсэн түр файлууд)")
        gv = QVBoxLayout(g)
        note = QLabel("Том хилийн файл, KMZ, хадгалах газар заагаагүй офлайн зургийн "
                      "хөрвүүлсэн хуулбарууд энд хадгалагддаг. Цэвэрлэвэл дараа хэрэг болоход "
                      "дахин хөрвүүлнэ; эх файлууд хэвээр үлдэнэ.")
        note.setWordWrap(True)
        gv.addWidget(note)
        self.lbl_cache = QLabel("")
        self.lbl_cache.setTextInteractionFlags(Qt.TextInteractionFlag.TextSelectableByMouse)
        self.lbl_cache.setWordWrap(True)
        gv.addWidget(self.lbl_cache)
        h = QHBoxLayout()
        b = QPushButton("Хэмжээг шинэчлэх")
        b.clicked.connect(self._cache_refresh)
        h.addWidget(b)
        b = QPushButton("Хавтас нээх")
        b.clicked.connect(self._cache_open)
        h.addWidget(b)
        b = QPushButton("Кэш цэвэрлэх…")
        b.clicked.connect(self._cache_clear)
        h.addWidget(b)
        gv.addLayout(h)
        v.addWidget(g)

        g = QGroupBox("Онлайн суурь зургийн кэш")
        gv = QVBoxLayout(g)
        note = QLabel(
            "Google, Esri, OSM зэргээс нэг удаа татсан зургийн хэсгүүдийг диск дээр хадгалж, "
            "дараа нь интернэтээс дахин татахгүй (холболтгүй үед ч) ашиглана. QGIS анхдагчаар "
            "ердөө 50 МБ-ыг 24 цаг хадгалдаг.")
        note.setWordWrap(True)
        gv.addWidget(note)
        f = QFormLayout()
        self.cb_tile_cache = _combo([
            ("QGIS-ийн анхдагч (хүрэхгүй)", 0), ("500 МБ", 500), ("1 ГБ", 1024),
            ("2 ГБ", 2048), ("5 ГБ", 5120), ("10 ГБ", 10240)])
        i = self.cb_tile_cache.findData(fastload.tile_cache_setting())
        self.cb_tile_cache.setCurrentIndex(i if i >= 0 else 2)
        self.cb_tile_cache.setToolTip(
            "Сонгосон хэмжээ хүртэл, 30 хоног хадгална. Энэ нь QGIS-ийн ерөнхий тохиргоо "
            "тул QGIS-ийн үндсэн цонхны суурь зурагт ч үйлчилнэ.")
        self.cb_tile_cache.currentIndexChanged.connect(self._tile_cache_changed)
        f.addRow("Дээд хэмжээ:", self.cb_tile_cache)
        gv.addLayout(f)
        self.lbl_tile_cache = QLabel("")
        gv.addWidget(self.lbl_tile_cache)
        b = QPushButton("Суурь зургийн кэш цэвэрлэх…")
        b.clicked.connect(self._tile_cache_clear)
        gv.addWidget(b)
        v.addWidget(g)
        fastload.apply_tile_cache()
        self._cache_refresh()
        v.addStretch(1)
        return w

    def _tile_cache_changed(self, *_):
        fastload.apply_tile_cache(self.cb_tile_cache.currentData(), save=True)
        self._cache_refresh()

    def _tile_cache_clear(self):
        size, _mx = fastload.tile_cache_info()
        if size <= 0:
            self.lbl_status.setText("Суурь зургийн кэш хоосон байна.")
            return
        box = QMessageBox(self)
        box.setIcon(QMessageBox.Icon.Warning)
        box.setWindowTitle("Суурь зургийн кэш цэвэрлэх")
        box.setText(f"<b>Татаж хадгалсан суурь зургийн хэсгүүд ({fastload.format_size(size)}) "
                    "бүгд устах гэж байна.</b>")
        box.setInformativeText(
            "Анхаар:\n"
            "– Дараа нь суурь зураг харуулахад интернэтээс дахин татна; холболтгүй үед "
            "суурь зураг хоосон харагдана.\n"
            "– Энэ нь QGIS-ийн ерөнхий сүлжээний кэш тул QGIS-ийн үндсэн цонхны суурь "
            "зураг, WMS давхаргын кэш ч мөн устана.\n\n"
            "Устахгүй зүйлс: таны файлууд, офлайн зураг (.sqlitedb, .mbtiles), "
            "хөрвүүлсэн хилийн давхаргууд.")
        yes = box.addButton("Устгах", QMessageBox.ButtonRole.DestructiveRole)
        no = box.addButton("Болих", QMessageBox.ButtonRole.RejectRole)
        box.setDefaultButton(no)
        box.setEscapeButton(no)
        (box.exec if hasattr(box, "exec") else box.exec_)()
        if box.clickedButton() is not yes:
            return
        freed = fastload.clear_tile_cache()
        self._cache_refresh()
        self.lbl_status.setText(
            f"Суурь зургийн кэш цэвэрлэлээ: {fastload.format_size(freed)} чөлөөллөө.")

    def _cache_refresh(self):
        try:
            size, count = fastload.cache_usage()
            self.lbl_cache.setText(
                f"<b>{fastload.format_size(size)}</b> · {count} файл<br>"
                f"<span style='color:#666'>{fastload.cache_dir()}</span>")
        except Exception as e:
            self.lbl_cache.setText(f"Хэмжээг тооцож чадсангүй: {e}")
        try:
            size, mx = fastload.tile_cache_info()
            self.lbl_tile_cache.setText(
                f"Одоо: <b>{fastload.format_size(size)}</b> / дээд хязгаар "
                f"{fastload.format_size(mx)}")
        except (AttributeError, RuntimeError):
            pass

    def _cache_open(self):
        from qgis.PyQt.QtGui import QDesktopServices
        QDesktopServices.openUrl(QUrl.fromLocalFile(fastload.cache_dir()))

    def _cache_confirm(self, delete, kept):
        """Юу устах, юу үлдэхийг жагсааж анхааруулна. Зөвшөөрвөл True."""
        fmt = fastload.format_size
        kinds = {}
        for path, size in delete:
            k = kinds.setdefault(fastload.file_kind(path), [0, 0])
            k[0] += 1
            k[1] += size
        lines = [f"• {name}: {n} файл, {fmt(sz)}" for name, (n, sz) in kinds.items()]
        total = sum(sz for _p, sz in delete)

        box = QMessageBox(self)
        box.setIcon(QMessageBox.Icon.Warning)
        box.setWindowTitle("Кэш цэвэрлэх")
        box.setText(f"<b>{len(delete)} файл ({fmt(total)}) бүрмөсөн устах гэж байна:</b>")
        info = "\n".join(lines) + "\n\n"
        info += ("Анхаар:\n"
                 "– Устгасан файлыг сэргээх боломжгүй (хогийн сав руу орохгүй).\n"
                 "– Эдгээрийг ашиглаж хадгалсан БУСАД төслийг нээхэд тухайн давхарга "
                 "«эвдэрсэн» харагдана; хилийн файлаа «Хилийн файл нэмэх…»-ээр дахин "
                 "нэмж засна.\n"
                 "– Дараа хэрэг болоход дахин хөрвүүлэх тул том файлд хугацаа орно.\n\n"
                 "Устахгүй зүйлс:\n"
                 "– Таны эх файлууд (KML, KMZ, GeoJSON, SHP, .sqlitedb).\n"
                 "– Өөрийн заасан газарт хадгалсан офлайн зураг (.mbtiles).\n")
        if kept:
            info += (f"– Одоогийн төсөлд ашиглагдаж буй {len(kept)} файл "
                     f"({fmt(sum(sz for _p, sz in kept))}).\n")
        info += "\nФайлын бүрэн жагсаалтыг «Show Details…» товчоор харна."
        box.setInformativeText(info)
        detail = ["УСТГАХ ФАЙЛУУД:"]
        detail += [f"  {os.path.basename(p)}  —  {fmt(sz)}  ({fastload.file_kind(p)})"
                   for p, sz in delete]
        if kept:
            detail += ["", "ҮЛДЭХ ФАЙЛУУД (одоогийн төсөлд ашиглагдаж байна):"]
            detail += [f"  {os.path.basename(p)}  —  {fmt(sz)}" for p, sz in kept]
        detail += ["", "Хавтас: " + fastload.cache_dir()]
        box.setDetailedText("\n".join(detail))
        yes = box.addButton("Устгах", QMessageBox.ButtonRole.DestructiveRole)
        no = box.addButton("Болих", QMessageBox.ButtonRole.RejectRole)
        box.setDefaultButton(no)
        box.setEscapeButton(no)
        self._cache_box = box            # тест болон дахин ашиглахад
        (box.exec if hasattr(box, "exec") else box.exec_)()
        return box.clickedButton() is yes

    def _cache_clear(self):
        delete, kept = fastload.cache_plan(QgsProject.instance())
        if not delete:
            self._cache_refresh()
            if kept:
                QMessageBox.information(
                    self, "Кэш цэвэрлэх",
                    f"Устгах файл алга. Кэшид байгаа {len(kept)} файл бүгд одоогийн төсөлд "
                    "ашиглагдаж байна; төслөө хаасны дараа цэвэрлэж болно.")
            else:
                self.lbl_status.setText("Кэш хоосон байна.")
            return
        if not self._cache_confirm(delete, kept):
            return
        try:
            freed, removed, skipped = fastload.clear_cache(QgsProject.instance())
        except Exception as e:
            QMessageBox.warning(self, "Кэш цэвэрлэх", f"Цэвэрлэж чадсангүй:\n{e}")
            return
        self._cache_refresh()
        msg = f"Кэш цэвэрлэлээ: {removed} файл, {fastload.format_size(freed)} чөлөөллөө."
        if skipped:
            msg += f" Ашиглагдаж буй {skipped} файл үлдлээ."
        self.lbl_status.setText(msg)

    @staticmethod
    def _dspin(lo, hi, step=1.0, decimals=1, suffix=""):
        from qgis.PyQt.QtWidgets import QDoubleSpinBox
        sp = QDoubleSpinBox()
        sp.setRange(lo, hi)
        sp.setSingleStep(step)
        sp.setDecimals(decimals)
        if suffix:
            sp.setSuffix(suffix)
        return sp

    def _pick_logo(self):
        path, _ = QFileDialog.getOpenFileName(
            self, "Лого сонгох", os.path.dirname(self.le_logo.text()),
            "Зураг (*.png *.jpg *.jpeg *.svg *.bmp *.tif);;Бүх файл (*)")
        if path:
            self.le_logo.setText(path)

    # ==================================================================
    # 3. Давхаргын стандарт загвар
    # ==================================================================
    def _style_buttons(self):
        h = QHBoxLayout()
        b = QPushButton("Стандарт загвар оноох")
        b.setToolTip(
            "Давхаргын нэр дэх түлхүүр үгээр (гол, зам, хил, нуур, ТХГ, түймэр, лиценз …) "
            "таньж тогтсон өнгө, дүрсийг онооно. Зөвхөн нэг тэмдэгтэй давхаргад хэрэглэнэ; "
            "ангилсан загварт хүрэхгүй. «Анхных руу» товчоор буцаана.")
        b.clicked.connect(self._styles_apply)
        h.addWidget(b)
        b = QPushButton("Сонгосныг санд хадгалах…")
        b.setToolTip("Сонгосон давхаргын одоогийн загварыг түлхүүр үгтэй нь өөрийн санд "
                     "хадгална. Дараагийн төсөлд ижил нэртэй давхаргад автоматаар таарна.")
        b.clicked.connect(self._styles_save)
        h.addWidget(b)
        h.addStretch(1)
        return h

    def _styles_apply(self):
        done, skipped = [], 0
        self._loading = True
        try:
            for lyr in legend_edit.editable_layers(QgsProject.instance()):
                if not isinstance(lyr, QgsVectorLayer) or lyr.renderer() is None:
                    continue
                backup = lyr.renderer().clone()
                rule = styles.apply(lyr)
                if rule:
                    self._style_backup.setdefault(lyr.id(), backup)
                    done.append(f"{lyr.name()} → {rule}")
                else:
                    skipped += 1
        finally:
            self._loading = False
        if done:
            QgsProject.instance().setDirty(True)
            self._refresh_legend_editor(force=True)
            self._changed()
            QMessageBox.information(
                self, "Стандарт загвар",
                "Загвар оноосон давхаргууд:\n\n" + "\n".join(done)
                + (f"\n\nТаараагүй эсвэл ангилсан загвартай: {skipped}" if skipped else ""))
        else:
            QMessageBox.information(
                self, "Стандарт загвар",
                "Нэрээр нь таних давхарга олдсонгүй.\n\nДавхаргын нэрэнд «гол», «зам», "
                "«хил», «нуур», «ТХГ», «түймэр», «лиценз», «судалгааны талбай» зэрэг үг "
                "байвал таарна. Эсвэл давхаргаа загварчлаад «Сонгосныг санд хадгалах…» "
                "товчоор өөрийн дүрмийг нэмнэ.")

    def _styles_save(self):
        ids = self._legend_selected_layer_ids()
        layer = QgsProject.instance().mapLayer(ids[0]) if ids else None
        if layer is None:
            self.lbl_status.setText("Эхлээд жагсаалтаас давхаргаа сонгоно уу.")
            return
        text, ok = QInputDialog.getText(
            self, "Загварын санд хадгалах",
            "Давхаргын нэрэнд ямар үг байвал энэ загварыг оноох вэ?\n"
            "(олон үгийг таслалаар тусгаарлана)",
            text=layer.name().lower())
        if not ok or not text.strip():
            return
        if styles.save_layer_style(layer, text.split(","), layer.name()):
            self.lbl_status.setText(f"«{layer.name()}» давхаргын загвар санд хадгалагдлаа.")
        else:
            QMessageBox.information(
                self, "Загварын сан",
                "Зөвхөн нэг тэмдэгтэй (Single symbol) вектор давхаргын загварыг хадгална.")

    # ==================================================================
    # 7. Талбайн хүснэгтийг Excel рүү
    # ==================================================================
    def _table_export_button(self):
        b = QPushButton("Хүснэгтийг Excel рүү гаргах…")
        b.setToolTip("Талбайн хүснэгтийг .xlsx (эсвэл .csv) файл болгон хадгална.")
        b.clicked.connect(self._table_export)
        return b

    def _table_export(self):
        s = self.settings()
        layer = QgsProject.instance().mapLayer(s["table_layer"])
        if not isinstance(layer, QgsVectorLayer):
            QMessageBox.information(self, "Excel", "Эхлээд полигон давхаргаа сонгоно уу.")
            return
        st = QgsSettings()
        folder = st.value("numan_map_maker/export_dir", "") or \
            QgsProject.instance().homePath() or os.path.expanduser("~")
        path, _ = QFileDialog.getSaveFileName(
            self, "Талбайн хүснэгт хадгалах",
            os.path.join(folder, f"{layer.name()}_talbai.xlsx"),
            "Excel (*.xlsx);;CSV (*.csv)")
        if not path:
            return
        if not os.path.splitext(path)[1]:
            path += ".xlsx"
        try:
            out = self._write_table(path, layer, s)
        except Exception as e:
            QMessageBox.warning(self, "Excel", f"Хадгалж чадсангүй:\n{e}")
            return
        note = "" if out == path else " (энэ QGIS-д XLSX бичигч байхгүй тул CSV болголоо)"
        url = QUrl.fromLocalFile(out).toString()
        self.lbl_status.setText(
            f"Хүснэгт хадгаллаа: <a href='{url}'>{os.path.basename(out)}</a>{note}")

    @staticmethod
    def _write_table(path, layer, s):
        head1, head2, rows, total = composer.table_data(QgsProject.instance(), layer, s)
        return table_export.write(path, head1, head2, rows, total,
                                  int(s["table_decimals"]), bool(s["table_total"]),
                                  bool(s.get("table_percent")))

    # ==================================================================
    # 1. Цуврал зураг
    # ==================================================================
    def _tab_batch(self):
        w = QWidget()
        v = QVBoxLayout(w)
        note = QLabel(
            "Одоогийн тохиргоогоор олон зургийг нэг дор гаргана. Гарчиг, тайлбартаа "
            "{name} гэж бичвэл зураг бүрд объект/давхаргын нэрээр солигдоно.")
        note.setWordWrap(True)
        v.addWidget(note)

        f = QFormLayout()
        self.cb_batch_mode = _combo([
            ("Объект бүрээр (талбай, сум, цэг …)", "features"),
            ("Давхарга бүрээр (сэдэвчилсэн зураг)", "layers")])
        f.addRow("Горим:", self.cb_batch_mode)
        v.addLayout(f)

        self.stack_batch = QStackedWidget()
        # -- объект бүрээр
        p = QWidget()
        pf = QFormLayout(p)
        pf.setContentsMargins(0, 0, 0, 0)
        self.lc_batch = QgsMapLayerComboBox()
        self.lc_batch.setFilters(QgsMapLayerProxyModel.VectorLayer)
        pf.addRow("Давхарга:", self.lc_batch)
        self.fc_batch = QgsFieldComboBox()
        self.fc_batch.setAllowEmptyFieldName(True)
        self.fc_batch.setLayer(self.lc_batch.currentLayer())
        self.lc_batch.layerChanged.connect(self.fc_batch.setLayer)
        pf.addRow("Нэрийн талбар:", self.fc_batch)
        self.chk_batch_sel = QCheckBox("Зөвхөн сонгогдсон объектууд")
        pf.addRow(self.chk_batch_sel)
        self.stack_batch.addWidget(p)
        # -- давхарга бүрээр
        p = QWidget()
        pv = QVBoxLayout(p)
        pv.setContentsMargins(0, 0, 0, 0)
        lab = QLabel("Чагталсан давхарга бүрд нэг зураг гарна; тухайн зурагт бусад "
                     "чагталсан давхарга нуугдаж, чагтгүй нь (хил, гол, фон) хэвээр үлдэнэ.")
        lab.setWordWrap(True)
        pv.addWidget(lab)
        self.lw_batch_layers = QListWidget()
        self.lw_batch_layers.setFixedHeight(120)
        pv.addWidget(self.lw_batch_layers)
        self.stack_batch.addWidget(p)
        v.addWidget(self.stack_batch)
        self.cb_batch_mode.currentIndexChanged.connect(self._batch_mode_changed)

        h = QHBoxLayout()
        b = QPushButton("Жагсаалт гаргах")
        b.clicked.connect(self._batch_plan)
        h.addWidget(b)
        b = QPushButton("Урьдчилан харах")
        b.setToolTip("Жагсаалтаас сонгосон зургийг урьдчилан харах талбарт үзүүлнэ")
        b.clicked.connect(self._batch_preview)
        h.addWidget(b)
        b = QPushButton("Буцах")
        b.setToolTip("Урьдчилан харалтыг цувралын зургаас үндсэн зураг руу буцаана")
        b.clicked.connect(self._batch_preview_off)
        h.addWidget(b)
        v.addLayout(h)

        self.lw_jobs = QListWidget()
        self.lw_jobs.setToolTip("Чагтыг авбал тэр зураг экспортлогдохгүй")
        v.addWidget(self.lw_jobs, 1)

        f = QFormLayout()
        self.le_batch_name = QLineEdit(
            QgsSettings().value("numan_map_maker/batch_pattern", "{i}_{name}"))
        self.le_batch_name.setToolTip("{i} — дарааллын дугаар, {n} — зургийн дугаар, "
                                      "{name} — объект/давхаргын нэр")
        f.addRow("Файлын нэр:", self.le_batch_name)
        self.chk_batch_xlsx = QCheckBox("Талбайн хүснэгтийг Excel-ээр хамт гаргах")
        self.chk_batch_xlsx.setToolTip("«Хүснэгт» табд талбайн хүснэгт асаалттай үед")
        f.addRow(self.chk_batch_xlsx)
        v.addLayout(f)
        b = QPushButton("Цувралаар экспортлох…")
        b.setToolTip("Формат, нягтралыг доод талын экспортын мөрөөс авна")
        b.clicked.connect(self._batch_export)
        v.addWidget(b)
        self._jobs = []
        self._job_override = None
        return w

    def _batch_mode_changed(self, *_):
        layers_mode = self.cb_batch_mode.currentData() == "layers"
        self.stack_batch.setCurrentIndex(1 if layers_mode else 0)
        if layers_mode:
            self._batch_fill_layers()

    def _batch_fill_layers(self):
        lw = self.lw_batch_layers
        checked = {lw.item(i).data(Qt.ItemDataRole.UserRole) for i in range(lw.count())
                   if lw.item(i).checkState() == Qt.CheckState.Checked}
        lw.clear()
        prj = QgsProject.instance()
        lyrs = legend_edit.editable_layers(prj)
        # Давхцлын нуугдсан үр дүнгүүд ч сэдэвчилсэн зураг болж чадна
        seen = {l.id() for l in lyrs}
        for node in prj.layerTreeRoot().findLayers():
            l = node.layer()
            if l is not None and l.id() not in seen and \
                    l.customProperty("numan_map_maker/overlap"):
                lyrs.append(l)
        for lyr in lyrs:
            it = QListWidgetItem(lyr.name())
            it.setData(Qt.ItemDataRole.UserRole, lyr.id())
            it.setFlags(it.flags() | Qt.ItemFlag.ItemIsUserCheckable)
            it.setCheckState(Qt.CheckState.Checked if lyr.id() in checked
                             else Qt.CheckState.Unchecked)
            lw.addItem(it)

    def _batch_plan(self):
        prj = QgsProject.instance()
        if self.cb_batch_mode.currentData() == "layers":
            lw = self.lw_batch_layers
            ids = [lw.item(i).data(Qt.ItemDataRole.UserRole) for i in range(lw.count())
                   if lw.item(i).checkState() == Qt.CheckState.Checked]
            jobs = batch.by_layers(prj, ids)
            hint = "Эхлээд давхаргуудаа чагтална уу."
        else:
            jobs = batch.by_features(prj, self.lc_batch.currentLayer(),
                                     self.fc_batch.currentField(),
                                     self.chk_batch_sel.isChecked())
            hint = "Давхаргад объект олдсонгүй."
        self._jobs = jobs
        self.lw_jobs.clear()
        for i, job in enumerate(jobs):
            it = QListWidgetItem(f"{i + 1}. {job['name']}")
            it.setFlags(it.flags() | Qt.ItemFlag.ItemIsUserCheckable)
            it.setCheckState(Qt.CheckState.Checked)
            self.lw_jobs.addItem(it)
        self.lbl_status.setText(f"Цуврал: {len(jobs)} зураг." if jobs else hint)
        return jobs

    def _batch_checked(self):
        return [self._jobs[i] for i in range(self.lw_jobs.count())
                if i < len(self._jobs)
                and self.lw_jobs.item(i).checkState() == Qt.CheckState.Checked]

    def _batch_preview(self):
        row = self.lw_jobs.currentRow()
        if not self._jobs:
            self._batch_plan()
            row = 0
        if not (0 <= row < len(self._jobs)):
            row = 0
        if not self._jobs:
            return
        # Зургийн дугаарыг экспортод гарах дугаартай нь ижил харуулна
        full = batch.job_settings(self.settings(), self._jobs[row], row)
        self._job_override = dict(self._jobs[row]["settings"], fig_no=full["fig_no"])
        self.rebuild()
        self.lbl_status.setText(
            f"Урьдчилан харж байна: {self._jobs[row]['name']} — «Буцах» "
            "товчоор буцна.")

    def _batch_preview_off(self):
        self._job_override = None
        self.rebuild()

    def _export_file(self, layout, path, dpi):
        """Нэг layout-ыг файл руу. QgsLayoutExporter-ийн үр дүнгийн кодыг буцаана."""
        exporter = QgsLayoutExporter(layout)
        self._settle()
        kind = os.path.splitext(path)[1].lower().lstrip(".")
        if kind == "pdf":
            es = QgsLayoutExporter.PdfExportSettings()
            es.dpi = dpi
            return exporter.exportToPdf(path, es)
        if kind == "svg":
            es = QgsLayoutExporter.SvgExportSettings()
            es.dpi = dpi
            return exporter.exportToSvg(path, es)
        es = QgsLayoutExporter.ImageExportSettings()
        es.dpi = dpi
        es.generateWorldFile = self.chk_world.isChecked()
        return exporter.exportToImage(path, es)

    def _batch_export(self):
        if not self._jobs:
            self._batch_plan()
        jobs = self._batch_checked()
        if not jobs:
            QMessageBox.information(self, "Цуврал зураг", "Экспортлох зураг алга.")
            return
        st = QgsSettings()
        start = st.value("numan_map_maker/export_dir", "") or \
            QgsProject.instance().homePath() or os.path.expanduser("~")
        folder = QFileDialog.getExistingDirectory(self, "Цуврал зураг хадгалах хавтас", start)
        if not folder:
            return
        st.setValue("numan_map_maker/export_dir", folder)
        st.setValue("numan_map_maker/batch_pattern", self.le_batch_name.text())

        self._job_override = None
        self.rebuild()                      # суурь зураг, KML загвар зэргийг бэлдэнэ
        base = self.settings()
        ext = self.cb_format.currentData()
        dpi = self.sp_dpi.value()
        prj = QgsProject.instance()
        canvas_extent = self.iface.mapCanvas().extent()
        table_layer = prj.mapLayer(base["table_layer"])
        want_xlsx = self.chk_batch_xlsx.isChecked() and base["table"] \
            and isinstance(table_layer, QgsVectorLayer)

        prog = QProgressDialog("Цуврал зураг экспортлож байна…", "Зогсоох", 0, len(jobs), self)
        prog.setWindowModality(Qt.WindowModality.WindowModal)
        prog.setMinimumDuration(0)
        done, failed, used = [], [], set()
        QApplication.setOverrideCursor(Qt.CursorShape.WaitCursor)
        try:
            for i, job in enumerate(jobs):
                prog.setValue(i)
                prog.setLabelText(f"{i + 1} / {len(jobs)}: {job['name']}")
                QApplication.processEvents()
                if prog.wasCanceled():
                    break
                s = batch.job_settings(base, job, i)
                name = batch.file_name(self.le_batch_name.text(), job, s, i)
                while name.lower() in used:
                    name += "_"
                used.add(name.lower())
                path = os.path.join(folder, f"{name}.{ext}")
                layout = QgsPrintLayout(prj)
                layout.initializeDefaults()
                try:
                    composer.build(layout, s, canvas_extent, self._overrides, None)
                    res = self._export_file(layout, path, dpi)
                except Exception as e:  # нэг зураг унасан ч бусдыг үргэлжлүүлнэ
                    failed.append(f"{job['name']}: {e}")
                    res = None
                finally:
                    layout.deleteLater()
                if res == QgsLayoutExporter.Success:
                    done.append(path)
                elif res is not None:
                    failed.append(job["name"])
            if want_xlsx and done:
                try:
                    self._write_table(os.path.join(folder, "talbain_husnegt.xlsx"),
                                      table_layer, base)
                except Exception as e:
                    failed.append(f"Excel: {e}")
        finally:
            QApplication.restoreOverrideCursor()
            prog.setValue(len(jobs))
        self._after_export(len(done))
        url = QUrl.fromLocalFile(folder).toString()
        msg = f"Цуврал: {len(done)} зураг хадгаллаа · <a href='{url}'>хавтас нээх</a>"
        if failed:
            msg += f" · <span style='color:#b00'>амжилтгүй: {len(failed)}</span>"
            QMessageBox.warning(self, "Цуврал зураг",
                                "Дараах зургууд гарсангүй:\n\n" + "\n".join(failed[:20]))
        self.lbl_status.setText(msg)
