"""Builds terrainShowcase's Blender blocks (p310 Phase 2, the plan's §3.2-3.6) into
src/app/scenes/terrainShowcase/blocks/<id>/, as an artist following the plan's steps would with the
terrain add-on, scripted so they can be made again (a block changed by hand drifts from this
script: change the script):

- showcaseCoast (§3.3), 64 m / 129 at grid (0, 0), RGB_AO: dunes shaped by two Displace modifiers
  (Clouds, Global coordinates) and a third tilting it toward the sea (a Blend texture through an
  empty), applied; a cliff band along the north edge (the engine's -z); the splat painted (sand02
  along the waterline, rocks01 at the cliff foot and in islands, cliffs01 on the face); the AO
  baked; its decal set: two tyre tracks across the beach.
- showcaseAlpine (§3.4), 64 m / 129 at grid (2, 0), RGBA: a ridge rising toward +x (Clouds and a
  Blend ramp, faded out over the flat south part by a vertex group) with a north-facing rock band
  and a shallow pond bowl, applied; two splat maps (seven layers: grass02, rocks02, cliffs02, snow01
  in the first, snow02 and ice01 in the second); no vertex AO; boulders scattered by the template's
  Geometry Nodes group over the first map's scree (the toolkit's namaqualandBoulder02 in three
  shapes), exported as GPU instances; its decal set: two ice cracks on the pond.
- showcaseWetlands (§3.5), 64 m / 129 at grid (0, 2), RGB_AO: almost flat (two Displace
  modifiers, applied), a meandering channel, two hollows and a pad flattened for the bunker
  sculpted; the splat painted (mud02 in the channel and the hollows, grass02 on the raised ground,
  rocks01 on a path crossing the channel and on the pad); the AO baked; a regional wetness
  `_WETNESS` from a painted vertex group `Wet` by a Geometry Nodes modifier kept last (Export
  applies it); its decal set: tyre ruts along the path through the ford and three mud splatters.
- showcaseBunker (§3.6), in showcaseWetlands' folder: from the add-on's structure_concrete.blend, a
  6 × 4 × 2.6 m bunker (walls 0.4 m, a doorway) and a 12 m wall segment, cut every 0.35 m for the
  wear, bevelled (applied), worn in `Wear` (R the damaged edges from Dirty Vertex Colors, G stains
  running down from the roof edge and grime at the foot, B chips), box colliders as child nodes (a
  FIXED compound body each), exported by hand (showcaseBunker.glb); two leak decals under the
  roof edge, quads of decalsStructure's cells laid on the front wall, exported by hand in the
  bunker's space (showcaseBunker_leaks.glb).

The sculpt and paint strokes are functions of the grid (the template builder's `Grid`); the steps
an artist does by hand (Sculpt with X and Y locked, Vertex Paint) were tried in a live Blender
(the plan's Phase 2 notes). Each block starts from the add-on's template terrain_blockTemplate.blend
(its empty block deleted: Add refuses a grid place a block has), saved as <id>.blend in its folder,
and exports its GLB, its decal set's GLB, and only the JSON stubs that aren't there (the folder's
JSONs are edited by hand: the material, the scatter, the decals). It renders each block into
<renders dir> (not into the .blend), to look at.

Run (a Windows blender.exe from WSL2 takes `wslpath -w` paths; the names pick blocks):
blender -b --factory-startup --python-exit-code 1 --python buildShowcaseBlocks.py -- <addon.py> <repo root> <renders dir> [<block>...]
"""

import math
import os
import sys

import bpy
import numpy as np

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
# The template builder's helpers, with the add-on it loaded (its arguments start as this script's)
import buildTerrainTemplates as tpl  # noqa: E402

aek = tpl.aek
progress, select, smoothstep, fbm = tpl.progress, tpl.select, tpl.smoothstep, tpl.fbm

BLOCKS_FOLDER = os.path.join(tpl.REPO_ROOT, "src", "app", "scenes", "terrainShowcase", "blocks")
TEMPLATE = os.path.join(tpl.FOLDER, "terrain_blockTemplate.blend")
#: The scene's water level (its JSON's `surfaceConditions.waterLevel`, the Coast's shoreline)
WATER_LEVEL = 0.5


def open_template(block_id):
    """The template saved as the block's .blend in its folder, its empty block deleted"""
    folder = os.path.join(BLOCKS_FOLDER, block_id)
    os.makedirs(folder, exist_ok=True)
    bpy.ops.wm.open_mainfile(filepath=TEMPLATE)
    # No .blend1 backup beside the block on its second save
    bpy.context.preferences.filepaths.save_version = 0
    template_block = bpy.data.objects["terrainBlock"]
    mesh = template_block.data
    bpy.data.objects.remove(template_block)
    bpy.data.meshes.remove(mesh)
    readme = bpy.data.texts.get("README")
    if readme is not None:
        bpy.data.texts.remove(readme)
    path = os.path.join(folder, block_id + ".blend")
    bpy.ops.wm.save_as_mainfile(filepath=path, compress=True, relative_remap=True)
    return path


def add_vertex_group(obj, name, weights):
    """A vertex group of a weight per vertex (Weight Paint's strokes)"""
    group = obj.vertex_groups.new(name=name)
    for index, weight in enumerate(weights):
        group.add([index], float(weight), "REPLACE")
    return group


def add_ramp_space(name, location, turn=0.0):
    """An empty a Blend texture reads through (Texture Coordinates Object): a block's half wide, so
    the texture's -1..1 spans the block, its +x turned `turn` radians about Z
    """
    space = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(space)
    space.location = location
    space.scale = (32.0, 32.0, 32.0)
    space.rotation_euler.z = turn
    return space


def set_preview_layers(layers, layout):
    """The scene's preview layers (the base, then 1-8) and layout, then Update Preview"""
    settings = bpy.context.scene.aek_terrain_preview
    settings.layout = layout
    names = ["base"] + [f"layer{i}" for i in range(1, aek.PREVIEW_LAYERS)]
    for name, set_id in zip(names, layers + [aek.NO_SET] * (len(names) - len(layers))):
        setattr(settings, name, set_id)
    result = bpy.ops.aek.update_terrain_preview()
    if result != {"FINISHED"}:
        raise RuntimeError(f"Update Preview: {result}")


def sample_grid(grid, values, x, z):
    """Bilinear samples of per-vertex `values` at the engine's local (x, z) (arrays)"""
    v = np.asarray(values).reshape(grid.res, grid.res)
    fc = np.clip((x + grid.size / 2) / grid.spacing, 0, grid.res - 1.001)
    fr = np.clip((z + grid.size / 2) / grid.spacing, 0, grid.res - 1.001)
    c, r = np.floor(fc).astype(int), np.floor(fr).astype(int)
    tc, tr = fc - c, fr - r
    top = v[r, c] * (1 - tc) + v[r, c + 1] * tc
    bottom = v[r + 1, c] * (1 - tc) + v[r + 1, c + 1] * tc
    return top * (1 - tr) + bottom * tr


def paint_splat_map(block, index, size, weights, folder):
    """New Splat Map (map `index`), its pixels the weights (size × size × 4, rows from the top: the
    engine's -z edge), saved as a PNG beside the .blend (Image → Save As: a painted image left
    generated would lose its paint with the file)
    """
    select(block)
    result = bpy.ops.aek.new_splat_map(size=str(size), map=str(index))
    if result != {"FINISHED"}:
        raise RuntimeError(f"New Splat Map {index}: {result}")
    name = block.aek_terrain_block.block_id + aek.SPLAT_MAP_SUFFIXES[index]
    image = bpy.data.images[name]
    # Pixels run bottom-up in Blender: the array's last row is the image's top
    image.pixels.foreach_set(np.ascontiguousarray(weights[::-1], dtype=np.float32).ravel())
    image.filepath_raw = os.path.join(folder, name + ".png")
    image.file_format = "PNG"
    image.save()
    shares = {channel: f"{np.mean(weights[..., i] > 0.5) * 100:.0f} %"
              for i, channel in enumerate("RGBA")}
    progress(f"{name}: over 0.5 on {shares}")
    return image


