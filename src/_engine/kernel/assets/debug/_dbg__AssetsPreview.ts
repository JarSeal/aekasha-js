import type * as THREE from 'three/webgpu';
import { CMP } from '../../../ui/core/CMP';
import type { CMPHandle } from '../../../ui/core/CMPTypes';
import type { PropertyGridItem } from '../../../ui/forms/PropertyGridItems';
import { getTextureArrayInfo } from '../TextureArray';
import { getTextureAtlasInfo, type TextureAtlasInfo } from '../TextureAtlas';
import { getTextureDepth } from './_dbg__AssetStats';
import {
  getTextureLevelCount,
  getTextureLevelSize,
  renderTexturePreviewAsync,
  type TexturePreview,
} from './_dbg__TexturePreview';
import styles from './Assets.module.scss';

/**
 * The Assets tab info window's previews (p299 D6): an array texture's layers as thumbnails, an
 * atlas slot's image with its cells' content and padded rects (the cell's id on hover), at one mip
 * level picked in the window. Rendered on the GPU and read back (_dbg__TexturePreview.ts), since a
 * KTX2 texture can't be drawn into a 2D canvas. Its Level select and Cell rects checkbox are items of
 * the window's grid (p806 D10), the images a custom item.
 */

/** A layer thumbnail's largest side, in px */
const THUMB_MAX_SIZE = 128;
/** An atlas slot image's largest side, in px */
const IMAGE_MAX_SIZE = 1024;

type PreviewState = { level: number; showRects: boolean };

/** Per info window, for its session: kept when its content is rebuilt, dropped on its close. */
const previewStates = new Map<string, PreviewState>();

/** Drops a closed info window's picked level and rects toggle. */
export const forgetTexturePreviewState = (windowId: string) => previewStates.delete(windowId);

const esc = (value: unknown) =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string
  );

const toCanvas = (image: ImageData) => {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  canvas.className = styles.assetsPreviewCanvas;
  canvas.getContext('2d')?.putImageData(image, 0, 0);
  return canvas;
};

/** The cells' rects over the slot image, in the layout's px (the image at any level covers the
 * whole layout): the padded rect (cyan) around the content rect (magenta), as the scene draws them. */
const getAtlasOverlaySvg = (info: TextureAtlasInfo) => {
  const [layoutW, layoutH] = info.size;
  const pad = info.padding;
  const cells = Object.entries(info.cells).map(([cellId, cell]) => {
    const [u0, v0, u1, v1] = cell.uv;
    // v up: the rect's top is v1
    const x = u0 * layoutW;
    const y = (1 - v1) * layoutH;
    const w = (u1 - u0) * layoutW;
    const h = (v1 - v0) * layoutH;
    return `<g class="${styles.assetsPreviewCell}" data-cell="${esc(cellId)}"><title>${esc(cellId)}</title><rect class="${styles.assetsPreviewPadded}" x="${x - pad}" y="${y - pad}" width="${w + 2 * pad}" height="${h + 2 * pad}" vector-effect="non-scaling-stroke" /><rect class="${styles.assetsPreviewContent}" x="${x}" y="${y}" width="${w}" height="${h}" vector-effect="non-scaling-stroke" /></g>`;
  });
  return `<svg class="${styles.assetsPreviewOverlay}" viewBox="0 0 ${layoutW} ${layoutH}" preserveAspectRatio="none">${cells.join('')}</svg>`;
};

/** "crackA: 64 × 64 px at 16, 16": a hovered cell's content rect in image px from the top left. */
const describeHoveredCell = (info: TextureAtlasInfo, cellId: string) => {
  const cell = info.cells[cellId];
  if (!cell) return '';
  const [u0, , , v1] = cell.uv;
  const x = Math.round(u0 * info.size[0]);
  const y = Math.round((1 - v1) * info.size[1]);
  return `${cellId}: ${cell.size[0]} × ${cell.size[1]} px at ${x}, ${y}`;
};

const HOVER_HINT = 'Hover a cell for its id.';

/** "Level 2: 128 × 128 px, shown at 64 × 64 (sampled down)" */
const describePreview = (preview: TexturePreview, droppedLevels: number) => {
  const { level, levelWidth, levelHeight, width, height } = preview;
  const shown =
    width !== levelWidth || height !== levelHeight
      ? `, shown at ${width} × ${height} (sampled down)`
      : '';
  const layout = droppedLevels ? ` (the layout's level ${level + droppedLevels})` : '';
  return `Level ${level}${layout}: ${levelWidth} × ${levelHeight} px${shown}`;
};

/** Whether a texture has a preview: an array's layers, an atlas slot's image. */
export const hasTexturePreview = (texture: THREE.Texture) =>
  Boolean(getTextureAtlasInfo(texture)) ||
  Boolean(getTextureArrayInfo(texture)) ||
  getTextureDepth(texture) > 1;

