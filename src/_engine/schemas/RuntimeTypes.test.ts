import { describe, expectTypeOf, test } from 'vitest';
import type { GeoProps } from '../kernel/assets/Geometry';
import type { MatProps } from '../kernel/assets/Material';
import type { TextureProps } from '../kernel/assets/Texture';
import type { createCameraEntity } from '../kernel/camera/Camera';
import type { LightProps } from '../kernel/light/Light';
import type { MeshProps } from '../kernel/mesh/Mesh';
import type { SceneData } from '../kernel/scene/Scene';
import type { EntityDebugData } from '../kernel/ecs/ECSRegistry';
import type { DebugData } from './_HelperSchemas';
import type { ImportAssetParams } from '../kernel/assets/import/ImportTypes';
import type { CameraAsset } from './CameraSchema';
import type { GeoProps as GeoPropsJson } from './GeometrySchema';
import type { ImportedAsset } from './ImportedAssetSchema';
import type { LightAsset } from './LightSchema';
import type { MaterialAsset } from './MaterialSchema';
import type { MeshAsset } from './MeshSchema';
import type { SceneAsset } from './SceneSchema';
import type { TextureAsset } from './TextureSchema';

// p613 D11: each asset JSON's type (the schema's) against the runtime type it reaches, so a value
// the JSON allows can't be one the runtime doesn't take. The runtime types are wider on purpose
// (they also take three's objects), so each pair checks two things: the JSON's type is assignable
// to the runtime's, and the JSON has no key the runtime type lacks but the tooling's. tsc runs
// these (Vitest doesn't type-check): a failure's message is expect-type's, so assign the two
// types to each other in a scratch file to read TypeScript's own.
//
// The differences only in how the types are written, each swapped for the runtime's before the
// comparison:
// - `texOpts`: three's constants (wrapS, minFilter, …) are plain numbers in a JSON. p302 D1 gives
//   the JSON named constants ("wrapS": "REPEAT"), which this swap then maps.
// - A scene's or a mesh's inline material: zod infers the schema's two branches (TSL or not), each
//   with a `type` enum, where the runtime has one member per type, which TypeScript doesn't split
//   on its own (`PerType`, as `MaterialAsset` itself does).

/** Every key of every member of a union (`keyof` alone gives the shared ones). */
type AllKeys<T> = T extends unknown ? keyof T : never;
/** The JSON's keys the runtime type lacks. */
type ExtraKeys<Json, Runtime> = Exclude<AllKeys<Json>, AllKeys<Runtime>>;
/** Keys only the gatherer and the tooling read: no runtime type needs them. */
type ToolingKeys = '$schema' | '__saveData' | '__sourcePath';
/** `Json` with its keys `K` typed as the runtime's. */
type Swap<Json, Runtime, K extends PropertyKey> = Omit<Json, K> & Pick<Runtime, K & keyof Runtime>;

/** One object per `type` literal, as the runtime's union has them. */
type PerType<T> = T extends { type: infer Type }
  ? Type extends unknown
    ? Omit<T, 'type'> & { type: Type }
    : never
  : never;

type TexOptsJson = NonNullable<TextureAsset['texOpts']>;
type TexOptsRuntime = NonNullable<TextureProps['texOpts']>;
type TexOptsSwapped = 'mapping' | 'wrapS' | 'wrapT' | 'magFilter' | 'minFilter' | 'type';
type WithTexOpts<T> = Omit<T, 'texOpts'> & {
  texOpts?: Swap<TexOptsJson, TexOptsRuntime, TexOptsSwapped>;
};

type LightPropsJson = LightAsset['lightProps'];

type ImportTexturesJson = Extract<NonNullable<ImportedAsset['importTextures']>, object>;
/** An import with its `importTextures.texOpts` swapped as a texture's */
type WithImportTexOpts<T extends { importTextures?: unknown }> = Omit<T, 'importTextures'> & {
  importTextures?:
    | boolean
    | (Omit<ImportTexturesJson, 'texOpts'> & {
        texOpts?: Swap<TexOptsJson, TexOptsRuntime, TexOptsSwapped>;
      });
};