def add_displace(obj, name, texture, strength, *, coords="GLOBAL", coords_object=None):
    """A Displace along Z (Direction Z, Midlevel 0: the texture's 0..1 lifts by 0..strength)"""
    displace = obj.modifiers.new(name, "DISPLACE")
    displace.texture = texture
    displace.texture_coords = coords
    if coords_object is not None:
        displace.texture_coords_object = coords_object
    displace.direction = "Z"
    displace.mid_level = 0.0
    displace.strength = strength
    return displace


def clouds(name, size, depth=2):
    texture = bpy.data.textures.new(name, "CLOUDS")
    texture.noise_scale = size
    texture.noise_depth = depth
    return texture


def apply_modifiers(obj):
    select(obj)
    for modifier in list(obj.modifiers):
        bpy.ops.object.modifier_apply(modifier=modifier.name)


def read_heights(grid):
    co = np.empty(len(grid.obj.data.vertices) * 3)
    grid.obj.data.vertices.foreach_get("co", co)
    grid.heights = co.reshape(-1, 3)[:, 2].copy()
    return grid.heights


def blob(grid, x, z, radius):
    """1 inside a soft disc at the engine's local (x, z), 0 past `radius`"""
    return smoothstep(radius, radius * 0.4, np.hypot(grid.x - x, grid.z - z))


def add_track_pair(path_points, half_gauge, cell="tireTracks", origin=(0.0, 0.0, 0.0)):
    """Two strips of a strip cell along one path (Add Decal's, at the 3D cursor: `origin`, the
    block's centre, the points Blender's (x, y) from it), `half_gauge` either side of it
    """
    bpy.context.scene.cursor.location = origin
    strips = []
    for _ in range(2):
        result = bpy.ops.aek.add_decal(cell=cell, strip="STRIP")
        if result != {"FINISHED"}:
            raise RuntimeError(f"Add Decal {cell}: {result}")
        strips.append(bpy.context.active_object)
    left, right = strips
    track_path = bpy.data.objects[f"{left.name}_path"]
    spline = track_path.data.splines[0]
    spline.bezier_points.add(len(path_points) - len(spline.bezier_points))
    for point, (x, y) in zip(spline.bezier_points, path_points):
        point.co = (x, y, 0.0)
        point.handle_left_type = point.handle_right_type = "AUTO"
    bpy.data.objects.remove(bpy.data.objects[f"{right.name}_path"])
    right.modifiers["Array"].curve = track_path
    right.modifiers["Curve"].object = track_path
    for obj, side in ((left, -1), (right, 1)):
        for vertex in obj.data.vertices:
            vertex.co.y += side * half_gauge
    return left, right, track_path


def export(block, decal_sets=()):
    select(block)
    result = bpy.ops.aek.export_terrain_block()
    if result != {"FINISHED"}:
        raise RuntimeError(f"Export Block {block.name}: {result}")
    for collection in decal_sets:
        layer = bpy.context.view_layer.layer_collection.children[collection.name]
        bpy.context.view_layer.active_layer_collection = layer
        for obj in bpy.context.selected_objects:
            obj.select_set(False)
        bpy.context.view_layer.objects.active = None
        result = bpy.ops.aek.export_decal_set()
        if result != {"FINISHED"}:
            raise RuntimeError(f"Export Decal Set {collection.name}: {result}")
    progress(f"exported {block.name}")


def report_splat(grid, names):
    colors = np.empty(len(grid.obj.data.vertices) * 4)
    grid.obj.data.color_attributes[aek.SPLAT_ATTRIBUTE].data.foreach_get("color", colors)
    colors = colors.reshape(-1, 4)
    shares = {name: f"{np.mean(colors[:, i] > 0.5) * 100:.0f} %" for i, name in enumerate(names)}
    progress(f"splat over 0.5: {shares}")


def tidy_images():
    """The template's images no layer uses dropped, and `//` paths with `/` (a Windows Blender's
    relative remap writes `\\`, which the template builder's relative paths don't touch)
    """
    for image in list(bpy.data.images):
        if image.users == 0:
            bpy.data.images.remove(image)
        elif image.filepath.startswith("//"):
            image.filepath = image.filepath.replace("\\", "/")


def report_track_heights(grid, track_path):
    """The block's lowest height under a track's path (sampled along its spline): a track under
    the water level would lie in the sea
    """
    bpy.context.view_layer.update()
    spline = track_path.data.splines[0]
    points = [p.co for p in spline.bezier_points]
    h = grid.heights.reshape(grid.res, grid.res)
    lowest = math.inf
    for a, b in zip(points, points[1:]):
        for t in np.linspace(0, 1, 40):
            x, y = a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t
            col = int(round((x + grid.size / 2) / grid.spacing))
            row = int(round((grid.size / 2 - y) / grid.spacing))
            if h[row, col] < lowest:
                lowest, where = float(h[row, col]), (round(x, 1), round(y, 1))
    progress(f"the tracks' path: lowest ground {lowest:.2f} m at Blender's {where} (water "
             f"{WATER_LEVEL} m)")


def report_heights(grid, label):
    h = grid.heights.reshape(grid.res, grid.res)
    rows = {f"z {grid.z[r * grid.res]:+.0f}": round(float(h[r].mean()), 2)
            for r in range(0, grid.res, 16)}
    progress(f"{label}: min {h.min():.2f}, max {h.max():.2f}, row means {rows}")


# --- showcaseCoast (§3.3) ------------------------------------------------------------------------

COAST_LAYERS = ["sand01", "sand02", "rocks01", "cliffs01"]
#: The tyre tracks' path out of the dunes onto the beach (west of the inlet), Blender's (x, y) from the
#: block's centre
COAST_TRACK_PATH = ((-28.0, 6.0), (-18.0, 0.0), (-8.0, -5.0), (-1.0, -8.5))
COAST_TRACK_HALF_GAUGE = 0.85
#: The rocks01 islands in the dunes: the engine's local (x, z, radius)
COAST_ISLANDS = ((-17.0, -2.0, 3.5), (9.0, 1.0, 2.8), (22.0, -6.0, 3.0))


def coast_cliff_foot(grid):
    """The cliff band's foot along the north edge: the engine's local z, winding with x"""
    return -20.0 + 2.5 * np.sin(grid.x / 11.0)


