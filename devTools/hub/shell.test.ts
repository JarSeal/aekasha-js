import { describe, expect, it } from 'vitest';
import { HubDiagnostics } from './diagnostics';
import { fillShell, type HubMarkupHelpers, type ShellValues } from './shell';

const VALUES = { root: '../', title: 'A page', body: '<p>Body</p>' } as ShellValues;

const HELPERS: HubMarkupHelpers = {
  icon: (arg) => `<svg data-icon="${arg}"></svg>`,
  asset: (arg, root) => `${root}_assets/${arg}`,
  link: (arg, root) => `${root}${arg}/`,
  sbp: () => '1 kB',
};

const fill = (shell: string) => {
  const diag = new HubDiagnostics();
  return { html: fillShell(shell, 'hub/_layout/shell.html', VALUES, HELPERS, diag), diag };
};

describe('fillShell', () => {
  it('fills values and helpers', () => {
    const { html, diag } = fill('<title>{{title}}</title>{{icon:search}}<a href="{{link:x}}">');
    expect(html).toBe('<title>A page</title><svg data-icon="search"></svg><a href="../x/">');
    expect(diag.errors).toEqual([]);
  });

  it('reports an unknown placeholder', () => {
    const { html, diag } = fill('{{nope}}');
    expect(html).toBe('');
    expect(diag.errors.map((error) => error.message)).toEqual(['Unknown placeholder {{nope}}']);
  });

  // p619 Phase 0 (§1.4 H2): `key in values` / `key in helpers` read Object.prototype
  it.fails.each(['{{constructor}}', '{{toString}}', '{{toString:x}}', '{{hasOwnProperty:x}}'])(
    'reports %s as unknown',
    (shell) => {
      const { html, diag } = fill(shell);
      expect(html).toBe('');
      expect(diag.errors.map((error) => error.message)).toEqual([`Unknown placeholder ${shell}`]);
    }
  );
});
