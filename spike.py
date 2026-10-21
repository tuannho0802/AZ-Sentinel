"""
AZ Sentinel - Patch 5.5 spike (CHI DOC, khong gui lenh giao dich, khong login).

Chay tren VPS Windows, CUNG user + CUNG phien RDP dang chay cac terminal MT5.

Cai dat:
    py -3.12 -m venv C:\\az-spike\\venv
    C:\\az-spike\\venv\\Scripts\\pip install MetaTrader5 psutil

Lenh:
    python spike.py discover
    python spike.py all --seconds 60 --interval 1.0
    python spike.py worker --exe "C:\\Program Files\\Tai khoan 3 MT5\\terminal64.exe" --seconds 30

Ket qua `all` duoc ghi vao spike_result.json (cung thu muc) - gui file nay lai.
"""
import argparse
import json
import os
import statistics
import subprocess
import sys
import time
from pathlib import Path


def _norm(p):
    return os.path.normcase(os.path.abspath(p))


def read_origin(f: Path):
    """origin.txt thuong la UTF-16 LE co BOM (66 byte cho 32 ky tu)."""
    raw = f.read_bytes()
    try:
        if raw[:2] in (b"\xff\xfe", b"\xfe\xff"):
            text = raw.decode("utf-16")
        else:
            text = raw.decode("utf-8-sig")
    except UnicodeError:
        return None
    return text.strip().strip("\x00") or None


def discover():
    """Chi nhan terminal dang CHAY. origin.txt chi dung de doi chieu ra hash thu muc du lieu."""
    import psutil

    base = Path(os.environ.get("APPDATA", "")) / "MetaQuotes" / "Terminal"
    origins = {}
    if base.is_dir():
        for d in base.iterdir():
            f = d / "origin.txt"
            if f.is_file():
                t = read_origin(f)
                if t:
                    origins[_norm(t)] = d.name

    found = []
    for p in psutil.process_iter(["pid", "name", "exe"]):
        name = (p.info["name"] or "").lower()
        exe = p.info["exe"]
        if name != "terminal64.exe" or not exe:
            continue
        inst = Path(exe).parent
        found.append(
            {
                "pid": p.info["pid"],
                "exe": exe,
                "install_dir": str(inst),
                "data_hash": origins.get(_norm(str(inst))),  # None => co the la portable that
            }
        )
    running_hashes = {t["data_hash"] for t in found if t["data_hash"]}
    orphans = sorted(set(origins.values()) - running_hashes)
    return found, orphans


def worker(exe, seconds, interval):
    import MetaTrader5 as mt5
    import psutil

    def out(**kw):
        print(json.dumps(kw, ensure_ascii=False), flush=True)

    t0 = time.perf_counter()
    if not mt5.initialize(path=exe, timeout=15000):
        out(exe=exe, ok=False, stage="initialize", error=list(mt5.last_error()))
        return 1
    init_ms = (time.perf_counter() - t0) * 1000

    ti = mt5.terminal_info()
    ai = mt5.account_info()
    if ti is None or ai is None:
        out(exe=exe, ok=False, stage="info", error=list(mt5.last_error()))
        mt5.shutdown()
        return 1

    lat, errs, last_err = [], 0, None
    end = time.time() + seconds
    while time.time() < end:
        s = time.perf_counter()
        a = mt5.account_info()
        pos = mt5.positions_get()
        if a is None or pos is None:
            errs += 1
            last_err = list(mt5.last_error())
        lat.append((time.perf_counter() - s) * 1000)
        time.sleep(max(0.0, interval - (time.perf_counter() - s)))

    rss = psutil.Process().memory_info().rss / 1e6
    mt5.shutdown()
    lat.sort()
    out(
        exe=exe,
        ok=True,
        login=ai.login,
        server=ai.server,
        company=ai.company,
        connected=ti.connected,
        data_path=ti.data_path,
        data_hash=Path(ti.data_path).name,
        init_ms=round(init_ms),
        polls=len(lat),
        avg_ms=round(statistics.mean(lat), 1) if lat else None,
        p95_ms=round(lat[int(len(lat) * 0.95) - 1], 1) if lat else None,
        errors=errs,
        last_error=last_err,
        rss_mb=round(rss, 1),
    )
    return 0


