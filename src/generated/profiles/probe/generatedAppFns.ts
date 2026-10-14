// THIS IS AN AUTO-GENERATED FILE, DO NOT MODIFY!
// ALSO, DO NOT MODIFY THE 'generatedAppData.json' FILE)!
import type { SceneData, ScenePrimitiveAssets } from 'aekasha';

export const sceneFileObjects: {
  [sceneId: string]: (sceneData: {
    sceneData: SceneData;
    assets: ScenePrimitiveAssets;
  }) => Promise<void>;
} = {
  exampleQuickStart: async ({ sceneData, assets }) => {
    const module = await import('../../../app/./examples/quickStart/exampleQuickStart.ts');
    await (
      module as {
        scene: (sceneData: { sceneData: SceneData; assets: ScenePrimitiveAssets }) => Promise<void>;
      }
    ).scene({ sceneData, assets });
  },
};

export const tslMaterialFileObjects = {
  triplanarCheckerboard: () => import('../../../toolkit/materials/triplanarCheckerboard/triplanarCheckerboard.tsl.ts'),
};

export const postFxFileObjects = {};
