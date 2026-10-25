import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { HubDiagnostics } from './diagnostics';
import { createHubMarkdown, createMarkdownEnv, type HubRenderContext } from './markdown';
import type { HubPage } from './types';
import { SRC_DIR } from '../paths';
import {
  COMPONENT_USES,
  createComponentsSection,
  findComponentUsers,
  getUserGroup,
} from './generated/components';

// p802 D9: the component library's "Used by" lists are read from src/, never written by hand

const renderSlots = () => {
  const diag = new HubDiagnostics();
  const section = createComponentsSection();
  const page = { file: 'index.html', body: '' } as HubPage;
  const env = createMarkdownEnv(page, '../../../', diag, {
    mode: 'dev',
    icons: { render: () => '' },
  } as unknown as HubRenderContext);
  const md = createHubMarkdown();
  const html = Object.fromEntries(
    Object.entries(section.slots).map(([id, slot]) => [id, slot(md, env)])
  );
  return { section, html, diag };
};

describe('the component library (p802 D9)', () => {
  const { section, html, diag } = renderSlots();
  const users = findComponentUsers();

  it('renders a list for every piece without a diagnostic', () => {
    expect([...diag.errors, ...diag.warnings]).toEqual([]);
    expect(Object.keys(html).sort()).toEqual(COMPONENT_USES.map(({ slot }) => slot).sort());
  });

  it("finds the kit's users outside the kit, never its own files, tests or generated code", () => {
    expect(users.get('generated-components-dialog')).toContain('src/_engine/debug/_dbg__About.ts');
    expect(users.get('generated-components-drop-down')).toContain(
      'src/app/examples/uiKit/exampleUiKit.ts'
    );
    const all = [...users.values()].flat();
    expect(
      all.filter((file) => /^src\/_engine\/ui\/|\.test\.ts$|^src\/generated\//.test(file))
    ).toEqual([]);
  });

  it('groups a user by where it is', () => {
    expect(getUserGroup('src/_engine/debug/_dbg__About.ts')).toBe('Debug tools');
    expect(getUserGroup('src/_engine/features/lod/debug/_dbg__LodEntityWindow.ts')).toBe(
      'Debug tools'
    );
    expect(getUserGroup('src/_engine/kernel/init/Boot.ts')).toBe('Engine');
    expect(getUserGroup('src/toolkit/ecs/effects/FollowTool.ts')).toBe('Toolkit');
    expect(getUserGroup('src/app/scenes/physicsTest/physicsTest.ts')).toBe('App');
    expect(getUserGroup('src/index.ts')).toBe('App');
  });

  it('matches a call, not a longer name', () => {
    const found = findComponentUsers((file) =>
      file.endsWith(path.join('app', 'examples', 'uiKit', 'exampleUiKit.ts'))
        ? 'registerBuiltInIcons(); openDialogLater();'
        : ''
    );
    expect(found.get('generated-components-icons')).toEqual([]);
    expect(found.get('generated-components-dialog')).toEqual([]);
  });

  it('links each user and watches it', () => {
    const toaster = html['generated-components-toaster'];
    expect(toaster).toContain('<strong>Engine:</strong>');
    expect(toaster).toContain('>Boot.ts</code>');
    for (const file of users.get('generated-components-toaster') ?? []) {
      expect(section.files).toContain(path.join(SRC_DIR, '..', file));
    }
  });
});
