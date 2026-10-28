// Matching and marking text (p805 D6): what the list's and the tree's filters and the command
// palette share, and the palette's scorer (D12). Case and accents are ignored; the marks are built
// as text nodes and `<mark>`s (no HTML: rows are app data), and the matches are found in the
// text's own indices.
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
 * Appends `text` to `parent` with the given ranges in `<mark class="aekMark">`s: text nodes and
 * elements, never HTML.
 * @internal
 * @param ranges `[start, end)` pairs in the text's own indices, in order and apart
 * (`findMatchRanges`' or `scoreText`'s)
 */
export const appendRanges = (
  parent: Node,
  text: string,
  ranges: readonly (readonly [number, number])[]
) => {
  let at = 0;
  for (const [start, end] of ranges) {
    if (start > at) parent.appendChild(document.createTextNode(text.slice(at, start)));
    const mark = document.createElement('mark');
    mark.className = MARK_CLASS;
    mark.textContent = text.slice(start, end);
    parent.appendChild(mark);
    at = end;
  }
  if (at < text.length) parent.appendChild(document.createTextNode(text.slice(at)));
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
export const appendMarked = (parent: Node, text: string, terms: readonly string[]) =>
  appendRanges(parent, text, terms.length ? findMatchRanges(text, terms) : []);

// --- The palette's scorer (p805 D12) ---

/** A letter or a digit: what a word is made of */
const WORD_CHAR = /[\p{L}\p{N}]/u;
const UPPER = /\p{Lu}/u;
const LOWER = /\p{Ll}/u;

/**
 * A text folded once for `scoreText` (a command's label, folded when the commands are set, not on
 * every query): its folded form, where each folded character came from, and where its words start.
 * @internal
 */
export type ScoredText = {
  text: string;
  folded: string;
  /** Each folded character's index in `text` (null: the same indices, ASCII) */
  origin: number[] | null;
  /** 1 where a word starts in `folded`: after a character that isn't a letter or digit, or at a
   * capital after a small letter (`setValue`'s `V`) */
  starts: Uint8Array;
};

/**
 * Folds a text for `scoreText`.
 * @internal
 */
export const prepareScoredText = (text: string): ScoredText => {
  const { folded, origin } = foldWithOrigin(text);
  const starts = new Uint8Array(folded.length);
  for (let i = 0; i < folded.length; i++) {
    if (i === 0) {
      starts[i] = 1;
      continue;
    }
    const at = origin ? origin[i] : i;
    const before = origin ? origin[i - 1] : i - 1;
    // A character folded into several (`ß` → `ss` is one word)
    if (at === before) continue;
    if (!WORD_CHAR.test(folded[i - 1])) starts[i] = 1;
    else if (UPPER.test(text[at]) && LOWER.test(text[before])) starts[i] = 1;
  }
  return { text, folded, origin, starts };
};

/** A matched character's worth, its bonus at a word's start, and right after the last one matched */
const CHAR_SCORE = 1;
const START_BONUS = 3;
const RUN_BONUS = 5;
/** Taken off per character before the first match: an earlier match ranks first */
const POSITION_COST = 0.01;

/** The score of a word's letters at these folded indices */
const scorePositions = (text: ScoredText, at: readonly number[]) => {
  let score = -at[0] * POSITION_COST;
  for (let i = 0; i < at.length; i++) {
    score += CHAR_SCORE;
    if (text.starts[at[i]]) score += START_BONUS;
    if (i && at[i] === at[i - 1] + 1) score += RUN_BONUS;
  }
  return score;
};

/** The word's letters in order from `from`: each the next one, but a word's start ahead when the
 * next isn't right after the last match (`tgdr` takes the `d` of "drawer"), unless `isPlain` */
const findLetters = (text: ScoredText, word: string, isPlain: boolean) => {
  const { folded, starts } = text;
  const at: number[] = [];
  let from = 0;
  for (let i = 0; i < word.length; i++) {
    let next = folded.indexOf(word[i], from);
    if (next === -1) return null;
    if (!isPlain && !(i && next === at[i - 1] + 1) && !starts[next]) {
      for (let k = next + 1; k < folded.length; k++) {
        if (starts[k] && folded[k] === word[i]) {
          next = k;
          break;
        }
      }
    }
    at.push(next);
    from = next + 1;
  }
  return at;
};

/** A word's best match in the text: as a whole at a word's start, anywhere, or its letters in
 * order (word starts first, then the leftmost); null when its letters aren't all there in order */
const matchWord = (text: ScoredText, word: string) => {
  const candidates: number[][] = [];
  for (let i = text.folded.indexOf(word); i !== -1; i = text.folded.indexOf(word, i + 1)) {
    candidates.push(Array.from(word, (_letter, k) => i + k));
    // The first whole match at a word's start is the best a whole match can do
    if (text.starts[i]) break;
  }
  for (const isPlain of [false, true]) {
    const at = findLetters(text, word, isPlain);
    if (at) candidates.push(at);
  }
  let best: { at: number[]; score: number } | null = null;
  for (const at of candidates) {
    const score = scorePositions(text, at);
    if (!best || score > best.score) best = { at, score };
  }
  return best;
};

/**
 * Scores a text against a query's words (`getQueryWords`'), the command palette's ranking (p805
 * D12): every word must be in it whole or as its letters in order (`tgdr` finds "Toggle drawer");
 * a letter counts more at a word's start and right after the one before, so a whole word's start
 * ranks over the same letters scattered, and an earlier match over a later one.
 * @internal
 * @returns the score (higher is better) and the matched parts' ranges in the text's own indices
 * (`appendRanges`' marks), or null when a word doesn't match
 */
export const scoreText = (text: ScoredText, words: readonly string[]) => {
  let score = 0;
  const positions: number[] = [];
  for (const word of words) {
    const match = matchWord(text, word);
    if (!match) return null;
    score += match.score;
    positions.push(...match.at);
  }
  positions.sort((a, b) => a - b);
  const ranges: [number, number][] = [];
  const { origin } = text;
  for (const position of positions) {
    const start = origin ? origin[position] : position;
    const end = origin ? getOriginEnd(origin, position + 1, text.text.length) : position + 1;
    const last = ranges[ranges.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else ranges.push([start, end]);
  }
  return { score, ranges };
};
