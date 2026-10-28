// Virtual rows (p805 D8): a collection renders only the rows its scroll box shows, a spacer before
// and after standing in for the others. Opt-in: the app passes `createVirtualRows()`'s handle, and
// the collection reaches its code through `useVirtualRows`, so one without it carries none.

/** The row height before one is measured (the compact density's row and its padding) */
const DEFAULT_ROW_HEIGHT = 28;
/** The rows rendered past each edge of the box by default */
const DEFAULT_OVERSCAN = 4;
/** The rows the box is taken to show while it has no height (hidden, not laid out yet) */
const UNMEASURED_ROWS = 20;

/** What {@link createVirtualRows} makes virtual rows from. */
export type VirtualRowsProps = {
  /** Every row's height in px. Default: the first row's, measured once it shows. */
  rowHeight?: number;
  /** The rows rendered past each edge of the box, so a fast scroll shows no gap (default 4). */
  overscan?: number;
};

/** Virtual rows {@link createVirtualRows} made: give it to one list or tree as its `virtual`. */
export type VirtualRows = {
  /** Always 'virtualRows': what it is, for the collection that takes it */
  readonly kind: 'virtualRows';
};

/**
 * The rows a box shows: `[start, end)` over `count` rows of `rowHeight` px, scrolled `scrollTop`
 * px into a box `viewportHeight` px tall, with `overscan` rows past each edge.
 * @internal
 */
export const getVirtualWindow = (options: {
  count: number;
  rowHeight: number;
  scrollTop: number;
  viewportHeight: number;
  overscan: number;
}) => {
  const { count, rowHeight, scrollTop, viewportHeight, overscan } = options;
  if (count <= 0 || rowHeight <= 0) return { start: 0, end: 0 };
  const first = Math.floor(Math.max(0, scrollTop) / rowHeight);
  const last = Math.ceil((Math.max(0, scrollTop) + Math.max(0, viewportHeight)) / rowHeight);
  const start = Math.max(0, Math.min(count, first) - overscan);
  const end = Math.min(count, Math.max(last, first + 1) + overscan);
  return { start: Math.min(start, end), end };
};

/**
 * A collection's virtual rows on its scroll box: the spacers, the scroll and the box's height.
 * @internal
 */
export type VirtualRowsView = {
  /** The spacer before the rendered rows, and after them: the box's first and last children */
  top: HTMLElement;
  bottom: HTMLElement;
  /** The rows to render of `count` */
  getWindow: (count: number) => { start: number; end: number };
  /** Sizes the spacers for rows `[start, end)` of `count` rendered */
  layout: (count: number, start: number, end: number) => void;
  /** Every row's height (given, measured, or the default until it is) */
  getRowHeight: () => number;
  /** Measures a rendered row once, when no height was given: whether the height changed */
  measure: (row: HTMLElement) => boolean;
  /** Scrolls the box (never the page) so the row at `index` shows, the least it can */
  scrollToIndex: (index: number) => void;
  /** The rows the box shows: PageUp's and PageDown's step */
  getPageSize: () => number;
  /** Removes the listeners and the observer (the spacers go with the box) */
  dispose: () => void;
};

/**
 * How a collection's rows look to its virtual rows: its spacers' tag (its rows' tag: `li` in a
 * `<ul>`) and class, and the custom property the measured row height is written to.
 * @internal
 */
export type VirtualRowsParts = {
  spacerTag: string;
  spacerClass: string;
  rowHeightProperty: string;
};

/**
 * What a collection does with virtual rows: `attach` them to its scroll box.
 * @internal
 */
export type VirtualRowsImpl = {
  /** Starts them on the box, `onChange` called when the scroll or the box's height moves the
   * window (a measured row height too) */
  attach: (box: HTMLElement, parts: VirtualRowsParts, onChange: () => void) => VirtualRowsView;
};

/** Each handle's code, which `useVirtualRows` reads */
const impls = new WeakMap<VirtualRows, VirtualRowsImpl>();

/**
 * The code of the virtual rows an app passed (null for none): what a collection calls instead of
 * importing this module.
 * @internal
 */
export const useVirtualRows = (virtual: VirtualRows | undefined) =>
  (virtual && impls.get(virtual)) ?? null;

const createSpacer = ({ spacerTag, spacerClass }: VirtualRowsParts) => {
  const spacer = document.createElement(spacerTag);
  spacer.className = spacerClass;
  spacer.setAttribute('aria-hidden', 'true');
  if (spacerTag !== 'li') spacer.setAttribute('role', 'presentation');
  return spacer;
};

