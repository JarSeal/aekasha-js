import { describe, expect, it } from 'vitest';
import { findReachableFiles } from './embedBuild';

describe('findReachableFiles', () => {
  const files: Record<string, string> = {
    'x.embed.js': 'import{a}from"./assets/main-AAAAAAAA.js"',
    'assets/main-AAAAAAAA.js': 'new URL("AssetsWorker-BBBBBBBB.js",import.meta.url)',
    'assets/AssetsWorker-BBBBBBBB.js': 'import("./GLTFLoader-CCCCCCCC.js")',
    'assets/GLTFLoader-CCCCCCCC.js': 'new URL("draco-DDDDDDDD.wasm",import.meta.url)',
    'assets/draco-DDDDDDDD.wasm': 'not read: PhysicsWorker-EEEEEEEE.js',
    // Emitted for a tree-shaken importer: no kept file names them
    'assets/PhysicsWorker-EEEEEEEE.js': 'import("./rapier-FFFFFFFF.js")',
    'assets/rapier-FFFFFFFF.js': '',
    'assets/x-GGGGGGGG.css': 'url(./font-HHHHHHHH.woff2)',
    'assets/font-HHHHHHHH.woff2': '',
  };
  const read = (file: string) => files[file];

  it('follows the names in the text files from the roots, never into a binary', () => {
    const reached = findReachableFiles(
      ['x.embed.js', 'assets/x-GGGGGGGG.css'],
      Object.keys(files),
      read
    );
    expect([...reached].sort()).toEqual([
      'assets/AssetsWorker-BBBBBBBB.js',
      'assets/GLTFLoader-CCCCCCCC.js',
      'assets/draco-DDDDDDDD.wasm',
      'assets/font-HHHHHHHH.woff2',
      'assets/main-AAAAAAAA.js',
      'assets/x-GGGGGGGG.css',
      'x.embed.js',
    ]);
  });
});
