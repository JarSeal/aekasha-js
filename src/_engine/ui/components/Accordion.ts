import type { CMPAttr, CMPHandle } from '../core/CMPTypes';
import { CMP, classes } from '../core/CMP';
import { getMotionFactor } from '../core/Motion';
import { swallowNextKeyUp } from '../overlays/OverlayStack';
import { getMoveTarget } from './RovingFocus';
import './Accordion.scss';
import '../styles/kit.scss';

/** One section of {@link createAccordion}: its header's title and its panel's content. */
export type AccordionItem = {
  /** Its key: what `onExpandedChange`, `expand` and `collapse` name it by, unique among the items. */
  key: string;
  /** Its header's text: the heading, and the panel's accessible name. */
  title: string;
  /** The panel's content: a CMP, or a function that builds it the first time the section opens
   * (kept after). */
  content: CMPHandle | (() => CMPHandle);
  /** Disables its header: it stays open or shut as it is, and the arrows pass over it. Default
   * false. */
  disabled?: boolean;
};

/** What {@link createAccordion} makes an accordion from. */
export type AccordionProps = {
  /** Its sections, in order. */
  items: AccordionItem[];
  /** The headers' heading level (`<h2>` … `<h6>`): the one that fits the page's outline where the
   * accordion is. */
  level: 2 | 3 | 4 | 5 | 6;
  /** Several sections open at once, or (false, the default) one: opening one shuts the other. */
  multiple?: boolean;
  /** The keys of the sections open at the start (default none; one at most without `multiple`). */
  expanded?: string[];
  /** The open sections' keys, in the items' order, after the user opened or shut one: what an
   * owner persists (an accordion writes no storage). Not called for `expand` and `collapse`. */
  onExpandedChange?: (keys: string[]) => void;
  /** Extra classes for the accordion's element. */
  class?: string | string[];
  /** Extra attributes for the accordion's element. */
  attr?: CMPAttr;
  /** The accordion's element id (default: a generated one, not written to the element). */
  id?: string;
};

/** An accordion {@link createAccordion} made: its CMP and its controls. */
export type Accordion = {
  /** The accordion's element: add it where it goes. `cmp.remove()` removes every panel's content
   * with it, and its timers. */
  cmp: CMPHandle;
  /** Opens a section by its key, animated as a click does (without `multiple`, the open one shuts);
   * `onExpandedChange` isn't called. An unknown key does nothing. */
  expand: (key: string) => void;
  /** Shuts a section by its key, animated; `onExpandedChange` isn't called. */
  collapse: (key: string) => void;
  /** Whether a section is open (also while it's opening) */
  isExpanded: (key: string) => boolean;
  /** The open sections' keys, in the items' order */
  getExpanded: () => string[];
};

/** One section's parts and state */
type Section = {
  item: AccordionItem;
  itemElem: HTMLElement;
  trigger: HTMLButtonElement;
  region: HTMLElement;
  /** The CMP the content goes in */
  contentCmp: CMPHandle;
  isBuilt: boolean;
  isOpen: boolean;
  timer: ReturnType<typeof setTimeout> | null;
};

/** At most this many panels are landmarks (`role="region"`): more would crowd the landmark list,
 * as the APG says */
const MAX_REGIONS = 6;

/** `--aek-motion-base` unscaled: the open's and the shut's height animation (the folder's) */
const MOTION_MS = 200;

const CHEVRON_ICON =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 6 8 10.5 12.5 6"/></svg>';

const setAttrIf = (elem: Element, name: string, on: boolean) => {
  if (on) elem.setAttribute(name, '');
  else elem.removeAttribute(name);
};

