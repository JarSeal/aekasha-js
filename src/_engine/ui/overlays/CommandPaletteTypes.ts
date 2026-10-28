// The command palette's public types (p805 D12), out of `CommandPalette.ts` for its size.
import type { CMPAttr, CMPHandle } from '../core/CMPTypes';

/** A command `createCommandPalette` lists: what its row shows and what choosing it does. */
export type PaletteCommand = {
  /** Its key: the recent list's and the row's, unique among the commands */
  id: string;
  /** What its row says, and what a query is matched against first */
  label: string;
  /** The group its row is in (no group: before the first group, unlabelled) */
  group?: string;
  /** More words a query finds it by (a synonym, an old name), ranked below its label's; not
   * shown */
  keywords?: readonly string[];
  /** A line under its label (marked, not searched) */
  description?: string;
  /** An icon before its label: raw HTML (`getSvgIcon('camera')`), `aria-hidden` */
  icon?: string;
  /** Its keyboard shortcut, shown at the row's end (`'Ctrl+S'`, `createKbd`'s form) and named in
   * the row's `aria-keyshortcuts`. Display only: binding the key is the app's. */
  kbd?: string;
  /** Shown, but not chosen (`aria-disabled`): a command that doesn't apply now */
  disabled?: boolean;
  /** A link: its row is an `<a>`; Enter and a plain click close the palette and follow it, a
   * modified click is the browser's (a new tab) and keeps the palette open. */
  href?: string;
  /** What its row marks (a search's matched terms), in place of the query's words */
  matchTerms?: readonly string[];
  /** Runs when it's chosen, after the palette closed */
  run?: () => void;
};

/** A source's answer: the commands in its order, or them and how many there are in all (the
 * status' "50 of 214 results"). */
export type PaletteSourceResult<C extends PaletteCommand = PaletteCommand> =
  | readonly C[]
  | { commands: readonly C[]; total: number };

/** What a palette asks for each query in place of ranking `commands` itself: its answer at once,
 * or a promise of it. */
export type PaletteSource<C extends PaletteCommand = PaletteCommand> = (
  query: string
) => PaletteSourceResult<C> | Promise<PaletteSourceResult<C>>;

/** What `renderRow` gets besides the command. */
export type PaletteRowParts = {
  /** The query as typed */
  query: string;
  /** What the row marks: the command's `matchTerms`, else the query's words */
  terms: readonly string[];
  /** Appends `text` to `parent` with the terms marked (`<mark class="aekMark">`, text nodes:
   * never HTML) */
  appendMarked: (parent: Node, text: string) => void;
};

/** The hints footer's verbs, after its keys. */
export type CommandPaletteHints = {
  /** After ↑ ↓ (default 'to move') */
  move?: string;
  /** After Enter (default 'to run'; a search's 'to open') */
  select?: string;
  /** After Esc (default 'to close') */
  close?: string;
};

/**
 * What `createCommandPalette` makes a palette from: its `commands` or a `source`, its name,
 * and its texts.
 * @template C the app's command type
 */
export type CommandPaletteProps<C extends PaletteCommand = PaletteCommand> = {
  /** The commands the query ranks (`setCommands` replaces them). Without a `source`. */
  commands?: readonly C[];
  /** Answers each query in place of `commands` (a search index, a server): its order is kept and
   * its matches marked by each command's `matchTerms`. A promise shows `loadingText` with a
   * spinner until it settles; while its answers are promises, the next query waits for the typing
   * to pause (150 ms), and an answer to an older query is dropped. Asked for `''` too (an empty
   * answer shows the `hint`). */
  source?: PaletteSource<C>;
  /** The palette's accessible name, and the input's */
  label: string;
  /** The input's placeholder (default the label) */
  placeholder?: string;
  /** The groups' order (the others after them, by their first row) */
  groups?: readonly string[];
  /** The recent commands' ids, newest first: listed first on an empty query, in a "Recent" group.
   * The palette keeps the list (at most 5) and reports each change; storing it is the app's. */
  recent?: readonly string[];
  /** Called with the recent list after a command is chosen */
  onRecentChange?: (ids: string[]) => void;
  /** The status on an empty query (default none) */
  hint?: string;
  /** The status when a query finds nothing: a text, or a function of the query returning one or
   * a CMP (links to try instead). Default 'No results for “…”.' */
  emptyText?: string | ((query: string) => string | CMPHandle);
  /** The status while a source's promise is pending (default 'Loading…') */
  loadingText?: string;
  /** The status when a source fails: a text, or a function of the error (default 'The results
   * could not load.'). The next query asks the source again. */
  errorText?: string | ((error: unknown) => string);
  /** The hints footer's verbs, or `false` for no footer */
  hints?: CommandPaletteHints | false;
  /** Draws a row's content in place of the icon, label, description and key hint: a CMP, removed
   * with the row. The row element (the option) is the palette's. */
  renderRow?: (command: C, parts: PaletteRowParts) => CMPHandle;
  /** Called with the query after each change the user types (keep it to reopen with it) */
  onQueryChange?: (query: string) => void;
  /** Called with a chosen command, after its `run` */
  onSelect?: (command: C) => void;
  /** Runs when it opens (make a page outside the HUD inert, lock its scroll) */
  onOpen?: () => void;
  /** Runs when it closes, however it closes */
  onClose?: () => void;
  /** Extra classes for the palette's root element. */
  class?: string | string[];
  /** Extra attributes for the palette's root element. */
  attr?: CMPAttr;
  /** The root element's id (default: a generated one); the parts' ids start with it. */
  id?: string;
};

/**
 * A palette `createCommandPalette` made: its CMP and its controls.
 * @template C the app's command type
 */
export type CommandPalette<C extends PaletteCommand = PaletteCommand> = {
  /** Its root element, in the HUD root only while it's open. `cmp.remove()` disposes of it. */
  cmp: CMPHandle;
  /** Opens it (or, open, focuses its input) with the query selected: `query` in place of the last
   * one. Needs the HUD root. */
  open: (options?: { query?: string }) => void;
  /** Closes it, the focus back where it was before the open */
  close: () => void;
  /** Whether it's open */
  isOpen: () => boolean;
  /** The query in its input */
  getQuery: () => string;
  /** Replaces the commands (shown at once while it's open) */
  setCommands: (commands: readonly C[]) => void;
  /** Replaces the recent list (an app restoring it); not reported */
  setRecent: (ids: readonly string[]) => void;
};
