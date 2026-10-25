import type { CMPHandle } from '../core/CMPTypes';
import { CMP, classes } from '../core/CMP';
import { pushOverlay, swallowNextKeyUp } from '../overlays/OverlayStack';
import { showAnchored } from '../overlays/Anchor';
import './DropDown.scss';
import '../styles/kit.scss';

/** One of a drop-down's options. */
export type DropDownOption = {
  /** What `onChange` gets */
  value: string;
  /** What the list and the trigger show */
  label: string;
};

/** What {@link createDropDown} makes a drop-down from. */
export type DropDownProps = {
  /** The options, or a getter re-read on every open (and refresh). */
  options: DropDownOption[] | (() => DropDownOption[]);
  /** The current value: the trigger shows its label, and the list opens on it and marks it. A
   * getter is re-read on every open, after every pick and on refresh. */
  value?: string | null | (() => string | null);
  /** A picked option, also the current one (the handler decides what that does). The trigger's
   * label is refreshed after it returns, so a `value` getter that reads what it set shows the
   * pick. */
  onChange: (value: string) => void;
  /** The trigger's text when no option matches the value. */
  placeholder?: string;
  /** Raw HTML of the trigger's icon (eg. `getSvgIcon('camera', 'small')`). */
  icon?: string;
  /** The trigger's tooltip and the list's accessible name. */
  title?: string;
  /** Which side of the trigger the list opens on, when it fits there (else the other). Default
   * 'bottom'. */
  placement?: 'top' | 'bottom';
  /** Disables the trigger (default false). */
  disabled?: boolean;
  /** A filter field over the list (p803 D9, the APG combobox with a list): typing filters the
   * options by their labels and marks the matching text, the arrows move through what's left, and
   * Enter picks. Default false. */
  searchable?: boolean;
  /** The filter field's placeholder and accessible name, with `searchable` (default 'Search'). */
  searchPlaceholder?: string;
  /** Extra classes (a class name, or several) for the root. The default styles (DropDown.scss)
   * have zero specificity (`:where()`), so any class overrides them; the elements also carry the
   * global `aekDropDown*` classes. */
  className?: string | string[];
  /** Extra classes for the trigger button */
  triggerClass?: string | string[];
  /** Extra classes for the trigger's label */
  labelClass?: string | string[];
  /** Extra classes for the list (with `searchable`, for its popup: the field and the list) */
  listClass?: string | string[];
  /** Extra classes for each option */
  itemClass?: string | string[];
  /** Runs when the list opens */
  onOpen?: () => void;
  /** Runs when the list closes, however it closes */
  onClose?: () => void;
};

/** A drop-down {@link createDropDown} made: its CMP, to add where it goes, and its controls. */
export type DropDown = {
  /** The dropdown's root (the trigger, and the list while it is open). */
  cmp: CMPHandle;
  /** Opens the list on the current value and focuses it. */
  open: () => void;
  /** Closes the list without a change, giving the focus back when it was in the list. */
  close: () => void;
  /** Opens the list, or closes it when it's open. */
  toggle: () => void;
  /** Whether the list is open */
  isOpen: () => boolean;
  /** Re-reads the value (and options) into the trigger's label: for a change made elsewhere (a
   * pick refreshes it itself). */
  refresh: () => void;
};

/**
 * The old name of {@link DropDown}.
 * @deprecated Use {@link DropDown}. Removed in engine 6.0.0.
 */
export type TDropDown = DropDown;

const ROOT_CLASS = 'aekDropDown';
const TRIGGER_CLASS = 'aekDropDownTrigger';
const LABEL_CLASS = 'aekDropDownLabel';
const CARET_CLASS = 'aekDropDownCaret';
const LIST_CLASS = 'aekDropDownList';
const POPUP_CLASS = 'aekDropDownPopup';
const SEARCH_CLASS = 'aekDropDownSearch';
const EMPTY_CLASS = 'aekDropDownEmpty';
const MATCH_CLASS = 'aekDropDownMatch';
const ITEM_CLASS = 'aekDropDownItem';
const HIGHLIGHTED_CLASS = 'isHighlighted';
const ACTIVE_ATTR = 'data-active';
const CURRENT_CLASS = 'isCurrent';
const NAV_KEYS = new Set(['ArrowDown', 'ArrowUp', 'Home', 'End']);

