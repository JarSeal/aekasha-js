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

/** Takes a step that clicks or presses; false for an `expect*` step, which it leaves */
const actAsync = async (page: Page, piece: string, step: UiRunStep | UiKeyStep) => {
  if ('button' in step) {
    await page
      .locator(`${boxSelector(piece)} button`)
      .nth(step.button)
      .click();
  } else if ('click' in step) {
    const escaped = step.click.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    await page
      .locator(`${boxSelector(piece)} button`)
      .filter({ hasText: new RegExp(`^\\s*${escaped}\\s*$`) })
      .first()
      .click();
  } else if ('clickHud' in step) {
    await page.locator(`#hudRoot ${step.clickHud}`).first().click();
  } else if ('focusHud' in step) {
    await page.locator(`#hudRoot ${step.focusHud}`).first().focus();
  } else if ('press' in step) {
    await page.keyboard.press(step.press);
  } else return false;
  return true;
};

/** A state's steps */
export const takeStepsAsync = async (page: Page, piece: string, steps: UiRunStep[]) => {
  for (const step of steps) await actAsync(page, piece, step);
};

/** Whether an `expect*` step holds now, and what the page has */
const readExpectation = (page: Page, step: UiKeyStep) =>
  page.evaluate((s) => {
    const active = document.activeElement;
    const activeText = !active
      ? 'nothing'
      : `${active.tagName.toLowerCase()}${active.id ? `#${active.id}` : ''}${
          active.classList[0] ? `.${active.classList[0]}` : ''
        } "${(active.textContent ?? '').trim().slice(0, 30)}"`;
    if ('expectFocus' in s) {
      return { ok: !!active?.matches(s.expectFocus), actual: `focus on ${activeText}` };
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
  }, step);

/** The focused element without an outline, described; null when it has one or it's the body */
const readMissingOutline = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return null;
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
      if (!('press' in step)) continue;
      const missing = await pollAsync(
        () => readMissingOutline(page),
        (m) => m === null,
        OUTLINE_TIMEOUT_MS
      );
      if (missing) problems.push(`${where}: the focused ${missing} shows no outline`);
      continue;
    }
    const result = await pollAsync(
      () => readExpectation(page, step),
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
