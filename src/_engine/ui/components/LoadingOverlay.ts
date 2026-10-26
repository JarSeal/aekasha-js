import type { CMPAttr, CMPHandle } from '../core/CMPTypes';
import { CMP, classes } from '../core/CMP';
import { getMotionFactor } from '../core/Motion';
import { createProgressBar, type ProgressBar } from './ProgressBar';
import { createSpinner, type Spinner } from './Spinner';
import './LoadingOverlay.scss';
import '../styles/kit.scss';

/** What {@link createLoadingOverlay} draws. */
export type LoadingOverlayProps = {
  /** What's loading, shown under the spinner or the bar and read as a status ('Loading the
   * level'). */
  text: string;
  /** A progress bar in place of the spinner, at this value from 0 to 100, or `null` for an
   * indeterminate one. Without it, a spinner (until a `setProgress`). */
  progress?: number | null;
  /** What it covers (default 'bounds'): the HUD's bounds (the browser window, or a mounted
   * engine's container), or `'parent'`, the positioned element it's added to (a panel). */
  cover?: 'bounds' | 'parent';
  /** Its fade in, in ms (default 150), times the motion factor: 0 under reduced motion. */
  fadeInMs?: number;
  /** Its fade out, in ms (default 250), times the motion factor. */
  fadeOutMs?: number;
  /** Extra classes for its element. */
  class?: string | string[];
  /** Extra attributes for its element. */
  attr?: CMPAttr;
  /** Its element id (default: a generated one, not written to the element). */
  id?: string;
};

/** A loading overlay {@link createLoadingOverlay} made: its CMP, its fades and its setters, each
 * writing it in place. */
export type LoadingOverlay = {
  /** Its element (`.aekLoadingOverlay`), hidden until `showAsync`: add it where it goes (the HUD
   * root, or a scene loader's `loaderContainerFn` returns it). `cmp.remove()` ends a fade and
   * removes its spinner or bar. */
  cmp: CMPHandle;
  /** Fades it in. Resolves `true` when it's shown, `false` when a `hideAsync` or the removal came
   * first (the later call wins): a scene loader's `loadStartFn` as it is. */
  showAsync: () => Promise<boolean>;
  /** Fades it out. Resolves `true` when it's hidden, `false` when a `showAsync` or the removal came
   * first: a scene loader's `loadEndFn` as it is. */
  hideAsync: () => Promise<boolean>;
  /** Whether it's shown or fading in */
  isShown: () => boolean;
  /** Changes its text (read as a status: say what's loading now). */
  setText: (text: string) => void;
  /** Sets the progress bar's value from 0 to 100, or `null` for indeterminate; the first call on a
   * spinner overlay puts a bar in its place. */
  setProgress: (value: number | null) => void;
};

/** The fades' defaults: the debug scene loader's */
const FADE_IN_MS = 150;
const FADE_OUT_MS = 250;

/**
 * Creates a loading overlay (p803 D10): it covers the HUD's bounds (a scene load) or a panel of
 * the app's while something loads, with a spinner or a progress bar and a text. It fades in and
 * out, and blocks the pointer while shown (a scene load turns the inputs off itself).
 * - Parts: `.aekLoadingOverlay` (`data-cover`, `data-state`: `hidden`, `showing`, `shown`,
 *   `hiding`), `.aekLoadingOverlay__content`, a decorative `createSpinner` or a
 *   `createProgressBar` (`.aekLoadingOverlay__progress`, named by the text), and
 *   `.aekLoadingOverlay__text`.
 * - Custom properties (read on any ancestor): `--aek-loading-overlay-bg` (default `--aek-bg`:
 *   opaque, so a scene's swap doesn't show), `--aek-loading-overlay-z` (default `--aek-z-loading`
 *   over the bounds, 1 in a parent), `--aek-loading-overlay-spinner-size`.
 * - ARIA: the text is a `role="status"`, so a `setText` is read; the spinner is decorative.
 * - Motion: the fades are `fadeInMs` / `fadeOutMs` times `getMotionFactor`, so they're instant
 *   under reduced motion (or an app's `--aek-motion: 0`) and the promises resolve at once.
 * @example
 * ```ts
 * import { createSceneLoader } from 'aekasha';
 * import { createLoadingOverlay, type LoadingOverlay } from 'aekasha/ui';
 *
 * let overlay: LoadingOverlay | null = null;
 * await createSceneLoader({
 *   id: 'main',
 *   // A new overlay per load: the load removes its container at its end
 *   loaderContainerFn: () => {
 *     overlay = createLoadingOverlay({ text: 'Loading the level', progress: 0 });
 *     return overlay.cmp;
 *   },
 *   loadStartFn: () => overlay?.showAsync() ?? Promise.resolve(true),
 *   loadEndFn: () => overlay?.hideAsync() ?? Promise.resolve(true),
 *   // Scene code calls getLoaderStatusUpdater()({ percent })
 *   updateLoaderStatusFn: (_loader, params) => overlay?.setProgress(Number(params?.percent ?? 0)),
 * });
 * ```
 */
