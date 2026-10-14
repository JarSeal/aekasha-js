// THIS IS AN AUTO-GENERATED FILE, DO NOT MODIFY!
// ALSO, DO NOT MODIFY THE 'generatedAppData.json' FILE)!
import type { SceneData, ScenePrimitiveAssets } from 'aekasha';

export const sceneFileObjects: {
  [sceneId: string]: (sceneData: {
    sceneData: SceneData;
    assets: ScenePrimitiveAssets;
  }) => Promise<void>;
} = {
  banner: async ({ sceneData, assets }) => {
    const module = await import('../../../app/./profiles/banner/banner.ts');
    await (
      module as {
        scene: (sceneData: { sceneData: SceneData; assets: ScenePrimitiveAssets }) => Promise<void>;
      }
    ).scene({ sceneData, assets });
  },
};

export const tslMaterialFileObjects = {
  bannerAether: () => import('../../../app/profiles/banner/bannerAether.tsl.ts'),
};

export const postFxFileObjects = {};
