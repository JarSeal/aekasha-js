import { getTextureBakeStats, lerror, type BakedTexture } from 'aekasha';
import { createDebuggerTab } from 'aekasha/debug';

const TAB_ID = 'testDebugSceneBakes';
const SCENE_ID = 'testDebugScene';
/** Rebakes the burst button asks for in one go: the queue makes them one render. */
const BURST_REBAKES = 20;

/**
 * The debug scene's "Texture bakes" tab (p304 Phase 2, a scene tab: removed on the scene's exit,
 * created again on every visit): a slider that moves the layered bake's stripes and checker and
 * rebakes on every change (one bake a frame at most, an id's rebakes at most every 150 ms, the
 * last value always baked), a burst of rebakes that bakes once, and the bake's stats.
 * @param baked the layered MRT bake (`createLayeredBakeCheckAsync`)
 * @param phase the uniform its graph shifts by
 */
export const createTextureBakeTab = (baked: BakedTexture, phase: { value: number }) => {
  const state = { phase: phase.value };
  const stats = { bakes: 0, cpuMs: '-', gpuMs: '-', bakesPerSec: '0.00', lastBurst: '-' };

  const rebake = () => {
    baked.rebake().catch((err) => lerror('[testDebugScene] The rebake failed', err));
  };

  createDebuggerTab({
    id: TAB_ID,
    title: 'Texture bakes',
    icon: 'texture',
    sceneId: SCENE_ID,
    state,
    refreshIntervalMs: 250,
    onRefresh: () => {
      const view = getTextureBakeStats(baked.id);
      if (!view) return;
      stats.bakes = view.bakes;
      stats.cpuMs = view.cpuMs;
      stats.gpuMs = view.gpuMs;
      stats.bakesPerSec = view.bakesPerSec;
    },
    content: () => [
      {
        pane: true,
        content: [
          {
            key: 'phase',
            label: 'Stripe phase',
            min: 0,
            max: 1,
            step: 0.01,
            onChange: (value) => {
              phase.value = Number(value);
              rebake();
            },
          },
          {
            type: 'button',
            title: `Rebake ×${BURST_REBAKES}`,
            label: 'In one go: bakes once',
            onClick: () => {
              const before = getTextureBakeStats(baked.id)?.bakes ?? 0;
              const calls = Array.from({ length: BURST_REBAKES }, () => baked.rebake());
              Promise.all(calls)
                .then(() => {
                  const after = getTextureBakeStats(baked.id)?.bakes ?? 0;
                  stats.lastBurst = `${BURST_REBAKES} calls, ${after - before} bakes`;
                })
                .catch((err) => lerror('[testDebugScene] The rebake burst failed', err));
            },
          },
          {
            type: 'folder',
            title: `Stats (${baked.id})`,
            content: [
              {
                key: 'bakes',
                target: stats,
                label: 'Bakes',
                readonly: true,
                format: (v: number) => String(v),
              },
              { key: 'cpuMs', target: stats, label: 'CPU ms', readonly: true },
              { key: 'gpuMs', target: stats, label: 'GPU ms', readonly: true },
              { key: 'bakesPerSec', target: stats, label: 'Bakes / s', readonly: true },
              { key: 'lastBurst', target: stats, label: 'Last burst', readonly: true },
            ],
          },
        ],
      },
    ],
  });
};
