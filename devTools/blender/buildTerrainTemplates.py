"""Builds the terrain add-on's templates (p306 D6) into src/toolkit/terrain/blender/: each a .blend
an artist opens and starts from, made with the add-on's operators as an artist would, scripted so
they can be made again (a template changed by hand drifts from this script: change the script).

- terrain_blockTemplate.blend: an empty 64 m / 129 block, the preview material, its custom props;
- terrain_singleLayer.blend: a block shaped by a live Displace (Global coordinates), one layer;
- terrain_vertexColorSplat.blend: hills painted in the vertex splat (4 layers, RGB + AO), AO baked;
- terrain_splatMap.blend: a block with a 1K splat map (5 layers, RGBA), splatMap_splat0.png beside;
- terrain_triplanarCliff.blend: a heightfield cliff band, and a trimesh block with an overhang;
- terrain_colormapDetail.blend: a painted block ready for Bake Colour Map;
- structure_concrete.blend: two wall segments and a bunker passage worn by a vertex colour.

Each has a README text block (shown in the Layout workspace) mirroring its handbook page, metric
units, a 1000 m clip end, the material preview, and its images by relative path into the texture
sets' fetched `source/raw/` (no packed images); saved compressed. Fetch the sets first:
yarn fetchTextureSources --only grass01,grass02,rocks01,rocks02,sand01,mud01,snow01,cliffs01,concrete01,concrete02

Run (a Windows blender.exe from WSL2 takes `wslpath -w` paths; the names pick templates):
blender -b --factory-startup --python-exit-code 1 --python buildTerrainTemplates.py -- <addon.py> <repo root> <renders dir> [<name>...]
It renders each template from above at an angle into <renders dir> (not into the .blend), to look at.
"""

import importlib.util
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Euler, Vector

sys.dont_write_bytecode = True

args = sys.argv[sys.argv.index("--") + 1 :]
ADDON_PATH, REPO_ROOT, RENDERS = args[0], args[1], args[2]
ONLY = set(args[3:])
FOLDER = os.path.join(REPO_ROOT, "src", "toolkit", "terrain", "blender")
os.makedirs(RENDERS, exist_ok=True)


