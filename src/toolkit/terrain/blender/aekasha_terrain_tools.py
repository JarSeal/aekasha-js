"""Ækasha Terrain Tools: a Blender add-on for Ækasha terrain blocks.

A terrain block is a square heightfield grid that the engine spawns from a `*.terrainBlock.json`
(the `terrain()` feature, `aekasha/terrain`). This add-on makes one that follows the block
conventions (docs/plans/_DONE_p306_terrain-blocks-and-procedural-terrain-meshes.md D1; the
handbook's docs/techniques/terrain-blocks-blender.md), lets you paint and bake its splat, checks
it and exports it with the locked glTF settings (D5). Its decal sets (p309 D3): decals of a decal
atlas's cells, quads or strips along a path, shrinkwrapped onto the block and exported as one GLB
in its space (the `*.decalSet.json` its `decals` names).

Install: Edit → Preferences → Add-ons → the drop-down → Install from Disk, then pick this file
(a legacy add-on: one `.py`, so it installs straight from the repo). Checked with Blender 5.3.

- One file on purpose: Install from Disk takes a single `.py`, and an artist copies one file. So
  it runs past the repo's ~800 lines a file; its sections are marked `# ---`.
- Coordinates: the engine's (x, y, z) is Blender's (x, -z, y), its +y up. The grid's rows run along
  the engine's +z (Blender's -y), its columns along +x; vertex `row * res + col`, the order
  `generateTerrain` uses.
- The block's own settings (size, resolution, grid place, layout) are `bpy.props` on the object;
  the custom props the engine reads (D1: the collider, the block's metadata) are plain ID
  properties written from them, which the exporter puts in the node's glTF `extras`.
"""

import json
import os
import re
import struct
import zlib

import bpy
import numpy as np
from bpy.props import (
    BoolProperty,
    EnumProperty,
    FloatProperty,
    IntProperty,
    PointerProperty,
    StringProperty,
)

bl_info = {
    "name": "Ækasha Terrain Tools",
    "author": "Ækasha",
    "version": (1, 1, 0),
    "blender": (5, 3, 0),
    "location": "3D Viewport → Sidebar → Ækasha",
    "description": "Terrain blocks for Ækasha: add, paint, bake, validate and export; their decal "
    "sets",
    "category": "Object",
}

# --- Conventions (D1) --------------------------------------------------------------------------

#: The block edge lengths, metres
BLOCK_SIZES = (32, 64, 128, 256)
#: The vertices per side: 2^n + 1
BLOCK_RESOLUTIONS = (33, 65, 129, 257, 513)
#: The colour attribute the splat lives in (exported as `COLOR_0`)
SPLAT_ATTRIBUTE = "Splat"
#: The preview material Add assigns, and the node group it draws with (the scene's layers)
PREVIEW_MATERIAL = "AEK Terrain Preview"
PREVIEW_GROUP = "AEK Terrain Preview"

SIZE_ITEMS = [(str(s), f"{s} m", f"{s} × {s} m") for s in BLOCK_SIZES]
RESOLUTION_ITEMS = [
    (str(r), str(r), f"{r} × {r} vertices, {64 / (r - 1):g} m apart on a 64 m block")
    for r in BLOCK_RESOLUTIONS
]
#: The splat's channel layouts (p305 D4); the base layer takes what the channels leave
LAYOUT_ITEMS = [
    ("RGB_AO", "RGB + AO", "RGB weigh layers 1-3, A is the baked ambient occlusion"),
    ("RGBA", "RGBA", "RGBA weigh layers 1-4, no baked AO"),
]
#: The block's collider (the terrainBlock JSON's `collider.type`)
COLLIDER_ITEMS = [
    ("HEIGHTFIELD", "Heightfield", "Read from the regular grid: the vertices move in height only"),
    ("TRIMESH", "Trimesh", "The triangles themselves: overhangs and caves (vertices moved in X/Z "
     "or added), costlier; the grid, UV and edge checks are skipped"),
    ("NONE", "None", "No collider: a background block"),
]

_BLOCK_ID = re.compile(r"^[A-Za-z][A-Za-z0-9_-]*$")


def is_block_id(block_id: str) -> bool:
    """Whether `block_id` can name the block's asset files: a letter, then letters, digits, `_`
    or `-`
    """
    return bool(_BLOCK_ID.match(block_id))


def is_block_resolution(resolution: int) -> bool:
    """Whether `resolution` is 2^n + 1 vertices (n ≥ 1)"""
    cells = resolution - 1
    return cells >= 2 and cells & (cells - 1) == 0


def get_spacing(size: float, resolution: int) -> float:
    """The distance between neighbouring vertices"""
    return size / (resolution - 1)


def get_grid_vertex(size: float, resolution: int, row: int, col: int) -> tuple[float, float]:
    """A grid vertex's Blender (x, y) on a block centred on its origin: column along +x, row along
    the engine's +z (Blender's -y), from the -x, -z corner (`generateTerrain`'s layout)
    """
    spacing = get_spacing(size, resolution)
    half = size / 2
    return (col * spacing - half, half - row * spacing)


def get_grid_uv(resolution: int, row: int, col: int) -> tuple[float, float]:
    """A grid vertex's UV in Blender: U along +x, V along Blender's +y, so V runs along the
    engine's +z once the exporter flips it (D1)
    """
    cells = resolution - 1
    return (col / cells, 1 - row / cells)


def get_grid_triangles(resolution: int) -> list[tuple[int, int, int]]:
    """The grid's triangles, two a cell, split along the heightfield collider's diagonal
    (row + 1, col)-(row, col + 1), counter-clockwise seen from above
    """
    triangles = []
    for row in range(resolution - 1):
        for col in range(resolution - 1):
            a = row * resolution + col
            b = a + 1
            c = a + resolution
            d = c + 1
            triangles.append((a, c, b))
            triangles.append((b, c, d))
    return triangles


def get_grid_location(size: float, grid_x: int, grid_z: int) -> tuple[float, float, float]:
    """Where a block sits in the .blend: its world place `(gridX · size, 0, gridZ · size)` (D1) in
    Blender's axes. The export moves it back to the origin; the engine places it by its grid.
    """
    return (grid_x * size, -grid_z * size, 0.0)


#: Every custom prop the add-on writes: a key the block's collider no longer takes is removed
BLOCK_PROP_KEYS = ("isPhysObj", "keepMesh", "rigidType", "colliderType", "nCols", "nRows",
                   "aekBlockSize", "aekBlockRes", "aekGridX", "aekGridZ")


def get_block_custom_props(
    size: int, resolution: int, grid_x: int, grid_z: int, collider: str = "HEIGHTFIELD"
) -> dict:
    """The custom props the engine reads (D1): a fixed `HEIGHTFIELD` body of `resolution - 1`
    cells a side (`nCols` along x, `nRows` along z), a fixed `TRIMESH` body, or none, and the
    block's metadata. `keepMesh` keeps the mesh visible when the GLB is spawned as a plain import
    (`spawnImportedAsset`); `spawnTerrainBlock` decides from the block's JSON and ignores them.
    """
    cells = resolution - 1
    props: dict = {}
    if collider != "NONE":
        props.update(isPhysObj=1, keepMesh=1, rigidType="FIXED", colliderType=collider)
    if collider == "HEIGHTFIELD":
        props.update(nCols=cells, nRows=cells)
    props.update(aekBlockSize=size, aekBlockRes=resolution, aekGridX=grid_x, aekGridZ=grid_z)
    return props


# --- The block's settings ----------------------------------------------------------------------


class AEK_PG_terrain_block(bpy.types.PropertyGroup):
    """A terrain block's settings, on its object (`object.aek_terrain_block`)"""

    is_block: BoolProperty(  # type: ignore[valid-type]
        name="Terrain Block",
        description="This object is an Ækasha terrain block",
        default=False,
    )
    block_id: StringProperty(  # type: ignore[valid-type]
        name="Id",
        description="The block's asset id: its files are <id>.glb, <id>.importedAsset.json "
        "and <id>.terrainBlock.json",
        default="",
    )
    size: EnumProperty(  # type: ignore[valid-type]
        name="Size",
        description="The block's edge length",
        items=SIZE_ITEMS,
        default="64",
    )
    resolution: EnumProperty(  # type: ignore[valid-type]
        name="Resolution",
        description="Vertices per side (2^n + 1): the splat's resolution is the vertex spacing",
        items=RESOLUTION_ITEMS,
        default="129",
    )
    grid_x: IntProperty(  # type: ignore[valid-type]
        name="Grid X",
        description="The block's column in the world grid (world x = Grid X × size)",
        default=0,
    )
    grid_z: IntProperty(  # type: ignore[valid-type]
        name="Grid Z",
        description="The block's row in the world grid (world z = Grid Z × size, Blender's -y)",
        default=0,
    )
    layout: EnumProperty(  # type: ignore[valid-type]
        name="Splat Layout",
        description="What the splat's channels hold",
        items=LAYOUT_ITEMS,
        default="RGB_AO",
    )
    collider: EnumProperty(  # type: ignore[valid-type]
        name="Collider",
        description="The block's collider",
        items=COLLIDER_ITEMS,
        default="HEIGHTFIELD",
    )
    output_dir: StringProperty(  # type: ignore[valid-type]
        name="Folder",
        description="Where Export Block writes the block's files (a scene's folder in the repo, "
        "eg. src/app/scenes/<sceneId>/blocks/<id>/)",
        subtype="DIR_PATH",
        default="//",
    )


def get_block_settings(obj: bpy.types.Object | None) -> AEK_PG_terrain_block | None:
    """The settings of a terrain block object; None for anything else"""
    if obj is None or obj.type != "MESH":
        return None
    settings = obj.aek_terrain_block
    return settings if settings.is_block else None


def get_settings_custom_props(settings: AEK_PG_terrain_block) -> dict:
    """`get_block_custom_props` from a block's settings"""
    return get_block_custom_props(int(settings.size), int(settings.resolution), settings.grid_x,
                                  settings.grid_z, settings.collider)


def write_block_custom_props(obj: bpy.types.Object) -> None:
    """Writes the engine's custom props (D1) from the block's settings, removing the ones its
    collider doesn't take
    """
    props = get_settings_custom_props(obj.aek_terrain_block)
    for key in BLOCK_PROP_KEYS:
        if key not in props and key in obj:
            del obj[key]
    for key, value in props.items():
        obj[key] = value


def find_block(
    objects, *, block_id: str | None = None, place: tuple[int, int, int] | None = None
) -> bpy.types.Object | None:
    """The block among `objects` with an id, or at a grid place `(size, grid_x, grid_z)`"""
    for obj in objects:
        settings = get_block_settings(obj)
        if settings is None:
            continue
        if block_id is not None and settings.block_id == block_id:
            return obj
        if place is not None and place == (int(settings.size), settings.grid_x, settings.grid_z):
            return obj
    return None


def get_free_block_id(base: str = "terrainBlock") -> str:
    """`base`, or `base` with the first number no object or block has taken"""
    candidate, number = base, 1
    while bpy.data.objects.get(candidate) or find_block(bpy.data.objects, block_id=candidate):
        number += 1
        candidate = f"{base}{number}"
    return candidate


# --- Building a block ---------------------------------------------------------------------------


def build_grid_mesh(name: str, size: int, resolution: int, layout: str) -> bpy.types.Mesh:
    """A flat block mesh at height 0 (D1): `resolution²` vertices in `generateTerrain`'s order,
    two triangles a cell along the heightfield's diagonal (`get_grid_triangles`), smooth shading,
    the top-down UVs and a black `Splat` (A 1 for `RGB_AO`, unoccluded; 0 for `RGBA`, layer 4)
    """
    count = resolution * resolution
    rows, cols = np.divmod(np.arange(count), resolution)
    spacing = get_spacing(size, resolution)
    half = size / 2
    positions = np.zeros((count, 3))
    positions[:, 0] = cols * spacing - half
    positions[:, 1] = half - rows * spacing

    cells = resolution - 1
    cell_rows, cell_cols = np.divmod(np.arange(cells * cells), cells)
    a = cell_rows * resolution + cell_cols
    c = a + resolution
    triangles = np.empty((cells * cells * 2, 3), dtype=np.int32)
    triangles[0::2] = np.stack([a, c, a + 1], axis=1)
    triangles[1::2] = np.stack([a + 1, c, c + 1], axis=1)

    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(positions, [], triangles)
    mesh.shade_smooth()

    # A loop's UV is its vertex's: U = col / cells, V = 1 - row / cells (get_grid_uv)
    loop_vertices = triangles.ravel()
    uvs = np.empty((loop_vertices.size, 2), dtype=np.float32)
    uvs[:, 0] = cols[loop_vertices] / cells
    uvs[:, 1] = 1 - rows[loop_vertices] / cells
    mesh.uv_layers.new(name="UVMap").data.foreach_set("uv", uvs.ravel())

    splat = mesh.color_attributes.new(SPLAT_ATTRIBUTE, "BYTE_COLOR", "POINT")
    colors = np.zeros((count, 4), dtype=np.float32)
    colors[:, 3] = 1.0 if layout == "RGB_AO" else 0.0
    splat.data.foreach_set("color", colors.ravel())
    mesh.color_attributes.active_color = splat
    mesh.color_attributes.render_color_index = mesh.color_attributes.active_color_index
    mesh.update()
    return mesh


class AEK_OT_add_terrain_block(bpy.types.Operator):
    """Add a flat terrain block at its place on the world grid, ready to shape and paint"""

    bl_idname = "aek.add_terrain_block"
    bl_label = "Add Terrain Block"
    bl_options = {"REGISTER", "UNDO"}

    block_id: StringProperty(  # type: ignore[valid-type]
        name="Id", description="The block's asset id (also the object's name)", default=""
    )
    size: EnumProperty(name="Size", items=SIZE_ITEMS, default="64")  # type: ignore[valid-type]
    resolution: EnumProperty(  # type: ignore[valid-type]
        name="Resolution", items=RESOLUTION_ITEMS, default="129"
    )
    grid_x: IntProperty(name="Grid X", default=0)  # type: ignore[valid-type]
    grid_z: IntProperty(name="Grid Z", default=0)  # type: ignore[valid-type]
    layout: EnumProperty(  # type: ignore[valid-type]
        name="Splat Layout", items=LAYOUT_ITEMS, default="RGB_AO"
    )
    collider: EnumProperty(  # type: ignore[valid-type]
        name="Collider", items=COLLIDER_ITEMS, default="HEIGHTFIELD"
    )

    @classmethod
    def poll(cls, context: bpy.types.Context) -> bool:
        return context.mode == "OBJECT"

    def invoke(self, context: bpy.types.Context, event: bpy.types.Event) -> set[str]:
        if not self.block_id:
            self.block_id = get_free_block_id()
        return context.window_manager.invoke_props_dialog(self)

    def execute(self, context: bpy.types.Context) -> set[str]:
        block_id = self.block_id.strip() or get_free_block_id()
        size, resolution = int(self.size), int(self.resolution)
        if not is_block_id(block_id):
            self.report({"ERROR"}, f'"{block_id}": an id starts with a letter, then letters, '
                        "digits, _ or -")
            return {"CANCELLED"}
        if bpy.data.objects.get(block_id) or find_block(bpy.data.objects, block_id=block_id):
            self.report({"ERROR"}, f'"{block_id}" is taken: the block id is the object\'s name too')
            return {"CANCELLED"}
        taken = find_block(context.scene.objects, place=(size, self.grid_x, self.grid_z))
        if taken is not None:
            self.report({"ERROR"}, f'Grid ({self.grid_x}, {self.grid_z}) of {size} m blocks is '
                        f'"{taken.name}"\'s')
            return {"CANCELLED"}

        mesh = build_grid_mesh(block_id, size, resolution, self.layout)
        mesh.materials.append(ensure_preview_material(context.scene))
        obj = bpy.data.objects.new(block_id, mesh)
        context.collection.objects.link(obj)
        obj.location = get_grid_location(size, self.grid_x, self.grid_z)
        settings = obj.aek_terrain_block
        settings.is_block = True
        settings.block_id = block_id
        settings.size, settings.resolution = self.size, self.resolution
        settings.grid_x, settings.grid_z = self.grid_x, self.grid_z
        settings.layout = self.layout
        settings.collider = self.collider
        write_block_custom_props(obj)

        for selected in context.selected_objects:
            selected.select_set(False)
        obj.select_set(True)
        context.view_layer.objects.active = obj
        self.report({"INFO"}, f"Added {block_id}: {size} m, {resolution}² vertices, grid "
                    f"({self.grid_x}, {self.grid_z})")
        return {"FINISHED"}


