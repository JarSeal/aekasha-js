// The About Ækasha dialog (p806 D10): the versions, packages, runtime and physics as description
// lists, set as text, with the kit's links and buttons.
import * as THREE from 'three/webgpu';
import { CMP } from '../ui/core/CMP';
import type { CMPHandle } from '../ui/core/CMPTypes';
import {
  getCurrentEnvironment,
  IS_PROD_TEST_MODE,
  PROJECT_METADATA,
} from '../kernel/config/Config';
import { getRenderer, isWebGPURenderer } from '../kernel/render/Renderer';
import { ComponentType } from '../kernel/ecs/ECSCoreComponents';
import { getECSWorld } from '../kernel/ecs/ECS';
import { getPhysicsState, isPhysicsWorldEnabled } from '../features/physics/PhysicsState';
import { getResolvedTransportMode } from '../features/physics/PhysicsWorld';
import { ENGINES } from '../features/physics/backends/Engines';
import { openDialog } from '../ui/overlays/windows/DialogWindow';
import { closeDraggableWindow } from '../ui/overlays/windows/DraggableWindow';
import { getSvgIcon } from '../ui/core/icons/SvgIcon';
import { createButton } from '../ui/components/Button';
import { createLink } from '../ui/components/Link';
import { announce } from '../ui/components/Announcer';
import styles from './About.module.scss';

const DIALOG_ID = 'aekAboutDialog';

type InfoRow = { label: string; value: string };
type InfoSection = { title: string; rows: InfoRow[] };

/** A "git+https://…/repo.git" package.json repository as a browsable https URL ('' if it isn't one). */
const getRepoUrl = () => {
  const url = PROJECT_METADATA.engine.repoUrl.replace(/^git\+/, '').replace(/\.git$/, '');
  return url.startsWith('https://') ? url : '';
};

const getVersionText = (version: string, codename: string) =>
  codename ? `${version} (${codename})` : version;

// The WebGPU device and the WebGL context of three's backends (not in three's types)
type BackendInternals = {
  device?: { adapterInfo?: { vendor?: string; architecture?: string; description?: string } };
  compatibilityMode?: boolean;
  gl?: WebGL2RenderingContext;
};

const getRendererText = () => {
  const renderer = getRenderer();
  if (!renderer) return 'Not created';
  if (!isWebGPURenderer()) return 'WebGL 2 (fallback)';
  const backend = renderer.backend as unknown as BackendInternals;
  return backend.compatibilityMode ? 'WebGPU (compatibility mode)' : 'WebGPU';
};

const getGPUText = () => {
  const backend = getRenderer()?.backend as unknown as BackendInternals | undefined;
  if (!backend) return 'Unknown';
  const info = backend.device?.adapterInfo;
  if (info) {
    const text = [info.vendor, info.architecture, info.description].filter(Boolean).join(' · ');
    if (text) return text;
  }
  const gl = backend.gl;
  if (gl) {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
  }
  return 'Not reported by the browser';
};

const countEntitiesWith = (type: ComponentType) => {
  let count = 0;
  const ids = getECSWorld().getEntitiesWith(type);
  while (!ids.next().done) count++;
  return count;
};

const formatNumber = (n: number) => String(+n.toFixed(3));

const PAUSE_REASONS = {
  BACKGROUND_BEHAVIOR: 'the window is hidden',
  SCENE_LOAD: 'a scene is loading',
};

