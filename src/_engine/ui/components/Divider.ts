import type { CMPAttr, CMPHandle } from '../core/CMPTypes';
import { CMP, classes } from '../core/CMP';
import './Divider.scss';
import '../styles/kit.scss';

/** What {@link createDivider} draws. */
export type DividerProps = {
  /** Which way it runs (default 'horizontal'): a vertical one stands between the items of a row
   * (a toolbar's groups), as tall as the row. */
  orientation?: 'horizontal' | 'vertical';
  /** Hides it from assistive tech: a line for the look alone, where nothing ends or begins. Default
   * false. */
  decorative?: boolean;
  /** Extra classes for its element. */
  class?: string | string[];
  /** Extra attributes for its element. */
  attr?: CMPAttr;
  /** Its element id (default: a generated one, not written to the element). */
  id?: string;
};

/** A divider {@link createDivider} made: its CMP. */
export type Divider = {
  /** Its element (`.aekDivider`): add it where it goes. */
  cmp: CMPHandle;
};

/**
 * Creates a divider (p803 D10): a line between two groups of content, across a column or down a
 * row.
 * - Parts: `.aekDivider` (`data-orientation`): an `<hr>` across, a `<div>` down.
 * - Custom properties (read on any ancestor): `--aek-divider-color` (default `--aek-border`),
 *   `--aek-divider-spacing` (the space on either side, default `--aek-space-3`).
 * - ARIA: a separator (the `<hr>`'s own role; `role="separator"` with `aria-orientation` down a
 *   row); `decorative` makes it `aria-hidden`.
 * @example
 * ```ts
 * menuPanel.add(createButton({ label: 'Resume' }).cmp);
 * menuPanel.add(createDivider().cmp);
 * menuPanel.add(createButton({ label: 'Quit', variant: 'danger' }).cmp);
 *
 * toolRow.add(createDivider({ orientation: 'vertical' }).cmp);
 * ```
 */
export const createDivider = (props: DividerProps = {}): Divider => {
  const { orientation = 'horizontal', decorative = false } = props;
  const isVertical = orientation === 'vertical';
  const cmp = CMP({
    id: props.id,
    idAttr: props.id !== undefined,
    tag: isVertical ? 'div' : 'hr',
    class: classes('aekDivider', props.class),
    attr: {
      ...props.attr,
      'data-orientation': orientation,
      ...(decorative
        ? { 'aria-hidden': 'true' }
        : isVertical
          ? { role: 'separator', 'aria-orientation': 'vertical' }
          : {}),
    },
  });
  return { cmp };
};
