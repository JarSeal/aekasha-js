// The command palette (p805 D12): a modal search over an app's commands on the overlay layer, an
// input as a combobox over a grouped listbox. Its types are in `CommandPaletteTypes.ts`.
import type { CMPHandle } from '../core/CMPTypes';
import { CMP, classes } from '../core/CMP';
import { getHUDRootCMP } from '../core/HUD';
import { createKbd } from '../components/Kbd';
import { createSpinner } from '../components/Spinner';
import {
  appendMarked,
  appendRanges,
  getQueryWords,
  prepareScoredText,
  scoreText,
  type ScoredText,
} from '../data/Filter';
import type {
  CommandPalette,
  CommandPaletteProps,
  PaletteCommand,
  PaletteSourceResult,
} from './CommandPaletteTypes';
import { trapFocus } from './FocusTrap';
import { pushOverlay, swallowNextKeyUp } from './OverlayStack';
import './CommandPalette.scss';
import '../styles/kit.scss';

/** How many commands the recent list keeps */
const RECENT_LIMIT = 5;
/** How long an async source waits after a keystroke before it's asked again */
const SOURCE_DELAY_MS = 150;
/** The recent commands' group on an empty query */
const RECENT_GROUP = 'Recent';
/** PageUp / PageDown's step when the rows' box doesn't scroll */
const DEFAULT_PAGE_SIZE = 10;
const SEARCH_ICON =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/></svg>';

/** A shown row: its command and option element */
type Row<C> = { command: C; elem: HTMLElement };

/** A shown command, before it's drawn: its group, and its label's marks when the scorer found
 * them (else the terms mark it) */
type Shown<C> = {
  command: C;
  group: string;
  ranges: [number, number][] | null;
};

/** A command folded for the scorer, once per command */
type Prepared = { label: ScoredText; keywords: ScoredText | null };

const createElem = (tag: string, className: string, attrs?: { [name: string]: string }) => {
  const elem = document.createElement(tag);
  elem.className = className;
  if (attrs) for (const [name, value] of Object.entries(attrs)) elem.setAttribute(name, value);
  return elem;
};

const isPromiseLike = <T>(value: unknown): value is PromiseLike<T> =>
  typeof (value as PromiseLike<T> | null)?.then === 'function';

/** The groups in order: `fixed`'s first, then each in order of its first command; '' (no group)
 * where its first command is */
const groupInOrder = <C>(shown: Shown<C>[], fixed: readonly string[] | undefined) => {
  const groups = new Map<string, Shown<C>[]>();
  for (const name of fixed ?? []) groups.set(name, []);
  for (const item of shown) {
    const list = groups.get(item.group);
    if (list) list.push(item);
    else groups.set(item.group, [item]);
  }
  return [...groups].filter(([, items]) => items.length);
};

const countText = (shown: number, total: number) =>
  shown < total ? `${shown} of ${total} results` : `${shown} result${shown === 1 ? '' : 's'}`;