const getPhysicsRows = (): InfoRow[] => {
  const physics = getPhysicsState();
  const { packages } = PROJECT_METADATA;
  const engineRows = Object.entries(ENGINES).map(([key, engine]) => ({
    label: engine.name,
    value: `${engine.packageName} ${packages[engine.packageName] || '(version unknown)'}${
      physics.enabled && key === physics.physicsEngine ? ', in use' : ''
    }`,
  }));

  // SharedArrayBuffer needs a cross-origin isolated page (the COOP / COEP headers)
  const isSABAvailable = typeof SharedArrayBuffer !== 'undefined' && window.crossOriginIsolated;
  const sabRow = {
    label: 'SharedArrayBuffer',
    value: isSABAvailable
      ? `Available${physics.useSAB ? '' : ', turned off (useSAB: false)'}`
      : 'Not available: the page is not cross-origin isolated (COOP / COEP headers)',
  };
  if (!physics.enabled) return [...engineRows, { label: 'Status', value: 'Off' }, sabRow];

  const isWorker = physics.workerTarget === 'WORKER_THREAD';
  const transport = getResolvedTransportMode();
  const transportText = !isWorker
    ? 'Direct (main thread)'
    : transport === 'SHARED_MEMORY'
      ? 'SharedArrayBuffer (triple buffer)'
      : transport === 'MESSAGE_BATCH'
        ? 'Message batch (one message per frame)'
        : 'Not resolved yet';
  const statusText = !isPhysicsWorldEnabled()
    ? 'No world'
    : physics.isPaused
      ? `Paused${physics.pauseReason ? ` (${PAUSE_REASONS[physics.pauseReason]})` : ''}`
      : 'Running';
  const staticCount = countEntitiesWith(ComponentType.BODY_STATIC);
  const visualCount = countEntitiesWith(ComponentType.BODY_DYNAMIC_VISUAL);
  const headlessCount = countEntitiesWith(ComponentType.BODY_DYNAMIC_HEADLESS);
  const { x, y, z } = physics.gravity;

  return [
    ...engineRows,
    { label: 'Status', value: statusText },
    { label: 'Thread', value: isWorker ? 'Worker thread' : 'Main thread' },
    { label: 'Transform transport', value: transportText },
    sabRow,
    {
      label: 'Timestep',
      value: `${physics.timestep} Hz (${formatNumber(physics.timestepRatio * 1000)} ms), at most ${physics.maxSubSteps} sub-steps per frame`,
    },
    {
      label: 'Solver',
      value: `${physics.solverIterations} iterations, ${physics.internalPgsIterations} internal PGS iterations`,
    },
    { label: 'Gravity', value: `${formatNumber(x)}, ${formatNumber(y)}, ${formatNumber(z)}` },
    { label: 'Interpolation', value: physics.interpolationMode },
    { label: 'In the background', value: physics.backgroundBehavior },
    {
      label: 'Bodies',
      value: `${staticCount} static, ${visualCount + headlessCount} dynamic (${headlessCount} headless)${
        isWorker ? `, transform buffer capacity ${physics.maxBodies}` : ''
      }`,
    },
  ];
};

const getBuildText = () => {
  const { commit, hasLocalChanges, time } = PROJECT_METADATA.build;
  const date = new Date(time);
  const timeText = Number.isNaN(date.getTime()) ? time : date.toLocaleString();
  if (!commit) return timeText;
  return `${commit}${hasLocalChanges ? ' + local changes' : ''}, ${timeText}`;
};

const getSections = (): InfoSection[] => {
  const { engine, toolkit, app, packages, buildTools, versionChecksum } = PROJECT_METADATA;
  return [
    {
      title: 'Versions',
      rows: [
        {
          label: `${engine.name || 'Ækasha'} engine`,
          value: getVersionText(engine.version, engine.codename),
        },
        {
          label: toolkit.name || 'Toolkit',
          value: getVersionText(toolkit.version, toolkit.codename),
        },
        { label: app.name || 'App', value: getVersionText(app.version, app.codename) },
        { label: 'Version checksum', value: versionChecksum },
        { label: 'Build', value: getBuildText() },
      ],
    },
    {
      title: 'Packages',
      rows: [
        ...Object.entries(packages).map(([name, version]) => ({
          label: name,
          value: name === 'three' ? `${version} (r${THREE.REVISION})` : version,
        })),
        ...Object.entries(buildTools).map(([name, version]) => ({
          label: name,
          value: `${version} (build)`,
        })),
      ],
    },
    {
      title: 'Runtime',
      rows: [
        {
          label: 'Environment',
          value: `${getCurrentEnvironment()}, ${IS_PROD_TEST_MODE ? 'production test mode' : 'debug mode'}`,
        },
        { label: 'Renderer', value: getRendererText() },
        { label: 'GPU', value: getGPUText() },
        {
          label: 'Viewport',
          value: `${window.innerWidth} × ${window.innerHeight} px, pixel ratio ${window.devicePixelRatio}`,
        },
        { label: 'Browser', value: navigator.userAgent },
      ],
    },
    { title: 'Physics', rows: getPhysicsRows() },
  ];
};

/** The dialog's information as plain text, for a bug report. */
const getInfoText = (sections: InfoSection[]) => {
  const { engine } = PROJECT_METADATA;
  const lines = [engine.fullName || engine.name];
  for (const section of sections) {
    lines.push('', `${section.title}:`);
    for (const row of section.rows) lines.push(`  ${row.label}: ${row.value}`);
  }
  return lines.join('\n');
};