export const createLoadingOverlay = (props: LoadingOverlayProps): LoadingOverlay => {
  const { fadeInMs = FADE_IN_MS, fadeOutMs = FADE_OUT_MS } = props;
  let text = props.text;
  let spinner: Spinner | null = null;
  let bar: ProgressBar | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  // The fade in progress' resolve: a later call or the removal resolves it false
  let settle: ((isDone: boolean) => void) | null = null;

  const endFade = (isDone: boolean) => {
    if (timer) clearTimeout(timer);
    timer = null;
    const resolve = settle;
    settle = null;
    resolve?.(isDone);
  };

  const cmp = CMP({
    id: props.id,
    idAttr: props.id !== undefined,
    class: classes('aekLoadingOverlay', props.class),
    attr: { ...props.attr, 'data-cover': props.cover ?? 'bounds', 'data-state': 'hidden' },
    onRemoveCmp: () => endFade(false),
  });
  const elem = cmp.elem;
  const content = cmp.add({ class: 'aekLoadingOverlay__content' });
  const textElem = document.createElement('p');
  textElem.className = 'aekLoadingOverlay__text';
  textElem.setAttribute('role', 'status');
  textElem.textContent = text;
  content.elem.append(textElem);

  /** Adds the spinner or the bar to the content, above the text */
  const addAboveText = (part: CMPHandle) => {
    content.add(part);
    content.elem.insertBefore(part.elem, textElem);
  };

  const setProgress = (value: number | null) => {
    if (!bar) {
      spinner?.cmp.remove();
      spinner = null;
      bar = createProgressBar({
        label: text,
        hideLabel: true,
        value,
        class: 'aekLoadingOverlay__progress',
      });
      // Where the spinner was
      addAboveText(bar.cmp);
      return;
    }
    bar.setValue(value);
  };

  if (props.progress !== undefined) setProgress(props.progress);
  else {
    spinner = createSpinner({ decorative: true });
    addAboveText(spinner.cmp);
  }

  /** Moves to `to` over `ms` (times the motion factor), through `via`, and resolves with it */
  const fade = (via: 'showing' | 'hiding', to: 'shown' | 'hidden', ms: number) => {
    endFade(false);
    const duration = ms * getMotionFactor(elem);
    elem.style.transitionDuration = `${duration}ms`;
    // A style read first, so an overlay added in this frame fades from its hidden opacity
    if (typeof window.getComputedStyle === 'function') void window.getComputedStyle(elem).opacity;
    elem.setAttribute('data-state', via);
    return new Promise<boolean>((resolve) => {
      settle = resolve;
      const finish = () => {
        elem.setAttribute('data-state', to);
        endFade(true);
      };
      if (duration > 0) timer = setTimeout(finish, duration);
      else finish();
    });
  };

  return {
    cmp,
    showAsync: () => fade('showing', 'shown', fadeInMs),
    hideAsync: () => fade('hiding', 'hidden', fadeOutMs),
    isShown: () => {
      const state = elem.getAttribute('data-state');
      return state === 'showing' || state === 'shown';
    },
    setText: (next) => {
      text = next;
      textElem.textContent = next;
      bar?.setLabel(next);
    },
    setProgress,
  };
};
