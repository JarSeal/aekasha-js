"""Checks the terrain add-on (src/toolkit/terrain/blender/aekasha_terrain_tools.py) in a background
Blender: loads it from its path, registers it and runs each check, writing `report.json` into the
output folder. A failed check raises, so `--python-exit-code 1` fails the run.

Run: blender -b --factory-startup --python-exit-code 1 --python checkTerrainAddon.py -- <addon.py> <out dir> <repo root>
(a Windows blender.exe from WSL2 takes Windows paths: `wslpath -w`). `yarn verify:blender` runs it
(p306 Phase 5 step 9).
"""

import importlib.util
import json
import os
import shutil
import struct
import sys
import time
import traceback

import bmesh
import numpy as np
from mathutils import Vector
import bpy

# No __pycache__ next to the add-on in the repo
sys.dont_write_bytecode = True

args = sys.argv[sys.argv.index("--") + 1 :]
ADDON_PATH, OUT_DIR, REPO_ROOT = args[0], args[1], args[2]
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
    trimesh = aek.get_block_custom_props(64, 129, 2, -1, "TRIMESH")
    expect(trimesh["colliderType"] == "TRIMESH" and "nCols" not in trimesh and trimesh["aekBlockRes"] == 129,
           f"a trimesh body has no cell counts: {trimesh}")
    none = aek.get_block_custom_props(64, 129, 2, -1, "NONE")
    expect(set(none) == {"aekBlockSize", "aekBlockRes", "aekGridX", "aekGridZ"}, f"no collider, no body: {none}")
    expect(all(set(p) <= set(aek.BLOCK_PROP_KEYS) for p in (props, trimesh, none)), "every key is in BLOCK_PROP_KEYS")


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


def validate(aek, name):
    bpy.context.view_layer.update()
    obj = bpy.data.objects[name]
    return aek.validate_block(obj, bpy.context.evaluated_depsgraph_get(), bpy.context.scene.objects)


def expect_issue(issues, level, fragment, message):
    expect(any(lv == level and fragment in text for lv, text in issues), f"{message}: got {issues}")


def check_validate(aek):
    # checkBlock: 32 m / 33 at grid (1, -1), from check_add_block
    expect(validate(aek, "checkBlock") == [], "a new block is valid")
    obj = bpy.data.objects["checkBlock"]
    mesh = obj.data

    # A neighbour at +x shares checkBlock's last column as its first
    bpy.ops.aek.add_terrain_block(block_id="checkEast", size="32", resolution="33", grid_x=2, grid_z=-1)
    east = bpy.data.objects["checkEast"].data
    east.vertices[5 * 33].co.z = 0.5
    east.update()
    expect_issue(validate(aek, "checkBlock"), "ERROR", '+x edge differs from "checkEast"', "a mismatched edge")
    expect_issue(validate(aek, "checkEast"), "ERROR", '-x edge differs from "checkBlock"', "seen from the other side")
    mesh.vertices[5 * 33 + 32].co.z = 0.5
    mesh.update()
    expect(validate(aek, "checkBlock") == [], "matching edges are valid")

    # A vertex moved in X/Z
    mesh.vertices[40].co.x += 0.01
    mesh.update()
    expect_issue(validate(aek, "checkBlock"), "ERROR", "moved off their grid point", "a moved vertex")
    mesh.vertices[40].co.x -= 0.01
    mesh.update()

    # A cell split along the other diagonal
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bm.verts.ensure_lookup_table()
    diagonal = next(e for e in bm.verts[1].link_edges if e.other_vert(bm.verts[1]).index == 33)
    bmesh.ops.rotate_edges(bm, edges=[diagonal], use_ccw=False)
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()
    expect_issue(validate(aek, "checkBlock"), "WARNING", "1 cells are split along the other diagonal",
                 "a flipped cell")

    # The transform
    obj.rotation_euler.z = 0.1
    expect_issue(validate(aek, "checkBlock"), "ERROR", "Rotated", "a rotation")
    obj.rotation_euler.z = 0
    obj.scale.x = 2
    expect_issue(validate(aek, "checkBlock"), "ERROR", "Scaled", "a scale")
    obj.scale.x = 1
    obj.location.x += 1
    expect_issue(validate(aek, "checkBlock"), "ERROR", "Not at its grid place", "a moved block")
    obj.location.x -= 1

    # A modifier: checked applied, so the raised block no longer meets its neighbour
    displace = obj.modifiers.new("lift", "DISPLACE")
    displace.strength = 0.25
    # Along the normals (its default) the raised vertex's neighbours drift in X/Z
    expect_issue(validate(aek, "checkBlock"), "ERROR", "moved off their grid point", "a Displace along normals")
    displace.direction = "Z"
    displace.mid_level = 0  # without a texture: (1 - midlevel) × strength
    issues = validate(aek, "checkBlock")
    expect_issue(issues, "WARNING", "1 modifiers", "a modifier")
    expect_issue(issues, "ERROR", '+x edge differs from "checkEast" by up to 250.00 mm', "the modifier's heights")
    obj.modifiers.remove(displace)

    # Over-painting, then Normalize Splat
    splat = mesh.color_attributes[aek.SPLAT_ATTRIBUTE]
    splat.data[0].color = (0.6, 0.6, 0.0, 1.0)
    splat.data[1].color = (0.25, 0.25, 0.25, 0.5)
    under = tuple(splat.data[1].color)
    expect_issue(validate(aek, "checkBlock"), "WARNING", "1 vertices' splat weights sum over 1", "an over-painted vertex")
    bpy.context.view_layer.objects.active = obj
    bpy.ops.aek.normalize_splat()
    r, g, b, a = splat.data[0].color
    expect(1 - 0.01 <= r + g + b <= 1 + 1e-6 and abs(r - g) < 0.01 and a == 1.0,
           f"normalized to a sum of 1 at most as stored (sRGB bytes), its ratio and A kept: {(r, g, b, a)}")
    expect(tuple(splat.data[1].color) == under, "a sum under 1 is left alone")
    issues = validate(aek, "checkBlock")
    expect(not any("splat weights" in text for _, text in issues), f"no splat warning after it: {issues}")

    # Many random over-painted vertices, every layout: no stored sum over 1 after it
    for name, layout in (("checkBlock", "RGB_AO"), ("checkRgba", "RGBA")):
        target = bpy.data.objects[name]
        colors = target.data.color_attributes[aek.SPLAT_ATTRIBUTE]
        rng = np.random.default_rng(7)
        values = rng.uniform(0, 1, (len(colors.data), 4))
        colors.data.foreach_set("color", values.ravel())
        bpy.context.view_layer.objects.active = target
        bpy.ops.aek.normalize_splat()
        stored = np.empty(len(colors.data) * 4)
        colors.data.foreach_get("color", stored)
        sums = stored.reshape(-1, 4)[:, : aek.get_splat_channels(layout)].sum(axis=1)
        expect(sums.max() <= 1 + 1e-6, f"{layout}: every stored sum within 1, the largest {sums.max()}")
        expect(sums[values[:, : aek.get_splat_channels(layout)].sum(axis=1) > 1].min() > 0.98,
               f"{layout}: the normalized sums close to 1, the smallest {sums.min()}")
    bpy.context.view_layer.objects.active = obj
    for data in splat.data:
        data.color = (0.0, 0.0, 0.0, 1.0)

    # The operator fills the panel's last result
    bpy.ops.aek.validate_terrain_block()
    expect("checkBlock" in aek._last_validation, "Validate keeps its findings for the panel")

    started = time.perf_counter()
    expect(validate(aek, "checkLarge") == [], "the 257² block is valid")
    REPORT["validate_257_seconds"] = round(time.perf_counter() - started, 3)