def draw_add_menu(self: bpy.types.Menu, context: bpy.types.Context) -> None:
    """Add → Mesh → Ækasha Terrain Block"""
    self.layout.operator(AEK_OT_add_terrain_block.bl_idname, text="Ækasha Terrain Block",
                         icon="MESH_GRID")


# --- Validation ---------------------------------------------------------------------------------

#: How far a vertex may sit off its grid point in X/Z, metres (the engine's import allows 1 % of
#: the spacing; a block sculpted with X and Y locked is exact)
GRID_TOLERANCE = 1e-4
#: How far neighbouring blocks' shared edge heights may differ, metres
EDGE_TOLERANCE = 1e-5
#: How far over 1 a splat sum may go: one byte step, which the sRGB storage of a byte colour
#: makes two half-weights sum to (0.5029 each)
SPLAT_SUM_TOLERANCE = 1 / 255
#: How far a UV may sit from the top-down projection's
UV_TOLERANCE = 1e-4

#: A check's finding: `(level, message)`, the level `ERROR` (Export refuses) or `WARNING`
Issue = tuple[str, str]


def get_splat_channels(layout: str) -> int:
    """The splat channels that weigh layers: RGB for `RGB_AO` (A is the AO), RGBA for `RGBA`"""
    return 3 if layout == "RGB_AO" else 4


def read_grid(
    positions: np.ndarray, size: int, resolution: int
) -> tuple[np.ndarray | None, list[Issue]]:
    """Each vertex's grid point index (`row * res + col`) from its block-local Blender (x, y),
    or None with the errors when the vertices aren't the block's regular grid: one vertex on each
    grid point, none moved off its column or row
    """
    spacing = get_spacing(size, resolution)
    half = size / 2
    col_f = (positions[:, 0] + half) / spacing
    row_f = (half - positions[:, 1]) / spacing
    cols, rows = np.rint(col_f), np.rint(row_f)
    drift = np.maximum(np.abs(col_f - cols), np.abs(row_f - rows)) * spacing
    issues: list[Issue] = []
    moved = np.flatnonzero(drift > GRID_TOLERANCE)
    if moved.size:
        i = int(moved[np.argmax(drift[moved])])
        x, y = positions[i, 0], positions[i, 1]
        issues.append(("ERROR", f"{moved.size} vertices moved off their grid point in X/Z, the "
                       f"worst vertex {i} by {drift[i] * 1000:.1f} mm at ({x:.3f}, {y:.3f}): "
                       "shape it in height only (sculpt with X and Y locked)"))
    outside = np.flatnonzero((cols < 0) | (cols >= resolution) | (rows < 0) | (rows >= resolution))
    if outside.size:
        i = int(outside[0])
        issues.append(("ERROR", f"{outside.size} vertices outside the {size} m block, eg. vertex "
                       f"{i} at ({positions[i, 0]:.3f}, {positions[i, 1]:.3f}): is the origin at "
                       "its centre?"))
    if issues:
        return None, issues
    grid = (rows * resolution + cols).astype(np.int64)
    counts = np.bincount(grid, minlength=resolution * resolution)
    missing = np.flatnonzero(counts == 0)
    doubled = np.flatnonzero(counts > 1)
    if missing.size:
        row, col = divmod(int(missing[0]), resolution)
        issues.append(("ERROR", f"{missing.size} grid points have no vertex, the first at row "
                       f"{row}, column {col}"))
    if doubled.size:
        row, col = divmod(int(doubled[0]), resolution)
        issues.append(("ERROR", f"{doubled.size} grid points have more than one vertex, the "
                       f"first at row {row}, column {col}: merge by distance"))
    return (None if issues else grid), issues


def read_mesh_arrays(mesh: bpy.types.Mesh) -> dict:
    """A mesh's positions, faces and loops as numpy arrays"""
    positions = np.empty(len(mesh.vertices) * 3)
    mesh.vertices.foreach_get("co", positions)
    loop_vertices = np.empty(len(mesh.loops), dtype=np.int64)
    mesh.loops.foreach_get("vertex_index", loop_vertices)
    loop_starts = np.empty(len(mesh.polygons), dtype=np.int64)
    mesh.polygons.foreach_get("loop_start", loop_starts)
    loop_totals = np.empty(len(mesh.polygons), dtype=np.int64)
    mesh.polygons.foreach_get("loop_total", loop_totals)
    return {
        "positions": positions.reshape(-1, 3),
        "loop_vertices": loop_vertices,
        "loop_starts": loop_starts,
        "loop_totals": loop_totals,
    }


def check_faces(arrays: dict, grid: np.ndarray, resolution: int) -> list[Issue]:
    """Two triangles a cell along the heightfield's diagonal; quads and n-gons the exporter splits
    its own way, loose geometry the export drops
    """
    issues: list[Issue] = []
    totals, starts, loops = arrays["loop_totals"], arrays["loop_starts"], arrays["loop_vertices"]
    not_triangles = int(np.count_nonzero(totals != 3))
    if not_triangles:
        issues.append(("WARNING", f"{not_triangles} faces aren't triangles: the export splits "
                       "them its own way, maybe off the collider's diagonal (Add makes triangles)"))
    tri_starts = starts[totals == 3]
    tris = grid[loops[tri_starts[:, None] + np.arange(3)]]
    rows, cols = np.divmod(tris, resolution)
    r0, c0 = rows.min(axis=1), cols.min(axis=1)
    # A triangle off the diagonal holds both (r0, c0) and (r0 + 1, c0 + 1)
    has_first = ((rows == r0[:, None]) & (cols == c0[:, None])).any(axis=1)
    has_last = ((rows == r0[:, None] + 1) & (cols == c0[:, None] + 1)).any(axis=1)
    flipped = np.unique((r0 * resolution + c0)[has_first & has_last])
    if flipped.size:
        row, col = divmod(int(flipped[0]), resolution)
        issues.append(("WARNING", f"{flipped.size} cells are split along the other diagonal, the "
                       f"first at row {row}, column {col}: the collider differs from the mesh "
                       "between their vertices"))
    expected = 2 * (resolution - 1) ** 2
    if not not_triangles and len(tris) != expected:
        issues.append(("ERROR", f"{len(tris)} triangles, not {expected}: holes or extra faces"))
    used = np.bincount(loops, minlength=len(grid))
    loose = int(np.count_nonzero(used == 0))
    if loose:
        issues.append(("ERROR", f"{loose} vertices belong to no face (loose geometry)"))
    return issues


def check_uvs(mesh: bpy.types.Mesh, arrays: dict, grid: np.ndarray, resolution: int) -> list[Issue]:
    """The top-down projection: U along +x, V along Blender's +y (D1)"""
    if not mesh.uv_layers:
        return [("ERROR", "No UV map: the splat and colour maps need the top-down UVs")]
    uvs = np.empty(len(mesh.loops) * 2)
    mesh.uv_layers.active.data.foreach_get("uv", uvs)
    rows, cols = np.divmod(grid[arrays["loop_vertices"]], resolution)
    cells = resolution - 1
    expected = np.stack([cols / cells, 1 - rows / cells], axis=1)
    off = np.flatnonzero(np.abs(uvs.reshape(-1, 2) - expected).max(axis=1) > UV_TOLERANCE)
    if not off.size:
        return []
    return [("ERROR", f"{off.size} UVs aren't the top-down projection (U along +x, V along +y): "
             "re-project from the top view (UV → Project from View (Bounds))")]


def check_splat(mesh: bpy.types.Mesh, layout: str) -> list[Issue]:
    """The splat attribute: on vertices, the active colour, its weights summing to 1 at most"""
    splat = mesh.color_attributes.get(SPLAT_ATTRIBUTE)
    if splat is None:
        return [("ERROR", f'No "{SPLAT_ATTRIBUTE}" colour attribute (exported as COLOR_0)')]
    issues: list[Issue] = []
    if splat.domain != "POINT":
        issues.append(("ERROR", f'"{SPLAT_ATTRIBUTE}" is on face corners: it must be on vertices, '
                       "or the export splits them"))
    if splat.data_type != "BYTE_COLOR":
        issues.append(("WARNING", f'"{SPLAT_ATTRIBUTE}" is a float colour: the .blend is bigger '
                       "for no gain (the GLB is the same)"))
    if mesh.color_attributes.active_color_name != SPLAT_ATTRIBUTE:
        issues.append(("WARNING", f'"{SPLAT_ATTRIBUTE}" isn\'t the active colour attribute: the '
                       "export makes it so"))
    colors = np.empty(len(splat.data) * 4)
    splat.data.foreach_get("color", colors)
    sums = colors.reshape(-1, 4)[:, : get_splat_channels(layout)].sum(axis=1)
    over = int(np.count_nonzero(sums > 1 + SPLAT_SUM_TOLERANCE))
    if over:
        issues.append(("WARNING", f"{over} vertices' splat weights sum over 1 (up to "
                       f"{sums.max():.3f}): Normalize Splat"))
    return issues


def get_block_heights(obj: bpy.types.Object, depsgraph) -> np.ndarray | None:
    """The block's evaluated heights as a `(res, res)` grid, row along the engine's +z; None when
    its vertices aren't the regular grid
    """
    settings = obj.aek_terrain_block
    size, resolution = int(settings.size), int(settings.resolution)
    evaluated = obj.evaluated_get(depsgraph)
    mesh = evaluated.to_mesh()
    try:
        positions = read_mesh_arrays(mesh)["positions"]
    finally:
        evaluated.to_mesh_clear()
    grid, _ = read_grid(positions, size, resolution)
    if grid is None:
        return None
    heights = np.empty(resolution * resolution)
    heights[grid] = positions[:, 2]
    return heights.reshape(resolution, resolution)


#: A neighbour's grid offset, then the side of ours and the side of theirs that touch
_NEIGHBOURS = (
    ((1, 0), lambda h: h[:, -1], lambda h: h[:, 0], "+x"),
    ((-1, 0), lambda h: h[:, 0], lambda h: h[:, -1], "-x"),
    ((0, 1), lambda h: h[-1, :], lambda h: h[0, :], "+z"),
    ((0, -1), lambda h: h[0, :], lambda h: h[-1, :], "-z"),
)


def check_neighbours(obj: bpy.types.Object, heights: np.ndarray, depsgraph, objects) -> list[Issue]:
    """The shared edges' heights against the blocks next to this one in the scene (D1: neighbours
    share edge vertices exactly)
    """
    settings = obj.aek_terrain_block
    size = int(settings.size)
    issues: list[Issue] = []
    for (dx, dz), ours, theirs, side in _NEIGHBOURS:
        other = find_block(objects, place=(size, settings.grid_x + dx, settings.grid_z + dz))
        if other is None or other == obj:
            continue
        if other.aek_terrain_block.collider == "TRIMESH":
            issues.append(("WARNING", f'The {side} neighbour "{other.name}" is a trimesh block: '
                           "its edge isn't compared (keep its edge vertices where this block's "
                           "are)"))
            continue
        if other.aek_terrain_block.resolution != settings.resolution:
            issues.append(("WARNING", f'The {side} neighbour "{other.name}" has another '
                           "resolution: its edge isn't compared (a skirt hides the gap)"))
            continue
        other_heights = get_block_heights(other, depsgraph)
        if other_heights is None:
            issues.append(("WARNING", f'The {side} neighbour "{other.name}" isn\'t a regular grid: '
                           "validate it"))
            continue
        gap = np.abs(ours(heights) - theirs(other_heights))
        if gap.max() > EDGE_TOLERANCE:
            issues.append(("ERROR", f'The {side} edge differs from "{other.name}" by up to '
                           f"{gap.max() * 1000:.2f} mm ({np.count_nonzero(gap > EDGE_TOLERANCE)} "
                           "vertices): neighbours share their edge heights"))
    return issues


def check_trimesh(arrays: dict, size: int) -> list[Issue]:
    """A trimesh block's geometry: no loose vertices, none outside its square in X/Z (the square
    is the block's place in the world grid)
    """
    issues: list[Issue] = []
    used = np.bincount(arrays["loop_vertices"], minlength=len(arrays["positions"]))
    loose = int(np.count_nonzero(used == 0))
    if loose:
        issues.append(("ERROR", f"{loose} vertices belong to no face (loose geometry)"))
    half = size / 2 + GRID_TOLERANCE
    outside = np.flatnonzero(np.abs(arrays["positions"][:, :2]).max(axis=1) > half)
    if outside.size:
        i = int(outside[0])
        x, y = arrays["positions"][i, :2]
        issues.append(("WARNING", f"{outside.size} vertices outside the {size} m square, eg. "
                       f"vertex {i} at ({x:.3f}, {y:.3f}): it reaches into a neighbour's place"))
    return issues


def validate_block(obj: bpy.types.Object, depsgraph, objects) -> list[Issue]:
    """Every check of a block (D1): its transform, its evaluated mesh (modifiers applied, as the
    export writes it), its grid, faces, UVs and splat, and its edges against the blocks next to it
    among `objects`. A `TRIMESH` block skips the grid, face, UV and edge checks: its vertices may
    move in X/Z (overhangs) or be added (caves). An `ERROR` makes Export refuse.
    """
    settings = get_block_settings(obj)
    if settings is None:
        return [("ERROR", f'"{obj.name}" isn\'t a terrain block')]
    size, resolution = int(settings.size), int(settings.resolution)
    issues: list[Issue] = []
    expected_location = get_grid_location(size, settings.grid_x, settings.grid_z)
    if any(abs(a - b) > GRID_TOLERANCE for a, b in zip(obj.location, expected_location)):
        x, y, z = expected_location
        issues.append(("ERROR", f"Not at its grid place ({x:g}, {y:g}, {z:g}): move it back, or "
                       "change its Grid X / Z"))
    if any(abs(r) > 1e-6 for r in obj.rotation_euler) or obj.rotation_mode != "XYZ":
        issues.append(("ERROR", "Rotated: apply the rotation (Ctrl A → Rotation)"))
    if any(abs(s - 1) > 1e-6 for s in obj.scale):
        issues.append(("ERROR", "Scaled: apply the scale (Ctrl A → Scale)"))
    if obj.parent is not None:
        issues.append(("ERROR", f'Parented to "{obj.parent.name}": a block has no parent'))
    if obj.modifiers:
        issues.append(("WARNING", f"{len(obj.modifiers)} modifiers: checked and exported applied"))
    props = get_settings_custom_props(settings)
    if any(obj.get(key) != value for key, value in props.items()) or any(
        key in obj for key in BLOCK_PROP_KEYS if key not in props
    ):
        issues.append(("WARNING", "The custom props differ from the block's settings: the export "
                       "writes them again"))

    evaluated = obj.evaluated_get(depsgraph)
    mesh = evaluated.to_mesh()
    try:
        arrays = read_mesh_arrays(mesh)
        if settings.collider == "TRIMESH":
            return issues + check_trimesh(arrays, size) + check_splat(mesh, settings.layout)
        if len(arrays["positions"]) != resolution * resolution:
            issues.append(("ERROR", f"{len(arrays['positions'])} vertices, not {resolution}² = "
                           f"{resolution * resolution}"))
        grid, grid_issues = read_grid(arrays["positions"], size, resolution)
        issues += grid_issues
        if grid is not None:
            issues += check_faces(arrays, grid, resolution)
            issues += check_uvs(mesh, arrays, grid, resolution)
            heights = np.empty(resolution * resolution)
            heights[grid] = arrays["positions"][:, 2]
            issues += check_neighbours(obj, heights.reshape(resolution, resolution), depsgraph,
                                       objects)
        issues += check_splat(mesh, settings.layout)
    finally:
        evaluated.to_mesh_clear()
    return issues


