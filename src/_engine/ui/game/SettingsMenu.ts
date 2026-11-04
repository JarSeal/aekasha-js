import type { CMPAttr, CMPHandle } from '../core/CMPTypes';
import type { SvgIconKey } from '../core/icons/SvgIcon';
import type { Field, FieldChange } from '../forms/Field';
import { CMP, classes } from '../core/CMP';
import { getSvgIcon } from '../core/icons/SvgIcon';
import { announce } from '../components/Announcer';
import { createButton } from '../components/Button';
import { createTabs, type TabDef } from '../components/Tabs';
import { createBindingScheduler } from '../forms/binding/BindingScheduler';
import { createPropertyGrid } from '../forms/PropertyGrid';
import {
  addPropertyGridItems,
  type PropertyGridFieldItem,
  type PropertyGridItem,
} from '../forms/PropertyGridItems';
import { swallowNextKeyUp } from '../overlays/OverlayStack';
import './SettingsMenu.scss';
import '../styles/kit.scss';

/** A page of a {@link SettingsMenu}: a tab of settings described as data, and content of the
 * app's after them (the controls page). */
export type SettingsPage = {
  /** Its key: what `onSelect`, `select` and `SettingsChange.page` name it by, unique. */
  key: string;
  /** Its tab's text ('Video'). */
  label: string;
  /** A registered icon's name (`registerIcon`), drawn before the label. */
  icon?: SvgIconKey;
  /** Its settings, the property grid's items: fields bound to the app's settings, folders,
   * buttons, separators. */
  items?: readonly PropertyGridItem[];
  /** Content after the items (`createControlsPage`'s CMP): added once, removed with the menu. */
  content?: CMPHandle;
  /** What "Reset page" (and "Reset all") does for `content`, after the items' defaults are
   * written: the controls page's `reset`. */
  onReset?: () => void;
};

/** A setting's change {@link SettingsMenuProps.onChange} reports. */
export type SettingsChange = {
  /** The page's key. */
  page: string;
  /** The item as the app gave it (its `key` and `target` say which setting). */
  item: PropertyGridFieldItem;
  /** The value written. */
  value: unknown;
  /** The field's change: `change.last` is false while a slider is dragged, true at its end. */
  change: FieldChange<unknown>;
};

/** "Reset all"'s question before it acts (each text has a default). */
export type SettingsResetConfirm = {
  /** The question (default 'Reset every setting to its default?'). */
  text?: string;
  /** The button that resets (default: `resetAllLabel`). */
  confirmLabel?: string;
  /** The button that doesn't (default 'Cancel'). */
  cancelLabel?: string;
};

/** What {@link createSettingsMenu} shows. */
export type SettingsMenuProps = {
  /** The pages, in order (at least one). */
  pages: readonly SettingsPage[];
  /** The tab list's name (default 'Settings'). */
  label?: string;
  /** The page shown first (default: the first). */
  selected?: string;
  /** A page the player selected (a tab, or `selectNext`), by its key: what the app may remember. */
  onSelect?: (key: string) => void;
  /** Every write of a setting, after the item's own `onChange`: what the owner applies and, on
   * `change.last`, persists (the menu writes no storage). A reset reports each field it changes. */
  onChange?: (change: SettingsChange) => void;
  /** "Reset page" (its key) or "Reset all" (null) ran, after every change it reported: one save. */
  onReset?: (page: string | null) => void;
  /** The tabs' direction (default 'horizontal': over the page; 'vertical': at its start). */
  orientation?: 'horizontal' | 'vertical';
  /** The label column's width, a percent of the page (default 45). */
  labelWidth?: number;
  /** "Reset page"'s text (default 'Reset page'). */
  resetPageLabel?: string;
  /** "Reset all"'s text (default 'Reset all'). */
  resetAllLabel?: string;
  /** Whether "Reset all" asks first, in place of its button (default true), and the texts. */
  confirmResetAll?: boolean | SettingsResetConfirm;
  /** What a reset announces, by the page's label (null: all; default '{Page} reset to defaults',
   * 'Every setting reset to its default'). */
  resetDoneText?: (pageLabel: string | null) => string;
  /** Extra classes for its element. */
  class?: string | string[];
  /** Extra attributes for its element. */
  attr?: CMPAttr;
  /** Its element id (default: a generated one, not written to the element). */
  id?: string;
};

