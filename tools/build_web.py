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
WEB_CSS = '\n#bar select{display:none!important}\n#nav{position:fixed;left:0;right:0;top:0;height:36px;display:flex;align-items:center;gap:6px;padding:0 12px;background:#0b0f16ee;border-bottom:1px solid #243044;z-index:5;overflow-x:auto;white-space:nowrap;scrollbar-width:none}\n#nav::-webkit-scrollbar{display:none}\n#nav a,#nav .step{color:#8b9bb4;text-decoration:none;font-size:12px;padding:4px 10px;border-radius:12px;border:1px solid transparent;flex:none}\n#nav a:hover{color:#e6edf7;border-color:#4ea3ff}\n#nav a.home{color:#e6edf7;background:#131a24;border-color:#243044}\n#nav a.step{background:#131a24;border-color:#243044;color:#c3cfe2}\n#nav .step.off{opacity:.35}\n#nav em{font-style:normal;color:#5b8dd6;font-family:Consolas,monospace;margin-right:5px}\n#nav .sep{color:#2c3a50;flex:none}\n#top{top:46px}\n#skins{left:auto;right:14px;top:46px;justify-content:flex-end;max-width:58%}\n#vars{left:auto;right:14px;top:88px;justify-content:flex-end;max-width:58%}\n#anims{position:fixed;left:50%;transform:translateX(-50%);right:auto;top:auto;bottom:62px;width:auto;max-width:calc(100% - 28px);background:none;border:0;backdrop-filter:none;flex-direction:row;flex-wrap:wrap;justify-content:center;gap:6px;overflow:visible;display:flex!important}\n#animFind{display:none}\n#animList{display:flex;flex-wrap:wrap;justify-content:center;gap:6px;padding:0;overflow:visible;flex:none}\n#anims .ahead{display:none}\n#anims .arow{border:1px solid var(--line);border-radius:14px;background:#131a24e6;padding:6px 12px;font-size:12px;display:inline-flex;backdrop-filter:blur(6px)}\n#anims .arow .dur{display:none}\n#bAnims{display:none!important}\n#anims .arow.on,#skins button.on,#vars button.on,#nav a.on{background:#1c2534!important;color:#ffe9b0!important;border-color:#f0c04a!important;box-shadow:0 0 0 1px #f0c04a66,0 0 12px #f0c04a55!important}\n#nav a.on em{color:#f0c04a!important}\n@media (max-width:640px){#nav{height:32px;padding:0 8px}#top{top:38px}#skins{left:8px;right:8px;top:64px;max-width:none;justify-content:flex-start}#vars{left:8px;right:8px;top:100px;max-width:none;justify-content:flex-start}#anims{left:8px;right:8px;bottom:58px;transform:none;max-width:none;max-height:none}}\n'


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

    # 역할군 자료 — 첫 화면 차례이자 «이전·다음» 차례다
    roles = {}
    rp = os.path.join(DATA, "roles.js")
    if os.path.exists(rp):
        t = read(rp)
        roles = json.loads(t[t.index("=") + 1:].rstrip().rstrip(";"))
    ORDER = ["전사", "투사", "근접 암살자", "원거리 암살자", "치유사", "지원가"]

    def top(slug):
        """같은 번호를 나눠 쓰는 무리의 «대표» (D.Va 는 메카, 바이킹은 올라프).

        한국어 이름으로 이으면 조종사·발레이그가 먼저 걸리는 수가 있어서,
        번호가 가장 앞선 것을 대표로 삼는다."""
        f = fam.get(tags.get(slug, "").split("-")[0])
        return f[0] if f else slug

    grp = {}
    for slug, m in roles.items():
        if slug in tags:
            grp.setdefault(m.get("role") or "그 밖", []).append((m["ko"], slug))
    for k in grp:
        grp[k].sort()
    roles_seq = []                       # 화면에 보이는 차례 그대로
    for role in ORDER + [k for k in sorted(grp) if k not in ORDER]:
        for ko, sl in grp.get(role, []):
            h2 = top(sl)
            if h2 not in roles_seq:
                roles_seq.append(h2)

    order = sorted(by, key=lambda h: E._tag_key(tags[h]))
    # «이전·다음» 은 역할군 차례를 따른다. 변신 형태는 제 부모 자리로 친다.
    seq_at = {h: k for k, h in enumerate(roles_seq)}

    def step_of(hero):
        k = seq_at.get(top(hero))
        if k is None:
            return None, None
        return (roles_seq[k - 1],
                roles_seq[(k + 1) % len(roles_seq)])
    cards = []
    for hero in order:
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
                "web": "../data/", "varsKey": vk if vk in has_var else "",
                "animKo": True}
        body = E.BODY
        sibs = fam.get(tag.split("-")[0], [])
        # 이전·다음은 첫 화면과 같은 차례(역할군 → 가나다)로 고리처럼 돈다
        prv, nxt = step_of(hero)
        nav = ("<a class=home href='../index.html'>← 영웅 목록</a>"
               "<span class=sep>|</span>")
        for lab, h2 in (("‹ 이전", prv), ("다음 ›", nxt)):
            if h2:
                nav += ("<a class=step href='%s_%s.html' title='%s'>%s</a>"
                        % (tags[h2], h2, E.html_mod.escape(ko_of[h2]), lab))
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
               "<meta http-equiv=Cache-Control content=no-cache>"
               "<title>%s — 히오스 3D</title><style>%s</style></head><body>%s"
               "<script>window.PAGE=%s;</script>"
               "<script src='../js/viewer.js'></script></body></html>"
               % (E.html_mod.escape(ko), E.CSS + WEB_CSS, nav + body,
                  json.dumps(page, ensure_ascii=False,
                             separators=(",", ":"))))
        io.open(os.path.join(OUT, "h", name + ".html"), "w",
                encoding="utf-8").write(doc)
        cards.append((tag, hero, ko, len(rs)))

    # ── 영웅 목록: 역할군별 아이콘 판 ────────────────────────────────
    # 게임의 영웅은 90명이고 변신 형태는 그 안에 딸린 것이라, 목록에는 90명만
    # 세우고 변신폼은 영웅 페이지의 상단 바에서 건너뛰게 둔다.
    secs = ""
    total = 0
    for role in ORDER + [k for k in sorted(grp) if k not in ORDER]:
        lst = grp.get(role)
        if not lst:
            continue
        total += len(lst)
        cards2 = "".join(
            "<a class=hero href='h/%s_%s.html' title='%s %s'>"
            "<img loading=lazy src='icons/%s.jpg' alt=''>"
            "<span>%s</span></a>"
            % (tags[top(sl)], top(sl), tags[top(sl)],
               E.html_mod.escape(ko), sl, E.html_mod.escape(ko))
            for ko, sl in lst)
        secs += ("<h2>%s<i>%d</i></h2><div class=grid>%s</div>"
                 % (E.html_mod.escape(role), len(lst), cards2))

    io.open(os.path.join(OUT, "index.html"), "w", encoding="utf-8").write(
        "<!doctype html><html lang=ko><head><meta charset=utf-8>"
        "<meta name=viewport content='width=device-width,initial-scale=1'>"
        "<meta http-equiv=Cache-Control content=no-cache>"
        "<title>히오스 영웅 3D</title><style>"
        "body{background:#0b0f16;color:#e6edf7;margin:0;padding:24px 28px 40px;"
        "font-family:'Malgun Gothic',sans-serif}"
        "h1{font-size:20px;margin:0 0 4px}"
        "p.sub{color:#8b9bb4;font-size:13px;margin:0}"
        "#notice{margin:16px 0 8px;padding:12px 14px;border-radius:8px;"
        "background:#1b1408;border:1px solid #6b4f1d;color:#e8d9b6;"
        "font-size:13px;line-height:1.7;max-width:820px}"
        "#notice b{color:#ffcf7a}"
        "h2{font-size:15px;color:#7ee0c0;margin:26px 0 10px;"
        "padding-bottom:6px;border-bottom:1px solid #1e2836}"
        "h2 i{font-style:normal;color:#5b6b84;font-size:11px;margin-left:8px}"
        ".grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(84px,"
        "1fr));gap:10px}"
        ".hero{display:flex;flex-direction:column;align-items:center;gap:6px;"
        "text-decoration:none;color:#c3cfe2;font-size:12px;text-align:center;"
        "padding:6px 2px;border-radius:10px}"
        ".hero img{width:64px;height:64px;border-radius:50%;"
        "border:2px solid #243044;background:#131a24;display:block}"
        ".hero:hover{color:#fff;background:#131a24}"
        ".hero:hover img{border-color:#f0c04a;"
        "box-shadow:0 0 12px #f0c04a66}"
        "@media (max-width:640px){body{padding:16px 12px 32px}"
        ".grid{grid-template-columns:repeat(auto-fill,minmax(72px,1fr));gap:8px}"
        ".hero img{width:56px;height:56px}}"
        "</style></head><body>"
        "<h1>히오스 영웅 3D</h1>"
        "<p class=sub>영웅 " + str(total) + "명 · 역할군별로 살펴보세요. "
        "영웅을 누르면 스킨·크로마를 3D 로 돌려볼 수 있고, "
        "변신 형태가 있는 영웅은 그 안에서 건너뜁니다.</p>"
        "<div id=notice><b>비상업 팬 제작물입니다.</b> 게임 모델·텍스처·"
        "동작은 <b>© Blizzard Entertainment</b> (Heroes of the Storm) 의 "
        "저작물이며, 이 사이트는 블리자드와 아무 관련이 없습니다. "
        "광고·후원 없이 개인이 만든 감상용이고, 권리자의 요청이 있으면 "
        "즉시 내립니다.</div>" + secs +
        "<p style='margin-top:30px;font-size:11px;color:#5b6b84'>"
        "제작 SINONIS · Claude(Anthropic) 도움</p>"
        "</body></html>")
    print("웹판 만듦: 영웅 %d명 (목록 %d명 · %d역할군)"
          % (len(cards), total, len(grp)))


if __name__ == "__main__":
    main()
