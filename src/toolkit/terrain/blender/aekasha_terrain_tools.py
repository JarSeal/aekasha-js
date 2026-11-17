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

import bpy
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
#: The splat's channel layouts (p305 D4): RGB weigh layers 1-3 and A is the baked AO, or RGBA
#: weigh layers 1-4; the base layer takes what they leave
SPLAT_LAYOUTS = ("RGB_AO", "RGBA")


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
        items=[(str(s), f"{s} m", f"{s} × {s} m") for s in BLOCK_SIZES],
        default="64",
    )
    resolution: EnumProperty(  # type: ignore[valid-type]
        name="Resolution",
        description="Vertices per side (2^n + 1): the splat's resolution is the vertex spacing",
        items=[(str(r), str(r), f"{r} × {r} vertices") for r in BLOCK_RESOLUTIONS],
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
        items=[
            ("RGB_AO", "RGB + AO", "RGB weigh layers 1-3, A is the baked ambient occlusion"),
            ("RGBA", "RGBA", "RGBA weigh layers 1-4, no baked AO"),
        ],
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


# --- The sidebar -------------------------------------------------------------------------------


class VIEW3D_PT_aek_terrain(bpy.types.Panel):
    """The Ækasha tab's terrain block panel"""

    bl_label = "Terrain Blocks"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "Ækasha"

    def draw(self, context: bpy.types.Context) -> None:
        layout = self.layout
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
    VIEW3D_PT_aek_terrain,
)


def register() -> None:
    for cls in CLASSES:
        bpy.utils.register_class(cls)
    bpy.types.Object.aek_terrain_block = PointerProperty(type=AEK_PG_terrain_block)


def unregister() -> None:
    del bpy.types.Object.aek_terrain_block
    for cls in reversed(CLASSES):
        bpy.utils.unregister_class(cls)


if __name__ == "__main__":
    register()