def build_coast():
    block_id = "showcaseCoast"
    path = open_template(block_id)
    grid = tpl.add_block(block_id)
    tpl.set_preview(COAST_LAYERS)

    # 1. Shape: dune swells, small ripples, and a tilt toward the sea (the engine's +z, Blender's
    # -y): a Blend texture through an empty a block's half wide, turned so its +x is Blender's -y
    dunes = clouds("showcaseCoast dunes", 18.0, 3)
    # Clouds stays near its middle (0.3-0.7): the contrast spreads it, so the swells read
    dunes.contrast = 1.6
    # The dunes fade out toward the shore (a vertex group weighted 1 inland, 0 from 14 m before
    # the south edge: Weight Paint's Gradient), so the beach under them stays smooth
    add_vertex_group(grid.obj, "Dunes", smoothstep(18.0, 4.0, grid.z))
    add_displace(grid.obj, "Dunes", dunes, 3.0).vertex_group = "Dunes"
    add_displace(grid.obj, "Ripples", clouds("showcaseCoast ripples", 4.0), 0.4)
    tilt_space = add_ramp_space("showcaseCoast tilt", grid.obj.location, -math.pi / 2)
    tilt = bpy.data.textures.new("showcaseCoast tilt", "BLEND")
    tilt.progression = "QUADRATIC"
    add_displace(grid.obj, "Tilt", tilt, -2.0, coords="OBJECT", coords_object=tilt_space)
    apply_modifiers(grid.obj)
    bpy.data.objects.remove(tilt_space)
    grid.obj.vertex_groups.remove(grid.obj.vertex_groups["Dunes"])
    heights = read_heights(grid)
    report_heights(grid, "shaped")

    # 2. The cliff band (Sculpt, X and Y locked: heights only): 6-9 m over about 4 m of run, the
    # top lip smoothed, the plateau behind it keeping the dunes' relief
    foot = coast_cliff_foot(grid)
    rise = 7.5 + 1.5 * np.sin(grid.x / 7.0 + 1.0)
    band = smoothstep(foot, foot - 4.0, grid.z)
    heights = heights + rise * band
    grid.set_heights(heights)
    slope = grid.slope()
    report_heights(grid, "with the cliff")
    progress(f"cliff face: max slope {slope[band > 0.2].max():.0f}°, "
             f"{np.mean(slope[(band > 0.3) & (band < 0.7)]):.0f}° mean at its middle")

    # 3. The splat: R sand02 along the waterline, G rocks01 at the cliff foot and in islands,
    # B cliffs01 on the face (loosely: the material's slope gate does the rest), the rest sand01
    noise = fbm(grid.world_x, grid.world_z, 5.0, 3, 331)
    cliffs = smoothstep(26.0, 38.0, slope) * smoothstep(foot + 3.0, foot + 1.0, grid.z)
    # The band 0.45 m over the water to 0.35 m under it: 6-10 m wide on this beach's slope (about
    # 0.1 m a metre)
    wander = heights + 0.4 * (noise - 0.5)
    beach = smoothstep(WATER_LEVEL + 0.6, WATER_LEVEL + 0.3, wander)
    beach *= smoothstep(WATER_LEVEL - 0.5, WATER_LEVEL - 0.2, wander)
    beach *= 1 - cliffs
    at_foot = smoothstep(foot + 5.0, foot + 1.5, grid.z) * smoothstep(foot - 0.5, foot + 1.0, grid.z)
    islands = np.maximum.reduce([blob(grid, x, z, r) for x, z, r in COAST_ISLANDS])
    rocks = np.maximum(at_foot, islands) * (0.6 + 0.4 * smoothstep(0.35, 0.65, noise))
    rocks *= (1 - cliffs) * (1 - beach)
    grid.set_splat(np.stack([beach, rocks, cliffs], axis=1), "RGB_AO")
    report_splat(grid, ("sand02", "rocks01", "cliffs01"))

    # 4. The AO: the cliff foot and the dune troughs
    select(grid.obj)
    bpy.ops.aek.bake_ao_to_splat(samples=64, distance=8.0)
    tpl.validate(grid.obj)

    # 6. The decals: two tyre tracks across the beach, above the waterline
    select(grid.obj)
    bpy.ops.aek.add_decal_set()
    decals = bpy.data.collections[f"{block_id}_decals"]
    left, right, track_path = add_track_pair(COAST_TRACK_PATH, COAST_TRACK_HALF_GAUGE)
    left.name, right.name, track_path.name = "tireTracksLeft", "tireTracksRight", "tireTracksPath"
    report_track_heights(grid, track_path)
    bpy.context.scene.cursor.location = (0.0, 0.0, 0.0)

    tpl.set_up_views((0, 0, 3), 110, README_COAST)
    tidy_images()
    tpl.save(path)
    export(grid.obj, [decals])
    return path, (0, 0, 3), 90


README_COAST = """
showcaseCoast: terrainShowcase's coast block (p310 §3.3)
Built by devTools/blender/buildShowcaseBlocks.py (change the script, not this file: it builds the block again). The steps are the plan's §3.3, the workflow docs/techniques/terrain-blocks-blender.md.
- 64 m / 129 at grid (0, 0), RGB + AO: sand01 (base), sand02 (R, along the waterline at 0.5 m), rocks01 (G, the cliff foot and three islands), cliffs01 (B, the cliff face).
- Shaped by two Displace modifiers (Clouds, Global) and a tilt toward the sea (Blend, Quadratic, through an empty), applied; the cliff band along the north edge (Sculpt, X and Y locked); AO baked (8 m, 64 samples).
- The decal set showcaseCoast_decals: two tyre tracks across the beach (Add Decal, tireTracks).
- Export Block and Export Decal Set write into this folder; the JSONs beside them are edited by hand.
"""


# --- showcaseAlpine (§3.4) -----------------------------------------------------------------------

ALPINE_LAYERS = ["grass01", "grass02", "rocks02", "cliffs02", "snow01", "snow02", "ice01"]
ALPINE_SPLAT_SIZE = 1024
#: The pond bowl: the engine's local (x, z), its radius and depth
ALPINE_POND = {"x": -14.0, "z": 24.0, "radius": 6.0, "depth": 0.6}
#: The rock band: its middle x, half its length, its face's height, the run its ends ramp out over
ALPINE_BAND = {"x": 4.0, "half": 13.0, "height": 8.0, "ends": 12.0}
#: The boulders' shapes: the toolkit's boulder scaled (Blender's x, y, z) and applied
ALPINE_BOULDERS = (("BoulderA", (1.0, 1.0, 1.0)), ("BoulderB", (0.8, 1.35, 1.4)),
                   ("BoulderC", (1.25, 0.9, 1.2)))
#: The ice cracks on the pond: the engine's local (x, z) and yaw in degrees
ALPINE_CRACKS = ((-15.5, 23.0, 20.0), (-12.0, 26.0, -55.0))


def alpine_band_face(x):
    """The rock band's face: the engine's local z, winding with x"""
    return -14.0 + 2.0 * np.sin(x / 6.0)


def alpine_band_extent(x):
    """1 along the band's length, fading out past its ends (where its ground ramps back up)"""
    distance = np.abs(x - ALPINE_BAND["x"])
    return smoothstep(ALPINE_BAND["half"] + ALPINE_BAND["ends"], ALPINE_BAND["half"], distance)


def alpine_weights(grid, slope, x, z):
    """The two splat maps' weights at the engine's local (x, z) (arrays of the map's texels):
    (splat0 RGBA, splat1 RGBA), each texel's sum at most 1
    """
    height = sample_grid(grid, grid.heights, x, z)
    steep = sample_grid(grid, slope, x, z)
    world_x, world_z = x + 2 * grid.size, z
    noise = fbm(world_x, world_z, 6.0, 3, 341)
    face = alpine_band_face(x)
    extent = alpine_band_extent(x)
    pond = np.hypot(x - ALPINE_POND["x"], z - ALPINE_POND["z"])
    # Convex crests and concave hollows: the heights' Laplacian, sampled
    h = grid.heights.reshape(grid.res, grid.res)
    laplacian = (np.roll(h, 1, 0) + np.roll(h, -1, 0) + np.roll(h, 1, 1) + np.roll(h, -1, 1) - 4 * h)
    curvature = sample_grid(grid, laplacian.ravel() / grid.spacing ** 2, x, z)

    ice = smoothstep(ALPINE_POND["radius"] - 0.7, ALPINE_POND["radius"] - 1.1, pond)
    cliffs = smoothstep(38.0, 50.0, steep) * smoothstep(3.5, 1.5, np.abs(z - face)) * extent
    scree = smoothstep(face - 10.0, face - 7.0, z) * smoothstep(face - 0.5, face - 2.0, z) * extent
    scree *= smoothstep(0.3, 0.55, noise) * (1 - cliffs)
    forest = smoothstep(0.52, 0.62, fbm(world_x, world_z, 14.0, 4, 342)) * smoothstep(9.0, 6.0, height)
    forest *= (1 - cliffs) * (1 - scree) * (1 - ice)
    high = np.percentile(grid.heights, 88)
    crest = smoothstep(high - 1.0, high + 1.0, height) * smoothstep(0.0, -0.08, curvature)
    crest *= (1 - cliffs)
    drifts = smoothstep(0.04, 0.12, curvature) * smoothstep(10.0, 13.0, height)
    drifts *= smoothstep(0.45, 0.6, noise) * (1 - cliffs) * (1 - crest)
    first = np.stack([forest, scree, cliffs, drifts], axis=-1)
    second = np.stack([crest, ice, np.zeros_like(ice), np.zeros_like(ice)], axis=-1)
    total = first.sum(axis=-1, keepdims=True) + second.sum(axis=-1, keepdims=True)
    scale = 1 / np.maximum(total, 1)
    return first * scale, second * scale


