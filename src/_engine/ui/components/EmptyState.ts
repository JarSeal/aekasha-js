import type { CMPAttr, CMPHandle } from '../core/CMPTypes';
import { CMP, classes } from '../core/CMP';
import { createButton, type Button, type ButtonProps } from './Button';
import './EmptyState.scss';
import '../styles/kit.scss';

/** What {@link createEmptyState} draws. */
export type EmptyStateProps = {
  /** What's empty, in a few words ('No saved games'). */
  title: string;
  /** What to do about it, or why it's empty ('Your saves show here after your first checkpoint.'). */
  text?: string;
  /** Raw HTML of its icon (`getSvgIcon('databaseX')`), drawn large above the title. */
  icon?: string;
  /** The title as a heading of this level (`h2` to `h6`), where it starts a section of the page's
   * outline; a paragraph by default. */
  headingLevel?: 2 | 3 | 4 | 5 | 6;
  /** Its action: a button made with `createButton` from these props ('New game'). */
  action?: ButtonProps;
  /** Extra classes for its element. */
  class?: string | string[];
  /** Extra attributes for its element. */
  attr?: CMPAttr;
  /** Its element id (default: a generated one, not written to the element). */
  id?: string;
};

/** An empty state {@link createEmptyState} made: its CMP, its action's button and its setters,
 * each writing it in place. */
export type EmptyState = {
  /** Its element (`.aekEmptyState`): add it where the content would be. `cmp.remove()` removes
   * its button too. */
  cmp: CMPHandle;
  /** Its action's button (`action`), or null */
  action: Button | null;
  /** Changes its title. */
  setTitle: (title: string) => void;
  /** Changes its text (an empty string hides it). */
  setText: (text: string) => void;
};

/**
 * Creates an empty state (p803 D10): what a list, a panel or a search shows when it has nothing to
 * show (no saves, no matches), with what to do about it.
 * - Parts: `.aekEmptyState`, `.aekEmptyState__icon` (`aria-hidden`), `.aekEmptyState__title` (a
 *   `<p>`, or a heading at `headingLevel`), `.aekEmptyState__text`, `.aekEmptyState__action` (a
 *   `createButton`).
 * - Custom properties (read on any ancestor): `--aek-empty-state-icon-size` (default 40 px at the
 *   default density), `--aek-empty-state-padding`.
 * - Not live: a list that empties while the player watches says so in a live region of the app's,
 *   if it should.
 * @example
 * ```ts
 * const empty = createEmptyState({
 *   icon: getSvgIcon('databaseX'),
 *   title: 'No saved games',
 *   text: 'Your saves show here after your first checkpoint.',
 *   action: { label: 'New game', variant: 'primary', onClick: () => startNewGame() },
 * });
 * savesPanel.add(empty.cmp);
 * ```
 */
export const createEmptyState = (props: EmptyStateProps): EmptyState => {
  const cmp = CMP({
    id: props.id,
    idAttr: props.id !== undefined,
    class: classes('aekEmptyState', props.class),
    attr: props.attr,
  });
  const elem = cmp.elem;
  if (props.icon) {
    const icon = document.createElement('span');
    icon.className = 'aekEmptyState__icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = props.icon;
    elem.append(icon);
  }
  const titleElem = document.createElement(props.headingLevel ? `h${props.headingLevel}` : 'p');
  titleElem.className = 'aekEmptyState__title';
  titleElem.textContent = props.title;
  const textElem = document.createElement('p');
  textElem.className = 'aekEmptyState__text';
  elem.append(titleElem, textElem);

  const setText = (text: string) => {
    textElem.textContent = text;
    // An attribute: linkedom (the tests) doesn't reflect `hidden` from the property
    if (text === '') textElem.setAttribute('hidden', '');
    else textElem.removeAttribute('hidden');
  };
  setText(props.text ?? '');

  let action: Button | null = null;
  if (props.action) {
    action = createButton({
      ...props.action,
      class: classes('aekEmptyState__action', props.action.class),
    });
    cmp.add(action.cmp);
  }

  return {
    cmp,
    action,
    setTitle: (title) => {
      titleElem.textContent = title;
    },
    setText,
  };
};
