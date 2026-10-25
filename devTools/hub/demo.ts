import fs from 'node:fs';
import path from 'node:path';
import { escapeHtml } from './html';
import type { HubDirective } from './markdown';
import { HUB_PAGES_DIR } from './paths';

/**
 * `::: demo <key>` … `:::` (p803 Phase 8): a UI kit piece's live demo in a page, the component
 * library's box for that piece (`[data-hub-demo="<key>"]`), which `hub.ts`' `_components.ts`
 * chunk fills on any page that has one. The key must be a box of the public library page, so
 * every demo a page shows is one `yarn verify:ui` checks there. The directive takes no content.
 */

/** The public component library page, whose boxes are the keys a demo may name */
export const LIBRARY_PAGE_FILE = path.join(HUB_PAGES_DIR, 'features/ui-kit/library/index.html');

const BOX_KEY_REGEX = /data-hub-demo="([^"]+)"/g;

/** The library page's box keys, in its order (empty when the page isn't there) */
export const readLibraryDemoKeys = () => {
  if (!fs.existsSync(LIBRARY_PAGE_FILE)) return [];
  const html = fs.readFileSync(LIBRARY_PAGE_FILE, 'utf-8');
  return [...html.matchAll(BOX_KEY_REGEX)].map((match) => match[1]);
};

export const demoDirective: HubDirective = {
  open: (args, { env, line, tokens, idx }) => {
    const [key = '', ...rest] = args.trim().split(/\s+/);
    env.includes.push(LIBRARY_PAGE_FILE);
    const keys = readLibraryDemoKeys();
    if (!keys.includes(key) || rest.length) {
      env.diag.error(
        env.file,
        line,
        `::: demo needs one box key of the component library page (features/ui-kit/library/), not "${args.trim()}" (it has ${keys.join(', ') || 'none'})`
      );
      return '';
    }
    if (tokens[idx + 1]?.type !== 'hub_directive_close') {
      env.diag.error(env.file, line, `::: demo ${key} takes no content`);
    }
    return `<div class="hubComponentDemo" data-hub-demo="${escapeHtml(key)}"></div>\n`;
  },
  close: () => '',
};
