/**
 * `yarn verify:ui`'s steps on a page (`ui.ts` is the CLI): a state's clicks and a keyboard
 * script's keys, expectations and outline check (p803 D11; the step format is
 * `hub/_assets/ts/_componentChecks.ts`'). No named function inside `page.evaluate`: tsx wraps
 * those in a helper the page doesn't have.
 */
import type { Page } from 'playwright-core';
import type { UiKeyStep } from '../../hub/_assets/ts/_componentChecks';
import { describeStep, type UiRunStep } from './uiChecks';

/** How long an `expect*` step waits for its state */
const EXPECT_TIMEOUT_MS = 3_000;
/** How long the focused element may take to show its outline after a key */
const OUTLINE_TIMEOUT_MS = 500;
const POLL_MS = 50;

export const boxSelector = (piece: string) => `[data-hub-demo="${piece}"]`;

/** A box's Hub buttons, which open its states: the page's own (`.hubButton`), not a kit button
 * drawn in the box as its demo */
export const BOX_BUTTON = 'button.hubButton';

/** The demo box's Hub button whose text is `text`, exactly */
const getBoxButton = (page: Page, piece: string, text: string) => {
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return page
    .locator(`${boxSelector(piece)} ${BOX_BUTTON}`)
    .filter({ hasText: new RegExp(`^\\s*${escaped}\\s*$`) })
    .first();
};

/** Takes a step that clicks or presses; false for an `expect*` step, which it leaves */
const actAsync = async (page: Page, piece: string, step: UiRunStep | UiKeyStep) => {
  if ('button' in step) {
    await page
      .locator(`${boxSelector(piece)} ${BOX_BUTTON}`)
      .nth(step.button)
      .click();
  } else if ('click' in step) {
    await getBoxButton(page, piece, step.click).click();
  } else if ('focusBox' in step) {
    await getBoxButton(page, piece, step.focusBox).focus();
  } else if ('clickHud' in step) {
    await page.locator(`#hudRoot ${step.clickHud}`).first().click();
  } else if ('focusHud' in step) {
    await page.locator(`#hudRoot ${step.focusHud}`).first().focus();
  } else if ('clickInBox' in step) {
    await page
      .locator(`${boxSelector(piece)} ${step.clickInBox}`)
      .first()
      .click();
  } else if ('focusInBox' in step) {
    await page
      .locator(`${boxSelector(piece)} ${step.focusInBox}`)
      .first()
      .focus();
  } else if ('press' in step) {
    await page.keyboard.press(step.press);
  } else if ('keyDown' in step) {
    await page.keyboard.down(step.keyDown);
  } else if ('keyUp' in step) {
    await page.keyboard.up(step.keyUp);
  } else return false;
  return true;
};

/** A state's steps */
export const takeStepsAsync = async (page: Page, piece: string, steps: UiRunStep[]) => {
  for (const step of steps) await actAsync(page, piece, step);
};

/** Whether an `expect*` step holds now, and what the page has */
const readExpectation = (page: Page, piece: string, step: UiKeyStep) =>
  page.evaluate(
    ({ s, box }) => {
      const active = document.activeElement;
      const activeText = !active
        ? 'nothing'
        : `${active.tagName.toLowerCase()}${active.id ? `#${active.id}` : ''}${
            active.classList[0] ? `.${active.classList[0]}` : ''
          } "${(active.textContent ?? '').trim().slice(0, 30)}"`;
      if ('expectFocus' in s) {
        return { ok: !!active?.matches(s.expectFocus), actual: `focus on ${activeText}` };
      }
      if ('expectFocusBox' in s) {
        const isBoxButton =
          !!active?.matches(`${box} button`) &&
          (active.textContent ?? '').trim() === s.expectFocusBox;
        return { ok: isBoxButton, actual: `focus on ${activeText}` };
      }
      if ('expectAttr' in s) {
        const el = document.querySelector(s.expectAttr);
        const value = el ? el.getAttribute(s.name) : undefined;
        return {
          ok: !!el && value === s.value,
          actual: el ? `${s.name}: ${value === null ? 'absent' : `"${value}"`}` : 'no element',
        };
      }
      if ('expectCount' in s) {
        const count = document.querySelectorAll(s.expectCount).length;
        return { ok: count === s.count, actual: `${count} found` };
      }
      if ('expectText' in s) {
        const el = document.querySelector(s.expectText);
        const text = (el?.textContent ?? '').trim();
        return { ok: !!el && text === s.text, actual: el ? `"${text}"` : 'no element' };
      }
      if ('expectStyle' in s) {
        const el = document.querySelector(s.expectStyle);
        const value = el ? getComputedStyle(el).getPropertyValue(s.name).trim() : undefined;
        return {
          ok: !!el && value === s.value,
          actual: el ? `${s.name}: "${value}"` : 'no element',
        };
      }
      if ('expectActiveOption' in s) {
        const id = active?.getAttribute('aria-activedescendant');
        const option = id ? document.getElementById(id) : null;
        const text = (option?.textContent ?? '').trim();
        return {
          ok: !!option && text === s.expectActiveOption,
          actual: option ? `"${text}"` : `no active option on ${activeText}`,
        };
      }
      return { ok: false, actual: 'not an expectation' };
    },
    { s: step, box: boxSelector(piece) }
  );

/**
 * The focused element without an outline, described; null when it has one or it's the body. A
 * focused element with `aria-activedescendant` (a drop-down's list) shows the ring on that option
 * instead (p803 D7), so the option is the one read.
 */
const readMissingOutline = (page: Page) =>
  page.evaluate(() => {
    const focused = document.activeElement;
    if (!focused || focused === document.body) return null;
    const activeId = focused.getAttribute('aria-activedescendant');
    const el = (activeId && document.getElementById(activeId)) || focused;
    const style = getComputedStyle(el);
    if (style.outlineStyle !== 'none' && style.outlineWidth !== '0px') return null;
    return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${
      el.classList[0] ? `.${el.classList[0]}` : ''
    } "${(el.textContent ?? '').trim().slice(0, 30)}"`;
  });