def setup_render(size, camera_target, ortho_scale, filepath, file_format):
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 1 if file_format == "OPEN_EXR" else 16
    scene.cycles.filter_width = 0.01
    scene.cycles.use_denoising = file_format != "OPEN_EXR"
    scene.render.resolution_x = scene.render.resolution_y = size
    scene.render.resolution_percentage = 100
    scene.view_settings.view_transform = "Standard"
    scene.render.image_settings.file_format = file_format
    if file_format == "OPEN_EXR":
        scene.render.image_settings.color_depth = "32"
    scene.render.filepath = filepath
    camera = bpy.data.objects.get("checkCamera")
    if camera is None:
        camera = bpy.data.objects.new("checkCamera", bpy.data.cameras.new("checkCamera"))
        scene.collection.objects.link(camera)
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = ortho_scale
    camera.location = (camera_target[0], camera_target[1], 50)
    camera.rotation_euler = (0, 0, 0)
    scene.camera = camera


def render_pixels(path):
    bpy.ops.render.render(write_still=True)
    image = bpy.data.images.load(path)
    width, height = image.size
    pixels = np.array(image.pixels[:]).reshape(height, width, 4)
    bpy.data.images.remove(image)
    return pixels


def check_preview(aek):
    blender_dir = os.path.join(REPO_ROOT, "src", "toolkit", "terrain", "blender")
    expect(aek.find_repo_root(blender_dir) == os.path.normpath(REPO_ROOT), "the repo found above the add-on")
    sets = aek.find_texture_sets(REPO_ROOT)
    expect(len(sets) >= 16, f"the toolkit's sets found: {sorted(sets)}")
    grass = sets["grass01"]
    expect(grass["physical_size"] == (1.4, 1.4) and grass["height_contrast"] == 1.0, f"grass01's data: {grass}")
    expect(grass["color"] and grass["height"], "grass01's fetched maps (yarn fetchTextureSources --only grass01,rocks01)")
    items = aek.get_texture_set_items(REPO_ROOT)
    expect(items[0][0] == aek.NO_SET and "grass01" in [i[0] for i in items], "the layer items: None, then the sets")
    expect(len({i[3] for i in items}) == len(items), "each item a number of its own")

    # Exact colours: flat layers drawn as an emission, rendered to a float EXR
    bpy.ops.aek.add_terrain_block(block_id="checkPreview", size="32", resolution="33", grid_z=3)
    block = bpy.data.objects["checkPreview"]
    for obj in bpy.data.objects:
        obj.hide_render = obj != block
    bpy.context.scene.world = None
    colors = np.zeros((33 * 33, 4))
    colors[:, 3] = 1.0
    colors[np.arange(33 * 33) % 33 >= 17, 0] = 1.0  # layer 1 on the +x half
    splat = block.data.color_attributes[aek.SPLAT_ATTRIBUTE]
    splat.data.foreach_set("color", colors.ravel())
    group, notes = aek.build_preview_group(["NONE", "noSuchSet", "NONE", "NONE", "NONE"], sets)
    expect(any("noSuchSet" in n for n in notes), f"an unknown set noted: {notes}")
    emission = bpy.data.materials.new("checkEmission")
    if emission.node_tree is None:
        emission.use_nodes = True
    tree = emission.node_tree
    tree.nodes.clear()
    group_node = tree.nodes.new("ShaderNodeGroup")
    group_node.node_tree = group
    aek.link_vertex_splat(tree, group_node)
    emit = tree.nodes.new("ShaderNodeEmission")
    output = tree.nodes.new("ShaderNodeOutputMaterial")
    tree.links.new(group_node.outputs["Color"], emit.inputs["Color"])
    tree.links.new(emit.outputs[0], output.inputs["Surface"])
    block.data.materials[0] = emission
    center = block.location
    flat_path = os.path.join(OUT_DIR, "preview_flat.exr")
    setup_render(32, center, 32, flat_path, "OPEN_EXR")
    pixels = render_pixels(flat_path)
    base, layer = pixels[16, 4, :3], pixels[16, 28, :3]
    expect(np.abs(base - aek.FALLBACK_COLORS[0]).max() < 1e-3, f"the -x half is the base: {base}")
    expect(np.abs(layer - aek.FALLBACK_COLORS[1]).max() < 1e-3, f"the +x half is layer 1: {layer}")
    colors[:, 3] = 0.5
    splat.data.foreach_set("color", colors.ravel())
    group_node.inputs["AO Strength"].default_value = 0.5
    pixels = render_pixels(flat_path)
    expected = np.array(aek.FALLBACK_COLORS[1]) * 0.75  # A 0.5 at strength 0.5
    expect(np.abs(pixels[16, 28, :3] - expected).max() < 1e-3, f"the AO darkens: {pixels[16, 28, :3]}")

    # The fetched maps: grass01 under rocks01 in a soft blob, tiled at their real sizes
    group, notes = aek.build_preview_group(["grass01", "rocks01", "NONE", "NONE", "NONE"], sets)
    images = [n for n in group.nodes if n.type == "TEX_IMAGE"]
    expect(len(images) == 4 and all(n.image.size[0] > 0 for n in images), "two sets' colour and height maps")
    spaces = sorted(n.image.colorspace_settings.name for n in images)
    expect(spaces == ["Non-Color", "Non-Color", "sRGB", "sRGB"], f"colour maps sRGB, heights Non-Color: {spaces}")
    tiles = sorted(tuple(round(v, 3) for v in n.inputs[1].default_value) for n in group.nodes
                   if n.type == "VECT_MATH" and n.operation == "DIVIDE")
    expect(tiles == sorted([grass["physical_size"] + (1.0,), sets["rocks01"]["physical_size"] + (1.0,)]),
           f"tiled at each set's physicalSize: {tiles}")
    rows, cols = np.divmod(np.arange(33 * 33), 33)
    blob = np.clip(1.2 - np.hypot(rows - 16, cols - 16) / 10, 0, 1)
    colors[:, 0], colors[:, 3] = blob, 1.0
    splat.data.foreach_set("color", colors.ravel())
    material = aek.ensure_preview_material(bpy.context.scene)
    block.data.materials[0] = material
    expect(any(n.type == "GROUP" and n.node_tree == group and n.outputs["Color"].links for n in material.node_tree.nodes),
           "the material draws the group into its BSDF")
    world = bpy.data.worlds.new("checkWorld")
    if world.node_tree is None:
        world.use_nodes = True
    background = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
    background.inputs["Color"].default_value = (1.0, 1.0, 1.0, 1.0)
    background.inputs["Strength"].default_value = 1.0
    bpy.context.scene.world = world
    textured_path = os.path.join(OUT_DIR, "preview_textured.png")
    setup_render(384, center, 32, textured_path, "PNG")
    bpy.ops.render.render(write_still=True)
    # A close-up of the blob's edge (the weights cross 0.5 seven metres out): the maps and the
    # height blend's border
    edge = (center[0] + 7, center[1], 0)
    setup_render(384, edge, 6, os.path.join(OUT_DIR, "preview_textured_edge.png"), "PNG")
    bpy.context.scene.cycles.samples = 64
    bpy.ops.render.render(write_still=True)

    # The heights shape the border: the edge as an emission, height blend on and off
    block.data.materials[0] = emission
    bpy.context.scene.world = None
    edge_path = os.path.join(OUT_DIR, "preview_edge.exr")
    setup_render(64, edge, 6, edge_path, "OPEN_EXR")
    blended = render_pixels(edge_path)
    aek.build_preview_group(["grass01", "rocks01", "NONE", "NONE", "NONE"], sets, height_blend=False)
    linear = render_pixels(edge_path)
    REPORT["height_blend_max_difference"] = round(float(np.abs(blended - linear).max()), 3)
    expect(np.abs(blended - linear).max() > 0.05, "the height blend differs from the linear one at the edge")
    block.data.materials[0] = material

    expect_refused(lambda: bpy.ops.aek.update_terrain_preview(), "Update Preview without a repo folder is refused")


