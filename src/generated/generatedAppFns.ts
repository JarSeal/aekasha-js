// THIS IS AN AUTO-GENERATED FILE, DO NOT MODIFY!
// ALSO, DO NOT MODIFY THE 'generatedAppData.json' FILE)!
import type { SceneData, ScenePrimitiveAssets } from 'aekasha';

export const sceneFileObjects: {
  [sceneId: string]: (sceneData: {
    sceneData: SceneData;
    assets: ScenePrimitiveAssets;
  }) => Promise<void>;
} = {
  exampleCharacter: async ({ sceneData, assets }) => {
    const module = await import('../app/./examples/character/exampleCharacter.ts');
    await (
      module as {
        scene: (sceneData: { sceneData: SceneData; assets: ScenePrimitiveAssets }) => Promise<void>;
      }
    ).scene({ sceneData, assets });
  },
  exampleDebugTab: async ({ sceneData, assets }) => {
    const module = await import('../app/./examples/debugTab/exampleDebugTab.ts');
    await (
      module as {
        scene: (sceneData: { sceneData: SceneData; assets: ScenePrimitiveAssets }) => Promise<void>;
      }
    ).scene({ sceneData, assets });
  },
  exampleEcs: async ({ sceneData, assets }) => {
    const module = await import('../app/./examples/ecs/exampleEcs.ts');
    await (
      module as {
        scene: (sceneData: { sceneData: SceneData; assets: ScenePrimitiveAssets }) => Promise<void>;
      }
    ).scene({ sceneData, assets });
  },
  exampleHubHero: async ({ sceneData, assets }) => {
    const module = await import('../app/./examples/hubHero/exampleHubHero.ts');
    await (
      module as {
        scene: (sceneData: { sceneData: SceneData; assets: ScenePrimitiveAssets }) => Promise<void>;
      }
    ).scene({ sceneData, assets });
  },
  exampleLod: async ({ sceneData, assets }) => {
    const module = await import('../app/./examples/lod/exampleLod.ts');
    await (
      module as {
        scene: (sceneData: { sceneData: SceneData; assets: ScenePrimitiveAssets }) => Promise<void>;
      }
    ).scene({ sceneData, assets });
  },
  examplePhysics: async ({ sceneData, assets }) => {
    const module = await import('../app/./examples/physics/examplePhysics.ts');
    await (
      module as {
        scene: (sceneData: { sceneData: SceneData; assets: ScenePrimitiveAssets }) => Promise<void>;
      }
    ).scene({ sceneData, assets });
  },
  exampleQuickStart: async ({ sceneData, assets }) => {
    const module = await import('../app/./examples/quickStart/exampleQuickStart.ts');
    await (
      module as {
        scene: (sceneData: { sceneData: SceneData; assets: ScenePrimitiveAssets }) => Promise<void>;
      }
    ).scene({ sceneData, assets });
  },
  exampleSkyBox: async ({ sceneData, assets }) => {
    const module = await import('../app/./examples/skyBox/exampleSkyBox.ts');
    await (
      module as {
        scene: (sceneData: { sceneData: SceneData; assets: ScenePrimitiveAssets }) => Promise<void>;
      }
    ).scene({ sceneData, assets });
  },
  exampleToolkit: async ({ sceneData, assets }) => {
    const module = await import('../app/./examples/toolkit/exampleToolkit.ts');
    await (
      module as {
        scene: (sceneData: { sceneData: SceneData; assets: ScenePrimitiveAssets }) => Promise<void>;
      }
    ).scene({ sceneData, assets });
  },
  exampleUiKit: async ({ sceneData, assets }) => {
    const module = await import('../app/./examples/uiKit/exampleUiKit.ts');
    await (
      module as {
        scene: (sceneData: { sceneData: SceneData; assets: ScenePrimitiveAssets }) => Promise<void>;
      }
    ).scene({ sceneData, assets });
  },
  banner: async ({ sceneData, assets }) => {
    const module = await import('../app/./profiles/banner/banner.ts');
    await (
      module as {
        scene: (sceneData: { sceneData: SceneData; assets: ScenePrimitiveAssets }) => Promise<void>;
      }
    ).scene({ sceneData, assets });
  },
  uiKitEmbed: async ({ sceneData, assets }) => {
    const module = await import('../app/./profiles/uiKit/uiKitEmbed.ts');
    await (
      module as {
        scene: (sceneData: { sceneData: SceneData; assets: ScenePrimitiveAssets }) => Promise<void>;
      }
    ).scene({ sceneData, assets });
  },
  assetCompare: async ({ sceneData, assets }) => {
    const module = await import('../app/./scenes/assetCompare/assetCompare.ts');
    await (
      module as {
        scene: (sceneData: { sceneData: SceneData; assets: ScenePrimitiveAssets }) => Promise<void>;
      }
    ).scene({ sceneData, assets });
  },
  largeWorld: async ({ sceneData, assets }) => {
    const module = await import('../app/./scenes/largeWorld/largeWorld.ts');
    await (
      module as {
        scene: (sceneData: { sceneData: SceneData; assets: ScenePrimitiveAssets }) => Promise<void>;
      }
    ).scene({ sceneData, assets });
  },
  lodShowcase: async ({ sceneData, assets }) => {
    const module = await import('../app/./scenes/lodShowcase/lodShowcase.ts');
    await (
      module as {
        scene: (sceneData: { sceneData: SceneData; assets: ScenePrimitiveAssets }) => Promise<void>;
      }
    ).scene({ sceneData, assets });
  },
  physicsTest: async ({ sceneData, assets }) => {
    const module = await import('../app/./scenes/physicsTest/physicsTest.ts');
    await (
      module as {
        scene: (sceneData: { sceneData: SceneData; assets: ScenePrimitiveAssets }) => Promise<void>;
      }
    ).scene({ sceneData, assets });
  },
  physicsTiers: async ({ sceneData, assets }) => {
    const module = await import('../app/./scenes/physicsTiers/physicsTiers.ts');
    await (
      module as {
        scene: (sceneData: { sceneData: SceneData; assets: ScenePrimitiveAssets }) => Promise<void>;
      }
    ).scene({ sceneData, assets });
  },
  scene01: async ({ sceneData, assets }) => {
    const module = await import('../app/./scenes/scene01/scene01.ts');
    await (
      module as {
        scene: (sceneData: { sceneData: SceneData; assets: ScenePrimitiveAssets }) => Promise<void>;
      }
    ).scene({ sceneData, assets });
  },
  sceneTestECS: async ({ sceneData, assets }) => {
    const module = await import('../app/./scenes/sceneTestECS/sceneTestECS.ts');
    await (
      module as {
        scene: (sceneData: { sceneData: SceneData; assets: ScenePrimitiveAssets }) => Promise<void>;
      }
    ).scene({ sceneData, assets });
  },
  skyShowcase: async ({ sceneData, assets }) => {
    const module = await import('../app/./scenes/skyShowcase/skyShowcase.ts');
    await (
      module as {
        scene: (sceneData: { sceneData: SceneData; assets: ScenePrimitiveAssets }) => Promise<void>;
      }
    ).scene({ sceneData, assets });
  },
  space: async ({ sceneData, assets }) => {
    const module = await import('../app/./scenes/space/space.ts');
    await (
      module as {
        scene: (sceneData: { sceneData: SceneData; assets: ScenePrimitiveAssets }) => Promise<void>;
      }
    ).scene({ sceneData, assets });
  },
  testDebugScene: async ({ sceneData, assets }) => {
    const module = await import('../app/scenes/testDebugScene/testDebugScene.ts');
    await (
      module as {
        scene: (sceneData: { sceneData: SceneData; assets: ScenePrimitiveAssets }) => Promise<void>;
      }
    ).scene({ sceneData, assets });
  },
  textureArrays: async ({ sceneData, assets }) => {
    const module = await import('../app/./scenes/textureArrays/textureArrays.ts');
    await (
      module as {
        scene: (sceneData: { sceneData: SceneData; assets: ScenePrimitiveAssets }) => Promise<void>;
      }
    ).scene({ sceneData, assets });
  },
  textureAtlases: async ({ sceneData, assets }) => {
    const module = await import('../app/./scenes/textureAtlases/textureAtlases.ts');
    await (
      module as {
        scene: (sceneData: { sceneData: SceneData; assets: ScenePrimitiveAssets }) => Promise<void>;
      }
    ).scene({ sceneData, assets });
  },
  thirdPersonGymScene: async ({ sceneData, assets }) => {
    const module = await import('../app/./scenes/thirdPersonGymScene/thirdPersonGymScene.ts');
    await (
      module as {
        scene: (sceneData: { sceneData: SceneData; assets: ScenePrimitiveAssets }) => Promise<void>;
      }
    ).scene({ sceneData, assets });
  },
  topDownTestScene: async ({ sceneData, assets }) => {
    const module = await import('../app/./scenes/topDownTestScene/topDownTestScene.ts');
    await (
      module as {
        scene: (sceneData: { sceneData: SceneData; assets: ScenePrimitiveAssets }) => Promise<void>;
      }
    ).scene({ sceneData, assets });
  },
};

export const tslMaterialFileObjects = {
  bannerAether: () => import('../app/profiles/banner/bannerAether.tsl.ts'),
  testTslMat: () => import('../app/scenes/sceneTestECS/testTslMat.tsl.ts'),
  asteroid: () => import('../toolkit/materials/asteroid/asteroid.tsl.ts'),
  triplanarCheckerboard: () => import('../toolkit/materials/triplanarCheckerboard/triplanarCheckerboard.tsl.ts'),
  triplanarGrid: () => import('../toolkit/materials/triplanarGrid/triplanarGrid.tsl.ts'),
};

export const postFxFileObjects = {
  ambientOcclusion: () => import('../app/postFx/ambientOcclusion.tsl.ts'),
  heroBloom: () => import('../app/examples/hubHero/heroBloom.tsl.ts'),
};