/**
 * Creates an accordion (p805 D10): a stack of sections, each a heading holding a button over a
 * panel that opens and shuts with its height animated; one open at a time, or several with
 * `multiple`. A panel built from a function is built when its section first opens. Not the
 * folder (`createFolder`): no fields' scheduler or label column, and a heading level of its own,
 * for a page's or a panel's sections (a settings menu's groups, a help page's questions).
 * - Parts: `.aekAccordion` with an `.aekAccordion__item` per section (`data-key`,
 *   `data-expanded`, `data-animating` while it moves): `.aekAccordion__heading` (the `<hN>`)
 *   holding `.aekAccordion__trigger` (`.aekAccordion__title`, `.aekAccordion__chevron`), and
 *   `.aekAccordion__region` (`hidden` while shut) holding `.aekAccordion__clip` and in it
 *   `.aekAccordion__content`.
 * - Custom properties (read on any ancestor, the token as the fallback): `--aek-accordion-padding`
 *   (the headers' and panels' inline padding, default `--aek-space-4`).
 * - Keys (the APG accordion): each header is a tab stop; Enter or Space opens or shuts its section
 *   (the browser's); Up and Down move the focus to the previous and next enabled header,
 *   wrapping, Home and End to the first and last. The keys it uses reach no key binding. Shut
 *   with the focus inside, the focus goes to its header.
 * - ARIA: each header a heading of `level` holding a button with `aria-expanded` and
 *   `aria-controls` its panel; each panel a `role="region"` named by its header while there are
 *   at most six sections (more aren't landmarks).
 * - Motion: the height eases over `--aek-motion-base` and the chevron turns with it; at once under
 *   reduced motion.
 * @example
 * ```ts
 * const help = createAccordion({
 *   level: 3,
 *   items: [
 *     { key: 'move', title: 'How do I move?', content: moveHelpPanel },
 *     { key: 'save', title: 'How do I save?', content: () => buildSaveHelp() },
 *   ],
 *   expanded: ['move'],
 *   onExpandedChange: (keys) => saveSetting('helpOpen', keys),
 * });
 * helpWindow.add(help.cmp);
 * ```
 */