def check_bake_ao(aek):
    bpy.ops.aek.add_terrain_block(block_id="checkAo", size="32", resolution="33", grid_z=6)
    block = bpy.data.objects["checkAo"]
    for obj in bpy.data.objects:
        obj.hide_render = obj != block
    mesh = block.data
    # A trench 5 columns wide and 6 m deep down the middle
    for v in mesh.vertices:
        if 14 <= v.index % 33 <= 18:
            v.co.z = -6.0
    mesh.update()
    splat = mesh.color_attributes[aek.SPLAT_ATTRIBUTE]
    rng = np.random.default_rng(3)
    painted = np.zeros((len(splat.data), 4))
    painted[:, :3] = rng.uniform(0, 0.3, (len(splat.data), 3))
    painted[:, 3] = 1.0
    splat.data.foreach_set("color", painted.ravel())
    before, _ = aek.read_splat_bytes(splat)
    scene = bpy.context.scene
    settings_before = (scene.render.engine, scene.cycles.samples, scene.render.bake.target, scene.world)

    started = time.perf_counter()
    bpy.context.view_layer.objects.active = block
    bpy.ops.aek.bake_ao_to_splat(samples=64, distance=16.0)
    REPORT["bake_ao_33_seconds"] = round(time.perf_counter() - started, 2)

    after, _ = aek.read_splat_bytes(splat)
    expect(np.array_equal(before[:, :3], after[:, :3]), "the painted RGB is kept to the byte")
    ao = after[:, 3].reshape(33, 33)
    REPORT["bake_ao_trench_flat"] = [round(float(ao[16, 16]), 3), round(float(ao[16, 2]), 3)]
    expect(ao[16, 16] < 0.6, f"the trench's floor is occluded: {ao[16, 16]}")
    expect(ao[16, 2] > 0.95, f"the flat ground away from it isn't: {ao[16, 2]}")
    # The floor by the wall darker than the rim (its smooth normal tilts it towards the far wall),
    # the rim darker than the flat ground
    expect(ao[16, 14] < ao[16, 13] < ao[16, 2], f"floor < rim < flat: {ao[16, 14]}, {ao[16, 13]}, {ao[16, 2]}")
    expect(aek.AO_BAKE_ATTRIBUTE not in mesh.color_attributes, "the temporary attribute is gone")
    expect(mesh.color_attributes.active_color_name == aek.SPLAT_ATTRIBUTE, "the splat is active again")
    settings_after = (scene.render.engine, scene.cycles.samples, scene.render.bake.target, scene.world)
    expect(settings_before == settings_after, f"the scene's settings come back: {settings_after}")
    expect(not any(w.name.startswith("AEK AO Bake") for w in bpy.data.worlds), "no temporary world left")
    expect(not any("splat" in text for _, text in validate(aek, "checkAo")), "the splat still validates")

    # A neighbour occludes across the shared edge: a ridge just west of it
    west_edge = ao[:, 0].mean()
    bpy.ops.aek.add_terrain_block(block_id="checkAoWest", size="32", resolution="33", grid_x=-1, grid_z=6)
    west = bpy.data.objects["checkAoWest"]
    west.hide_render = False
    for v in west.data.vertices:
        if 28 <= v.index % 33 <= 31:
            v.co.z = 8.0
    west.data.update()
    bpy.context.view_layer.objects.active = block
    bpy.ops.aek.bake_ao_to_splat(samples=64, distance=16.0)
    shaded, _ = aek.read_splat_bytes(splat)
    shaded_edge = shaded[:, 3].reshape(33, 33)[:, 0].mean()
    REPORT["bake_ao_west_edge_alone_by_ridge"] = [round(float(west_edge), 3), round(float(shaded_edge), 3)]
    expect(shaded_edge < west_edge - 0.1, f"the west neighbour's ridge darkens the edge: {west_edge} → {shaded_edge}")

    bpy.context.view_layer.objects.active = bpy.data.objects["checkRgba"]
    expect_refused(lambda: bpy.ops.aek.bake_ao_to_splat(), "an RGBA block has no AO channel")


def check_bake_color_map(aek):
    bpy.ops.aek.add_terrain_block(block_id="checkColor", size="32", resolution="33", grid_z=9)
    block = bpy.data.objects["checkColor"]
    block.aek_terrain_block.output_dir = OUT_DIR
    # Layer 1 on the engine's -x, -z quarter (rows and columns under 16), AO 0.5 everywhere
    splat = block.data.color_attributes[aek.SPLAT_ATTRIBUTE]
    rows, cols = np.divmod(np.arange(33 * 33), 33)
    colors = np.zeros((33 * 33, 4))
    colors[(rows < 16) & (cols < 16), 0] = 1.0
    colors[:, 3] = 0.5
    splat.data.foreach_set("color", colors.ravel())
    aek.build_preview_group(["NONE", "noSuchSet", "NONE", "NONE", "NONE"], {})
    material = aek.ensure_preview_material(bpy.context.scene)
    block.data.materials[0] = material
    bpy.context.scene.aek_terrain_preview.ao_strength = 1.0
    expect(aek.get_preview_group_node(material).inputs["AO Strength"].default_value == 1.0,
           "the scene's AO strength reaches the material live")

    path = os.path.join(OUT_DIR, "checkColor_colorMap.png")
    srgb = lambda c: aek.linear_to_srgb(np.array(c))
    for with_ao, factor in ((False, 1.0), (True, 0.5)):
        bpy.context.view_layer.objects.active = block
        started = time.perf_counter()
        bpy.ops.aek.bake_color_map(size="512", samples=4, with_ao=with_ao)
        REPORT[f"bake_color_map_512{'_ao' if with_ao else ''}_seconds"] = round(time.perf_counter() - started, 2)
        image = bpy.data.images.load(path, check_existing=False)
        expect(tuple(image.size) == (512, 512), f"512² pixels: {tuple(image.size)}")
        # pixels run bottom-up: the image's top rows are its last; its top is the engine's -z
        px = np.array(image.pixels[:]).reshape(512, 512, 4)
        bpy.data.images.remove(image)
        top_left, bottom_right = px[384, 128, :3], px[128, 384, :3]
        layer = srgb(np.array(aek.FALLBACK_COLORS[1]) * factor)
        base = srgb(np.array(aek.FALLBACK_COLORS[0]) * factor)
        expect(np.abs(top_left - layer).max() < 2.5 / 255, f"top left (-x, -z) is layer 1 × {factor}: {top_left} vs {layer}")
        expect(np.abs(bottom_right - base).max() < 2.5 / 255, f"bottom right (+x, +z) is the base × {factor}: {bottom_right}")
    expect(aek.get_preview_group_node(material).inputs["AO Strength"].default_value == 1.0, "the AO strength comes back")
    expect(not any(n.type == "TEX_IMAGE" for n in material.node_tree.nodes), "the bake's image node is gone")

    block.aek_terrain_block.output_dir = "//"
    bpy.context.view_layer.objects.active = block
    expect_refused(lambda: bpy.ops.aek.bake_color_map(size="512"), "a folder relative to an unsaved .blend is refused")


def vertex_normals_of(mesh, custom):
    """A mesh's normal a vertex: its corners' (custom) or Blender's own vertex normals"""
    if not custom:
        out = np.empty(len(mesh.vertices) * 3)
        mesh.vertex_normals.foreach_get("vector", out)
        return out.reshape(-1, 3)
    corners = np.empty(len(mesh.loops) * 3)
    mesh.corner_normals.foreach_get("vector", corners)
    loops = np.empty(len(mesh.loops), dtype=np.int64)
    mesh.loops.foreach_get("vertex_index", loops)
    out = np.zeros((len(mesh.vertices), 3))
    out[loops] = corners.reshape(-1, 3)
    return out


