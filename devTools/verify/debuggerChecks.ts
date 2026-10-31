/**
 * The `debugger` configuration's pure parts (p806 D14, `sceneDebugger.ts`): the tab order's diff,
 * the axe failures, a shot's file and a script's value comparison. No browser, no file
 * system: `debuggerChecks.test.ts` covers them.
 */
import type { TestBridgeTabOrder } from '../../src/_engine/debug/TestBridge';

/** axe's violations per debugger root (its shot's name): rule id → nodes */
export type DebuggerAxeCounts = Record<string, Record<string, number>>;

/** The tab order against the baseline's: a line per host that changed (an id added or removed, or
 * the same ids in another order) */
export const diffTabOrders = (base: TestBridgeTabOrder, current: TestBridgeTabOrder) => {
  const diffs: string[] = [];
  const hosts = [...new Set([...Object.keys(base), ...Object.keys(current)])];
  for (const host of hosts as (keyof TestBridgeTabOrder)[]) {
    const was = base[host] ?? [];
    const now = current[host] ?? [];
    if (was.join('\n') === now.join('\n')) continue;
    const added = now.filter((id) => !was.includes(id));
    const removed = was.filter((id) => !now.includes(id));
    const parts: string[] = [];
    if (added.length) parts.push(`added ${added.join(', ')}`);
    if (removed.length) parts.push(`removed ${removed.join(', ')}`);
    if (!parts.length) parts.push(`reordered to ${now.join(', ')} (was ${was.join(', ')})`);
    diffs.push(`${host}: ${parts.join('; ')}`);
  }
  return diffs;
};

/**
 * axe's violations as failures, a line per rule on a root (p806 D12, Phase 6: no root may have
 * any; Phases 1-5 ratcheted against the baseline's counts, which the baseline still records)
 */
export const findAxeFailures = (current: DebuggerAxeCounts) => {
  const failures: string[] = [];
  for (const [root, rules] of Object.entries(current)) {
    for (const [rule, nodes] of Object.entries(rules)) {
      if (nodes > 0) failures.push(`axe ${root}: ${rule} ×${nodes}`);
    }
  }
  return failures;
};

/** A debugger shot's file under a result folder's `last-run/` and `baseline/` */
export const debuggerShotFile = (sceneId: string, name: string) =>
  `debugger/${sceneId}/${name.replace(/[^\w.-]+/g, '-')}.png`;

/** Two read values (JSON) are the same */
export const isSameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** A read value for a failure line, cut short */
export const formatValue = (value: unknown) => {
  const text = value === undefined ? 'undefined' : JSON.stringify(value);
  return text.length > 120 ? `${text.slice(0, 117)}…` : text;
};
