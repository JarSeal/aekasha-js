/**
 * The browser window's inner width and height, and their aspect ratio: the draggable windows' and
 * the debug drawer's bounds.
 * @internal
 */
export const getWindowSize = () => {
  const width = window.innerWidth;
  const height = window.innerHeight;

  return {
    width,
    height,
    aspect: width / height,
  };
};
