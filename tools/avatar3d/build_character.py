"""Premium 3D AI avatar — Blender + MPFB (MakeHuman, CC0) personaj yaratish va kadrlarni chiqarish.

Ishga tushirish (Blender 4.5 + MPFB 2 o'rnatilgan, asset packlar: system_assets, hair01, eyebrows01,
eyelashes01, shirts01, skins01, faceunits01, visemes01):

    blender -b -P tools/avatar3d/build_character.py -- --gender female --out out_dir [--preview]

--preview: faqat bitta neytral kadr (ko'rinishni tekshirish uchun).
Aks holda: barcha holat × viseme × ko'z kombinatsiyalari (render_set) — worker/app/avatar/assets3d ga.
Barcha personaj materiallari CC0 (MakeHuman community asset packs).
"""
from __future__ import annotations

import json
import math
import os
import sys

import bpy

from bl_ext.user_default.mpfb.services.faceservice import FaceService
from bl_ext.user_default.mpfb.services.humanservice import HumanService
from bl_ext.user_default.mpfb.services.locationservice import LocationService
from bl_ext.user_default.mpfb.services.objectservice import ObjectService

ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def arg(name, default=None):
    if name in ARGS:
        i = ARGS.index(name)
        return ARGS[i + 1] if i + 1 < len(ARGS) and not ARGS[i + 1].startswith("--") else True
    return default


GENDER = arg("--gender", "female")
OUT = os.path.abspath(arg("--out", "avatar_out"))
PREVIEW = bool(arg("--preview", False))
SIZE = int(arg("--size", 720))
os.makedirs(OUT, exist_ok=True)

DATA = LocationService.get_user_data()

LOOKS = {
    "female": {
        "macro": {"gender": 0.0, "age": 0.45, "muscle": 0.45, "weight": 0.45, "proportions": 0.75, "height": 0.5,
                  "cupsize": 0.5, "firmness": 0.5, "race": {"asian": 0.4, "caucasian": 0.55, "african": 0.05}},
        "skin": "skins/young_asian_female/young_asian_female.mhmat",
        "hair": "hair/long01/long01.mhclo",
        "eyebrows": "eyebrows/eyebrow001/eyebrow001.mhclo",
        "eyelashes": "eyelashes/eyelashes01/eyelashes01.mhclo",
        "clothes": ["clothes/female_elegantsuit01/female_elegantsuit01.mhclo"],
        "eyes_mat": "eyes/materials/brown.mhmat",
    },
    "male": {
        "macro": {"gender": 1.0, "age": 0.5, "muscle": 0.55, "weight": 0.5, "proportions": 0.7, "height": 0.55,
                  "cupsize": 0.5, "firmness": 0.5, "race": {"asian": 0.4, "caucasian": 0.55, "african": 0.05}},
        "skin": "skins/young_asian_male/young_asian_male.mhmat",
        "hair": "hair/short02/short02.mhclo",
        "eyebrows": "eyebrows/eyebrow002/eyebrow002.mhclo",
        "eyelashes": "eyelashes/eyelashes02/eyelashes02.mhclo",
        "clothes": ["clothes/male_elegantsuit01/male_elegantsuit01.mhclo"],
        "eyes_mat": "eyes/materials/brown.mhmat",
    },
}


