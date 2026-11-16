#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Бүх тестийг ажиллуулна. QGIS-ийн Python-оор ажиллуулна:

    Linux:    python3 tests/run_tests.py
    Windows:  OSGeo4W Shell-д  python-qgis-ltr tests\\run_tests.py
              (эсвэл QGIS-ийн суулгацын bin\\python-qgis-ltr.bat)

    python3 tests/run_tests.py overlap coords    # нэрэнд тэр үг агуулсан тестүүд л
    python3 tests/run_tests.py -v                # бүх мөрийг харуулна

Тест бүр тусдаа процесс, түр профайлтай тул таны QGIS-ийн тохиргоонд хүрэхгүй.
Сүлжээ шаардахгүй.
"""
import glob
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))


def main(argv):
    verbose = "-v" in argv
    words = [a for a in argv if not a.startswith("-")]
    files = sorted(glob.glob(os.path.join(HERE, "test_*.py")))
    if words:
        files = [f for f in files if any(w in os.path.basename(f) for w in words)]
    env = dict(os.environ, QT_QPA_PLATFORM=os.environ.get("QT_QPA_PLATFORM", "offscreen"),
               PYTHONIOENCODING="utf-8")
    failed = []
    total_ok = total = 0
    t_all = time.time()
    for f in files:
        name = os.path.basename(f)[:-3]
        t0 = time.time()
        try:
            p = subprocess.run([sys.executable, "-X", "faulthandler", "-u", f], cwd=HERE, env=env,
                               capture_output=True, text=True, encoding="utf-8",
                               errors="replace", timeout=900)
            out, rc = p.stdout + p.stderr, p.returncode
        except subprocess.TimeoutExpired as e:
            out, rc = (e.stdout or "") + "\nTIMEOUT", -1
        lines = out.splitlines()
        res = [l for l in lines if l.startswith("RESULT ")]
        if res:
            ok, n = res[-1].split()[1].split("/")
            total_ok += int(ok)
            total += int(n.split()[0]) if n.split() else 0
        status = "PASS" if rc == 0 else "FAIL"
        print(f"{status}  {name:16s} {res[-1][7:] if res else 'no result'}   "
              f"({time.time() - t0:.0f} s)", flush=True)
        if rc != 0:
            failed.append(name)
            shown = lines if verbose else [l for l in lines if "FAIL" in l or "Error" in l
                                           or "Traceback" in l or l.startswith("  File")
                                           or "TIMEOUT" in l or "Fatal" in l]
            for l in shown[-40:]:
                print("      " + l)
        elif verbose:
            for l in lines:
                print("      " + l)
    print(f"\n{len(files) - len(failed)}/{len(files)} test files passed, "
          f"{total_ok}/{total} checks, {time.time() - t_all:.0f} s")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
