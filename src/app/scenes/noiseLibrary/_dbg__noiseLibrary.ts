import { createDebuggerTab } from 'aekasha/debug';
import { exportBakeOutputsAsync } from '../../shared/_dbg__exportBake';
import type { NoiseRowResult } from './noiseChecks';
import type { SharedTextureResult } from './sharedTextureChecks';

type Results = {
  backend?: string;
  rows?: Record<string, NoiseRowResult & { label: string }>;
  shared?: Record<string, SharedTextureResult>;
  passed?: boolean;
  error?: string;
};

const format = (value: number) => value.toFixed(3);

/** A row's figures as the tab's read-only fields show them */
const getRowView = (row: NoiseRowResult) => ({
  result: row.failures.length ? `FAIL: ${row.failures.join('; ')}` : 'pass',
  mean: `${format(row.periodic.mean)} | ${format(row.plain.mean)}`,
  std: `${format(row.periodic.std)} | ${format(row.plain.std)}`,
  range: `${format(row.periodic.min)}–${format(row.periodic.max)} | ${format(row.plain.min)}–${format(row.plain.max)}`,
  seam: `${format(row.periodic.wrapStep)} (inside ≤ ${format(row.periodic.neighbourStep)})`,
  periodicity: `${row.periodicityByte} / 25500`,
});

/** A shared texture's figures as the tab's read-only fields show them */
const getSharedView = (result: SharedTextureResult): Record<string, string> => ({
  result: result.failures.length ? `FAIL: ${result.failures.join('; ')}` : 'pass',
  ...Object.fromEntries(
    Object.entries(result.figures).map(([name, value]) => [
      name,
      Number.isInteger(value) ? String(value) : format(value),
    ])
  ),
});

/**
 * The noise library scene's "Noise library" tab (p304 Phase 3, a scene tab: removed on the scene's
 * exit, created again on every visit): the checks' results per row, the periodic bake's figures
 * next to the non-periodic one's (periodic | non-periodic), then the shared generated textures'
 * (p304 D4: the macro noise, the ripple atlas), each with an "Export PNG" into its toolkit texture
 * folder's `source/` (p304 D5).
 * @param sceneId the scene the tab belongs to (removed on its exit)
 * @param results the scene's results (`window.__noiseLibrary.results`), complete by now
 */
export const createNoiseLibraryTab = (sceneId: string, results: Results) => {
  const summary = {
    backend: results.backend ?? '-',
    result: results.error
      ? `error: ${results.error}`
      : results.passed
        ? 'every row and shared texture passes'
        : 'a row or a shared texture fails',
  };
  createDebuggerTab({
    id: 'noiseLibraryChecks',
    title: 'Noise library',
    icon: 'texture',
    sceneId,
    state: summary,
    content: () => [
      {
        pane: true,
        content: [
          { key: 'backend', label: 'Backend', readonly: true },
          { key: 'result', label: 'Checks', readonly: true },
          ...Object.entries(results.rows ?? {}).map(([id, row]) => {
            const view = getRowView(row);
            return {
              type: 'folder' as const,
              title: row.label,
              id: `noiseLibraryRow_${id}`,
              content: [
                { key: 'result', target: view, label: 'Result', readonly: true },
                { key: 'mean', target: view, label: 'Mean', readonly: true },
                { key: 'std', target: view, label: 'σ', readonly: true },
                { key: 'range', target: view, label: 'Range', readonly: true },
                { key: 'seam', target: view, label: 'Wrap step', readonly: true },
                { key: 'periodicity', target: view, label: 'Shifted Δ', readonly: true },
              ],
            };
          }),
          ...Object.entries(results.shared ?? {}).map(([id, result]) => {
            const view = getSharedView(result);
            return {
              type: 'folder' as const,
              title: `Shared texture: ${id}`,
              id: `noiseLibraryShared_${id}`,
              content: [
                ...Object.keys(view).map((key) => ({
                  key,
                  target: view,
                  label: key === 'result' ? 'Result' : key,
                  readonly: true,
                })),
                {
                  type: 'button' as const,
                  title: 'Export PNG',
                  label: `Into src/toolkit/textures/${id}/source/`,
                  // The scene's bake has the texture's id and the output `data` (p304 D4, D5)
                  onClick: () =>
                    void exportBakeOutputsAsync(
                      [{ id, output: 'data', fileName: `${id}.png` }],
                      `src/toolkit/textures/${id}/source`
                    ),
                },
              ],
            };
          }),
        ],
      },
    ],
  });
};