const resolve = <T>(value: T | (() => T)) =>
  typeof value === 'function' ? (value as () => T)() : value;

/** The options whose labels contain the query (case ignored), as indices into `options` */
const filterOptions = (options: DropDownOption[], query: string) => {
  const needle = query.trim().toLowerCase();
  const indices: number[] = [];
  for (let i = 0; i < options.length; i++) {
    if (!needle || options[i].label.toLowerCase().includes(needle)) indices.push(i);
  }
  return indices;
};

/** Writes a label into an option as text in one span (the option is a flex box, which would
 * drop the spaces around a match), the query's first match in a `<mark>` */
const writeLabel = (item: HTMLElement, label: string, query: string) => {
  const span = document.createElement('span');
  const needle = query.trim().toLowerCase();
  const at = needle ? label.toLowerCase().indexOf(needle) : -1;
  if (at === -1) {
    span.textContent = label;
  } else {
    const mark = document.createElement('mark');
    mark.className = MATCH_CLASS;
    mark.textContent = label.slice(at, at + needle.length);
    span.append(label.slice(0, at), mark, label.slice(at + needle.length));
  }
  item.replaceChildren(span);
};

/**
 * Creates a dropdown: a trigger button with an icon, the current option's label and a caret, and
 * an in-page list (not a native select: a native list owns the keyboard while it is open, and
 * Chrome on Windows commits the highlighted option when it is closed with Escape). The list opens
 * in the browser's top layer, so no window clips it, on the `placement` side when it fits there
 * (else the other), inside the HUD's bounds and as tall as the space left.
 * A click on the trigger toggles the list. In the list, arrow keys, Home and End move, Enter,
 * Space or a click picks, and Escape, Tab or a click outside closes it without a change. The
 * list's keys reach no key binding (their keyups included). The open list is on the kit's overlay
 * stack: in a dialog, one Escape closes the list and the next the dialog. A pick, Escape or Tab
 * gives the focus back to what had it when the list opened (the trigger, opened by its keys).
 * With `searchable`, a filter field over the list takes the focus (`role="combobox"`): typing
 * filters the options by label and marks the match, the arrows move through what's left, Enter
 * picks, and Home, End and Space are the field's.
 * - Parts: `.aekDropDown` (`_top` / `_bottom`), its `.aekDropDownTrigger` with
 *   `.aekDropDownLabel` and `.aekDropDownCaret`; open, `.aekDropDownList` of `.aekDropDownItem`s
 *   (`isHighlighted`, `isCurrent`, `[data-active]`), or with `searchable` the `.aekDropDownPopup`
 *   with `.aekDropDownSearch`, the list and `.aekDropDownEmpty`; a match is `.aekDropDownMatch`.
 * - ARIA: the trigger `aria-haspopup="listbox"` and `aria-expanded`; the list a `listbox` named by
 *   `title`, its options' `aria-selected` the current one; the focus holder's
 *   `aria-activedescendant` the highlighted option.
 *
 * The drop-down isn't added anywhere: add its `cmp` where it goes.
 * @example
 * ```ts
 * const quality = createDropDown({
 *   options: [
 *     { value: 'low', label: 'Low' },
 *     { value: 'high', label: 'High' },
 *   ],
 *   value: () => settings.quality,
 *   onChange: (value) => setQuality(value),
 *   title: 'Quality',
 * });
 * settingsPanel.add(quality.cmp);
 * ```
 */
