import { createDebuggerTab } from 'aekasha/debug';
import type { NoiseRowResult } from './noiseChecks';

type Results = {
  backend?: string;
  rows?: Record<string, NoiseRowResult & { label: string }>;
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

/**
 * The noise library scene's "Noise library" tab (p304 Phase 3, a scene tab: removed on the scene's
 * exit, created again on every visit): the checks' results per row, the periodic bake's figures
 * next to the non-periodic one's (periodic | non-periodic).
 * @param sceneId the scene the tab belongs to (removed on its exit)
 * @param results the scene's results (`window.__noiseLibrary.results`), complete by now
 */
export const createNoiseLibraryTab = (sceneId: string, results: Results) => {
  const summary = {
    backend: results.backend ?? '-',
    result: results.error
      ? `error: ${results.error}`
      : results.passed
        ? 'every row passes'
        : 'a row fails',
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
        ],
      },
    ],
  });
};
