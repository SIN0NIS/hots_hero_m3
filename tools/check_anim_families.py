# 동작 묶음 점검 — 뷰어(js/viewer.js 의 parseAnim·buildFamilies)와 같은 이름 규칙으로 묶고,
# 잇는 자리(앞 동작 마지막 자세 ↔ 뒤 동작 첫 자세)의 뼈 회전 차이를 전체 동작 파일에서 잰다.
#   python tools/check_anim_families.py            → 요약
#   python tools/check_anim_families.py --worst 20 → 어긋난 자리 목록
# 뷰어는 4° 미만이면 섞지 않고 그대로 잇고, 넘으면 0.26초 섞는다(SEAM_OK).
import argparse, base64, glob, json, math, os, re
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
DIR = os.path.join(os.path.dirname(HERE), "data", "anims_all")
SEAM_OK = 4.0


def parse(nm):
    w = nm.split()
    phase, vari, props = "", 0, []
    for x in w[1:]:
        lx = x.lower()
        if lx in ("start", "birth"): phase = "start"
        elif lx in ("end", "stop"): phase = "end"
        elif lx.isdigit(): vari = int(lx)
        else: props.append(lx)
    return phase, vari, w[0].lower() + ("" if not props else " " + " ".join(sorted(props)))


def rots(a, n, rest):
    """뼈마다 (첫 키, 마지막 키) 회전. 트랙 없는 뼈는 쉬는 자세."""
    off = np.frombuffer(base64.b64decode(a["rot_off"]), "<u4")
    v = np.frombuffer(base64.b64decode(a["rot_v"]), "<i2").astype(np.float32).reshape(-1, 4) / 32767
    first, last = rest.copy(), rest.copy()
    for k, b in enumerate(np.frombuffer(base64.b64decode(a["bones"]), "<u2")):
        s, e = off[k], off[k + 1]
        if e > s and 0 <= b < n:
            first[b], last[b] = v[s], v[e - 1]
    return first, last


def deg(p, q, used):
    d = np.abs((p[used] * q[used]).sum(1)) / (np.linalg.norm(p[used], axis=1) * np.linalg.norm(q[used], axis=1) + 1e-9)
    return float(np.degrees(2 * np.arccos(np.clip(d, 0, 1))).mean()) if len(used) else 0.0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--worst", type=int, default=0)
    a = ap.parse_args()
    kinds = {"시작→반복": [], "반복→끝": [], "반복 되풀이": [], "번호 판끼리": [], "끝→상위 동작": []}
    worst, nfam, nfile = [], 0, 0
    for f in sorted(glob.glob(os.path.join(DIR, "*.js"))):
        if os.path.basename(f).startswith("_"):
            continue
        t = open(f, encoding="utf-8").read()
        d = json.loads(t[t.index("]=") + 2:].rstrip().rstrip(";"))
        n = len(d["names"])
        rest = np.frombuffer(base64.b64decode(d["rrot"]), "<f4").reshape(-1, 4).copy()
        an = d["anims"]
        R = [rots(x, n, rest) for x in an]
        bones = [set(int(b) for b in np.frombuffer(base64.b64decode(x["bones"]), "<u2") if b < n) for x in an]
        fam = {}
        for i, x in enumerate(an):
            ph, v, key = parse(x["name"])
            fam.setdefault(key, {"start": [], "body": [], "end": []})[ph or "body"].append((v, i))
        nfile += 1
        key = os.path.basename(f)[:-3]

        def seam(i, j, kind):
            s = deg(R[i][1], R[j][0], sorted(bones[i] | bones[j]))
            kinds[kind].append(s)
            worst.append((s, key, an[i]["name"], an[j]["name"], kind))

        for k, F in fam.items():
            for p in F: F[p] = [i for _, i in sorted(F[p])]
            if len(F["start"]) + len(F["body"]) + len(F["end"]) < 2:
                continue
            nfam += 1
            if F["start"] and F["body"]: seam(F["start"][0], F["body"][0], "시작→반복")
            if F["body"] and F["end"]: seam(F["body"][-1], F["end"][0], "반복→끝")
            for b in F["body"][:1]: seam(b, b, "반복 되풀이")
            for x, y in zip(F["body"], F["body"][1:]): seam(x, y, "번호 판끼리")
            if F["end"]:
                mine = k.split()[1:]
                best = None
                for j, x in enumerate(an):
                    ph, v, k2 = parse(x["name"])
                    th = k2.split()[1:]
                    if ph or k2.split()[0] != k.split()[0] or len(th) >= len(mine) or any(z not in mine for z in th):
                        continue
                    s = deg(R[F["end"][0]][1], R[j][0], sorted(bones[F["end"][0]] | bones[j]))
                    best = s if best is None else min(best, s)
                if best is not None:
                    kinds["끝→상위 동작"].append(best)
    print(f"동작 파일 {nfile}개 · 2개 이상 묶인 묶음 {nfam}개 · 4° 미만 = 그대로 이음")
    for k, v in kinds.items():
        if not v: continue
        v = np.array(v)
        print(f"  {k:10s} {len(v):5d}자리  4°미만 {np.mean(v < SEAM_OK) * 100:5.1f}%  중앙값 {np.median(v):5.1f}°")
    if a.worst:
        for s, key, x, y, kind in sorted(w for w in worst if w[4] != "번호 판끼리")[-a.worst:]:
            print(f"  {s:6.1f}°  {kind:8s} {key}: {x} → {y}")


if __name__ == "__main__":
    main()
