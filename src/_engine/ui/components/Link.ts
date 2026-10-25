import type { CMPAttr, CMPHandle } from '../core/CMPTypes';
import { CMP, classes } from '../core/CMP';
import { createTooltip, type Tooltip } from '../overlays/Tooltip';
import './Button.scss';
import './Link.scss';
import '../styles/kit.scss';

/** What {@link createLink} makes a link from. */
export type LinkProps = {
  /** Where it goes. */
  href: string;
  /** Its text, and its accessible name. */
  label: string;
  /** Opens in a new tab, with the external mark and "(opens in a new tab)" for assistive tech.
   * Default: whether `href` is an http(s) address on another origin. */
  external?: boolean;
  /** `'button'` draws it as a button (a navigation that looks like one: "Open the docs"); default
   * 'link'. An action that looks like a link is `createButton({ variant: 'link' })`. */
  appearance?: 'link' | 'button';
  /** With `appearance: 'button'`, the button's look (default 'secondary'). */
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  /** With `appearance: 'button'`, the button's size (default 'md'). */
  size?: 'sm' | 'md' | 'lg';
  /** Raw HTML of an icon before the label (`getSvgIcon('info')`), at `1em`. */
  icon?: string;
  /** Its tooltip's text (default: none). */
  tooltip?: string;
  /** Runs on a click, before the browser follows it (an app's router calls `preventDefault()`). */
  onClick?: (e: Event) => void;
  /** Extra classes for the link. */
  class?: string | string[];
  /** Extra attributes for the link. */
  attr?: CMPAttr;
  /** The link's element id (default: a generated one, not written to the element). */
  id?: string;
};

/** A link {@link createLink} made: its CMP and its setters, each writing it in place. */
export type Link = {
  /** The `<a>`: add it where it goes. `cmp.remove()` disposes of it with its tooltip. */
  cmp: CMPHandle;
  /** Changes its text. */
  setLabel: (label: string) => void;
  /** Changes where it goes (and, without `external`, whether it's external). */
  setHref: (href: string) => void;
};

const NEW_TAB_TEXT = '(opens in a new tab)';
/** The external mark: a box with an arrow out of it, in the text colour (the kit's own markup: a
 * production app may not register the built-in icons) */
const EXTERNAL_SVG =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M7 3H3.5v9.5H13V9M9.5 2.5h4v4M13.5 2.5L7.5 8.5"/></svg>';

/** Whether an address is an http(s) one on another origin than the page's */
const isOtherOrigin = (href: string) => {
  if (typeof location === 'undefined') return /^https?:\/\//i.test(href);
  try {
    const url = new URL(href, location.href);
    return /^https?:$/.test(url.protocol) && url.origin !== location.origin;
  } catch {
    return false;
  }
};

const createPart = (className: string, text = '') => {
  const span = document.createElement('span');
  span.className = className;
  span.textContent = text;
  return span;
};

/**
 * Creates a link (p803 D10): an `<a>` to `href`. An external one (another origin's address, or
 * `external: true`) opens in a new tab (`target="_blank"`, `rel="noopener noreferrer"`) and shows
 * the external mark, and assistive tech hears "(opens in a new tab)" after its name. With
 * `appearance: 'button'` it looks like a button and stays a link (a navigation).
 * - Parts: `.aekLink` (also `.aekButton` with `data-variant` and `data-size` as a button),
 *   `.aekLink__icon`, `.aekLink__label`, `.aekLink__external` (the mark).
 * - Keys: Enter follows it (the browser's).
 * @example
 * ```ts
 * aboutPanel.add(createLink({ href: '/credits', label: 'Credits' }).cmp);
 * aboutPanel.add(createLink({ href: 'https://example.com/manual', label: 'The manual' }).cmp);
 * aboutPanel.add(
 *   createLink({ href: '/play', label: 'Play now', appearance: 'button', variant: 'primary' }).cmp
 * );
 * ```
 */
export const createLink = (props: LinkProps): Link => {
  const isButton = props.appearance === 'button';
  let tooltip: Tooltip | null = null;

  const cmp = CMP({
    id: props.id,
    idAttr: props.id !== undefined,
    tag: 'a',
    class: classes('aekLink', isButton ? 'aekButton' : null, props.class),
    attr: {
      ...props.attr,
      ...(isButton
        ? { 'data-variant': props.variant ?? 'secondary', 'data-size': props.size ?? 'md' }
        : {}),
    },
    listeners: props.onClick ? [{ type: 'click', fn: props.onClick }] : [],
    onRemoveCmp: () => {
      tooltip?.cmp.remove();
      tooltip = null;
    },
  });
  const elem = cmp.elem;

  const labelElem = createPart('aekLink__label', props.label);
  if (props.icon) {
    const icon = createPart('aekLink__icon');
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = props.icon;
    elem.append(icon);
  }
  elem.append(labelElem);
  // Made on the first external href and kept: a later setHref only moves them in and out
  let externalParts: HTMLElement[] | null = null;

  const setHref = (href: string) => {
    elem.setAttribute('href', href);
    const isExternal = props.external ?? isOtherOrigin(href);
    if (isExternal) {
      elem.setAttribute('target', '_blank');
      elem.setAttribute('rel', 'noopener noreferrer');
      if (!externalParts) {
        const mark = createPart('aekLink__external');
        mark.innerHTML = EXTERNAL_SVG;
        externalParts = [mark, createPart('aekVisuallyHidden', ` ${NEW_TAB_TEXT}`)];
      }
      if (!externalParts[0].isConnected) elem.append(...externalParts);
    } else {
      elem.removeAttribute('target');
      elem.removeAttribute('rel');
      for (const part of externalParts ?? []) part.remove();
    }
  };
  setHref(props.href);

  if (props.tooltip !== undefined) tooltip = createTooltip({ anchor: elem, text: props.tooltip });

  return {
    cmp,
    setLabel: (label) => {
      labelElem.textContent = label;
    },
    setHref,
  };
};
