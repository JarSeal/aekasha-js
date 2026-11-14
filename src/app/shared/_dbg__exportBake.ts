// The verification scenes' "Export PNG" buttons (p304 D5): a bake's outputs through the engine's
// `exportBakedTexture`, asking before a PNG with other pixels is replaced, with a toast for the
// outcome.
import { exportBakedTexture, lerror, type BakedTextureExport } from 'aekasha';
import { addDebugToast } from 'aekasha/debug';

/** One output to export: the bake's id, the output and, when not `<id>_<output>.png`, the file. */
export type BakeOutputExport = { id: string; output: string; fileName?: string };

const describe = ({ path, status, clampedValues }: BakedTextureExport) =>
  `${path}: ${status.toLowerCase()}${clampedValues ? ` (${clampedValues} values clamped)` : ''}`;

/**
 * Exports the outputs as PNGs into `dir` one by one, asking (a browser confirm) before one
 * replaces a PNG with other pixels there, and shows a toast listing each file's outcome. Never
 * rejects: a failure is logged and shown.
 * @param outputs what to export, each a PNG of its own
 * @param dir the folder from the repo's root (a texture set's `source/`)
 * @returns each export's result, in order (those before a failure)
 */
export const exportBakeOutputsAsync = async (outputs: BakeOutputExport[], dir: string) => {
  const results: BakedTextureExport[] = [];
  try {
    for (const output of outputs) {
      let result = await exportBakedTexture({ ...output, dir });
      if (result.status === 'EXISTS') {
        if (window.confirm(`${result.path} is there with other pixels. Replace it?`)) {
          result = await exportBakedTexture({ ...output, dir, overwrite: true });
        }
      }
      results.push(result);
    }
    const isDownload = results.some((result) => result.status === 'DOWNLOADED');
    addDebugToast({
      type: isDownload ? 'warning' : 'info',
      title: isDownload ? `PNG downloaded (${results[0].reason})` : 'Bake exported',
      message: results.map(describe).join('\n'),
      showingTime: isDownload ? 15000 : 6000,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    lerror(`Bake export failed: ${message}`, error);
    addDebugToast({ type: 'alert', title: 'Bake export failed', message, showingTime: 15000 });
  }
  return results;
};
