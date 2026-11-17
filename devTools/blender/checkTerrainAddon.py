"""Checks the terrain add-on (src/toolkit/terrain/blender/aekasha_terrain_tools.py) in a background
Blender: loads it from its path, registers it and runs each check, writing `report.json` into the
output folder. A failed check raises, so `--python-exit-code 1` fails the run.

Run: blender -b --factory-startup --python-exit-code 1 --python checkTerrainAddon.py -- <addon.py> <out dir>
(a Windows blender.exe from WSL2 takes Windows paths: `wslpath -w`). `yarn verify:blender` runs it
(p306 Phase 5 step 9).
"""

import importlib.util
import json
import os
import sys
import time
import traceback

import bpy

args = sys.argv[sys.argv.index("--") + 1 :]
ADDON_PATH, OUT_DIR = args[0], args[1]
os.makedirs(OUT_DIR, exist_ok=True)


def load_addon():
    spec = importlib.util.spec_from_file_location("aekasha_terrain_tools", ADDON_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def expect(condition, message):
    if not condition:
        raise AssertionError(message)


# --- Checks: each takes the add-on module -------------------------------------------------------


def check_conventions(aek):
    expect(aek.bl_info["blender"] >= (5, 3, 0), "bl_info's minimum is Blender 5.3")
    expect([r for r in range(2, 600) if aek.is_block_resolution(r)] == [3, 5, 9, 17, 33, 65, 129, 257, 513],
           "is_block_resolution accepts 2^n + 1 only")
    expect(all(aek.is_block_resolution(r) for r in aek.BLOCK_RESOLUTIONS), "every offered resolution is 2^n + 1")
    expect(aek.get_spacing(64, 129) == 0.5, "64 m / 129 is 0.5 m")
    # Row 0 at the engine's -z (Blender +y), column 0 at -x; V along Blender +y
    expect(aek.get_grid_vertex(64, 129, 0, 0) == (-32.0, 32.0), "vertex (0, 0) at the -x, -z corner")
    expect(aek.get_grid_vertex(64, 129, 128, 128) == (32.0, -32.0), "the last vertex at +x, +z")
    expect(aek.get_grid_uv(129, 0, 0) == (0.0, 1.0), "row 0's V is 1 in Blender (0 after the export's flip)")
    expect(aek.get_grid_location(64, 2, -1) == (128.0, 64.0, 0.0), "grid (2, -1) at world (128, 0, -64)")
    props = aek.get_block_custom_props(64, 129, 2, -1)
    expect(props["nCols"] == 128 and props["nRows"] == 128, "nCols / nRows count cells")
    expect(props["colliderType"] == "HEIGHTFIELD" and props["keepMesh"] == 1, "a visible heightfield body")


def check_triangles(aek):
    res = 3
    tris = aek.get_grid_triangles(res)
    expect(len(tris) == 2 * (res - 1) ** 2, "two triangles a cell")
    for tri in tris:
        # Counter-clockwise from above (Blender +z): the face's normal points up
        (x0, y0), (x1, y1), (x2, y2) = (aek.get_grid_vertex(2, res, i // res, i % res) for i in tri)
        expect((x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0) > 0, f"triangle {tri} faces up")
    for row in range(res - 1):
        for col in range(res - 1):
            # Both triangles of a cell share (row + 1, col)-(row, col + 1), the heightfield's diagonal
            first, second = tris[2 * (row * (res - 1) + col) : 2 * (row * (res - 1) + col) + 2]
            shared = set(first) & set(second)
            expect(shared == {(row + 1) * res + col, row * res + col + 1}, f"cell ({row}, {col})'s diagonal")


def check_settings(aek):
    expect(hasattr(bpy.types, "VIEW3D_PT_aek_terrain"), "the panel registers")
    mesh = bpy.data.meshes.new("check")
    obj = bpy.data.objects.new("check", mesh)
    settings = obj.aek_terrain_block
    expect(settings.size == "64" and settings.resolution == "129", "the defaults: 64 m / 129")
    expect(aek.get_block_settings(obj) is None, "a mesh that isn't a block has no settings")
    settings.is_block = True
    expect(aek.get_block_settings(obj) == settings, "a block's settings")
    bpy.data.objects.remove(obj)
    bpy.data.meshes.remove(mesh)


def expect_refused(call, message):
    try:
        call()
    except RuntimeError:
        return
    raise AssertionError(message)


def check_add_block(aek):
    size, res = 32, 33
    bpy.ops.aek.add_terrain_block(block_id="checkBlock", size=str(size), resolution=str(res),
                                  grid_x=1, grid_z=-1, layout="RGB_AO")
    obj = bpy.data.objects["checkBlock"]
    mesh = obj.data
    expect(bpy.context.view_layer.objects.active == obj and obj.select_get(), "the new block is active")
    expect(len(mesh.vertices) == res * res, "resolution² vertices")
    for i, v in enumerate(mesh.vertices):
        x, y = aek.get_grid_vertex(size, res, i // res, i % res)
        expect(tuple(v.co) == (x, y, 0.0), f"vertex {i} at {tuple(v.co)}, not ({x}, {y}, 0)")
    triangles = aek.get_grid_triangles(res)
    expect(len(mesh.polygons) == len(triangles), "two triangles a cell")
    for poly, tri in zip(mesh.polygons, triangles):
        expect(tuple(poly.vertices) == tri, f"face {poly.index} is {tuple(poly.vertices)}, not {tri}")
        expect(poly.use_smooth, f"face {poly.index} is smooth")
    uv = mesh.uv_layers.active.data
    for loop in mesh.loops:
        i = loop.vertex_index
        expected = aek.get_grid_uv(res, i // res, i % res)
        got = tuple(uv[loop.index].uv)
        expect(all(abs(g - e) < 1e-6 for g, e in zip(got, expected)), f"loop {loop.index}'s UV {got}")
    splat = mesh.color_attributes.get(aek.SPLAT_ATTRIBUTE)
    expect(splat is not None and splat.data_type == "BYTE_COLOR" and splat.domain == "POINT",
           "a byte, vertex-domain Splat")
    expect(mesh.color_attributes.active_color_name == aek.SPLAT_ATTRIBUTE, "the Splat is active")
    expect(mesh.color_attributes.render_color_index == mesh.color_attributes.active_color_index,
           "the Splat is the render colour")
    expect(all(tuple(d.color) == (0.0, 0.0, 0.0, 1.0) for d in splat.data), "RGB_AO starts black, A 1")
    expect(tuple(obj.location) == (32.0, 32.0, 0.0), "grid (1, -1) of 32 m at Blender (32, 32, 0)")
    expect(tuple(obj.rotation_euler) == (0, 0, 0) and tuple(obj.scale) == (1, 1, 1), "no rotation or scale")
    props = {k: obj[k] for k in aek.get_block_custom_props(size, res, 1, -1)}
    expect(props == aek.get_block_custom_props(size, res, 1, -1), f"the custom props: {props}")
    expect(mesh.materials[0].name == aek.PREVIEW_MATERIAL, "the preview material")

    expect_refused(lambda: bpy.ops.aek.add_terrain_block(block_id="checkBlock", grid_x=5),
                   "a taken id is refused")
    expect_refused(lambda: bpy.ops.aek.add_terrain_block(block_id="other", size="32", grid_x=1, grid_z=-1),
                   "a taken grid place is refused")
    expect_refused(lambda: bpy.ops.aek.add_terrain_block(block_id="1st"), "an id starting with a digit is refused")

    bpy.ops.aek.add_terrain_block(block_id="checkRgba", size="32", resolution="33", layout="RGBA")
    rgba = bpy.data.objects["checkRgba"].data.color_attributes[aek.SPLAT_ATTRIBUTE]
    expect(all(tuple(d.color) == (0.0, 0.0, 0.0, 0.0) for d in rgba.data), "RGBA starts at 0, A too")


def check_add_large_block(aek):
    started = time.perf_counter()
    bpy.ops.aek.add_terrain_block(block_id="checkLarge", size="256", resolution="257", grid_x=4)
    REPORT["add_257_seconds"] = round(time.perf_counter() - started, 3)
    expect(len(bpy.data.objects["checkLarge"].data.vertices) == 257 * 257, "257² vertices")


CHECKS = [check_conventions, check_triangles, check_settings, check_add_block, check_add_large_block]
REPORT = {"blender": bpy.app.version_string, "checks": {}}


def main():
    aek = load_addon()
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj)
    report = REPORT
    failed = []
    aek.register()
    try:
        for check in CHECKS:
            try:
                check(aek)
                report["checks"][check.__name__] = "ok"
            except Exception:
                report["checks"][check.__name__] = traceback.format_exc()
                failed.append(check.__name__)
    finally:
        aek.unregister()
    if hasattr(bpy.types, "VIEW3D_PT_aek_terrain"):
        failed.append("unregister")
        report["checks"]["unregister"] = "the panel is still registered"
    with open(os.path.join(OUT_DIR, "report.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)
    if failed:
        raise RuntimeError(f"Failed: {', '.join(failed)} (see {OUT_DIR}/report.json)")


main()