/**
 * Creates a command palette (p805 D12): a modal search over the app's commands, opened with
 * `open()` (the kit reads no keys of its own: bind Ctrl / ⌘ + K in an action map and call it).
 * The query ranks `commands` (every word in a command's label, whole or as its letters in order,
 * else in its `keywords`; word starts and runs of letters first), or a `source` gives the results
 * in its own order, at once or as a promise. The rows are grouped (`group`; their order of first
 * appearance, or `groups`), the matched letters marked. An empty query lists the `recent`
 * commands first, then every command (or the source's results for `''`), else shows the `hint`.
 * Choosing a command closes the palette, then calls `run` and `onSelect` and puts it first in the
 * recent list (`onRecentChange`); an `href` command's row is a link (a modified click is the
 * browser's, the palette staying open).
 * - Parts: `.aekCommandPalette` (in the HUD root while open: over the HUD's bounds at
 *   `--aek-z-palette`, its background `--aek-backdrop`, a click on it closes) holding `__panel`
 *   (`role="dialog"`, `aria-modal`, near the top; the whole bounds below 640 px of them):
 *   `__field` (`__icon`, `__input`, `__close`), `__results` (`role="listbox"`) of `__group`s
 *   (`role="group"`, their `__groupLabel` sticky) and `__option`s (`role="option"`, `<a>` with an
 *   `href`: `__optionIcon`, `__optionText` with `__optionLabel` and `__optionDescription`,
 *   `__optionKbd`; or `renderRow`'s CMP), `__status` (`role="status"`: the count, the hint, no
 *   results, loading with a spinner, an error) and `__hints` (`aria-hidden`, hidden without hover).
 * - Custom properties: `--aek-command-palette-width`, `-max-height`, `-top` (the panel's),
 *   `--aek-command-palette-active-color` (the active row's bar).
 * - Keys (in the input, which keeps the focus: `aria-activedescendant`): Up / Down move (wrapping),
 *   PageUp / PageDown by the box's rows, Enter chooses (an `href` row followed), Escape closes
 *   (never clears first: an open selects the query, so typing replaces it); Home / End stay the
 *   input's. Tab moves between the input and Close only (a focus trap). The pointer makes the row
 *   under it active, without scrolling.
 * - Modal: the HUD root's other children are `inert` while it's open (an app's palette leaves the
 *   debugger live, as an app's dialog does); the focus goes back to what had it. A page outside
 *   the HUD (the Hub's) is the app's to make inert, in `onOpen` / `onClose`.
 *
 * Nothing is drawn until the first `open()`, which needs the HUD root. Dispose of it with
 * `cmp.remove()`.
 * @template C the app's command type: `renderRow` and `onSelect` read its own fields
 * @example
 * ```ts
 * const palette = createCommandPalette({
 *   label: 'Commands',
 *   commands: [
 *     { id: 'resetCamera', label: 'Reset the camera', group: 'View', run: resetCamera },
 *     { id: 'toggleGrid', label: 'Toggle the grid', group: 'View', kbd: 'G', run: toggleGrid },
 *     { id: 'save', label: 'Save the level', group: 'File', kbd: 'Ctrl+S', run: saveLevel },
 *   ],
 * });
 * openPaletteButton.addEventListener('click', () => palette.open());
 * ```
 */
