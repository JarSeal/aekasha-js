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


# --- Registration ------------------------------------------------------------------------------

CLASSES = (
    AEK_PG_terrain_block,
    AEK_OT_add_terrain_block,
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
