# -*- coding: utf-8 -*-
"""영웅 목록에 쓸 둥근 아이콘을 굽는다 (herodata 의 heroSelect 초상화 128px).

  python tools/build_icons.py
출력: icons/<우리 영웅 슬러그>.jpg  (90명, 한 장 5KB 안팎)
"""
import io
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.dirname(HERE)
SRC = os.path.dirname(OUT)
sys.path.insert(0, os.path.join(SRC, "hots_hero", "tools"))
import build_heroes as B
from PIL import Image

KODATA = os.path.join(SRC, "hots_github_date260725", "06_auto_encyclopedia",
                      "work", "herodata_97650_kokr.json")
SIZE = 128
KEYS = ("heroSelect", "draftScreen", "target", "leaderboard")


def hero_map():
    """herodata 영웅 -> 우리 영웅 슬러그 (한국어 이름 먼저, 없으면 영어 열쇠)."""
    t = io.open(os.path.join(OUT, "data", "heroes.js"), encoding="utf-8").read()
    rows = json.loads(t[t.index("=") + 1:].rstrip().rstrip(";"))
    byko, byen = {}, {}
    for r in rows:
        if r.get("ko"):
            byko.setdefault(r["ko"], r["hero"])
        if r.get("name"):
            byen.setdefault(r["name"], r["hero"])
    j = json.load(io.open(KODATA, encoding="utf-8"))
    out = {}
    for k, h in j.items():
        slug = byko.get(h.get("name")) or byen.get(k) or byen.get(h.get("name"))
        if slug:
            out[slug] = {"ko": h.get("name"), "role": h.get("expandedRole"),
                         "portraits": h.get("portraits") or {}}
    return out


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    heroes = hero_map()
    dst = os.path.join(OUT, "icons")
    os.makedirs(dst, exist_ok=True)
    n = miss = 0
    meta = {}
    for slug, h in sorted(heroes.items()):
        path = None
        for k in KEYS:
            f = h["portraits"].get(k)
            if f:
                path = B.find_texture(f.replace(".png", ".dds"))
                if path:
                    break
        if not path:
            miss += 1
            continue
        im = Image.open(path)
        im.load()
        im = im.convert("RGB")
        # 세로로 긴 초상화(180×212)는 위쪽 얼굴만 정사각으로 도려낸다
        w, hgt = im.size
        if hgt > w:
            im = im.crop((0, 0, w, w))
        elif w > hgt:
            im = im.crop(((w - hgt) // 2, 0, (w - hgt) // 2 + hgt, hgt))
        im = im.resize((SIZE, SIZE), Image.LANCZOS)
        im.save(os.path.join(dst, slug + ".jpg"), "JPEG", quality=86,
                optimize=True)
        meta[slug] = {"ko": h["ko"], "role": h["role"]}
        n += 1
    io.open(os.path.join(OUT, "data", "roles.js"), "w",
            encoding="utf-8").write(
        "window.HERO_ROLES=%s;" % json.dumps(meta, ensure_ascii=False,
                                             separators=(",", ":")))
    print("아이콘 %d장 · 초상화 없음 %d" % (n, miss))


if __name__ == "__main__":
    main()
