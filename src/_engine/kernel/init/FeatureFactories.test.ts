import { expect, test } from 'vitest';
import { ENGINE_FEATURE_FACTORIES, type EngineFeature } from './Features';

// ENGINE_FEATURE_FACTORIES is a hand list (the scene check's error names the factory to list):
// it must name every engine feature's factory, by the id the factory gives, as its entry exports
// it. Each features/<name>/ folder is an entry, `aekasha/<name>`, whose <Name>Feature.ts exports
// the factory as its only function (the rest are objects), so calling them runs nothing.
const factoryModules = import.meta.glob<Record<string, unknown>>('../../features/*/*Feature.ts');
const entryModules = import.meta.glob<Record<string, unknown>>('../../features/*/index.ts');

const folderOf = (path: string) => path.split('/')[3];

test('ENGINE_FEATURE_FACTORIES names every feature entry factory by its id', async () => {
  const found: Record<string, string> = {};
  const problems: string[] = [];
  for (const [path, load] of Object.entries(factoryModules)) {
    const folder = folderOf(path);
    const entryLoad = entryModules[`../../features/${folder}/index.ts`];
    if (!entryLoad) {
      problems.push(`${path}: features/${folder}/ has no entry (index.ts)`);
      continue;
    }
    const [module, entry] = await Promise.all([load(), entryLoad()]);
    const factories = Object.entries(module).filter(([, value]) => typeof value === 'function');
    if (factories.length !== 1) {
      problems.push(`${path}: exports ${factories.length} functions, not its factory alone`);
      continue;
    }
    const [name, factory] = factories[0];
    const { id, install } = (factory as () => EngineFeature)();
    if (typeof id !== 'string' || typeof install !== 'function') {
      problems.push(`${path}: ${name}() doesn't return an EngineFeature`);
    } else if (entry[name] !== factory) {
      problems.push(`${path}: aekasha/${folder} doesn't export ${name}`);
    } else {
      found[id] = `${name}() from 'aekasha/${folder}'`;
    }
  }
  expect(problems).toEqual([]);
  expect(Object.keys(found).length).toBe(Object.keys(entryModules).length);
  expect(ENGINE_FEATURE_FACTORIES).toEqual(found);
});
