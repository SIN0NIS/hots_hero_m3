# 영웅 동작 "전체판" 굽기 — 웹 뷰어의 [동작 전부 받기] 단추가 받는 파일.
#   python tools/build_all_anims.py [--only key,key] [--force]
# data/anims/<key>.js (서기·걷기·춤 세 개만 담은 가벼운 판) 와 **모양이 같은** 묶음을
# data/anims_all/<key>.js 에 굽는다(그 동작 파일의 이름 붙은 동작 전부). 뷰어는 받으면
# HERO_ANIMS[key] 를 이것으로 갈아 끼우고 동작 목록을 다시 그린다 — 뼈 이름 차례가 같아서
# 다른 코드는 손댈 것이 없다.
# data/anims_all/_index.js 에 {key: [동작 수, KB]} 를 적어 뷰어가 단추에 수와 용량을 보인다.
#
# 용량: 영웅 동작 파일 하나가 50개 안팎 · 평균 1~2MB(압축해 받으면 그 60%).
# 전체로는 수백 MB 라 GitHub Pages(저장소 1GB)에는 안 올린다(.gitignore) —
# hotscrap.com(Cloudflare, 파일당 25MB 상한)에만 cloudflare/build_cf.py 가 같이 싣는다.
import argparse, glob, json, os, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.dirname(HERE)
ROOT = os.path.dirname(WEB)                                  # 03_claude
sys.path.insert(0, os.path.join(ROOT, "02_뷰어", "hots_hero", "tools"))
import build_heroes as B                                      # noqa: E402

SRC_DIR = os.path.join(WEB, "data", "anims")
OUT_DIR = os.path.join(WEB, "data", "anims_all")


def m3a_paths():
    """동작 파일 이름 -> 경로. build_heroes 처럼 덧붙인 것(00_added)을 먼저 깔고 원본으로 덮는다."""
    out = {}
    for root in reversed(B.anim_roots()):
        for p in glob.glob(os.path.join(root, "**", "*.m3a"), recursive=True):
            out[os.path.splitext(os.path.basename(p))[0].lower()] = p
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="")
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args()
    try:
        os.nice(10)
    except (AttributeError, OSError):
        pass
    os.makedirs(OUT_DIR, exist_ok=True)
    only = {k.strip().lower() for k in a.only.split(",") if k.strip()}
    keys = sorted(os.path.splitext(f)[0] for f in os.listdir(SRC_DIR)
                  if f.endswith(".js") and "facialanims" not in f)
    if only:
        keys = [k for k in keys if k.lower() in only]
    paths = m3a_paths()
    idx_path = os.path.join(OUT_DIR, "_index.js")
    idx = {}
    if os.path.exists(idx_path):
        t = open(idx_path, encoding="utf-8").read()
        idx = json.loads(t[t.index("=") + 1:].rstrip().rstrip(";"))
    t0, total = time.time(), 0
    for n, key in enumerate(keys, 1):
        out = os.path.join(OUT_DIR, key + ".js")
        p = paths.get(key.lower())
        if not p:
            print("  [%d/%d] %-48s 원본 동작 파일 없음" % (n, len(keys), key))
            continue
        if not a.force and os.path.exists(out) and key in idx and os.path.getmtime(out) >= os.path.getmtime(p):
            total += os.path.getsize(out)
            continue
        bundle = B.build_anim_bundle(p, ["all"])
        if not bundle:
            print("  [%d/%d] %-48s 못 읽음" % (n, len(keys), key))
            continue
        with open(out, "w", encoding="utf-8") as f:
            f.write("window.HERO_ANIMS=window.HERO_ANIMS||{};\n")
            f.write("HERO_ANIMS[%s]=%s;\n" % (json.dumps(key), json.dumps(bundle, separators=(",", ":"))))
        kb = round(os.path.getsize(out) / 1024)
        idx[key] = [len(bundle["anims"]), kb]
        total += os.path.getsize(out)
        print("  [%d/%d] %-48s %3d개 %7dKB  (%.0fs)" % (n, len(keys), key, len(bundle["anims"]), kb, time.time() - t0), flush=True)
        with open(idx_path, "w", encoding="utf-8") as f:
            f.write("window.ANIMS_ALL=" + json.dumps(idx, separators=(",", ":")) + ";\n")
    print("끝: %d 묶음, %.0f MB" % (len(idx), total / 2**20))


if __name__ == "__main__":
    main()
