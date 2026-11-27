// p392 D1: the texts' API and the `text()` feature's install of them (the fonts' is Fonts.ts').
import { lerror } from '../../utils/Logger';
import type { FeatureContext } from '../../kernel/init/Features';
import type { SceneHooks } from '../../kernel/scene/SceneHooks';
import { TextObject } from './TextObject';
import { getRegisteredText, getRegisteredTexts, nextTextId, registerText } from './TextRegistry';
import type { TextProps } from './TextTypes';

let isInstalled = false;

/**
 * Creates a text in the 3D world: a string in a loaded font, laid out and drawn before the next
 * frame, sized in metres or CSS pixels and lying in its plane or facing the camera. The handle
 * is plain gameplay API, no ECS world involved; it lives until it's disposed or the scene
 * changes (a scene switch disposes every text neither `persistent` nor bound to an entity).
 * @param props the string, its font (loaded: the scene's `fonts`, or `loadFontAsync` first), its
 *   look, layout and place
 * @returns the text's handle: its setters change it in place
 * @example
 * ```ts
 * import { createText } from 'aekasha/text';
 *
 * // A sign 2 m up, its first line's baseline centred there
 * const sign = createText({
 *   text: 'North gate',
 *   font: 'plexSans',
 *   size: 0.4,
 *   anchor: 'BASELINE_CENTER',
 *   position: { x: 0, y: 2, z: -5 },
 * });
 * sign.setText('North gate (closed)');
 * sign.setColor('#ff6644');
 * ```
 */
export const createText = (props: TextProps): TextObject => {
  if (!isInstalled) {
    const msg =
      "createText: the text feature isn't installed. Add `text()` (from 'aekasha/text') to InitEngine's `features`.";
    lerror(msg);
    throw new Error(msg);
  }
  const id = props.id ?? nextTextId();
  if (getRegisteredText(id)) {
    const msg = `A text with the id "${id}" already exists. Dispose the old text first or pick another id (createText).`;
    lerror(msg);
    throw new Error(msg);
  }
  const text = new TextObject(id, props);
  registerText(text);
  return text;
};

/**
 * A live text by id.
 * @param id the text's id (`TextProps.id`, or the generated `text_<n>`)
 * @returns the text, or undefined when none has the id
 */
export const getText = (id: string) => getRegisteredText(id);

/**
 * Disposes every text that is neither `persistent` nor bound to an entity (those follow their
 * entity). Runs on every scene switch (the `text()` feature's `exit` scene hook).
 * @internal
 */
export const disposeNonPersistentTexts = () => {
  for (const text of Array.from(getRegisteredTexts().values())) {
    if (!text.persistent) text.dispose();
  }
};

/** The texts' part of a scene load: the previous scene's texts go, except the `persistent` ones
 * and those an entity owns (they go with their entity) */
const textsSceneHooks: SceneHooks = {
  exit: () => disposeNonPersistentTexts(),
};

/**
 * Installs the texts (the `text()` feature's install, TextFeature.ts). Without it,
 * {@link createText} throws.
 * @internal
 */
export const installTexts = (ctx: FeatureContext) => {
  ctx.addSceneHooks(textsSceneHooks);
  isInstalled = true;
};
