"""Ækasha Terrain Tools: a Blender add-on for Ækasha terrain blocks.

A terrain block is a square heightfield grid that the engine spawns from a `*.terrainBlock.json`
(the `terrain()` feature, `aekasha/terrain`). This add-on makes one that follows the block
conventions (docs/plans/p306_terrain-blocks-and-procedural-terrain-meshes.md D1), lets you paint
and bake its splat, checks it and exports it with the locked glTF settings (D5).

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

import re

import bpy
import numpy as np
from bpy.props import (
    BoolProperty,
    EnumProperty,
    IntProperty,
    PointerProperty,
    StringProperty,
)

bl_info = {
    "name": "Ækasha Terrain Tools",
    "author": "Ækasha",
    "version": (1, 0, 0),
    "blender": (5, 3, 0),
    "location": "3D Viewport → Sidebar → Ækasha",
    "description": "Terrain blocks for Ækasha: add, paint, bake, validate and export",
    "category": "Object",
}

# --- Conventions (D1) --------------------------------------------------------------------------

#: The block edge lengths, metres
BLOCK_SIZES = (32, 64, 128, 256)
#: The vertices per side: 2^n + 1
BLOCK_RESOLUTIONS = (33, 65, 129, 257, 513)
#: The colour attribute the splat lives in (exported as `COLOR_0`)
SPLAT_ATTRIBUTE = "Splat"
#: The preview material Add assigns (step 4 of the plan grows it into the layered approximation)
PREVIEW_MATERIAL = "AEK Terrain Preview"

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


def get_block_custom_props(size: int, resolution: int, grid_x: int, grid_z: int) -> dict:
    """The custom props the engine reads (D1): a fixed `HEIGHTFIELD` body of `resolution - 1`
    cells a side (`nCols` along x, `nRows` along z), and the block's metadata. `keepMesh` keeps
    the mesh visible when the GLB is spawned as a plain import (`spawnImportedAsset`);
    `spawnTerrainBlock` decides from the block's JSON and ignores them.
    """
    cells = resolution - 1
    return {
        "isPhysObj": 1,
        "keepMesh": 1,
        "rigidType": "FIXED",
        "colliderType": "HEIGHTFIELD",
        "nCols": cells,
        "nRows": cells,
        "aekBlockSize": size,
        "aekBlockRes": resolution,
        "aekGridX": grid_x,
        "aekGridZ": grid_z,
    }


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


def write_block_custom_props(obj: bpy.types.Object) -> None:
    """Writes the engine's custom props (D1) from the block's settings"""
    settings = obj.aek_terrain_block
    props = get_block_custom_props(
        int(settings.size), int(settings.resolution), settings.grid_x, settings.grid_z
    )
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


def ensure_preview_material() -> bpy.types.Material:
    """The shared preview material: for now the splat's colour as the base colour (step 4 of the
    plan makes it the layered approximation of the engine's terrain material)
    """
    material = bpy.data.materials.get(PREVIEW_MATERIAL)
    if material is not None:
        return material
    material = bpy.data.materials.new(PREVIEW_MATERIAL)
    if material.node_tree is None:
        material.use_nodes = True
    nodes, links = material.node_tree.nodes, material.node_tree.links
    bsdf = next((n for n in nodes if n.type == "BSDF_PRINCIPLED"), None)
    if bsdf is None:
        bsdf = nodes.new("ShaderNodeBsdfPrincipled")
        output = next((n for n in nodes if n.type == "OUTPUT_MATERIAL"), None)
        output = output or nodes.new("ShaderNodeOutputMaterial")
        links.new(bsdf.outputs["BSDF"], output.inputs["Surface"])
    splat = nodes.new("ShaderNodeVertexColor")
    splat.layer_name = SPLAT_ATTRIBUTE
    splat.location = (bsdf.location.x - 300, bsdf.location.y)
    links.new(splat.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 1.0
    return material


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
        mesh.materials.append(ensure_preview_material())
        obj = bpy.data.objects.new(block_id, mesh)
        context.collection.objects.link(obj)
        obj.location = get_grid_location(size, self.grid_x, self.grid_z)
        settings = obj.aek_terrain_block
        settings.is_block = True
        settings.block_id = block_id
        settings.size, settings.resolution = self.size, self.resolution
        settings.grid_x, settings.grid_z = self.grid_x, self.grid_z
        settings.layout = self.layout
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


def validate_block(obj: bpy.types.Object, depsgraph, objects) -> list[Issue]:
    """Every check of a block (D1): its transform, its evaluated mesh (modifiers applied, as the
    export writes it), its grid, faces, UVs and splat, and its edges against the blocks next to it
    among `objects`. An `ERROR` makes Export refuse.
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
    props = get_block_custom_props(size, resolution, settings.grid_x, settings.grid_z)
    if any(obj.get(key) != value for key, value in props.items()):
        issues.append(("WARNING", "The custom props differ from the block's settings: the export "
                       "writes them again"))

    evaluated = obj.evaluated_get(depsgraph)
    mesh = evaluated.to_mesh()
    try:
        arrays = read_mesh_arrays(mesh)
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
        box.prop(settings, "output_dir")

        col = layout.column(align=True)
        col.operator(AEK_OT_validate_terrain_block.bl_idname, icon="CHECKMARK")
        col.operator(AEK_OT_normalize_splat.bl_idname, icon="BRUSH_DATA")
        issues = _last_validation.get(context.active_object.name)
        if issues is not None:
            box = layout.box()
            box.label(text="Last Validate:" if issues else "Last Validate: valid")
            for level, message in issues:
                box.label(text=message, icon="ERROR" if level == "ERROR" else "INFO")


# --- Registration ------------------------------------------------------------------------------

CLASSES = (
    AEK_PG_terrain_block,
    AEK_OT_add_terrain_block,
    AEK_OT_validate_terrain_block,
    AEK_OT_normalize_splat,
    VIEW3D_PT_aek_terrain,
)


def register() -> None:
    for cls in CLASSES:
        bpy.utils.register_class(cls)
    bpy.types.Object.aek_terrain_block = PointerProperty(type=AEK_PG_terrain_block)
    bpy.types.VIEW3D_MT_mesh_add.append(draw_add_menu)


def unregister() -> None:
    bpy.types.VIEW3D_MT_mesh_add.remove(draw_add_menu)
    del bpy.types.Object.aek_terrain_block
    for cls in reversed(CLASSES):
        bpy.utils.unregister_class(cls)


if __name__ == "__main__":
    register()