export const createDropDown = (props: DropDownProps): DropDown => {
  const placement = props.placement || 'bottom';
  let list: CMPHandle | null = null;
  /** Removes the open list's overlay stack entry */
  let removeOverlay: ((returnFocus?: boolean) => void) | null = null;
  /** Stops the open list's anchoring (`showAnchored`) */
  let hideAnchored: (() => void) | null = null;

  const getOptions = () => resolve(props.options);
  const getValue = () => resolve(props.value ?? null);

  const root = CMP({
    class: classes(ROOT_CLASS, `${ROOT_CLASS}_${placement}`, props.className),
    onRemoveCmp: () => {
      list = null;
      // Removed with its list open (eg. in a closing dialog): the dialog returns the focus
      removeOverlay?.(false);
      removeOverlay = null;
      hideAnchored?.();
      hideAnchored = null;
    },
  });

  const trigger = CMP({
    html: () => `<button type="button" class="${classes(TRIGGER_CLASS, props.triggerClass).join(' ')}"${props.disabled ? ' disabled' : ''}>
  ${props.icon || ''}
  <span class="${classes(LABEL_CLASS, props.labelClass).join(' ')}"></span>
  <span class="${CARET_CLASS}"></span>
</button>`,
    attr: {
      ...(props.title ? { title: props.title } : {}),
      'aria-haspopup': 'listbox',
      'aria-expanded': 'false',
    },
    // Not focused by the press: an open list's focusout would close it before the click, which
    // would then reopen it instead of closing it
    listeners: [{ type: 'mousedown', fn: (e) => e.preventDefault() }],
    onClick: (e) => {
      e.stopPropagation();
      toggle();
    },
  });
  root.add(trigger);
  const labelElem = trigger.elem.querySelector(`.${LABEL_CLASS}`);

  const refresh = () => {
    const value = getValue();
    // Text, not HTML: labels often come from app data
    if (labelElem) {
      labelElem.textContent =
        getOptions().find((option) => option.value === value)?.label ?? props.placeholder ?? '';
    }
  };

  /** Closes the list; `returnFocus` false when the focus is moving elsewhere (a focusout) */
  const close = (returnFocus = true) => {
    const openList = list;
    list = null; // first: removing the focused list fires its focusout
    if (!openList) return;
    trigger.updateAttr({ 'aria-expanded': 'false' });
    // Before the list goes: the focus is still in it
    removeOverlay?.(returnFocus);
    removeOverlay = null;
    hideAnchored?.();
    hideAnchored = null;
    openList.remove();
    props.onClose?.();
  };

  const open = () => {
    if (list || props.disabled) return;
    const options = getOptions();
    if (!options.length) return;
    const currentValue = getValue();
    /** The options shown, as indices into `options` (all of them until a filter) */
    let shown = options.map((_, i) => i);
    /** The highlighted option's place in `shown` */
    let index = Math.max(
      0,
      options.findIndex((option) => option.value === currentValue)
    );
    let query = '';

    const newList: CMPHandle = CMP({
      tag: 'ul',
      // Its id is the filter field's aria-controls
      idAttr: true,
      class: classes(LIST_CLASS, props.searchable ? null : props.listClass),
      attr: {
        role: 'listbox',
        ...(props.searchable ? {} : { tabindex: '-1' }),
        ...(props.title ? { 'aria-label': props.title } : {}),
      },
      onClick: (e) => {
        e.stopPropagation();
        const item = (e.target as HTMLElement).closest('li');
        if (item) choose(shown.indexOf(Number(item.dataset.index)));
      },
      listeners: [
        // Keeps the focus where it is on a click, so the click lands before any focusout
        { type: 'mousedown', fn: (e) => e.preventDefault() },
        {
          type: 'mousemove',
          fn: (e) => {
            const item = (e.target as HTMLElement).closest('li');
            const at = item ? shown.indexOf(Number(item.dataset.index)) : -1;
            if (at !== -1 && at !== index) highlight(at);
          },
        },
      ],
    });

    // With `searchable` the field holds the focus (a combobox over the list), else the list does
    const search: CMPHandle | null = props.searchable
      ? CMP({
          tag: 'input',
          class: SEARCH_CLASS,
          attr: {
            type: 'text',
            role: 'combobox',
            'aria-expanded': 'true',
            'aria-controls': newList.id,
            'aria-autocomplete': 'list',
            'aria-label': props.searchPlaceholder || 'Search',
            placeholder: props.searchPlaceholder || 'Search',
            autocomplete: 'off',
            spellcheck: 'false',
          },
          listeners: [{ type: 'input', fn: (e) => filter((e.target as HTMLInputElement).value) }],
        })
      : null;
    const empty: CMPHandle | null = search
      ? CMP({ class: EMPTY_CLASS, text: '', attr: { role: 'status' } })
      : null;
    const popup: CMPHandle = search
      ? CMP({ class: classes(POPUP_CLASS, props.listClass) })
      : newList;
    const focusHolder = search ?? newList;

    const highlight = (newIndex: number) => {
      index = Math.min(shown.length - 1, Math.max(0, newIndex));
      const items = newList.elem.children;
      for (let i = 0; i < items.length; i++) {
        items[i].classList.toggle(HIGHLIGHTED_CLASS, i === index);
        // The ring's: the focus holder keeps the focus for aria-activedescendant (p803 D7)
        items[i].toggleAttribute(ACTIVE_ATTR, i === index);
      }
      if (!shown.length) {
        focusHolder.removeAttr('aria-activedescendant');
        return;
      }
      items[index]?.scrollIntoView({ block: 'nearest' });
      focusHolder.updateAttr({ 'aria-activedescendant': `${newList.id}-${shown[index]}` });
    };

    /** Builds the shown options, the query's matches marked */
    const renderItems = () => {
      newList.removeChildren();
      for (let i = 0; i < shown.length; i++) {
        const option = options[shown[i]];
        const isCurrent = option.value === currentValue;
        const item = newList.add({
          tag: 'li',
          class: classes(ITEM_CLASS, isCurrent ? CURRENT_CLASS : null, props.itemClass),
          attr: {
            id: `${newList.id}-${shown[i]}`,
            role: 'option',
            'aria-selected': String(isCurrent),
            'data-index': String(shown[i]),
          },
        });
        writeLabel(item.elem, option.label, query);
      }
      empty?.updateText(shown.length ? '' : 'No matches');
    };

    const filter = (text: string) => {
      query = text;
      shown = filterOptions(options, query);
      renderItems();
      highlight(0);
    };

    const choose = (chosenIndex: number) => {
      if (chosenIndex < 0 || chosenIndex >= shown.length) return;
      close();
      props.onChange(options[shown[chosenIndex]].value);
      refresh();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      if (e.key === 'ArrowDown') highlight(index + 1);
      else if (e.key === 'ArrowUp') highlight(index - 1);
      // In the filter field Home and End move its caret, and Space types
      else if (e.key === 'Home' && !search) highlight(0);
      else if (e.key === 'End' && !search) highlight(shown.length - 1);
      else if (e.key === 'Enter' || (e.key === ' ' && !search)) {
        swallowNextKeyUp(e.key);
        choose(index);
      } else if (e.key === 'Escape') {
        // The overlay stack takes Escape first under the HUD root; this is a list outside it
        swallowNextKeyUp(e.key);
        close();
      } else if (e.key === 'Tab') {
        close();
        return;
      } else return; // Other keys go on (eg. a shortcut that toggles this list, a typed letter)
      // The list's keys reach no key binding
      e.preventDefault();
      e.stopPropagation();
    };

    popup.elem.addEventListener('keydown', onKeyDown);
    popup.elem.addEventListener('keyup', (e) => {
      // A typed letter's too: a key binding mustn't see the second half of a press it never saw
      if (NAV_KEYS.has(e.key) || (search && e.target === search.elem)) e.stopPropagation();
    });
    popup.elem.addEventListener('focusout', (e) => {
      const next = e.relatedTarget as Node | null;
      if (!next || !popup.elem.contains(next)) close(false);
    });
    if (search && empty) {
      // A press on the popup's own padding or message keeps the focus in the field
      popup.elem.addEventListener('mousedown', (e) => {
        if (e.target !== search.elem) e.preventDefault();
      });
      popup.add(search);
      popup.add(newList);
      popup.add(empty);
    }

    renderItems();
    root.add(popup);
    list = popup;
    trigger.updateAttr({ 'aria-expanded': 'true' });
    // Shown before the highlight scrolls to it: a closed popover has no box
    hideAnchored = showAnchored({
      elem: popup.elem,
      anchor: trigger.elem,
      side: placement,
      matchAnchorWidth: true,
    });
    highlight(index);
    // Before the focus moves in: the entry returns it where it was
    removeOverlay = pushOverlay({ elem: popup.elem, close: () => close() });
    focusHolder.elem.focus({ preventScroll: true });
    props.onOpen?.();
  };

  const toggle = () => (list ? close() : open());

  refresh();

  return { cmp: root, open, close: () => close(), toggle, isOpen: () => Boolean(list), refresh };
};
