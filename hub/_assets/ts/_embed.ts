/**
 * The live embeds (p611 D9, `::: embed`, `devTools/hub/embed.ts`): a chunk `hub.ts` loads on a
 * page that has one. Each panel's poster stays until the profile's entry module is imported and
 * mounted over it, which starts when the panel nears the viewport. With reduced motion it waits
 * for the play button; without WebGPU or WebGL2 it never starts, and the status line says why.
 */

/** The parts of the engine's `AekashaMount` the page uses (the Hub's code has no engine types) */
type EmbedHandle = {
  readonly isFallback: boolean;
  pause: () => void;
  resume: () => void;
};

/** An embed profile's entry module (`src/app/profiles/<id>/<id>.embed.ts`) */
type EmbedModule = { mount: (opts: Record<string, unknown>) => Promise<EmbedHandle> };

/** Starts the import a little before the panel scrolls in */
const START_MARGIN = '200px';

/**
 * The dev Hub imports the entry's source from the dev server (`data-hub-embed-dev`). Two things the
 * app's page has and this one doesn't:
 * - Vite's `define`s (`__PROJECT_METADATA__`, `__AEK_DEBUG__`) are globals its `/@vite/env` module
 *   sets, which the app's page loads through Vite's client: imported first here.
 * - The dev server doesn't tree-shake: the entry's source evaluates the whole `aekasha` entry, so the
 *   full-page boot's `page.scss` (normalize and the body's `overflow: hidden`, which would stop
 *   this page scrolling) would restyle this page. Its `<style>` is removed (a build never has it).
 *   Since p801 it sets no root font size and no font, so the kit doesn't depend on it either way.
 */
const DEV_ENV_URL = '/@vite/env';
const DEV_PAGE_STYLES_SELECTOR = 'style[data-vite-dev-id$="/ui/styles/page.scss"]';

const isRenderingSupported = () =>
  'gpu' in navigator || !!document.createElement('canvas').getContext('webgl2');

const setStatus = (panel: HTMLElement, text: string) => {
  const status = panel.querySelector<HTMLElement>('[data-hub-embed-status]');
  if (!status) return;
  status.textContent = text;
  status.hidden = false;
};

const initPauseButton = (panel: HTMLElement, handle: EmbedHandle) => {
  const button = panel.querySelector<HTMLButtonElement>('[data-hub-embed-pause]');
  if (!button) return;
  let isPaused = false;
  button.hidden = false;
  button.addEventListener('click', () => {
    isPaused = !isPaused;
    if (isPaused) handle.pause();
    else handle.resume();
    panel.classList.toggle('hubEmbed_paused', isPaused);
    button.setAttribute('aria-label', isPaused ? 'Play the scene' : 'Pause the scene');
  });
};

const startEmbed = async (panel: HTMLElement, isMotionAsked: boolean) => {
  const target = panel.querySelector<HTMLElement>('[data-hub-embed-target]');
  const poster = panel.querySelector<HTMLImageElement>('[data-hub-embed-poster]');
  const url = new URL(panel.dataset.hubEmbed ?? '', document.baseURI).href;
  if (!target) return;
  panel.classList.add('hubEmbed_loading');
  try {
    const isDev = panel.hasAttribute('data-hub-embed-dev');
    if (isDev) await import(/* @vite-ignore */ DEV_ENV_URL);
    const embed = (await import(/* @vite-ignore */ url)) as EmbedModule;
    if (isDev) document.querySelector(DEV_PAGE_STYLES_SELECTOR)?.remove();
    const handle = await embed.mount({
      target,
      layout: 'INLINE',
      input: 'NONE',
      pauseWhenHidden: true,
      reducedMotion: isMotionAsked ? 'IGNORE' : 'RESPECT',
      // The mount shows it until its first frame: no gap between the poster and the scene
      fallbackImage: poster?.currentSrc || poster?.src,
    });
    if (handle.isFallback) {
      setStatus(panel, 'The scene didn’t start in this browser: the picture is a still of it.');
      return;
    }
    panel.classList.add('hubEmbed_live');
    initPauseButton(panel, handle);
  } catch (err) {
    // eslint-disable-next-line no-console -- a failed load's error, for the console (the page says it failed)
    console.error('[Hub] The live scene failed to load:', err);
    setStatus(panel, 'The live scene didn’t load: the picture is a still of it.');
  } finally {
    panel.classList.remove('hubEmbed_loading');
  }
};

/** Starts each `::: embed` panel of the page (the build allows one per page) */
export const initEmbeds = () => {
  for (const panel of document.querySelectorAll<HTMLElement>('[data-hub-embed]')) {
    if (!isRenderingSupported()) {
      setStatus(
        panel,
        'This browser has neither WebGPU nor WebGL2: the picture is a still of the scene.'
      );
      continue;
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const play = panel.querySelector<HTMLButtonElement>('[data-hub-embed-play]');
      if (!play) continue;
      play.hidden = false;
      play.addEventListener(
        'click',
        () => {
          play.hidden = true;
          void startEmbed(panel, true);
        },
        { once: true }
      );
      continue;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        void startEmbed(panel, false);
      },
      { rootMargin: START_MARGIN }
    );
    observer.observe(panel);
  }
};
