# -*- coding: utf-8 -*-
"""GitHub Pages 용 웹판을 만든다 — 낱개 HTML 과 달리 «필요할 때 받아오는» 구조.

낱개판(hots_hero_each)은 파일 하나로 완결되게 자료를 통째로 base64 로 박아
넣는다. file:// 로 열면 fetch 가 막히기 때문이다. 웹은 그 제약이 없으므로
자료를 따로 두고 눌렀을 때 받아온다 — base64 낭비(33%)도 없고 브라우저가
캐시도 해 준다.

  index.html            영웅 목록 (번호 + 이름, 가볍다)
  h/<번호>_<슬러그>.html  영웅 한 명 (수백 바이트 — 자료는 안 들었다)
  js/viewer.js          공용 뷰어
  data/…                모델·동작·색배합 (웹판은 텍스처 512, 동작 3개)

  python tools/build_web.py
"""
import io
import json
import os
import re
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.dirname(HERE)                       # hots_hero_web
SRC = os.path.dirname(OUT)                        # …/03_claude
EACH = os.path.join(SRC, "hots_hero_each", "tools")
sys.path.insert(0, EACH)
import build_each as E                            # 무리 짓기·번호·이름표 재사용

DATA = os.path.join(OUT, "data")

# 웹판 UI 는 «재생/멈춤» 만 남긴다 — 속도·표정 고르개는 감춘다 (요소를 지우면
# 그것을 만지는 코드가 깨지므로 감추기만 한다)
WEB_CSS = '\n#bar select{display:none!important}\n#anims{position:fixed;left:14px;top:150px;bottom:auto;width:auto;max-width:calc(100% - 90px);background:none;border:0;backdrop-filter:none;flex-direction:row;flex-wrap:wrap;gap:5px;overflow:visible;display:flex!important}\n#animFind{display:none}\n#animList{display:flex;flex-wrap:wrap;gap:5px;padding:0;overflow:visible;flex:none}\n#anims .ahead{display:none}\n#anims .arow{border:1px solid var(--line);border-radius:12px;background:#1a2331;padding:4px 10px;font-size:11px;display:inline-flex}\n#anims .arow .dur{display:none}\n#bAnims{display:none!important}\n#nav{position:fixed;left:0;right:0;top:0;height:36px;display:flex;align-items:center;gap:6px;padding:0 12px;background:#0b0f16ee;border-bottom:1px solid #243044;z-index:5;overflow-x:auto;white-space:nowrap;scrollbar-width:none}\n#nav::-webkit-scrollbar{display:none}\n#nav a{color:#8b9bb4;text-decoration:none;font-size:12px;padding:4px 10px;border-radius:12px;border:1px solid transparent;flex:none}\n#nav a:hover{color:#e6edf7;border-color:#4ea3ff}\n#nav a.home{color:#e6edf7;background:#131a24;border-color:#243044}\n#nav a.on{background:#4ea3ff;color:#04121f;border-color:#4ea3ff}\n#nav em{font-style:normal;color:#5b8dd6;font-family:Consolas,monospace;margin-right:5px}\n#nav a.on em{color:#0a3a5e}\n#nav .sep{color:#2c3a50;flex:none}\n#top{top:46px}#skins{top:78px}#vars{top:120px}\n@media (max-width:640px){#nav{height:32px;padding:0 8px}#top{top:38px}#skins{top:64px}#vars{top:100px}#anims{left:8px;right:8px;top:136px;max-width:none;max-height:none}}\n'


