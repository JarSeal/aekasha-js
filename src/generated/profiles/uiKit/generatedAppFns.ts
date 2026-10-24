// THIS IS AN AUTO-GENERATED FILE, DO NOT MODIFY!
// ALSO, DO NOT MODIFY THE 'generatedAppData.json' FILE)!
import type { SceneData, ScenePrimitiveAssets } from 'aekasha';

export const sceneFileObjects: {
  [sceneId: string]: (sceneData: {
    sceneData: SceneData;
    assets: ScenePrimitiveAssets;
  }) => Promise<void>;
} = {
  uiKitEmbed: async ({ sceneData, assets }) => {
    const module = await import('../../../app/./profiles/uiKit/uiKitEmbed.ts');
    await (
      module as {
        scene: (sceneData: { sceneData: SceneData; assets: ScenePrimitiveAssets }) => Promise<void>;
      }
    ).scene({ sceneData, assets });
  },
};

export const tslMaterialFileObjects = {};

export const postFxFileObjects = {};