/** A settings menu {@link createSettingsMenu} made: its CMP and its controls. */
export type SettingsMenu = {
  /** Its element (`.aekSettingsMenu`): add it where it goes (a game menu's page, a window).
   * `cmp.remove()` removes every page, shown or not. */
  cmp: CMPHandle;
  /** Shows a page by its key, without `onSelect` (an unknown key does nothing). */
  select: (key: string) => void;
  /** Shows the page `step` from the shown one, round (a gamepad's shoulder buttons), and calls
   * `onSelect`; the focus, when it was in the menu, goes to the new page's tab. */
  selectNext: (step: number) => void;
  /** The shown page's key */
  getSelected: () => string;
  /** Re-reads every page's fields, shown or not, and each `hidden` and `disabled` function (the
   * app changed its settings: loaded a save). Never fires `onChange`. */
  refresh: () => void;
  /** Writes the defaults of a page's fields (default: the shown page's) and calls its `onReset`. */
  resetPage: (key?: string) => void;
  /** Writes every page's defaults and calls each `onReset`. */
  resetAll: () => void;
  /** A page's fields (not its read-only ones), in order: empty for an unknown key */
  getFields: (key: string) => readonly Field<unknown>[];
};

/** One page's parts */
type PageEntry = {
  page: SettingsPage;
  cmp: CMPHandle;
  fields: Field<unknown>[];
  /** Whether the tabs added it (they remove it then) */
  isShown: boolean;
};

const DEFAULT_RESET_DONE = (pageLabel: string | null) =>
  pageLabel === null ? 'Every setting reset to its default' : `${pageLabel} reset to defaults`;

/**
 * Creates a settings menu (p808 D9): pages on tabs, each a property grid of the app's settings
 * described as data (`PropertyGridItem`s bound to its settings object), with "Reset page" and
 * "Reset all". The menu reports each change and its owner applies and persists it (p804 D1). It
 * goes in a game menu's page (`page: { title: 'Settings', content: settings.cmp }`) or a window.
 * - Parts: `.aekSettingsMenu` (`data-orientation`) holding the tabs (`.aekTabs`; see `createTabs`),
 *   a `.aekSettingsMenu__page` per page (`data-page`: the property grid, then its `content`),
 *   and `__actions` (`data-confirming` while "Reset all" asks) with `__resetPage`, `__resetAll`
 *   and `__confirm` (`__confirmText`, `__cancel`, `__confirmReset`).
 * - Custom properties (read on any ancestor): `--aek-settings-menu-gap` (default `--aek-space-5`),
 *   the tabs' and the property grid's own.
 * - Keys: the tabs' (the arrows along the tab list, Home / End); the fields' own; Enter and Space
 *   on its buttons are kept from the action maps. A gamepad's shoulder buttons are the app's
 *   `selectNext(±1)`; its d-pad the game menu's spatial navigation.
 * - Assistive tech: the tab list named by `label`, each page a tab panel; "Reset all"'s question
 *   is a group named by its text, the focus on Cancel, and gone (as Cancel) when the focus leaves
 *   it; a reset from a button is announced politely ('Video reset to defaults').
 * - Motion: none of its own.
 * @example
 * ```ts
 * import { createGameMenu, createSettingsMenu, setKitPreferences } from 'aekasha/ui';
 *
 * const prefs = { uiScale: 1, subtitles: true };
 * const settings = createSettingsMenu({
 *   pages: [
 *     {
 *       key: 'display',
 *       label: 'Display',
 *       items: [
 *         { target: prefs, key: 'uiScale', label: 'UI scale', min: 0.75, max: 1.5, step: 0.05 },
 *         { target: prefs, key: 'subtitles', label: 'Subtitles', kind: 'switch' },
 *       ],
 *     },
 *   ],
 *   onChange: ({ change }) => {
 *     setKitPreferences({ uiScale: prefs.uiScale });
 *     if (change.last) localStorage.setItem('prefs', JSON.stringify(prefs));
 *   },
 * });
 * const pause = createGameMenu({
 *   title: 'Paused',
 *   onBack: () => pause.close(),
 *   items: [{ id: 'settings', label: 'Settings', page: { title: 'Settings', content: settings.cmp } }],
 * });
 * ```
 */
