"""Builds terrainBlockTest's decal block (p309 Phase 3) with the terrain add-on into
src/app/scenes/terrainBlockTest/decalBlock/, as an artist's Add Block → shape → Export Block, then
Add Decal Set → Add Decal → Export Decal Set would, scripted so it can be made again:

- `terrainBlockTestDecals`, 32 m / 65 at grid (-4, 3): a ridge 2.5 m high across it (its crest
  turning) with bumps of ±0.25 m about 5 m apart, the hard case for a decal conformed to it;
- its decal set `terrainBlockTestDecals_decals`: two tyre tracks (the decalsGround atlas's
  `tireTracks` cell, strips 1.7 m apart on one path) curving over the ridge and the bumps, and
  quads of `asphaltDamage` on the ridge's flank and `crack` at its foot.

It measures how far each decal lies from the block, at its vertices and across its faces (points
inside each triangle, cast straight down onto the block), for the AEK Decal group's levels 1-4 on
the tracks, and prints them (`[aek] gaps …`): under 0 a decal cuts into the block, over a few cm
it floats. The export writes the GLBs, and only the JSON stubs that aren't there (the folder's
JSONs are edited by hand: the block's material and its `decals`).

Run (a Windows blender.exe from WSL2 takes `wslpath -w` paths):
blender -b --factory-startup --python-exit-code 1 --python buildDecalTest.py -- <addon.py> <repo root>
"""

import importlib.util
import json
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Vector

sys.dont_write_bytecode = True

args = sys.argv[sys.argv.index("--") + 1 :]
ADDON_PATH, REPO_ROOT = args[0], args[1]
FOLDER = os.path.join(REPO_ROOT, "src", "app", "scenes", "terrainBlockTest", "decalBlock")

BLOCK_ID = "terrainBlockTestDecals"
SIZE, RES, GRID_X, GRID_Z = 32, 65, -4, 3
#: The tracks' path, Blender's (x, y) from the block's centre: over the ridge twice
TRACK_PATH = ((-14.0, -11.0), (-5.0, 5.0), (5.0, -6.0), (14.0, 9.0))
TRACK_HALF_GAUGE = 0.85
#: The quads: a cell at (x, y, yaw in degrees) from the block's centre
QUADS = (("asphaltDamage", 7.0, 6.0, 25.0), ("crack", -8.0, -3.0, -40.0))
#: Sample points a triangle side: (n + 1)(n + 2) / 2 points inside each
SAMPLES = 4