def check_split(aek):
    # A 64 m / 65 grid over blocks (10..11, 10..11) of 32 m: x and the engine's z from 304 to 368
    mesh = aek.build_grid_mesh("checkSource", 64, 65, "RGB_AO")
    source = bpy.data.objects.new("checkSource", mesh)
    bpy.context.scene.collection.objects.link(source)
    source.location = (336.0, -336.0, 0.0)
    height = lambda x, y: 3 * np.sin(x / 7) * np.cos(y / 9)
    co = np.empty(len(mesh.vertices) * 3)
    mesh.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    co[:, 2] = height(co[:, 0] + 336, co[:, 1] - 336)
    mesh.vertices.foreach_set("co", co.ravel())
    colors = np.zeros((len(co), 4))
    colors[:, 0] = (co[:, 0] + 336 > 336).astype(float)
    colors[:, 3] = 1.0
    mesh.color_attributes[aek.SPLAT_ATTRIBUTE].data.foreach_set("color", colors.ravel())
    mesh.update()
    lift = source.modifiers.new("lift", "DISPLACE")
    lift.direction, lift.mid_level, lift.strength = "Z", 0.0, 1.0

    for obj in bpy.context.selected_objects:
        obj.select_set(False)
    source.select_set(True)
    bpy.context.view_layer.objects.active = source
    bpy.ops.aek.split_into_blocks(size="32", layout="RGB_AO")

    blocks = {(gx, gz): bpy.data.objects.get(f"checkSource_{gx}_{gz}") for gx in (10, 11) for gz in (10, 11)}
    expect(all(blocks.values()), f"four blocks: {list(blocks)}")
    expect(source.hide_get() and source.hide_render, "the source hidden")
    for (gx, gz), block in blocks.items():
        settings = block.aek_terrain_block
        expect((settings.size, settings.resolution, settings.grid_x, settings.grid_z) == ("32", "33", gx, gz),
               f"{block.name}'s settings")
        issues = validate(aek, block.name)
        expect(issues == [], f"{block.name} validates, its edges against its neighbours too: {issues}")
        bco = np.empty(33 * 33 * 3)
        block.data.vertices.foreach_get("co", bco)
        bco = bco.reshape(-1, 3) + np.array(block.location)
        expected = height(bco[:, 0], bco[:, 1]) + 1.0
        expect(np.abs(bco[:, 2] - expected).max() < 1e-4, f"{block.name}'s heights are the source's, lifted")
        bcolors = np.empty(33 * 33 * 4)
        block.data.color_attributes[aek.SPLAT_ATTRIBUTE].data.foreach_get("color", bcolors)
        expect(np.array_equal(bcolors.reshape(-1, 4)[:, 0], (bco[:, 0] > 336).astype(float)), f"{block.name}'s splat")

    # The shared edge's normals: the source's on both sides, so no seam in the light
    west, east = blocks[(10, 10)].data, blocks[(11, 10)].data
    edge_w, edge_e = np.arange(33) * 33 + 32, np.arange(33) * 33
    custom_gap = np.abs(vertex_normals_of(west, True)[edge_w] - vertex_normals_of(east, True)[edge_e]).max()

    def without_custom_normals(block_mesh):
        # The same heights in a mesh of Add's, which has no custom normals
        plain = aek.build_grid_mesh("checkPlain", 32, 33, "RGB_AO")
        heights = np.empty(len(block_mesh.vertices) * 3)
        block_mesh.vertices.foreach_get("co", heights)
        plain.vertices.foreach_set("co", heights)
        plain.update()
        normals = vertex_normals_of(plain, False)
        bpy.data.meshes.remove(plain)
        return normals

    own_gap = np.abs(without_custom_normals(west)[edge_w] - without_custom_normals(east)[edge_e]).max()
    REPORT["split_edge_normal_gap_custom_own"] = [round(float(custom_gap), 5), round(float(own_gap), 4)]
    expect(custom_gap < 1e-3, f"the edge's custom normals agree: {custom_gap}")
    expect(own_gap > 10 * max(custom_gap, 1e-4), f"without them they wouldn't: {own_gap}")

    expect_refused(lambda: bpy.ops.aek.split_into_blocks(size="32"), "a second split's taken ids are refused")
    positions = co.copy()
    plan, reason = aek.plan_split(positions, (339.0, -336.0, 0.0), 32)
    expect(plan is None and "block corner" in reason, f"a misaligned source is refused: {reason}")
    plan, reason = aek.plan_split(positions, (336.0, -336.0, 0.0), 128)
    expect(plan is None and "whole number" in reason, f"a size it doesn't divide is refused: {reason}")
    plan, reason = aek.plan_split(positions, (320.0, -320.0, 0.0), 64)
    expect(plan is not None and (plan["count"], plan["resolution"], plan["grid_x"], plan["grid_z"]) == (1, 65, 5, 5),
           f"64 m at (320, -320): one block of 65 at grid (5, 5): {reason or (plan['count'], plan['grid_x'])}")


def read_glb(path):
    with open(path, "rb") as f:
        data = f.read()
    length = struct.unpack_from("<I", data, 12)[0]
    gltf = json.loads(data[20 : 20 + length])
    return gltf, data[20 + length + 8 :]


def read_accessor(gltf, binary, index):
    accessor = gltf["accessors"][index]
    view = gltf["bufferViews"][accessor["bufferView"]]
    dtype = {5126: np.float32, 5123: np.uint16, 5125: np.uint32, 5121: np.uint8}[accessor["componentType"]]
    width = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}[accessor["type"]]
    start = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
    values = np.frombuffer(binary, dtype=dtype, count=accessor["count"] * width, offset=start)
    values = values.reshape(-1, width).astype(np.float64)
    if accessor.get("normalized"):
        values /= np.iinfo(dtype).max
    return values


def export_into(aek, block, folder, clean=True):
    if clean and os.path.isdir(folder):
        shutil.rmtree(folder)
    block.aek_terrain_block.output_dir = folder
    bpy.context.view_layer.objects.active = block
    bpy.ops.aek.export_terrain_block()


