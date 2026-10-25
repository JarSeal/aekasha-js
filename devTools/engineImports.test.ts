import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { ENTRY_FILES } from './aliases';
import { ROOT } from './paths';

// p619 D8: how the devTools import the engine. They're tools, not app code, so they import it by
// path (the `aekasha*` aliases don't resolve in Vite's bundle of vite.config.ts, which loads the
// gatherer, the asset pipeline and the dev files), but only the modules below, and a type from any
// entry with `import type` (erased, so nothing loads). A module listed for its values is
// import-free but for zod: a feature entry would load three/webgpu and TSL into the config's
// process. Add a module here only with its reason.

const DEV_TOOLS_DIR = path.join(ROOT, 'devTools');
const SRC_DIR = path.join(ROOT, 'src');

type AllowedModule = {
  /** Only `import type` (the module loads browser code) */
  isTypeOnly?: true;
  /** The packages its value imports may load besides zod */
  packages?: string[];
  reason: string;
};

/** The engine modules the devTools may import, by path from the repo root */
const ALLOWED_MODULES: Record<string, AllowedModule> = {
  'src/_engine/schemas/index.ts': {
    reason: 'the asset JSON schemas and their helpers, for tools: `aekasha/schemas`',
  },
  'src/_engine/debug/DevFilesProtocol.ts': {
    reason: 'the dev file server’s protocol, which its client in the engine shares',
  },
  'src/_engine/features/lod/LodChainOptions.ts': {
    reason: 'the LOD chain options and a GLB’s chain description, which the asset pipeline writes',
  },
  'src/_engine/features/lod/LodSimplify.ts': {
    packages: ['three', 'meshoptimizer'],
    reason: 'a GLB’s prebuilt chain comes from the runtime’s own simplifier',
  },
  'src/_engine/features/lod/impostors/ImpostorFormat.ts': {
    reason: 'the export format and atlas slots the gather checks an impostor against',
  },
  'src/_engine/features/skybox/LegacySkyBox.ts': {
    reason: 'the legacy sky box shape the gather warns about (goes in engine 6.0.0)',
  },
  'src/_engine/features/skybox/Presets.ts': {
    reason: 'the sky box presets the gather merges into a definition',
  },
  'src/_engine/ui/styles/TokenSheet.ts': {
    reason: 'tokens.css read as data and its contrast pairs, which the Hub’s design document shows',
  },
  'src/_engine/utils/StableStringify.ts': {
    reason: 'the asset cache keys’ JSON, the engine’s own (material variants, impostor hashes)',
  },
  'src/_engine/debug/TestBridge.ts': {
    isTypeOnly: true,
    reason: 'the test bridge’s types, for the scene runner (deprecated on `aekasha/debug`)',
  },
};

const ENTRY_NAMES = new Set<string>(Object.keys(ENTRY_FILES));

type ImportRef = { specifier: string; isTypeOnly: boolean; line: number };

/**
 * A module's imports, re-exports and `import()`s. Only `import type` and `export type` are type
 * only: under `verbatimModuleSyntax`, `import { type X }` stays as `import {}` (and an export the
 * same), which loads the module.
 */
const listImports = (file: string, text = fs.readFileSync(file, 'utf8')): ImportRef[] => {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest);
  const refs: ImportRef[] = [];
  const add = (node: ts.Node, specifier: ts.Expression | undefined, isTypeOnly: boolean) => {
    if (!specifier || !ts.isStringLiteralLike(specifier)) return;
    const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
    refs.push({ specifier: specifier.text, isTypeOnly, line: line + 1 });
  };
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node)) {
      add(node, node.moduleSpecifier, !!node.importClause?.isTypeOnly);
    } else if (ts.isExportDeclaration(node)) {
      add(node, node.moduleSpecifier, node.isTypeOnly);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      add(node, node.arguments[0], false);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      add(node, node.argument.literal, true);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return refs;
};

