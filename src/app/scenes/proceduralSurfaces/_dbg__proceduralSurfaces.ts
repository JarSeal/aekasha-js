import { createDebuggerTab, updateDebuggerTab } from 'aekasha/debug';
import type { TextureSetPacking } from 'aekasha/texturesets';
import {
  GENERATORS,
  JSON_SETS,
  PACKINGS,
  PROCEDURAL_SURFACES_SCENE_ID,
  setShownPackingAsync,
  type GeneratorResult,
  type JsonSetResult,
  type ProceduralSurfacesResults,
} from './proceduralSurfaces';

const TAB_ID = 'proceduralSurfaces';

/** A generator's figures as the tab's read-only fields show them */
const getGeneratorView = (index: number, result: GeneratorResult | undefined) => {
  const row = index < 5 ? 'back' : 'front';
  const slots = Object.entries(result?.packings ?? {})
    .map(([packing, checks]) => `${packing} ${Object.keys(checks).length}`)
    .join(', ');
  return {
    place: `${row} row, ${(index % 5) + 1} from the left`,
    result: !result ? '-' : result.failures.length ? `FAIL: ${result.failures.join('; ')}` : 'pass',
    slots: slots || '-',
    periodicity: result?.periodicity
      ? `${result.periodicity.offTexels} texels off, up to ${result.periodicity.maxByte} / 25500`
      : '-',
  };
};

/** A JSON set's figures as the tab's read-only fields show them */
const getJsonSetView = (result: JsonSetResult | undefined) => ({
  baked: result ? `${result.generator}, ${result.packing}` : '-',
  result: !result ? '-' : result.failures.length ? `FAIL: ${result.failures.join('; ')}` : 'pass',
  compare: result
    ? Object.entries(result.compare)
        .map(([slot, { maxByte, offTexels }]) => `${slot} ${offTexels} off (${maxByte})`)
        .join(', ')
    : '-',
});

/**
 * The procedural surfaces scene's "Procedural surfaces" tab (p304 Phase 4, a scene tab: removed on
 * the scene's exit, created again on every visit): the packing the blocks show (each generator
 * baked again in it), each generator's checks and the JSON sets' (p304 Phase 4 section 3).
 * @param results the scene's results (`window.__proceduralSurfaces.results`), complete by now
 */
export const createProceduralSurfacesTab = (results: ProceduralSurfacesResults) => {
  const tabState = {
    packing: results.shownPacking ?? 'LITE',
    backend: results.backend ?? '-',
    result: results.error
      ? `error: ${results.error}`
      : results.passed
        ? 'every generator and JSON set passes'
        : 'a generator or JSON set fails',
  };
  createDebuggerTab({
    id: TAB_ID,
    title: 'Procedural surfaces',
    icon: 'texture',
    sceneId: PROCEDURAL_SURFACES_SCENE_ID,
    state: tabState,
    content: () => [
      {
        pane: true,
        content: [
          {
            key: 'packing',
            label: 'Packing',
            kind: 'segmented',
            options: PACKINGS.map((packing) => ({ label: packing, value: packing })),
            hint: 'Bakes every block again in this packing (512²)',
            onChange: (value) =>
              void setShownPackingAsync(value as TextureSetPacking).then(() =>
                updateDebuggerTab(TAB_ID)
              ),
          },
          { key: 'backend', label: 'Backend', readonly: true },
          { key: 'result', label: 'Checks', readonly: true },
          ...GENERATORS.map((generator, index) => {
            const view = getGeneratorView(index, results.generators?.[generator.id]);
            return {
              type: 'folder' as const,
              title: `${generator.id} (${generator.category.toLowerCase()})`,
              id: `proceduralSurfaces_${generator.id}`,
              content: [
                { key: 'place', target: view, label: 'Block', readonly: true },
                { key: 'result', target: view, label: 'Result', readonly: true },
                { key: 'slots', target: view, label: 'Slots read', readonly: true },
                { key: 'periodicity', target: view, label: 'Tile away', readonly: true },
              ],
            };
          }),
          ...JSON_SETS.map((setId) => {
            const view = getJsonSetView(results.jsonSets?.[setId]);
            return {
              type: 'folder' as const,
              title: `${setId} (JSON set)`,
              id: `proceduralSurfaces_${setId}`,
              content: [
                { key: 'baked', target: view, label: 'Baked', readonly: true },
                { key: 'result', target: view, label: 'Result', readonly: true },
                { key: 'compare', target: view, label: 'vs code bake', readonly: true },
              ],
            };
          }),
        ],
      },
    ],
  });
};
