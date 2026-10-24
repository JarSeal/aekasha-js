/** The element whose box bounds the HUD (a mounted engine's container), or null: the window */
let boundsElem: HTMLElement | null = null;

/**
 * Sets the element whose box bounds the HUD's fixed elements: `mountAekasha`'s container (its
 * `contain: layout` makes it their containing block), or null for the browser window.
 * @internal
 */
export const setWindowBoundsElement = (elem: HTMLElement | null) => {
  boundsElem = elem;
};

/**
 * The box the HUD's fixed elements are laid out in, the draggable windows' and the debug drawer's
 * bounds: the browser window's inner size, or a mounted engine's container (its padding box). Its
 * `left` and `top` are that box's position in the viewport, so a viewport position (a
 * `getBoundingClientRect()`) minus them is a fixed element's CSS `left` / `top`; 0 for the window.
 * @internal
 */
export const getWindowSize = () => {
  if (boundsElem) {
    const rect = boundsElem.getBoundingClientRect();
    const width = boundsElem.clientWidth;
    const height = boundsElem.clientHeight;
    return {
      left: rect.left + boundsElem.clientLeft,
      top: rect.top + boundsElem.clientTop,
      width,
      height,
      aspect: width / height,
    };
  }
  const width = window.innerWidth;
  const height = window.innerHeight;

  return {
    left: 0,
    top: 0,
    width,
    height,
    aspect: width / height,
  };
};