/**
 * The info window's preview items of an array texture or an atlas slot: the Level select (each
 * level's size in its option), an atlas slot's Cell rects checkbox, and the images, rendered when
 * the grid builds them and again on a level picked.
 * @param windowId the info window's id: its picked level and rects toggle are kept per window
 */
export const getTexturePreviewItems = (
  texture: THREE.Texture,
  windowId: string
): PropertyGridItem[] => {
  const atlas = getTextureAtlasInfo(texture);

  const levelCount = getTextureLevelCount(texture);
  const state = previewStates.get(windowId) ?? { level: 0, showRects: true };
  state.level = Math.min(state.level, levelCount - 1);
  previewStates.set(windowId, state);
  // An atlas slot's file can start below the layout's level 0 (its maxSize dropped the top levels)
  const droppedLevels = atlas ? Math.round(Math.log2(atlas.size[0] / atlas.width)) : 0;
  const members = getTextureArrayInfo(texture)?.members;

  let renderToken = 0;
  /** The window closed or rebuilt: a readback arriving after it writes nothing */
  let isRemoved = false;
  const status = CMP({ tag: 'p', class: styles.assetsPreviewStatus, text: '' });
  const images = CMP({ class: atlas ? undefined : styles.assetsPreviewThumbs });
  const hover = atlas
    ? CMP({ tag: 'p', class: styles.assetsPreviewStatus, text: HOVER_HINT })
    : null;

  const showPreview = (preview: TexturePreview) => {
    images.elem.replaceChildren();
    if (atlas) {
      const frame = document.createElement('div');
      frame.className = styles.assetsPreviewFrame;
      frame.appendChild(toCanvas(preview.tiles[0].image));
      frame.insertAdjacentHTML('beforeend', getAtlasOverlaySvg(atlas));
      // The frame goes with the images' next replace, and its listeners with it
      frame.addEventListener('mouseover', (e) => {
        const cellId = (e.target as Element).closest('[data-cell]')?.getAttribute('data-cell');
        hover?.updateText(cellId ? describeHoveredCell(atlas, cellId) : HOVER_HINT);
      });
      frame.addEventListener('mouseleave', () => hover?.updateText(HOVER_HINT));
      images.elem.appendChild(frame);
      return;
    }
    for (const tile of preview.tiles) {
      const figure = document.createElement('figure');
      figure.className = styles.assetsPreviewThumb;
      figure.appendChild(toCanvas(tile.image));
      const caption = document.createElement('figcaption');
      const name = members?.[tile.layer];
      caption.textContent = name !== undefined ? `${tile.layer}: ${name}` : String(tile.layer);
      caption.title = caption.textContent;
      figure.appendChild(caption);
      images.elem.appendChild(figure);
    }
  };

  /** Renders the picked level; a later call wins over one still reading back. */
  const render = async () => {
    const token = ++renderToken;
    status.updateText(`Rendering level ${state.level}…`);
    status.removeAttr('data-error');
    try {
      const preview = await renderTexturePreviewAsync(texture, {
        level: state.level,
        maxSize: atlas ? IMAGE_MAX_SIZE : THUMB_MAX_SIZE,
      });
      if (token !== renderToken || isRemoved) return;
      showPreview(preview);
      status.updateText(describePreview(preview, droppedLevels));
    } catch (err) {
      if (token !== renderToken || isRemoved) return;
      status.updateText(`The preview failed: ${err instanceof Error ? err.message : String(err)}`);
      status.updateAttr({ 'data-error': '' });
    }
  };

  const levelOptions = [...Array(levelCount).keys()].map((level) => {
    const size = getTextureLevelSize(texture, level);
    return {
      value: level,
      text: size ? `${level}: ${size.width} × ${size.height} px` : String(level),
    };
  });
  let view: CMPHandle | null = null;
  return [
    {
      label: 'Level',
      get: () => state.level,
      set: (level: unknown) => {
        if (level === state.level) return;
        state.level = level as number;
        if (view) void render();
      },
      options: levelOptions,
    },
    ...(atlas
      ? [
          {
            label: 'Cell rects',
            get: () => state.showRects,
            set: (showRects: unknown) => {
              state.showRects = Boolean(showRects);
              view?.updateClass(styles.assetsPreviewHideRects, state.showRects ? 'remove' : 'add');
            },
          },
        ]
      : []),
    {
      type: 'custom',
      build: (container) => {
        const cmp = container.add({
          class: [
            styles.assetsPreview,
            ...(state.showRects ? [] : [styles.assetsPreviewHideRects]),
          ],
          onRemoveCmp: () => {
            isRemoved = true;
          },
        });
        cmp.add(status);
        cmp.add(images);
        if (hover) cmp.add(hover);
        view = cmp;
        // It fills the images when the readback arrives (the window attaches them before)
        void render();
      },
    },
  ];
};
