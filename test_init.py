"""
Chan doan loi -10003. Chay bang python trong venv (KHONG qua .exe):
    .\\venv\\Scripts\\python.exe test_init.py "D:\\MetaTrader 5\\terminal64.exe"
Chi doc, khong login, khong gui lenh.
"""
import sys
import MetaTrader5 as mt5

EXE = sys.argv[1] if len(sys.argv) > 1 else r"D:\MetaTrader 5\terminal64.exe"
print("MetaTrader5 package:", mt5.__version__, "| author:", getattr(mt5, "__author__", "?"))


def attempt(label, **kw):
    print(f"\n--- {label} ---")
    ok = mt5.initialize(timeout=15000, **kw)
    print("initialize ->", ok, "| last_error:", mt5.last_error())
    if ok:
        ti = mt5.terminal_info()
        ai = mt5.account_info()
        print("version     :", mt5.version())
        print("connected   :", getattr(ti, "connected", None))
        print("data_path   :", getattr(ti, "data_path", None))
        print("build       :", getattr(ti, "build", None))
        print("account     :", getattr(ai, "login", None), getattr(ai, "server", None))
    mt5.shutdown()
    return ok


a = attempt("A: co path", path=EXE)
b = attempt("B: khong path (tu tim terminal)")
print("\nKET QUA: A =", a, "| B =", b)