export const createCommandPalette = <C extends PaletteCommand = PaletteCommand>(
  props: CommandPaletteProps<C>
): CommandPalette<C> => {
  const { label } = props;
  let commands: readonly C[] = props.commands ?? [];
  let prepared = new Map<C, Prepared>();
  let recent: string[] = [...(props.recent ?? [])];
  /** The commands chosen while it lived, by id: the recent list's, where `commands` doesn't
   * have them (a source's) */
  const chosen = new Map<string, C>();
  let isOpen = false;
  let rows: Row<C>[] = [];
  /** The CMPs the rows hold (key hints, `renderRow`'s), removed with them */
  let rowCmps: CMPHandle[] = [];
  let statusCmp: CMPHandle | null = null;
  let activeIndex = -1;
  /** Counts the source's calls: an answer to an older one is dropped */
  let querySeq = 0;
  /** The source's last answer was a promise: the next call waits for the typing to pause */
  let isSourceAsync = false;
  let sourceTimer: ReturnType<typeof setTimeout> | undefined;
  let removeOverlay: ((returnFocus?: boolean) => void) | null = null;
  let removeTrap: (() => void) | null = null;

  const cmp: CMPHandle = CMP({
    id: props.id,
    idAttr: true,
    class: classes('aekCommandPalette', props.class),
    attr: props.attr,
    onRemoveCmp: () => {
      close(false);
      clearRows();
      for (const hint of hintCmps) hint.remove();
      spinner.cmp.remove();
    },
  });
  const id = cmp.id;
  const root = cmp.elem;
  const listId = `${id}-results`;

  const panel = createElem('div', 'aekCommandPalette__panel', {
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': label,
  });
  const field = createElem('div', 'aekCommandPalette__field');
  const icon = createElem('span', 'aekCommandPalette__icon', { 'aria-hidden': 'true' });
  icon.innerHTML = SEARCH_ICON;
  const input = createElem('input', 'aekCommandPalette__input', {
    type: 'text',
    role: 'combobox',
    'aria-label': label,
    'aria-autocomplete': 'list',
    'aria-expanded': 'false',
    'aria-controls': listId,
    autocomplete: 'off',
    autocapitalize: 'off',
    spellcheck: 'false',
    enterkeyhint: 'go',
    placeholder: props.placeholder ?? label,
  }) as HTMLInputElement;
  const closeButton = createElem('button', 'aekCommandPalette__close', { type: 'button' });
  closeButton.textContent = 'Close';
  field.append(icon, input, closeButton);
  const results = createElem('div', 'aekCommandPalette__results', {
    id: listId,
    role: 'listbox',
    'aria-label': label,
  });
  results.hidden = true;
  const status = createElem('p', 'aekCommandPalette__status', { role: 'status' });
  const spinner = createSpinner({ decorative: true, class: 'aekCommandPalette__spinner' });
  const statusText = document.createTextNode('');
  panel.append(field, results, status);

  // The hints footer: what the keys do, for a pointer user (`aria-hidden`: the combobox says it)
  const hintCmps: CMPHandle[] = [];
  if (props.hints !== false) {
    const hints = createElem('p', 'aekCommandPalette__hints', { 'aria-hidden': 'true' });
    const verbs = { move: 'to move', select: 'to run', close: 'to close', ...props.hints };
    const addHint = (keys: string[], text: string) => {
      const hint = createElem('span', 'aekCommandPalette__hint');
      for (const keyName of keys) {
        const kbd = createKbd({ keys: keyName });
        hintCmps.push(kbd.cmp);
        hint.append(kbd.cmp.elem);
      }
      hint.append(` ${text}`);
      hints.append(hint);
    };
    addHint(['ArrowUp', 'ArrowDown'], verbs.move);
    addHint(['Enter'], verbs.select);
    addHint(['Escape'], verbs.close);
    panel.append(hints);
  }
  root.append(panel);

  // --- The status ---

  const setStatus = (text: string | CMPHandle, isLoading = false) => {
    statusCmp?.remove();
    statusCmp = null;
    status.replaceChildren();
    if (isLoading) status.append(spinner.cmp.elem);
    if (typeof text === 'string') {
      statusText.data = text;
      status.append(statusText);
    } else {
      statusCmp = text;
      status.append(text.elem);
    }
    if (isLoading) results.setAttribute('aria-busy', 'true');
    else results.removeAttribute('aria-busy');
  };

  // --- The rows ---

  const clearRows = () => {
    for (const rowCmp of rowCmps) rowCmp.remove();
    rowCmps = [];
    rows = [];
    activeIndex = -1;
    results.replaceChildren();
    results.hidden = true;
    input.removeAttribute('aria-activedescendant');
    input.setAttribute('aria-expanded', 'false');
  };

  /** Keeps the option in the rows' box, below its group's sticky label */
  const scrollToRow = (elem: HTMLElement) => {
    const groupLabel = elem.parentElement?.querySelector<HTMLElement>(
      ':scope > .aekCommandPalette__groupLabel'
    );
    const covered = groupLabel?.offsetHeight ?? 0;
    const top = elem.offsetTop;
    const bottom = top + elem.offsetHeight;
    if (top - covered < results.scrollTop) results.scrollTop = top - covered;
    else if (bottom > results.scrollTop + results.clientHeight) {
      results.scrollTop = bottom - results.clientHeight;
    }
  };

  const setActive = (index: number, shouldScroll: boolean) => {
    const previous = rows[activeIndex];
    previous?.elem.setAttribute('aria-selected', 'false');
    activeIndex = index;
    const row = rows[index];
    if (!row) {
      input.removeAttribute('aria-activedescendant');
      return;
    }
    row.elem.setAttribute('aria-selected', 'true');
    input.setAttribute('aria-activedescendant', row.elem.id);
    if (shouldScroll) scrollToRow(row.elem);
  };

  /** A row's default parts: its icon, label and description (marked), and its key hint */
  const drawRow = (option: HTMLElement, item: Shown<C>, terms: readonly string[]) => {
    const { command } = item;
    if (command.icon) {
      const iconElem = createElem('span', 'aekCommandPalette__optionIcon', {
        'aria-hidden': 'true',
      });
      iconElem.innerHTML = command.icon;
      option.append(iconElem);
    }
    const text = createElem('span', 'aekCommandPalette__optionText');
    const labelElem = createElem('span', 'aekCommandPalette__optionLabel');
    if (item.ranges) appendRanges(labelElem, command.label, item.ranges);
    else appendMarked(labelElem, command.label, terms);
    text.append(labelElem);
    if (command.description) {
      const description = createElem('span', 'aekCommandPalette__optionDescription');
      appendMarked(description, command.description, terms);
      text.append(description);
    }
    option.append(text);
    if (command.kbd) {
      const kbd = createKbd({ keys: command.kbd });
      rowCmps.push(kbd.cmp);
      const kbdElem = createElem('span', 'aekCommandPalette__optionKbd', { 'aria-hidden': 'true' });
      kbdElem.append(kbd.cmp.elem);
      option.append(kbdElem);
      option.setAttribute('aria-keyshortcuts', kbd.getAriaKeyShortcuts());
    }
  };

  const createRow = (item: Shown<C>, query: string, words: readonly string[]) => {
    const { command } = item;
    const option = createElem(command.href ? 'a' : 'div', 'aekCommandPalette__option', {
      id: `${id}-option-${rows.length}`,
      role: 'option',
      'aria-selected': 'false',
    });
    if (command.href) option.setAttribute('href', command.href);
    if (command.disabled) option.setAttribute('aria-disabled', 'true');
    const terms = command.matchTerms ?? words;
    if (props.renderRow) {
      const rendered = props.renderRow(command, {
        query,
        terms,
        appendMarked: (parent, text) => appendMarked(parent, text, terms),
      });
      rowCmps.push(rendered);
      option.append(rendered.elem);
    } else {
      drawRow(option, item, terms);
    }
    rows.push({ command, elem: option });
    return option;
  };

  const showRows = (shown: Shown<C>[], query: string) => {
    clearRows();
    const words = getQueryWords(query);
    groupInOrder(shown, props.groups).forEach(([name, items], groupIndex) => {
      let parent: HTMLElement = results;
      if (name) {
        parent = createElem('div', 'aekCommandPalette__group', {
          role: 'group',
          'aria-labelledby': `${id}-group-${groupIndex}`,
        });
        const groupLabel = createElem('div', 'aekCommandPalette__groupLabel', {
          id: `${id}-group-${groupIndex}`,
          role: 'presentation',
        });
        groupLabel.textContent = name;
        parent.append(groupLabel);
        results.append(parent);
      }
      for (const item of items) parent.append(createRow(item, query, words));
    });
    if (!rows.length) return;
    results.hidden = false;
    results.scrollTop = 0;
    input.setAttribute('aria-expanded', 'true');
    setActive(0, false);
  };

  // --- The query ---

  const getPrepared = (command: C) => {
    let entry = prepared.get(command);
    if (!entry) {
      entry = {
        label: prepareScoredText(command.label),
        keywords: command.keywords?.length ? prepareScoredText(command.keywords.join(' ')) : null,
      };
      prepared.set(command, entry);
    }
    return entry;
  };

  /** A command's score: each word in its label, else in its keywords at half its worth (the
   * label before the keywords); the label's marks */
  const scoreCommand = (command: C, words: readonly string[]) => {
    const { label: labelText, keywords } = getPrepared(command);
    const inLabel = scoreText(labelText, words);
    if (inLabel) return inLabel;
    let score = 0;
    const labelWords: string[] = [];
    for (const word of words) {
      const one = [word];
      const match = scoreText(labelText, one);
      if (match) {
        score += match.score;
        labelWords.push(word);
        continue;
      }
      const keywordMatch = keywords && scoreText(keywords, one);
      if (!keywordMatch) return null;
      score += keywordMatch.score / 2;
    }
    const ranges = labelWords.length ? scoreText(labelText, labelWords)?.ranges ?? [] : [];
    return { score, ranges };
  };

  /** The recent commands that still exist, newest first */
  const getRecentCommands = () => {
    const byId = new Map<string, C>();
    for (const command of commands) byId.set(command.id, command);
    const found: C[] = [];
    for (const recentId of recent) {
      const command = byId.get(recentId) ?? chosen.get(recentId);
      if (command) found.push(command);
    }
    return found;
  };

  /** Shows the commands for the query (no source) */
  const showCommands = (query: string) => {
    const words = getQueryWords(query);
    if (!words.length) {
      const recentCommands = getRecentCommands();
      const recentSet = new Set(recentCommands);
      showRows(
        [
          ...recentCommands.map((command) => ({ command, group: RECENT_GROUP, ranges: null })),
          ...commands
            .filter((command) => !recentSet.has(command))
            .map((command) => ({ command, group: command.group ?? '', ranges: null })),
        ],
        query
      );
      setStatus(props.hint ?? '');
      return;
    }
    const scored: { item: Shown<C>; score: number; index: number }[] = [];
    commands.forEach((command, index) => {
      const match = scoreCommand(command, words);
      if (!match) return;
      const item = { command, group: command.group ?? '', ranges: match.ranges };
      scored.push({ item, score: match.score, index });
    });
    scored.sort((a, b) => b.score - a.score || a.index - b.index);
    showResult(
      scored.map((entry) => entry.item),
      scored.length,
      query
    );
  };

  /** Shows a result list (ranked, or a source's) with its count, or no results */
  const showResult = (shown: Shown<C>[], total: number, query: string) => {
    showRows(shown, query);
    if (shown.length) {
      setStatus(countText(shown.length, total));
      return;
    }
    const { emptyText } = props;
    setStatus(
      typeof emptyText === 'function'
        ? emptyText(query)
        : emptyText ?? `No results for “${query.trim()}”.`
    );
  };

  /** Shows a source's answer for the query */
  const showSourceResult = (result: PaletteSourceResult<C>, query: string) => {
    const list = 'commands' in result ? result.commands : result;
    const total = 'commands' in result ? Math.max(result.total, list.length) : list.length;
    const shown = list.map((command) => ({ command, group: command.group ?? '', ranges: null }));
    if (query.trim()) {
      showResult(shown, total, query);
      return;
    }
    const recentCommands = getRecentCommands();
    const recentSet = new Set(recentCommands.map((command) => command.id));
    showRows(
      [
        ...recentCommands.map((command) => ({ command, group: RECENT_GROUP, ranges: null })),
        ...shown.filter((item) => !recentSet.has(item.command.id)),
      ],
      query
    );
    setStatus(props.hint ?? '');
  };

  const showError = (error: unknown) => {
    clearRows();
    const { errorText } = props;
    setStatus(
      typeof errorText === 'function'
        ? errorText(error)
        : errorText ?? 'The results could not load.'
    );
  };

  const askSource = (query: string) => {
    const { source } = props;
    if (!source) return;
    const seq = ++querySeq;
    let result: ReturnType<typeof source>;
    try {
      result = source(query);
    } catch (error) {
      showError(error);
      return;
    }
    if (!isPromiseLike<PaletteSourceResult<C>>(result)) {
      isSourceAsync = false;
      showSourceResult(result, query);
      return;
    }
    isSourceAsync = true;
    setStatus(props.loadingText ?? 'Loading…', true);
    result.then(
      (answer) => {
        if (seq === querySeq && isOpen) showSourceResult(answer, query);
      },
      (error: unknown) => {
        if (seq === querySeq && isOpen) showError(error);
      }
    );
  };

  /** Shows the input's query: the commands ranked, or the source asked (at once, or once the
   * typing pauses while its answers are promises) */
  const runQuery = () => {
    const query = input.value;
    clearTimeout(sourceTimer);
    sourceTimer = undefined;
    if (!props.source) {
      showCommands(query);
      return;
    }
    if (!isSourceAsync) {
      askSource(query);
      return;
    }
    // An older answer still on its way is stale now
    querySeq++;
    setStatus(props.loadingText ?? 'Loading…', true);
    sourceTimer = setTimeout(() => {
      sourceTimer = undefined;
      askSource(query);
    }, SOURCE_DELAY_MS);
  };

  // --- Choosing ---

  /** Closes, then runs: a dialog the command opens gives the focus back to the palette's opener */
  const choose = (command: C) => {
    if (command.disabled) return;
    close();
    chosen.set(command.id, command);
    recent = [command.id, ...recent.filter((recentId) => recentId !== command.id)].slice(
      0,
      RECENT_LIMIT
    );
    props.onRecentChange?.([...recent]);
    command.run?.();
    props.onSelect?.(command);
  };

  const getRowAt = (target: EventTarget | null) => {
    const option = (target as Element | null)?.closest?.('.aekCommandPalette__option');
    if (!option) return -1;
    return rows.findIndex((row) => row.elem === option);
  };

  const onResultsClick = (e: MouseEvent) => {
    const index = getRowAt(e.target);
    const row = rows[index];
    if (!row) return;
    if (row.command.disabled) {
      e.preventDefault();
      return;
    }
    // A modified click on a link is the browser's (a new tab): the palette stays
    if (row.command.href && (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)) return;
    choose(row.command);
  };

  /** The input keeps the focus: a press on a row doesn't take it */
  const onResultsMouseDown = (e: MouseEvent) => {
    if (getRowAt(e.target) !== -1) e.preventDefault();
  };

  const onResultsPointerMove = (e: PointerEvent) => {
    const index = getRowAt(e.target);
    if (index !== -1 && index !== activeIndex) setActive(index, false);
  };

  const getPageSize = () => {
    const rowHeight = rows[0]?.elem.offsetHeight ?? 0;
    if (!rowHeight || results.scrollHeight <= results.clientHeight) return DEFAULT_PAGE_SIZE;
    return Math.max(1, Math.floor(results.clientHeight / rowHeight) - 1);
  };

  const onInputKeyDown = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    const count = rows.length;
    let next = -1;
    if (e.key === 'ArrowDown') next = count ? (activeIndex + 1) % count : -1;
    else if (e.key === 'ArrowUp') next = count ? (activeIndex - 1 + count) % count : -1;
    else if (e.key === 'PageDown') next = Math.min(count - 1, activeIndex + getPageSize());
    else if (e.key === 'PageUp') next = Math.max(0, activeIndex - getPageSize());
    else if (e.key === 'Enter' && !e.isComposing) {
      const row = rows[activeIndex];
      if (row?.command.href && !row.command.disabled) row.elem.click();
      else if (row) choose(row.command);
    } else return;
    e.preventDefault();
    e.stopPropagation();
    swallowNextKeyUp(e.key);
    if (next !== -1 && next !== activeIndex) setActive(next, true);
  };

  const onInput = () => {
    props.onQueryChange?.(input.value);
    runQuery();
  };

  /** A press on the backdrop (the root itself, around the panel) closes */
  const onRootClick = (e: MouseEvent) => {
    if (e.target === root) close();
  };

  input.addEventListener('input', onInput);
  input.addEventListener('keydown', onInputKeyDown);
  closeButton.addEventListener('click', () => close());
  results.addEventListener('click', onResultsClick);
  results.addEventListener('mousedown', onResultsMouseDown);
  results.addEventListener('pointermove', onResultsPointerMove);
  root.addEventListener('click', onRootClick);

  // --- Open and close ---

  /** Closes it; `returnFocus` false when it's removed */
  function close(returnFocus = true) {
    if (!isOpen) return;
    isOpen = false;
    querySeq++;
    clearTimeout(sourceTimer);
    sourceTimer = undefined;
    removeTrap?.();
    removeTrap = null;
    removeOverlay?.(returnFocus);
    removeOverlay = null;
    root.remove();
    props.onClose?.();
  }

  const open = (options: { query?: string } = {}) => {
    if (options.query !== undefined) input.value = options.query;
    if (!isOpen) {
      isOpen = true;
      getHUDRootCMP().elem.appendChild(root);
      removeOverlay = pushOverlay({ elem: root, close: () => close(), inert: true });
      removeTrap = trapFocus(panel);
      props.onOpen?.();
    }
    input.focus({ preventScroll: true });
    input.select();
    runQuery();
  };

  return {
    cmp,
    open,
    close: () => close(),
    isOpen: () => isOpen,
    getQuery: () => input.value,
    setCommands: (next) => {
      commands = next;
      prepared = new Map();
      if (isOpen && !props.source) runQuery();
    },
    setRecent: (ids) => {
      recent = ids.slice(0, RECENT_LIMIT);
      if (isOpen && !input.value.trim()) runQuery();
    },
  };
};