/** The engine's symbol, name, version, description, credits and links (set as text: the metadata
 * is package.json's, not HTML). The window's title is the heading, so the name is a paragraph. */
const createHeader = () => {
  const { engine, license } = PROJECT_METADATA;
  const header = CMP({ class: styles.header });
  // A CMP with `html` is that HTML's element: the symbol's box holds it
  header
    .add({ class: styles.symbol, attr: { 'aria-hidden': 'true' } })
    .add({ html: getSvgIcon('aekasha') });
  const text = header.add({ class: styles.headerText });
  text.add({ tag: 'p', class: styles.name, text: engine.fullName || engine.name });
  text.add({
    tag: 'p',
    class: styles.version,
    text: `Version ${getVersionText(engine.version, engine.codename)}`,
  });
  if (engine.description) {
    text.add({ tag: 'p', class: styles.description, text: engine.description });
  }
  const credits = [license && `${license} license`, engine.author && `by ${engine.author}`]
    .filter(Boolean)
    .join(' · ');
  if (credits) text.add({ tag: 'p', class: styles.credits, text: credits });

  const repoUrl = getRepoUrl();
  const links: { href: string; label: string }[] = [];
  if (repoUrl) {
    links.push({ href: repoUrl, label: 'Repository' });
    links.push({ href: `${repoUrl}/blob/main/CHANGELOG.md`, label: 'Changelog' });
  }
  if (engine.url) links.push({ href: engine.url, label: 'Website' });
  if (links.length) {
    const row = text.add({ class: styles.links });
    for (const link of links) row.add(createLink({ ...link, external: true }).cmp);
  }
  return header;
};

/** A section's heading and its rows as a description list, set as text. */
const createSection = (section: InfoSection) => {
  const cmp = CMP({ tag: 'section', class: styles.section });
  cmp.add({ tag: 'h4', text: section.title });
  const rows = cmp.add({ tag: 'dl', class: styles.rows });
  for (const row of section.rows) {
    rows.add({ tag: 'dt', text: row.label });
    rows.add({ tag: 'dd', text: row.value });
  }
  return cmp;
};

const COPY_LABEL = 'Copy info';

const createDialogContent = (): CMPHandle => {
  // Read on every open: the renderer, physics state and viewport can change
  const sections = getSections();
  let copiedTimer: ReturnType<typeof setTimeout> | null = null;
  let isRemoved = false;
  // The dialog can close while the copy is pending or its result shows
  const onRemoveCmp = () => {
    isRemoved = true;
    if (copiedTimer) clearTimeout(copiedTimer);
    copiedTimer = null;
  };
  const root = CMP({ class: styles.dialogContent, onRemoveCmp });
  const panel = root.add({ class: styles.panel });
  panel.add(createHeader());
  for (const section of sections) panel.add(createSection(section));

  const footer = root.add({ class: styles.footer });
  // The result is the button's label for a moment, and said: a label change isn't read
  const showResult = (text: string) => {
    if (isRemoved) return;
    copyBtn.setLabel(text);
    announce(copyBtn.cmp.elem, text);
    if (copiedTimer) clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => copyBtn.setLabel(COPY_LABEL), 2000);
  };
  const copyBtn = createButton({
    label: COPY_LABEL,
    tooltip: 'Copy this information as text, eg. for a bug report',
    onClick: () => {
      if (!navigator.clipboard) {
        showResult('Copy failed');
        return;
      }
      navigator.clipboard
        .writeText(getInfoText(sections))
        .then(() => showResult('Copied'))
        .catch(() => showResult('Copy failed'));
    },
  });
  footer.add(copyBtn.cmp);
  footer.add(createButton({ label: 'Close', onClick: () => closeDraggableWindow(DIALOG_ID) }).cmp);

  return root;
};

/** Opens the About Ækasha dialog: the engine, toolkit and app versions, the package versions, the
 * runtime (renderer, GPU, browser) and physics (backends, thread, transport, SharedArrayBuffer,
 * stepping, bodies), with a button that copies it all as text. */
export const openAboutDialog = () => {
  openDialog({
    id: DIALOG_ID,
    title: 'About Ækasha',
    icon: 'aekasha',
    size: { w: 560, h: 680 },
    isDebugWindow: true,
    backDropClickClosesWindow: true,
    closeOnEscape: true,
    // Built fresh on every open (the runtime rows can change)
    removeOnClose: true,
    content: createDialogContent,
  });
};
