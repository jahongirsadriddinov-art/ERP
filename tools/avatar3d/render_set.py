"""Avatar kadrlari: ifoda × viseme × ko'z (build_character.py chaqiradi).

Ifodalar ARKit face unit og'irliklari bilan; visemalar — Microsoft visemes01 (MakeHuman, CC0).
Natija: {gender}/{expr}_{vis}_{eye}.png (RGBA) + manifest.json — worker'dagi renderer shu kadrlarni
holatga qarab tanlaydi va silliq almashtiradi.
"""
from __future__ import annotations

import json
import os

EXPRESSIONS: dict[str, dict[str, float]] = {
    # Owner 2026-10-19: "g'alati kulib turibdi — jiddiyroq bo'lsin": oddiy holat — jiddiy, xotirjam (tabassumsiz)
    "neutral": {"mouthPressLeft": 0.08, "mouthPressRight": 0.08},
    # Yengil, samimiy tabassum (tirjayish emas)
    "happy": {"mouthSmileLeft": 0.38, "mouthSmileRight": 0.38, "cheekSquintLeft": 0.2, "cheekSquintRight": 0.2,
              "eyeSquintLeft": 0.12, "eyeSquintRight": 0.12},
    "thinking": {"browInnerUp": 0.25, "browOuterUpLeft": 0.7, "browDownRight": 0.3, "eyeLookUpLeft": 0.6,
                 "eyeLookUpRight": 0.6, "eyeLookOutLeft": 0.4, "eyeLookInRight": 0.4, "mouthPressLeft": 0.45,
                 "mouthRight": 0.25, "eyeSquintRight": 0.15},
    "concerned": {"browInnerUp": 0.8, "browDownLeft": 0.15, "browDownRight": 0.15, "mouthFrownLeft": 0.4,
                  "mouthFrownRight": 0.4, "mouthStretchLeft": 0.12, "mouthStretchRight": 0.12},
    "surprised": {"eyeWideLeft": 0.7, "eyeWideRight": 0.7, "browInnerUp": 0.7, "browOuterUpLeft": 0.7,
                  "browOuterUpRight": 0.7, "jawOpen": 0.15},
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