def import_boulders(location):
    """The `AlpineBoulders` collection: the toolkit's namaqualandBoulder02 in three shapes, each
    its scale applied, its origin at its base's centre (the model's), off the block
    """
    path = os.path.join(tpl.REPO_ROOT, "src", "toolkit", "models", "nature", "namaqualandBoulder02",
                        "namaqualandBoulder02.glb")
    collection = bpy.data.collections.new("AlpineBoulders")
    bpy.context.scene.collection.children.link(collection)
    bpy.ops.import_scene.gltf(filepath=path)
    source = bpy.context.selected_objects[0]
    for index, (name, scale) in enumerate(ALPINE_BOULDERS):
        boulder = source.copy()
        boulder.data = source.data.copy()
        boulder.name = boulder.data.name = name
        collection.objects.link(boulder)
        boulder.location = (0.0, 0.0, 0.0)
        boulder.rotation_euler = (0.0, 0.0, 0.0)
        boulder.scale = scale
        select(boulder)
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
        boulder.location = (location[0] + 4.0 * index, location[1], 0.0)
    mesh = source.data
    bpy.data.objects.remove(source)
    bpy.data.meshes.remove(mesh)
    return collection


def add_alpine_scatter(block, boulders, image):
    """The template's AekTerrainScatter group over the block, its Splat read swapped for the first
    splat map's G (the scree) at the UVs, on a scatter object at the block's place
    """
    tree = tpl.ScatterTree(block, boulders).build()
    tree.name = "AekTerrainScatterSplatMap"
    named = next(n for n in tree.nodes if n.type == "INPUT_ATTRIBUTE"
                 and n.inputs["Name"].default_value == "Splat")
    separate = named.outputs["Attribute"].links[0].to_node
    sample = tree.nodes.new("GeometryNodeImageTexture")
    sample.location = named.location
    sample.inputs["Image"].default_value = image
    sample.extension = "EXTEND"
    uv = tree.nodes.new("GeometryNodeInputNamedAttribute")
    uv.data_type = "FLOAT_VECTOR"
    uv.inputs["Name"].default_value = "UVMap"
    uv.location = (named.location.x - 200, named.location.y)
    tree.links.new(next(s for s in uv.outputs if s.enabled and s.name == "Attribute"),
                   sample.inputs["Vector"])
    tree.links.new(sample.outputs["Color"], separate.inputs["Color"])
    tree.nodes.remove(named)
    defaults = {"Distance Min": 2.5, "Density Max": 0.3, "Layer R": 0.0, "Layer G": 1.0,
                "Scale Min": 0.8, "Scale Max": 1.6, "Align": 0.5, "Sink": 0.3, "Seed": 342}
    for item in tree.interface.items_tree:
        if item.name in defaults:
            item.default_value = defaults[item.name]
    scatter = tpl.add_scatter_object("showcaseAlpineBoulders", tree)
    scatter.location = block.location
    bpy.context.view_layer.update()
    depsgraph = bpy.context.evaluated_depsgraph_get()
    count = sum(1 for i in depsgraph.object_instances
                if i.is_instance and i.parent and i.parent.original == scatter)
    progress(f"boulders: {count} instances")
    if count < 6:
        raise RuntimeError(f"The boulder scatter made {count} instances")
    return scatter


def export_alpine_scatter(block, scatter, boulders, folder):
    """The scatter's GLB with GPU instances (the handbook's settings), the block and the scatter
    object moved to the origin for it (the engine places the file's root at the block's centre)
    """
    place = block.location.copy()
    block.location = scatter.location = (0.0, 0.0, 0.0)
    bpy.context.view_layer.update()
    for obj in bpy.context.selected_objects:
        obj.select_set(False)
    for obj in (scatter, *boulders.objects):
        obj.select_set(True)
    bpy.context.view_layer.objects.active = scatter
    path = os.path.join(folder, "showcaseAlpine_scatter.glb")
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True,
                              export_extras=True, export_yup=True, export_apply=True,
                              export_texcoords=True, export_normals=True, export_tangents=False,
                              export_materials="NONE", export_gpu_instances=True,
                              export_gn_mesh=True, export_draco_mesh_compression_enable=False)
    block.location = scatter.location = place
    gltf = aek.read_glb_json(path)
    instanced = [n.get("name") for n in gltf.get("nodes", [])
                 if "EXT_mesh_gpu_instancing" in n.get("extensions", {})]
    progress(f"exported showcaseAlpine_scatter.glb: {os.path.getsize(path) / 1e3:.0f} kB, GPU "
             f"instanced nodes {instanced}")