export const createAccordion = (props: AccordionProps): Accordion => {
  const { level, multiple = false } = props;
  const sections: Section[] = [];
  const byKey = new Map<string, Section>();
  const isRegion = props.items.length <= MAX_REGIONS;

  const getExpanded = () => sections.filter((s) => s.isOpen).map((s) => s.item.key);

  const clearTimer = (section: Section) => {
    if (section.timer !== null) clearTimeout(section.timer);
    section.timer = null;
  };

  /** The state drawn at once: at the creation, and at an animation's end */
  const drawSettled = (section: Section) => {
    section.itemElem.removeAttribute('data-animating');
    setAttrIf(section.itemElem, 'data-expanded', section.isOpen);
    setAttrIf(section.region, 'hidden', !section.isOpen);
  };

  const build = (section: Section) => {
    if (section.isBuilt) return;
    section.isBuilt = true;
    const { content } = section.item;
    section.contentCmp.add(typeof content === 'function' ? content() : content);
  };

  /** Opens or shuts a section, animated unless `animate` is false or under reduced motion */
  const applyOpen = (section: Section, open: boolean, animate = true) => {
    if (open === section.isOpen) return;
    section.isOpen = open;
    clearTimer(section);
    section.trigger.setAttribute('aria-expanded', String(open));
    if (open) {
      build(section);
      section.region.removeAttribute('hidden');
    } else if (section.region.contains(document.activeElement)) {
      // What had the focus is going: the header keeps it
      section.trigger.focus();
    }
    const duration = animate ? MOTION_MS * getMotionFactor(section.itemElem) : 0;
    if (duration <= 0) return drawSettled(section);
    section.itemElem.setAttribute('data-animating', '');
    // From the shut height: a layout read between showing the region and opening it
    if (open) void section.region.offsetHeight;
    setAttrIf(section.itemElem, 'data-expanded', open);
    section.timer = setTimeout(() => {
      section.timer = null;
      drawSettled(section);
    }, duration);
  };

  /** Opens a section and, without `multiple`, shuts the others */
  const expandSection = (section: Section, animate = true) => {
    if (!multiple) {
      for (const other of sections) if (other !== section) applyOpen(other, false, animate);
    }
    applyOpen(section, true, animate);
  };

  /** The section whose header holds `target` (a key or a click in a panel isn't the accordion's) */
  const findByTrigger = (target: EventTarget | null) =>
    target ? sections.findIndex((section) => section.trigger.contains(target as Node)) : -1;

  const onClick = (e: Event) => {
    const section = sections[findByTrigger(e.target)];
    if (!section || section.trigger.disabled) return;
    if (section.isOpen) applyOpen(section, false);
    else expandSection(section);
    props.onExpandedChange?.(getExpanded());
  };

  const onKeyDown = (e: Event) => {
    const { key } = e as KeyboardEvent;
    const index = findByTrigger(e.target);
    if (index === -1) return;
    const next = getMoveTarget(key, index, {
      count: sections.length,
      wrap: true,
      isSkipped: (i) => sections[i].trigger.disabled,
    });
    if (next === null) return;
    e.preventDefault();
    e.stopPropagation();
    swallowNextKeyUp(key);
    if (next !== -1) sections[next].trigger.focus();
  };

  const cmp = CMP({
    id: props.id,
    idAttr: props.id !== undefined,
    class: classes('aekAccordion', props.class),
    attr: props.attr,
    listeners: [
      { type: 'click', fn: onClick },
      { type: 'keydown', fn: onKeyDown },
    ],
    onRemoveCmp: () => {
      for (const section of sections) clearTimer(section);
    },
  });

  const openAtStart = new Set(multiple ? props.expanded ?? [] : (props.expanded ?? []).slice(0, 1));
  for (const item of props.items) {
    const itemCmp = cmp.add({
      class: 'aekAccordion__item',
      attr: { 'data-key': item.key },
    });
    const heading = document.createElement(`h${level}`);
    heading.className = 'aekAccordion__heading';
    const trigger = document.createElement('button');
    trigger.className = 'aekAccordion__trigger';
    trigger.type = 'button';
    trigger.id = `${itemCmp.id}__trigger`;
    if (item.disabled) trigger.setAttribute('disabled', '');
    const title = document.createElement('span');
    title.className = 'aekAccordion__title';
    title.textContent = item.title;
    const chevron = document.createElement('span');
    chevron.className = 'aekAccordion__chevron';
    chevron.setAttribute('aria-hidden', 'true');
    chevron.innerHTML = CHEVRON_ICON;
    trigger.append(title, chevron);
    heading.append(trigger);
    itemCmp.elem.append(heading);

    const regionCmp = itemCmp.add({
      class: 'aekAccordion__region',
      attr: {
        id: `${itemCmp.id}__region`,
        ...(isRegion ? { role: 'region', 'aria-labelledby': trigger.id } : {}),
      },
    });
    trigger.setAttribute('aria-controls', regionCmp.elem.id);
    // The grid row's item: it shrinks to nothing, which the padded content couldn't
    const contentCmp = regionCmp
      .add({ class: 'aekAccordion__clip' })
      .add({ class: 'aekAccordion__content' });

    const section: Section = {
      item,
      itemElem: itemCmp.elem,
      trigger,
      region: regionCmp.elem,
      contentCmp,
      isBuilt: false,
      isOpen: false,
      timer: null,
    };
    sections.push(section);
    byKey.set(item.key, section);
    trigger.setAttribute('aria-expanded', 'false');
    drawSettled(section);
  }
  for (const key of openAtStart) {
    const section = byKey.get(key);
    if (section) applyOpen(section, true, false);
  }

  return {
    cmp,
    expand: (key) => {
      const section = byKey.get(key);
      if (section) expandSection(section);
    },
    collapse: (key) => {
      const section = byKey.get(key);
      if (section) applyOpen(section, false);
    },
    isExpanded: (key) => byKey.get(key)?.isOpen ?? false,
    getExpanded,
  };
};
