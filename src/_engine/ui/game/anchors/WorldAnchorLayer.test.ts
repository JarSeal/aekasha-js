import { beforeAll, describe, expect, it } from 'vitest';
import { countListeners, stubKitDomAsync } from '../../testing/KitDom';
import { CMP } from '../../core/CMP';
import { createWorldAnchorLayer } from './WorldAnchorLayer';
import type { WorldAnchorView } from './AnchorProjection';

/** A 90° camera at the origin looking down -z on a 100 px square: a point at z = -10 lands at
 * (50 + 5x, 50 - 5y) */
const createView = (): WorldAnchorView => {
  const e = new Float64Array(16);
  e[0] = 1;
  e[5] = 1;
  e[10] = -1;
  e[11] = -1;
  e[14] = -0.2;
  return { viewProjection: e, width: 100, height: 100, cameraPosition: { x: 0, y: 0, z: 0 } };
};

const part = (elem: Element, name: string) =>
  elem.querySelector(`.aekWorldAnchor__${name}`) as HTMLElement;

beforeAll(async () => {
  await stubKitDomAsync();
});

describe('world anchor layer (p808 D7)', () => {
  it('is a layer of anchors, each hidden until it has a position', () => {
    const layer = createWorldAnchorLayer();
    const elem = layer.cmp.elem;
    expect(elem.className).toBe('aekWorldAnchorLayer');
    expect(elem.getAttribute('data-placement')).toBe('hud');
    const anchor = layer.addAnchor({ content: 'Mara', align: 'above' });
    expect(anchor.cmp.elem.parentElement).toBe(elem);
    expect(anchor.cmp.elem.getAttribute('data-align')).toBe('above');
    expect(part(anchor.cmp.elem, 'body').textContent).toBe('Mara');
    expect(part(anchor.cmp.elem, 'arrow').getAttribute('aria-hidden')).toBe('true');
    layer.update(createView());
    expect(anchor.getState()).toBe('hidden');
    expect(anchor.cmp.elem.getAttribute('data-state')).toBe('hidden');
    expect(layer.getAnchorCount()).toBe(1);
    layer.cmp.remove();
  });

  it('moves an anchor to its projected point with its offset, rounded', () => {
    const layer = createWorldAnchorLayer({ placement: 'inline' });
    expect(layer.cmp.elem.getAttribute('data-placement')).toBe('inline');
    const anchor = layer.addAnchor({ offset: { x: 0, y: -4 }, position: { x: 2, y: 1, z: -10 } });
    const elem = anchor.cmp.elem;
    layer.update(createView());
    expect(anchor.getState()).toBe('shown');
    expect(elem.getAttribute('data-state')).toBe('shown');
    expect(elem.style.transform).toBe('translate3d(60px, 41px, 0)');
    expect(anchor.getDistance()).toBeCloseTo(Math.sqrt(105));
    anchor.setPosition(2.04, 1, -10);
    layer.update(createView());
    expect(elem.style.transform).toBe('translate3d(60px, 41px, 0)');
    layer.cmp.remove();
  });

  it('writes nothing when the rounded position and the state are unchanged', () => {
    const layer = createWorldAnchorLayer();
    const anchor = layer.addAnchor({ position: { x: 0, y: 0, z: -10 } });
    const elem = anchor.cmp.elem;
    const view = createView();
    layer.update(view);
    elem.style.transform = 'marked';
    elem.setAttribute('data-state', 'marked');
    anchor.setPosition(0.01, 0, -10);
    layer.update(view);
    expect(elem.style.transform).toBe('marked');
    expect(elem.getAttribute('data-state')).toBe('marked');
    // A move of a pixel writes it
    anchor.setPosition(0.2, 0, -10);
    layer.update(view);
    expect(elem.style.transform).toBe('translate3d(51px, 50px, 0)');
    layer.cmp.remove();
  });

  it('hides an anchor behind the camera, off the screen or past its distance', () => {
    const layer = createWorldAnchorLayer({ cullDistance: 20 });
    const behind = layer.addAnchor({ position: { x: 0, y: 0, z: 5 } });
    const off = layer.addAnchor({ position: { x: 30, y: 0, z: -10 } });
    const far = layer.addAnchor({ position: { x: 0, y: 0, z: -30 } });
    const farOwn = layer.addAnchor({ position: { x: 0, y: 0, z: -30 }, maxDistance: Infinity });
    layer.update(createView());
    expect(behind.getState()).toBe('hidden');
    expect(off.getState()).toBe('hidden');
    expect(far.getState()).toBe('hidden');
    // Its distance is still measured (a waypoint's text)
    expect(far.getDistance()).toBe(30);
    expect(farOwn.getState()).toBe('shown');
    layer.cmp.remove();
  });

  it('clamps an off-screen anchor to the padded edge with its arrow turned to it', () => {
    const layer = createWorldAnchorLayer({ edgePadding: 10 });
    const waypoint = layer.addAnchor({
      position: { x: 30, y: 0, z: -10 },
      offScreen: 'clamp',
      offset: { x: 0, y: -20 },
    });
    const elem = waypoint.cmp.elem;
    layer.update(createView());
    expect(waypoint.getState()).toBe('clamped');
    expect(elem.getAttribute('data-state')).toBe('clamped');
    // The offset isn't applied while clamped
    expect(elem.style.transform).toBe('translate3d(90px, 50px, 0)');
    expect(elem.style.getPropertyValue('--aek-world-anchor-angle')).toBe('0deg');
    // Behind the camera, to the left
    waypoint.setPosition(-3, 0, 10);
    layer.update(createView());
    expect(elem.style.transform).toBe('translate3d(10px, 50px, 0)');
    expect(elem.style.getPropertyValue('--aek-world-anchor-angle')).toBe('180deg');
    layer.cmp.remove();
  });

  it('hides an anchor the app hides whatever the camera sees', () => {
    const layer = createWorldAnchorLayer();
    const anchor = layer.addAnchor({ position: { x: 0, y: 0, z: -10 } });
    layer.update(createView());
    anchor.setVisible(false);
    expect(anchor.getState()).toBe('hidden');
    layer.update(createView());
    expect(anchor.getState()).toBe('hidden');
    anchor.setVisible(true);
    layer.update(createView());
    expect(anchor.getState()).toBe('shown');
    layer.cmp.remove();
  });

  it('replaces its content, removing a CMP shown before', () => {
    const layer = createWorldAnchorLayer();
    const content = CMP({ class: 'plate', text: 'Guard' });
    const anchor = layer.addAnchor({ content });
    const body = part(anchor.cmp.elem, 'body');
    expect(body.firstElementChild).toBe(content.elem);
    const other = CMP({ text: 'Captain' });
    anchor.setContent(other);
    expect(content.elem.isConnected).toBe(false);
    expect(body.firstElementChild).toBe(other.elem);
    anchor.setContent('Mara');
    expect(body.textContent).toBe('Mara');
    expect(body.children).toHaveLength(0);
    anchor.setContent(null);
    expect(body.textContent).toBe('');
    layer.cmp.remove();
  });

  it('gives nearer anchors a higher z-index with depthSort, written only on a change', () => {
    const layer = createWorldAnchorLayer({ depthSort: true });
    const near = layer.addAnchor({ position: { x: 0, y: 0, z: -5 } });
    const far = layer.addAnchor({ position: { x: 0, y: 0, z: -15 } });
    const hidden = layer.addAnchor();
    const view = createView();
    layer.update(view);
    expect(near.cmp.elem.style.zIndex).toBe('3');
    expect(far.cmp.elem.style.zIndex).toBe('2');
    expect(hidden.cmp.elem.style.zIndex).toBe('1');
    near.cmp.elem.style.zIndex = 'marked';
    layer.update(view);
    expect(near.cmp.elem.style.zIndex).toBe('marked');
    // They pass each other
    near.setPosition(0, 0, -20);
    layer.update(view);
    expect(near.cmp.elem.style.zIndex).toBe('2');
    expect(far.cmp.elem.style.zIndex).toBe('3');
    // Without it, none is written
    const plain = createWorldAnchorLayer();
    const anchor = plain.addAnchor({ position: { x: 0, y: 0, z: -5 } });
    plain.update(view);
    expect(anchor.cmp.elem.style.zIndex).toBe('');
    plain.cmp.remove();
    layer.cmp.remove();
  });

  it('forgets an anchor removed either way, and every anchor on clear and removal', () => {
    const layer = createWorldAnchorLayer({ depthSort: true });
    const a = layer.addAnchor({ position: { x: 0, y: 0, z: -10 } });
    const b = layer.addAnchor({ position: { x: 0, y: 0, z: -10 } });
    layer.addAnchor();
    a.remove();
    b.cmp.remove();
    expect(layer.getAnchorCount()).toBe(1);
    expect(layer.cmp.elem.children).toHaveLength(1);
    layer.update(createView());
    layer.clear();
    expect(layer.getAnchorCount()).toBe(0);
    expect(layer.cmp.elem.children).toHaveLength(0);
    layer.addAnchor({ position: { x: 0, y: 0, z: -10 } });
    layer.cmp.remove();
    expect(layer.getAnchorCount()).toBe(0);
    expect(countListeners(layer.cmp.elem)).toBe(0);
    // An update after the removal does nothing
    layer.update(createView());
  });
});
