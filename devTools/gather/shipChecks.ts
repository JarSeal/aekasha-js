/**
 * A production build ships the asset pipeline's outputs only, within their budgets (p300): the
 * scene pass records each shipped scene's assets, and `report` fails the gather on one without
 * an output or over its budget.
 */
import { BUDGET_FIX, getBudgetViolations } from '../assetPipeline/budgets';
import {
  getAssetResult,
  getTextureArrayResult,
  getTextureAtlasSlotResult,
  isKtxOnlyAsset,
  isMissingOutput,
  type getGeneratedFields,
} from '../assetPipeline/generated';
import type { PipelineRunResult } from '../assetPipeline/run';
import { ALLOW_UNOPTIMIZED_ENV_KEY } from '../assetPipeline/switches';
import type { GatherContext } from './context';

/** The checks of one gather; each does nothing outside a production gather with a run */
export type ShipChecks = {
  /** A texture's or an import's output, for a scene (`data` with the scene's entry) */
  checkAsset: (
    data: Parameters<typeof getGeneratedFields>[3],
    type: 'texture' | 'importedAsset',
    jsonFile: string,
    sceneId: string
  ) => void;
  checkArray: (jsonFile: string, sceneId: string) => void;
  checkAtlasSlot: (jsonFile: string, slot: string, sceneId: string) => void;
  /** Logs the assets without an output or over their budget, and fails the gather on one */
  report: () => void;
};

const getSourceName = ({ asset }: PipelineRunResult) =>
  asset.source.kind === 'remote' ? asset.source.url : asset.source.repoPath;

const reportMissingOutputs = (
  ctx: GatherContext,
  missingOutputs: Map<PipelineRunResult, Set<string>>
) => {
  const results = [...missingOutputs.keys()];
  ctx.log.error(
    `A production build ships the asset pipeline's outputs only, and ${results.length} asset(s) that shipped scenes use have none:`
  );
  for (const [result, sceneIds] of missingOutputs) {
    // The run's one ktx setup failure, and its fix, are printed by the [Assets] lines above
    const reason =
      result.status === 'error'
        ? `failed: ${result.reason}`
        : result.status === 'skipped'
          ? `no output: ${result.reason}`
          : 'encoder missing';
    ctx.log.details(
      `  ${result.asset.id} (${getSourceName(result)}; ${[...sceneIds].join(', ')}): ${reason}`
    );
  }
  const encoderMissing = results.filter((result) => result.status === 'encoderMissing');
  if (encoderMissing.length) {
    const unoptimized = encoderMissing.some((result) => !isKtxOnlyAsset(result))
      ? ` Or ship them unoptimized in this build: ${ALLOW_UNOPTIMIZED_ENV_KEY}=true yarn build`
      : '';
    const ktxOnly = encoderMissing.some(isKtxOnlyAsset)
      ? ` A texture array or atlas slot has no unoptimized form: it needs ktx, even with ${ALLOW_UNOPTIMIZED_ENV_KEY}.`
      : '';
    ctx.log.details(
      `  Without ktx: set it up (see [Assets] above), run yarn assets, and commit src/public/aek-assets/ and assets.lock.json.${unoptimized}${ktxOnly}`
    );
  }
  if (results.some((result) => result.status === 'skipped' && isKtxOnlyAsset(result))) {
    ctx.log.details(
      `  A texture array or atlas slot is only ever its KTX2 output, and it has none while its textures side is off (a rule's "textures": false, the project switches): turn it on for it, or don't use it in a shipped scene.`
    );
  }
  if (results.some((result) => result.status === 'error')) {
    ctx.log.details(`  A failed asset: fix it, or opt it out with "optimize": false in its JSON.`);
  }
};

const reportOverBudget = (ctx: GatherContext, overBudget: Map<PipelineRunResult, Set<string>>) => {
  ctx.log.error(
    `${overBudget.size} asset(s) that shipped scenes use are over their budget (p300 Phase 4):`
  );
  for (const [result, sceneIds] of overBudget) {
    ctx.log.details(
      `  ${result.asset.id} (${getSourceName(result)}; ${[...sceneIds].join(', ')}):`
    );
    for (const violation of getBudgetViolations(result)) ctx.log.details(`    ${violation}`);
  }
  ctx.log.details(`  ${BUDGET_FIX}`);
};

/** The shipped-output checks of a gather */
export const createShipChecks = (ctx: GatherContext): ShipChecks => {
  // The scenes using an asset without an output, or over its budget
  const missingOutputs = new Map<PipelineRunResult, Set<string>>();
  const overBudget = new Map<PipelineRunResult, Set<string>>();
  // Only a production gather with a run checks
  const pipeline = ctx.isProduction ? ctx.pipeline : undefined;
  const checkResult = (result: PipelineRunResult | null, sceneId: string) => {
    if (!result) return;
    const failed = isMissingOutput(result)
      ? missingOutputs
      : getBudgetViolations(result).length
        ? overBudget
        : null;
    failed?.set(result, (failed.get(result) ?? new Set()).add(sceneId));
  };
  return {
    checkAsset: (data, type, jsonFile, sceneId) => {
      if (pipeline) checkResult(getAssetResult(pipeline, type, jsonFile, data), sceneId);
    },
    checkArray: (jsonFile, sceneId) => {
      if (pipeline) checkResult(getTextureArrayResult(pipeline, jsonFile), sceneId);
    },
    checkAtlasSlot: (jsonFile, slot, sceneId) => {
      if (pipeline) checkResult(getTextureAtlasSlotResult(pipeline, jsonFile, slot), sceneId);
    },
    report: () => {
      if (missingOutputs.size) reportMissingOutputs(ctx, missingOutputs);
      if (overBudget.size) reportOverBudget(ctx, overBudget);
    },
  };
};