def check_export(aek):
    expect(aek.check_exporter_options() == [], f"Blender 5.3 takes every locked setting: {aek.check_exporter_options()}")
    block = bpy.data.objects["checkSource_10_10"]  # Split's: a sine terrain, its splat and custom normals
    folder = os.path.join(OUT_DIR, "export", block.name)
    location, objects = tuple(block.location), len(bpy.data.objects)
    export_into(aek, block, folder)
    expect(tuple(block.location) == location and block.name == "checkSource_10_10", "the block as it was")
    expect(len(bpy.data.objects) == objects, "no export copy left")
    names = sorted(os.listdir(folder))
    expect(names == ["checkSource_10_10.glb", "checkSource_10_10.importedAsset.json",
                     "checkSource_10_10.terrainBlock.json"], f"the GLB and both stubs: {names}")

    glb = os.path.join(folder, "checkSource_10_10.glb")
    gltf, binary = read_glb(glb)
    expect(aek.check_exported_glb(gltf, block.name, 33) == [], f"the GLB's own check: {aek.check_exported_glb(gltf, block.name, 33)}")
    node = next(n for n in gltf["nodes"] if "mesh" in n)
    expect(node["extras"] == aek.get_block_custom_props(32, 33, 10, 10), f"the node's extras: {node['extras']}")
    attributes = gltf["meshes"][0]["primitives"][0]["attributes"]
    mesh = block.data
    co = np.empty(len(mesh.vertices) * 3)
    mesh.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    positions = read_accessor(gltf, binary, attributes["POSITION"])
    expect(np.abs(positions - np.stack([co[:, 0], co[:, 2], -co[:, 1]], axis=1)).max() < 1e-5,
           "positions: Blender (x, y, z) as glTF (x, z, -y), at the origin")
    rows, cols = np.divmod(np.arange(33 * 33), 33)
    uvs = read_accessor(gltf, binary, attributes["TEXCOORD_0"])
    expect(np.abs(uvs - np.stack([cols / 32, rows / 32], axis=1)).max() < 1e-6,
           "UVs: U along +x, V along +z from the -x, -z corner (D1)")
    splat = np.empty(len(mesh.vertices) * 4)
    mesh.color_attributes[aek.SPLAT_ATTRIBUTE].data.foreach_get("color", splat)
    colors = read_accessor(gltf, binary, attributes["COLOR_0"])
    expect(np.abs(colors - splat.reshape(-1, 4)).max() < 1e-4, "COLOR_0 is the splat's linear values")
    normals = read_accessor(gltf, binary, attributes["NORMAL"])
    custom = vertex_normals_of(mesh, True)
    expect(np.abs(normals - np.stack([custom[:, 0], custom[:, 2], -custom[:, 1]], axis=1)).max() < 1e-4,
           "NORMAL is the block's custom normals (Split's)")

    with open(os.path.join(folder, "checkSource_10_10.importedAsset.json"), encoding="utf-8") as f:
        imported = json.load(f)
    expect(imported["optimize"] == {"profile": "terrainBlock"} and imported["fileName"] == "./checkSource_10_10.glb",
           f"the importedAsset stub: {imported}")
    expect(os.path.isfile(os.path.normpath(os.path.join(folder, imported["$schema"]))), f"its $schema resolves: {imported['$schema']}")
    block_json_path = os.path.join(folder, "checkSource_10_10.terrainBlock.json")
    with open(block_json_path, encoding="utf-8") as f:
        block_json = json.load(f)
    expect(block_json["grid"] == {"x": 10, "z": 10, "size": 32, "resolution": 33}
           and block_json["geometry"] == {"importedAsset": "checkSource_10_10", "node": "checkSource_10_10"},
           f"the terrainBlock stub: {block_json}")

    # A second export rewrites the GLB, keeps the stubs as the user edited them
    block_json["material"] = "edited"
    with open(block_json_path, "w", encoding="utf-8") as f:
        json.dump(block_json, f)
    os.utime(glb, (0, 0))
    export_into(aek, block, folder, clean=False)
    with open(block_json_path, encoding="utf-8") as f:
        expect(json.load(f)["material"] == "edited", "an existing stub is left alone")
    expect(os.path.getmtime(glb) > 0, "the GLB is written again")

    # The images: a colour map (Bake Colour Map's) and a painted splat map, flipY false
    color_block = bpy.data.objects["checkColor"]
    # A generated image painted and never saved, as a new image in Texture Paint is: its pixels
    # must reach the PNG (setting the colour space at export reloaded it blank)
    splat_image = bpy.data.images.new("checkColor_splat0", 64, 64, alpha=True)
    splat_image.colorspace_settings.name = "Non-Color"
    painted = np.zeros((64, 64, 4), dtype=np.float32)
    painted[48:, :16] = (1.0, 0.0, 0.0, 1.0)  # the top left (pixels run bottom-up)
    painted[:48, :, 3] = 1.0
    splat_image.pixels.foreach_set(painted.ravel())
    color_map = bpy.data.images["checkColor_colorMap"]
    color_pixels = np.array(color_map.pixels[:])
    srgb_image = bpy.data.images.new("checkColor_splat1", 8, 8)  # sRGB: warned, saved as it is
    srgb_image.pixels.foreach_set(np.ones(8 * 8 * 4, dtype=np.float32))
    image_folder = os.path.join(OUT_DIR, "export", "checkColor")
    export_into(aek, color_block, image_folder)
    for name, slot, space in (("checkColor_colorMap", "baseColor", "srgb"), ("checkColor_splat0", "data", "")):
        expect(os.path.isfile(os.path.join(image_folder, name + ".png")), f"{name}.png")
        with open(os.path.join(image_folder, name + ".texture.json"), encoding="utf-8") as f:
            texture = json.load(f)
        expect(texture["texOpts"] == {"flipY": False, "colorSpace": space} and texture["optimize"] == {"slot": slot}
               and texture["fileName"] == f"./{name}.png", f"{name}'s texture stub: {texture}")
    for name, expected in (("checkColor_splat0", painted.ravel()), ("checkColor_colorMap", color_pixels)):
        saved = bpy.data.images.load(os.path.join(image_folder, name + ".png"), check_existing=False)
        got = np.array(saved.pixels[:])
        bpy.data.images.remove(saved)
        expect(np.abs(got - expected).max() < 1 / 255, f"{name}.png holds the image's pixels (off by {np.abs(got - expected).max()})")
    srgb_folder = os.path.join(OUT_DIR, "export", "checkColorSrgb")
    os.makedirs(srgb_folder, exist_ok=True)
    _, issues = aek.save_block_images("checkColor", srgb_folder)
    expect(any("checkColor_splat1" in text and "sRGB, not Non-Color" in text for _, text in issues),
           f"a splat map painted in sRGB is warned: {issues}")
    for image in (splat_image, srgb_image):
        bpy.data.images.remove(image)

    # An invalid block isn't exported
    east = bpy.data.objects["checkEast"]
    east.data.vertices[40].co.x += 0.01
    east.data.update()
    bad_folder = os.path.join(OUT_DIR, "export", "checkEast")
    expect_refused(lambda: export_into(aek, east, bad_folder), "a block that doesn't validate is refused")
    expect(not os.path.exists(bad_folder), "and nothing is written")
    east.data.vertices[40].co.x -= 0.01
    east.data.update()

    # The GLB check finds what the locked settings prevent
    broken = json.loads(json.dumps(gltf))
    del broken["meshes"][0]["primitives"][0]["attributes"]["COLOR_0"]
    next(n for n in broken["nodes"] if "mesh" in n)["translation"] = [1, 0, 0]
    findings = " ".join(text for _, text in aek.check_exported_glb(broken, block.name, 33))
    expect("No COLOR_0" in findings and "transform" in findings, f"the GLB check's findings: {findings}")