export const createSettingsMenu = (props: SettingsMenuProps): SettingsMenu => {
  const orientation = props.orientation ?? 'horizontal';
  const resetAllLabel = props.resetAllLabel ?? 'Reset all';
  const confirm =
    props.confirmResetAll === false
      ? null
      : props.confirmResetAll === true || props.confirmResetAll === undefined
        ? {}
        : props.confirmResetAll;
  const resetDoneText = props.resetDoneText ?? DEFAULT_RESET_DONE;
  // One scheduler for every page's grid: `refresh()` reads them all
  const scheduler = createBindingScheduler();
  const entries: PageEntry[] = [];
  const byKey = new Map<string, PageEntry>();
  let isConfirming = false;

  const cmp = CMP({
    id: props.id,
    idAttr: props.id !== undefined,
    class: classes('aekSettingsMenu', props.class),
    attr: { ...props.attr, 'data-orientation': orientation },
    onRemoveCmp: () => {
      // The tabs removed the pages they showed; the rest are the menu's
      for (const entry of entries) if (!entry.isShown) entry.cmp.remove();
      scheduler.dispose();
      actions.removeEventListener('keydown', onActionKeyDown);
      confirmElem?.removeEventListener('focusout', onConfirmFocusOut);
    },
  });

  /** The items with the menu's reports added: each field's change, and its handle collected */
  const wrapItems = (
    items: readonly PropertyGridItem[],
    page: SettingsPage,
    fields: Field<unknown>[]
  ): PropertyGridItem[] =>
    items.map((item): PropertyGridItem => {
      switch (item.type) {
        case 'folder':
          return { ...item, items: wrapItems(item.items, page, fields) };
        case 'button':
        case 'separator':
        case 'custom':
          return item;
        default: {
          const isMonitor = Boolean(item.readonly) || item.view === 'graph';
          return {
            ...item,
            onChange(value, change) {
              item.onChange?.(value, change);
              props.onChange?.({ page: page.key, item, value, change });
            },
            onCreate(field) {
              if (!isMonitor) fields.push(field);
              item.onCreate?.(field);
            },
          } as PropertyGridFieldItem;
        }
      }
    });

  for (const page of props.pages) {
    const pageCmp = CMP({ class: 'aekSettingsMenu__page', attr: { 'data-page': page.key } });
    const fields: Field<unknown>[] = [];
    if (page.items?.length) {
      const grid = createPropertyGrid({
        scheduler,
        labelWidth: props.labelWidth ?? 45,
        resizable: false,
      });
      addPropertyGridItems(grid, wrapItems(page.items, page, fields));
      pageCmp.add(grid.cmp);
    }
    if (page.content) pageCmp.add(page.content);
    const entry: PageEntry = { page, cmp: pageCmp, fields, isShown: false };
    entries.push(entry);
    byKey.set(page.key, entry);
  }

  const tabDefs: TabDef[] = entries.map((entry) => ({
    key: entry.page.key,
    label: entry.page.label,
    icon: entry.page.icon ? getSvgIcon(entry.page.icon) : undefined,
    // Built here, so a reset reaches a page never shown; added on its first selection
    content: () => {
      entry.isShown = true;
      return entry.cmp;
    },
  }));

  const writeResetPageState = () => {
    const entry = byKey.get(tabs.getSelected() ?? '');
    resetPageButton.setDisabled(!entry || (!entry.fields.length && !entry.page.onReset));
  };

  const tabs = createTabs({
    tabs: tabDefs,
    selected: props.selected,
    label: props.label ?? 'Settings',
    orientation,
    onSelect: (key) => {
      writeResetPageState();
      props.onSelect?.(key);
    },
  });
  cmp.add(tabs.cmp);

  const resetEntry = (entry: PageEntry) => {
    for (const field of entry.fields) field.reset();
    entry.page.onReset?.();
  };

  const resetPage = (key?: string) => {
    const entry = byKey.get(key ?? tabs.getSelected() ?? '');
    if (!entry) return;
    resetEntry(entry);
    props.onReset?.(entry.page.key);
  };

  const resetAll = () => {
    for (const entry of entries) resetEntry(entry);
    props.onReset?.(null);
  };

  // The actions: Reset page, Reset all, and Reset all's question in their place
  const actionsCmp = cmp.add({ class: 'aekSettingsMenu__actions' });
  const actions = actionsCmp.elem;
  const resetPageButton = createButton({
    label: props.resetPageLabel ?? 'Reset page',
    class: 'aekSettingsMenu__resetPage',
    onClick: () => {
      const entry = byKey.get(tabs.getSelected() ?? '');
      if (!entry) return;
      resetPage(entry.page.key);
      announce(cmp.elem, resetDoneText(entry.page.label));
    },
  });
  const resetAllButton = createButton({
    label: resetAllLabel,
    class: 'aekSettingsMenu__resetAll',
    onClick: () => {
      if (confirm) startConfirm();
      else confirmResetAll();
    },
  });
  actionsCmp.add(resetPageButton.cmp);
  actionsCmp.add(resetAllButton.cmp);

  const confirmResetAll = () => {
    resetAll();
    announce(cmp.elem, resetDoneText(null));
  };

  let confirmElem: HTMLElement | null = null;
  let cancelButton: ReturnType<typeof createButton> | null = null;
  if (confirm) {
    const confirmCmp = actionsCmp.add({
      class: 'aekSettingsMenu__confirm',
      attr: { role: 'group', hidden: '' },
    });
    confirmElem = confirmCmp.elem;
    const text = document.createElement('span');
    text.className = 'aekSettingsMenu__confirmText';
    text.id = `${cmp.id}-confirm`;
    text.textContent = confirm.text ?? 'Reset every setting to its default?';
    confirmElem.setAttribute('aria-labelledby', text.id);
    confirmElem.append(text);
    cancelButton = createButton({
      label: confirm.cancelLabel ?? 'Cancel',
      class: 'aekSettingsMenu__cancel',
      onClick: () => endConfirm(true),
    });
    const confirmButton = createButton({
      label: confirm.confirmLabel ?? resetAllLabel,
      variant: 'danger',
      class: 'aekSettingsMenu__confirmReset',
      onClick: () => {
        endConfirm(true);
        confirmResetAll();
      },
    });
    confirmCmp.add(cancelButton.cmp);
    confirmCmp.add(confirmButton.cmp);
  }

  /** Shows the question in the buttons' place, the focus on Cancel (the safe answer) */
  function startConfirm() {
    if (!confirmElem || isConfirming) return;
    isConfirming = true;
    actions.setAttribute('data-confirming', '');
    confirmElem.removeAttribute('hidden');
    // The focus moves before the buttons hide: it never falls to the page
    cancelButton?.cmp.elem.focus();
    resetPageButton.cmp.elem.setAttribute('hidden', '');
    resetAllButton.cmp.elem.setAttribute('hidden', '');
  }

  /** Puts the buttons back; with `refocus` the focus goes to Reset all (it was in the question) */
  function endConfirm(refocus: boolean) {
    if (!confirmElem || !isConfirming) return;
    isConfirming = false;
    actions.removeAttribute('data-confirming');
    resetPageButton.cmp.elem.removeAttribute('hidden');
    resetAllButton.cmp.elem.removeAttribute('hidden');
    if (refocus) resetAllButton.cmp.elem.focus();
    confirmElem.setAttribute('hidden', '');
  }

  /** The focus leaving the question (Back in a game menu, a click elsewhere) is its Cancel */
  const onConfirmFocusOut = (e: FocusEvent) => {
    const next = e.relatedTarget as Node | null;
    if (next && confirmElem?.contains(next)) return;
    endConfirm(false);
  };
  confirmElem?.addEventListener('focusout', onConfirmFocusOut);

  /** Enter and Space click a button themselves: kept from the action maps only */
  const onActionKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    if ((e.target as Element).tagName !== 'BUTTON') return;
    e.stopPropagation();
    swallowNextKeyUp(e.key);
  };
  actions.addEventListener('keydown', onActionKeyDown);

  writeResetPageState();

  const select = (key: string) => {
    tabs.select(key);
    writeResetPageState();
  };

  return {
    cmp,
    select,
    selectNext: (step) => {
      const whole = Math.trunc(step);
      const count = entries.length;
      if (!whole || count < 2) return;
      const from = Math.max(
        0,
        entries.findIndex((e) => e.page.key === tabs.getSelected())
      );
      const key = entries[(((from + whole) % count) + count) % count].page.key;
      const hadFocus = cmp.elem.contains(document.activeElement);
      select(key);
      if (hadFocus) {
        const tabElems = tabs.cmp.elem.querySelectorAll<HTMLElement>('[role="tab"]');
        [...tabElems].find((elem) => elem.getAttribute('data-tab-key') === key)?.focus();
      }
      props.onSelect?.(key);
    },
    getSelected: () => tabs.getSelected() ?? '',
    refresh: () => {
      scheduler.refresh();
      // The scheduler reads the shown fields; a page not shown would show its old values
      for (const entry of entries) {
        if (!entry.cmp.elem.isConnected || entry.cmp.elem.closest('[hidden]')) {
          for (const field of entry.fields) field.refresh();
        }
      }
    },
    resetPage,
    resetAll,
    getFields: (key) => byKey.get(key)?.fields ?? [],
  };
};
