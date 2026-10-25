/**
 * The component library (p802 D9, the dev page `project/aekasha/components/`): a chunk `hub.ts`
 * imports on a page with `[data-hub-components]`, only in the dev Hub. It uses `aekasha/ui`
 * without the engine: the Hub's script build resolves the kit's kernel import to a stand-in
 * (`_kitKernel.ts`, `devTools/hub/kitKernel.ts`).
 */
import { CMP, openDraggableWindow } from 'aekasha/ui';

/**
 * Mounts the demos into the page
 * @param root the page's `[data-hub-components]` element
 */
export const initComponents = (root: HTMLElement) => {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Open a window';
  button.addEventListener('click', () =>
    openDraggableWindow({
      id: 'hubDemoWindow',
      title: 'A window',
      content: () => CMP({ tag: 'p', text: 'Its content.' }),
    })
  );
  root.append(button);
};