def check_trimesh(aek):
    bpy.ops.aek.add_terrain_block(block_id="checkTrimesh", size="32", resolution="33", grid_z=15,
                                  collider="TRIMESH")
    block = bpy.data.objects["checkTrimesh"]
    expect(block["colliderType"] == "TRIMESH" and "nCols" not in block, "a trimesh block's props")
    # An overhang: a 6 m step from column 17 on, its edge column pushed 1.5 m back over its foot
    mesh = block.data
    co = np.empty(len(mesh.vertices) * 3)
    mesh.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    cols = np.arange(33 * 33) % 33
    co[cols >= 17, 2] = 6.0
    co[cols == 17, 0] -= 1.5
    mesh.vertices.foreach_set("co", co.ravel())
    mesh.update()
    issues = validate(aek, "checkTrimesh")
    expect(not any(level == "ERROR" for level, _ in issues), f"an overhang validates as a trimesh: {issues}")

    block.aek_terrain_block.collider = "HEIGHTFIELD"
    issues = validate(aek, "checkTrimesh")
    expect_issue(issues, "ERROR", "moved off their grid point", "the same overhang as a heightfield is refused")
    expect_issue(issues, "WARNING", "custom props differ", "the props of another collider are warned")
    aek.write_block_custom_props(block)
    expect(block["colliderType"] == "HEIGHTFIELD" and block["nCols"] == 32, "the heightfield's props written")
    block.aek_terrain_block.collider = "NONE"
    aek.write_block_custom_props(block)
    expect(not any(k in block for k in ("isPhysObj", "colliderType", "nCols", "keepMesh")) and block["aekBlockRes"] == 33,
           "no collider: the body's props removed, the block's kept")
    block.aek_terrain_block.collider = "TRIMESH"

    # A heightfield neighbour doesn't compare its edge with a trimesh block
    bpy.ops.aek.add_terrain_block(block_id="checkTrimeshWest", size="32", resolution="33", grid_x=-1, grid_z=15)
    expect_issue(validate(aek, "checkTrimeshWest"), "WARNING", "trimesh block", "a trimesh neighbour is named")
    # A vertex outside the block's square is warned
    mesh.vertices[33 * 10 + 32].co.x += 2.0
    mesh.update()
    expect_issue(validate(aek, "checkTrimesh"), "WARNING", "outside the 32 m square", "a vertex past the square")
    mesh.vertices[33 * 10 + 32].co.x -= 2.0
    mesh.update()

    folder = os.path.join(OUT_DIR, "export", "checkTrimesh")
    export_into(aek, block, folder)
    gltf, binary = read_glb(os.path.join(folder, "checkTrimesh.glb"))
    findings = aek.check_exported_glb(gltf, "checkTrimesh", 33, "TRIMESH")
    expect(findings == [], f"the trimesh GLB's own check: {findings}")
    node = next(n for n in gltf["nodes"] if "mesh" in n)
    expect(node["extras"] == aek.get_block_custom_props(32, 33, 0, 15, "TRIMESH"), f"its extras: {node['extras']}")
    positions = read_accessor(gltf, binary, gltf["meshes"][0]["primitives"][0]["attributes"]["POSITION"])
    expect(np.abs(positions - np.stack([co[:, 0], co[:, 2], -co[:, 1]], axis=1)).max() < 1e-5,
           "the overhang's positions as they are")
    with open(os.path.join(folder, "checkTrimesh.terrainBlock.json"), encoding="utf-8") as f:
        expect(json.load(f)["collider"] == {"type": "TRIMESH"}, "the stub's collider is the block's")


def check_splat_map(aek):
    scene = bpy.context.scene
    bpy.ops.aek.add_terrain_block(block_id="checkSplatMap", size="32", resolution="33", grid_z=18)
    block = bpy.data.objects["checkSplatMap"]
    for obj in bpy.data.objects:
        obj.hide_render = obj != block
    scene.world = None
    scene.aek_terrain_preview.layout = "RGBA"
    flat = ["noSuchSet"] * 5
    aek.build_preview_group(flat, {}, layout="RGBA")
    bpy.context.view_layer.objects.active = block
    bpy.ops.aek.new_splat_map(size="256")
    image = bpy.data.images["checkSplatMap_splat0"]
    expect(tuple(image.size) == (256, 256) and image.colorspace_settings.name == "Non-Color"
           and image.alpha_mode == "CHANNEL_PACKED", "a 256² Non-Color, channel-packed splat map")
    expect(not np.any(np.array(image.pixels[:])), "black, A 0: the base layer")
    material = block.active_material
    tree = material.node_tree
    expect(material.name == "AEK Terrain Preview checkSplatMap" and material[aek.SPLAT_MAP_PROP] == image.name,
           f"the block's own material: {material.name}")
    expect(tree.nodes.active.type == "TEX_IMAGE" and tree.nodes.active.image == image, "its image node is the paint target")
    expect(bpy.data.materials[aek.PREVIEW_MATERIAL].users >= 1, "the shared material stays")
    preview = aek.get_preview_group_node(material)
    expect(preview.inputs["Splat Alpha"].is_linked, "RGBA: A weighs layer 4")

    # Quarters, from the top left (the engine's -x, -z): layer 1 (R, under A 0), layer 4 (A),
    # then the base, layer 2 (G); pixels run bottom-up
    painted = np.zeros((256, 256, 4), dtype=np.float32)
    painted[128:, :128] = (1.0, 0.0, 0.0, 0.0)
    painted[128:, 128:] = (0.0, 0.0, 0.0, 1.0)
    painted[:128, 128:] = (0.0, 1.0, 0.0, 0.0)
    image.pixels.foreach_set(painted.ravel())

    output = next(n for n in tree.nodes if n.type == "OUTPUT_MATERIAL")
    bsdf_link = output.inputs["Surface"].links[0].from_socket
    emission = tree.nodes.new("ShaderNodeEmission")
    tree.links.new(preview.outputs["Color"], emission.inputs["Color"])
    tree.links.new(emission.outputs[0], output.inputs["Surface"])
    path = os.path.join(OUT_DIR, "splat_map.exr")
    setup_render(32, block.location, 32, path, "OPEN_EXR")
    pixels = render_pixels(path)
    for (row, col), layer, where in (((24, 8), 1, "top left"), ((24, 24), 4, "top right"),
                                     ((8, 8), 0, "bottom left"), ((8, 24), 2, "bottom right")):
        got = pixels[row, col, :3]
        expect(np.abs(got - aek.FALLBACK_COLORS[layer]).max() < 1e-3, f"the {where} is layer {layer}: {got}")

    # A second map (layers 5-8): its G on the bottom left quarter (the base in the first map) is
    # layer 6; the others keep the first map's layers
    aek.build_preview_group(["noSuchSet"] * aek.PREVIEW_LAYERS, {}, layout="RGBA")
    bpy.ops.aek.new_splat_map(size="256", map="1")
    second = bpy.data.images["checkSplatMap_splat1"]
    expect(tuple(second.size) == (256, 256) and second.colorspace_settings.name == "Non-Color"
           and second.alpha_mode == "CHANNEL_PACKED", "a 256² Non-Color, channel-packed second map")
    expect(block.active_material == material and material[aek.SPLAT_MAP_PROPS[1]] == second.name
           and material[aek.SPLAT_MAP_PROPS[0]] == image.name, "the block's material names both maps")
    expect(tree.nodes.active.image == second, "the second map's node is the paint target")
    expect(preview.inputs["Splat"].links[0].from_node.image == image
           and preview.inputs["Splat 2"].links[0].from_node.image == second
           and preview.inputs["Splat 2 Alpha"].is_linked, "the maps feed their inputs")
    second_pixels = np.zeros((256, 256, 4), dtype=np.float32)
    second_pixels[:128, :128] = (0.0, 1.0, 0.0, 0.0)
    second.pixels.foreach_set(second_pixels.ravel())
    pixels = render_pixels(path)
    for (row, col), layer, where in (((24, 8), 1, "top left"), ((24, 24), 4, "top right"),
                                     ((8, 8), 6, "bottom left"), ((8, 24), 2, "bottom right")):
        got = pixels[row, col, :3]
        expect(np.abs(got - aek.FALLBACK_COLORS[layer]).max() < 1e-3, f"two maps: the {where} is layer {layer}: {got}")
    aek.update_splat_map_materials(scene)
    expect(tree.nodes.active.image == second and len([n for n in tree.nodes if n.type == "TEX_IMAGE"]) == 2,
           "a relink keeps the painted map the target, an image node a map")
    aek.ensure_splat_map_material(scene, "checkSplatMap", image)
    expect(tree.nodes.active.image == image, "the first map the paint target again")
    aek.build_preview_group(flat, {}, layout="RGBA")

    # RGB + AO: three layers from the map, A not read
    scene.aek_terrain_preview.layout = "RGB_AO"
    aek.build_preview_group(flat, {}, layout="RGB_AO")
    aek.update_splat_map_materials(scene)
    expect(not preview.inputs["Splat Alpha"].is_linked, "RGB_AO: the map's A isn't linked")
    pixels = render_pixels(path)
    expect(np.abs(pixels[24, 24, :3] - aek.FALLBACK_COLORS[0]).max() < 1e-3, f"A unread: the base: {pixels[24, 24, :3]}")
    tree.links.new(bsdf_link, output.inputs["Surface"])
    tree.nodes.remove(emission)

    # Bake Colour Map draws through the block's own material
    block.aek_terrain_block.output_dir = OUT_DIR
    bpy.context.view_layer.objects.active = block
    bpy.ops.aek.bake_color_map(size="512", samples=1)
    baked = bpy.data.images.load(os.path.join(OUT_DIR, "checkSplatMap_colorMap.png"), check_existing=False)
    px = np.array(baked.pixels[:]).reshape(512, 512, 4)
    bpy.data.images.remove(baked)
    layer = aek.linear_to_srgb(np.array(aek.FALLBACK_COLORS[1]))
    expect(np.abs(px[384, 128, :3] - layer).max() < 2.5 / 255, f"the colour map's top left is layer 1: {px[384, 128, :3]}")
    expect(tree.nodes.active.image == image, "the splat map is the paint target again")

    # Export saves the map with RGB kept under A 0, and the second map from its file when it
    # isn't in memory (a reopened .blend whose map nothing has drawn yet)
    folder = os.path.join(OUT_DIR, "export", "checkSplatMap")
    second.filepath_raw = os.path.join(OUT_DIR, "checkSplatMap_splat1_painted.png")
    second.file_format = "PNG"
    second.save()
    second.buffers_free()
    expect(not second.has_data, "the second map out of memory")
    export_into(aek, block, folder)
    saved = bpy.data.images.load(os.path.join(folder, "checkSplatMap_splat0.png"), check_existing=False)
    saved.alpha_mode = "CHANNEL_PACKED"
    got = np.array(saved.pixels[:]).reshape(256, 256, 4)
    bpy.data.images.remove(saved)
    expect(np.abs(got - painted).max() < 1 / 255, f"the PNG holds the map, RGB under A 0 (off by {np.abs(got - painted).max()})")
    with open(os.path.join(folder, "checkSplatMap_splat0.texture.json"), encoding="utf-8") as f:
        texture = json.load(f)
    expect(texture["optimize"] == {"slot": "data"} and texture["texOpts"] == {"flipY": False, "colorSpace": ""},
           f"its texture stub: {texture}")
    saved = bpy.data.images.load(os.path.join(folder, "checkSplatMap_splat1.png"), check_existing=False)
    saved.alpha_mode = "CHANNEL_PACKED"
    got = np.array(saved.pixels[:]).reshape(256, 256, 4)
    bpy.data.images.remove(saved)
    expect(np.abs(got - second_pixels).max() < 1 / 255, "the second map's PNG holds it")
    expect(os.path.isfile(os.path.join(folder, "checkSplatMap_splat1.texture.json")), "and its texture stub")
    aek.build_preview_group(["NONE"] * 5, {})


