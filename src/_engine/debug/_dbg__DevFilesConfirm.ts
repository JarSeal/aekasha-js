// The confirm writes dialog (p355 §2.4 item 2): a dry run's files with what the commit would do
// to each, Confirm and Cancel. `writeDevFiles` commits only on Confirm.
import { CMP } from '../ui/core/CMP';
import { createBadge, type BadgeTone } from '../ui/components/Badge';
import { createButton } from '../ui/components/Button';
import { openDialog } from '../ui/overlays/windows/DialogWindow';
import { closeDraggableWindow, getDraggableWindow } from '../ui/overlays/windows/DraggableWindow';
import type { DevFilesCommitBody, DevFilesWriteStatus } from './DevFilesProtocol';
import styles from './DevFiles.module.scss';

const STATUS_BADGES: Record<DevFilesWriteStatus, { label: string; tone: BadgeTone }> = {
  created: { label: 'Created', tone: 'success' },
  updated: { label: 'Updated', tone: 'info' },
  unchanged: { label: 'Unchanged', tone: 'neutral' },
};

let dialogCount = 0;

/**
 * Asks whether the dry run's writes may land.
 * @returns true on Confirm; false on Cancel, Escape, the close button or the dialog not opening
 */
export const confirmDevFilesWrites = (results: DevFilesCommitBody['results']) =>
  new Promise<boolean>((resolve) => {
    // Its own id: two tools' writes waiting at once are two dialogs
    const id = `aekDevFilesConfirm${++dialogCount}`;
    let isConfirmed = false;
    openDialog({
      id,
      title: 'Confirm writes',
      size: { w: 560, h: 360 },
      isDebugWindow: true,
      closeOnEscape: true,
      removeOnClose: true,
      content: () => {
        // However the dialog closes, its content goes: the answer is what was picked by then
        const root = CMP({ class: styles.dialogContent, onRemoveCmp: () => resolve(isConfirmed) });
        const panel = root.add({ class: styles.panel });
        const count = results.filter((result) => result.status !== 'unchanged').length;
        panel.add({
          tag: 'p',
          text: `The dev files will write ${count} file${count === 1 ? '' : 's'} into the repo:`,
        });
        const list = panel.add({ tag: 'ul', class: styles.fileList });
        for (const result of results) {
          const row = list.add({ tag: 'li', class: styles.fileRow });
          row.add(createBadge(STATUS_BADGES[result.status]).cmp);
          row.add({ tag: 'code', class: styles.path, text: result.path });
        }
        const footer = root.add({ class: styles.footer });
        footer.add(createButton({ label: 'Cancel', onClick: () => closeDraggableWindow(id) }).cmp);
        footer.add(
          createButton({
            label: 'Confirm',
            variant: 'primary',
            onClick: () => {
              isConfirmed = true;
              closeDraggableWindow(id);
            },
          }).cmp
        );
        return root;
      },
    });
    // Not opened (outside the debug env): nothing confirmed it
    if (!getDraggableWindow(id)) resolve(false);
  });