def run_all(seconds, interval):
    found, orphans = discover()
    print(f"Terminal dang chay: {len(found)} | thu muc du lieu mo coi: {len(orphans)}")
    for t in found:
        print(f"  pid={t['pid']:<6} hash={t['data_hash']}  {t['exe']}")
    if not found:
        return 1

    print(f"\nChay {len(found)} worker DONG THOI, {seconds}s, moi {interval}s ...\n")
    procs = []
    for t in found:
        # Khi dong goi bang PyInstaller, sys.executable chinh la file .exe nay.
        base_cmd = [sys.executable] if getattr(sys, "frozen", False) else [sys.executable, __file__]
        cmd = base_cmd + ["worker", "--exe", t["exe"],
                          "--seconds", str(seconds), "--interval", str(interval)]
        procs.append((t, subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)))

    results = []
    for t, p in procs:
        so, se = p.communicate()
        line = next((l for l in reversed(so.strip().splitlines()) if l.startswith("{")), None)
        r = json.loads(line) if line else {"exe": t["exe"], "ok": False, "stage": "no-output", "stderr": se[-300:]}
        r["expected_hash"] = t["data_hash"]
        r["hash_match"] = (r.get("data_hash") == t["data_hash"]) if r.get("ok") else None
        results.append(r)

    print(f"{'login@server':<34}{'hash':<7}{'init':>7}{'avg':>7}{'p95':>7}{'err':>5}{'RAM':>7}")
    for r in results:
        if r.get("ok"):
            hm = "OK" if r["hash_match"] else ("?" if r["expected_hash"] is None else "LECH")
            print(f"{str(r['login'])+'@'+r['server']:<34}{hm:<7}{r['init_ms']:>7}{r['avg_ms']:>7}"
                  f"{r['p95_ms']:>7}{r['errors']:>5}{r['rss_mb']:>7}")
        else:
            print(f"{Path(r['exe']).parent.name:<34}FAIL  stage={r.get('stage')} "
                  f"err={r.get('error') or r.get('stderr')}")

    ok = sum(1 for r in results if r.get("ok"))
    print(f"\nTHANH CONG {ok}/{len(results)}")
    Path("spike_result.json").write_text(
        json.dumps({"terminals": found, "orphans": orphans, "results": results,
                    "python": sys.version, "ts": time.time()}, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    print("Da ghi spike_result.json")
    return 0 if ok == len(results) else 2


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("discover")
    sub.add_parser("selftest")
    for name in ("all", "worker"):
        sp = sub.add_parser(name)
        sp.add_argument("--seconds", type=int, default=60)
        sp.add_argument("--interval", type=float, default=1.0)
        if name == "worker":
            sp.add_argument("--exe", required=True)
    a = ap.parse_args()

    if a.cmd == "selftest":
        # Kiem tra goi da dong goi du chua. Khong can terminal MT5.
        import numpy
        import psutil
        import MetaTrader5 as mt5

        print("python     :", sys.version.split()[0], "frozen=", getattr(sys, "frozen", False))
        print("numpy      :", numpy.__version__)
        print("psutil     :", psutil.__version__)
        print("MetaTrader5:", mt5.__version__)
        print("SELFTEST OK")
        return 0
    if a.cmd == "discover":
        found, orphans = discover()
        print(json.dumps({"terminals": found, "orphans": orphans}, indent=2, ensure_ascii=False))
        return 0
    if a.cmd == "worker":
        return worker(a.exe, a.seconds, a.interval)
    return run_all(a.seconds, a.interval)


if __name__ == "__main__":
    sys.exit(main())