def build_alpine():
    block_id = "showcaseAlpine"
    path = open_template(block_id)
    folder = os.path.dirname(path)
    grid = tpl.add_block(block_id, grid_x=2, layout="RGBA")
    set_preview_layers(ALPINE_LAYERS, "RGBA")
    origin = grid.obj.location.copy()

    # 1. Shape: one ridge rising toward +x (a large Clouds and a Blend ramp, both faded out over
    # the south part by the vertex group `Ridge`: a slope of about 28 m down to a flat part for
    # the pond), smaller relief everywhere (less on the flat part: its own group `Relief`)
    ridge_weight = smoothstep(26.0, -2.0, grid.z)
    add_vertex_group(grid.obj, "Ridge", ridge_weight)
    add_vertex_group(grid.obj, "Relief", 0.3 + 0.7 * ridge_weight)
    ridge = clouds("showcaseAlpine ridge", 40.0)
    ridge.contrast = 1.4
    add_displace(grid.obj, "Ridge", ridge, 18.0).vertex_group = "Ridge"
    ramp_space = add_ramp_space("showcaseAlpine ramp", origin)
    ramp = bpy.data.textures.new("showcaseAlpine ramp", "BLEND")
    add_displace(grid.obj, "Ramp", ramp, 8.0, coords="OBJECT",
                 coords_object=ramp_space).vertex_group = "Ridge"
    add_displace(grid.obj, "Relief", clouds("showcaseAlpine relief", 8.0), 2.0).vertex_group = "Relief"
    apply_modifiers(grid.obj)
    bpy.data.objects.remove(ramp_space)
    for name in ("Ridge", "Relief"):
        grid.obj.vertex_groups.remove(grid.obj.vertex_groups[name])
    heights = read_heights(grid)
    report_heights(grid, "shaped")

    # Sculpt (X and Y locked): the rock band, a scarp: the ground north of it lowered 8 m over 4 m
    # of run (the face looks north, -z) to the north edge, ramping back up past the band's ends;
    # the pond bowl, flat-bottomed, its rim sharp
    face = alpine_band_face(grid.x)
    carve = 1 - smoothstep(face - 2.0, face + 2.0, grid.z)
    heights = heights - ALPINE_BAND["height"] * carve * alpine_band_extent(grid.x)
    pond = np.hypot(grid.x - ALPINE_POND["x"], grid.z - ALPINE_POND["z"])
    bowl = smoothstep(ALPINE_POND["radius"] + 0.2, ALPINE_POND["radius"] - 1.2, pond)
    heights = heights - ALPINE_POND["depth"] * bowl
    grid.set_heights(heights)
    slope = grid.slope()
    report_heights(grid, "sculpted")
    on_face = (np.abs(grid.z - face) < 1.5) & (alpine_band_extent(grid.x) > 0.9)
    progress(f"rock band: {np.mean(slope[on_face]):.0f}° mean on its face, "
             f"{slope[on_face].max():.0f}° at its steepest; over 18 m: "
             f"{np.mean(heights > 18) * 100:.0f} % of the block")

    # 3. The splat maps (Texture Paint, pure colours, a channel a layer)
    texel = (np.arange(ALPINE_SPLAT_SIZE) + 0.5) / ALPINE_SPLAT_SIZE * grid.size - grid.size / 2
    x, z = np.meshgrid(texel, texel)
    first, second = alpine_weights(grid, slope, x, z)
    splat0 = paint_splat_map(grid.obj, 0, ALPINE_SPLAT_SIZE, first, folder)
    paint_splat_map(grid.obj, 1, ALPINE_SPLAT_SIZE, second, folder)
    tpl.validate(grid.obj)

    # 5. The boulders: the template's scatter group over the scree, as GPU instances
    boulders = import_boulders((origin.x - 40.0, origin.y + 10.0))
    scatter = add_alpine_scatter(grid.obj, boulders, splat0)

    # 6. The decals: two ice cracks on the pond
    select(grid.obj)
    bpy.ops.aek.add_decal_set()
    decals = bpy.data.collections[f"{block_id}_decals"]
    for local_x, local_z, yaw in ALPINE_CRACKS:
        bpy.context.scene.cursor.location = (origin.x + local_x, origin.y - local_z, 0.0)
        result = bpy.ops.aek.add_decal(cell="iceCrack", strip="QUAD")
        if result != {"FINISHED"}:
            raise RuntimeError(f"Add Decal iceCrack: {result}")
        bpy.context.active_object.rotation_euler.z = math.radians(yaw)
    bpy.context.scene.cursor.location = (0.0, 0.0, 0.0)

    target = (origin.x, origin.y, 8.0)
    tpl.set_up_views(target, 120, README_ALPINE)
    tidy_images()
    tpl.save(path)
    export(grid.obj, [decals])
    export_alpine_scatter(grid.obj, scatter, boulders, folder)
    return path, target, 95


README_ALPINE = """
showcaseAlpine: terrainShowcase's alpine block (p310 §3.4)
Built by devTools/blender/buildShowcaseBlocks.py (change the script, not this file: it builds the block again). The steps are the plan's §3.4, the workflow docs/techniques/terrain-blocks-blender.md and terrain-splat-map.md.
- 64 m / 129 at grid (2, 0), RGBA, painted in two splat maps (New Splat Map, Layers 1-4 and 5-8): grass01 (base); showcaseAlpine_splat0: grass02 (R, forest floor), rocks02 (G, scree under the rock band), cliffs02 (B, the rock band), snow01 (A, drifts in hollows); showcaseAlpine_splat1: snow02 (R, the wind-swept crest), ice01 (G, the pond). No vertex AO.
- Shaped by Displace modifiers (a large Clouds and a Blend ramp toward +x, faded over the flat south part by vertex groups; smaller Clouds relief), applied; the rock band and the pond bowl sculpted (X and Y locked).
- The boulders: showcaseAlpineBoulders, the template's AekTerrainScatter group (its Splat read swapped for the first splat map's G at the UVs) over AlpineBoulders (the toolkit's namaqualandBoulder02 in three shapes). Export it with GPU instances, the block and the scatter object moved to the origin first (showcaseAlpine_scatter.glb).
- The decal set showcaseAlpine_decals: two ice cracks on the pond (Add Decal, iceCrack).
"""


# --- showcaseWetlands (§3.5) ---------------------------------------------------------------------

WETLANDS_LAYERS = ["mud01", "mud02", "grass02", "rocks01"]
#: The hollows for puddles: the engine's local (x, z, radius)
WETLANDS_HOLLOWS = ((-16.0, -12.0, 3.0), (-11.0, 17.0, 3.5))
#: The pad flattened for the bunker (§3.6): its middle (the engine's local x, z) and its size
WETLANDS_PAD = {"x": 15.0, "z": -15.0, "width": 18.0, "depth": 12.0}
#: The mud splatters: the engine's local (x, z) and yaw in degrees, on the channel's banks
WETLANDS_SPLATTERS = ((4.0, -24.0, 30.0), (-6.0, 9.0, -60.0), (9.0, 22.0, 110.0))
WETLANDS_TRACK_HALF_GAUGE = 0.85
#: The regional wetness's group and the Geometry Nodes group writing `_WETNESS` from it
WET_GROUP = "Wet"
WETNESS_TREE = "AEK Wetness"


def wetlands_channel(z):
    """The channel's middle: the engine's local x, meandering along z (north to south)"""
    return 2.0 + 6.0 * np.sin(z / 9.0) + 2.0 * np.sin(z / 4.3)


def wetlands_path(x):
    """The gravel path's middle: the engine's local z, winding along x (west to east)"""
    return 4.0 + 3.0 * np.sin(x / 14.0)


def add_wetness_modifier(obj):
    """The Geometry Nodes modifier writing the float point attribute `_WETNESS` from the vertex
    group `Wet` (Store Named Attribute of a Named Attribute), last in the stack: the topology kept,
    so Validate accepts it, and Export applies it
    """
    tree = bpy.data.node_groups.new(WETNESS_TREE, "GeometryNodeTree")
    tree.interface.new_socket("Geometry", in_out="INPUT", socket_type="NodeSocketGeometry")
    tree.interface.new_socket("Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")
    group_in = tree.nodes.new("NodeGroupInput")
    group_out = tree.nodes.new("NodeGroupOutput")
    group_out.location = (600, 0)
    weight = tree.nodes.new("GeometryNodeInputNamedAttribute")
    weight.data_type = "FLOAT"
    weight.inputs["Name"].default_value = WET_GROUP
    weight.location = (0, -200)
    store = tree.nodes.new("GeometryNodeStoreNamedAttribute")
    store.data_type = "FLOAT"
    store.domain = "POINT"
    store.inputs["Name"].default_value = "_WETNESS"
    store.location = (300, 0)
    tree.links.new(group_in.outputs["Geometry"], store.inputs["Geometry"])
    tree.links.new(next(s for s in weight.outputs if s.enabled and s.name == "Attribute"),
                   next(s for s in store.inputs if s.enabled and s.name == "Value"))
    tree.links.new(store.outputs["Geometry"], group_out.inputs["Geometry"])
    obj.modifiers.new(WETNESS_TREE, "NODES").node_group = tree


def report_wetness(obj):
    """`_WETNESS` as the export sees it (the evaluated mesh: the modifier applied)"""
    bpy.context.view_layer.update()
    evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = evaluated.to_mesh()
    attribute = mesh.attributes.get("_WETNESS")
    if attribute is None or attribute.domain != "POINT" or attribute.data_type != "FLOAT":
        raise RuntimeError("No float point attribute _WETNESS on the evaluated block")
    values = np.empty(len(mesh.vertices))
    attribute.data.foreach_get("value", values)
    evaluated.to_mesh_clear()
    progress(f"_WETNESS: {np.mean(values > 0.5) * 100:.0f} % of the vertices over 0.5, "
             f"{np.mean(values > 0.01) * 100:.0f} % over 0")


