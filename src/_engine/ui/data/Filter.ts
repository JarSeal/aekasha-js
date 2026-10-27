// Matching and marking text (p805 D6): what the list's and the tree's filters and the command
// palette share. Case and accents are ignored; the marks are built as text nodes and `<mark>`s
// (no HTML: rows are app data), and the matches are found in the text's own indices.
import './Filter.scss';
import '../styles/kit.scss';

/** A mark's class: `Filter.scss`' look */
const MARK_CLASS = 'aekMark';
const MARKS = /\p{M}/gu;
/** Any character past ASCII (a surrogate half included) */
const NON_ASCII = /[\u0080-\uffff]/;

/** A piece of text folded: lowercased, its accents (NFD's combining marks) dropped, and the final
 * sigma made a sigma (`toLowerCase` writes it only at a word's end) */
const foldPart = (text: string) =>
  text.normalize('NFD').replace(MARKS, '').toLowerCase().replace(/ς/g, 'σ');

/**
 * Folds text for matching: lowercased and without accents (`Café` and `cafe` match). A list folds
 * each row's text once, not on every query.
 * @internal
 */
export const foldText = (text: string) =>
  NON_ASCII.test(text) ? foldPart(text) : text.toLowerCase();

/**
 * A query's words, folded, split on white space, empty and repeated ones dropped.
 * @internal
 */
export const getQueryWords = (query: string) => [
  ...new Set(foldText(query).split(/\s+/).filter(Boolean)),
];

/**
 * Whether every word is in the folded text, anywhere (the filters' default match: `ml li` finds
 * "Main light"). No words match everything.
 * @internal
 */
export const matchesWords = (folded: string, words: readonly string[]) => {
  for (let i = 0; i < words.length; i++) if (!folded.includes(words[i])) return false;
  return true;
};

/** The folded text and, for each of its characters, the index in `text` of the character it came
 * from (null: the same indices, ASCII) */
const foldWithOrigin = (text: string) => {
  if (!NON_ASCII.test(text)) return { folded: text.toLowerCase(), origin: null };
  let folded = '';
  const origin: number[] = [];
  for (let i = 0; i < text.length; ) {
    const size = (text.codePointAt(i) ?? 0) > 0xffff ? 2 : 1;
    const part = foldPart(text.slice(i, i + size));
    for (let k = 0; k < part.length; k++) origin.push(i);
    folded += part;
    i += size;
  }
  return { folded, origin };
};

/** The index in `text` where a match ending at folded index `end` ends: past the whole character
 * the match's last folded character came from, its dropped accents included */
const getOriginEnd = (origin: number[], end: number, textLength: number) => {
  const last = origin[end - 1];
  for (let k = end; k < origin.length; k++) if (origin[k] > last) return origin[k];
  return textLength;
};

/**
 * The parts of `text` the terms match, case and accents ignored: `[start, end)` pairs in the
 * text's own indices, in order, overlapping and touching ones merged (`mesh` and `meshes` mark
 * "Meshes" once).
 * @internal
 */
export const findMatchRanges = (text: string, terms: readonly string[]) => {
  const { folded, origin } = foldWithOrigin(text);
  const found: [number, number][] = [];
  for (const term of new Set(terms.map(foldText))) {
    if (!term) continue;
    for (let at = folded.indexOf(term); at !== -1; at = folded.indexOf(term, at + 1)) {
      found.push([at, at + term.length]);
    }
  }
  found.sort((a, b) => a[0] - b[0]);
  const ranges: [number, number][] = [];
  for (const [start, end] of found) {
    const last = ranges[ranges.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else ranges.push([start, end]);
  }
  if (!origin) return ranges;
  return ranges.map(([start, end]): [number, number] => [
    origin[start],
    getOriginEnd(origin, end, text.length),
  ]);
};

/**
 * Appends `text` to `parent` with the terms' matches in `<mark class="aekMark">`s (the accent's
 * soft background, semibold): text nodes and elements, never HTML. A screen reader reads the text
 * as it is.
 * @internal
 * @param parent where the text goes (a row's label, emptied by the caller)
 * @param text the text, shown whole
 * @param terms what's marked (a query's words, a search's matched terms); none marks nothing
 */
export const appendMarked = (parent: Node, text: string, terms: readonly string[]) => {
  let at = 0;
  for (const [start, end] of terms.length ? findMatchRanges(text, terms) : []) {
    if (start > at) parent.appendChild(document.createTextNode(text.slice(at, start)));
    const mark = document.createElement('mark');
    mark.className = MARK_CLASS;
    mark.textContent = text.slice(start, end);
    parent.appendChild(mark);
    at = end;
  }
  if (at < text.length) parent.appendChild(document.createTextNode(text.slice(at)));
};
