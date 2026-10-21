// No imports: the Hub's dev client (`hub/_assets/ts/_devClient.ts`) imports this, and
// `hub/tsconfig.json` checks it without Node's types.

/**
 * What the dev plugin (`devTools/hubPlugin.ts`) and the Hub's dev client share.
 * The plugin sends `HubDevEvent`s as the custom HMR event `aek:hub` after a rebuild that changed
 * something; the client listens on the dev server's HMR WebSocket for that event only.
 */

export const HUB_DEV_EVENT = 'aek:hub';

/** The `<meta name>` carrying the HMR WebSocket's path and token (`/?token=…`) */
export const HUB_DEV_META = 'aek-hub-dev';

/**
 * What a dev build writes in that meta's `content`: the plugin puts the path and token in when it
 * serves the page, so the token (new on every server start) is never on disk
 */
export const HUB_DEV_SOCKET_PLACEHOLDER = '%AEK_HUB_DEV_SOCKET%';

/**
 * The page path (`data-hub-page`) of the page served for an API page while the API docs rebuild:
 * it reloads on the `api` event, or when its own URL no longer answers with
 * `HUB_API_REBUILDING_STATUS` (the rebuild ended before its socket opened)
 */
export const HUB_API_REBUILDING_PAGE = 'api-rebuilding';
/** The rebuilding page's status: 503, so the dev client knows when its URL serves the page again */
export const HUB_API_REBUILDING_STATUS = 503;

/** The `aek:hub` event's data: what the open pages reload or swap */
export type HubDevEvent =
  /** Only the stylesheet changed: the client swaps it to `?v=<version>` without a reload */
  | { kind: 'css'; version: string }
  /** These pages' HTML changed (site paths, '' the homepage, '404'): open ones reload */
  | { kind: 'pages'; paths: string[] }
  /** The scripts or the static assets changed: every open page reloads */
  | { kind: 'all' }
  /** The API docs rebuilt, whether or not a page changed: rebuilding pages reload */
  | { kind: 'api' };
