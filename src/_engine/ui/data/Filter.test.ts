import { beforeAll, describe, expect, it } from 'vitest';
import { stubKitDomAsync } from '../testing/KitDom';
import {
  appendMarked,
  appendRanges,
  findMatchRanges,
  foldText,
  getQueryWords,
  matchesWords,
  prepareScoredText,
  scoreText,
} from './Filter';

/** A parent's children as `text` and `[mark]` pieces */
const readPieces = (parent: Node) =>
  [...parent.childNodes].map((node) =>
    node.nodeType === 1 ? `[${node.textContent}]` : node.textContent
  );

beforeAll(async () => {
  await stubKitDomAsync();
});

describe('folding and matching (p805 D6)', () => {
  it('ignores case and accents, the final sigma too', () => {
    expect(foldText('Main Light')).toBe('main light');
    expect(foldText('Café Crème')).toBe('cafe creme');
    expect(foldText('ΟΔΟΣ')).toBe('οδοσ');
    expect(foldText('İstanbul')).toBe('istanbul');
  });

  it('splits a query into its folded words, without empty or repeated ones', () => {
    expect(getQueryWords('  Main  LIGHT main ')).toEqual(['main', 'light']);
    expect(getQueryWords('   ')).toEqual([]);
  });

  it('matches when every word is somewhere in the text; no words match everything', () => {
    const folded = foldText('Directional light (Sun)');
    expect(matchesWords(folded, getQueryWords('sun dir'))).toBe(true);
    expect(matchesWords(folded, getQueryWords('sun moon'))).toBe(false);
    expect(matchesWords(folded, [])).toBe(true);
  });
});

describe('finding and marking matches (p805 D6)', () => {
  it('finds every match in the text’s own indices, overlapping and touching ones merged', () => {
    expect(findMatchRanges('Meshes and mesh', ['mesh', 'meshes'])).toEqual([
      [0, 6],
      [11, 15],
    ]);
    expect(findMatchRanges('abcd', ['ab', 'cd'])).toEqual([[0, 4]]);
    expect(findMatchRanges('aaa', ['aa'])).toEqual([[0, 3]]);
    expect(findMatchRanges('Lamp', ['', 'x'])).toEqual([]);
  });

  it('maps a folded match back past its accents, composed or decomposed', () => {
    expect(findMatchRanges('Crème brûlée', ['creme', 'brulee'])).toEqual([
      [0, 5],
      [6, 12],
    ]);
    // "e" and a combining grave accent: the mark takes the accent with its letter
    const decomposed = 'crème';
    expect(findMatchRanges(decomposed, ['cre'])).toEqual([[0, 4]]);
    expect(findMatchRanges('🙂 Café', ['cafe'])).toEqual([[3, 7]]);
  });

  it('appends text nodes and marks, never HTML', () => {
    const parent = document.createElement('span');
    appendMarked(parent, 'Main <b>light</b>', ['light']);
    expect(readPieces(parent)).toEqual(['Main <b>', '[light]', '</b>']);
    const mark = parent.querySelector('mark');
    expect(mark?.className).toBe('aekMark');
    expect(parent.querySelector('b')).toBeNull();
  });

  it('appends the text alone when nothing matches or there are no terms', () => {
    const parent = document.createElement('span');
    appendMarked(parent, 'Lamp', []);
    appendMarked(parent, ' post', ['x']);
    expect(readPieces(parent)).toEqual(['Lamp', ' post']);
    const empty = document.createElement('span');
    appendMarked(empty, '', ['a']);
    expect(empty.childNodes).toHaveLength(0);
  });
});

describe('the palette’s scorer (p805 D12)', () => {
  const score = (text: string, query: string) =>
    scoreText(prepareScoredText(text), getQueryWords(query));
  const marked = (text: string, query: string) => {
    const parent = document.createElement('span');
    appendRanges(parent, text, score(text, query)?.ranges ?? []);
    return readPieces(parent);
  };

  it('finds a word whole or as its letters in order; every word must be there', () => {
    expect(score('Toggle drawer', 'draw')).not.toBeNull();
    expect(score('Toggle drawer', 'tgdr')).not.toBeNull();
    expect(score('Toggle drawer', 'tg dr')).not.toBeNull();
    expect(score('Toggle drawer', 'rd')).toBeNull();
    expect(score('Toggle drawer', 'draw grid')).toBeNull();
  });

  it('marks the letters it took, a word’s starts before the scattered ones', () => {
    expect(marked('Toggle drawer', 'tgdr')).toEqual(['[T]', 'o', '[g]', 'gle ', '[dr]', 'awer']);
    expect(marked('Reset the camera', 'cam')).toEqual(['Reset the ', '[cam]', 'era']);
    expect(marked('Reset the camera', 'the cam')).toEqual(['Reset ', '[the]', ' ', '[cam]', 'era']);
  });

  it('ranks a word’s start over the middle, a run over scattered letters, earlier over later', () => {
    const at = (text: string, query: string) => score(text, query)?.score ?? -Infinity;
    expect(at('Camera', 'cam')).toBeGreaterThan(at('Clear all marks', 'cam'));
    expect(at('Draw calls', 'dra')).toBeGreaterThan(at('Redraw', 'dra'));
    expect(at('Grid', 'g')).toBeGreaterThan(at('Toggle', 'g'));
    expect(at('Show grid', 'grid')).toBeGreaterThan(at('Show the grid', 'grid'));
  });

  it('counts a capital after a small letter as a word’s start', () => {
    expect(marked('setValue', 'sv')).toEqual(['[s]', 'et', '[V]', 'alue']);
  });

  it('ignores accents and maps the marks back past them', () => {
    expect(marked('Café crème', 'creme')).toEqual(['Café ', '[crème]']);
    expect(marked('Café crème', 'cc')).toEqual(['[C]', 'afé ', '[c]', 'rème']);
  });
});
