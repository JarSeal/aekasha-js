// Each tab's container for a debugger tab menu on `createTabs` (p806 D6): the drawer shell's rail
// and the profiler window's menu. A tab's panel holds its container, the tab's scroller, made the
// first time the tab is selected and kept while the tab is (`keepMounted`); the owner's tab host
// mounts the tab into the selected one and empties the others after the mount, so a tab's `onOpen`
// cleanup still runs before its DOM goes.
import { CMP } from '../ui/core/CMP';
import type { CMPHandle } from '../ui/core/CMPTypes';

export type TabContainers = {
  /** The tab's `content` function: the same function for a kept tab, so `setTabs` keeps its
   * panel's content */
  getContentFn: (id: string) => () => CMPHandle;
  /** The tab's container, once its panel was shown */
  get: (id: string | null) => CMPHandle | null;
  /** Forgets the tabs that aren't in `ids` (their panels went with `setTabs`) */
  retain: (ids: Set<string>) => void;
  /** Empties every container but the selected tab's */
  clearOthers: (selectedId: string | null) => void;
};

/**
 * Creates the containers of a tab menu's tabs.
 * @param opts the containers' classes, and a container's scroll (its tab's id and position)
 */
export const createTabContainers = (opts: {
  class: string | string[];
  onScroll?: (id: string, scrollTop: number) => void;
}): TabContainers => {
  const containers = new Map<string, CMPHandle>();
  const contentFns = new Map<string, () => CMPHandle>();

  return {
    getContentFn: (id) => {
      let fn = contentFns.get(id);
      if (fn) return fn;
      fn = () => {
        const container = CMP({ class: opts.class });
        if (opts.onScroll) {
          const onScroll = opts.onScroll;
          container.elem.addEventListener('scroll', () => onScroll(id, container.elem.scrollTop), {
            passive: true,
          });
        }
        containers.set(id, container);
        return container;
      };
      contentFns.set(id, fn);
      return fn;
    },
    get: (id) => (id === null ? null : containers.get(id) ?? null),
    retain: (ids) => {
      for (const id of [...contentFns.keys()]) {
        if (ids.has(id)) continue;
        contentFns.delete(id);
        containers.delete(id);
      }
    },
    clearOthers: (selectedId) => {
      for (const [id, container] of containers) {
        if (id !== selectedId) container.removeChildren();
      }
    },
  };
};