type SceneLightJson = Exclude<NonNullable<SceneAsset['lights']>[number], string>;
type SceneTextureJson = Exclude<NonNullable<SceneAsset['textures']>[number], string>;
type SceneMaterialJson = Exclude<NonNullable<SceneAsset['materials']>[number], string>;
type SceneMeshJson = Exclude<NonNullable<SceneAsset['meshes']>[number], string>;
type SceneImportJson = Exclude<NonNullable<SceneAsset['importedAssets']>[number], string>;
/** A mesh's props with its inline material split per type */
type WithMatPerType<Props extends { mat: unknown }> = Omit<Props, 'mat'> & {
  mat: string | PerType<Exclude<Props['mat'], string>>;
};
type SceneJson = Omit<
  SceneAsset,
  'lights' | 'textures' | 'materials' | 'meshes' | 'importedAssets'
> & {
  lights?: (string | (Omit<SceneLightJson, 'lightProps'> & { lightProps: LightPropsJson }))[];
  textures?: (string | WithTexOpts<SceneTextureJson>)[];
  materials?: (string | PerType<SceneMaterialJson>)[];
  meshes?: (
    | string
    | (Omit<SceneMeshJson, 'props'> & { props: WithMatPerType<SceneMeshJson['props']> })
  )[];
  importedAssets?: (string | WithImportTexOpts<SceneImportJson>)[];
};

describe('the asset JSONs fit their runtime types', () => {
  test('geometry (*.geometry.json, a scene or mesh geometry) → GeoProps', () => {
    expectTypeOf<GeoPropsJson>().toExtend<GeoProps>();
    expectTypeOf<ExtraKeys<GeoPropsJson, GeoProps>>().toEqualTypeOf<never>();
  });

  test('material (*.material.json) → MatProps', () => {
    expectTypeOf<MaterialAsset>().toExtend<MatProps>();
    expectTypeOf<ExtraKeys<MaterialAsset, MatProps>>().toEqualTypeOf<ToolingKeys>();
  });

  test('texture (*.texture.json) → TextureProps', () => {
    expectTypeOf<WithTexOpts<TextureAsset>>().toExtend<TextureProps>();
    expectTypeOf<ExtraKeys<TextureAsset, TextureProps>>().toEqualTypeOf<
      // Build time and the Assets tab only: the gatherer drops `optimize` and `pack`
      ToolingKeys | 'optimize' | 'pack' | '__fileSize' | '__bytes' | '__vramBytes' | '__codec'
    >();
    expectTypeOf<ExtraKeys<TexOptsJson, TexOptsRuntime>>().toEqualTypeOf<never>();
  });

  test('camera (*.camera.json camProps) → createCameraEntity', () => {
    type CameraPropsRuntime = Parameters<typeof createCameraEntity>[0];
    expectTypeOf<CameraAsset['camProps']>().toExtend<CameraPropsRuntime>();
    expectTypeOf<ExtraKeys<CameraAsset['camProps'], CameraPropsRuntime>>().toEqualTypeOf<never>();
  });

  test('light (*.light.json lightProps) → LightProps', () => {
    expectTypeOf<LightPropsJson>().toExtend<LightProps>();
    expectTypeOf<ExtraKeys<LightAsset['lightProps'], LightProps>>().toEqualTypeOf<never>();
  });

  test('mesh (*.mesh.json props) → MeshProps', () => {
    type MeshPropsJson = MeshAsset['props'];
    expectTypeOf<WithMatPerType<MeshPropsJson>>().toExtend<MeshProps>();
    expectTypeOf<ExtraKeys<MeshPropsJson, MeshProps>>().toEqualTypeOf<never>();
  });

  test('imported asset (*.importedAsset.json) → ImportAssetParams', () => {
    expectTypeOf<WithImportTexOpts<ImportedAsset>>().toExtend<ImportAssetParams>();
    expectTypeOf<ExtraKeys<ImportedAsset, ImportAssetParams>>().toEqualTypeOf<
      // Build time and the Assets tab only: the gatherer drops `optimize`
      ToolingKeys | 'optimize' | '__fileSize' | '__bytes' | '__vramBytes' | '__lodChain'
    >();
  });

  test('debugData (an entity’s or an asset’s) → EntityDebugData', () => {
    // The same fields: ECSRegistry.ts imports nothing, so it writes the type out
    expectTypeOf<DebugData>().toEqualTypeOf<EntityDebugData>();
  });

  test('scene (*.scene.json, its inline entries as the gatherer keeps them) → SceneData', () => {
    expectTypeOf<SceneJson>().toExtend<SceneData>();
    expectTypeOf<ExtraKeys<SceneAsset, SceneData>>().toEqualTypeOf<
      // Notes for whoever edits the JSON: the gatherer drops them
      ToolingKeys | 'comments' | 'todo'
    >();
  });
});