def load_addon():
    spec = importlib.util.spec_from_file_location("aekasha_terrain_tools", ADDON_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def progress(line):
    print(f"[aek] {line}", flush=True)


def ridge_heights(x, y):
    """The block's heights at Blender's (x, y): a ridge along a turning line, and the bumps"""
    crest = 0.25 * x + 3.0 * np.sin(x / 7.0)
    ridge = 2.5 * np.exp(-(((y - crest) / 5.0) ** 2))
    bumps = 0.25 * np.sin(x * 1.25) * np.cos(y * 1.1)
    return ridge + bumps


def add_decal(cell, x, y, yaw=0.0, *, strip=False):
    bpy.context.scene.cursor.location = (x, y, 0.0)
    result = bpy.ops.aek.add_decal(cell=cell, strip="STRIP" if strip else "QUAD")
    if result != {"FINISHED"}:
        raise RuntimeError(f"Add Decal {cell}: {result}")
    obj = bpy.context.active_object
    obj.rotation_euler.z = math.radians(yaw)
    return obj


def measure_gaps(obj, block):
    """How far the decal lies over the block (m): at its vertices, and at points inside each
    triangle (barycentric, `SAMPLES` a side), each cast straight down onto the block
    """
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = obj.evaluated_get(depsgraph)
    mesh = evaluated.to_mesh()
    mesh.calc_loop_triangles()
    world = obj.matrix_world
    to_block = block.matrix_world.inverted()
    weights = [(i / SAMPLES, j / SAMPLES) for i in range(SAMPLES + 1) for j in range(SAMPLES + 1 - i)]

    def gap_at(point):
        hit, location, _normal, _face = block.ray_cast(to_block @ (point + Vector((0, 0, 10))),
                                                       Vector((0, 0, -1)))
        return point.z - (block.matrix_world @ location).z if hit else None

    vertex_gaps = [gap_at(world @ v.co) for v in mesh.vertices]
    face_gaps = []
    for triangle in mesh.loop_triangles:
        a, b, c = (world @ mesh.vertices[i].co for i in triangle.vertices)
        for u, v in weights:
            face_gaps.append(gap_at(a * (1 - u - v) + b * u + c * v))
    evaluated.to_mesh_clear()
    vertex_gaps = np.array([g for g in vertex_gaps if g is not None])
    face_gaps = np.array([g for g in face_gaps if g is not None])
    return {
        "vertices": len(vertex_gaps),
        "vertexGap": [round(float(vertex_gaps.min()), 4), round(float(vertex_gaps.max()), 4)],
        "faceGap": [round(float(face_gaps.min()), 4), round(float(face_gaps.max()), 4)],
        # Cutting in: under the block; floating: over 4 cm
        "under": round(float((face_gaps < 0).mean()), 4),
        "over4cm": round(float((face_gaps > 0.04).mean()), 4),
    }


def set_level(obj, aek, level):
    modifier = obj.modifiers[aek.DECAL_GROUP]
    socket = next(s for s in modifier.node_group.interface.items_tree
                  if getattr(s, "name", "") == "Level" and s.in_out == "INPUT")
    getattr(modifier.properties.inputs, socket.identifier).value = level


def main():
    aek = load_addon()
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj)
    aek.register()
    aek.get_repo_root = lambda context: REPO_ROOT
    try:
        bpy.ops.aek.add_terrain_block(block_id=BLOCK_ID, size=str(SIZE), resolution=str(RES),
                                      grid_x=GRID_X, grid_z=GRID_Z, layout="RGB_AO")
        block = bpy.data.objects[BLOCK_ID]
        mesh = block.data
        co = np.empty(len(mesh.vertices) * 3)
        mesh.vertices.foreach_get("co", co)
        co = co.reshape(-1, 3)
        co[:, 2] = ridge_heights(co[:, 0], co[:, 1])
        mesh.vertices.foreach_set("co", co.ravel())
        mesh.update()
        issues = aek.validate_block(block, bpy.context.evaluated_depsgraph_get(),
                                    bpy.context.scene.objects)
        if issues:
            raise RuntimeError(f"{BLOCK_ID} doesn't validate: {issues}")
        block.aek_terrain_block.output_dir = FOLDER
        bpy.context.view_layer.objects.active = block
        if bpy.ops.aek.export_terrain_block() != {"FINISHED"}:
            raise RuntimeError(f"Export Block {BLOCK_ID}")
        progress(f"exported {BLOCK_ID} into {FOLDER}")

        bpy.context.view_layer.objects.active = block
        bpy.ops.aek.add_decal_set()
        collection = bpy.data.collections[f"{BLOCK_ID}_decals"]
        # Its cursor positions are the block's local (x, y): the block sits at its grid place
        origin = block.location
        left = add_decal("tireTracks", origin.x, origin.y, strip=True)
        right = add_decal("tireTracks", origin.x, origin.y, strip=True)
        path = bpy.data.objects[f"{left.name}_path"]
        spline = path.data.splines[0]
        spline.bezier_points.add(len(TRACK_PATH) - len(spline.bezier_points))
        for point, (x, y) in zip(spline.bezier_points, TRACK_PATH):
            point.co = (x, y, 0.0)
            point.handle_left_type = point.handle_right_type = "AUTO"
        bpy.data.objects.remove(bpy.data.objects[f"{right.name}_path"])
        right.modifiers["Array"].curve = path
        right.modifiers["Curve"].object = path
        for obj, side in ((left, -1), (right, 1)):
            for vertex in obj.data.vertices:
                vertex.co.y += side * TRACK_HALF_GAUGE
        left.name, right.name, path.name = "tireTracksLeft", "tireTracksRight", "tireTracksPath"
        quads = [add_decal(cell, origin.x + x, origin.y + y, yaw) for cell, x, y, yaw in QUADS]

        report = {"addDecalLevel": aek.get_decal_level(block, 1.8, 0.45), "levels": {}}
        for level in (1, 2, 3, 4):
            for obj in (left, right):
                set_level(obj, aek, level)
            report["levels"][level] = measure_gaps(left, block)
            progress(f"gaps tireTracksLeft level {level}: {json.dumps(report['levels'][level])}")
        for obj in (left, right):
            set_level(obj, aek, report["addDecalLevel"])
        for obj in quads:
            report[obj.name] = measure_gaps(obj, block)
            progress(f"gaps {obj.name}: {json.dumps(report[obj.name])}")

        collection.aek_decal_set.output_dir = FOLDER
        bpy.context.view_layer.objects.active = left
        if bpy.ops.aek.export_decal_set() != {"FINISHED"}:
            raise RuntimeError("Export Decal Set")
        progress(f"exported {collection.aek_decal_set.set_id} into {FOLDER}")
        progress(f"report {json.dumps(report)}")
    finally:
        aek.unregister()


main()