/** A relative specifier's file, or null when it doesn't resolve to one */
const resolveRelative = (from: string, specifier: string) => {
  const base = path.resolve(path.dirname(from), specifier);
  return (
    [base, `${base}.ts`, path.join(base, 'index.ts')].find(
      (candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()
    ) ?? null
  );
};

const toRepoPath = (file: string) => path.relative(ROOT, file).split(path.sep).join('/');

const listDevToolsFiles = () =>
  (fs.readdirSync(DEV_TOOLS_DIR, { recursive: true }) as string[])
    .filter((file) => file.endsWith('.ts') && !file.split(path.sep).includes('node_modules'))
    .map((file) => path.join(DEV_TOOLS_DIR, file));

/** Every devTools import that reaches into `src/` or names an entry, with its target */
const listEngineImports = () =>
  listDevToolsFiles().flatMap((file) =>
    listImports(file).flatMap((ref) => {
      const at = `${toRepoPath(file)}:${ref.line}`;
      if (ENTRY_NAMES.has(ref.specifier)) return [{ ...ref, at, target: ref.specifier }];
      if (!ref.specifier.startsWith('.')) return [];
      const target = resolveRelative(file, ref.specifier);
      if (!target?.startsWith(SRC_DIR + path.sep)) return [];
      return [{ ...ref, at, target: toRepoPath(target) }];
    })
  );

/** The packages a module loads through its value imports, transitively, by the module */
const listLoadedPackages = (file: string, seen = new Set<string>()): Map<string, string> => {
  const packages = new Map<string, string>();
  if (seen.has(file)) return packages;
  seen.add(file);
  for (const ref of listImports(file)) {
    if (ref.isTypeOnly) continue;
    if (!ref.specifier.startsWith('.')) {
      const parts = ref.specifier.split('/');
      const name = ref.specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
      packages.set(name, toRepoPath(file));
      continue;
    }
    const target = resolveRelative(file, ref.specifier);
    if (!target) continue;
    for (const [name, by] of listLoadedPackages(target, seen)) packages.set(name, by);
  }
  return packages;
};

describe('the devTools’ imports from the engine (p619 D8)', () => {
  const imports = listEngineImports();

  it('finds the imports it checks', () => {
    expect(imports.some((ref) => ref.target === 'src/_engine/schemas/index.ts')).toBe(true);
  });

  it('import only the listed modules, or a type from an entry', () => {
    const refused = imports.flatMap(({ at, target, isTypeOnly }) => {
      if (ENTRY_NAMES.has(target)) {
        return isTypeOnly ? [] : [`${at}: ${target} only with \`import type\``];
      }
      const allowed = ALLOWED_MODULES[target];
      if (!allowed) return [`${at}: ${target} isn't on the list (the schemas entry, or a type)`];
      if (allowed.isTypeOnly && !isTypeOnly) return [`${at}: ${target} only with \`import type\``];
      return [];
    });
    expect(refused).toEqual([]);
  });

  it('every listed module is imported, so the list stays current', () => {
    const targets = new Set(imports.map((ref) => ref.target));
    expect(Object.keys(ALLOWED_MODULES).filter((file) => !targets.has(file))).toEqual([]);
  });

  it('a module listed for its values loads no package but zod and its own', () => {
    const loads = Object.entries(ALLOWED_MODULES)
      .filter(([, allowed]) => !allowed.isTypeOnly)
      .flatMap(([file, allowed]) => {
        const packages = listLoadedPackages(path.join(ROOT, file));
        const permitted = new Set(['zod', ...(allowed.packages ?? [])]);
        return [...packages]
          .filter(([name]) => !permitted.has(name))
          .map(([name, by]) => `${file} loads ${name} (in ${by})`);
      });
    expect(loads).toEqual([]);
  });

  it('reads `import { type X }` as a value import, as verbatimModuleSyntax emits it', () => {
    const text =
      "import { type A } from 'aekasha';\nimport type { B } from 'aekasha';\n" +
      "export type { C } from 'aekasha/lod';\nexport { type D } from 'aekasha/lod';\n";
    expect(listImports('fixture.ts', text).map((ref) => ref.isTypeOnly)).toEqual([
      false,
      true,
      true,
      false,
    ]);
  });
});
