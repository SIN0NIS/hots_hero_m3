# 동작 이름표 — "Spell B" 가 어느 기술(W 눈보라)인지. 뷰어가 [동작 전부] 를 받을 때 같이 받는다.
#   python tools/build_anim_labels.py
# 근거는 게임 액터 자료의 «Abil.<기술>.SourceCastStart → AnimPlay Spell Spell,B» 를 뽑아 둔
# ../02_뷰어/hots_hero/data/skills.js (tools/build_skills.py). 이름을 눈대중으로 맞추지 않는다.
# 결과: data/anims_all/_labels.js  window.ANIM_LABELS = { <동작 파일>: { <동작>: [칸, 기술 이름] } }
#   칸: Q W E R(궁극기) D(고유 능력) 1(사용 효과) B(귀환) Z(탈것) 평타
# 같은 기술에 걸린 동작이 여럿이면(Spell C · Spell C Alternate) 뷰어가 "E 냉기 돌풍 1 · 2" 로 번호를 붙인다.
import json, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.dirname(HERE)
SKILLS = os.path.join(os.path.dirname(WEB), "02_뷰어", "hots_hero", "data", "skills.js")
OUT = os.path.join(WEB, "data", "anims_all", "_labels.js")
SLOT = {"Q": "Q", "W": "W", "E": "E", "Heroic": "R", "Trait": "D", "Active": "1", "B": "B", "Z": "Z", "평타": "평타"}


def main():
    t = open(SKILLS, encoding="utf-8").read()
    sk = json.loads(t[t.index("=") + 1:].rstrip().rstrip(";"))
    out, miss = {}, []
    for f in sorted(os.listdir(os.path.dirname(OUT))):
        if f.startswith("_") or not f.endswith(".js"):
            continue
        key = f[:-3]
        m = re.match(r"storm_(?:hero|morph)_([a-z0-9]+)", key)
        h = sk.get(m.group(1)) if m else None
        if not h:
            miss.append(key)
            continue
        ab = {a["id"]: a for a in h["abils"]}
        lab = {}
        for anim, x in h["anim"].items():
            a = ab.get(x.get("abil"))
            if not a:
                continue
            slot = SLOT.get(a["type"], a["type"])
            lab[anim] = [slot, "평타" if slot == "평타" else a["name"]]
        if lab:
            out[key] = lab
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("window.ANIM_LABELS=" + json.dumps(out, ensure_ascii=False, separators=(",", ":")) + ";\n")
    print("이름표 %d 묶음 · %.0fKB · 못 찾음 %s" % (len(out), os.path.getsize(OUT) / 1024, miss or "없음"))


if __name__ == "__main__":
    main()