const waitMs = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls `read` until `isDone` or the time is up; the last reading */
const pollAsync = async <T>(read: () => Promise<T>, isDone: (value: T) => boolean, ms: number) => {
  const end = Date.now() + ms;
  let value = await read();
  while (!isDone(value) && Date.now() < end) {
    await waitMs(POLL_MS);
    value = await read();
  }
  return value;
};

/**
 * A keyboard script's steps, stopping at the first expectation that doesn't come
 * @returns its problems: that expectation, and each key after which the focused element showed
 * no outline
 */
export const runKeyStepsAsync = async (page: Page, piece: string, steps: UiKeyStep[]) => {
  const problems: string[] = [];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const where = `step ${i + 1} (${describeStep(step)})`;
    if (await actAsync(page, piece, step)) {
      if (!('press' in step || 'keyDown' in step || 'keyUp' in step)) continue;
      const missing = await pollAsync(
        () => readMissingOutline(page),
        (m) => m === null,
        OUTLINE_TIMEOUT_MS
      );
      if (missing) problems.push(`${where}: the focused ${missing} shows no outline`);
      continue;
    }
    const result = await pollAsync(
      () => readExpectation(page, piece, step),
      (r) => r.ok,
      EXPECT_TIMEOUT_MS
    );
    if (!result.ok) {
      problems.push(`${where}: ${result.actual}`);
      break;
    }
  }
  return problems;
};

/** Hides the page around the HUD root for its screenshot (removed right after: axe skips hidden
 * elements) */
const HIDE_PAGE_CSS = 'body > :not(#hudRoot) { visibility: hidden !important; }';

/**
 * Pins the box at the viewport's top left, its width rounded, with the rest of the page hidden:
 * where the page lays it out (a text above it grown by a line) moves it by a fraction of a pixel,
 * which antialiases its edges differently
 */
const getPinBoxCss = (box: string, width: number) => `
body :not(${box}, ${box} *) { visibility: hidden !important; }
${box} {
  visibility: visible !important;
  position: fixed !important;
  inset: 0 auto auto 0 !important;
  width: ${width}px !important;
  margin: 0 !important;
  z-index: 2147483647 !important;
}`;

/**
 * Offsets the box by the fraction of a pixel its place on the page has (`position: relative`,
 * which, unlike a transform, leaves its fixed children alone), before a state's steps: an overlay
 * they open anchored to it then lands on whole pixels too. Where the page lays the box out (a text
 * above it grown by a line) moves an open overlay by whole pixels only, which its clipped shot
 * doesn't see; a fraction would antialias its text differently.
 */
export const alignBoxAsync = (page: Page, piece: string) =>
  page.evaluate((box) => {
    const el = document.querySelector<HTMLElement>(box);
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
    el.style.left = `${Math.round(rect.left) - rect.left}px`;
    el.style.top = `${Math.round(rect.top) - rect.top}px`;
  }, boxSelector(piece));

/** The box's screenshot, pinned (`getPinBoxCss`) */
const captureBoxAsync = async (page: Page, piece: string) => {
  const box = page.locator(boxSelector(piece));
  const width = await box.evaluate((el) => Math.ceil(el.getBoundingClientRect().width));
  const style = await page.addStyleTag({ content: getPinBoxCss(boxSelector(piece), width) });
  try {
    const height = await box.evaluate((el) => Math.ceil(el.getBoundingClientRect().height));
    return await page.screenshot({ clip: { x: 0, y: 0, width, height }, caret: 'hide' });
  } finally {
    await style.evaluate((el) => (el as Element).remove());
  }
};

/**
 * A state's screenshot: the HUD root's overlays alone (the page around them hidden, so a Hub text
 * change doesn't change it), clipped to their boxes' union in the viewport (a backdrop's is the
 * viewport), or the demo box, pinned, when nothing is open in the HUD root (the icons, a closed
 * state). A visually hidden element (a toaster's live regions, 1 px) isn't something open.
 */
export const captureStateAsync = async (page: Page, piece: string) => {
  const clip = await page.evaluate(() => {
    const rects = [...document.querySelectorAll('#hudRoot *')]
      .filter((el) => !el.closest('.aekVisuallyHidden'))
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.width > 0 && r.height > 0);
    if (!rects.length) return null;
    const left = Math.max(0, Math.floor(Math.min(...rects.map((r) => r.left))));
    const top = Math.max(0, Math.floor(Math.min(...rects.map((r) => r.top))));
    const right = Math.min(innerWidth, Math.ceil(Math.max(...rects.map((r) => r.right))));
    const bottom = Math.min(innerHeight, Math.ceil(Math.max(...rects.map((r) => r.bottom))));
    return right > left && bottom > top
      ? { x: left, y: top, width: right - left, height: bottom - top }
      : null;
  });
  if (!clip) return captureBoxAsync(page, piece);
  const style = await page.addStyleTag({ content: HIDE_PAGE_CSS });
  try {
    return await page.screenshot({ clip, caret: 'hide' });
  } finally {
    await style.evaluate((el) => (el as Element).remove());
  }
};
