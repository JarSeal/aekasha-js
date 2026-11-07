// The build-time cell manifest's shape (p353 §3.2, Phase 3 D5): what the gatherer
// (devTools/gather/streamingManifest.ts) writes into a streaming scene's data as `__streaming`, and
// what the runtime loads a cell's JSON content from. Types only: the kernel's `SceneData` imports
// them with `import type`.
import type { CoreEntityOpts } from '../../schemas/_HelperSchemas';
import type { GeoProps } from '../../kernel/assets/Geometry';
import type { MatProps } from '../../kernel/assets/Material';
import type { TextureProps } from '../../kernel/assets/Texture';
import type { ImportAssetParams } from '../../kernel/assets/import/ImportTypes';
import type { LightProps } from '../../kernel/light/Light';
import type { MeshProps } from '../../kernel/mesh/Mesh';

/**
 * A cell's far or kept content layer in a {@link StreamingManifestCell} (p353 Phase 5 D9):
 * indices into the manifest's lists, and its estimated GPU memory. A list it has nothing in is
 * left out.
 */
export type StreamingManifestLayer = {
  /** The far layer's: indices into the manifest's `farMeshes`. The kept layer's: indices into
   * its `meshes` (the oversized meshes, in every cell they overlap). */
  meshes?: number[];
  /** Indices into the manifest's `assets.textures`: the cell-only textures the layer uses. */
  textures?: number[];
  /** Indices into the manifest's `assets.materials`. */
  materials?: number[];
  /** Indices into the manifest's `assets.geometries`. */
  geometries?: number[];
  /** Indices into the manifest's `assets.importedAssets`. */
  importedAssets?: number[];
  /** The estimated GPU bytes of its cell-only textures and imports (their `__vramBytes.out`). */
  bytesEstimate: number;
};

/**
 * One instance of a far mesh group ({@link StreamingFarMesh}): an entry's transform, as its mesh
 * props had it.
 */
export type StreamingFarInstance = Pick<
  MeshProps,
  'position' | 'rotation' | 'quaternion' | 'scale'
>;

/**
 * A far representation in a {@link StreamingManifest} (p353 Phase 5 D7): an entry's coarsest
 * LOD level. With `instances`, one `InstancedMesh` of the props' `geo`, `mat`, `castShadow` and
 * `receiveShadow` drawing every entry of a cell that shares them; without, one mesh of its own.
 */
export type StreamingFarMesh = {
  /** The mesh's props: the entry's, its coarsest level's `geo`, `mat` and `castShadow`, no `lod`
   * and no app id (the near entry keeps it). A group's: those four only. */
  props: MeshProps;
  /** A group's instances, one per entry. */
  instances?: StreamingFarInstance[];
};

/**
 * One cell of a {@link StreamingManifest}: indices into the manifest's lists, its content's bounds
 * and its estimated GPU memory, for its near content (loaded while `RESIDENT` or `NEARBY`), and its
 * far and kept layers. A list the cell has nothing in is left out.
 */
export type StreamingManifestCell = {
  /** Indices into the manifest's `meshes`: the meshes in this cell alone (an oversized one is in
   * `kept`). */
  meshes?: number[];
  /** Indices into the manifest's `lights`. */
  lights?: number[];
  /** Indices into the manifest's `assets.textures`: the cell-only textures its content uses. */
  textures?: number[];
  /** Indices into the manifest's `assets.materials`. */
  materials?: number[];
  /** Indices into the manifest's `assets.geometries`. */
  geometries?: number[];
  /** Indices into the manifest's `assets.importedAssets`. */
  importedAssets?: number[];
  /** Its content's x/z box, `[minX, minZ, maxX, maxZ]` in metres: the positions with their
   * bounding radii (an oversized mesh's whole box, past the cell's edges). */
  bounds: [number, number, number, number];
  /** The estimated GPU bytes of its near content's cell-only textures and imports (their
   * `__vramBytes.out`, where the asset pipeline gave one): what loading it adds. */
  bytesEstimate: number;
  /** Its far content (loaded while `FAR`): its entries' coarsest LOD levels. */
  far?: StreamingManifestLayer;
  /** Its kept content (loaded from `FAR` in): the oversized meshes it overlaps. */
  kept?: StreamingManifestLayer;
};

/**
 * A streaming scene's cell manifest, `SceneData.__streaming` (written by the gatherer): the JSON
 * content the scene's cells hold, each entry and asset once, and per cell key what's in it. The
 * scene's own lists hold its base (loaded with the scene).
 */
export type StreamingManifest = {
  /** The cell size the content was cut at (the scene JSON's `streaming.cellSize`). */
  cellSize: number;
  /** The cells' meshes, resolved (save entries applied). */
  meshes: { props: MeshProps; entityOpts?: CoreEntityOpts }[];
  /** The cells' far representations (p353 Phase 5 D7); left out when there are none. */
  farMeshes?: StreamingFarMesh[];
  /** The cells' point and spot lights, resolved. */
  lights: { lightProps: LightProps; entityOpts?: CoreEntityOpts }[];
  /** The assets only cell content uses, resolved: loaded with each cell that names them. */
  assets: {
    /** Textures (also texture arrays and atlas slots). */
    textures: TextureProps[];
    /** Materials (a TSL material's file loads with them). */
    materials: MatProps[];
    /** Geometries. */
    geometries: GeoProps[];
    /** glTF imports (their geometries are `<id>/<node>`). */
    importedAssets: ImportAssetParams[];
  };
  /** The cells with content, by cell key (`packCellKey(cx, 0, cz)`, as a JSON key). */
  cells: Record<string, StreamingManifestCell>;
};
