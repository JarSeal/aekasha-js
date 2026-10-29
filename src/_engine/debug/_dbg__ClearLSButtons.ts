import type { CMPHandle } from '../ui/core/CMPTypes';
import { CMP } from '../ui/core/CMP';
import { getSvgIcon, type SvgIconKey } from '../ui/core/icons/SvgIcon';
import { createButton } from '../ui/components/Button';
import { openDialog } from '../ui/overlays/windows/DialogWindow';
import { closeDraggableWindow } from '../ui/overlays/windows/DraggableWindow';
import { lsGetItem, lsSubscribe } from '../utils/LocalAndSessionStorage';

const CONFIRM_CLEAR_SCOPE_DIALOG_ID = 'clearLSScopeConfirmDialog';
const CONFIRM_CLEAR_DIALOG_ID = 'clearLSConfirmDialog';

/**
 * Whether a flat (non-scene-scoped) LocalStorage key currently has any data stored.
 */
export const lsKeyHasData = (key: string): boolean => lsGetItem(key, null) !== null;

type ClearLSButtonOpts = {
  hasData: () => boolean;
  onClear: () => void;
  /** LS key to watch for writes made through `lsSetItem`/`lsRemoveItem` (by this
   * button's own `onClear`, a sibling button's `onClear`, or unrelated edits
   * elsewhere in the tab) so the disabled state stays live instead of only
   * updating on this button's own click. Omit for buttons that are always
   * disabled regardless of any LS key (e.g. no backing key exists yet). */
  watchKey?: string;
};

/** A clear-LS icon button (a kit ghost icon button, p806 D12's 24 px target), disabled while
 * `hasData` is false. The tab and list variants below preset the icon and the title; another icon
 * fits a button that clears a part of a key. */
export const createClearLSButton = (
  opts: ClearLSButtonOpts & { icon: SvgIconKey; title: string }
): CMPHandle => {
  const button = createButton({
    label: opts.title,
    icon: getSvgIcon(opts.icon),
    iconOnly: true,
    variant: 'ghost',
    size: 'sm',
    disabled: !opts.hasData(),
    onClick: () => {
      if (!opts.hasData()) return;
      opts.onClear();
      // A clear without a watched key (or one that clears elsewhere) is read again here
      button.setDisabled(!opts.hasData());
    },
  });
  const unsubscribe = opts.watchKey
    ? lsSubscribe(opts.watchKey, () => button.setDisabled(!opts.hasData()))
    : undefined;
  // A wrapper, whose removal (with the button) ends the LS subscription
  const wrapper = CMP({
    tag: 'span',
    class: 'debuggerClearLSButton',
    onRemoveCmp: () => unsubscribe?.(),
  });
  wrapper.add(button.cmp);
  return wrapper;
};

export const createClearTabLSButton = (opts: ClearLSButtonOpts): CMPHandle =>
  createClearLSButton({ ...opts, icon: 'eraser', title: 'Clear local storage data for this tab' });

export const createClearListLSButton = (opts: ClearLSButtonOpts): CMPHandle =>
  createClearLSButton({
    ...opts,
    icon: 'databaseX',
    title: 'Clear local storage data for all items in this list',
  });

/** A confirm dialog for a clear without a scope to pick (eg. the data of every item of an
 * editor): the confirm button and Cancel (also Escape). */
export const confirmClearLS = (opts: {
  /** The question, eg. "Clear the editor data of all materials?" */
  message: string;
  /** The confirm button's text. */
  confirmText: string;
  onConfirm: () => void;
  /** A second paragraph, eg. what clearing does or leaves as it is */
  note?: string;
}) => {
  openDialog({
    id: CONFIRM_CLEAR_DIALOG_ID,
    closeIfOpen: true,
    closeOnEscape: true,
    title: 'Clear local storage data',
    isDebugWindow: true,
    size: { w: 360, h: 200 },
    content: () => {
      const wrapper = CMP({
        html: () => `<div><p>${opts.message}</p>${opts.note ? `<p>${opts.note}</p>` : ''}</div>`,
      });
      const buttonRow = wrapper.add({ class: 'debuggerClearLSDialogButtonRow' });
      buttonRow.add({
        tag: 'button',
        text: opts.confirmText,
        class: ['debuggerClearLSDialogButton', 'dangerColor'],
        onClick: () => {
          closeDraggableWindow(CONFIRM_CLEAR_DIALOG_ID);
          opts.onConfirm();
        },
      });
      buttonRow.add({
        tag: 'button',
        text: 'Cancel',
        class: 'debuggerClearLSDialogButton',
        onClick: () => closeDraggableWindow(CONFIRM_CLEAR_DIALOG_ID),
      });
      return wrapper;
    },
  });
};

export const confirmClearScope = (opts: {
  onClearAllScenes: () => void;
  onClearThisScene: () => void;
  /** A second paragraph, eg. what clearing does or leaves as it is */
  note?: string;
}) => {
  openDialog({
    id: CONFIRM_CLEAR_SCOPE_DIALOG_ID,
    closeIfOpen: true,
    title: 'Clear local storage data',
    isDebugWindow: true,
    size: { w: 360, h: 200 },
    content: () => {
      const wrapper = CMP({
        html: () =>
          `<div><p>Do you want to clear this from all scenes or just the current scene?</p>${opts.note ? `<p>${opts.note}</p>` : ''}</div>`,
      });
      const buttonRow = wrapper.add({ class: 'debuggerClearLSDialogButtonRow' });
      buttonRow.add({
        tag: 'button',
        text: 'Clear all scenes',
        class: ['debuggerClearLSDialogButton', 'dangerColor'],
        onClick: () => {
          closeDraggableWindow(CONFIRM_CLEAR_SCOPE_DIALOG_ID);
          opts.onClearAllScenes();
        },
      });
      buttonRow.add({
        tag: 'button',
        text: 'Clear this scene',
        class: 'debuggerClearLSDialogButton',
        onClick: () => {
          closeDraggableWindow(CONFIRM_CLEAR_SCOPE_DIALOG_ID);
          opts.onClearThisScene();
        },
      });
      buttonRow.add({
        tag: 'button',
        text: 'Cancel',
        class: 'debuggerClearLSDialogButton',
        onClick: () => closeDraggableWindow(CONFIRM_CLEAR_SCOPE_DIALOG_ID),
      });
      return wrapper;
    },
  });
};
