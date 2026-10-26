import type { CMPAttr, CMPHandle } from '../core/CMPTypes';
import { CMP, classes } from '../core/CMP';
import './Skeleton.scss';
import '../styles/kit.scss';

/** What {@link createSkeleton} draws. */
export type SkeletonProps = {
  /** Its shape (default 'lines'): text lines, a block (an image, a card) or a circle (an avatar). */
  shape?: 'lines' | 'block' | 'circle';
  /** How many text lines (`shape: 'lines'`, default 3): the last is shorter, as a paragraph's. */
  lines?: number;
  /** Its width as a CSS length (default: its container's; a circle's: its height). */
  width?: string;
  /** Its height as a CSS length (a block's default `--aek-space-7` × 3, a circle's `2.5em`; lines
   * are as tall as their text). */
  height?: string;
  /** Extra classes for its element. */
  class?: string | string[];
  /** Extra attributes for its element. */
  attr?: CMPAttr;
  /** Its element id (default: a generated one, not written to the element). */
  id?: string;
};

/** A skeleton {@link createSkeleton} made: its CMP. */
export type Skeleton = {
  /** Its element (`.aekSkeleton`): add it where the content will be, and remove it when the
   * content is there. */
  cmp: CMPHandle;
};

/**
 * Creates a skeleton (p803 D10): a grey shape where content is still loading, shaped like it (text
 * lines, a block, a circle), so the layout doesn't jump when it comes.
 * - Parts: `.aekSkeleton` (`data-shape`), and a `.aekSkeleton__line` per line.
 * - Custom properties (read on any ancestor): `--aek-skeleton-color` (default
 *   `--aek-surface-hover`), `--aek-skeleton-shine` (the shimmer's colour), `--aek-skeleton-radius`.
 * - ARIA: `aria-hidden`: it says nothing. Set `aria-busy="true"` on the container that's loading
 *   while it shows, and take it off with the skeleton.
 * - Motion: a shimmer crosses it; none under `prefers-reduced-motion` (or an app's
 *   `--aek-motion: 0`).
 * @example
 * ```ts
 * const card = panel.add({ class: 'scoreCard', attr: { 'aria-busy': 'true' } });
 * const avatar = createSkeleton({ shape: 'circle' });
 * const text = createSkeleton({ lines: 2 });
 * card.add(avatar.cmp);
 * card.add(text.cmp);
 * loadScoresAsync().then((scores: { best: number }) => {
 *   avatar.cmp.remove();
 *   text.cmp.remove();
 *   card.removeAttr('aria-busy');
 *   card.add({ text: `Best: ${scores.best}` });
 * });
 * ```
 */
export const createSkeleton = (props: SkeletonProps = {}): Skeleton => {
  const { shape = 'lines' } = props;
  const cmp = CMP({
    id: props.id,
    idAttr: props.id !== undefined,
    class: classes('aekSkeleton', props.class),
    attr: { ...props.attr, 'data-shape': shape, 'aria-hidden': 'true' },
    style: {
      ...(props.width !== undefined ? { width: props.width } : {}),
      ...(props.height !== undefined ? { height: props.height } : {}),
    },
  });
  if (shape === 'lines') {
    const count = Math.max(1, Math.floor(props.lines ?? 3));
    for (let i = 0; i < count; i++) {
      const line = document.createElement('span');
      line.className = 'aekSkeleton__line';
      cmp.elem.append(line);
    }
  }
  return { cmp };
};
