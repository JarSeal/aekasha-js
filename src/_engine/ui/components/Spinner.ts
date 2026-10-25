import type { CMPAttr, CMPHandle } from '../core/CMPTypes';
import { CMP, classes } from '../core/CMP';
import './Spinner.scss';
import '../styles/kit.scss';

/** What {@link createSpinner} draws. */
export type SpinnerProps = {
  /** Its size: `1em` by default (it follows its text, as an icon), or an icon size
   * (`--aek-icon-size-*`). Any other size: set `--aek-spinner-size` on it or an ancestor. */
  size?: 'sm' | 'md' | 'lg';
  /** What assistive tech hears (default 'Loading'): standing alone, it's a status. */
  label?: string;
  /** Hides it from assistive tech (no status, no label), for a spinner inside something that
   * already says it's loading (a loading overlay's text, a busy button). Default false. */
  decorative?: boolean;
  /** Extra classes for its element. */
  class?: string | string[];
  /** Extra attributes for its element. */
  attr?: CMPAttr;
  /** Its element id (default: a generated one, not written to the element). */
  id?: string;
};

/** A spinner {@link createSpinner} made: its CMP and its setter, writing it in place. */
export type Spinner = {
  /** Its element (`.aekSpinner`): add it where it goes. */
  cmp: CMPHandle;
  /** Changes what assistive tech hears (a decorative spinner has nothing to change). The status
   * reads the new label. */
  setLabel: (label: string) => void;
};

/**
 * Creates a spinner (p803 D10): a turning ring for a wait of unknown length.
 * - Parts: `.aekSpinner` (`data-size`; its ring is the `::before`), its label an
 *   `aekVisuallyHidden` span.
 * - Custom properties (read on any ancestor): `--aek-spinner-size` (default `1em`, or the
 *   `size`'s icon token), `--aek-spinner-color` (default the text colour).
 * - ARIA: `role="status"` with its label, so a `setLabel` is read; `decorative` makes it
 *   `aria-hidden`.
 * - Motion: it turns on the kit's `aekSpin` (still at an app's `--aek-motion: 0`) and, under
 *   `prefers-reduced-motion`, pulses slowly instead.
 * @example
 * ```ts
 * const spinner = createSpinner({ label: 'Loading the save' });
 * savePanel.add(spinner.cmp);
 * loadSaveAsync().then(() => spinner.cmp.remove());
 * ```
 */
export const createSpinner = (props: SpinnerProps = {}): Spinner => {
  const { decorative = false } = props;
  const cmp = CMP({
    id: props.id,
    idAttr: props.id !== undefined,
    tag: 'span',
    class: classes('aekSpinner', props.class),
    attr: {
      ...props.attr,
      ...(props.size ? { 'data-size': props.size } : {}),
      ...(decorative ? { 'aria-hidden': 'true' } : { role: 'status' }),
    },
  });
  const labelElem = decorative ? null : document.createElement('span');
  if (labelElem) {
    labelElem.className = 'aekVisuallyHidden';
    labelElem.textContent = props.label ?? 'Loading';
    cmp.elem.append(labelElem);
  }

  return {
    cmp,
    setLabel: (label) => {
      if (labelElem) labelElem.textContent = label;
    },
  };
};
