# -*- coding: utf-8 -*-
"""Удаан ажиллагааг QGIS-ийн арын горимд (QgsTask) ажиллуулах туслах.

Ажил арын урсгалд явж байх хооронд QGIS хөлдөхгүй: үндсэн цонхонд зураг гүйлгэх,
томруулах боломжтой, явц нь QGIS-ийн төлөвийн мөрөнд (баруун доод буланд) харагдана.
Плагины цонх ажил дуустал түр идэвхгүй болж, явцын цонхноос зогсоож болно.

Арын урсгалд ажиллах функц төслийн давхаргад шууд хандахгүй (thread-safe биш):
шаардлагатай өгөгдлийг үндсэн урсгалд бэлдэж (жишээ нь QgsVectorLayerFeatureSource)
дамжуулна.
"""
import traceback

from qgis.PyQt.QtCore import QEventLoop, Qt, QTimer
from qgis.PyQt.QtWidgets import QProgressDialog
from qgis.core import QgsApplication, QgsTask


class Cancelled(Exception):
    """Хэрэглэгч ажлыг зогсоосон."""


class _Outcome:
    """Ажлын үр дүнг QgsTask-аас тусад нь хадгална: QGIS дууссан ажлыг шууд устгадаг тул
    устсан объектод хандаж унахаас сэргийлнэ."""
    __slots__ = ("done", "result", "error", "trace", "cancelled")

    def __init__(self):
        self.done = False
        self.result = None
        self.error = None
        self.trace = ""
        self.cancelled = False


class FnTask(QgsTask):
    """fn(task, *args)-г арын урсгалд ажиллуулна. task.setProgress(0..100),
    task.isCanceled()-ийг fn дотроос ашиглана."""

    def __init__(self, description, fn, outcome, *args, **kwargs):
        super().__init__(description, QgsTask.CanCancel)
        self._fn, self._args, self._kwargs = fn, args, kwargs
        self._out = outcome

    def run(self):
        out = self._out
        try:
            out.result = self._fn(self, *self._args, **self._kwargs)
            out.cancelled = self.isCanceled()
            return not out.cancelled
        except Cancelled:
            out.cancelled = True
            return False
        except Exception as e:  # үндсэн урсгалд дахин шиднэ
            if self.isCanceled():       # зогсоосны улмаас гарсан алдаа бол зүгээр зогсоно
                out.cancelled = True
                return False
            out.error = e
            out.trace = traceback.format_exc()
            return False

    def finished(self, ok):             # үндсэн урсгалд дуудагдана
        if not ok and self.isCanceled():
            self._out.cancelled = True
        self._out.done = True
        # Python-ийн объектыг дуустал барьж байсныг суллана (C++ талыг QGIS устгана)
        _RUNNING.discard(self)


def run(description, fn, *args, parent=None, block=(), label="", **kwargs):
    """fn-ийг арын горимд ажиллуулж, дуустал хүлээнэ (QGIS-ийн үйл явдлыг боловсруулсаар).

    block: ажил явж байх хооронд идэвхгүй болгох виджетүүд (давхар дарахаас сэргийлнэ).
    Буцаах утга: fn-ийн үр дүн. Зогсоовол Cancelled, алдаа гарвал тэр алдааг шиднэ.
    """
    out = _Outcome()
    task = FnTask(description, fn, out, *args, **kwargs)
    loop = QEventLoop()

    prog = None
    if parent is not None:
        prog = QProgressDialog(label or description, "Зогсоох", 0, 100, parent)
        prog.setWindowTitle(description)
        prog.setWindowModality(Qt.WindowModality.NonModal)
        prog.setMinimumDuration(400)
        prog.setAutoClose(False)
        prog.setAutoReset(False)

        def cancel():
            if not out.done:
                task.cancel()
        prog.canceled.connect(cancel)
        task.progressChanged.connect(lambda v: prog.setValue(int(v)) if not out.done else None)

    disabled = []
    for w in block:
        try:
            if w is not None and w.isEnabled():
                w.setEnabled(False)
                disabled.append(w)
        except RuntimeError:
            pass

    guard = QTimer()
    guard.setInterval(50)
    guard.timeout.connect(lambda: loop.quit() if out.done else None)
    try:
        # Python-ийн объектыг ажил дуустал барина: эс бөгөөс sip түүнийг устгаж,
        # run() / finished() дуудагдахгүй болно
        _RUNNING.add(task)
        QgsApplication.taskManager().addTask(task)
        guard.start()
        if not out.done:
            (loop.exec if hasattr(loop, "exec") else loop.exec_)()
    finally:
        guard.stop()
        for w in disabled:
            try:
                w.setEnabled(True)
            except RuntimeError:
                pass
        if prog is not None:
            prog.close()
            prog.deleteLater()

    if out.error is not None:
        raise out.error
    if out.cancelled:
        raise Cancelled()
    return out.result


_RUNNING = set()
