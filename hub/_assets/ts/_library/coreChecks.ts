/**
 * The core pieces' checks (`core.ts`' demos): the button and button group, the link, the badge, the
 * tag, the spinner, the progress bar, the skeleton, the divider, the empty state, the loading
 * overlay, the key hint and the input glyph.
 */
import type { UiDemoChecks } from '../_componentChecks';

/** The first key hint of the Kbd box's macOS row (its second, `KBD_ROWS`) */
const KBD_MAC = '[data-hub-demo="kbd"] .hubComponentDemoGroup:nth-of-type(2) .aekKbd';
const GLYPH = '[data-hub-demo="inputGlyph"] .aekInputGlyph';
/** A button of the button box by its name (`core.ts`' `BUTTON_ID`), and its status line */
const BUTTON = (name: string) => `#hubDemoButton${name}`;
const BUTTON_STATUS = BUTTON('Status');
/** A button group box's button by its label, and its status line (`core.ts`' `GROUP_ID`) */
const GROUP_BUTTON = (label: string) => `#hubDemoGroupButton${label}`;
const GROUP_STATUS = '#hubDemoGroupStatus';
const LINK = (name: string) => `#hubDemoLink${name}`;
const BADGE_INBOX = '#hubDemoBadgeInbox';
const TAG = (name: string) => `#hubDemoTag${name}`;
const TAG_STATUS = '#hubDemoTagStatus';
const SPINNER = '#hubDemoSpinnerDefault';
const SPINNER_DECORATIVE = '[data-hub-demo="spinner"] .hubDemoLine .aekSpinner';
const PROGRESS = (name: string) => `#hubDemoProgress${name}`;
const PROGRESS_TRACK = (name: string) => `${PROGRESS(name)} .aekProgress__track`;
const SKELETON_CARD = '#hubDemoSkeletonCard';
const DIVIDER_BOX = '[data-hub-demo="divider"]';
const EMPTY_SAVES = '#hubDemoEmptySaves';
const OVERLAY_PANEL = '#hubDemoOverlayPanel .aekLoadingOverlay';
const OVERLAY_BOUNDS = '#hudRoot #hubDemoOverlayBounds';

