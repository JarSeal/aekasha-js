/**
 * The scene runner's system order check (p607 Phase 1): every world's systems per stage, recorded
 * with a run's baseline and compared on the next run, so a change in registration order (which
 * breaks ties between systems of the same stage and order) fails like a changed hash.
 */
import type { TestBridgeSystemOrder } from '../../src/_engine/debug/TestBridge';

/** Each difference between two system orders, one line each (empty when they're the same) */
export const diffSystemOrders = (
  baseline: TestBridgeSystemOrder,
  current: TestBridgeSystemOrder
): string[] => {
  const diffs: string[] = [];
  const worlds = [...new Set([...Object.keys(baseline), ...Object.keys(current)])];
  for (const worldId of worlds) {
    const was = baseline[worldId];
    const now = current[worldId];
    if (!was || !now) {
      diffs.push(`world "${worldId}" ${was ? 'is gone' : 'is new'}`);
      continue;
    }
    const stages = [...new Set([...Object.keys(was), ...Object.keys(now)])];
    for (const stage of stages) {
      const diff = diffStage(was[stage] ?? [], now[stage] ?? []);
      if (diff) diffs.push(`${worldId} ${stage}: ${diff}`);
    }
  }
  return diffs;
};

const countIds = (ids: string[]) => {
  const counts = new Map<string, number>();
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  return counts;
};

/** The ids `a` has more of than `b`, each as often as it's over (a system registered twice) */
const surplus = (a: string[], b: string[]) => {
  const counts = countIds(b);
  return a.filter((id) => {
    const left = counts.get(id) ?? 0;
    counts.set(id, left - 1);
    return left <= 0;
  });
};

/**
 * The first place two lists differ, with what's missing or added; counted, so a system
 * registered twice shows (`includes` missed it, p619 §1.4 V6)
 */
const diffStage = (was: string[], now: string[]) => {
  const added = surplus(now, was);
  const removed = surplus(was, now);
  if (added.length || removed.length) {
    return [
      added.length ? `added ${added.join(', ')}` : '',
      removed.length ? `removed ${removed.join(', ')}` : '',
    ]
      .filter(Boolean)
      .join('; ');
  }
  const at = was.findIndex((id, i) => now[i] !== id);
  if (at === -1) return null;
  return `#${at + 1} is ${now[at]}, was ${was[at]} (now ${now.join(' → ')})`;
};
