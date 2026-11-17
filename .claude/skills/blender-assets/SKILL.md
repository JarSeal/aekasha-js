---
name: blender-assets
description: Make or change a 3D model, a baked or painted texture, or any Blender file for this repo through the Blender MCP server (Blender Lab's, the `blender` server in `.mcp.json`), and bring the result into Ækasha as an asset. Use when a task needs a model, a mesh with custom props (colliders, merge groups), a texture bake, a render or screenshot of a Blender scene, or a question answered about a .blend file; also to set the server up or find why it doesn't connect.
---

Blender runs on Windows (5.3 checked; the server's Blender add-on needs 5.1+), Claude Code in WSL2. The `blender` MCP server (`.mcp.json` → `devTools/blender/blenderMcp.sh`, a venv `yarn setupBlenderMcp` builds in the gitignored `.tools/blender-mcp/`, pinned to a commit of `projects.blender.org/lab/blender_mcp`) talks to an add-on inside the running Blender over TCP on `localhost:9876`. WSL2's mirrored networking (`networkingMode=mirrored` in the Windows user's `.wslconfig`) makes that `localhost` Windows'.

## Setup (one-time per machine)

1. `source .claude/hooks/use-node.sh && yarn setupBlenderMcp` (python3 ≥ 3.10 with venv; it records the newest Windows Blender ≥ 5.1 for the background tools, or `AEK_BLENDER`).
2. In Blender: _Edit → Preferences → Get Extensions_, the _Repositories_ drop-down → _+ → Add Remote Repository_, URL `https://lab.blender.org/`. Install **MCP** from it and enable it. In its preferences keep host `localhost` and port `9876`, and tick **Auto-start** (otherwise start the server from the add-on each session).
3. In Claude Code, approve the project's `blender` server (`/mcp` lists it, connected).

**Not connecting:** the `blender` server failing at start means step 1 wasn't run (the launcher says so on stderr). A tool call refused with a connection error means Blender isn't open or its add-on's server isn't started. WSL2 in NAT mode (no mirrored networking) can't reach Windows' `localhost`: set `BLENDER_MCP_HOST` to the Windows host's address and the add-on's host to match.

## The tools

- `execute_blender_code`: Python in the open Blender, full `bpy`. Return values by `print()`. The main tool: modelling, modifiers, bakes, export. A 5.x API detail you aren't sure of: `search_api_docs` / `get_python_api_docs` (the bundled reference, matching the server's Blender) before guessing; `search_manual_docs` for the UI.
- `get_objects_summary`, `get_object_detail_summary`, `get_blendfile_summary_*`: inspect before changing.
- `render_thumbnail_to_path` (quick look), `render_viewport_to_path`, `get_screenshot_of_area_as_image` / `_of_window_as_image`: check what you made. Look at every model you make from more than one side before calling it done.
- `*_for_cli` variants run a background Blender (the recorded `blender.exe`) on a .blend without the open one: the file path is a Windows path.

## Rules

- **The open file is the user's.** `execute_blender_code` runs with their Windows rights, and the add-on's "sandbox" only blocks a few calls. Before replacing or closing the open file (`read_homefile`, `open_mainfile`), check `bpy.data.is_dirty` and `bpy.data.filepath`, and ask when it has unsaved work. Never save over a file you didn't create without asking. Build in a fresh file (`bpy.ops.wm.read_homefile(use_empty=True)`, then add a camera and light only when rendering).
- **Paths are Windows paths** in Blender: `wslpath -w <path>` (`\\wsl.localhost\Ubuntu-24.04\home\…`); write them as raw strings in the Python. Renders and screenshots go to the session's scratchpad, then `Read` the image.
- **Units:** metres, scale 1. Blender is +Z up; glTF and the engine +Y up (the exporter's `export_yup`). A model's front toward Blender's −Y (the Front view) faces the engine's +z. Apply rotation and scale before export; the origin is where the engine's transform pivots.
- **Licences:** only your own work or CC0 sources go into the repo. The terrain texture sets come from `yarn fetchTextureSources` (ambientCG, Poly Haven, CC0); say a model's source in its JSON's `debugData.description`.
- **Exporter options change between Blender versions** (`export_colors` became `export_vertex_color` in 4.2): read the operator's properties first (`bpy.ops.export_scene.gltf.get_rna_type().properties.keys()`) instead of trusting a remembered name.

## Bringing a model into Ækasha

1. **Where** (root `CLAUDE.md`, Three-folder split): a toolkit model in `src/toolkit/models/<category>/<id>/`, an app model in the scene's folder (`src/app/scenes/<sceneId>/`) or, once two scenes use it, `src/app/importedAssets/`. The source GLB sits next to its `<id>.importedAsset.json` (`fileName` relative to the JSON; `src/toolkit/models/brand/aekashaSymbol/` is the example).
2. **Export** a GLB of the selected objects: `bpy.ops.export_scene.gltf(filepath=r'…\<id>.glb', export_format='GLB', use_selection=True, export_yup=True, export_apply=True, export_extras=True, export_tangents=False, export_draco_mesh_compression_enable=False)`, plus materials and images only when the model brings its own (a scene usually assigns an engine material). Leave compression to the asset pipeline.
3. **Custom props** (object properties, exported as the node's glTF `extras`): physics (`isPhysObj`, `rigidType`, `colliderType`, `keepMesh`, …; `src/_engine/kernel/assets/import/CustomProps.ts`, the Hub's physics guide `hub/pages/features/physics/guide.md`), a merge group (`merge`, `hub/pages/features/mesh-merging/guide.md`). Set them as `obj["isPhysObj"] = 1`, not through an add-on's `bpy.props`.
4. **The JSON:** `<id>.importedAsset.json` with `$schema`, `id`, `fileName`, `optimize` when the defaults don't fit (`docs/techniques/asset-optimization.md`), `debugData`. Then `yarn assets --only <id>` encodes it into `src/public/aek-assets/` and gathers; commit the GLB, the JSON, the output and `assets.lock.json`.
5. **Use it:** a scene's `importedAssets`, then `spawnImportedAsset` or meshes by geometry id (`hub/pages/features/scenes-and-assets/guide.md`). Look at it in the running app (the `run-aekasha-js` skill).

**A .blend in the repo** only when it's an asset's editable source worth keeping: compressed save, no packed images, relative image paths, `*.blend1` backups never committed (ignored, but a renamed copy isn't).

## Textures

Blender is for bakes (AO, a colour map, a set of your own: `docs/techniques/texture-sets.md`, Blender step by step) and painting, saved as PNG next to their `*.texture.json` and encoded by `yarn assets`. Splat and data maps are Non-Color, 8-bit. A texture painted on a model's UVs likely needs `flipY: false` in its texture JSON, since glTF's V starts at the image's top (p306 Phase 5 checks it with a corner-marker block; until then look at the result in the engine).
