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
 * One cell of a {@link StreamingManifest}: indices into the manifest's lists, its content's bounds
 * and its estimated GPU memory. A list the cell has nothing in is left out.
 */
export type StreamingManifestCell = {
  /** Indices into the manifest's `meshes`: an oversized mesh is in every cell it overlaps. */
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
  /** The estimated GPU bytes of its cell-only textures and imports (their `__vramBytes.out`,
   * where the asset pipeline gave one): what loading it adds. */
  bytesEstimate: number;
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
