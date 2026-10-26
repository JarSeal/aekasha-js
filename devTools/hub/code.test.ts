import { describe, expect, it } from 'vitest';
import { breakAtHyphens, hubCodePlugin, type HubCodeOptions } from './code';
import { HubDiagnostics } from './diagnostics';
import { createHubMarkdown, createMarkdownEnv, type HubRenderContext } from './markdown';
import type { HubPage } from './types';

const render = (markdown: string) => {
  const page = { file: 'guide.md', body: '' } as HubPage;
  const env = createMarkdownEnv(page, '../', new HubDiagnostics(), {
    mode: 'public',
    icons: { render: () => '' },
  } as unknown as HubRenderContext);
  // Plain inline code never reaches the highlighter
  const options = { highlighter: {}, icons: { render: () => '' } } as unknown as HubCodeOptions;
  return createHubMarkdown().use(hubCodePlugin, options).render(markdown, env);
};

describe('inline code in a table cell (p804 D13)', () => {
  it('may break after a hyphen between letters or digits, never after a leading --', () => {
    expect(breakAtHyphens('--aek-window-header-height')).toBe(
      '--aek-<wbr>window-<wbr>header-<wbr>height'
    );
    expect(breakAtHyphens('aria-keyshortcuts')).toBe('aria-<wbr>keyshortcuts');
    expect(breakAtHyphens('a - b, x--y, -1')).toBe('a - b, x--y, -1');
  });

  it('renders the breaks in a cell only, with the code escaped', () => {
    const html = render(
      '`--aek-a-b` outside\n\n| Name | Note |\n| --- | --- |\n| `--aek-a-b` | `<x-y>` |\n'
    );
    expect(html).toContain('<p><code>--aek-a-b</code> outside</p>');
    expect(html).toContain('<td><code>--aek-<wbr>a-<wbr>b</code></td>');
    expect(html).toContain('<td><code>&lt;x-<wbr>y&gt;</code></td>');
  });
});