#: The workflow block's shape: a bump near the engine's +x, +z corner (local x 16, z 20), so a
#: collider read with a flipped axis puts it in the wrong corner
WORKFLOW_BUMP = {"x": 16.0, "z": 20.0, "height": 8.0, "radius": 3.0}
#: Its corner markers, rows and columns from the engine's -x, -z corner: red on the top view's
#: top left (-x, -z), green on its top right (+x, -z); 16 vertices of 129 each way
WORKFLOW_MARKER_VERTICES = 16


def record_export(block, folder):
    settings = block.aek_terrain_block
    REPORT["exports"].append({
        "id": settings.block_id,
        # Relative to the output folder, with `/`: the Node side's path (a Windows Blender's differs)
        "glb": os.path.relpath(os.path.join(folder, settings.block_id + ".glb"), OUT_DIR).replace("\\", "/"),
        "size": int(settings.size),
        "resolution": int(settings.resolution),
        "gridX": settings.grid_x,
        "gridZ": settings.grid_z,
        "layout": settings.layout,
    })


def check_workflow(aek):
    """The plan's path end to end, for `yarn verify:blender`'s checks on the GLBs: Add a 64 m / 129
    block, shape it, paint the corner markers, bake AO, Validate, Export; and export Split's four
    blocks (their shared edges). `REPORT["exports"]` lists what the Node side reads.
    """
    REPORT["exports"] = []
    bpy.ops.aek.add_terrain_block(block_id="checkWorkflow", size="64", resolution="129", grid_z=12,
                                  layout="RGB_AO")
    block = bpy.data.objects["checkWorkflow"]
    for obj in bpy.data.objects:
        obj.hide_render = obj != block
    mesh = block.data
    co = np.empty(len(mesh.vertices) * 3)
    mesh.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    # The engine's z is Blender's -y
    bump = WORKFLOW_BUMP
    distance = np.hypot(co[:, 0] - bump["x"], -co[:, 1] - bump["z"])
    co[:, 2] = bump["height"] * np.exp(-((distance / bump["radius"]) ** 2))
    mesh.vertices.foreach_set("co", co.ravel())
    mesh.update()

    rows, cols = np.divmod(np.arange(129 * 129), 129)
    colors = np.zeros((129 * 129, 4))
    top = rows < WORKFLOW_MARKER_VERTICES
    colors[top & (cols < WORKFLOW_MARKER_VERTICES), 0] = 1.0
    colors[top & (cols >= 129 - WORKFLOW_MARKER_VERTICES), 1] = 1.0
    colors[:, 3] = 1.0
    mesh.color_attributes[aek.SPLAT_ATTRIBUTE].data.foreach_set("color", colors.ravel())

    started = time.perf_counter()
    bpy.context.view_layer.objects.active = block
    bpy.ops.aek.bake_ao_to_splat(samples=16, distance=8.0)
    REPORT["workflow_bake_ao_129_seconds"] = round(time.perf_counter() - started, 2)
    expect(validate(aek, "checkWorkflow") == [], f"the workflow block validates: {validate(aek, 'checkWorkflow')}")

    folder = os.path.join(OUT_DIR, "export", "checkWorkflow")
    export_into(aek, block, folder)
    record_export(block, folder)
    REPORT["workflow"] = {"id": "checkWorkflow", "bump": bump, "markerVertices": WORKFLOW_MARKER_VERTICES}

    split_folder = os.path.join(OUT_DIR, "export", "split")
    shutil.rmtree(split_folder, ignore_errors=True)
    for gx in (10, 11):
        for gz in (10, 11):
            split = bpy.data.objects[f"checkSource_{gx}_{gz}"]
            export_into(aek, split, split_folder, clean=False)
            record_export(split, split_folder)