def read(p):
    return io.open(p, encoding="utf-8").read()


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    idx = json.loads(read(os.path.join(DATA, "heroes.js")).split("=", 1)[1]
                     .rstrip().rstrip(";"))
    rows = E.split_morphs(idx)
    by = {}
    for r in rows:
        by.setdefault(r["hero"], []).append(r)

    label_of = {}
    try:
        s = read(os.path.join(SRC, "hots_hero", "data", "groups.js"))
        label_of = json.loads(s[s.index("=") + 1:].rstrip().rstrip(";")) \
            .get("heroLabel", {})
    except Exception:
        pass
    E.load_skin_labels()

    ko_of = {}
    for hero, rs in by.items():
        rs.sort(key=lambda r: (r["skin"] != "base",
                               r["slug"].startswith("storm_morph_"),
                               r["skin"]))
        ko = next((r["ko"] for r in rs if r["skin"] == "base" and r["ko"]),
                  rs[0]["ko"] or rs[0]["name"])
        if hero in label_of:
            ko = "%s (%s)" % (ko, label_of[hero])
        ko_of[hero] = ko
    # 변신 형태 무리는 «부모 영웅»의 번호를 물려받는다 (레가르 18 / 늑대 18-01)
    extra_sub = {}
    for h, rs in by.items():
        h0 = (rs[0] or {}).get("hero0")
        if h0 and h0 in by and h0 != h:
            extra_sub[h] = (h0, "m")
    tags = E.assign_tags(ko_of, extra_sub)

    # 공용 뷰어 한 벌
    os.makedirs(os.path.join(OUT, "js"), exist_ok=True)
    shutil.copyfile(os.path.join(EACH, "viewer_min.js"),
                    os.path.join(OUT, "js", "viewer.js"))
    os.makedirs(os.path.join(OUT, "h"), exist_ok=True)

    has_var = set()
    vdir = os.path.join(DATA, "variations")
    if os.path.isdir(vdir):
        has_var = {f[:-3] for f in os.listdir(vdir) if f.endswith(".js")}

    # 같은 번호를 나눠 쓰는 무리(레가르 18 / 늑대 18-01, 바이킹 07-1~3) 는
    # 상단 바에서 서로 바로 건너뛸 수 있게 미리 묶어 둔다
    fam = {}
    for h, tg in tags.items():
        fam.setdefault(tg.split("-")[0], []).append(h)
    for k in fam:
        fam[k].sort(key=lambda h: E._tag_key(tags[h]))

    cards = []
    for hero in sorted(by):
        rs = by[hero]
        ko, tag = ko_of[hero], tags[hero]
        name = "%s_%s" % (tag, hero)
        base = next((r for r in rs if r["skin"] == "base"), rs[0])
        skins = [{"slug": r["slug"], "label": E.skin_label(r),
                  "skin": r["skin"], "href": None,
                  "akey": r.get("akey") or "", "fkey": r.get("fkey") or ""}
                 for r in rs]
        vk = base.get("hero0", hero)
        page = {"title": ko, "sub": "스킨 %d" % len(rs), "skins": skins,
                "current": 0, "baseAnim": base.get("akey") or "",
                "web": "../data/", "varsKey": vk if vk in has_var else ""}
        body = E.BODY
        sibs = fam.get(tag.split("-")[0], [])
        nav = ("<a class=home href='../index.html'>← 영웅 목록</a>")
        if len(sibs) > 1:
            nav += "<span class=sep>|</span>"
            for h2 in sibs:
                nav += ("<a %shref='%s_%s.html'><em>%s</em>%s</a>"
                        % ("class=on " if h2 == hero else "",
                           tags[h2], h2, tags[h2],
                           E.html_mod.escape(ko_of[h2])))
        nav = "<div id=nav>%s</div>" % nav
        doc = ("<!doctype html><html lang=ko><head><meta charset=utf-8>"
               "<meta name=viewport content='width=device-width,"
               "initial-scale=1,viewport-fit=cover'>"
               "<title>%s — 히오스 3D</title><style>%s</style></head><body>%s"
               "<script>window.PAGE=%s;</script>"
               "<script src='../js/viewer.js'></script></body></html>"
               % (E.html_mod.escape(ko), E.CSS + WEB_CSS, nav + body,
                  json.dumps(page, ensure_ascii=False,
                             separators=(",", ":"))))
        io.open(os.path.join(OUT, "h", name + ".html"), "w",
                encoding="utf-8").write(doc)
        cards.append((tag, hero, ko, len(rs)))

    cards.sort(key=lambda c: E._tag_key(c[0]))
    items = "".join(
        "<a class=card href='h/%s_%s.html'><b><em>%s</em>%s</b>"
        "<span>스킨 %d</span></a>"
        % (tag, hero, tag,
           E.html_mod.escape(E.ROOT_KO.get(hero, ko)
                             if hero not in E.VIKING_KO
                             else "%s (%s)" % (ko, E.VIKING_KO[hero])), n)
        for tag, hero, ko, n in cards)
    io.open(os.path.join(OUT, "index.html"), "w", encoding="utf-8").write(
        "<!doctype html><html lang=ko><head><meta charset=utf-8>"
        "<meta name=viewport content='width=device-width,initial-scale=1'>"
        "<title>히오스 영웅 3D</title><style>"
        "body{background:#0b0f16;color:#e6edf7;font-family:'Malgun Gothic',"
        "sans-serif;padding:28px;margin:0}h1{font-size:20px}"
        "p{color:#8b9bb4;font-size:13px}"
"#notice{margin:16px 0 4px;padding:12px 14px;border-radius:8px;"
"background:#1b1408;border:1px solid #6b4f1d;color:#e8d9b6;"
"font-size:13px;line-height:1.7;max-width:820px}"
"#notice b{color:#ffcf7a}"
        "#g{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,"
        "1fr));gap:8px;margin-top:18px}"
        ".card{display:flex;flex-direction:column;gap:2px;padding:10px 12px;"
        "background:#131a24;border:1px solid #243044;border-radius:8px;"
        "color:#e6edf7;text-decoration:none}"
        ".card:hover{border-color:#4ea3ff}"
        ".card em{font-style:normal;font-size:11px;color:#5b8dd6;"
        "font-family:Consolas,monospace;margin-right:6px}"
        ".card span{color:#8b9bb4;font-size:11px}</style></head><body>"
        "<h1>히오스 영웅 3D</h1>"
        "<div id=notice><b>비상업 팬 제작물입니다.</b> 게임 모델·텍스처·"
        "동작은 <b>© Blizzard Entertainment</b> (Heroes of the Storm) 의 "
        "저작물이며, 이 사이트는 블리자드와 아무 관련이 없습니다. "
        "광고·후원 없이 개인이 만든 감상용이고, 권리자의 요청이 있으면 "
        "즉시 내립니다.</div>"
        "<p>영웅을 누르면 그 영웅의 스킨·색배합을 3D 로 돌려볼 수 있다. "
        "모델·텍스처는 누를 때 받아온다.</p>"
        "<div id=g>" + items + "</div>"
        "<p style='margin-top:26px;font-size:11px;color:#5b6b84'>"
        "제작 SINONIS · Claude(Anthropic) 도움 · 게임 모델·텍스처·동작 "
        "© Blizzard Entertainment (Heroes of the Storm) · 비상업 팬 제작물"
        "</p></body></html>")
    print("웹판 만듦: 영웅 %d명" % len(cards))


if __name__ == "__main__":
    main()
