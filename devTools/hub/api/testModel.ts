import type { JSONOutput } from 'typedoc';
import { Kind } from './model';

/**
 * The API tests' model builder (`entries.test.ts`, `publicApi.test.ts`): modules under
 * `src/_engine/`, each export a reflection with its source line, as TypeDoc's JSON has them.
 */

/** A small model: modules under `src/_engine/`, each export a reflection with its source line */
export const createModel = () => {
  let nextId = 1;
  const modules: Record<string, unknown>[] = [];
  const source = (fileName: string, line: number) => [{ fileName, line, character: 0, url: '' }];
  const ref = (target: number | object, name: string, extra = {}) => ({
    type: 'reference',
    target,
    name,
    package: 'pkg',
    ...extra,
  });
  const decl = (file: string, line: number, name: string, kind: number, extra = {}) => ({
    id: nextId++,
    name,
    variant: 'declaration',
    kind,
    flags: {},
    sources: source(file, line),
    ...extra,
  });
  const module = (sourcePath: string, children: { id: number }[]) => {
    modules.push({
      ...decl(sourcePath, 1, sourcePath.replace(/^src\/|\.ts$/g, ''), Kind.Module),
      children,
    });
  };
  const project = () =>
    ({
      id: 0,
      name: 'pkg',
      variant: 'project',
      kind: 1,
      flags: {},
      packageName: 'pkg',
      children: modules,
    }) as unknown as JSONOutput.ProjectReflection;
  return { decl, ref, module, project };
};
