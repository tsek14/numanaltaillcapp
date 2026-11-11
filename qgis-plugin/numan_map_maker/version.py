# -*- coding: utf-8 -*-
import os


def plugin_version():
    """metadata.txt доторх version= мөрийг уншина (цонхны гарчиг, лог-д харуулна)."""
    try:
        path = os.path.join(os.path.dirname(__file__), "metadata.txt")
        with open(path, encoding="utf-8") as fh:
            for line in fh:
                if line.startswith("version="):
                    return line.split("=", 1)[1].strip()
    except OSError:
        pass
    return "?"
