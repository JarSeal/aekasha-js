// The folder (p804 D9): the APG disclosure, a button over a region its fields are in, the height
// animated open and shut. Not `<details>`: its content's height doesn't animate in every browser
// (`::details-content`), and the open state here is set before the first paint.
import type { CMPAttr, CMPHandle } from '../core/CMPTypes';
import { CMP, classes } from '../core/CMP';
import { getMotionFactor } from '../core/Motion';
import {
  addScheduledBinding,
  revealScheduledBindings,
  type BindingScheduler,
} from './binding/BindingScheduler';
import { addFormChildren, type FieldDyn, type FormChild } from './Field';
import './Folder.scss';
import '../styles/kit.scss';

/** What {@link createFolder} makes a folder from. */
export type FolderProps = {
  /** The folder's name, on its button: also the region's accessible name. */
  title: string;
  /** Whether it starts open (default true, Tweakpane's). */
  expanded?: boolean;
  /** Each open and shut, the user's or `setExpanded`'s: what an owner persists (a folder writes
   * no storage). */
  onExpandedChange?: (expanded: boolean) => void;
  /** Hides the folder: a value, or a function re-read on every refresh (default false). */
  hidden?: FieldDyn<boolean>;
  /** The scheduler of the fields in it: an open reads, once, those it hid since a refresh, and
   * the scheduler's `refresh()` re-reads a `hidden` function. */
  scheduler?: BindingScheduler;
  /** Its first children, in order (`add` adds more). */
  children?: readonly FormChild[];
  /** Extra classes for the folder's element. */
  class?: string | string[];
  /** Extra attributes for the folder's element. */
  attr?: CMPAttr;
  /** The button's element id (default: a generated one). */
  id?: string;
};

/** A folder {@link createFolder} made. */
export type Folder = {
  /** The folder's element: add it where it goes. `cmp.remove()` disposes of it and its children. */
  cmp: CMPHandle;
  /** The region's CMP its children are in. */
  content: CMPHandle;
  /** Adds children after the ones it has. */
  add: (...children: FormChild[]) => void;
  /** Whether it's open (also while it's opening). */
  isExpanded: () => boolean;
  /** Opens or shuts it, animated as a click does; `onExpandedChange` hears it. */
  setExpanded: (expanded: boolean) => void;
  /** Opens it when it's shut, and shuts it when it's open. */
  toggle: () => void;
  /** Changes its name. */
  setTitle: (title: string) => void;
  /** Hides or shows it (in place of a `hidden` function). */
  setHidden: (hidden: boolean) => void;
  /** Re-reads its `hidden` function (its scheduler's `refresh()` does too). */
  refresh: () => void;
};

const CHEVRON_ICON =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5"/></svg>';

/** `--aek-motion-base` unscaled: the open's and the shut's height animation */
const MOTION_MS = 200;

const resolveDyn = (value: FieldDyn<boolean> | undefined) =>
  typeof value === 'function' ? value() : Boolean(value);

/**
 * Creates a folder (p804 D9): the APG disclosure, a button (`aria-expanded`, `aria-controls`)
 * over a region its children are in, which opens and shuts with the height animated and the
 * chevron turning. A shut folder's region is `hidden`, so its fields aren't read (D4) until it
 * opens, when its `scheduler` reads those once. Folders nest, each level's content indented.
 * The open state is the owner's to keep: `onExpandedChange` reports it, `expanded` starts it.
 * - Keys: Enter or Space on the button opens or shuts it (the browser's). Shut from code with the
 *   focus inside, the focus goes to the button.
 * - Parts: `.aekFolder` (`data-expanded`, `data-animating` while it moves, `hidden`) with
 *   `.aekFolder__toggle` (the button: `.aekFolder__chevron`, `.aekFolder__title`) and
 *   `.aekFolder__region` (`role="group"`, `hidden` while shut) holding `.aekFolder__clip` and in it
 *   `.aekFolder__content`.
 * - Custom properties: `--aek-folder-indent` (each level's indent, default `--aek-space-3`),
 *   `--aek-folder-gap` (between its children, default `--aek-space-3`).
 * - ARIA: the button's `aria-expanded` and `aria-controls` the region, a `group` named by the
 *   button. A 24 px target in both densities.
 * - Motion: the height eases over `--aek-motion-base` and the chevron turns with it; at once under
 *   reduced motion.
 * @example
 * ```ts
 * const scheduler = createBindingScheduler();
 * const shadows = createFolder({
 *   title: 'Shadows',
 *   expanded: settings.shadowsOpen,
 *   onExpandedChange: (open) => saveSetting('shadowsOpen', open),
 *   scheduler,
 *   children: [
 *     createCheckbox({ label: 'Enabled', target: light, key: 'castShadow', scheduler }),
 *     createSlider({
 *       label: 'Bias',
 *       target: light.shadow,
 *       key: 'bias',
 *       min: -0.01,
 *       max: 0.01,
 *       step: 0.0001,
 *       scheduler,
 *     }),
 *   ],
 * });
 * settingsPanel.add(shadows.cmp);
 * ```
 */