def load_addon():
    spec = importlib.util.spec_from_file_location("aekasha_terrain_tools", ADDON_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


aek = load_addon()


def progress(line):
    print(f"[aek] {line}", flush=True)


# --- Shapes and paint ----------------------------------------------------------------------------


def smoothstep(edge0, edge1, x):
    t = np.clip((x - edge0) / (edge1 - edge0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def value_noise(x, z, scale, seed):
    """Smooth value noise in 0..1 at world (x, z), a lattice cell `scale` metres"""
    lattice = np.random.default_rng(seed).random((256, 256))
    fx, fz = x / scale, z / scale
    ix, iz = np.floor(fx).astype(np.int64), np.floor(fz).astype(np.int64)
    sx, sz = smoothstep(0, 1, fx - ix), smoothstep(0, 1, fz - iz)

    def at(i, j):
        return lattice[i % 256, j % 256]

    top = at(ix, iz) * (1 - sx) + at(ix + 1, iz) * sx
    bottom = at(ix, iz + 1) * (1 - sx) + at(ix + 1, iz + 1) * sx
    return top * (1 - sz) + bottom * sz


def fbm(x, z, scale, octaves, seed):
    """Octaves of value noise, each half the scale and amplitude, in 0..1"""
    total, amplitude, norm = 0.0, 1.0, 0.0
    for octave in range(octaves):
        total = total + amplitude * value_noise(x, z, scale / 2 ** octave, seed + octave)
        norm += amplitude
        amplitude /= 2
    return total / norm


class Grid:
    """A block's vertices as the engine sees them: local and world (x, z), row-major"""

    def __init__(self, obj):
        settings = obj.aek_terrain_block
        self.obj = obj
        self.size, self.res = int(settings.size), int(settings.resolution)
        self.spacing = self.size / (self.res - 1)
        rows, cols = np.divmod(np.arange(self.res * self.res), self.res)
        self.x = cols * self.spacing - self.size / 2
        self.z = rows * self.spacing - self.size / 2
        self.world_x = self.x + settings.grid_x * self.size
        self.world_z = self.z + settings.grid_z * self.size

    def set_heights(self, heights):
        mesh = self.obj.data
        co = np.empty(len(mesh.vertices) * 3)
        mesh.vertices.foreach_get("co", co)
        co = co.reshape(-1, 3)
        co[:, 2] = heights
        mesh.vertices.foreach_set("co", co.ravel())
        mesh.update()
        self.heights = np.asarray(heights)

    def slope(self):
        """Each vertex's slope in degrees, from the heights' central differences"""
        h = self.heights.reshape(self.res, self.res)
        dz, dx = np.gradient(h, self.spacing)
        return np.degrees(np.arctan(np.hypot(dx, dz))).ravel()

    def set_splat(self, weights, layout):
        """Writes linear weights (N × 3 or N × 4) into `Splat`, A 1 for RGB + AO, then Normalize"""
        weights = np.asarray(weights)
        sums = weights.sum(axis=1, keepdims=True)
        weights = np.where(sums > 1, weights / np.maximum(sums, 1e-9), weights)
        colors = np.zeros((len(weights), 4))
        colors[:, : weights.shape[1]] = weights
        if layout == "RGB_AO":
            colors[:, 3] = 1.0
        self.obj.data.color_attributes[aek.SPLAT_ATTRIBUTE].data.foreach_set("color", colors.ravel())
        select(self.obj)
        bpy.ops.aek.normalize_splat()


def select(obj):
    for other in bpy.context.selected_objects:
        other.select_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def add_block(block_id, *, size=64, res=129, grid_x=0, grid_z=0, layout="RGB_AO",
              collider="HEIGHTFIELD"):
    bpy.ops.aek.add_terrain_block(block_id=block_id, size=str(size), resolution=str(res),
                                  grid_x=grid_x, grid_z=grid_z, layout=layout, collider=collider)
    return Grid(bpy.data.objects[block_id])


def set_preview(layers, layout="RGB_AO"):
    """The scene's preview layers (the base, then 1-4) and layout, then Update Preview"""
    settings = bpy.context.scene.aek_terrain_preview
    settings.layout = layout
    for name, set_id in zip(("base", "layer1", "layer2", "layer3", "layer4"),
                            layers + [aek.NO_SET] * (5 - len(layers))):
        setattr(settings, name, set_id)
    result = bpy.ops.aek.update_terrain_preview()
    if result != {"FINISHED"}:
        raise RuntimeError(f"Update Preview: {result}")


def validate(obj, allowed=()):
    """Validate, failing on an error or a warning not in `allowed` (fragments)"""
    bpy.context.view_layer.update()
    issues = aek.validate_block(obj, bpy.context.evaluated_depsgraph_get(), bpy.context.scene.objects)
    unexpected = [(level, text) for level, text in issues
                  if level == "ERROR" or not any(fragment in text for fragment in allowed)]
    if unexpected:
        raise RuntimeError(f"{obj.name} doesn't validate: {unexpected}")
    return issues


# --- The file around a template -----------------------------------------------------------------

COMMON_SETUP = """
Set-up (once)
- Blender 5.3 (the add-on's minimum; checked with 5.3.0).
- Install the add-on: Edit > Preferences > Add-ons > the drop-down (top right) > Install from Disk > src/toolkit/terrain/blender/aekasha_terrain_tools.py. Its tab is "Ækasha" in the 3D view's sidebar (N).
- The preview's images are the texture sets' fetched maps, by relative path: run yarn fetchTextureSources in the repo (a set not fetched shows pink here, or a flat colour after Update Preview).
- Work on a copy: File > Save As into your own folder (Blender rewrites the relative image paths). Set the block's Folder (the sidebar) to where Export Block writes, eg. src/app/scenes/<sceneId>/blocks/<id>/.
- This file: metric units, scale 1, the view's clip end 1000 m; the Layout view in Material Preview.
"""


def new_file(name):
    """A fresh file saved at the template's path (the add-on finds the repo above it)"""
    bpy.ops.wm.read_homefile(use_empty=True, use_factory_startup=True)
    # No .blend1 backup beside the template on its second save
    bpy.context.preferences.filepaths.save_version = 0
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    scene.unit_settings.length_unit = "METERS"
    path = os.path.join(FOLDER, name + ".blend")
    bpy.ops.wm.save_as_mainfile(filepath=path, compress=True)
    return path


def set_up_views(target, distance, readme, yaw=25):
    """The README in the Layout workspace's bottom area, its 3D view framing `target` in Material
    Preview with the sidebar open; every 3D view's clip end 1000 m
    """
    text = bpy.data.texts.new("README")
    text.write(readme.strip() + "\n")
    text.cursor_set(0)
    rotation = Euler((math.radians(55), 0, math.radians(yaw))).to_quaternion()
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type != "VIEW_3D":
                continue
            space = area.spaces.active
            space.clip_end = 1000
            if screen.name == "Layout":
                space.shading.type = "MATERIAL"
                space.show_region_ui = True
                view = space.region_3d
                view.view_location = Vector(target)
                view.view_distance = distance
                view.view_rotation = rotation
                view.view_perspective = "PERSP"
    layout = bpy.data.screens.get("Layout")
    if layout is not None:
        bottom = min((a for a in layout.areas if a.type != "VIEW_3D"), key=lambda a: a.y,
                     default=None)
        if bottom is not None:
            bottom.type = "TEXT_EDITOR"
            bottom.spaces.active.text = text
            bottom.spaces.active.show_word_wrap = True


def make_image_paths_relative(path):
    """Every file image by a `//` path from the template, with `/` (Blender takes it everywhere)"""
    folder = os.path.dirname(path)
    for image in bpy.data.images:
        if image.source != "FILE" or image.filepath.startswith("//"):
            continue
        relative = os.path.relpath(bpy.path.abspath(image.filepath), folder).replace("\\", "/")
        image.filepath = "//" + relative
    packed = [image.name for image in bpy.data.images if image.packed_file]
    if packed:
        raise RuntimeError(f"Packed images: {packed}")


def save(path):
    make_image_paths_relative(path)
    for obj in bpy.context.selected_objects:
        obj.select_set(False)
    bpy.ops.wm.save_as_mainfile(filepath=path, compress=True, relative_remap=True)
    progress(f"saved {os.path.basename(path)}: {os.path.getsize(path) / 1e6:.2f} MB, images "
             f"{sorted(i.filepath for i in bpy.data.images if i.source == 'FILE')}")


def render(name, target, distance, yaw=25):
    """Two looks at the saved template (not saved into it): from above at an angle, and grazing"""
    scene = bpy.context.scene
    world = scene.world or bpy.data.worlds.new("render")
    scene.world = world
    if world.node_tree is None:
        world.use_nodes = True
    background = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
    background.inputs["Color"].default_value = (0.6, 0.7, 0.85, 1.0)
    background.inputs["Strength"].default_value = 0.6
    sun = bpy.data.objects.new("renderSun", bpy.data.lights.new("renderSun", "SUN"))
    sun.data.energy = 3.5
    sun.rotation_euler = Euler((math.radians(40), math.radians(15), math.radians(-35)))
    scene.collection.objects.link(sun)
    camera = bpy.data.objects.new("renderCamera", bpy.data.cameras.new("renderCamera"))
    camera.data.clip_end = 1000
    scene.collection.objects.link(camera)
    scene.camera = camera
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 24
    scene.cycles.use_denoising = True
    scene.render.resolution_x, scene.render.resolution_y = 960, 600
    scene.render.image_settings.file_format = "PNG"
    scene.view_settings.view_transform = "Standard"
    for suffix, pitch, turn, scale in (("above", 50, 0, 1.5), ("low", 72, -55, 0.9)):
        rotation = Euler((math.radians(pitch), 0, math.radians(yaw + turn)))
        offset = Vector((0, 0, distance * scale))
        offset.rotate(rotation)
        camera.location = Vector(target) + offset
        camera.rotation_euler = rotation
        scene.render.filepath = os.path.join(RENDERS, f"{name}_{suffix}.png")
        bpy.ops.render.render(write_still=True)
    progress(f"rendered {name}")


# --- The templates -------------------------------------------------------------------------------

VERTEX_LAYERS = ["grass01", "rocks01", "mud01", "snow01"]


def build_block_template():
    path = new_file("terrain_blockTemplate")
    add_block("terrainBlock")
    set_preview(VERTEX_LAYERS)
    validate(bpy.data.objects["terrainBlock"])
    set_up_views((0, 0, 0), 110, README_BLOCK)
    return path, (0, 0, 0), 90


def build_single_layer():
    path = new_file("terrain_singleLayer")
    grid = add_block("singleLayer")
    texture = bpy.data.textures.new("singleLayer hills", "CLOUDS")
    texture.noise_scale = 14.0
    texture.noise_depth = 3
    displace = grid.obj.modifiers.new("Displace", "DISPLACE")
    displace.texture = texture
    displace.texture_coords = "GLOBAL"
    displace.direction = "Z"
    displace.mid_level = 0.0
    displace.strength = 7.0
    set_preview(["grass01"])
    validate(grid.obj, allowed=("modifiers",))
    set_up_views((0, 0, 3), 110, README_SINGLE_LAYER)
    return path, (0, 0, 3), 90


def hills(grid, seed, height):
    return height * smoothstep(0.25, 0.85, fbm(grid.world_x, grid.world_z, 40.0, 5, seed))


def build_vertex_color_splat():
    path = new_file("terrain_vertexColorSplat")
    grid = add_block("vertexColorSplat")
    heights = hills(grid, 11, 18.0) + 0.6 * fbm(grid.world_x, grid.world_z, 6.0, 3, 21)
    grid.set_heights(heights)
    # By the shape's own spread, so each layer shows: rocks on the steepest fifth, snow on the
    # highest tenth, mud in the lowest fifth's hollows
    slope = grid.slope() + 8 * (fbm(grid.world_x, grid.world_z, 5.0, 3, 31) - 0.5)
    noise = fbm(grid.world_x, grid.world_z, 5.0, 3, 32)
    high = heights + 1.5 * (noise - 0.5)
    rocks = smoothstep(*np.percentile(slope, [78, 88]), slope)
    snow = smoothstep(*np.percentile(high, [88, 94]), high) * (1 - 0.6 * rocks)
    mud = smoothstep(*np.percentile(heights, [22, 10]), heights) * smoothstep(0.4, 0.55, noise)
    mud *= 1 - rocks
    grid.set_splat(np.stack([rocks, mud, snow], axis=1), "RGB_AO")
    set_preview(VERTEX_LAYERS)
    select(grid.obj)
    bpy.ops.aek.bake_ao_to_splat(samples=128, distance=16.0)
    validate(grid.obj)
    set_up_views((0, 0, 4), 105, README_VERTEX_SPLAT)
    return path, (0, 0, 4), 85


SPLAT_MAP_LAYERS = ["grass01", "rocks01", "sand01", "mud01", "grass02"]
SPLAT_MAP_SIZE = 1024


def build_splat_map():
    path = new_file("terrain_splatMap")
    grid = add_block("splatMap", layout="RGBA")
    grid.set_heights(hills(grid, 5, 5.0))
    set_preview(SPLAT_MAP_LAYERS, layout="RGBA")
    select(grid.obj)
    bpy.ops.aek.new_splat_map(size=str(SPLAT_MAP_SIZE))
    image = bpy.data.images["splatMap_splat0"]

    # The map's texel centres at the engine's local (x, z): the image's top row is V 0, the -z
    # edge (pixels run bottom-up in Blender: the array's last row)
    n = SPLAT_MAP_SIZE
    u = (np.arange(n) + 0.5) / n
    x, z = np.meshgrid(u * 64 - 32, u * 64 - 32)
    path_x = 6 * np.sin(z / 9) - 4
    trail = smoothstep(1.9, 1.3, np.abs(x - path_x))
    noise = fbm(x, z, 4.0, 4, 41)
    rocks = smoothstep(0.62, 0.7, fbm(x, z, 10.0, 4, 42)) * (1 - trail)
    mud = smoothstep(0.66, 0.72, noise) * smoothstep(0.6, 0.0, rocks) * (1 - trail)
    lush = smoothstep(0.45, 0.6, fbm(x, z, 16.0, 3, 43)) * (1 - rocks) * (1 - mud) * (1 - trail)
    weights = np.stack([rocks, trail, mud, lush], axis=-1)
    weights /= np.maximum(weights.sum(axis=-1, keepdims=True), 1)
    image.pixels.foreach_set(weights[::-1].astype(np.float32).ravel())
    image.filepath_raw = os.path.join(FOLDER, "splatMap_splat0.png")
    image.file_format = "PNG"
    image.save()

    validate(grid.obj)
    set_up_views((0, 0, 2), 100, README_SPLAT_MAP)
    return path, (0, 0, 2), 80


CLIFF_LAYERS = ["grass01", "cliffs01", "rocks01"]


def cliff_heights(grid):
    """A plateau 14 m up past a cliff along the engine's z (its face towards -x), winding, the
    same function of the world place in every block
    """
    edge = 4 * np.sin(grid.world_z / 10) - 2
    rim = smoothstep(-1.6, 1.6, grid.x - edge)
    ground = 1.5 * fbm(grid.world_x, grid.world_z, 12.0, 4, 51)
    return ground + 14 * rim + 0.8 * rim * fbm(grid.world_x, grid.world_z, 4.0, 3, 52), edge


def build_triplanar_cliff():
    path = new_file("terrain_triplanarCliff")
    grid = add_block("triplanarCliff")
    heights, edge = cliff_heights(grid)
    grid.set_heights(heights)
    slope = grid.slope()
    cliff = smoothstep(38, 52, slope)
    debris = smoothstep(4.0, 1.0, grid.x - edge + 4) * smoothstep(-8, -3.5, grid.x - edge) * (1 - cliff)
    grid.set_splat(np.stack([cliff, debris, np.zeros_like(cliff)], axis=1), "RGB_AO")

    # The overhang: the cliff running on into the next block along +z, a TRIMESH, its rim pushed
    # 2.5 m out over its foot, fading out over the 12 m before either z edge, so the edge it
    # shares keeps the heightfield block's vertices
    over = add_block("triplanarCliffOverhang", grid_z=1, collider="TRIMESH")
    heights, edge = cliff_heights(over)
    co = np.empty(len(over.obj.data.vertices) * 3)
    over.obj.data.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    co[:, 2] = heights
    band = smoothstep(-2.5, -1.0, over.x - edge) * smoothstep(5.0, 2.0, over.x - edge)
    away = smoothstep(-32.0, -20.0, over.z) * smoothstep(32.0, 20.0, over.z)
    co[:, 0] -= 2.5 * band * away * smoothstep(9.0, 14.0, heights)
    over.obj.data.vertices.foreach_set("co", co.ravel())
    over.obj.data.update()
    over.heights = heights
    slope = over.slope()
    cliff = np.maximum(smoothstep(38, 52, slope), band * smoothstep(3.0, 6.0, heights))
    debris = smoothstep(4.0, 1.0, over.x - edge + 4) * smoothstep(-8, -3.5, over.x - edge) * (1 - cliff)
    over.set_splat(np.stack([cliff, debris, np.zeros_like(cliff)], axis=1), "RGB_AO")

    set_preview(CLIFF_LAYERS)
    for block in (grid.obj, over.obj):
        select(block)
        bpy.ops.aek.bake_ao_to_splat(samples=128, distance=16.0)
    validate(grid.obj, allowed=("trimesh block",))
    validate(over.obj)
    # From the -x side, where the faces look
    set_up_views((-6, -32, 6), 150, README_CLIFF, yaw=-115)
    return path, (-6, -32, 6), 120, -115


COLOR_MAP_LAYERS = ["grass01", "grass02", "sand01", "mud01"]


def build_colormap_detail():
    path = new_file("terrain_colormapDetail")
    grid = add_block("colormapDetail")
    heights = hills(grid, 61, 9.0) + 0.5 * fbm(grid.world_x, grid.world_z, 5.0, 3, 62)
    grid.set_heights(heights)
    h = heights.reshape(129, 129)
    # Convex ridges dry out, hollows hold mud: the curvature from the heights' Laplacian
    curvature = (np.roll(h, 1, 0) + np.roll(h, -1, 0) + np.roll(h, 1, 1) + np.roll(h, -1, 1) - 4 * h)
    curvature = curvature.ravel() / grid.spacing ** 2
    patches = 0.8 * smoothstep(0.58, 0.72, fbm(grid.world_x, grid.world_z, 18.0, 4, 63))
    dry = smoothstep(-0.05, -0.2, curvature) * smoothstep(3.0, 6.0, heights)
    mud = smoothstep(0.05, 0.25, curvature) * smoothstep(3.0, 1.0, heights)
    grid.set_splat(np.stack([patches * (1 - dry), dry, mud], axis=1), "RGB_AO")
    set_preview(COLOR_MAP_LAYERS)
    select(grid.obj)
    bpy.ops.aek.bake_ao_to_splat(samples=128, distance=16.0)
    validate(grid.obj)
    set_up_views((0, 0, 3), 105, README_COLOR_MAP)
    return path, (0, 0, 3), 85


# --- The structure template ---------------------------------------------------------------------

STRUCTURE_LAYERS = ["concrete01", "concrete02", "mud01", "rocks02"]
STRUCTURE_GROUP = "AEK Structure Preview"
#: The wear attribute's density: the faces cut every 0.35 m, as the gallery's bunker
WEAR_SPACING = 0.35


def extrude_piece(name, profile, depth):
    """A piece from an (x, z) profile (counter-clockwise) extruded `depth` along Blender's y,
    centred on y and cut every `WEAR_SPACING` along each axis, so a vertex colour can carry wear
    """
    bm = bmesh.new()
    verts = [bm.verts.new((x, -depth / 2, z)) for x, z in profile]
    face = bm.faces.new(verts)
    bmesh.ops.reverse_faces(bm, faces=[face])
    # The face kept as the back cap
    extruded = bmesh.ops.extrude_face_region(bm, geom=[face], use_keep_orig=True)
    moved = [e for e in extruded["geom"] if isinstance(e, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, verts=moved, vec=(0, depth, 0))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    lo, hi = np.min([v.co for v in bm.verts], axis=0), np.max([v.co for v in bm.verts], axis=0)
    for axis in range(3):
        normal = [0.0, 0.0, 0.0]
        normal[axis] = 1.0
        for at in np.arange(lo[axis] + WEAR_SPACING, hi[axis] - 1e-3, WEAR_SPACING):
            co = [0.0, 0.0, 0.0]
            co[axis] = float(at)
            bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:],
                                   plane_co=co, plane_no=normal)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return obj


def paint_wear(obj, seed):
    """`Wear` (byte, vertex): R stains running down the vertical faces from the top, G grime at the
    foot, B chipped top edges and a few impacts; the base is clean concrete
    """
    mesh = obj.data
    count = len(mesh.vertices)
    co = np.empty(count * 3)
    mesh.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    normals = np.empty(count * 3)
    mesh.vertex_normals.foreach_get("vector", normals)
    normals = normals.reshape(-1, 3)
    world = co + np.asarray(obj.location)
    top = co[:, 2].max()
    vertical = smoothstep(0.6, 0.3, np.abs(normals[:, 2]))
    along = np.where(np.abs(normals[:, 0]) > np.abs(normals[:, 1]), world[:, 1], world[:, 0])
    streaks = smoothstep(0.45, 0.75, value_noise(along, np.zeros(count), 0.5, seed))
    run = smoothstep(top - 2.6, top - 0.2, co[:, 2]) * (0.4 + 0.6 * value_noise(along, world[:, 2], 3.0, seed + 1))
    stains = np.maximum(streaks * run * vertical, smoothstep(0.68, 0.76, fbm(along, world[:, 2], 2.5, 3, seed + 2)))
    grime = smoothstep(0.8, 0.05, co[:, 2]) * (0.5 + 0.5 * value_noise(along, world[:, 2], 1.2, seed + 3))
    edge = smoothstep(top - 0.4, top - 0.05, co[:, 2]) * vertical
    edge *= smoothstep(0.55, 0.7, value_noise(along, world[:, 2], 0.8, seed + 4))
    impacts = smoothstep(0.78, 0.84, fbm(along, world[:, 2], 1.5, 2, seed + 5)) * vertical
    weights = np.stack([stains, grime, np.maximum(edge, impacts)], axis=1)
    weights /= np.maximum(weights.sum(axis=1, keepdims=True), 1)
    wear = mesh.color_attributes.new("Wear", "BYTE_COLOR", "POINT")
    colors = np.ones((count, 4))
    colors[:, :3] = weights
    wear.data.foreach_set("color", colors.ravel())
    mesh.color_attributes.active_color = wear
    mesh.color_attributes.render_color_index = mesh.color_attributes.active_color_index


def build_structure_group(sets):
    """The structure preview: each layer's colour map box-projected (Blender's triplanar) at its
    real size over the object's or the world's position (the input "World", 0 or 1), blended
    linearly by `Wear` (the engine's `TRIPLANAR` with no anti-tiling, macro or normal maps)
    """
    group = bpy.data.node_groups.new(STRUCTURE_GROUP, "ShaderNodeTree")
    group.interface.new_socket("Color", in_out="OUTPUT", socket_type="NodeSocketColor")
    group.interface.new_socket("World", in_out="INPUT", socket_type="NodeSocketFloat")
    nodes, links = group.nodes, group.links
    coords = nodes.new("ShaderNodeTexCoord")
    geometry = nodes.new("ShaderNodeNewGeometry")
    space = nodes.new("ShaderNodeMix")
    space.data_type = "VECTOR"
    links.new(nodes.new("NodeGroupInput").outputs["World"], space.inputs["Factor"])
    links.new(coords.outputs["Object"], space.inputs[4])
    links.new(geometry.outputs["Position"], space.inputs[5])
    wear = nodes.new("ShaderNodeVertexColor")
    wear.layer_name = "Wear"
    channels = nodes.new("ShaderNodeSeparateColor")
    links.new(wear.outputs["Color"], channels.inputs[0])
    weights = [channels.outputs[i] for i in range(3)]

    total = nodes.new("ShaderNodeMath")
    total.operation = "ADD"
    links.new(weights[0], total.inputs[0])
    links.new(weights[1], total.inputs[1])
    total_all = nodes.new("ShaderNodeMath")
    total_all.operation = "ADD"
    links.new(total.outputs[0], total_all.inputs[0])
    links.new(weights[2], total_all.inputs[1])
    base = nodes.new("ShaderNodeMath")
    base.operation = "SUBTRACT"
    base.use_clamp = True
    base.inputs[0].default_value = 1.0
    links.new(total_all.outputs[0], base.inputs[1])
    weights = [base.outputs[0]] + weights

    color = None
    for index, (set_id, weight) in enumerate(zip(STRUCTURE_LAYERS, weights)):
        info = sets[set_id]
        width, height = info["physical_size"]
        tiled = nodes.new("ShaderNodeVectorMath")
        tiled.operation = "DIVIDE"
        links.new(space.outputs[1], tiled.inputs[0])
        # A wall's face takes x (or y) across and z up: a set's width across, its height up
        tiled.inputs[1].default_value = (width, width, height)
        image = nodes.new("ShaderNodeTexImage")
        image.image = bpy.data.images.load(info["color"], check_existing=True)
        image.projection = "BOX"
        image.projection_blend = 0.3
        links.new(tiled.outputs[0], image.inputs["Vector"])
        tinted = nodes.new("ShaderNodeVectorMath")
        tinted.operation = "MULTIPLY"
        links.new(image.outputs["Color"], tinted.inputs[0])
        tinted.inputs[1].default_value = info["tint"]
        weighted = nodes.new("ShaderNodeVectorMath")
        weighted.operation = "SCALE"
        links.new(tinted.outputs[0], weighted.inputs[0])
        links.new(weight, weighted.inputs["Scale"])
        if color is None:
            color = weighted.outputs[0]
        else:
            add = nodes.new("ShaderNodeVectorMath")
            add.operation = "ADD"
            links.new(color, add.inputs[0])
            links.new(weighted.outputs[0], add.inputs[1])
            color = add.outputs[0]
        for offset, made in enumerate((tiled, image, tinted, weighted)):
            made.location = (200 + offset * 200, -index * 300)
    links.new(color, nodes.new("NodeGroupOutput").inputs["Color"])
    return group


def structure_material(name, group, world):
    material = bpy.data.materials.new(name)
    if material.node_tree is None:
        material.use_nodes = True
    nodes = material.node_tree.nodes
    bsdf = next(n for n in nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Roughness"].default_value = 0.9
    preview = nodes.new("ShaderNodeGroup")
    preview.node_tree = group
    preview.inputs["World"].default_value = 1.0 if world else 0.0
    preview.location = (bsdf.location.x - 250, bsdf.location.y)
    material.node_tree.links.new(preview.outputs["Color"], bsdf.inputs["Base Color"])
    return material


def build_structure():
    path = new_file("structure_concrete")
    sets = aek.get_texture_sets(REPO_ROOT, refresh=True)
    missing = [s for s in STRUCTURE_LAYERS if not sets.get(s, {}).get("color")]
    if missing:
        raise RuntimeError(f"Not fetched: {missing} (yarn fetchTextureSources --only {','.join(missing)})")
    group = build_structure_group(sets)
    world = structure_material("AEK Structure Preview (World)", group, True)
    local = structure_material("AEK Structure Preview (Object)", group, False)

    wall = [(-4, 0), (4, 0), (4, 3), (-4, 3)]
    for index, x in enumerate((-4.0, 4.0)):
        segment = extrude_piece(f"wallSegment{'AB'[index]}", wall, 0.5)
        segment.location = (x, 0, 0)
        segment.data.materials.append(world)
        paint_wear(segment, 70 + index)
    # The passage: a U-shaped profile, 6 m wide, 3.5 m high, a 3 × 2.5 m way through, 8 m deep
    passage = [(-3, 0), (-1.5, 0), (-1.5, 2.5), (1.5, 2.5), (1.5, 0), (3, 0), (3, 3.5), (-3, 3.5)]
    bunker = extrude_piece("bunkerPassage", passage, 8.0)
    bunker.location = (0, -9, 0)
    bunker.data.materials.append(local)
    paint_wear(bunker, 80)
    for obj in bpy.context.scene.objects:
        for poly in obj.data.polygons:
            poly.use_smooth = False
    set_up_views((0, -5, 1.5), 28, README_STRUCTURE, yaw=20)
    return path, (0, -5, 1.5), 17, 20


# --- The READMEs ---------------------------------------------------------------------------------

README_BLOCK = """
ÆKASHA TERRAIN BLOCK TEMPLATE
The handbook: docs/techniques/terrain-blocks-blender.md (the whole workflow; every technique page starts from it).

What's here
- terrainBlock: an empty 64 m block of 129 x 129 vertices (0.5 m apart) at grid (0, 0), its origin at its centre, made by the add-on's Add Terrain Block: triangles along the heightfield collider's diagonal, the top-down UVs, the vertex colour "Splat" (byte, on vertices: black, A 1), the custom props the engine reads (Object Properties > Custom Properties: a FIXED HEIGHTFIELD body of 128 x 128 cells, keepMesh, the block's size, resolution and grid place).
- "AEK Terrain Preview": the add-on's preview material (sidebar > Ækasha > Preview Material): grass01 the base, rocks01, mud01 and snow01 painted in R, G, B. An approximation of the engine's terrain material.
""" + COMMON_SETUP + """
The workflow
1. A block: this one (rename it in the sidebar's Id), or Add Terrain Block (size, resolution, grid place, splat layout, collider). Blocks sit at their grid place in the file, so neighbours line up; the export moves each to the origin.
2. Shape it in height only: Sculpt mode with X and Y locked in the Symmetry popover, a Displace modifier (Texture Coordinates Global, Direction Z, Midlevel 0), or heights from a script. No overhangs on a heightfield block (the collider can't have them): set its Collider to Trimesh for one.
3. Paint the splat: Vertex Paint on "Splat" (pure red, green, blue at strength 1 for a layer, black for the base), or New Splat Map and Texture Paint. Normalize Splat after over-painting.
4. Bake AO > Splat Alpha (RGB + AO only): valley-scale occlusion, which the engine applies to indirect light.
5. Validate Block: it lists what Export would refuse (errors) and what to look at (warnings).
6. Export Block: the GLB with the locked glTF settings, the images, and the JSON stubs it lacks (<id>.importedAsset.json, <id>.terrainBlock.json) in the block's Folder.
7. Into Ækasha: give <id>.terrainBlock.json the world's terrain material and the block's inputs, run yarn assets --only <id>, list the block in the scene's terrainBlocks and spawn it with await spawnTerrainBlock('<id>').

Several blocks: shape one large grid, then Split Into Blocks (last: a block keeps the large grid's normals, so its edges match its neighbours' in light too).
"""

README_SINGLE_LAYER = """
ÆKASHA TERRAIN: SINGLE LAYER
The handbook: docs/techniques/terrain-single-layer.md; the block workflow: docs/techniques/terrain-blocks-blender.md (and terrain_blockTemplate.blend).

What's here
- singleLayer: a 64 m / 129 block shaped by a live Displace modifier: Texture Coordinates Global (a neighbouring block with the same modifier continues the hills), Direction Z (the vertices move in height only: a heightfield), Midlevel 0 (the texture's 0..1 lifts the ground 0..7 m), the texture "singleLayer hills" (Clouds, 14 m).
- The preview: grass01 alone, tiled at its real size (1.4 m) at the world position, as the engine's world UVs tile it.
""" + COMMON_SETUP + """
The technique
- A single-layer material needs nothing from the block but positions and normals: the splat stays black, its UVs unused. It's the cheapest terrain: one texture set, world tiling, anti-tiling and a macro variation in the engine.
- Shape: change the Displace's texture or strength, or sculpt (X and Y locked). Validate reads the block with its modifiers applied, as Export writes it, and warns that they're unapplied: fine.
- Export Block, then in <id>.terrainBlock.json: "material": "terrain" (the toolkit's single-layer default, grass01) or your own terrain material with one layer, "collider": { "type": "HEIGHTFIELD" }.
"""

README_VERTEX_SPLAT = """
ÆKASHA TERRAIN: VERTEX-COLOUR SPLAT
The handbook: docs/techniques/terrain-vertex-color-splat.md; the block workflow: docs/techniques/terrain-blocks-blender.md.

What's here
- vertexColorSplat: a 64 m / 129 block of hills, its "Splat" painted from its shape: rocks01 (R) on slopes over about 30 degrees, mud01 (G) in the low hollows, snow01 (B) over 9 m, grass01 the base (what R + G + B leave); A the AO baked by Bake AO > Splat Alpha (128 samples, 16 m).
- The preview: those four layers, the engine's height blend (Blend Depth 0.2), the AO darkening (AO strength 1).
""" + COMMON_SETUP + """
Painting
- Vertex Paint mode, the "Splat" attribute active (the Data tab's Color Attributes). One layer a channel: brush colour pure red (1, 0, 0) for layer 1, green for 2, blue for 3, black to paint back to the base. Strength 1, the Mix blend: painting a pure colour pulls the other channels down, so the weights keep summing to 1 at most.
- A soft stroke stores in-between weights (the export writes linear values: a half-strength stroke in the colour picker's sRGB is about 0.21).
- Over-painted (an Add blend, or several channels at 1)? Normalize Splat. Validate warns where the sums go over 1.
- The resolution is the vertex spacing (0.5 m here): a crisp path or a sharp border wants a splat map (terrain_splatMap.blend).
- Five layers: set the block's and the preview's Splat Layout to RGBA (A weighs layer 4), and lose the baked AO.
- Bake AO > Splat Alpha last: it rewrites A, keeping every painted RGB byte. Neighbouring blocks in the file occlude too.
- Export Block, then in <id>.terrainBlock.json a terrain material with blend.source VERTEX_COLOR, layout RGB_AO, ao.vertex for the baked AO, its four layers in the order base, R, G, B.
"""

README_SPLAT_MAP = """
ÆKASHA TERRAIN: SPLAT MAP
The handbook: docs/techniques/terrain-splat-map.md; the block workflow: docs/techniques/terrain-blocks-blender.md.

What's here
- splatMap: a 64 m / 129 block of low hills, its weights in a 1024 x 1024 splat map, splatMap_splat0 (6 cm a texel), saved beside this file as splatMap_splat0.png: rocks01 (R) in patches, sand01 (G) along a winding trail, mud01 (B) in puddles, grass02 (A) in lush areas, grass01 the base.
- "AEK Terrain Preview splatMap": the block's own preview material (New Splat Map made it), its weights from the map through the UVs; the scene's preview layout RGBA (five layers).
""" + COMMON_SETUP + """
Painting
- New Splat Map (the sidebar) on your block: <id>_splat0, Non-Color, channel-packed (A is a weight, not transparency), black: the base. Set Non-Color before painting, never after: a colour space change reloads the image and drops its unsaved paint.
- Texture Paint mode: the map is the material's active image node, so the brush paints it. Pure red, green, blue at strength 1 for layers 1-3; for layer 4 the brush's Add Alpha blend (Erase Alpha paints it back). Turn Falloff off for a hard border.
- Size: 1K for a 64 m block, 2K for 128 m, about 6 cm a texel either way; 8-bit.
- Orientation: the image's top row is the block's -z edge in the engine (the top view's top); its top left is the engine's -x, -z corner. Export writes its texture JSON with flipY false.
- Save the image (Image > Save) or Export Block, which saves it as a PNG beside the GLB with its texture JSON stub.
- Export Block, then in <id>.terrainBlock.json a terrain material with blend.source SPLAT_MAP and its five layers, and "materialInputs": { "splat0": { "texture": "<id>_splat0" } }.
"""

README_CLIFF = """
ÆKASHA TERRAIN: TRIPLANAR CLIFFS
The handbook: docs/techniques/terrain-triplanar-cliffs.md; the block workflow: docs/techniques/terrain-blocks-blender.md.

What's here
- triplanarCliff (grid 0, 0): a 64 m / 129 HEIGHTFIELD block: a plateau 14 m up past a winding cliff about 3 m wide (steep, never overhanging: every vertex moved in height only). cliffs01 (R) painted on the faces over about 45 degrees, rocks01 (G) on the debris at their foot, grass01 the base; AO baked.
- triplanarCliffOverhang (grid 0, 1): the cliff running on into the next block as a TRIMESH block (its Collider in the sidebar), its rim pushed 2.5 m out over its foot: an overhang, which no heightfield can hold. Validate skips its grid, UV and edge checks; the overhang fades out before the edge it shares with triplanarCliff, whose vertices stay where the heightfield block's are (Validate on triplanarCliff says it can't compare that edge).
- The preview tiles top-down, so the cliff faces stretch here: the engine projects the cliff layer triplanar (TRIPLANAR or BIPLANAR, slope-gated) and needs no UVs on the faces.
""" + COMMON_SETUP + """
The technique
- Heightfield first: a cliff as steep as you like, as long as no vertex moves in X or Y (sculpt with X and Y locked). The collider is the heightfield's, cheap and exact.
- An overhang, an arch or a cave needs a TRIMESH block: set its Collider to Trimesh, then move or add vertices freely. Costlier in physics; its edges aren't compared with its neighbours' (keep them where theirs are).
- Smooth normals across the rim give a smooth gate band in the engine's slope gate; a hard edge a hard switch.
- Export Block, then a terrain material with the cliff layer's projection TRIPLANAR (gated by slope, eg. [35, 50] degrees), "collider": { "type": "HEIGHTFIELD" } or "TRIMESH".
"""

README_COLOR_MAP = """
ÆKASHA TERRAIN: COLOUR MAP + DETAIL
The handbook: docs/techniques/terrain-colormap-detail.md; the block workflow: docs/techniques/terrain-blocks-blender.md.

What's here
- colormapDetail: a 64 m / 129 block of rolling hills, painted from its shape: grass02 (R) in large patches, sand01 (G) on the dry ridges, mud01 (B) in the wet hollows, grass01 the base; AO baked.
- The preview: those layers, which Bake Colour Map turns into one image. Not baked here: the bake writes <id>_colorMap.png into the block's Folder.
""" + COMMON_SETUP + """
The bake
- Set the block's Folder, then Bake Colour Map: Cycles bakes the preview's colour (the albedo, no light) through the block's UVs into <id>_colorMap, saved as <id>_colorMap.png. About 2K for a 64-128 m block.
- Include AO: off when the engine keeps the vertex AO (RGB + AO), on for a colour map that stands alone (a FAR_ONLY far surface without the splat).
- Don't bake light or shadow: the engine lights the map, and with day-night a baked sun is wrong half the day.
- Paint the colour map itself in Texture Paint for unique detail (a road, scorch, a field), on the baked image (sRGB).
- Export Block saves it as a PNG with its texture JSON (sRGB, flipY false); in the engine's material: "colorMap": { "mode": "DETAIL" } (the map tinting greyscale detail up close) or "FAR_ONLY" (the map past the detail distance), and "materialInputs": { "colorMap": { "texture": "<id>_colorMap" } }.
"""

README_STRUCTURE = """
ÆKASHA STRUCTURE MATERIALS: CONCRETE
The handbook: docs/techniques/structure-materials.md.

What's here
- wallSegmentA, wallSegmentB: two 8 x 0.5 x 3 m segments side by side, drawn in world space ("AEK Structure Preview (World)"): the concrete runs on across the joint.
- bunkerPassage: a 6 x 8 x 3.5 m passage piece with a 3 x 2.5 m way through, in object space ("AEK Structure Preview (Object)"): the concrete follows the piece when it moves or turns.
- Each cut every 0.35 m, so the vertex colour "Wear" (byte, on vertices) carries the wear: concrete02 stains (R) running down the walls from the top, mud01 grime (G) at the foot, rocks02 chips (B) on the top edges and a few impacts; concrete01 (clean) the base.
- The preview: each set box-projected (Blender's triplanar, the engine's TRIPLANAR) at its real size, blended linearly by "Wear": no anti-tiling, macro or normal maps.
- These aren't terrain blocks: no add-on operator applies. Their origin is at their base's centre, in metres.
""" + COMMON_SETUP + """
The technique
- No UVs needed: the engine projects the sets from three axes. Model at real scale, apply rotation and scale (or keep the scale on the node: object space measures in metres either way).
- Wear needs vertices: a 12-triangle box can't hold a streak. Cut the faces where wear goes (Edit mode, Loop Cut, or Bisect), about 0.3-0.5 m.
- Paint "Wear" in Vertex Paint: pure red, green, blue for layers 1-3, black for clean concrete, as a terrain splat.
- Export: File > Export > glTF 2.0 (.glb), Include: Selected Objects; Transform: +Y Up; Mesh: Apply Modifiers, UVs off, Normals, Tangents off, Vertex Colors Active (the "Wear" attribute active); Materials: No export; Compression off (the asset pipeline encodes). Then an <id>.importedAsset.json, and in the engine createStructureMaterial (space OBJECT, or WORLD for static pieces that join), blend.source VERTEX_COLOR, layout RGBA, its layers base, R, G, B.
"""


TEMPLATES = {
    "terrain_blockTemplate": build_block_template,
    "terrain_singleLayer": build_single_layer,
    "terrain_vertexColorSplat": build_vertex_color_splat,
    "terrain_splatMap": build_splat_map,
    "terrain_triplanarCliff": build_triplanar_cliff,
    "terrain_colormapDetail": build_colormap_detail,
    "structure_concrete": build_structure,
}


def main():
    unknown = ONLY - set(TEMPLATES)
    if unknown:
        raise RuntimeError(f"No template {sorted(unknown)}: {sorted(TEMPLATES)}")
    aek.register()
    try:
        for name, build in TEMPLATES.items():
            if ONLY and name not in ONLY:
                continue
            path, target, distance, *yaw = build()
            save(path)
            render(name, target, distance, *yaw)
    finally:
        aek.unregister()


main()