def p(rel):
    return os.path.join(DATA, rel)


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def build(look):
    basemesh = HumanService.create_human(macro_detail_dict=look["macro"])
    # Skelet AVVAL — keyin qo'shilgan soch/kiyim/ko'z unga bog'lanadi (qo'l pozasi kiyimga ham ta'sir qiladi)
    rig = HumanService.add_builtin_rig(basemesh, "default")
    HumanService.add_mhclo_asset(p("eyes/high-poly/high-poly.mhclo"), basemesh, asset_type="Eyes", subdiv_levels=1)
    HumanService.add_mhclo_asset(p(look["eyebrows"]), basemesh, asset_type="Eyebrows", subdiv_levels=0)
    HumanService.add_mhclo_asset(p(look["eyelashes"]), basemesh, asset_type="Eyelashes", subdiv_levels=0)
    HumanService.add_mhclo_asset(p("teeth/teeth_base/teeth_base.mhclo"), basemesh, asset_type="Teeth", subdiv_levels=1)
    HumanService.add_mhclo_asset(p("tongue/tongue01/tongue01.mhclo"), basemesh, asset_type="Tongue", subdiv_levels=1)
    HumanService.add_mhclo_asset(p(look["hair"]), basemesh, asset_type="Hair", subdiv_levels=1)
    for c in look["clothes"]:
        HumanService.add_mhclo_asset(p(c), basemesh, asset_type="Clothes", subdiv_levels=1)
    HumanService.set_character_skin(p(look["skin"]), basemesh, skin_type="ENHANCED_SSS")
    # Yuz ifodalari (ARKit 52) va visemalar — basemesh'ga, so'ng qosh/kiprik/tish/kiyimga interpolyatsiya
    FaceService.load_targets(basemesh, load_microsoft_visemes=True, load_meta_visemes=False, load_arkit_faceunits=True)
    FaceService.interpolate_targets(basemesh)
    pose_arms_down(rig)
    darken_hair()
    tint_skin(basemesh)
    sub = basemesh.modifiers.get("Subdivision") or basemesh.modifiers.new("Subdivision", "SUBSURF")
    sub.levels = 1
    sub.render_levels = 2
    return basemesh


def pose_arms_down(rig):
    import mathutils
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="POSE")
    for side, sign in (("L", -1), ("R", 1)):
        b = rig.pose.bones.get(f"upperarm01.{side}")
        if b is not None:
            b.rotation_mode = "XYZ"
            b.rotation_euler = mathutils.Euler((0.0, 0.0, math.radians(68) * sign), "XYZ")
    bpy.ops.object.mode_set(mode="OBJECT")


def _tint_tree(nt, value, sat, hue, seen):
    if nt is None or nt.name in seen:
        return
    seen.add(nt.name)
    for node in list(nt.nodes):
        if node.type == "GROUP":
            _tint_tree(node.node_tree, value, sat, hue, seen)
            continue
        if node.type != "TEX_IMAGE" or not node.image:
            continue
        nm = node.image.name.lower()
        if node.image.colorspace_settings.name != "sRGB" or any(k in nm for k in ("normal", "bump", "rough", "spec", "sss", "ao")):
            continue
        for link in list(node.outputs["Color"].links):
            hsv = nt.nodes.new("ShaderNodeHueSaturation")
            hsv.inputs["Hue"].default_value = hue
            hsv.inputs["Value"].default_value = value
            hsv.inputs["Saturation"].default_value = sat
            nt.links.new(node.outputs["Color"], hsv.inputs["Color"])
            nt.links.new(hsv.outputs["Color"], link.to_socket)


def tint_skin(basemesh, value=0.84, sat=1.2, hue=0.495):
    """Teri — biroz bug'doyrang, iliqroq (O'rta Osiyo): teri teksturasi ustidan HSV (guruh tugunlari ichida ham)."""
    seen = set()
    for slot in basemesh.material_slots:
        m = slot.material
        if m and m.use_nodes:
            _tint_tree(m.node_tree, value, sat, hue, seen)


def darken_hair(value=0.38, sat=0.9):
    """Soch rangi — to'q jigarrang/qora (o'zbek ko'rinishi): tekstura ustidan HSV."""
    for o in bpy.data.objects:
        if o.type != "MESH" or ObjectService.get_object_type(o) != "Hair":
            continue
        for slot in o.material_slots:
            m = slot.material
            if not m or not m.use_nodes:
                continue
            nt = m.node_tree
            for node in list(nt.nodes):
                if node.type != "TEX_IMAGE":
                    continue
                for link in list(node.outputs["Color"].links):
                    hsv = nt.nodes.new("ShaderNodeHueSaturation")
                    hsv.inputs["Value"].default_value = value
                    hsv.inputs["Saturation"].default_value = sat
                    nt.links.new(node.outputs["Color"], hsv.inputs["Color"])
                    nt.links.new(hsv.outputs["Color"], link.to_socket)