export const createFolder = (props: FolderProps): Folder => {
  const { scheduler } = props;
  let hiddenProp = props.hidden;
  let isHidden = false;
  let isOpen = props.expanded !== false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let removeEntry: (() => void) | null = null;

  const cmp = CMP({
    class: classes('aekFolder', props.class),
    attr: props.attr,
    onRemoveCmp: () => {
      clearTimer();
      removeEntry?.();
      removeEntry = null;
      toggleButton.removeEventListener('click', onClick);
    },
  });
  const root = cmp.elem;
  const toggleId = props.id ?? `${cmp.id}__toggle`;
  const regionId = `${cmp.id}__region`;

  const toggleButton = document.createElement('button');
  toggleButton.className = 'aekFolder__toggle';
  toggleButton.id = toggleId;
  toggleButton.setAttribute('type', 'button');
  toggleButton.setAttribute('aria-controls', regionId);
  const chevron = document.createElement('span');
  chevron.className = 'aekFolder__chevron';
  chevron.setAttribute('aria-hidden', 'true');
  chevron.innerHTML = CHEVRON_ICON;
  const titleElem = document.createElement('span');
  titleElem.className = 'aekFolder__title';
  titleElem.textContent = props.title;
  toggleButton.append(chevron, titleElem);
  root.append(toggleButton);

  const region = cmp.add({
    class: 'aekFolder__region',
    attr: { id: regionId, role: 'group', 'aria-labelledby': toggleId },
  });
  // The grid row's item: it shrinks to nothing, which the padded content couldn't
  const clip = region.add({ class: 'aekFolder__clip' });
  const content = clip.add({ class: 'aekFolder__content' });

  const setAttrIf = (elem: Element, name: string, on: boolean) => {
    if (on) elem.setAttribute(name, '');
    else elem.removeAttribute(name);
  };

  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  /** The state drawn at once: at the creation, and at an animation's end */
  const drawSettled = () => {
    root.removeAttribute('data-animating');
    setAttrIf(root, 'data-expanded', isOpen);
    setAttrIf(region.elem, 'hidden', !isOpen);
  };

  const applyExpanded = (open: boolean) => {
    if (open === isOpen) return;
    isOpen = open;
    clearTimer();
    toggleButton.setAttribute('aria-expanded', String(open));
    const duration = MOTION_MS * getMotionFactor(root);
    if (open) {
      region.elem.removeAttribute('hidden');
      // Its fields show again: those it hid since a refresh are read once
      if (scheduler) revealScheduledBindings(scheduler);
    } else if (region.elem.contains(document.activeElement)) {
      // What had the focus is going: the button keeps it
      toggleButton.focus();
    }
    if (duration > 0) {
      root.setAttribute('data-animating', '');
      // From the shut height: a layout read between showing the region and opening it
      if (open) void region.elem.offsetHeight;
      setAttrIf(root, 'data-expanded', open);
      timer = setTimeout(() => {
        timer = null;
        drawSettled();
      }, duration);
    } else {
      drawSettled();
    }
    props.onExpandedChange?.(open);
  };

  const applyHidden = (on: boolean) => {
    if (on === isHidden) return;
    isHidden = on;
    setAttrIf(root, 'hidden', on);
    if (!on && isOpen && scheduler) revealScheduledBindings(scheduler);
  };

  const onClick = () => applyExpanded(!isOpen);
  toggleButton.addEventListener('click', onClick);

  toggleButton.setAttribute('aria-expanded', String(isOpen));
  drawSettled();
  applyHidden(resolveDyn(hiddenProp));
  if (props.children) addFormChildren(content, props.children);
  // Its `hidden` function is re-read with its fields'; it has no value to read
  if (scheduler && typeof hiddenProp === 'function') {
    removeEntry = addScheduledBinding(scheduler, {
      read: () => {},
      readState: () => applyHidden(resolveDyn(hiddenProp)),
      isShown: () => false,
    });
  }

  return {
    cmp,
    content,
    add: (...children) => addFormChildren(content, children),
    isExpanded: () => isOpen,
    setExpanded: applyExpanded,
    toggle: () => applyExpanded(!isOpen),
    setTitle: (title) => {
      titleElem.textContent = title;
    },
    setHidden: (on) => {
      hiddenProp = on;
      applyHidden(on);
    },
    refresh: () => applyHidden(resolveDyn(hiddenProp)),
  };
};
