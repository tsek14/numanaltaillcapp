# -*- coding: utf-8 -*-
"""Багтахгүй үед дараагийн мөрөнд шилждэг товчны мөр (Qt-ийн FlowLayout жишээнээс).

Товчнуудын нийт өргөн цонхны хамгийн бага өргөнийг тогтоохгүй: жижиг дэлгэц эсвэл
томруулсан (125%, 150%) Windows дээр цонх дэлгэцнээс давахгүй.
"""
from qgis.PyQt.QtCore import QPoint, QRect, QSize, Qt
from qgis.PyQt.QtWidgets import QLayout


class FlowLayout(QLayout):
    def __init__(self, parent=None, spacing=6):
        super().__init__(parent)
        self._items = []
        self._spacing = spacing
        self.setContentsMargins(0, 0, 0, 0)

    def __del__(self):
        while self.count():
            self.takeAt(0)

    def addItem(self, item):
        self._items.append(item)

    def count(self):
        return len(self._items)

    def itemAt(self, i):
        return self._items[i] if 0 <= i < len(self._items) else None

    def takeAt(self, i):
        return self._items.pop(i) if 0 <= i < len(self._items) else None

    def expandingDirections(self):
        return Qt.Orientation(0)

    def hasHeightForWidth(self):
        return True

    def heightForWidth(self, width):
        return self._do_layout(QRect(0, 0, width, 0), True)

    def setGeometry(self, rect):
        super().setGeometry(rect)
        self._do_layout(rect, False)

    def sizeHint(self):
        # Нэг мөрт багтаах хэмжээ — илүү зай байвал бүгд нэг мөрөнд
        w = h = 0
        for it in self._items:
            s = it.sizeHint()
            w += s.width() + self._spacing
            h = max(h, s.height())
        m = self.contentsMargins()
        return QSize(max(0, w - self._spacing) + m.left() + m.right(), h + m.top() + m.bottom())

    def minimumSize(self):
        size = QSize()
        for it in self._items:
            size = size.expandedTo(it.minimumSize())
        m = self.contentsMargins()
        return size + QSize(m.left() + m.right(), m.top() + m.bottom())

    def _do_layout(self, rect, test_only):
        m = self.contentsMargins()
        r = rect.adjusted(m.left(), m.top(), -m.right(), -m.bottom())
        sp = self._spacing
        lines, line, x = [], [], r.x()
        for it in self._items:
            hint = it.sizeHint()
            if line and x + hint.width() > r.right() + 1:
                lines.append(line)
                line, x = [], r.x()
            line.append((it, hint, x))
            x += hint.width() + sp
        if line:
            lines.append(line)
        y = r.y()
        for line in lines:
            line_h = max(h.height() for _i, h, _x in line)
            if not test_only:
                for it, hint, lx in line:
                    # Мөрийн дотор босоогоор голлуулна (шошго, товч нэг шугамд)
                    it.setGeometry(QRect(QPoint(lx, y + (line_h - hint.height()) // 2), hint))
            y += line_h + sp
        used = (y - sp - r.y()) if lines else 0
        return used + m.top() + m.bottom()