def build_wetlands():
    block_id = "showcaseWetlands"
    path = open_template(block_id)
    grid = tpl.add_block(block_id, grid_z=2)
    tpl.set_preview(WETLANDS_LAYERS)
    origin = grid.obj.location.copy()

    # 1. Shape: almost flat, then the channel (0.3-0.5 m deep, 2-3 m wide), two hollows and the
    # bunker's pad sculpted (X and Y locked; the pad with the Flatten brush)
    add_displace(grid.obj, "Swells", clouds("showcaseWetlands swells", 25.0), 0.8)
    add_displace(grid.obj, "Bumps", clouds("showcaseWetlands bumps", 5.0), 0.15)
    apply_modifiers(grid.obj)
    heights = read_heights(grid)
    channel = np.abs(grid.x - wetlands_channel(grid.z))
    half_width = 1.25 + 0.25 * np.sin(grid.z / 7.0)
    depth = 0.4 + 0.1 * np.sin(grid.z / 5.0 + 1.0)
    heights = heights - depth * smoothstep(half_width + 0.6, half_width - 0.4, channel)
    hollows = [np.hypot(grid.x - x, grid.z - z) for x, z, _ in WETLANDS_HOLLOWS]
    for distance, (_, _, radius) in zip(hollows, WETLANDS_HOLLOWS):
        heights = heights - 0.25 * smoothstep(radius, radius * 0.3, distance)
    pad = WETLANDS_PAD
    on_pad = (smoothstep(pad["width"] / 2 + 3.0, pad["width"] / 2, np.abs(grid.x - pad["x"]))
              * smoothstep(pad["depth"] / 2 + 3.0, pad["depth"] / 2, np.abs(grid.z - pad["z"])))
    pad_height = float(np.mean(heights[on_pad > 0.99])) + 0.05
    heights = heights + (pad_height - heights) * on_pad
    grid.set_heights(heights)
    report_heights(grid, "sculpted")
    progress(f"the bunker's pad at {pad_height:.2f} m")

    # 2. The splat: R mud02 in the channel, on its banks and in the hollows, G grass02 on the
    # raised ground, B rocks01 on the path crossing the channel (a ford) and on the pad
    noise = fbm(grid.world_x, grid.world_z, 4.0, 3, 351)
    path_distance = np.abs(grid.z - wetlands_path(grid.x))
    gravel = np.maximum(smoothstep(1.5, 0.9, path_distance + 0.3 * (noise - 0.5)), on_pad)
    mud = smoothstep(4.5, 1.8, channel + 1.5 * (noise - 0.5))
    for distance, (_, _, radius) in zip(hollows, WETLANDS_HOLLOWS):
        mud = np.maximum(mud, smoothstep(radius + 1.5, radius, distance))
    mud *= 1 - gravel
    median = float(np.median(heights))
    grass = smoothstep(median - 0.05, median + 0.2, heights + 0.3 * (noise - 0.5))
    grass *= (1 - mud) * (1 - gravel)
    grid.set_splat(np.stack([mud, grass, gravel], axis=1), "RGB_AO")
    report_splat(grid, ("mud02", "grass02", "rocks01"))

    # 3. The AO (4 m: the channel and the hollows)
    select(grid.obj)
    bpy.ops.aek.bake_ao_to_splat(samples=64, distance=4.0)

    # 4. The regional wetness: the vertex group `Wet` (Weight Paint: 1 in and by the channel and the
    # hollows, blurred over a few metres), copied into `_WETNESS` by a Geometry Nodes modifier
    wet = smoothstep(6.0, 1.5, channel)
    for distance, (_, _, radius) in zip(hollows, WETLANDS_HOLLOWS):
        wet = np.maximum(wet, smoothstep(radius + 2.5, radius, distance))
    add_vertex_group(grid.obj, WET_GROUP, wet)
    add_wetness_modifier(grid.obj)
    report_wetness(grid.obj)
    tpl.validate(grid.obj, allowed=("modifiers",))

    # 5. The decals: tyre ruts along the path through the ford, three mud splatters on the banks
    select(grid.obj)
    bpy.ops.aek.add_decal_set()
    decals = bpy.data.collections[f"{block_id}_decals"]
    track_points = [(float(x), -float(wetlands_path(x))) for x in (-30.0, -15.0, 0.0, 15.0, 30.0)]
    left, right, track_path = add_track_pair(track_points, WETLANDS_TRACK_HALF_GAUGE,
                                             origin=tuple(origin))
    left.name, right.name, track_path.name = "rutsLeft", "rutsRight", "rutsPath"
    for local_x, local_z, yaw in WETLANDS_SPLATTERS:
        bpy.context.scene.cursor.location = (origin.x + local_x, origin.y - local_z, 0.0)
        result = bpy.ops.aek.add_decal(cell="mudSplatter", strip="QUAD")
        if result != {"FINISHED"}:
            raise RuntimeError(f"Add Decal mudSplatter: {result}")
        bpy.context.active_object.rotation_euler.z = math.radians(yaw)
    bpy.context.scene.cursor.location = (0.0, 0.0, 0.0)

    target = (origin.x, origin.y, 0.5)
    tpl.set_up_views(target, 100, README_WETLANDS)
    tidy_images()
    tpl.save(path)
    export(grid.obj, [decals])
    return path, target, 80


README_WETLANDS = """
showcaseWetlands: terrainShowcase's wetlands block (p310 §3.5)
Built by devTools/blender/buildShowcaseBlocks.py (change the script, not this file: it builds the block again). The steps are the plan's §3.5, the workflow docs/techniques/terrain-blocks-blender.md and wet-dry-surfaces.md.
- 64 m / 129 at grid (0, 2), RGB + AO: mud01 (base), mud02 (R, the channel, its banks and the hollows), grass02 (G, the raised ground), rocks01 (B, the path across the channel and the bunker's pad).
- Shaped by two Displace modifiers (Clouds, Global), applied; the channel, two hollows and the bunker's pad sculpted (X and Y locked); AO baked (4 m, 64 samples).
- The regional wetness: the vertex group Wet (Weight Paint) copied into the float point attribute _WETNESS by the Geometry Nodes modifier "AEK Wetness", kept last: Export applies it and exports the attribute.
- The decal set showcaseWetlands_decals: tyre ruts along the path through the ford (Add Decal, tireTracks: its puddle mask fills in the rain) and three mud splatters (mudSplatter).
"""


# --- showcaseBunker (§3.6) -----------------------------------------------------------------------

STRUCTURE_TEMPLATE = os.path.join(tpl.FOLDER, "structure_concrete.blend")
#: The bunker: its size (Blender's x, y, z), its walls' and roof's thickness, its doorway
BUNKER = {"width": 6.0, "depth": 4.0, "height": 2.6, "wall": 0.4, "door": 1.0, "doorHeight": 2.0}
#: The wall segment: its length, thickness and height, and its place (Blender's x, y) from the
#: bunker's origin: behind it and to its side, on the wetlands' pad
WALL = {"length": 12.0, "thickness": 0.4, "height": 2.5, "x": 5.0, "y": 4.5}
#: The leak decals: a cell of decalsStructure each, at x along the front wall, under the roof edge
BUNKER_LEAKS = (("leak01", -1.8), ("leak03", 1.9))
#: How far the leaks lie off the wall (the engine's polygon offset does the rest)
LEAK_OFFSET = 0.01