#: The last Validate's findings by object name, for the panel
_last_validation: dict[str, list[Issue]] = {}


class AEK_OT_validate_terrain_block(bpy.types.Operator):
    """Check the active terrain block against the block conventions: errors make Export refuse"""

    bl_idname = "aek.validate_terrain_block"
    bl_label = "Validate Block"
    bl_options = {"REGISTER"}

    @classmethod
    def poll(cls, context: bpy.types.Context) -> bool:
        return get_block_settings(context.active_object) is not None

    def execute(self, context: bpy.types.Context) -> set[str]:
        obj = context.active_object
        issues = validate_block(obj, context.evaluated_depsgraph_get(), context.scene.objects)
        _last_validation[obj.name] = issues
        errors = sum(1 for level, _ in issues if level == "ERROR")
        for level, message in issues:
            self.report({level}, message)
        if not issues:
            self.report({"INFO"}, f"{obj.name}: valid")
        elif not errors:
            self.report({"INFO"}, f"{obj.name}: valid, {len(issues)} warnings")
        return {"FINISHED"}


def srgb_to_linear(srgb: np.ndarray) -> np.ndarray:
    return np.where(srgb <= 0.04045, srgb / 12.92, ((srgb + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(linear: np.ndarray) -> np.ndarray:
    return np.where(linear <= 0.0031308, linear * 12.92, 1.055 * linear ** (1 / 2.4) - 0.055)


def quantize_weights(weights: np.ndarray) -> np.ndarray:
    """A byte colour's stored bytes for linear weights summing to 1 at most, whose linear values
    (what the export writes) still sum to 1 at most: each channel rounded down, then the channels
    that lost the most raised a step where the sum stays within 1. RGB are stored as sRGB, A as
    it is.
    """
    is_srgb = np.arange(weights.shape[1]) < 3

    def to_steps(linear: np.ndarray) -> np.ndarray:
        return np.floor(np.where(is_srgb, linear_to_srgb(linear), linear) * 255 + 1e-6)

    def to_linear(steps: np.ndarray, srgb: np.ndarray = is_srgb) -> np.ndarray:
        return np.where(srgb, srgb_to_linear(steps / 255), steps / 255)

    steps = to_steps(np.clip(weights, 0, 1))
    linear = to_linear(steps)
    for rank in range(weights.shape[1]):
        channel = np.argsort(linear - weights, axis=1)[:, rank]
        rows = np.arange(len(weights))
        raised = np.minimum(steps[rows, channel] + 1, 255)
        raised_linear = to_linear(raised, is_srgb[channel])
        fits = linear.sum(axis=1) - linear[rows, channel] + raised_linear <= 1
        steps[rows[fits], channel[fits]] = raised[fits]
        linear[rows[fits], channel[fits]] = raised_linear[fits]
    return steps


def normalize_splat(mesh: bpy.types.Mesh, layout: str) -> int:
    """Scales each vertex's splat weights down to a sum of 1 where they sum over it (RGB for
    `RGB_AO`, RGBA for `RGBA`); A stays as it is for `RGB_AO`. A byte colour is stored as sRGB, so
    its weights are rounded to bytes that still sum to 1 at most (`quantize_weights`). Returns the
    vertices changed.
    """
    splat = mesh.color_attributes[SPLAT_ATTRIBUTE]
    colors = np.empty(len(splat.data) * 4)
    splat.data.foreach_get("color", colors)
    colors = colors.reshape(-1, 4)
    channels = get_splat_channels(layout)
    sums = colors[:, :channels].sum(axis=1)
    over = sums > 1
    weights = colors[over, :channels] / sums[over, None]
    if splat.data_type == "BYTE_COLOR":
        srgb = np.empty(len(splat.data) * 4)
        splat.data.foreach_get("color_srgb", srgb)
        srgb = srgb.reshape(-1, 4)
        srgb[over, :channels] = quantize_weights(weights) / 255
        splat.data.foreach_set("color_srgb", srgb.ravel())
    else:
        colors[over, :channels] = weights
        splat.data.foreach_set("color", colors.ravel())
    mesh.update()
    return int(np.count_nonzero(over))


class AEK_OT_normalize_splat(bpy.types.Operator):
    """Scale the active block's splat weights down where they sum over 1 (over-painting)"""

    bl_idname = "aek.normalize_splat"
    bl_label = "Normalize Splat"
    bl_options = {"REGISTER", "UNDO"}

    @classmethod
    def poll(cls, context: bpy.types.Context) -> bool:
        settings = get_block_settings(context.active_object)
        return (settings is not None and context.mode in {"OBJECT", "PAINT_VERTEX"}
                and SPLAT_ATTRIBUTE in context.active_object.data.color_attributes)

    def execute(self, context: bpy.types.Context) -> set[str]:
        obj = context.active_object
        # Vertex Paint keeps its own copy of the colours: write them in Object Mode
        painting = context.mode == "PAINT_VERTEX"
        if painting:
            bpy.ops.object.mode_set(mode="OBJECT")
        changed = normalize_splat(obj.data, obj.aek_terrain_block.layout)
        if painting:
            bpy.ops.object.mode_set(mode="VERTEX_PAINT")
        self.report({"INFO"}, f"{obj.name}: {changed} vertices normalized")
        return {"FINISHED"}


# --- Splitting a terrain into blocks ------------------------------------------------------------

#: How far a split source's corner may sit off a block corner of the world grid, metres
ALIGN_TOLERANCE = 1e-3


def plan_split(positions: np.ndarray, location, size: int) -> tuple[dict | None, str | None]:
    """How a regular grid (block-local `positions`, the object at `location`) cuts into blocks of
    `size`: `{count, resolution, grid_x, grid_z, grid, heights}` (`count` blocks a side, the
    first block's grid place at the engine's -x, -z corner, each vertex's grid index on the whole
    grid, the heights as a `(side, side)` grid, row along the engine's +z), or None and why not
    """
    vertices = len(positions)
    side = int(round(vertices ** 0.5))
    if side * side != vertices:
        return None, f"{vertices} vertices aren't a square grid"
    world = positions + np.asarray(location)
    min_x, max_x = world[:, 0].min(), world[:, 0].max()
    min_y, max_y = world[:, 1].min(), world[:, 1].max()
    extent = max_x - min_x
    if abs((max_y - min_y) - extent) > ALIGN_TOLERANCE:
        return None, f"not square: {extent:g} × {max_y - min_y:g} m"
    count = int(round(extent / size))
    if count < 1 or abs(count * size - extent) > ALIGN_TOLERANCE:
        return None, f"{extent:g} m isn't a whole number of {size} m blocks"
    if (side - 1) % count:
        return None, f"{side} vertices a side don't split into {count} blocks"
    resolution = (side - 1) // count + 1
    if not is_block_resolution(resolution):
        return None, f"{resolution} vertices a block side isn't 2^n + 1"
    # The first block's centre is half a block in from the -x and the engine's -z (Blender +y)
    first_x = (min_x + size / 2) / size
    first_z = -(max_y - size / 2) / size
    if abs(first_x - round(first_x)) * size > ALIGN_TOLERANCE or (
        abs(first_z - round(first_z)) * size > ALIGN_TOLERANCE
    ):
        return None, (f"its corner ({min_x:g}, {max_y:g}) isn't a block corner: move it so the "
                      f"corners sit at odd multiples of {size / 2:g} m")
    centre = np.array([(min_x + max_x) / 2, (min_y + max_y) / 2, 0.0])
    grid, issues = read_grid(world - centre, count * size, side)
    if grid is None:
        return None, issues[0][1]
    heights = np.empty(side * side)
    heights[grid] = world[:, 2]
    return {
        "count": count,
        "resolution": resolution,
        "grid_x": int(round(first_x)),
        "grid_z": int(round(first_z)),
        "grid": grid,
        "heights": heights.reshape(side, side),
    }, None


def get_split_block_id(base: str, grid_x: int, grid_z: int) -> str:
    """A split block's id: the source's name and its grid place (`coast_-1_0`)"""
    return f"{base}_{grid_x}_{grid_z}"


class AEK_OT_split_into_blocks(bpy.types.Operator):
    """Cut the active mesh, a regular grid covering N × N blocks of the world grid, into terrain
    blocks with shared edges and its normals (no seams in shape or light). Shape it first: a
    block's normals are the unsplit surface's
    """

    bl_idname = "aek.split_into_blocks"
    bl_label = "Split Into Blocks"
    bl_options = {"REGISTER", "UNDO"}

    size: EnumProperty(  # type: ignore[valid-type]
        name="Block Size", items=SIZE_ITEMS, default="64"
    )
    layout: EnumProperty(  # type: ignore[valid-type]
        name="Splat Layout", items=LAYOUT_ITEMS, default="RGB_AO"
    )

    @classmethod
    def poll(cls, context: bpy.types.Context) -> bool:
        obj = context.active_object
        return (obj is not None and obj.type == "MESH" and context.mode == "OBJECT"
                and get_block_settings(obj) is None)

    def invoke(self, context: bpy.types.Context, event: bpy.types.Event) -> set[str]:
        return context.window_manager.invoke_props_dialog(self)

    def execute(self, context: bpy.types.Context) -> set[str]:
        source = context.active_object
        if any(abs(r) > 1e-6 for r in source.rotation_euler) or any(
            abs(s - 1) > 1e-6 for s in source.scale
        ):
            self.report({"ERROR"}, f'"{source.name}" is rotated or scaled: apply them first')
            return {"CANCELLED"}
        base = source.name
        if not is_block_id(base):
            self.report({"ERROR"}, f'"{base}" can\'t start a block id: rename it (a letter, then '
                        "letters, digits, _ or -)")
            return {"CANCELLED"}
        size = int(self.size)

        evaluated = source.evaluated_get(context.evaluated_depsgraph_get())
        mesh = evaluated.to_mesh()
        try:
            positions = read_mesh_arrays(mesh)["positions"]
            plan, reason = plan_split(positions, source.location, size)
            if plan is None:
                self.report({"ERROR"}, f'"{source.name}" doesn\'t split into {size} m blocks: '
                            f"{reason}")
                return {"CANCELLED"}
            normals = np.empty(len(mesh.vertices) * 3)
            mesh.vertex_normals.foreach_get("vector", normals)
            side = plan["heights"].shape[0]
            grid_normals = np.empty((side * side, 3))
            grid_normals[plan["grid"]] = normals.reshape(-1, 3)
            grid_normals = grid_normals.reshape(side, side, 3)
            splat = mesh.color_attributes.get(SPLAT_ATTRIBUTE)
            grid_colors = None
            if splat is not None and splat.domain == "POINT":
                colors = np.empty(len(splat.data) * 4)
                splat.data.foreach_get("color", colors)
                grid_colors = np.empty((side * side, 4))
                grid_colors[plan["grid"]] = colors.reshape(-1, 4)
                grid_colors = grid_colors.reshape(side, side, 4)
        finally:
            evaluated.to_mesh_clear()

        count, resolution = plan["count"], plan["resolution"]
        places = [
            (plan["grid_x"] + i, plan["grid_z"] + j) for j in range(count) for i in range(count)
        ]
        for grid_x, grid_z in places:
            block_id = get_split_block_id(base, grid_x, grid_z)
            taken = bpy.data.objects.get(block_id) or find_block(
                context.scene.objects, place=(size, grid_x, grid_z)
            )
            if taken is not None:
                self.report({"ERROR"}, f'Block {block_id}\'s id or grid place is "{taken.name}"\'s')
                return {"CANCELLED"}

        material = ensure_preview_material(context.scene)
        for selected in context.selected_objects:
            selected.select_set(False)
        cells = resolution - 1
        for grid_x, grid_z in places:
            i, j = grid_x - plan["grid_x"], grid_z - plan["grid_z"]
            rows = slice(j * cells, j * cells + resolution)
            cols = slice(i * cells, i * cells + resolution)
            block_id = get_split_block_id(base, grid_x, grid_z)
            block_mesh = build_grid_mesh(block_id, size, resolution, self.layout)
            co = np.empty(resolution * resolution * 3)
            block_mesh.vertices.foreach_get("co", co)
            co = co.reshape(-1, 3)
            co[:, 2] = plan["heights"][rows, cols].ravel()
            block_mesh.vertices.foreach_set("co", co.ravel())
            block_mesh.normals_split_custom_set_from_vertices(
                grid_normals[rows, cols].reshape(-1, 3).tolist()
            )
            if grid_colors is not None:
                block_mesh.color_attributes[SPLAT_ATTRIBUTE].data.foreach_set(
                    "color", grid_colors[rows, cols].reshape(-1).tolist()
                )
            block_mesh.materials.append(material)
            block_mesh.update()
            obj = bpy.data.objects.new(block_id, block_mesh)
            for collection in source.users_collection:
                collection.objects.link(obj)
            obj.location = get_grid_location(size, grid_x, grid_z)
            settings = obj.aek_terrain_block
            settings.is_block = True
            settings.block_id = block_id
            settings.size, settings.resolution = self.size, str(resolution)
            settings.grid_x, settings.grid_z = grid_x, grid_z
            settings.layout = self.layout
            write_block_custom_props(obj)
            obj.select_set(True)
            context.view_layer.objects.active = obj
        source.hide_set(True)
        source.hide_render = True
        self.report({"INFO"}, f'"{source.name}" split into {count} × {count} blocks of {size} m '
                    f"/ {resolution} (the source hidden)")
        return {"FINISHED"}


# --- Baking AO ----------------------------------------------------------------------------------

#: The temporary colour attribute the AO bakes into (a float colour: the bake's precision until
#: the copy into the splat's byte alpha)
AO_BAKE_ATTRIBUTE = "AEK AO Bake"


def read_splat_bytes(splat) -> tuple[np.ndarray, str]:
    """The splat's stored values: `color_srgb` for a byte colour (RGB sRGB, A linear: writing them
    back keeps every byte), `color` for a float one. Returns the values and the key.
    """
    key = "color_srgb" if splat.data_type == "BYTE_COLOR" else "color"
    values = np.empty(len(splat.data) * 4)
    splat.data.foreach_get(key, values)
    return values.reshape(-1, 4), key


def bake_ao_to_splat_alpha(
    context: bpy.types.Context, obj: bpy.types.Object, *, samples: int, distance: float
) -> np.ndarray:
    """Bakes the block's ambient occlusion with Cycles (every object the render sees occludes, its
    neighbouring blocks too) into a temporary colour attribute and copies it into `Splat`.A, the
    painted RGB kept to the byte. The scene's render engine, samples, bake target, world, AO
    distance, the selection and the active colour attribute come back afterwards. Returns the AO.
    """
    scene, mesh = context.scene, obj.data
    splat = mesh.color_attributes[SPLAT_ATTRIBUTE]
    cycles = scene.cycles
    saved = {
        "engine": scene.render.engine,
        "samples": cycles.samples,
        "target": scene.render.bake.target,
        "world": scene.world,
        "selected": list(context.selected_objects),
        "active": context.view_layer.objects.active,
    }
    world = scene.world or bpy.data.worlds.new("AEK AO Bake")
    saved_distance = world.light_settings.distance
    temporary = mesh.color_attributes.new(AO_BAKE_ATTRIBUTE, "FLOAT_COLOR", "POINT")
    try:
        mesh.color_attributes.active_color = temporary
        scene.world = world
        world.light_settings.distance = distance
        scene.render.engine = "CYCLES"
        cycles.samples = samples
        scene.render.bake.target = "VERTEX_COLORS"
        for selected in saved["selected"]:
            selected.select_set(False)
        obj.select_set(True)
        context.view_layer.objects.active = obj
        bpy.ops.object.bake(type="AO", target="VERTEX_COLORS")

        baked = np.empty(len(temporary.data) * 4)
        temporary.data.foreach_get("color", baked)
        ao = np.clip(baked.reshape(-1, 4)[:, 0], 0, 1)
        values, key = read_splat_bytes(splat)
        values[:, 3] = ao
        splat.data.foreach_set(key, values.ravel())
        return ao
    finally:
        mesh.color_attributes.remove(mesh.color_attributes[AO_BAKE_ATTRIBUTE])
        mesh.color_attributes.active_color = mesh.color_attributes[SPLAT_ATTRIBUTE]
        world.light_settings.distance = saved_distance
        scene.world = saved["world"]
        if saved["world"] is not world:
            bpy.data.worlds.remove(world)
        scene.render.engine = saved["engine"]
        cycles.samples = saved["samples"]
        scene.render.bake.target = saved["target"]
        obj.select_set(False)
        for selected in saved["selected"]:
            selected.select_set(True)
        context.view_layer.objects.active = saved["active"]
        mesh.update()


class AEK_OT_bake_ao_to_splat(bpy.types.Operator):
    """Bake the block's ambient occlusion with Cycles into the splat's alpha (RGB + AO layout):
    valley-scale occlusion the engine applies to indirect light
    """

    bl_idname = "aek.bake_ao_to_splat"
    bl_label = "Bake AO → Splat Alpha"
    bl_options = {"REGISTER", "UNDO"}

    samples: IntProperty(  # type: ignore[valid-type]
        name="Samples", description="Cycles samples a vertex", default=128, min=1, max=4096
    )
    distance: FloatProperty(  # type: ignore[valid-type]
        name="Distance", description="How far away geometry still occludes, metres",
        default=16.0, min=0.1, max=1000.0, unit="LENGTH",
    )

    @classmethod
    def poll(cls, context: bpy.types.Context) -> bool:
        settings = get_block_settings(context.active_object)
        if settings is None or context.mode != "OBJECT":
            return False
        if settings.layout != "RGB_AO":
            cls.poll_message_set("An RGBA splat has no AO channel: A weighs layer 4")
            return False
        return SPLAT_ATTRIBUTE in context.active_object.data.color_attributes

    def invoke(self, context: bpy.types.Context, event: bpy.types.Event) -> set[str]:
        return context.window_manager.invoke_props_dialog(self)

    def execute(self, context: bpy.types.Context) -> set[str]:
        obj = context.active_object
        ao = bake_ao_to_splat_alpha(context, obj, samples=self.samples, distance=self.distance)
        self.report({"INFO"}, f"{obj.name}: AO baked into the splat's alpha (mean {ao.mean():.2f}, "
                    f"darkest {ao.min():.2f})")
        return {"FINISHED"}


# --- Baking the colour map ----------------------------------------------------------------------

COLOR_MAP_SIZE_ITEMS = [(str(s), f"{s} px", f"{s} × {s} pixels") for s in (512, 1024, 2048, 4096)]


def get_block_folder(obj: bpy.types.Object) -> str | None:
    """The block's output folder as an absolute path; None when it's relative (`//`) to a .blend
    that isn't saved
    """
    folder = obj.aek_terrain_block.output_dir or "//"
    if folder.startswith("//") and not bpy.data.filepath:
        return None
    return os.path.normpath(bpy.path.abspath(folder))


def bake_color_map(
    context: bpy.types.Context, obj: bpy.types.Object, *, size: int, samples: int,
    with_ao: bool, path: str,
) -> bpy.types.Image:
    """Bakes the block's preview colour (Cycles' diffuse colour: the albedo, no light) through its
    top-down UVs into `<id>_colorMap`, a `size`² sRGB image saved as a PNG at `path` (p305 D7's
    colour map, the Blender way). The AO is left out unless `with_ao` (the engine applies the
    vertex AO itself). The render settings, the selection and the material come back afterwards.
    """
    material = obj.active_material
    preview = get_preview_group_node(material)
    if preview is None:
        raise ValueError(f'"{obj.name}" doesn\'t draw with "{PREVIEW_MATERIAL}" (or its own splat '
                         "map's): the colour map is its colour")
    name = f"{obj.aek_terrain_block.block_id}_colorMap"
    image = bpy.data.images.get(name)
    if image is not None and tuple(image.size) != (size, size):
        bpy.data.images.remove(image)
        image = None
    if image is None:
        image = bpy.data.images.new(name, size, size, alpha=False, float_buffer=False)
    image.colorspace_settings.name = "sRGB"

    scene, cycles = context.scene, context.scene.cycles
    saved = {
        "engine": scene.render.engine,
        "samples": cycles.samples,
        "target": scene.render.bake.target,
        "selected": list(context.selected_objects),
        "active": context.view_layer.objects.active,
        "ao": preview.inputs["AO Strength"].default_value if preview else None,
    }
    nodes = material.node_tree.nodes
    saved_active_node = nodes.active
    target = nodes.new("ShaderNodeTexImage")
    try:
        target.image = image
        nodes.active = target
        if preview is not None and not with_ao:
            preview.inputs["AO Strength"].default_value = 0.0
        scene.render.engine = "CYCLES"
        cycles.samples = samples
        for selected in saved["selected"]:
            selected.select_set(False)
        obj.select_set(True)
        context.view_layer.objects.active = obj
        bpy.ops.object.bake(type="DIFFUSE", pass_filter={"COLOR"}, target="IMAGE_TEXTURES",
                            margin=4, use_clear=True, uv_layer=obj.data.uv_layers.active.name)
    finally:
        nodes.remove(target)
        nodes.active = saved_active_node
        if preview is not None:
            preview.inputs["AO Strength"].default_value = saved["ao"]
        scene.render.engine = saved["engine"]
        cycles.samples = saved["samples"]
        scene.render.bake.target = saved["target"]
        obj.select_set(False)
        for selected in saved["selected"]:
            selected.select_set(True)
        context.view_layer.objects.active = saved["active"]
    os.makedirs(os.path.dirname(path), exist_ok=True)
    image.filepath_raw = path
    image.file_format = "PNG"
    image.save()
    return image


class AEK_OT_bake_color_map(bpy.types.Operator):
    """Bake the block's preview colour into a colour map, <id>_colorMap.png in the block's folder:
    the engine's colour map input (unique colour in DETAIL, the far surface in FAR_ONLY)
    """

    bl_idname = "aek.bake_color_map"
    bl_label = "Bake Colour Map"
    bl_options = {"REGISTER"}

    size: EnumProperty(  # type: ignore[valid-type]
        name="Size", description="About 2K for a 64-128 m block", items=COLOR_MAP_SIZE_ITEMS,
        default="2048",
    )
    samples: IntProperty(  # type: ignore[valid-type]
        name="Samples", description="Cycles samples a pixel (no light: a few smooth the texels)",
        default=16, min=1, max=1024,
    )
    with_ao: BoolProperty(  # type: ignore[valid-type]
        name="Include AO", description="Multiply the splat's baked AO in (the engine applies the "
        "vertex AO itself: leave off when the block keeps RGB + AO)", default=False,
    )

    @classmethod
    def poll(cls, context: bpy.types.Context) -> bool:
        return get_block_settings(context.active_object) is not None and context.mode == "OBJECT"

    def invoke(self, context: bpy.types.Context, event: bpy.types.Event) -> set[str]:
        return context.window_manager.invoke_props_dialog(self)

    def execute(self, context: bpy.types.Context) -> set[str]:
        obj = context.active_object
        folder = get_block_folder(obj)
        if folder is None:
            self.report({"ERROR"}, "The block's folder is relative to the .blend: save it first, "
                        "or give the block an absolute folder")
            return {"CANCELLED"}
        path = os.path.join(folder, f"{obj.aek_terrain_block.block_id}_colorMap.png")
        try:
            bake_color_map(context, obj, size=int(self.size), samples=self.samples,
                           with_ao=self.with_ao, path=path)
        except ValueError as error:
            self.report({"ERROR"}, str(error))
            return {"CANCELLED"}
        self.report({"INFO"}, f"{obj.name}: the colour map saved to {path}")
        return {"FINISHED"}


# --- Exporting a block --------------------------------------------------------------------------

#: The glTF exporter's locked settings (D5), by Blender 5.3's names. The export reads the running
#: Blender's operator first and refuses on a name it doesn't have (they change between versions).
LOCKED_EXPORT_SETTINGS = {
    "export_format": "GLB",
    "use_selection": True,
    "use_visible": False,
    "use_renderable": False,
    "use_active_collection": False,
    "export_extras": True,  # the custom props, as the node's extras
    "export_yup": True,
    "export_apply": True,  # modifiers applied, as Validate checks them
    "export_texcoords": True,
    "export_normals": True,
    "export_tangents": False,
    "export_vertex_color": "ACTIVE",  # the splat as COLOR_0
    "export_all_vertex_colors": False,
    "export_attributes": True,  # `_`-prefixed attributes (`_WETNESS`)
    "use_mesh_edges": False,
    "use_mesh_vertices": False,
    "export_materials": "NONE",  # the engine assigns the terrain material
    "export_image_format": "NONE",
    "export_draco_mesh_compression_enable": False,  # the asset pipeline encodes
    "export_meshopt_compression_enable": False,
    "export_use_gltfpack": False,
    "export_shared_accessors": False,
    "export_gn_mesh": False,
    "export_animations": False,
    "export_morph": False,
    "export_skins": False,
    "export_cameras": False,
    "export_lights": False,
    "export_gpu_instances": False,
}

#: A block's images the export saves next to its GLB, by name suffix: the colour map (Bake
#: Colour Map) and the splat maps painted in Texture Paint (`<id>_splat0`: layers 1-4,
#: `<id>_splat1`: 5-8)
BLOCK_IMAGES = {"_colorMap": "COLOR", "_splat0": "DATA", "_splat1": "DATA"}


def check_exporter_options(settings: dict | None = None) -> list[str]:
    """The locked settings (a block's, or `settings`) the running Blender's glTF exporter doesn't
    take, by name
    """
    properties = bpy.ops.export_scene.gltf.get_rna_type().properties
    missing = []
    for key, value in (settings or LOCKED_EXPORT_SETTINGS).items():
        prop = properties.get(key)
        if prop is None:
            missing.append(key)
        elif prop.type == "ENUM" and prop.enum_items and value not in prop.enum_items.keys():
            missing.append(f"{key}={value}")
    return missing


def read_glb_json(path: str) -> dict:
    """A GLB's JSON chunk"""
    with open(path, "rb") as f:
        header = f.read(20)
        magic, version, _length, chunk_length, chunk_type = struct.unpack("<4sIIII", header)
        if magic != b"glTF" or version != 2 or chunk_type != 0x4E4F534A:
            raise ValueError(f"{path} isn't a glTF 2 binary")
        return json.loads(f.read(chunk_length))


def check_exported_glb(
    gltf: dict, block_id: str, resolution: int, collider: str = "HEIGHTFIELD"
) -> list[Issue]:
    """What the engine needs of a block's GLB (D1): one node named by the block at the origin with
    its custom props, one primitive with positions, normals, the UVs and the splat as `COLOR_0`
    (`resolution²` vertices unless a `TRIMESH`), no tangents, no other colour, no materials or
    images
    """
    issues: list[Issue] = []
    nodes = [n for n in gltf.get("nodes", []) if "mesh" in n]
    if len(nodes) != 1 or len(gltf.get("meshes", [])) != 1:
        return [("ERROR", f"{len(nodes)} mesh nodes and {len(gltf.get('meshes', []))} meshes, "
                 "not one")]
    node = nodes[0]
    if node.get("name") != block_id:
        issues.append(("ERROR", f'The node is "{node.get("name")}", not "{block_id}"'))
    if any(key in node for key in ("translation", "rotation", "scale", "matrix")):
        issues.append(("ERROR", "The node has a transform: the engine ignores it"))
    extras = node.get("extras") or {}
    collider_type = None if collider == "NONE" else collider
    if extras.get("colliderType") != collider_type or extras.get("aekBlockRes") != resolution:
        issues.append(("ERROR", "The node's custom props are missing (Include → Custom "
                       "Properties)"))
    primitives = gltf["meshes"][0].get("primitives", [])
    if len(primitives) != 1:
        return issues + [("ERROR", f"{len(primitives)} primitives, not one")]
    attributes = primitives[0].get("attributes", {})
    for name in ("POSITION", "NORMAL", "TEXCOORD_0", "COLOR_0"):
        if name not in attributes:
            issues.append(("ERROR", f"No {name}"))
    for name in ("TANGENT", "COLOR_1"):
        if name in attributes:
            issues.append(("ERROR", f"A {name}: the export settings weren't the locked ones"))
    if "POSITION" in attributes and collider != "TRIMESH":
        count = gltf["accessors"][attributes["POSITION"]]["count"]
        if count != resolution * resolution:
            issues.append(("ERROR", f"{count} vertices, not {resolution}²: the export split "
                           "vertices (flat shading? face-corner colours?)"))
    for key in ("materials", "images", "textures"):
        if gltf.get(key):
            issues.append(("ERROR", f"The GLB has {key}: the engine assigns the terrain "
                           "material"))
    return issues


def get_schema_ref(folder: str, schema: str) -> str | None:
    """A JSON's `$schema`: the repo's `.schemas/<schema>` relative to `folder`; None outside it"""
    root = find_repo_root(folder)
    if root is None:
        return None
    return os.path.relpath(os.path.join(root, ".schemas", schema), folder).replace("\\", "/")


def write_json_if_missing(path: str, data: dict) -> bool:
    """Writes a JSON stub where none is (the folder's own JSONs are the user's to edit)"""
    if os.path.exists(path):
        return False
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(json.dumps({k: v for k, v in data.items() if v is not None}, indent=2,
                           ensure_ascii=False) + "\n")
    return True


def save_block_images(block_id: str, folder: str) -> tuple[list[str], list[Issue]]:
    """Saves the block's images (`BLOCK_IMAGES`) as PNGs next to its GLB and writes their texture
    JSON stubs (`flipY: false`: the glTF UVs start at the image's top row). Returns the files
    written and the findings.
    """
    written: list[str] = []
    issues: list[Issue] = []
    for suffix, kind in BLOCK_IMAGES.items():
        name = block_id + suffix
        image = bpy.data.images.get(name)
        if image is None or not image.has_data:
            continue
        if image.is_float:
            issues.append(("WARNING", f'"{name}" is a float image: an 8-bit one is the size the '
                           "engine needs"))
        # Its bytes are saved as they are, so the colour space isn't set here: setting it (even to
        # the same value) reloads the image, which drops unsaved paint (a generated image comes
        # back blank). A splat map painted in sRGB stores a half weight as 188, not 128.
        space = "sRGB" if kind == "COLOR" else "Non-Color"
        if image.colorspace_settings.name != space:
            issues.append(("WARNING", f'"{name}" is {image.colorspace_settings.name}, not {space}: '
                           "its bytes are saved as they are (set its Color Space before painting)"))
        path = os.path.join(folder, name + ".png")
        # Not by its filepath: a loaded image would look for its pixels at the new path
        image.file_format = "PNG"
        image.save(filepath=path)
        written.append(path)
        stub = {
            "$schema": get_schema_ref(folder, "texture.schema.json"),
            "id": name,
            "fileName": f"./{name}.png",
            "optimize": {"slot": "baseColor" if kind == "COLOR" else "data"},
            "texOpts": {"flipY": False, "colorSpace": "srgb" if kind == "COLOR" else ""},
            "debugData": {
                "name": f"{block_id}'s {'colour map' if kind == 'COLOR' else 'splat map'}",
                "description": "Exported by the Ækasha terrain add-on with its block: the block's "
                "own image over its UVs (flipY false: the glTF UVs start at its top row).",
            },
        }
        json_path = os.path.join(folder, f"{name}.texture.json")
        if write_json_if_missing(json_path, stub):
            written.append(json_path)
    return written, issues


def export_block(context: bpy.types.Context, obj: bpy.types.Object, folder: str) -> tuple[
    list[str], list[Issue]
]:
    """Exports the block into `folder`: `<id>.glb` with the locked settings, from a copy at the
    origin named by the block (the block isn't moved), its images, and the JSON stubs where none are
    (`<id>.importedAsset.json` with the lossless `terrainBlock` profile, `<id>.terrainBlock.json`
    with a placeholder material to replace); then reads the GLB back (`check_exported_glb`).
    Returns the files written and the GLB's findings.
    """
    settings = obj.aek_terrain_block
    block_id, size, resolution = settings.block_id, int(settings.size), int(settings.resolution)
    os.makedirs(folder, exist_ok=True)
    write_block_custom_props(obj)
    obj.data.color_attributes.active_color = obj.data.color_attributes[SPLAT_ATTRIBUTE]
    glb_path = os.path.join(folder, f"{block_id}.glb")

    # The export's object is a copy (the same mesh and modifiers) at the origin, named by the block
    # (the node's name), without the add-on's settings: the exporter writes every system property
    # into the extras too (the folder's path among them). The block stays as it is.
    saved = {
        "name": obj.name,
        "selected": list(context.selected_objects),
        "active": context.view_layer.objects.active,
    }
    copy = obj.copy()
    try:
        obj.name = f"{block_id}~"
        copy.name = block_id
        context.scene.collection.objects.link(copy)
        system = copy.bl_system_properties_get()
        for key in list(system.keys()) if system else []:
            del system[key]
        copy.location = (0.0, 0.0, 0.0)
        for selected in saved["selected"]:
            selected.select_set(False)
        copy.select_set(True)
        context.view_layer.objects.active = copy
        bpy.ops.export_scene.gltf(filepath=glb_path, **LOCKED_EXPORT_SETTINGS)
    finally:
        bpy.data.objects.remove(copy)
        obj.name = saved["name"]
        for selected in saved["selected"]:
            selected.select_set(True)
        context.view_layer.objects.active = saved["active"]

    written = [glb_path]
    images, issues = save_block_images(block_id, folder)
    written += images
    imported = {
        "$schema": get_schema_ref(folder, "importedAsset.schema.json"),
        "id": block_id,
        "fileName": f"./{block_id}.glb",
        "optimize": {"profile": "terrainBlock"},
        "debugData": {
            "name": f"Terrain block {block_id}",
            "description": f"{size} m / {resolution}, exported by the Ækasha terrain add-on. The "
            "terrainBlock profile keeps its positions lossless: neighbouring blocks share their "
            "edge vertices exactly.",
        },
    }
    block = {
        "$schema": get_schema_ref(folder, "terrainBlock.schema.json"),
        "geometry": {"importedAsset": block_id, "node": block_id},
        "material": "textureSetSurface",
        "materialInputs": {"surface": {"textureSet": "grass01"}},
        "grid": {"x": settings.grid_x, "z": settings.grid_z, "size": size,
                 "resolution": resolution},
        "collider": {"type": settings.collider},
        "debugData": {
            "name": f"Terrain block {block_id}",
            "description": "A placeholder material: give it the world's terrain material and "
            f"this block's inputs (its splat is COLOR_0, {settings.layout}"
            + "".join(f"; {block_id}{s}" for s in BLOCK_IMAGES
                      if os.path.join(folder, f"{block_id}{s}.png") in written)
            + ").",
        },
    }
    for name, data in ((f"{block_id}.importedAsset.json", imported),
                       (f"{block_id}.terrainBlock.json", block)):
        path = os.path.join(folder, name)
        if write_json_if_missing(path, data):
            written.append(path)
    issues += check_exported_glb(read_glb_json(glb_path), block_id, resolution, settings.collider)
    return written, issues


class AEK_OT_export_terrain_block(bpy.types.Operator):
    """Validate the block and export it with the locked settings into its folder: its GLB, its
    images and the JSON stubs it lacks
    """

    bl_idname = "aek.export_terrain_block"
    bl_label = "Export Block"
    bl_options = {"REGISTER"}

    @classmethod
    def poll(cls, context: bpy.types.Context) -> bool:
        return get_block_settings(context.active_object) is not None and context.mode == "OBJECT"

    def execute(self, context: bpy.types.Context) -> set[str]:
        obj = context.active_object
        missing = check_exporter_options()
        if missing:
            self.report({"ERROR"}, "This Blender's glTF exporter lacks the locked settings "
                        f"{', '.join(missing)}: the add-on was checked with Blender 5.3")
            return {"CANCELLED"}
        folder = get_block_folder(obj)
        if folder is None:
            self.report({"ERROR"}, "The block's folder is relative to the .blend: save it first, "
                        "or give the block an absolute folder")
            return {"CANCELLED"}
        issues = validate_block(obj, context.evaluated_depsgraph_get(), context.scene.objects)
        _last_validation[obj.name] = issues
        errors = [message for level, message in issues if level == "ERROR"]
        if errors:
            self.report({"ERROR"}, f"{obj.name} doesn't validate ({len(errors)} errors), the "
                        f"first: {errors[0]}")
            return {"CANCELLED"}
        written, glb_issues = export_block(context, obj, folder)
        for level, message in issues + glb_issues:
            self.report({level}, message)
        self.report({"INFO"}, f"{obj.name}: {len(written)} files written to {folder}")
        return {"FINISHED"}


# --- The preview material -----------------------------------------------------------------------
#
# An approximation of the engine's terrain material (p305) for painting: a base layer and up to
# four painted ones, each a texture set's fetched colour map tiled at its real size at the world
# (x, -z) the engine tiles at, blended by the splat's weights through the engine's height blend
# (`nodes/HeightBlend.ts`), the vertex AO on top for `RGB_AO`. Not the engine's result: no normal
# maps, anti-tiling, macro variation or roughness, and the lighting is Blender's.

#: Where the texture sets live under the repo root (the toolkit's, and an app set's folder)
TEXTURE_SET_FOLDERS = (("src", "toolkit", "textures"), ("src", "app"))
#: A set's fetched maps (`yarn fetchTextureSources`): `source/raw/<map>.<ext>`
RAW_EXTENSIONS = (".jpg", ".jpeg", ".png")
#: The flat colours of the layers whose set has no fetched colour map: the base, then layers 1-4
FALLBACK_COLORS = (
    (0.18, 0.3, 0.08),
    (0.35, 0.32, 0.28),
    (0.85, 0.87, 0.9),
    (0.62, 0.5, 0.3),
    (0.25, 0.16, 0.09),
)
#: A layer that isn't used
NO_SET = "NONE"
#: The engine's height blend floors (`HeightBlend.ts`)
SHARE_FLOOR = 1e-5
SUM_FLOOR = 1e-8


def find_repo_root(start: str) -> str | None:
    """The repo folder at or above `start`: the one holding `src/toolkit/textures/`"""
    path = os.path.abspath(start)
    while True:
        if os.path.isdir(os.path.join(path, *TEXTURE_SET_FOLDERS[0])):
            return path
        parent = os.path.dirname(path)
        if parent == path:
            return None
        path = parent


def get_repo_root(context: bpy.types.Context) -> str | None:
    """The repo: the add-on preferences' folder, else the one above the saved .blend"""
    addon = context.preferences.addons.get(__name__)
    root = addon.preferences.repo_root if addon else ""
    if root:
        return os.path.normpath(bpy.path.abspath(root))
    if bpy.data.filepath:
        return find_repo_root(os.path.dirname(bpy.data.filepath))
    return None


def find_raw_map(folder: str, name: str) -> str | None:
    """A set's fetched map (`source/raw/<name>.<ext>`), or None when it isn't fetched"""
    for extension in RAW_EXTENSIONS:
        path = os.path.join(folder, "source", "raw", name + extension)
        if os.path.isfile(path):
            return path
    return None


def hex_to_linear(value: str) -> tuple[float, float, float]:
    """A `#rrggbb` colour in linear values (three reads a hex colour as sRGB)"""
    srgb = np.array([int(value[i : i + 2], 16) / 255 for i in (1, 3, 5)])
    return tuple(float(c) for c in srgb_to_linear(srgb))


def find_texture_sets(root: str) -> dict[str, dict]:
    """The texture sets under the repo, by id: their name, real size (`physicalSize`, metres),
    tint, height contrast and fetched colour and height maps (None when not fetched)
    """
    sets: dict[str, dict] = {}
    for parts in TEXTURE_SET_FOLDERS:
        for folder, _dirs, files in os.walk(os.path.join(root, *parts)):
            for file in files:
                if not file.endswith(".textureSet.json"):
                    continue
                try:
                    with open(os.path.join(folder, file), encoding="utf-8") as f:
                        data = json.load(f)
                except (OSError, ValueError):
                    continue
                set_id = data.get("id") or file[: -len(".textureSet.json")]
                size = data.get("physicalSize", 1)
                size = (size, size) if isinstance(size, (int, float)) else tuple(size)
                surface = data.get("surface") or {}
                sets[set_id] = {
                    "id": set_id,
                    "name": (data.get("debugData") or {}).get("name", set_id),
                    "physical_size": (float(size[0]), float(size[1])),
                    "tint": hex_to_linear(surface.get("tint", "#ffffff")),
                    "height_contrast": float(surface.get("heightContrast", 1)),
                    "color": find_raw_map(folder, "color"),
                    "height": find_raw_map(folder, "height"),
                }
    return sets


_texture_sets_cache: dict[str, dict] = {}


def get_texture_sets(root: str, refresh: bool = False) -> dict[str, dict]:
    """`find_texture_sets`, kept per root until `refresh`"""
    if refresh or root not in _texture_sets_cache:
        _texture_sets_cache[root] = find_texture_sets(root)
    return _texture_sets_cache[root]


def get_texture_set_items(root: str | None) -> list[tuple]:
    """The layers' enum items: None, then each set; each item's number a hash of its id, so a
    stored choice survives a set added or removed
    """
    items = [(NO_SET, "None", "No layer", 0)]
    if root:
        for set_id, info in sorted(get_texture_sets(root).items()):
            fetched = "" if info["color"] else " (not fetched: a flat colour)"
            number = zlib.crc32(set_id.encode()) & 0x7FFFFFFF or 1
            items.append((set_id, set_id, info["name"] + fetched, number))
    return items


#: Blender keeps no reference to a dynamic enum's items: these do
_layer_items: list[tuple] = []


def _layer_items_callback(self, context: bpy.types.Context) -> list[tuple]:
    _layer_items[:] = get_texture_set_items(get_repo_root(context) if context else None)
    return _layer_items


def _layer_property(name: str, description: str) -> EnumProperty:
    return EnumProperty(name=name, description=description, items=_layer_items_callback)


class AEK_PG_terrain_preview(bpy.types.PropertyGroup):
    """The scene's preview layers (`scene.aek_terrain_preview`): one preview for its blocks, as a
    world has one terrain material
    """

    base: _layer_property("Base", "The base layer: what the painted weights leave")  # type: ignore
    layer1: _layer_property("Layer 1 (R)", "Painted in the splat's red")  # type: ignore
    layer2: _layer_property("Layer 2 (G)", "Painted in the splat's green")  # type: ignore
    layer3: _layer_property("Layer 3 (B)", "Painted in the splat's blue")  # type: ignore
    layer4: _layer_property("Layer 4 (A)", "Painted in the splat's alpha (RGBA)")  # type: ignore
    layout: EnumProperty(  # type: ignore[valid-type]
        name="Splat Layout", description="The blocks' splat layout", items=LAYOUT_ITEMS,
        default="RGB_AO",
    )
    height_blend: BoolProperty(  # type: ignore[valid-type]
        name="Height Blend", description="Borders by the layers' heights (the engine's HEIGHT)",
        default=True,
    )
    blend_depth: FloatProperty(  # type: ignore[valid-type]
        name="Blend Depth", description="The height blend's transition (the engine's default 0.2)",
        default=0.2, min=0.02, max=0.5,
    )
    ao_strength: FloatProperty(  # type: ignore[valid-type]
        name="AO", description="How much the baked AO (RGB + AO's A) darkens the preview",
        default=1.0, min=0.0, max=1.0,
        update=lambda self, context: set_preview_ao_strength(self.ao_strength),
    )

    def get_layer_ids(self) -> list[str]:
        return [self.base, self.layer1, self.layer2, self.layer3, self.layer4]


def build_preview_group(
    layer_ids: list[str], sets: dict[str, dict], *, layout: str = "RGB_AO",
    height_blend: bool = True, blend_depth: float = 0.2,
) -> tuple[bpy.types.ShaderNodeTree, list[str]]:
    """(Re)builds the preview node group: `layer_ids` the base, then layers 1-4 (`NONE` unused;
    the base is always there, a flat colour without a set). Its inputs: "Splat" and "Splat Alpha",
    the weights (the material links the `Splat` colour attribute, or a block's splat map), and
    "AO Strength" (the material's group node holds the scene's), which scales `RGB_AO`'s AO.
    Returns the group and notes (a set not found, maps not fetched).
    """
    group = bpy.data.node_groups.get(PREVIEW_GROUP)
    if group is None:
        group = bpy.data.node_groups.new(PREVIEW_GROUP, "ShaderNodeTree")
    # The interface stays: a new output socket would drop every material's link to it
    group.nodes.clear()
    sockets = [item.name for item in group.interface.items_tree if item.item_type == "SOCKET"]
    if "Color" not in sockets:
        group.interface.new_socket("Color", in_out="OUTPUT", socket_type="NodeSocketColor")
    if "Splat" not in sockets:
        weights = group.interface.new_socket("Splat", in_out="INPUT",
                                             socket_type="NodeSocketColor")
        weights.default_value = (0.0, 0.0, 0.0, 1.0)
    if "Splat Alpha" not in sockets:
        alpha = group.interface.new_socket("Splat Alpha", in_out="INPUT",
                                           socket_type="NodeSocketFloat")
        alpha.default_value, alpha.min_value, alpha.max_value = 1.0, 0.0, 1.0
    if "AO Strength" not in sockets:
        strength = group.interface.new_socket("AO Strength", in_out="INPUT",
                                              socket_type="NodeSocketFloat")
        strength.default_value, strength.min_value, strength.max_value = 1.0, 0.0, 1.0
    nodes, links = group.nodes, group.links
    notes: list[str] = []
    column = [0]

    def node(kind: str, **settings) -> bpy.types.Node:
        made = nodes.new(kind)
        for key, value in settings.items():
            setattr(made, key, value)
        made.location = (column[0] * 200, -len(nodes) * 30)
        return made

    def feed(socket: bpy.types.NodeSocket, value) -> None:
        if isinstance(value, bpy.types.NodeSocket):
            links.new(value, socket)
        else:
            socket.default_value = value

    def math(operation: str, *values) -> bpy.types.NodeSocket:
        made = node("ShaderNodeMath", operation=operation)
        for socket, value in zip(made.inputs, values):
            feed(socket, value)
        return made.outputs[0]

    def scale(vector, factor) -> bpy.types.NodeSocket:
        made = node("ShaderNodeVectorMath", operation="SCALE")
        feed(made.inputs[0], vector)
        feed(made.inputs["Scale"], factor)
        return made.outputs[0]

    def add(a, b) -> bpy.types.NodeSocket:
        made = node("ShaderNodeVectorMath", operation="ADD")
        feed(made.inputs[0], a)
        feed(made.inputs[1], b)
        return made.outputs[0]

    group_input = node("NodeGroupInput")
    channels = node("ShaderNodeSeparateColor")
    links.new(group_input.outputs["Splat"], channels.inputs[0])
    painted = [channels.outputs[0], channels.outputs[1], channels.outputs[2]]
    if layout == "RGBA":
        painted.append(group_input.outputs["Splat Alpha"])
    position = node("ShaderNodeNewGeometry").outputs["Position"]

    # Each layer: its colour and height (a texture set's fetched maps, else a flat colour)
    column[0] = 1
    layers = []
    for index, set_id in enumerate(layer_ids[: 1 + len(painted)]):
        if index > 0 and set_id == NO_SET:
            continue
        info = sets.get(set_id)
        if set_id != NO_SET and info is None:
            notes.append(f'Layer {index}: no texture set "{set_id}"')
        color, height, contrast = FALLBACK_COLORS[index], 0.5, 1.0
        if info is not None and info["color"]:
            width, depth = info["physical_size"]
            tiled = node("ShaderNodeVectorMath", operation="DIVIDE")
            links.new(position, tiled.inputs[0])
            tiled.inputs[1].default_value = (width, depth, 1.0)
            color_map = node("ShaderNodeTexImage", extension="REPEAT")
            color_map.image = bpy.data.images.load(info["color"], check_existing=True)
            color_map.image.colorspace_settings.name = "sRGB"
            links.new(tiled.outputs[0], color_map.inputs["Vector"])
            color = color_map.outputs["Color"]
            if info["tint"] != (1.0, 1.0, 1.0):
                tint = node("ShaderNodeVectorMath", operation="MULTIPLY")
                links.new(color, tint.inputs[0])
                tint.inputs[1].default_value = info["tint"]
                color = tint.outputs[0]
            if info["height"]:
                height_map = node("ShaderNodeTexImage", extension="REPEAT")
                height_map.image = bpy.data.images.load(info["height"], check_existing=True)
                height_map.image.colorspace_settings.name = "Non-Color"
                links.new(tiled.outputs[0], height_map.inputs["Vector"])
                height = height_map.outputs["Color"]
            contrast = info["height_contrast"]
        elif info is not None:
            notes.append(f'Layer {index}: "{set_id}" isn\'t fetched (yarn fetchTextureSources '
                         f"--only {set_id}): a flat colour")
        layers.append({"index": index, "color": color, "height": height, "contrast": contrast})

    # The weights: each painted layer its channel, the base what they leave (`Weights.ts`)
    column[0] = 3
    weights = {}
    total = None
    for layer in layers[1:]:
        weights[layer["index"]] = painted[layer["index"] - 1]
        weight = weights[layer["index"]]
        total = weight if total is None else math("ADD", total, weight)
    weights[0] = math("MAXIMUM", math("SUBTRACT", 1.0, total), 0.0) if total is not None else 1.0

    # The engine's height blend: w'ᵢ = (max(hᵢ + wᵢ − (maxⱼ(hⱼ + wⱼ) − depth), 0) + floor) · wᵢ
    column[0] = 4
    if height_blend and len(layers) > 1:
        peaks = []
        for layer in layers:
            blend_height = math("MULTIPLY_ADD", math("SUBTRACT", layer["height"], 0.5),
                                layer["contrast"], 0.5)
            peaks.append(math("ADD", blend_height, weights[layer["index"]]))
        top = peaks[0]
        for peak in peaks[1:]:
            top = math("MAXIMUM", top, peak)
        top = math("SUBTRACT", top, blend_depth)
        shares = [
            math("MULTIPLY", math("ADD", math("MAXIMUM", math("SUBTRACT", peak, top), 0.0),
                                  SHARE_FLOOR), weights[layer["index"]])
            for peak, layer in zip(peaks, layers)
        ]
    else:
        shares = [weights[layer["index"]] for layer in layers]

    # The colours by their shares over the shares' sum
    column[0] = 6
    color = None
    share_sum = None
    for share, layer in zip(shares, layers):
        weighted = scale(layer["color"], share)
        color = weighted if color is None else add(color, weighted)
        share_sum = share if share_sum is None else math("ADD", share_sum, share)
    color = scale(color, math("DIVIDE", 1.0, math("MAXIMUM", share_sum, SUM_FLOOR)))
    if layout == "RGB_AO":
        strength = group_input.outputs["AO Strength"]
        color = scale(color, math("MULTIPLY_ADD", group_input.outputs["Splat Alpha"], strength,
                                  math("SUBTRACT", 1.0, strength)))
    column[0] = 7
    links.new(color, node("NodeGroupOutput").inputs["Color"])
    return group, notes


def ensure_preview_material(scene: bpy.types.Scene) -> bpy.types.Material:
    """The shared preview material: the preview group as the base colour of a rough Principled
    BSDF. The group is built from the scene's layers when it doesn't exist yet.
    """
    group = bpy.data.node_groups.get(PREVIEW_GROUP)
    if group is None:
        settings = scene.aek_terrain_preview
        root = get_repo_root(bpy.context)
        group, _ = build_preview_group(
            settings.get_layer_ids(), get_texture_sets(root) if root else {},
            layout=settings.layout, height_blend=settings.height_blend,
            blend_depth=settings.blend_depth,
        )
    material = bpy.data.materials.get(PREVIEW_MATERIAL)
    if material is None:
        material = bpy.data.materials.new(PREVIEW_MATERIAL)
    if material.node_tree is None:
        material.use_nodes = True
    nodes, links = material.node_tree.nodes, material.node_tree.links
    preview = get_preview_group_node(material)
    if preview is not None:
        link_vertex_splat(material.node_tree, preview)
        set_preview_ao_strength(scene.aek_terrain_preview.ao_strength)
        return material
    bsdf = next((n for n in nodes if n.type == "BSDF_PRINCIPLED"), None)
    if bsdf is None:
        bsdf = nodes.new("ShaderNodeBsdfPrincipled")
        output = next((n for n in nodes if n.type == "OUTPUT_MATERIAL"), None)
        output = output or nodes.new("ShaderNodeOutputMaterial")
        links.new(bsdf.outputs["BSDF"], output.inputs["Surface"])
    preview = nodes.new("ShaderNodeGroup")
    preview.node_tree = group
    preview.location = (bsdf.location.x - 250, bsdf.location.y)
    links.new(preview.outputs["Color"], bsdf.inputs["Base Color"])
    link_vertex_splat(material.node_tree, preview)
    bsdf.inputs["Roughness"].default_value = 1.0
    set_preview_ao_strength(scene.aek_terrain_preview.ao_strength)
    return material


def link_vertex_splat(tree: bpy.types.NodeTree, preview: bpy.types.Node) -> None:
    """Feeds the `Splat` colour attribute (the vertex weights) into the preview group node's weight
    inputs, unless something already does
    """
    if preview.inputs["Splat"].is_linked:
        return
    attribute = tree.nodes.new("ShaderNodeVertexColor")
    attribute.layer_name = SPLAT_ATTRIBUTE
    attribute.location = (preview.location.x - 220, preview.location.y)
    tree.links.new(attribute.outputs["Color"], preview.inputs["Splat"])
    tree.links.new(attribute.outputs["Alpha"], preview.inputs["Splat Alpha"])


def get_preview_group_node(material: bpy.types.Material | None) -> bpy.types.Node | None:
    """The preview material's group node"""
    if material is None or material.node_tree is None:
        return None
    group = bpy.data.node_groups.get(PREVIEW_GROUP)
    return next((n for n in material.node_tree.nodes
                 if n.type == "GROUP" and group is not None and n.node_tree == group), None)


def set_preview_ao_strength(value: float) -> None:
    """The preview materials' AO strength (their group nodes' input), live"""
    for material in bpy.data.materials:
        preview = get_preview_group_node(material)
        if preview is not None:
            preview.inputs["AO Strength"].default_value = value


# --- Splat maps ---------------------------------------------------------------------------------
#
# A block painted in Texture Paint: its splat map `<id>_splat0` (RGBA weigh layers 1-4, the
# engine's `SPLAT_MAP`), drawn by a preview material of the block's own whose weights come from
# the image through the UVs. Export saves the image as a PNG with its texture JSON stub.

#: The splat map's name suffix (`BLOCK_IMAGES`' first splat map)
SPLAT_MAP_SUFFIX = "_splat0"
#: The material's custom prop naming its splat map, so Update Preview finds it
SPLAT_MAP_PROP = "aekSplatMap"
SPLAT_MAP_SIZE_ITEMS = [(str(s), f"{s} px", f"{s} × {s} pixels") for s in (256, 512, 1024, 2048,
                                                                            4096)]


def ensure_splat_map_material(scene: bpy.types.Scene, block_id: str,
                              image: bpy.types.Image) -> bpy.types.Material:
    """The block's own preview material (`AEK Terrain Preview <id>`, a copy of the shared one)
    with its weights from `image` through the UVs: RGB weigh layers 1-3, and A layer 4 when the
    scene's preview layout is `RGBA` (with `RGB + AO` the preview shows no AO: the engine has no
    vertex AO on a splat map). The image node is the active one, which Texture Paint paints.
    """
    base = ensure_preview_material(scene)
    name = f"{PREVIEW_MATERIAL} {block_id}"
    material = bpy.data.materials.get(name)
    if material is None:
        material = base.copy()
        material.name = name
    material[SPLAT_MAP_PROP] = image.name
    tree = material.node_tree
    preview = get_preview_group_node(material)
    for socket in (preview.inputs["Splat"], preview.inputs["Splat Alpha"]):
        for link in list(socket.links):
            tree.links.remove(link)
    for stale in [n for n in tree.nodes if n.type == "VERTEX_COLOR"]:
        tree.nodes.remove(stale)
    texture = next((n for n in tree.nodes if n.type == "TEX_IMAGE"), None)
    if texture is None:
        texture = tree.nodes.new("ShaderNodeTexImage")
        texture.location = (preview.location.x - 300, preview.location.y)
    texture.image = image
    texture.interpolation = "Linear"
    texture.extension = "EXTEND"
    tree.links.new(texture.outputs["Color"], preview.inputs["Splat"])
    if scene.aek_terrain_preview.layout == "RGBA":
        tree.links.new(texture.outputs["Alpha"], preview.inputs["Splat Alpha"])
    else:
        preview.inputs["Splat Alpha"].default_value = 1.0
    tree.nodes.active = texture
    return material


def update_splat_map_materials(scene: bpy.types.Scene) -> None:
    """Relinks every block's splat map material for the scene's preview layout"""
    for material in list(bpy.data.materials):
        image = bpy.data.images.get(material.get(SPLAT_MAP_PROP, ""))
        if image is not None and get_preview_group_node(material) is not None:
            block_id = material.name[len(PREVIEW_MATERIAL) + 1 :]
            ensure_splat_map_material(scene, block_id, image)


class AEK_OT_new_splat_map(bpy.types.Operator):
    """Give the active block a splat map to paint in Texture Paint: <id>_splat0, a Non-Color
    RGBA image (layers 1-4), drawn by a preview material of the block's own
    """

    bl_idname = "aek.new_splat_map"
    bl_label = "New Splat Map"
    bl_options = {"REGISTER", "UNDO"}

    size: EnumProperty(  # type: ignore[valid-type]
        name="Size", description="About 1K for a 64 m block: 6 cm a texel",
        items=SPLAT_MAP_SIZE_ITEMS, default="1024",
    )

    @classmethod
    def poll(cls, context: bpy.types.Context) -> bool:
        return (get_block_settings(context.active_object) is not None
                and context.mode in {"OBJECT", "PAINT_TEXTURE"})

    def invoke(self, context: bpy.types.Context, event: bpy.types.Event) -> set[str]:
        return context.window_manager.invoke_props_dialog(self)

    def execute(self, context: bpy.types.Context) -> set[str]:
        obj = context.active_object
        name = obj.aek_terrain_block.block_id + SPLAT_MAP_SUFFIX
        image = bpy.data.images.get(name)
        if image is None:
            size = int(self.size)
            # Non-Color from the start: setting the colour space later reloads the image, blank
            image = bpy.data.images.new(name, size, size, alpha=True, is_data=True)
            # A weighs layer 4: kept apart from RGB, not as transparency
            image.alpha_mode = "CHANNEL_PACKED"
            image.generated_color = (0.0, 0.0, 0.0, 0.0)
            self.report({"INFO"}, f"{name}: {size}² pixels, black (the base layer)")
        else:
            self.report({"INFO"}, f"{name} is there already ({image.size[0]}² pixels): drawn by "
                        "the block's material")
        material = ensure_splat_map_material(context.scene, obj.aek_terrain_block.block_id, image)
        if obj.data.materials:
            obj.data.materials[0] = material
        else:
            obj.data.materials.append(material)
        if context.scene.aek_terrain_preview.layout != "RGBA":
            self.report({"WARNING"}, "The preview shows layers 1-3 (RGB + AO): set the Preview "
                        "Material's layout to RGBA to see layer 4, the map's alpha")
        return {"FINISHED"}


class AEK_OT_update_terrain_preview(bpy.types.Operator):
    """Rebuild the preview material from the scene's layers (and find new or fetched sets)"""

    bl_idname = "aek.update_terrain_preview"
    bl_label = "Update Preview"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context: bpy.types.Context) -> set[str]:
        root = get_repo_root(context)
        if root is None:
            self.report({"ERROR"}, "No repo folder: set it in the add-on's preferences, or save "
                        "the .blend inside the repo")
            return {"CANCELLED"}
        settings = context.scene.aek_terrain_preview
        _, notes = build_preview_group(
            settings.get_layer_ids(), get_texture_sets(root, refresh=True),
            layout=settings.layout, height_blend=settings.height_blend,
            blend_depth=settings.blend_depth,
        )
        ensure_preview_material(context.scene)
        update_splat_map_materials(context.scene)
        for note in notes:
            self.report({"WARNING"}, note)
        used = sum(1 for set_id in settings.get_layer_ids()[1:] if set_id != NO_SET)
        self.report({"INFO"}, f"Preview: the base and {used} painted layers")
        return {"FINISHED"}


class AEK_addon_preferences(bpy.types.AddonPreferences):
    """The add-on's preferences: where the repo is, for the texture sets' maps"""

    bl_idname = __name__

    repo_root: StringProperty(  # type: ignore[valid-type]
        name="Repo Folder",
        description="The Ækasha repo (holding src/toolkit/textures/): the preview's texture sets. "
        "Empty: the folder above the saved .blend",
        subtype="DIR_PATH",
        default="",
    )

    def draw(self, context: bpy.types.Context) -> None:
        self.layout.prop(self, "repo_root")


# --- Decals (p309 D3) ---------------------------------------------------------------------------
#
# A decal set: a collection of decal meshes on one block, exported as one GLB in the block's own
# space (the engine's `*.decalSet.json`, spawned with the block at its grid place). A decal is a
# quad (a strip: tiles along a path curve) with two UV maps: `UVMap`, its atlas cell (TEXCOORD_0,
# the engine's `uv`), and `DecalUV`, 0..1 over the whole decal (TEXCOORD_1, the engine's `uv1`,
# which the decal material's edge fade reads). Its modifiers: Array (a strip: tiles fitted to the
# curve, each the cell again), the "AEK Decal" group (subdivides to about the block's grid
# spacing, and writes DecalUV from the bounds: after the Array, whose UV offset would move every
# UV map), Curve (a strip), Shrinkwrap onto the block (projected along Z, an offset above it).

#: The atlas cell's UV map (TEXCOORD_0) and the one over the decal (TEXCOORD_1, the engine's uv1)
DECAL_ATLAS_UV = "UVMap"
DECAL_UV = "DecalUV"
#: The decal's Geometry Nodes group, and its Blender preview material
DECAL_GROUP = "AEK Decal"
DECAL_PREVIEW_MATERIAL = "AEK Decal Preview"
#: A decal atlas's slots (p309 D1's DECAL packing): what tells one from another atlas
DECAL_SLOTS = ("albedoAlpha", "normalRough")
#: How far a decal sits over its block (the Shrinkwrap's offset), metres; the material's polygon
#: offset does the rest
DECAL_OFFSET = 0.015
#: The finest subdivision Add Decal gives (4^6 faces a tile)
DECAL_MAX_LEVEL = 6
#: A new strip's path: three points along +x, metres from the 3D cursor
STRIP_PATH = ((-6.0, -1.5), (0.0, 1.5), (6.0, -1.0))

#: The decal set's export: the locked settings, the meshes already evaluated (so nothing to apply),
#: no colour or other attribute (a decal has its two UV maps only)
DECAL_EXPORT_SETTINGS = {
    **LOCKED_EXPORT_SETTINGS,
    "export_apply": False,
    "export_vertex_color": "NONE",
    "export_attributes": False,
}


def get_decal_cell_uv(size: tuple[int, int], padding: int, rect: list[int]) -> tuple[float, ...]:
    """A cell's content rect as the engine's UVs `(u0, v0, u1, v1)`, v up: its `rect` inset by the
    padding, as the gather's cell table (`getAtlasCellTable`)
    """
    width, height = size
    x, y, w, h = rect[0] + padding, rect[1] + padding, rect[2] - 2 * padding, rect[3] - 2 * padding
    return (x / width, 1 - (y + h) / height, (x + w) / width, 1 - y / height)


def to_blender_uv(cell_uv: tuple[float, ...], u: float, v: float) -> tuple[float, float]:
    """A decal's (u, v) in 0..1 as its Blender atlas UV: the engine's UV in the cell, V flipped
    (the glTF exporter flips it back)
    """
    u0, v0, u1, v1 = cell_uv
    return (u0 + u * (u1 - u0), 1 - (v0 + v * (v1 - v0)))


def find_decal_atlases(root: str) -> dict[str, dict]:
    """The decal atlases under the repo (a `*.textureAtlas.json` with the DECAL packing's slots), by
    id: their cells by id, each its engine UV rect, `physicalSize` (metres; None without) and
    `tileAlong`. A cell without an explicit `rect` (packed) is left out: its place is the packer's.
    """
    atlases: dict[str, dict] = {}
    for parts in TEXTURE_SET_FOLDERS:
        for folder, _dirs, files in os.walk(os.path.join(root, *parts)):
            for file in files:
                if not file.endswith(".textureAtlas.json"):
                    continue
                try:
                    with open(os.path.join(folder, file), encoding="utf-8") as f:
                        data = json.load(f)
                except (OSError, ValueError):
                    continue
                if not all(slot in (data.get("slots") or {}) for slot in DECAL_SLOTS):
                    continue
                atlas_id = data.get("id") or file[: -len(".textureAtlas.json")]
                size, padding = tuple(data["size"]), int(data.get("padding", 0))
                cells = {}
                for cell in data.get("cells", []):
                    if "rect" not in cell:
                        continue
                    cell_data = cell.get("data") or {}
                    physical = cell_data.get("physicalSize")
                    cells[cell["id"]] = {
                        "uv": get_decal_cell_uv(size, padding, cell["rect"]),
                        "size": (float(physical[0]), float(physical[1])) if physical else None,
                        "tile_along": cell_data.get("tileAlong", "NONE"),
                    }
                atlases[atlas_id] = {"id": atlas_id, "cells": cells}
    return atlases


_decal_atlases_cache: dict[str, dict] = {}


def get_decal_atlases(root: str, refresh: bool = False) -> dict[str, dict]:
    """`find_decal_atlases`, kept per root until `refresh`"""
    if refresh or root not in _decal_atlases_cache:
        _decal_atlases_cache[root] = find_decal_atlases(root)
    return _decal_atlases_cache[root]


def build_decal_mesh(name: str, cell_uv: tuple[float, ...], width: float, depth: float,
                     strip: bool) -> bpy.types.Mesh:
    """A decal's quad, `width` along x and `depth` along y: centred, or for a strip's tile from x 0
    (the path's start); its atlas UVs in the cell (u along x, v along y: the cell's top at +y, the
    engine's -z) and DecalUV 0..1; smooth shaded
    """
    x0 = 0.0 if strip else -width / 2
    corners = ((0, 0), (1, 0), (1, 1), (0, 1))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([(x0 + u * width, (v - 0.5) * depth, 0.0) for u, v in corners], [],
                     [(0, 1, 2, 3)])
    atlas, decal = mesh.uv_layers.new(name=DECAL_ATLAS_UV), mesh.uv_layers.new(name=DECAL_UV)
    for loop in mesh.loops:
        u, v = corners[loop.vertex_index]
        atlas.data[loop.index].uv = to_blender_uv(cell_uv, u, v)
        decal.data[loop.index].uv = (u, v)
    mesh.shade_smooth()
    return mesh


def ensure_decal_group() -> bpy.types.GeometryNodeTree:
    """The "AEK Decal" group (made once): Subdivide Mesh by its Level, then DecalUV = the position
    over the bounds in x and y (0..1 over the whole decal, a strip's whole length)
    """
    tree = bpy.data.node_groups.get(DECAL_GROUP)
    if tree is not None:
        return tree
    tree = bpy.data.node_groups.new(DECAL_GROUP, "GeometryNodeTree")
    tree.interface.new_socket("Geometry", in_out="INPUT", socket_type="NodeSocketGeometry")
    level = tree.interface.new_socket(
        "Level", in_out="INPUT", socket_type="NodeSocketInt",
        description="Subdivisions: a face's edge about the block's grid spacing, so the "
        "Shrinkwrap follows its relief",
    )
    level.default_value, level.min_value, level.max_value = 0, 0, DECAL_MAX_LEVEL
    tree.interface.new_socket("Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")
    nodes, links = tree.nodes, tree.links

    def node(kind: str, x: float, y: float, **props) -> bpy.types.Node:
        made = nodes.new(kind)
        made.location = (x, y)
        for key, value in props.items():
            setattr(made, key, value)
        return made

    group_in, group_out = node("NodeGroupInput", -600, 0), node("NodeGroupOutput", 600, 0)
    subdivide = node("GeometryNodeSubdivideMesh", -400, 0)
    links.new(group_in.outputs["Geometry"], subdivide.inputs["Mesh"])
    links.new(group_in.outputs["Level"], subdivide.inputs["Level"])
    bounds = node("GeometryNodeBoundBox", -200, -200)
    links.new(subdivide.outputs["Mesh"], bounds.inputs["Geometry"])
    position = node("GeometryNodeInputPosition", -200, -400)
    offset = node("ShaderNodeVectorMath", 0, -300, operation="SUBTRACT")
    links.new(position.outputs["Position"], offset.inputs[0])
    links.new(bounds.outputs["Min"], offset.inputs[1])
    extent = node("ShaderNodeVectorMath", 0, -450, operation="SUBTRACT")
    links.new(bounds.outputs["Max"], extent.inputs[0])
    links.new(bounds.outputs["Min"], extent.inputs[1])
    # Blender's vector divide gives 0 for z's zero extent; a FLOAT2 keeps x and y
    share = node("ShaderNodeVectorMath", 200, -350, operation="DIVIDE")
    links.new(offset.outputs[0], share.inputs[0])
    links.new(extent.outputs[0], share.inputs[1])
    store = node("GeometryNodeStoreNamedAttribute", 400, 0, data_type="FLOAT2", domain="CORNER")
    store.inputs["Name"].default_value = DECAL_UV
    links.new(subdivide.outputs["Mesh"], store.inputs["Geometry"])
    links.new(share.outputs[0], next(s for s in store.inputs if s.name == "Value" and s.enabled))
    links.new(store.outputs["Geometry"], group_out.inputs["Geometry"])
    return tree


def ensure_decal_preview_material() -> bpy.types.Material:
    """A stand-in look (Blender can't read the atlas's KTX2 outputs): a dark stain whose alpha is
    the engine's edge fade over DecalUV (a tenth at each edge), so a decal's shape and fade show
    """
    material = bpy.data.materials.get(DECAL_PREVIEW_MATERIAL)
    if material is not None:
        return material
    material = bpy.data.materials.new(DECAL_PREVIEW_MATERIAL)
    material.use_nodes = True
    material.surface_render_method = "BLENDED"
    tree = material.node_tree
    nodes, links = tree.nodes, tree.links
    shader = next(n for n in nodes if n.type == "BSDF_PRINCIPLED")
    shader.inputs["Base Color"].default_value = (0.08, 0.06, 0.04, 1.0)
    shader.inputs["Roughness"].default_value = 0.7
    uv = nodes.new("ShaderNodeUVMap")
    uv.uv_map = DECAL_UV
    split = nodes.new("ShaderNodeSeparateXYZ")
    links.new(uv.outputs["UV"], split.inputs[0])
    fade = None
    for axis in ("X", "Y"):
        for flip in (False, True):
            value = split.outputs[axis]
            if flip:
                minus = nodes.new("ShaderNodeMath")
                minus.operation = "SUBTRACT"
                minus.inputs[0].default_value = 1.0
                links.new(value, minus.inputs[1])
                value = minus.outputs[0]
            edge = nodes.new("ShaderNodeMapRange")
            edge.interpolation_type = "SMOOTHSTEP"
            edge.inputs["From Max"].default_value = 0.1
            links.new(value, edge.inputs["Value"])
            if fade is None:
                fade = edge.outputs["Result"]
            else:
                product = nodes.new("ShaderNodeMath")
                product.operation = "MULTIPLY"
                links.new(fade, product.inputs[0])
                links.new(edge.outputs["Result"], product.inputs[1])
                fade = product.outputs[0]
    alpha = nodes.new("ShaderNodeMath")
    alpha.operation = "MULTIPLY"
    alpha.inputs[1].default_value = 0.85
    links.new(fade, alpha.inputs[0])
    links.new(alpha.outputs[0], shader.inputs["Alpha"])
    return material


def get_decal_level(block: bpy.types.Object | None, width: float, depth: float) -> int:
    """Add Decal's subdivision: a face's longest edge at most the block's grid spacing"""
    settings = get_block_settings(block)
    spacing = get_spacing(int(settings.size), int(settings.resolution)) if settings else 0.5
    longest = max(width, depth)
    level = 0
    while longest / 2**level > spacing and level < DECAL_MAX_LEVEL:
        level += 1
    return level


def add_strip_path(name: str, location, collection: bpy.types.Collection) -> bpy.types.Object:
    """A strip's path: a 3D Bézier curve of `STRIP_PATH`'s points (auto handles) at `location`"""
    curve = bpy.data.curves.new(name, "CURVE")
    curve.dimensions = "3D"
    spline = curve.splines.new("BEZIER")
    spline.bezier_points.add(len(STRIP_PATH) - 1)
    for point, (x, y) in zip(spline.bezier_points, STRIP_PATH):
        point.co = (x, y, 0.0)
        point.handle_left_type = point.handle_right_type = "AUTO"
    path = bpy.data.objects.new(name, curve)
    path.location = location
    collection.objects.link(path)
    return path


def add_decal(collection: bpy.types.Collection, block: bpy.types.Object, cell_id: str, cell: dict,
              location, *, strip: bool) -> bpy.types.Object:
    """Adds a decal of the cell at its `physicalSize` (1 m without) to the set's collection at
    `location` (z: the block's): its mesh, the preview material and its modifiers (Array and Curve
    along a new path for a strip, the AEK Decal group, Shrinkwrap onto the block)
    """
    width, depth = cell["size"] or (1.0, 1.0)
    location = (location[0], location[1], block.location.z)
    mesh = build_decal_mesh(cell_id, cell["uv"], width, depth, strip)
    mesh.materials.append(ensure_decal_preview_material())
    obj = bpy.data.objects.new(cell_id, mesh)
    obj.location = location
    collection.objects.link(obj)
    if strip:
        path = add_strip_path(f"{obj.name}_path", location, collection)
        array = obj.modifiers.new("Array", "ARRAY")
        array.fit_type = "FIT_CURVE"
        array.curve = path
        array.use_merge_vertices = True
    decal = obj.modifiers.new(DECAL_GROUP, "NODES")
    decal.node_group = ensure_decal_group()
    level_socket = next(s for s in decal.node_group.interface.items_tree
                        if getattr(s, "name", "") == "Level" and s.in_out == "INPUT")
    # Blender 5's group inputs on a modifier: a struct per socket (4.x's ID properties are gone)
    getattr(decal.properties.inputs, level_socket.identifier).value = get_decal_level(
        block, width, depth
    )
    if strip:
        curve = obj.modifiers.new("Curve", "CURVE")
        curve.object = path
        curve.deform_axis = "POS_X"
    wrap = obj.modifiers.new("Shrinkwrap", "SHRINKWRAP")
    wrap.target = block
    wrap.wrap_method = "PROJECT"
    wrap.use_project_z = True
    wrap.use_negative_direction = True
    wrap.use_positive_direction = True
    wrap.wrap_mode = "ABOVE_SURFACE"
    wrap.offset = DECAL_OFFSET
    return obj


#: Blender keeps no reference to a dynamic enum's items: these do
_decal_atlas_item_list: list[tuple] = []
_decal_cell_item_list: list[tuple] = []


def get_enum_number(item_id: str) -> int:
    """A dynamic enum item's number: a hash of its id, so a stored choice survives others added"""
    return zlib.crc32(item_id.encode()) & 0x7FFFFFFF or 1


def _decal_atlas_items(self, context: bpy.types.Context) -> list[tuple]:
    root = get_repo_root(context) if context else None
    atlases = get_decal_atlases(root) if root else {}
    _decal_atlas_item_list[:] = [
        (atlas_id, atlas_id, f"{len(info['cells'])} cells", get_enum_number(atlas_id))
        for atlas_id, info in sorted(atlases.items())
    ]
    return _decal_atlas_item_list or [("NONE", "None", "No decal atlas found in the repo", 0)]


def _is_block(self, obj: bpy.types.Object) -> bool:
    return get_block_settings(obj) is not None


class AEK_PG_decal_set(bpy.types.PropertyGroup):
    """A decal set's settings, on its collection (`collection.aek_decal_set`)"""

    set_id: StringProperty(  # type: ignore[valid-type]
        name="Set ID", description="The decal set's id: its GLB, its importedAsset and "
        "*.decalSet.json, and the id in the block's \"decals\"", default="",
    )
    block: PointerProperty(  # type: ignore[valid-type]
        name="Block", description="The block the decals lie on: their Shrinkwrap target, and the "
        "origin they're exported from", type=bpy.types.Object, poll=_is_block,
    )
    atlas: EnumProperty(  # type: ignore[valid-type]
        name="Atlas", description="The decal atlas whose cells Add Decal offers",
        items=_decal_atlas_items,
    )
    material: StringProperty(  # type: ignore[valid-type]
        name="Material", description="The engine's decal material (the decal set JSON stub's): "
        "<atlas>_blend or <atlas>_cutout", default="decalsGround_blend",
    )
    output_dir: StringProperty(  # type: ignore[valid-type]
        name="Folder", description="Where Export Decal Set writes. Empty: the block's folder",
        subtype="DIR_PATH", default="",
    )


def get_decal_set(collection: bpy.types.Collection | None) -> AEK_PG_decal_set | None:
    """A collection's decal set settings, or None when it isn't a decal set"""
    if collection is None:
        return None
    settings = collection.aek_decal_set
    return settings if settings.set_id else None


def get_active_decal_set(context: bpy.types.Context) -> bpy.types.Collection | None:
    """The decal set being worked on: the active object's, else the active collection"""
    obj = context.active_object
    for collection in obj.users_collection if obj else ():
        if get_decal_set(collection):
            return collection
    collection = context.view_layer.active_layer_collection.collection
    return collection if get_decal_set(collection) else None


def get_decal_set_folder(settings: AEK_PG_decal_set) -> str | None:
    """Where the set exports: its folder, else its block's; None when relative to an unsaved file"""
    if settings.output_dir:
        if settings.output_dir.startswith("//") and not bpy.data.filepath:
            return None
        return os.path.normpath(bpy.path.abspath(settings.output_dir))
    return get_block_folder(settings.block) if settings.block else None


def check_exported_decal_glb(gltf: dict, node_names: list[str]) -> list[Issue]:
    """What the engine needs of a decal set's GLB (D3): a mesh node per decal, each primitive with
    positions, normals and both UV sets (TEXCOORD_1 the edge fade's), no tangents or colours, no
    materials or images
    """
    issues: list[Issue] = []
    nodes = [n for n in gltf.get("nodes", []) if "mesh" in n]
    if sorted(n.get("name", "") for n in nodes) != sorted(node_names):
        issues.append(("ERROR", f"The nodes are {sorted(n.get('name') for n in nodes)}, not the "
                       f"decals {sorted(node_names)}"))
    for mesh in gltf.get("meshes", []):
        for primitive in mesh.get("primitives", []):
            attributes = primitive.get("attributes", {})
            for name in ("POSITION", "NORMAL", "TEXCOORD_0", "TEXCOORD_1"):
                if name not in attributes:
                    issues.append(("ERROR", f"{mesh.get('name')}: no {name}"))
            for name in ("TANGENT", "COLOR_0"):
                if name in attributes:
                    issues.append(("ERROR", f"{mesh.get('name')}: a {name}: the export settings "
                                   "weren't the locked ones"))
    for key in ("materials", "images", "textures"):
        if gltf.get(key):
            issues.append(("ERROR", f"The GLB has {key}: the engine assigns the decal material"))
    return issues


def export_decal_set(context: bpy.types.Context, collection: bpy.types.Collection,
                     folder: str) -> tuple[list[str], list[Issue]]:
    """Exports the set's decals into `folder`: `<setId>.glb`, each decal's evaluated mesh (its
    modifiers applied) as a node named by it, placed relative to the block's origin (the engine
    spawns the set at the block's grid place), its custom props kept (`merge`); then the JSON stubs
    where none are (`<setId>.importedAsset.json`, lossless; `<setId>.decalSet.json` with the set's
    material) and the GLB read back. Returns the files written and the findings.
    """
    settings = collection.aek_decal_set
    set_id, block = settings.set_id, settings.block
    issues: list[Issue] = []
    decals = [obj for obj in collection.all_objects if obj.type == "MESH"]
    depsgraph = context.evaluated_depsgraph_get()
    os.makedirs(folder, exist_ok=True)
    glb_path = os.path.join(folder, f"{set_id}.glb")
    saved = {
        "selected": list(context.selected_objects),
        "active": context.view_layer.objects.active,
        "names": {obj: obj.name for obj in decals},
    }
    copies: list[bpy.types.Object] = []
    try:
        for obj in decals:
            mesh = bpy.data.meshes.new_from_object(obj.evaluated_get(depsgraph))
            missing = [name for name in (DECAL_ATLAS_UV, DECAL_UV) if name not in mesh.uv_layers]
            if missing or list(mesh.uv_layers.keys())[:2] != [DECAL_ATLAS_UV, DECAL_UV]:
                issues.append(("ERROR", f'"{obj.name}" needs the UV maps {DECAL_ATLAS_UV} then '
                               f"{DECAL_UV} (has {list(mesh.uv_layers.keys())})"))
            mesh.materials.clear()
            name = saved["names"][obj]
            obj.name = f"{name}~"
            copy = bpy.data.objects.new(name, mesh)
            copy.matrix_world = obj.matrix_world.copy()
            copy.location -= block.location
            for key in obj.keys():
                copy[key] = obj[key]
            context.scene.collection.objects.link(copy)
            copies.append(copy)
        if any(level == "ERROR" for level, _ in issues):
            return [], issues
        for selected in saved["selected"]:
            selected.select_set(False)
        for copy in copies:
            copy.select_set(True)
        context.view_layer.objects.active = copies[0]
        bpy.ops.export_scene.gltf(filepath=glb_path, **DECAL_EXPORT_SETTINGS)
    finally:
        for copy in copies:
            mesh = copy.data
            bpy.data.objects.remove(copy)
            bpy.data.meshes.remove(mesh)
        for obj, name in saved["names"].items():
            obj.name = name
        for selected in saved["selected"]:
            selected.select_set(True)
        context.view_layer.objects.active = saved["active"]

    written = [glb_path]
    block_id = block.aek_terrain_block.block_id
    imported = {
        "$schema": get_schema_ref(folder, "importedAsset.schema.json"),
        "id": set_id,
        "fileName": f"./{set_id}.glb",
        "optimize": {"profile": "terrainBlock"},
        "debugData": {
            "name": f"Decal set {set_id}",
            "description": f"{len(decals)} decals on the terrain block {block_id}, exported by the "
            "Ækasha terrain add-on in the block's space. The terrainBlock profile keeps their "
            "positions lossless: they lie 1-2 cm over the block.",
        },
    }
    decal_set = {
        "$schema": get_schema_ref(folder, "decalSet.schema.json"),
        "importedAsset": set_id,
        "material": settings.material,
        "debugData": {
            "name": f"Decal set {set_id}",
            "description": f'Decals on the terrain block {block_id}: list "{set_id}" in its '
            "terrainBlock JSON's decals.",
        },
    }
    for name, data in ((f"{set_id}.importedAsset.json", imported),
                       (f"{set_id}.decalSet.json", decal_set)):
        path = os.path.join(folder, name)
        if write_json_if_missing(path, data):
            written.append(path)
    issues += check_exported_decal_glb(read_glb_json(glb_path), list(saved["names"].values()))
    return written, issues


def select_only(context: bpy.types.Context, obj: bpy.types.Object) -> None:
    """Selects `obj` alone and makes it active"""
    for other in context.selected_objects:
        other.select_set(False)
    obj.select_set(True)
    context.view_layer.objects.active = obj


class AEK_OT_add_decal_set(bpy.types.Operator):
    """Add a decal set for the active block: a collection its decals go in, exported as one GLB"""

    bl_idname = "aek.add_decal_set"
    bl_label = "Add Decal Set"
    bl_options = {"REGISTER", "UNDO"}

    @classmethod
    def poll(cls, context: bpy.types.Context) -> bool:
        return get_block_settings(context.active_object) is not None and context.mode == "OBJECT"

    def execute(self, context: bpy.types.Context) -> set[str]:
        block = context.active_object
        block_id = block.aek_terrain_block.block_id
        set_id, number = f"{block_id}_decals", 1
        taken = {c.aek_decal_set.set_id for c in bpy.data.collections}
        while set_id in taken:
            number += 1
            set_id = f"{block_id}_decals{number}"
        collection = bpy.data.collections.new(set_id)
        context.scene.collection.children.link(collection)
        settings = collection.aek_decal_set
        settings.set_id, settings.block = set_id, block
        root = get_repo_root(context)
        atlases = get_decal_atlases(root, refresh=True) if root else {}
        if atlases:
            settings.atlas = "decalsGround" if "decalsGround" in atlases else sorted(atlases)[0]
            settings.material = f"{settings.atlas}_blend"
        layer = context.view_layer.layer_collection.children.get(collection.name)
        if layer is not None:
            context.view_layer.active_layer_collection = layer
        self.report({"INFO"}, f"{set_id}: add its decals with Add Decal")
        return {"FINISHED"}


def _decal_cell_items(self, context: bpy.types.Context) -> list[tuple]:
    collection = get_active_decal_set(context) if context else None
    root = get_repo_root(context) if context else None
    atlas = (get_decal_atlases(root).get(collection.aek_decal_set.atlas)
             if collection and root else None)
    _decal_cell_item_list[:] = [
        (cell_id, cell_id,
         f"{cell['size'][0]:g} × {cell['size'][1]:g} m" if cell["size"] else "No physicalSize: 1 m",
         get_enum_number(cell_id))
        for cell_id, cell in (atlas or {}).get("cells", {}).items()
    ]
    return _decal_cell_item_list or [("NONE", "None", "The set's atlas has no cells", 0)]


class AEK_OT_add_decal(bpy.types.Operator):
    """Add a decal of an atlas cell to the active decal set at the 3D cursor, shrinkwrapped onto
    its block: a quad, or a strip along a new path curve (a cell that tiles along its length)
    """

    bl_idname = "aek.add_decal"
    bl_label = "Add Decal"
    bl_options = {"REGISTER", "UNDO"}
    bl_property = "cell"

    cell: EnumProperty(name="Cell", items=_decal_cell_items)  # type: ignore[valid-type]
    strip: EnumProperty(  # type: ignore[valid-type]
        name="Shape",
        items=[
            ("AUTO", "By the Cell", "A strip when the cell tiles along its length (tileAlong U)"),
            ("QUAD", "Quad", "One quad of the cell's size"),
            ("STRIP", "Strip", "The cell's tiles along a path curve (Array fitted to it)"),
        ],
        default="AUTO",
    )

    @classmethod
    def poll(cls, context: bpy.types.Context) -> bool:
        collection = get_active_decal_set(context)
        return (collection is not None and collection.aek_decal_set.block is not None
                and context.mode == "OBJECT")

    def invoke(self, context: bpy.types.Context, event) -> set[str]:
        context.window_manager.invoke_search_popup(self)
        return {"RUNNING_MODAL"}

    def execute(self, context: bpy.types.Context) -> set[str]:
        collection = get_active_decal_set(context)
        settings = collection.aek_decal_set
        root = get_repo_root(context)
        if root is None:
            self.report({"ERROR"}, "No repo folder: set it in the add-on's preferences, or save "
                        "the .blend inside the repo")
            return {"CANCELLED"}
        atlas = get_decal_atlases(root).get(settings.atlas)
        cell = atlas["cells"].get(self.cell) if atlas else None
        if cell is None:
            self.report({"ERROR"}, f'No cell "{self.cell}" in the atlas "{settings.atlas}"')
            return {"CANCELLED"}
        strip = self.strip == "STRIP" or (self.strip == "AUTO" and cell["tile_along"] == "U")
        obj = add_decal(collection, settings.block, self.cell, cell,
                        context.scene.cursor.location, strip=strip)
        select_only(context, obj)
        return {"FINISHED"}


class AEK_OT_export_decal_set(bpy.types.Operator):
    """Export the active decal set into its folder (the block's by default): its GLB in the
    block's space, and the JSON stubs it lacks
    """

    bl_idname = "aek.export_decal_set"
    bl_label = "Export Decal Set"
    bl_options = {"REGISTER"}

    @classmethod
    def poll(cls, context: bpy.types.Context) -> bool:
        return get_active_decal_set(context) is not None and context.mode == "OBJECT"

    def execute(self, context: bpy.types.Context) -> set[str]:
        collection = get_active_decal_set(context)
        settings = collection.aek_decal_set
        missing = check_exporter_options(DECAL_EXPORT_SETTINGS)
        if missing:
            self.report({"ERROR"}, "This Blender's glTF exporter lacks the locked settings "
                        f"{', '.join(missing)}: the add-on was checked with Blender 5.3")
            return {"CANCELLED"}
        if settings.block is None:
            self.report({"ERROR"}, f"{settings.set_id} has no block: set its Block")
            return {"CANCELLED"}
        if not any(obj.type == "MESH" for obj in collection.all_objects):
            self.report({"ERROR"}, f"{settings.set_id} has no decals: Add Decal")
            return {"CANCELLED"}
        folder = get_decal_set_folder(settings)
        if folder is None:
            self.report({"ERROR"}, "The folder is relative to the .blend: save it first, or give "
                        "the set (or its block) an absolute folder")
            return {"CANCELLED"}
        written, issues = export_decal_set(context, collection, folder)
        for level, message in issues:
            self.report({level}, message)
        if any(level == "ERROR" for level, _ in issues):
            return {"CANCELLED"}
        self.report({"INFO"}, f"{settings.set_id}: {len(written)} files written to {folder}")
        return {"FINISHED"}


# --- The sidebar -------------------------------------------------------------------------------


class VIEW3D_PT_aek_terrain(bpy.types.Panel):
    """The Ækasha tab's terrain block panel"""

    bl_label = "Terrain Blocks"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "Ækasha"

    def draw(self, context: bpy.types.Context) -> None:
        layout = self.layout
        layout.operator(AEK_OT_add_terrain_block.bl_idname, icon="ADD")
        layout.operator(AEK_OT_split_into_blocks.bl_idname, icon="MOD_ARRAY")
        settings = get_block_settings(context.active_object)
        if settings is None:
            layout.label(text="No terrain block selected", icon="INFO")
            return
        box = layout.box()
        box.prop(settings, "block_id")
        row = box.row(align=True)
        row.prop(settings, "size")
        row.prop(settings, "resolution")
        row = box.row(align=True)
        row.prop(settings, "grid_x")
        row.prop(settings, "grid_z")
        box.prop(settings, "layout")
        box.prop(settings, "collider")
        box.prop(settings, "output_dir")

        col = layout.column(align=True)
        col.operator(AEK_OT_validate_terrain_block.bl_idname, icon="CHECKMARK")
        col.operator(AEK_OT_normalize_splat.bl_idname, icon="BRUSH_DATA")
        col.operator(AEK_OT_new_splat_map.bl_idname, icon="TPAINT_HLT")
        col.operator(AEK_OT_bake_ao_to_splat.bl_idname, icon="SHADING_RENDERED")
        col.operator(AEK_OT_bake_color_map.bl_idname, icon="IMAGE_DATA")
        layout.operator(AEK_OT_export_terrain_block.bl_idname, icon="EXPORT")
        issues = _last_validation.get(context.active_object.name)
        if issues is not None:
            box = layout.box()
            box.label(text="Last Validate:" if issues else "Last Validate: valid")
            for level, message in issues:
                box.label(text=message, icon="ERROR" if level == "ERROR" else "INFO")


class VIEW3D_PT_aek_terrain_preview(bpy.types.Panel):
    """The preview material's layers, under the terrain block panel"""

    bl_label = "Preview Material"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "Ækasha"
    bl_parent_id = "VIEW3D_PT_aek_terrain"
    bl_options = {"DEFAULT_CLOSED"}

    def draw(self, context: bpy.types.Context) -> None:
        layout = self.layout
        settings = context.scene.aek_terrain_preview
        if get_repo_root(context) is None:
            layout.label(text="Set the repo folder in the add-on's preferences", icon="ERROR")
        layout.prop(settings, "layout")
        layout.prop(settings, "base")
        layers = 4 if settings.layout == "RGBA" else 3
        for index in range(1, layers + 1):
            layout.prop(settings, f"layer{index}")
        layout.prop(settings, "height_blend")
        row = layout.row()
        row.enabled = settings.height_blend
        row.prop(settings, "blend_depth")
        if settings.layout == "RGB_AO":
            layout.prop(settings, "ao_strength")
        layout.operator(AEK_OT_update_terrain_preview.bl_idname, icon="FILE_REFRESH")


class VIEW3D_PT_aek_decals(bpy.types.Panel):
    """The Ækasha tab's decal set panel (p309 D3)"""

    bl_label = "Decal Sets"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "Ækasha"

    def draw(self, context: bpy.types.Context) -> None:
        layout = self.layout
        layout.operator(AEK_OT_add_decal_set.bl_idname, icon="ADD")
        collection = get_active_decal_set(context)
        if collection is None:
            layout.label(text="Select a block, or a set's decal", icon="INFO")
            return
        settings = collection.aek_decal_set
        box = layout.box()
        box.prop(settings, "set_id")
        box.prop(settings, "block")
        box.prop(settings, "atlas")
        box.prop(settings, "material")
        box.prop(settings, "output_dir")
        layout.operator(AEK_OT_add_decal.bl_idname, icon="MOD_UVPROJECT")
        layout.operator(AEK_OT_export_decal_set.bl_idname, icon="EXPORT")


# --- Registration ------------------------------------------------------------------------------

CLASSES = (
    AEK_addon_preferences,
    AEK_PG_terrain_block,
    AEK_PG_terrain_preview,
    AEK_OT_add_terrain_block,
    AEK_OT_validate_terrain_block,
    AEK_OT_normalize_splat,
    AEK_OT_split_into_blocks,
    AEK_OT_bake_ao_to_splat,
    AEK_OT_bake_color_map,
    AEK_OT_new_splat_map,
    AEK_OT_export_terrain_block,
    AEK_OT_update_terrain_preview,
    AEK_PG_decal_set,
    AEK_OT_add_decal_set,
    AEK_OT_add_decal,
    AEK_OT_export_decal_set,
    VIEW3D_PT_aek_terrain,
    VIEW3D_PT_aek_terrain_preview,
    VIEW3D_PT_aek_decals,
)


def register() -> None:
    for cls in CLASSES:
        bpy.utils.register_class(cls)
    bpy.types.Object.aek_terrain_block = PointerProperty(type=AEK_PG_terrain_block)
    bpy.types.Scene.aek_terrain_preview = PointerProperty(type=AEK_PG_terrain_preview)
    bpy.types.Collection.aek_decal_set = PointerProperty(type=AEK_PG_decal_set)
    bpy.types.VIEW3D_MT_mesh_add.append(draw_add_menu)


def unregister() -> None:
    bpy.types.VIEW3D_MT_mesh_add.remove(draw_add_menu)
    del bpy.types.Collection.aek_decal_set
    del bpy.types.Scene.aek_terrain_preview
    del bpy.types.Object.aek_terrain_block
    for cls in reversed(CLASSES):
        bpy.utils.unregister_class(cls)


if __name__ == "__main__":
    register()
