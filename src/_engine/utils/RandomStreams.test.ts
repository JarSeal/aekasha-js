import { afterEach, describe, expect, test } from 'vitest';
import { getRandomSeed, getRandomStream, resetRandomStreams, setRandomSeed } from './RandomStreams';
import { createSeededRandom } from './SeededRandom';

const draw = (stream: () => number, count: number) => Array.from({ length: count }, stream);

describe('createSeededRandom', () => {
  test('gives the same sequence as before its move into the engine', () => {
    // The toolkit's generators and the app's scenes depend on these exact numbers
    const random = createSeededRandom(7);
    expect(draw(random, 3).map((n) => n.toFixed(10))).toEqual([
      '0.0117047532',
      '0.0619582576',
      '0.9769076328',
    ]);
  });
});

describe('random streams', () => {
  const defaultSeed = getRandomSeed();
  afterEach(() => setRandomSeed(defaultSeed));

  test('a stream restarts on a reset', () => {
    const first = draw(getRandomStream('a'), 4);
    resetRandomStreams();
    expect(draw(getRandomStream('a'), 4)).toEqual(first);
  });

  test("a stream's sequence doesn't depend on another stream's draws", () => {
    const alone = draw(getRandomStream('a'), 4);
    resetRandomStreams();
    draw(getRandomStream('b'), 10);
    expect(draw(getRandomStream('a'), 4)).toEqual(alone);
  });

  test('streams with different names differ', () => {
    expect(draw(getRandomStream('a'), 4)).not.toEqual(draw(getRandomStream('b'), 4));
  });

  test('the world seed changes every stream, and restarts them', () => {
    const before = draw(getRandomStream('a'), 4);
    setRandomSeed(123);
    const seeded = draw(getRandomStream('a'), 4);
    expect(seeded).not.toEqual(before);
    setRandomSeed(123);
    expect(draw(getRandomStream('a'), 4)).toEqual(seeded);
    expect(getRandomSeed()).toBe(123);
  });
});