def head_point(basemesh):
    """Ko'zlar markazi (dunyo koordinatasi) — kamera nishoni (helper geometriya chalg'itmasin)."""
    import mathutils
    eyes = [o for o in bpy.data.objects if o.type == "MESH" and ObjectService.get_object_type(o) == "Eyes"]
    if eyes:
        o = eyes[0]
        pts = [o.matrix_world @ mathutils.Vector(c) for c in o.bound_box]
        z = sum(v.z for v in pts) / 8
        return mathutils.Vector((0.0, 0.0, z)), z
    mw = basemesh.matrix_world
    top = max((mw @ v.co).z for v in basemesh.data.vertices)
    return mathutils.Vector((0.0, 0.0, top - 0.12)), top


def setup_scene(basemesh):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x = SIZE
    scene.render.resolution_y = SIZE
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"
    ee = scene.eevee
    for attr, val in (("taa_render_samples", 128), ("use_raytracing", True), ("use_shadows", True)):
        if hasattr(ee, attr):
            setattr(ee, attr, val)

    target, top = head_point(basemesh)
    # Kamera: ko'krakdan yuqori portret, 85 mm
    cam_data = bpy.data.cameras.new("cam")
    cam_data.lens = 85
    cam = bpy.data.objects.new("cam", cam_data)
    scene.collection.objects.link(cam)
    aim = target.copy()
    aim.z -= 0.06                                   # yaqinroq portret: yuz katta va tiniq, yelka qisman
    cam.location = (0.0, -1.18, aim.z + 0.02)
    direction = aim - cam.location
    cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    scene.camera = cam

    def area(name, loc, energy, size, color=(1, 1, 1)):
        ld = bpy.data.lights.new(name, "AREA")
        ld.energy = energy
        ld.size = size
        ld.color = color
        lo = bpy.data.objects.new(name, ld)
        lo.location = loc
        d = aim - lo.location
        lo.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
        scene.collection.objects.link(lo)

    # Studiya: issiq asosiy (key), sovuq to'ldiruvchi (fill), orqa kontur (rim)
    area("key", (-0.9, -1.1, aim.z + 0.55), 38, 1.2, (1.0, 0.95, 0.88))
    area("fill", (1.0, -1.0, aim.z + 0.15), 12, 1.6, (0.88, 0.94, 1.0))
    area("rim", (0.6, 0.9, aim.z + 0.6), 30, 0.8, (1.0, 0.93, 0.9))
    area("hair", (-0.5, 0.6, aim.z + 1.0), 14, 0.6)
    world = bpy.data.worlds.new("w")
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    bg.inputs[0].default_value = (0.32, 0.34, 0.40, 1.0)
    bg.inputs[1].default_value = 0.25
    scene.world = world


def shape_objects(basemesh):
    root = basemesh.parent or basemesh
    objs = [basemesh] + [o for o in bpy.data.objects if o.type == "MESH" and o is not basemesh]
    return [o for o in objs if o.data.shape_keys]


def set_keys(objs, values):
    for o in objs:
        for kb in o.data.shape_keys.key_blocks:
            # Modellash kalitlari ($md-, tana shakli) va Basis — tegilmaydi; ifoda/viseme — har kadrda noldan
            if kb.name == "Basis" or kb.name.startswith("$md") or kb.name.startswith("$"):
                continue
            kb.value = 0.0
        for name, v in values.items():
            for cand in (name, "!ex-" + name):
                kb = o.data.shape_keys.key_blocks.get(cand)
                if kb is not None:
                    kb.value = float(v)


def render(path):
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def main():
    clear_scene()
    look = LOOKS[GENDER]
    basemesh = build(look)
    setup_scene(basemesh)
    objs = shape_objects(basemesh)
    names = sorted({kb.name for o in objs for kb in o.data.shape_keys.key_blocks})
    with open(os.path.join(OUT, f"{GENDER}_shapekeys.json"), "w") as f:
        json.dump(names, f, indent=0)
    if PREVIEW:
        set_keys(objs, {"mouthSmileLeft": 0.35, "mouthSmileRight": 0.35})
        render(os.path.join(OUT, f"{GENDER}_preview.png"))
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, f"{GENDER}.blend"))
        return
    from render_set import render_set
    render_set(objs, set_keys, render, OUT, GENDER, sheet=bool(arg("--sheet", False)))


if __name__ == "__main__":
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    main()
