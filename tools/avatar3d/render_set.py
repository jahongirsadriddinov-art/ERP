"""Avatar kadrlari: ifoda × viseme × ko'z (build_character.py chaqiradi).

Ifodalar ARKit face unit og'irliklari bilan; visemalar — Microsoft visemes01 (MakeHuman, CC0).
Natija: {gender}/{expr}_{vis}_{eye}.png (RGBA) + manifest.json — worker'dagi renderer shu kadrlarni
holatga qarab tanlaydi va silliq almashtiradi.
"""
from __future__ import annotations

import json
import os

EXPRESSIONS: dict[str, dict[str, float]] = {
    "neutral": {"mouthSmileLeft": 0.18, "mouthSmileRight": 0.18},
    "happy": {"mouthSmileLeft": 1.0, "mouthSmileRight": 1.0, "cheekSquintLeft": 0.7, "cheekSquintRight": 0.7,
              "eyeSquintLeft": 0.35, "eyeSquintRight": 0.35, "browInnerUp": 0.2, "mouthDimpleLeft": 0.3, "mouthDimpleRight": 0.3},
    "thinking": {"browInnerUp": 0.3, "browOuterUpLeft": 0.9, "browDownRight": 0.35, "eyeLookUpLeft": 0.7,
                 "eyeLookUpRight": 0.7, "eyeLookOutLeft": 0.45, "eyeLookInRight": 0.45, "mouthPressLeft": 0.6,
                 "mouthRight": 0.35, "eyeSquintRight": 0.2},
    "concerned": {"browInnerUp": 1.0, "browDownLeft": 0.2, "browDownRight": 0.2, "mouthFrownLeft": 0.6,
                  "mouthFrownRight": 0.6, "mouthStretchLeft": 0.2, "mouthStretchRight": 0.2, "mouthPressLeft": 0.2, "mouthPressRight": 0.2},
    "surprised": {"eyeWideLeft": 0.9, "eyeWideRight": 0.9, "browInnerUp": 0.9, "browOuterUpLeft": 0.9,
                  "browOuterUpRight": 0.9, "jawOpen": 0.2, "mouthFunnel": 0.2},
}

# Gapirish shakllari (lab sinxroni uchun yetarli to'plam)
VISEMES: dict[str, dict[str, float]] = {
    "rest": {},
    "A": {"aa_02": 0.9},              # a, o (keng)
    "E": {"ey_eh_uh_04": 0.9},        # e, i
    "O": {"ow_08": 0.9},              # o, u
    "U": {"w_uw_07": 0.9},            # u, v
    "M": {"p_b_m_21": 1.0},           # m, b, p (yopiq lab)
    "F": {"f_v_18": 0.9},             # f, v
}

EYES: dict[str, dict[str, float]] = {
    "open": {},
    "closed": {"eyeBlinkLeft": 1.0, "eyeBlinkRight": 1.0},
}

SHEET = [("neutral", "rest", "open"), ("happy", "rest", "open"), ("thinking", "rest", "open"),
         ("concerned", "rest", "open"), ("surprised", "rest", "open"), ("neutral", "A", "open"),
         ("neutral", "O", "open"), ("neutral", "E", "open"), ("neutral", "rest", "closed"), ("happy", "A", "open")]


def combos(sheet: bool):
    if sheet:
        return SHEET
    out = []
    for e in EXPRESSIONS:
        for v in VISEMES:
            out.append((e, v, "open"))
        out.append((e, "rest", "closed"))
    return out


def render_set(objs, set_keys, render, out_dir, gender, sheet=False):
    d = os.path.join(out_dir, gender)
    os.makedirs(d, exist_ok=True)
    manifest = []
    for e, v, eye in combos(sheet):
        vals: dict[str, float] = {}
        for src in (EXPRESSIONS[e], VISEMES[v], EYES[eye]):
            for k, w in src.items():
                vals[k] = min(1.0, vals.get(k, 0.0) + w)
        # Gapirganda tabassum biroz kamayadi (lab shakli aniq ko'rinsin)
        if v != "rest":
            for k in ("mouthSmileLeft", "mouthSmileRight"):
                if k in vals:
                    vals[k] *= 0.6
        set_keys(objs, vals)
        name = f"{e}_{v}_{eye}.png"
        render(os.path.join(d, name))
        manifest.append({"expr": e, "vis": v, "eye": eye, "file": name})
    with open(os.path.join(d, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=1)
