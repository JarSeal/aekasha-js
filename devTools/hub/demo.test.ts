import { describe, expect, it } from 'vitest';
import { HubDiagnostics } from './diagnostics';
import { demoDirective, LIBRARY_PAGE_FILE, readLibraryDemoKeys } from './demo';
import { createHubMarkdown, createMarkdownEnv, type HubRenderContext } from './markdown';
import type { HubPage } from './types';

// p803 Phase 8: `::: demo <key>` renders the component library's box for a piece, on any page

const render = (markdown: string) => {
  const diag = new HubDiagnostics();
  const page = { file: 'guide.md', body: '' } as HubPage;
  const env = createMarkdownEnv(page, '../', diag, {
    mode: 'public',
    icons: { render: () => '' },
  } as unknown as HubRenderContext);
  const html = createHubMarkdown({ demo: demoDirective }).render(markdown, env);
  return { html, diag, env };
};

describe('::: demo', () => {
  it("reads the library page's boxes", () => {
    const keys = readLibraryDemoKeys();
    expect(keys).toContain('button');
    expect(keys).toContain('window');
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('renders a box of the library page, and watches that page', () => {
    const { html, diag, env } = render('::: demo button\n:::\n');
    expect(diag.errors).toEqual([]);
    expect(html).toContain('<div class="hubComponentDemo" data-hub-demo="button"></div>');
    expect(env.includes).toContain(LIBRARY_PAGE_FILE);
  });

  it('fails on a key the library page has no box for, and on content', () => {
    expect(render('::: demo nope\n:::\n').diag.errors[0]?.message).toContain(
      '::: demo needs one box key'
    );
    expect(render('::: demo button extra\n:::\n').diag.errors).toHaveLength(1);
    expect(render('::: demo button\nText\n:::\n').diag.errors[0]?.message).toContain(
      'takes no content'
    );
  });
});