def open_structure_template(folder, name):
    """The structure template saved as `<name>.blend` in `folder`, its pieces and README dropped
    (its preview materials kept)
    """
    os.makedirs(folder, exist_ok=True)
    bpy.ops.wm.open_mainfile(filepath=STRUCTURE_TEMPLATE)
    bpy.context.preferences.filepaths.save_version = 0
    for obj in list(bpy.data.objects):
        mesh = obj.data
        bpy.data.objects.remove(obj)
        if isinstance(mesh, bpy.types.Mesh) and mesh.users == 0:
            bpy.data.meshes.remove(mesh)
    readme = bpy.data.texts.get("README")
    if readme is not None:
        bpy.data.texts.remove(readme)
    path = os.path.join(folder, name + ".blend")
    bpy.ops.wm.save_as_mainfile(filepath=path, compress=True, relative_remap=True)
    return path


def join_pieces(name, pieces):
    """The pieces joined into one object named `name` (its origin the first piece's)"""
    for obj in bpy.context.selected_objects:
        obj.select_set(False)
    for piece in pieces:
        piece.select_set(True)
    bpy.context.view_layer.objects.active = pieces[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    obj.name = obj.data.name = name
    return obj


def bevel(obj):
    """Bevel 0.03 m, 2 segments, the sharp edges only (the wear's cuts are flat), applied"""
    modifier = obj.modifiers.new("Bevel", "BEVEL")
    modifier.width = 0.03
    modifier.segments = 2
    modifier.limit_method = "ANGLE"
    apply_modifiers(obj)
    for polygon in obj.data.polygons:
        polygon.use_smooth = False


def build_bunker_mesh():
    """The bunker from extruded profiles (the template's `extrude_piece`, cut every 0.35 m), its
    origin at its bottom centre, its doorway toward Blender's -y (the engine's +z)
    """
    b = BUNKER
    half_w, half_d, wall, inner = b["width"] / 2, b["depth"] / 2, b["wall"], b["height"] - b["wall"]
    door = b["door"] / 2
    front = tpl.extrude_piece("bunkerFront", [(-half_w, 0), (-door, 0), (-door, b["doorHeight"]),
                                              (door, b["doorHeight"]), (door, 0), (half_w, 0),
                                              (half_w, inner), (-half_w, inner)], wall)
    front.location.y = -half_d + wall / 2
    back = tpl.extrude_piece("bunkerBack", [(-half_w, 0), (half_w, 0), (half_w, inner),
                                            (-half_w, inner)], wall)
    back.location.y = half_d - wall / 2
    sides = []
    for side in (-1, 1):
        piece = tpl.extrude_piece(f"bunkerSide{side}", [(-wall / 2, 0), (wall / 2, 0),
                                                       (wall / 2, inner), (-wall / 2, inner)],
                                  b["depth"] - 2 * wall)
        piece.location.x = side * (half_w - wall / 2)
        sides.append(piece)
    roof = tpl.extrude_piece("bunkerRoof", [(-half_w, inner), (half_w, inner),
                                            (half_w, b["height"]), (-half_w, b["height"])],
                             b["depth"])
    obj = join_pieces("showcaseBunker", [front, back, *sides, roof])
    bevel(obj)
    return obj


def build_wall_mesh():
    w = WALL
    piece = tpl.extrude_piece("showcaseBunkerWall", [(-w["length"] / 2, 0), (w["length"] / 2, 0),
                                                     (w["length"] / 2, w["height"]),
                                                     (-w["length"] / 2, w["height"])],
                              w["thickness"])
    obj = join_pieces("showcaseBunkerWall", [piece])
    bevel(obj)
    obj.location = (w["x"], w["y"], 0.0)
    return obj


def read_dirt(obj):
    """Dirty Vertex Colors' greyscale per vertex (brighter on convex edges, darker in crevices),
    from a scratch colour attribute it paints and is then removed
    """
    mesh = obj.data
    dirt = mesh.color_attributes.new("Dirt", "BYTE_COLOR", "POINT")
    mesh.color_attributes.active_color = dirt
    select(obj)
    bpy.ops.object.mode_set(mode="VERTEX_PAINT")
    bpy.ops.paint.vertex_color_dirt(blur_strength=1.0, blur_iterations=1, clean_angle=3.14159,
                                    dirt_angle=0.0, dirt_only=False, normalize=True)
    bpy.ops.object.mode_set(mode="OBJECT")
    colors = np.empty(len(mesh.vertices) * 4)
    dirt.data.foreach_get("color", colors)
    mesh.color_attributes.remove(mesh.color_attributes["Dirt"])
    return colors.reshape(-1, 4)[:, 0]


def paint_bunker_wear(obj, seed):
    """`Wear` (byte, vertex): R the damaged corners and edges (Dirty Vertex Colors' highlights,
    broken up), G stains running down from the roof edge and grime at the foot, B a few chips;
    the base is clean concrete
    """
    mesh = obj.data
    count = len(mesh.vertices)
    dirt = read_dirt(obj)
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
    # The highlights (the convex edges) are the brightest tenth (the colour reads back linear)
    damage = smoothstep(*np.percentile(dirt, [88, 96]), dirt)
    damage *= smoothstep(0.35, 0.6, tpl.value_noise(along, world[:, 2], 0.7, seed))
    streaks = smoothstep(0.45, 0.75, tpl.value_noise(along, np.zeros(count), 0.45, seed + 1))
    run = smoothstep(top - 2.2, top - 0.3, co[:, 2]) * (0.4 + 0.6 * tpl.value_noise(along, world[:, 2], 3.0, seed + 2))
    grime = smoothstep(0.7, 0.05, co[:, 2]) * (0.5 + 0.5 * tpl.value_noise(along, world[:, 2], 1.2, seed + 3))
    # Partial weights (the height blend sharpens them): stains, not the mud replacing the concrete
    stains = 0.75 * np.maximum(streaks * run * vertical, 0.85 * grime)
    chips = smoothstep(0.78, 0.84, fbm(along, world[:, 2], 1.5, 2, seed + 4)) * vertical
    weights = np.stack([0.8 * damage, stains, 0.7 * chips], axis=1)
    weights /= np.maximum(weights.sum(axis=1, keepdims=True), 1)
    wear = mesh.color_attributes.new("Wear", "BYTE_COLOR", "POINT")
    colors = np.ones((count, 4))
    colors[:, :3] = weights
    colors[:, 3] = 0.0
    wear.data.foreach_set("color", colors.ravel())
    mesh.color_attributes.active_color = wear
    mesh.color_attributes.render_color_index = mesh.color_attributes.active_color_index
    shares = {name: f"{np.mean(weights[:, i] > 0.25) * 100:.0f} %"
              for i, name in enumerate(("damage", "stains", "chips"))}
    progress(f"{obj.name} wear over 0.25: {shares}")


def add_box_collider(parent, name, centre, size, index, body=False):
    """A box collider node under `parent` (a collider only: no keepMesh; drawn as a wire in
    Blender): a cube scaled to the box (its sizes from its geometry and scale), centred at
    `centre` (Blender's, in the parent's space); `body` carries the group's FIXED body
    """
    mesh = bpy.data.meshes.new(name)
    corners = [(x, y, z) for x in (-1, 1) for y in (-1, 1) for z in (-1, 1)]
    faces = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    mesh.from_pydata(corners, [], faces)
    box = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(box)
    box.parent = parent
    box.location = centre
    box.scale = (size[0] / 2, size[1] / 2, size[2] / 2)
    box.display_type = "WIRE"
    box.hide_render = True
    box["isPhysObj"] = 1
    box["colliderType"] = "CUBOID"
    box["index"] = index
    if body:
        box["rigidType"] = "FIXED"
    return box


def add_bunker_colliders(bunker, wall):
    """The bunker's walls and roof as boxes (one FIXED compound body, index 0; the doorway open),
    the wall segment's (index 1)
    """
    b = BUNKER
    half_w, half_d, wall_t = b["width"] / 2, b["depth"] / 2, b["wall"]
    inner = b["height"] - wall_t
    side_w = half_w - b["door"] / 2
    boxes = [
        ("roof", (0, 0, inner + wall_t / 2), (b["width"], b["depth"], wall_t)),
        ("back", (0, half_d - wall_t / 2, inner / 2), (b["width"], wall_t, inner)),
        ("left", (-half_w + wall_t / 2, 0, inner / 2), (wall_t, b["depth"] - 2 * wall_t, inner)),
        ("right", (half_w - wall_t / 2, 0, inner / 2), (wall_t, b["depth"] - 2 * wall_t, inner)),
        ("frontLeft", (-half_w + side_w / 2, -half_d + wall_t / 2, inner / 2), (side_w, wall_t, inner)),
        ("frontRight", (half_w - side_w / 2, -half_d + wall_t / 2, inner / 2), (side_w, wall_t, inner)),
        ("lintel", (0, -half_d + wall_t / 2, (b["doorHeight"] + inner) / 2),
         (b["door"], wall_t, inner - b["doorHeight"])),
    ]
    colliders = [add_box_collider(bunker, f"showcaseBunkerCollider_{name}", centre, size, 0,
                                  body=index == 0)
                 for index, (name, centre, size) in enumerate(boxes)]
    w = WALL
    colliders.append(add_box_collider(wall, "showcaseBunkerWallCollider", (0, 0, w["height"] / 2),
                                      (w["length"], w["thickness"], w["height"]), 1, body=True))
    return colliders


def add_bunker_leaks():
    """The leaks: a quad of a decalsStructure cell each at its physicalSize (the add-on's decal
    mesh: UVMap in the cell, DecalUV 0..1), stood up on the front wall's face under the roof edge,
    `LEAK_OFFSET` off it, in the collection `showcaseBunker_leaks`
    """
    atlas = aek.get_decal_atlases(tpl.REPO_ROOT, refresh=True)["decalsStructure"]
    collection = bpy.data.collections.new("showcaseBunker_leaks")
    bpy.context.scene.collection.children.link(collection)
    leaks = []
    for cell_id, x in BUNKER_LEAKS:
        cell = atlas["cells"][cell_id]
        width, height = cell["size"]
        mesh = aek.build_decal_mesh(cell_id, cell["uv"], width, height, False)
        mesh.materials.append(aek.ensure_decal_preview_material())
        leak = bpy.data.objects.new(f"{cell_id}Front", mesh)
        collection.objects.link(leak)
        # The quad's +y (the cell's top) up, its face toward -y (the doorway's side)
        leak.rotation_euler.x = math.pi / 2
        leak.location = (x, -BUNKER["depth"] / 2 - LEAK_OFFSET, BUNKER["height"] - height / 2)
        leaks.append(leak)
    return collection, leaks


def export_selected(path, objects, settings):
    for obj in bpy.context.selected_objects:
        obj.select_set(False)
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    result = bpy.ops.export_scene.gltf(filepath=path, **settings)
    if result != {"FINISHED"}:
        raise RuntimeError(f"Export {path}: {result}")
    gltf = aek.read_glb_json(path)
    nodes = [(n.get("name"), sorted(n.get("extras", {}))) for n in gltf.get("nodes", [])]
    progress(f"exported {os.path.basename(path)}: {os.path.getsize(path) / 1e3:.0f} kB, nodes {nodes}")
    return gltf


def build_bunker():
    folder = os.path.join(BLOCKS_FOLDER, "showcaseWetlands")
    path = open_structure_template(folder, "showcaseBunker")
    world_preview = bpy.data.materials["AEK Structure Preview (World)"]

    # 2. Model: the bunker and the wall segment, bevelled; no UVs (triplanar)
    bunker = build_bunker_mesh()
    wall = build_wall_mesh()
    for obj in (bunker, wall):
        obj.data.materials.append(world_preview)
        for layer in list(obj.data.uv_layers):
            obj.data.uv_layers.remove(layer)

    # 3. Wear (Dirty Vertex Colors as the damage's start, then the stains, grime and chips)
    paint_bunker_wear(bunker, 361)
    paint_bunker_wear(wall, 362)

    # 4.-5. The leaks and the colliders
    _, leaks = add_bunker_leaks()
    colliders = add_bunker_colliders(bunker, wall)

    tpl.set_up_views((1.5, 1.5, 1.3), 22, README_BUNKER, yaw=20)
    tidy_images()
    tpl.save(path)

    # 6. Export by hand: the structure's settings (the add-on's locked ones without UVs), and the
    # leaks with the decal sets' (two UV maps, no colours)
    export_selected(os.path.join(folder, "showcaseBunker.glb"), [bunker, wall, *colliders],
                    {**aek.LOCKED_EXPORT_SETTINGS, "export_texcoords": False})
    gltf = export_selected(os.path.join(folder, "showcaseBunker_leaks.glb"), leaks,
                           aek.DECAL_EXPORT_SETTINGS)
    issues = aek.check_exported_decal_glb(gltf, [leak.name for leak in leaks])
    if issues:
        raise RuntimeError(f"The leaks' GLB: {issues}")
    return path, (1.5, -1.5, 1.3), 16, 20


README_BUNKER = """
showcaseBunker: terrainShowcase's bunker on the wetlands' pad (p310 §3.6)
Built by devTools/blender/buildShowcaseBlocks.py (change the script, not this file: it builds it again). The steps are the plan's §3.6, the workflow docs/techniques/structure-materials.md.
- From structure_concrete.blend: the bunker (6 x 4 x 2.6 m, walls 0.4 m, a doorway toward -Y: the engine's +z) and a 12 m wall segment, cut every 0.35 m for the wear, bevelled (0.03 m, 2 segments, applied), no UVs (the structure material is triplanar). Origins at their bottom centre.
- Wear (byte colour, vertex, active): concrete01 the base, concrete02 (R, the damaged edges: Dirty Vertex Colors as a start), mud01 (G, stains running down from the roof edge, grime at the foot), rocks02 (B, chips).
- Colliders: wire boxes under each piece (custom props isPhysObj, colliderType CUBOID, index; the first of each index rigidType FIXED), colliders only.
- Leaks: two quads of decalsStructure's leak cells (UVMap in the cell, DecalUV 0..1) on the front wall under the roof edge, 1 cm off it (collection showcaseBunker_leaks).
- Export by hand: the bunker, the wall and their boxes (showcaseBunker.glb: Selected, +Y up, Apply Modifiers, no UVs, Normals, the active colour, Custom Properties, no materials or compression); the leaks (showcaseBunker_leaks.glb, the decal sets' settings), both in the bunker's space.
"""


BLOCKS = {
    "showcaseCoast": build_coast,
    "showcaseAlpine": build_alpine,
    "showcaseWetlands": build_wetlands,
    "showcaseBunker": build_bunker,
}


def main():
    unknown = tpl.ONLY - set(BLOCKS)
    if unknown:
        raise RuntimeError(f"No block {sorted(unknown)}: {sorted(BLOCKS)}")
    aek.register()
    try:
        for name, build in BLOCKS.items():
            if tpl.ONLY and name not in tpl.ONLY:
                continue
            path, target, distance, *yaw = build()
            # Export saved nothing into the file; render from it as saved
            tpl.render(name, target, distance, *yaw)
            progress(f"built {os.path.relpath(path, tpl.REPO_ROOT)}")
    finally:
        aek.unregister()


main()
