"""Exports terrainBlockTest's orientation block with the terrain add-on (p306 Phase 5 step 10) into
src/app/terrainBlocks/terrainBlockTestBlender/ (shared with terrainGallery since p310), as an
artist's Add → paint → Bake AO → Validate → Export would, scripted so it can be made again:

- `terrainBlockTestBlender`, 32 m / 33 at grid (-3, 3), RGB_AO;
- a mound 6 m high near the engine's +x, +z corner (local x 4, z 10, between the
  scene's boxes, which land 8 m apart): the heights' orientation;
- the corner markers in `Splat`: red on the engine's -x, -z corner (the top view's top left), green
  on its +x, -z corner (top right), 8 × 8 vertices each; A the baked AO (128 samples, 8 m);
- the same markers painted into `terrainBlockTestBlender_splat0` (128 px, a splat map's layers 1
  and 2), its top left red: the image's top row is the UVs' V 0 in the engine, the -z edge.

The export writes the GLB and the image, and only the JSON stubs that aren't there (the folder's
JSONs are edited by hand: the materials, the grid of the splat-map block).

Run (a Windows blender.exe from WSL2 takes `wslpath -w` paths):
blender -b --factory-startup --python-exit-code 1 --python exportOrientationBlock.py -- <addon.py> <repo root>
"""

import importlib.util
import os
import sys

import bpy
import numpy as np

sys.dont_write_bytecode = True

args = sys.argv[sys.argv.index("--") + 1 :]
ADDON_PATH, REPO_ROOT = args[0], args[1]
FOLDER = os.path.join(REPO_ROOT, "src", "app", "terrainBlocks", "terrainBlockTestBlender")

BLOCK_ID = "terrainBlockTestBlender"
SIZE, RES = 32, 33
#: The mound, at the engine's local x, z
MOUND = {"x": 4.0, "z": 10.0, "height": 6.0, "radius": 3.0}
#: The markers' rows and columns from the corner
MARKER = 8
IMAGE_SIZE = 128


def load_addon():
    spec = importlib.util.spec_from_file_location("aekasha_terrain_tools", ADDON_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def main():
    aek = load_addon()
    # The factory scene's cube would occlude the AO bake
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj)
    aek.register()
    try:
        bpy.ops.aek.add_terrain_block(block_id=BLOCK_ID, size=str(SIZE), resolution=str(RES),
                                      grid_x=-3, grid_z=3, layout="RGB_AO")
        block = bpy.data.objects[BLOCK_ID]
        mesh = block.data

        co = np.empty(len(mesh.vertices) * 3)
        mesh.vertices.foreach_get("co", co)
        co = co.reshape(-1, 3)
        # The engine's z is Blender's -y
        distance = np.hypot(co[:, 0] - MOUND["x"], -co[:, 1] - MOUND["z"])
        co[:, 2] = MOUND["height"] * np.exp(-((distance / MOUND["radius"]) ** 2))
        mesh.vertices.foreach_set("co", co.ravel())
        mesh.update()

        rows, cols = np.divmod(np.arange(RES * RES), RES)
        colors = np.zeros((RES * RES, 4))
        top = rows < MARKER
        colors[top & (cols < MARKER), 0] = 1.0
        colors[top & (cols >= RES - MARKER), 1] = 1.0
        colors[:, 3] = 1.0
        mesh.color_attributes[aek.SPLAT_ATTRIBUTE].data.foreach_set("color", colors.ravel())

        bpy.context.view_layer.objects.active = block
        bpy.ops.aek.bake_ao_to_splat(samples=128, distance=8.0)

        # Blender's pixels run bottom-up: the image's top rows are the array's last
        image = bpy.data.images.new(f"{BLOCK_ID}_splat0", IMAGE_SIZE, IMAGE_SIZE, alpha=False)
        # Before the paint: setting the colour space later reloads the image, blank
        image.colorspace_settings.name = "Non-Color"
        pixels = np.zeros((IMAGE_SIZE, IMAGE_SIZE, 4))
        pixels[:, :, 3] = 1.0
        corner = IMAGE_SIZE // 4
        pixels[IMAGE_SIZE - corner :, :corner, 0] = 1.0
        pixels[IMAGE_SIZE - corner :, IMAGE_SIZE - corner :, 1] = 1.0
        image.pixels.foreach_set(pixels.astype(np.float32).ravel())

        issues = aek.validate_block(block, bpy.context.evaluated_depsgraph_get(), bpy.context.scene.objects)
        if issues:
            raise RuntimeError(f"{BLOCK_ID} doesn't validate: {issues}")
        block.aek_terrain_block.output_dir = FOLDER
        bpy.ops.aek.export_terrain_block()
        print(f"[aek] exported {BLOCK_ID} into {FOLDER}", flush=True)
    finally:
        aek.unregister()


main()