/** The core group's checks by their demo's key (`data-hub-demo`) */
export const CORE_CHECKS: Record<string, UiDemoChecks> = {
  button: {
    keyboard: [
      {
        name: 'Enter and Space click a button; Tab goes on to the next',
        steps: [
          { focusInBox: BUTTON('Secondary') },
          { press: 'Enter' },
          { expectText: BUTTON_STATUS, text: 'Secondary clicked (1)' },
          { press: 'Space' },
          { expectText: BUTTON_STATUS, text: 'Secondary clicked (2)' },
          { press: 'Tab' },
          { expectFocus: BUTTON('Ghost') },
        ],
      },
      {
        name: 'a toggle: Space and Enter flip aria-pressed',
        steps: [
          { focusInBox: BUTTON('Mute') },
          { expectAttr: BUTTON('Mute'), name: 'aria-pressed', value: 'false' },
          { press: 'Space' },
          { expectAttr: BUTTON('Mute'), name: 'aria-pressed', value: 'true' },
          { expectText: BUTTON_STATUS, text: 'Mute: on' },
          { press: 'Enter' },
          { expectAttr: BUTTON('Mute'), name: 'aria-pressed', value: 'false' },
        ],
      },
      {
        name: 'a click loads: busy, with the focus kept, then done',
        steps: [
          { focusInBox: BUTTON('Save') },
          { expectAttr: BUTTON('Save'), name: 'aria-keyshortcuts', value: 'Control+S' },
          { press: 'Enter' },
          { expectAttr: BUTTON('Save'), name: 'aria-busy', value: 'true' },
          { expectText: BUTTON_STATUS, text: 'Saving…' },
          { expectFocus: BUTTON('Save') },
          { expectAttr: BUTTON('Save'), name: 'aria-busy', value: null },
          { expectText: BUTTON_STATUS, text: 'Saved' },
        ],
      },
      {
        name: 'hold to confirm: a short Enter does nothing, a held one acts',
        steps: [
          { focusInBox: BUTTON('Delete') },
          { press: 'Enter' },
          { expectAttr: BUTTON('Delete'), name: 'data-holding', value: null },
          { keyDown: 'Enter' },
          { expectAttr: BUTTON('Delete'), name: 'data-holding', value: 'filling' },
          { expectAttr: BUTTON('Delete'), name: 'data-holding', value: 'confirmed' },
          { expectText: BUTTON_STATUS, text: 'Deleted (held)' },
          { keyUp: 'Enter' },
          { expectAttr: BUTTON('Delete'), name: 'data-holding', value: null },
        ],
      },
    ],
  },
  buttonGroup: {
    keyboard: [
      {
        name: 'a group: each button is a tab stop',
        steps: [
          { focusInBox: GROUP_BUTTON('Cut') },
          { press: 'Tab' },
          { expectFocus: GROUP_BUTTON('Copy') },
          { press: 'ArrowRight' },
          { expectFocus: GROUP_BUTTON('Copy') },
        ],
      },
      {
        name: 'a toolbar: the arrows, Home and End move the focus, Space presses, Tab leaves and comes back',
        steps: [
          { focusInBox: GROUP_BUTTON('Lit') },
          { expectAttr: '#hubDemoGroupView', name: 'role', value: 'toolbar' },
          { press: 'ArrowRight' },
          { expectFocus: GROUP_BUTTON('Wireframe') },
          { expectAttr: GROUP_BUTTON('Lit'), name: 'aria-pressed', value: 'true' },
          { press: 'Space' },
          { expectAttr: GROUP_BUTTON('Wireframe'), name: 'aria-pressed', value: 'true' },
          { expectAttr: GROUP_BUTTON('Lit'), name: 'aria-pressed', value: 'false' },
          { expectText: GROUP_STATUS, text: 'View: Wireframe' },
          { press: 'End' },
          { expectFocus: GROUP_BUTTON('Normals') },
          { press: 'ArrowRight' },
          { expectFocus: GROUP_BUTTON('Lit') },
          { press: 'Tab' },
          { expectFocus: GROUP_BUTTON('Move') },
          // Back in at the last button focused there, as the APG toolbar
          { press: 'Shift+Tab' },
          { expectFocus: GROUP_BUTTON('Lit') },
        ],
      },
      {
        name: 'a vertical toolbar: Up and Down move, Left and Right don’t',
        steps: [
          { focusInBox: GROUP_BUTTON('Move') },
          { press: 'ArrowDown' },
          { expectFocus: GROUP_BUTTON('Rotate') },
          { press: 'ArrowRight' },
          { expectFocus: GROUP_BUTTON('Rotate') },
          { press: 'Enter' },
          { expectText: GROUP_STATUS, text: 'Tool: Rotate' },
        ],
      },
    ],
  },
  link: {
    keyboard: [
      {
        name: 'Enter follows a link (here an app’s handler takes it)',
        steps: [
          { focusInBox: LINK('Credits') },
          { press: 'Enter' },
          { expectText: '#hubDemoLinkStatus', text: 'Credits: followed by the app’s handler' },
        ],
      },
      {
        name: 'no keys; an external link opens in a new tab and says so',
        steps: [
          { expectAttr: LINK('Manual'), name: 'target', value: '_blank' },
          { expectAttr: LINK('Manual'), name: 'rel', value: 'noopener noreferrer' },
          { expectText: `${LINK('Manual')} .aekVisuallyHidden`, text: '(opens in a new tab)' },
        ],
      },
    ],
  },
  badge: {
    keyboard: [
      {
        name: 'no keys; a count says its spoken label, and a change updates both',
        steps: [
          { expectText: `${BADGE_INBOX} .aekBadge__label`, text: '3' },
          { expectAttr: `${BADGE_INBOX} .aekBadge__label`, name: 'aria-hidden', value: 'true' },
          { expectText: `${BADGE_INBOX} .aekVisuallyHidden`, text: '3 unread' },
          { click: 'Add a message' },
          { expectText: `${BADGE_INBOX} .aekBadge__label`, text: '4' },
          { expectText: `${BADGE_INBOX} .aekVisuallyHidden`, text: '4 unread' },
        ],
      },
    ],
  },
  tag: {
    keyboard: [
      {
        name: 'a filter chip: Space flips aria-pressed',
        steps: [
          { focusInBox: `${TAG('Trees')} button` },
          { expectAttr: `${TAG('Trees')} button`, name: 'aria-pressed', value: 'false' },
          { press: 'Space' },
          { expectAttr: `${TAG('Trees')} button`, name: 'aria-pressed', value: 'true' },
          { expectText: TAG_STATUS, text: 'Filters: Rocks, Trees' },
          { press: 'Enter' },
          { expectAttr: `${TAG('Trees')} button`, name: 'aria-pressed', value: 'false' },
        ],
      },
      {
        name: 'a removable tag: Delete and Backspace remove it, the focus to the next, else the previous',
        steps: [
          { focusInBox: `${TAG('Level2')} .aekTag__remove` },
          {
            expectAttr: `${TAG('Level2')} .aekTag__remove`,
            name: 'aria-label',
            value: 'Remove level2.scene',
          },
          { press: 'Delete' },
          { expectCount: TAG('Level2'), count: 0 },
          { expectFocus: `${TAG('Level3')} .aekTag__remove` },
          { expectText: TAG_STATUS, text: 'Removed: level2.scene' },
          { press: 'Backspace' },
          { expectCount: TAG('Level3'), count: 0 },
          { expectFocus: `${TAG('Level1')} .aekTag__remove` },
          { press: 'Enter' },
          { expectCount: TAG('Level1'), count: 0 },
        ],
      },
    ],
  },
  spinner: {
    keyboard: [
      {
        name: 'no keys; alone it’s a status with its label, in text it’s hidden',
        steps: [
          { expectAttr: SPINNER, name: 'role', value: 'status' },
          { expectText: `${SPINNER} .aekVisuallyHidden`, text: 'Loading' },
          { expectAttr: SPINNER_DECORATIVE, name: 'aria-hidden', value: 'true' },
          { expectAttr: SPINNER_DECORATIVE, name: 'role', value: null },
        ],
      },
    ],
  },
  progressBar: {
    // The indeterminate slide eases out fast (`--aek-ease-standard`): at a fifth of its time the
    // bar is mid-track (30-70 %), at the default 0.4 it's already past the right edge
    pauseAt: 0.2,
    keyboard: [
      {
        name: 'no keys; the track is a progressbar with its value, none while indeterminate',
        steps: [
          { expectAttr: PROGRESS_TRACK('Download'), name: 'role', value: 'progressbar' },
          { expectAttr: PROGRESS_TRACK('Download'), name: 'aria-valuenow', value: '40' },
          { expectText: `${PROGRESS('Download')} .aekProgress__value`, text: '40 %' },
          { click: 'Add 10 %' },
          { expectAttr: PROGRESS_TRACK('Download'), name: 'aria-valuenow', value: '50' },
          { expectText: `${PROGRESS('Download')} .aekProgress__value`, text: '50 %' },
          { expectAttr: PROGRESS_TRACK('Connecting'), name: 'aria-valuenow', value: null },
          { expectAttr: PROGRESS_TRACK('Health'), name: 'aria-valuemax', value: '5' },
          { expectAttr: PROGRESS_TRACK('Health'), name: 'aria-valuenow', value: '2.5' },
        ],
      },
    ],
  },
  skeleton: {
    keyboard: [
      {
        name: 'no keys; the skeletons are hidden, the card busy until its content is in',
        steps: [
          { expectAttr: `${SKELETON_CARD} .aekSkeleton`, name: 'aria-hidden', value: 'true' },
          { expectAttr: SKELETON_CARD, name: 'aria-busy', value: 'true' },
          { click: 'Load the content' },
          { expectCount: `${SKELETON_CARD} .aekSkeleton`, count: 0 },
          { expectAttr: SKELETON_CARD, name: 'aria-busy', value: null },
          { expectText: `${SKELETON_CARD} .hubDemoLine`, text: 'Best lap: 1:42.3, by Ada' },
        ],
      },
    ],
  },
  divider: {
    keyboard: [
      {
        name: 'no keys; an hr across, a vertical separator down the toolbar',
        steps: [
          { expectCount: `${DIVIDER_BOX} hr.aekDivider`, count: 1 },
          {
            expectAttr: `${DIVIDER_BOX} [data-orientation="vertical"]`,
            name: 'role',
            value: 'separator',
          },
          {
            expectAttr: `${DIVIDER_BOX} [data-orientation="vertical"]`,
            name: 'aria-orientation',
            value: 'vertical',
          },
        ],
      },
    ],
  },
  emptyState: {
    keyboard: [
      {
        name: 'its action is a button: Enter runs it',
        steps: [
          { expectText: `${EMPTY_SAVES} .aekEmptyState__title`, text: 'No saved games' },
          { focusInBox: `${EMPTY_SAVES} .aekEmptyState__action` },
          { press: 'Enter' },
          { expectText: '#hubDemoEmptyStatus', text: 'New game started' },
        ],
      },
    ],
  },
  loadingOverlay: {
    keyboard: [
      {
        name: 'no keys; its text is a status, its spinner hidden, a bar swapped in and a hide',
        steps: [
          { expectAttr: OVERLAY_PANEL, name: 'data-state', value: 'shown' },
          {
            expectAttr: `${OVERLAY_PANEL} .aekLoadingOverlay__text`,
            name: 'role',
            value: 'status',
          },
          { expectAttr: `${OVERLAY_PANEL} .aekSpinner`, name: 'aria-hidden', value: 'true' },
          { click: 'Show the progress' },
          { expectCount: `${OVERLAY_PANEL} .aekSpinner`, count: 0 },
          {
            expectAttr: `${OVERLAY_PANEL} [role="progressbar"]`,
            name: 'aria-valuenow',
            value: '60',
          },
          { click: 'Hide it' },
          { expectAttr: OVERLAY_PANEL, name: 'data-state', value: 'hidden' },
        ],
      },
      {
        name: 'over the HUD’s bounds: shown above the page, gone after the demo’s click',
        steps: [
          { click: 'Over the HUD’s bounds' },
          { expectAttr: OVERLAY_BOUNDS, name: 'data-state', value: 'shown' },
          { expectStyle: OVERLAY_BOUNDS, name: 'position', value: 'fixed' },
          { clickHud: '#hubDemoOverlayBounds' },
          { expectCount: OVERLAY_BOUNDS, count: 0 },
        ],
      },
    ],
  },
  kbd: {
    keyboard: [
      {
        name: 'no keys; assistive tech hears a macOS hint’s words, not its symbols',
        steps: [
          { expectText: `${KBD_MAC} .aekKbd__key`, text: '⌘' },
          { expectAttr: `${KBD_MAC} .aekKbd__keys`, name: 'aria-hidden', value: 'true' },
          { expectText: `${KBD_MAC} .aekVisuallyHidden`, text: 'Command+S' },
        ],
      },
    ],
  },
  inputGlyph: {
    keyboard: [
      {
        name: 'no keys; each glyph is an image named by its input',
        steps: [
          { expectAttr: GLYPH, name: 'role', value: 'img' },
          { expectAttr: GLYPH, name: 'aria-label', value: 'E' },
          {
            expectAttr: `${GLYPH}[data-device="mouse"]`,
            name: 'aria-label',
            value: 'Left mouse button',
          },
        ],
      },
    ],
  },
};