def check_decals(aek):
    """p309 D3: the decal atlases read from the repo (the cell rect as the gather's table), a decal
    set on a block with relief (a strip along a path, a quad), conformed by the Shrinkwrap, then
    exported: the GLB's nodes in the block's space, the atlas UVs in their cells, DecalUV 0..1
    """
    expect(aek.check_exporter_options(aek.DECAL_EXPORT_SETTINGS) == [],
           f"Blender 5.3 takes every decal export setting: {aek.check_exporter_options(aek.DECAL_EXPORT_SETTINGS)}")
    atlases = aek.find_decal_atlases(REPO_ROOT)
    expect({"decalsGround", "decalsStructure"} <= set(atlases), f"the toolkit's decal atlases: {sorted(atlases)}")
    tracks = atlases["decalsGround"]["cells"]["tireTracks"]
    # The gather's cell table: the 1024 x 256 rect at (0, 0) of 2048, inset by 16 px, v up
    expected = (16 / 2048, 1 - 240 / 2048, 1008 / 2048, 1 - 16 / 2048)
    expect(np.allclose(tracks["uv"], expected), f"tireTracks' rect as the gather's: {tracks['uv']}")
    expect(tracks["size"] == (1.8, 0.45) and tracks["tile_along"] == "U", f"tireTracks' data: {tracks}")
    damage = atlases["decalsGround"]["cells"]["asphaltDamage"]

    # Add, Add Decal Set and Add Decal find the repo above a saved .blend: here it's given
    aek.get_repo_root = lambda context: REPO_ROOT
    bpy.ops.aek.add_terrain_block(block_id="checkDecals", size="32", resolution="65", grid_x=3,
                                  grid_z=-2, collider="NONE")
    block = bpy.data.objects["checkDecals"]
    mesh = block.data
    co = np.empty(len(mesh.vertices) * 3)
    mesh.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    co[:, 2] = 0.8 * np.sin(co[:, 0] * 0.6) * np.cos(co[:, 1] * 0.45)
    mesh.vertices.foreach_set("co", co.ravel())
    mesh.update()
    bpy.context.view_layer.objects.active = block
    expect(bpy.ops.aek.add_decal_set() == {"FINISHED"}, "Add Decal Set")
    collection = bpy.data.collections["checkDecals_decals"]
    settings = collection.aek_decal_set
    expect(settings.block == block and settings.atlas == "decalsGround"
           and settings.material == "decalsGround_blend", "the set's block, atlas and material")

    bpy.context.scene.cursor.location = block.location
    expect(bpy.ops.aek.add_decal(cell="tireTracks") == {"FINISHED"}, "Add Decal: a strip")
    strip = bpy.context.active_object
    expect([m.type for m in strip.modifiers] == ["ARRAY", "NODES", "CURVE", "SHRINKWRAP"],
           f"a strip's modifiers: {[m.type for m in strip.modifiers]}")
    expect(bpy.data.objects.get("tireTracks_path") in collection.objects.values(), "the strip's path")
    bpy.context.scene.cursor.location = block.location + Vector((5, 5, 0))
    expect(bpy.ops.aek.add_decal(cell="asphaltDamage") == {"FINISHED"}, "Add Decal: a quad")
    quad = bpy.context.active_object
    expect([m.type for m in quad.modifiers] == ["NODES", "SHRINKWRAP"],
           f"a quad's modifiers: {[m.type for m in quad.modifiers]}")
    # 1.2 m on a 0.5 m grid: level 3 (a face's edge at most 0.25 m), 8 x 8 faces (81 vertices)
    expect(aek.get_decal_level(block, 1.2, 1.2) == 3, "the level for 1.2 m on 0.5 m")
    evaluated = quad.evaluated_get(bpy.context.evaluated_depsgraph_get()).to_mesh()
    expect(len(evaluated.vertices) == 81, f"the quad subdivided by its level: {len(evaluated.vertices)}")
    quad.evaluated_get(bpy.context.evaluated_depsgraph_get()).to_mesh_clear()

    # Conformed: each vertex the Shrinkwrap's offset over the block, straight below it
    depsgraph = bpy.context.evaluated_depsgraph_get()
    gaps = []
    for obj in (strip, quad):
        evaluated = obj.evaluated_get(depsgraph).to_mesh()
        uv = np.array([d.uv[:] for d in evaluated.uv_layers[aek.DECAL_UV].data])
        expect(np.allclose([uv.min(axis=0), uv.max(axis=0)], [[0, 0], [1, 1]], atol=1e-5),
               f"{obj.name}: DecalUV 0..1 over the decal ({uv.min(axis=0)}, {uv.max(axis=0)})")
        for vertex in evaluated.vertices:
            world = obj.matrix_world @ vertex.co
            hit, location, _normal, _face = block.ray_cast(
                block.matrix_world.inverted() @ (world + Vector((0, 0, 5))), Vector((0, 0, -1)))
            expect(hit, f"{obj.name}: a vertex over the block")
            gaps.append(world.z - (block.matrix_world @ location).z)
        obj.evaluated_get(depsgraph).to_mesh_clear()
    REPORT["decal_gaps"] = [round(min(gaps), 4), round(max(gaps), 4)]
    expect(aek.DECAL_OFFSET - 0.002 < min(gaps) and max(gaps) < aek.DECAL_OFFSET + 0.005,
           f"the decals {aek.DECAL_OFFSET} m over the block: {REPORT['decal_gaps']}")

    folder = os.path.join(OUT_DIR, "export", "decals")
    shutil.rmtree(folder, ignore_errors=True)
    settings.output_dir = folder
    objects, meshes = len(bpy.data.objects), len(bpy.data.meshes)
    expect(bpy.ops.aek.export_decal_set() == {"FINISHED"}, "Export Decal Set")
    expect(len(bpy.data.objects) == objects and len(bpy.data.meshes) == meshes, "no export copy left")
    expect(strip.name == "tireTracks" and quad.name == "asphaltDamage", "the decals' names as they were")
    expect(sorted(os.listdir(folder)) == ["checkDecals_decals.decalSet.json", "checkDecals_decals.glb",
                                         "checkDecals_decals.importedAsset.json"],
           f"the export's files: {sorted(os.listdir(folder))}")
    with open(os.path.join(folder, "checkDecals_decals.decalSet.json"), encoding="utf-8") as f:
        stub = json.load(f)
    expect(stub["importedAsset"] == "checkDecals_decals" and stub["material"] == "decalsGround_blend",
           f"the decal set stub: {stub}")

    gltf, binary = read_glb(os.path.join(folder, "checkDecals_decals.glb"))
    expect(aek.check_exported_decal_glb(gltf, ["tireTracks", "asphaltDamage"]) == [],
           f"the GLB: {aek.check_exported_decal_glb(gltf, ['tireTracks', 'asphaltDamage'])}")
    half = 16 + 0.5
    for node in (n for n in gltf["nodes"] if "mesh" in n):
        attributes = gltf["meshes"][node["mesh"]]["primitives"][0]["attributes"]
        cell = tracks if node["name"] == "tireTracks" else damage
        # glTF's V is the engine's: the cell's own rect
        atlas_uv = read_accessor(gltf, binary, attributes["TEXCOORD_0"])
        u0, v0, u1, v1 = cell["uv"]
        expect(atlas_uv[:, 0].min() > u0 - 1e-4 and atlas_uv[:, 0].max() < u1 + 1e-4
               and atlas_uv[:, 1].min() > v0 - 1e-4 and atlas_uv[:, 1].max() < v1 + 1e-4,
               f"{node['name']}: TEXCOORD_0 in its cell {cell['uv']}")
        decal_uv = read_accessor(gltf, binary, attributes["TEXCOORD_1"])
        expect(np.allclose([decal_uv.min(), decal_uv.max()], [0, 1], atol=1e-5),
               f"{node['name']}: TEXCOORD_1 0..1")
        # In the block's space: within its square, y up
        positions = read_accessor(gltf, binary, attributes["POSITION"]) + node.get("translation", [0, 0, 0])
        expect(np.abs(positions[:, [0, 2]]).max() < half and np.abs(positions[:, 1]).max() < 1,
               f"{node['name']}: in the block's space ({positions.min(axis=0)}, {positions.max(axis=0)})")


CHECKS = [
    check_conventions,
    check_triangles,
    check_settings,
    check_add_block,
    check_add_large_block,
    check_validate,
    check_preview,
    check_bake_ao,
    check_bake_color_map,
    check_split,
    check_export,
    check_trimesh,
    check_splat_map,
    check_workflow,
    check_decals,
]
REPORT = {"blender": bpy.app.version_string, "checks": {}, "exports": []}
#: A line `yarn verify:blender` shows (the rest of Blender's output goes to its log only)
PROGRESS_PREFIX = "[aek] "


def progress(line):
    print(PROGRESS_PREFIX + line, flush=True)


def main():
    aek = load_addon()
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj)
    report = REPORT
    failed = []
    aek.register()
    try:
        for check in CHECKS:
            started = time.perf_counter()
            try:
                check(aek)
                report["checks"][check.__name__] = "ok"
                progress(f"ok {check.__name__} ({time.perf_counter() - started:.1f} s)")
            except Exception:
                report["checks"][check.__name__] = traceback.format_exc()
                failed.append(check.__name__)
                progress(f"FAILED {check.__name__} ({time.perf_counter() - started:.1f} s)")
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
