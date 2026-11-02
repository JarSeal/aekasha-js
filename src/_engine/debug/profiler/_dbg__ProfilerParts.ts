// The profiler tabs' small parts (p807 D7, D8; the Objects tab's, out of `_dbg__ProfilerObjects.ts`
// so it stays under 800 lines, and GPU memory's): the figures' formats, a text written in place, a
// section with its heading, a note, a table's empty text, and a row header's two lines.
import { CMP } from '../../ui/core/CMP';
import type { CMPHandle } from '../../ui/core/CMPTypes';
import { formatNumber } from '../../kernel/assets/debug/_dbg__AssetStats';
import type { InViewTotal } from './_dbg__Census';
/** 1,234 · 12.3k · 123k · 1.23M */
export const formatCompact = (n: number) => {
  if (n < 10_000) return formatNumber(Math.round(n));
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 100_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 2 : 1)}M`;
};

/** An in-view figure and its total: "1.2k / 3.4k" */
export const formatInViewTotal = ({ inView, total }: InViewTotal) =>
  `${formatCompact(inView)} / ${formatCompact(total)}`;

/** A text written only when it changed: a `Text` node's `data` (no node replaced). */
export const createTextWriter = (node: Text) => (text: string) => {
  if (node.data !== text) node.data = text;
};

/** A section: its heading (`h4`) and its parts; `className` adds a tab's own class. */
export const createSection = (heading: string, parts: CMPHandle[], className = '') => {
  const section = CMP({ class: ['profilerSection', className] });
  section.add({ tag: 'h4', text: heading });
  for (let i = 0; i < parts.length; i++) section.add(parts[i]);
  return section;
};

/** A paragraph of muted text, written in place; `hidden` while empty. */
export const createNote = (className = '') => {
  const note = CMP({ tag: 'p', class: ['profilerNote', className], attr: { hidden: '' } });
  const text = document.createTextNode('');
  note.elem.append(text);
  const write = createTextWriter(text);
  return {
    cmp: note,
    write: (value: string) => {
      write(value);
      if (note.elem.hidden !== !value) note.elem.toggleAttribute('hidden', !value);
    },
  };
};

/** A table's empty text as a CMP (its text written as the census comes and goes). */
export const createEmpty = () => {
  const empty = CMP({ tag: 'span' });
  const text = document.createTextNode('');
  empty.elem.append(text);
  return { cmp: empty, write: createTextWriter(text) };
};

/** A row header's two lines: the name, and a dimmed line under it written in place. */
export type TwoLineRow = { label: string; sub: string; subNode: Text | null };

export const createNameCell = (row: TwoLineRow) => {
  const cell = CMP({ tag: 'span', class: 'profilerName' });
  cell.add({ tag: 'span', text: row.label });
  const sub = cell.add({ tag: 'span', class: 'profilerName__sub' });
  row.subNode = document.createTextNode(row.sub);
  sub.elem.append(row.subNode);
  return cell;
};

export const writeSub = (row: TwoLineRow, sub: string) => {
  if (row.sub === sub) return;
  row.sub = sub;
  if (row.subNode) row.subNode.data = sub;
};