/**
 * Creates virtual rows (p805 D8) for one list or tree: only the rows its box shows are rendered
 * (and the focused one, so the focus never drops), a spacer before and after standing in for the
 * others. Past about 200 rows a list or a tree scrolls and filters faster with them.
 * - Every row is one height: `rowHeight`, or the first row's, measured once. The rows' box needs a
 *   height to scroll in (`--aek-list-max-height` / `--aek-tree-max-height`, by default 12 rows).
 * - The rows not rendered aren't in the page: the browser's find can't see them (the list's filter
 *   can), and assistive tech hears each row's place by its `aria-posinset` and `aria-setsize`
 *   (`aria-rowindex` and `aria-rowcount` in a grid).
 * @param props the rows' height and how many render past the box's edges
 * @example
 * ```ts
 * type Asset = { id: string; name: string };
 *
 * const assetList = createList<Asset>({
 *   label: 'Assets',
 *   items: () => getAllAssets(), // thousands
 *   title: (asset) => asset.name,
 *   selection: 'single',
 *   filter: { field: true },
 *   virtual: createVirtualRows({ rowHeight: 28 }),
 * });
 * ```
 */
export const createVirtualRows = (props: VirtualRowsProps = {}): VirtualRows => {
  const overscan = Math.max(0, props.overscan ?? DEFAULT_OVERSCAN);
  const handle: VirtualRows = { kind: 'virtualRows' };

  const attach = (
    box: HTMLElement,
    parts: VirtualRowsParts,
    onChange: () => void
  ): VirtualRowsView => {
    let measured = props.rowHeight ?? 0;
    let scrollTop = box.scrollTop || 0;
    let viewportHeight = box.clientHeight || 0;
    let last = { start: -1, end: -1 };
    let count = 0;
    const top = createSpacer(parts);
    const bottom = createSpacer(parts);

    const getRowHeight = () => measured || DEFAULT_ROW_HEIGHT;
    const writeRowHeight = () => {
      if (measured) box.style.setProperty(parts.rowHeightProperty, `${measured}px`);
    };
    writeRowHeight();

    const getWindow = (rowCount: number) => {
      count = rowCount;
      return getVirtualWindow({
        count: rowCount,
        rowHeight: getRowHeight(),
        scrollTop,
        viewportHeight: viewportHeight || getRowHeight() * UNMEASURED_ROWS,
        overscan,
      });
    };

    /** The scroll or the height moved: a change only when the window did */
    const update = () => {
      const next = getWindow(count);
      if (next.start === last.start && next.end === last.end) return;
      onChange();
    };

    const onScroll = () => {
      scrollTop = box.scrollTop;
      update();
    };
    box.addEventListener('scroll', onScroll, { passive: true });

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver((entries) => {
        const height = entries[entries.length - 1]?.contentRect.height ?? 0;
        if (height === viewportHeight) return;
        viewportHeight = height;
        update();
      });
      observer.observe(box);
    }

    return {
      top,
      bottom,
      getWindow,
      layout: (rowCount, start, end) => {
        count = rowCount;
        last = { start, end };
        const height = getRowHeight();
        top.style.height = `${start * height}px`;
        bottom.style.height = `${Math.max(0, rowCount - end) * height}px`;
      },
      getRowHeight,
      measure: (row) => {
        if (props.rowHeight || measured) return false;
        const height = row.offsetHeight;
        if (!height) return false;
        measured = height;
        writeRowHeight();
        return true;
      },
      scrollToIndex: (index) => {
        const height = getRowHeight();
        const rowTop = index * height;
        const view = viewportHeight || box.clientHeight;
        let next = scrollTop;
        if (rowTop < scrollTop) next = rowTop;
        else if (rowTop + height > scrollTop + view) next = rowTop + height - view;
        if (next === scrollTop) return;
        box.scrollTop = next;
        // Read back: the box clamps it; the scroll event comes later and finds it done
        scrollTop = box.scrollTop || next;
      },
      getPageSize: () =>
        Math.max(1, Math.floor((viewportHeight || box.clientHeight) / getRowHeight()) || 1),
      dispose: () => {
        box.removeEventListener('scroll', onScroll);
        observer?.disconnect();
        observer = null;
        box.style.removeProperty(parts.rowHeightProperty);
      },
    };
  };

  impls.set(handle, { attach });
  return handle;
};
