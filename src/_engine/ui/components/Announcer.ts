// The kit's announcer (p805 D2, D4): one polite live region per kit root, which a collection's
// sort, a filter's count, a move and a lazy load's end are read through. Not the toaster's
// regions: an app needn't make a toaster, and one of its two is assertive (p805 Phase 0).
import { KIT_ROOT_CLASS } from '../core/HUD';
import { KEEP_LIVE_ATTR } from '../overlays/OverlayStack';
import '../styles/kit.scss';

/** The region is emptied first and filled this much later, so the same text is read again (the
 * toaster's delay) */
const ANNOUNCE_DELAY_MS = 50;

type Region = { elem: HTMLElement; timer: ReturnType<typeof setTimeout> | null };

/** Each kit root's region, made on its first announcement */
const regions = new WeakMap<Element, Region>();

/** Where `elem`'s announcements go: its kit root (the HUD root, an app's container), else the
 * page's body (the Hub's `<html>` is a kit root, whose child a region mustn't be) */
const getRegionParent = (elem: Element) => {
  const root = elem.closest(`.${KIT_ROOT_CLASS}`);
  return root && root !== document.documentElement ? root : document.body;
};

const getRegion = (parent: Element) => {
  let region = regions.get(parent);
  if (region?.elem.parentElement === parent) return region;
  const elem = document.createElement('div');
  elem.className = 'aekVisuallyHidden';
  elem.setAttribute('role', 'status');
  elem.setAttribute('aria-live', 'polite');
  // A modal's inert leaves it live: what a piece in the dialog announces is still read
  elem.setAttribute(KEEP_LIVE_ATTR, '');
  parent.append(elem);
  region = { elem, timer: null };
  regions.set(parent, region);
  return region;
};

/**
 * Reads `text` to a screen reader, politely, through the live region of `elem`'s kit root (made
 * there on the first announcement, visually hidden, and kept). The region is emptied at once and
 * filled 50 ms later, so a repeated text is read again; an announcement before that replaces the
 * pending one. Never assertive: a sort, a filter's count or a move waits for the reader.
 * @internal
 * @param elem the announcing piece's element (its kit root takes the region)
 * @param text what's read; empty does nothing
 */
export const announce = (elem: Element, text: string) => {
  if (!text) return;
  const region = getRegion(getRegionParent(elem));
  region.elem.textContent = '';
  if (region.timer) clearTimeout(region.timer);
  region.timer = setTimeout(() => {
    region.timer = null;
    region.elem.textContent = text;
  }, ANNOUNCE_DELAY_MS);
};
