import { removeAnims, runAnims, updateCmpAnim } from './CMPAnim';
import type { TAnimChain, TAttr, TClassAction, TCMP, TProps, TSettings, TStyle } from './CMPTypes';

type SetTimeout = ReturnType<typeof setTimeout>;

let rootCMP: TCMP | null = null;
const cmps: { [key: string]: TCMP } = {};
/** The last generated id's number: a counter, unique for the page's life (an id given in the
 * props that a generated one would take is skipped). */
let lastGeneratedId = 0;

/** An id for a CMP made without one. */
const generateCmpId = () => {
  let id: string;
  do {
    id = `aekCmp_${++lastGeneratedId}`;
  } while (cmps[id]);
  return id;
};
const cmpWrappers: {
  [key: string]: {
    wrapper: (props?: unknown) => TCMP;
    wrapperProps?: unknown;
  };
} = {};
const setWrapper = (id: string, wrapper: (props?: unknown) => TCMP, wrapperProps?: unknown) =>
  (cmpWrappers[id] = { wrapper: wrapper, wrapperProps });
const getWrapper = <WrapP = undefined>(id: string) =>
  cmpWrappers[id] as { wrapper: (props?: WrapP) => TCMP; wrapperProps?: WrapP };
const removeWrapper = (id: string) => {
  if (cmpWrappers[id]) delete cmpWrappers[id];
};

const globalSettings: TSettings = {
  sanitizer: null,
  sanitizeAll: false,
  doCheckIsInDom: false,
  replaceRootDom: true,
};

/**
 * Makes a UI kit component: its element, built from `props`, and its listeners. It's in the DOM
 * once it's added to a CMP that is (`TCMP.add`, or another CMP's `html`); an app's UI goes under the
 * HUD root (`getHUDRootCMP`). A taken id throws, and so does a second root (`attach`).
 * @param props what it's made from (none: an empty div)
 * @param wrapper the component function that made it, which `update()` calls again with
 * `{ ...wrapperProps, ...newProps }` to make it anew (`const Badge = (p) => CMP({ … }, Badge, p)`)
 * @param wrapperProps the props `wrapper` was called with
 * @example
 * ```ts
 * const panel = getHUDRootCMP().add({ class: 'scorePanel' });
 * const score = panel.add({ tag: 'span', text: '0' });
 * panel.add({ tag: 'button', text: 'Reset', onClick: () => score.updateText('0') });
 *
 * // Other CMPs in a template: the html must be a function
 * const star = CMP({ tag: 'span', class: 'star', text: '★' });
 * panel.add(CMP({ html: () => `<h2>${star} High scores</h2>` }));
 * ```
 */
export const CMP = (
  props?: TProps,
  wrapper?: ((props?: never) => TCMP) | ((props: never) => TCMP),
  wrapperProps?: unknown
): TCMP => {
  if (props?.attach && rootCMP) {
    throw new Error('Root node already created');
  }
  if (props?.id && cmps[props.id]) {
    throw new Error(`Id is already in use / taken: ${props.id}`);
  }

  // Its own copy: the update methods write it in place
  props = toOwnProps(props);
  const id = props?.id || generateCmpId();

  // Create cmp object
  const cmp: TCMP = {
    id,
    children: [],
    props,
    elem: null as unknown as HTMLElement,
    parent: null,
    parentElem: null,
    isCmp: true,
    listeners: {},
    timers: {},
    add: (child) => addChildCmp(cmp, child),
    remove: () => removeCmp(cmp),
    removeChildren: () => removeCmpChildren(cmp),
    update: <WrapP extends TProps>(newProps?: TProps | WrapP, callback?: (cmp: TCMP) => void) =>
      updateCmp<WrapP>(cmp, newProps, callback),
    updateClass: (newClass, action) => updateCmpClass(cmp, newClass, action),
    updateAttr: (newAttr) => updateCmpAttr(cmp, newAttr),
    removeAttr: (attrKey) => removeCmpAttr(cmp, attrKey),
    updateStyle: (newStyle: TStyle) => updateCmpStyle(cmp, newStyle),
    updateText: (newText) => updateCmpText(cmp, newText),
    updateAnim: (animChain: TAnimChain[]) => updateCmpAnim(cmp, animChain),
    focus: (focusValueToProps) => focusCmp(cmp, focusValueToProps),
    blur: (focusValueToProps) => blurCmp(cmp, focusValueToProps),
    scrollIntoView: (params, timeout) => scrollCmpIntoView(cmp, params, timeout),
    getWrapperProps: <WrapP>(): WrapP | null => getWrapper<WrapP>(id)?.wrapperProps || null,
    controls: {},
  };

  // Create possible wrapper
  if (wrapper) setWrapper(id, wrapper as (props?: unknown) => TCMP, wrapperProps);

  // Create new element
  const elem = createElem(cmp, props);
  cmp.elem = elem;

  // Create possible listeners
  const listeners = createListeners(cmp, props);
  cmp.listeners = listeners;

  // Check if props have attach and attach to element
  if (props?.attach) {
    if (props?.settings?.sanitizer) globalSettings.sanitizer = props?.settings.sanitizer;
    if (props?.settings?.sanitizeAll) globalSettings.sanitizeAll = props?.settings.sanitizeAll;
    if (props?.settings?.doCheckIsInDom !== undefined)
      globalSettings.doCheckIsInDom = props?.settings.doCheckIsInDom;
    if (props?.settings?.replaceRootDom !== undefined)
      globalSettings.replaceRootDom = props?.settings.replaceRootDom;
    if (globalSettings.replaceRootDom) {
      props.attach.replaceWith(elem);
    } else {
      if (props.prepend) {
        props.attach.prepend(elem);
      } else {
        props.attach.appendChild(elem);
      }
    }
    rootCMP = cmp;
    cmp.parentElem = elem.parentElement;
    cmp.parent = null;
    cmp.isRoot = true;
    runAnims(cmp);
  }

  // Add cmp to list
  cmps[id] = cmp;

  // Check for child <cmp> tags and replace possible tempTemplates
  addTemplateChildCmp(cmp);

  // Overwrite toString method
  cmp.toString = () => getTempTemplate(id);

  return cmp as TCMP;
};

const addChildCmp = (parent: TCMP, child?: TCMP | TProps) => {
  let cmp;
  if (!child) {
    cmp = CMP();
  } else if (!('isCmp' in child)) {
    cmp = CMP(child);
  } else {
    cmp = child;
  }

  parent.children.push(cmp);
  const prepend = cmp.props?.prepend;
  if (prepend) {
    parent.elem.prepend(cmp.elem);
  } else {
    parent.elem.appendChild(cmp.elem);
  }
  cmp.parent = parent;
  cmp.parentElem = parent.elem;
  if (cmp.props?.focus) focusCmp(cmp);
  runAnims(cmp);
  if (cmp.props?.onCreateCmp) cmp.props.onCreateCmp(cmp);
  return cmp;
};

const addTemplateChildCmp = (cmp: TCMP) => {
  let focusComponent: TCMP | null = null;
  const childCmpElems = cmp.elem.querySelectorAll('cmp');
  for (let i = 0; i < childCmpElems.length; i++) {
    const id = childCmpElems[i].getAttribute('id');
    if (id && childCmpElems[i].outerHTML === getTempTemplate(id)) {
      const replaceWithCmp = cmps[id];
      if (!replaceWithCmp) {
        throw new Error(
          `The replaceWithCmp not found in cmps list (parent cmp: ${cmp.id}, replaceWithCmp id: ${id})`
        );
      }
      childCmpElems[i].replaceWith(replaceWithCmp.elem);
      replaceWithCmp.isTemplateCmp = true;
      replaceWithCmp.parent = cmp;
      replaceWithCmp.parentElem = cmp.elem;
      if (replaceWithCmp.props?.focus) focusComponent = replaceWithCmp;
      cmp.children.push(replaceWithCmp);
      runAnims(replaceWithCmp);
      // The template child is mounted in its parent now (the parent's own runs when it is)
      replaceWithCmp.props?.onCreateCmp?.(replaceWithCmp);
    }
  }
  if (focusComponent) setTimeout(() => focusComponent && focusCmp(focusComponent), 0);
};

/** A live CMP by its id (the listeners look their CMP up by it). */
const getCmpById = (id: string): TCMP | null => cmps[id] || null;

const getTempTemplate = (id: string, tag: string = 'cmp') => `<${tag} id="${id}"></${tag}>`;

const createElem = (cmp: TCMP, props?: TProps) => {
  let elem;

  // Elem and content
  if (props?.html) {
    if (typeof props.html === 'string' && props.html.includes('</cmp>')) {
      throw new Error(
        'CMP html prop must be a function definition when it has inline CMPs defined (now it is a string). For example: \n\nconst html = () => `Icon ${Icon()}`;\nconst myComponent = CMP({ html }});\n'
      );
    }
    const template = document.createElement('template');
    const rawHtml = typeof props.html === 'string' ? props.html : props.html(cmp);
    template.innerHTML =
      (props.sanitize || globalSettings.sanitizeAll) && globalSettings.sanitizer
        ? globalSettings.sanitizer(rawHtml)
        : rawHtml;
    elem = template.content.children[0] as HTMLElement;
    // Check if element is a <cmp> element and replace it with the actual CMP,
    // this is achieved when the props have this: { html: () => `CMP({ text: something })` }
    if (elem.outerHTML.startsWith('<cmp')) {
      const cmpId = elem.getAttribute('id');
      if (cmpId) {
        const replaceWithCmp = cmps[cmpId];
        if (replaceWithCmp?.elem) {
          elem = replaceWithCmp.elem;
          cmp.children.push(replaceWithCmp);
          replaceWithCmp.parent = cmp;
        }
      }
    }
    ownProps(cmp).tag = elem.tagName.toLowerCase();
  } else {
    elem = document.createElement(props?.tag ? props.tag : 'div') as HTMLElement;
  }
  if (props?.text) elem.textContent = props?.text;

  const attrKeys = props?.attr ? Object.keys(props.attr) : [];
  const attributes = props?.attr || {};
  for (let i = 0; i < attrKeys.length; i++) {
    const value = attributes[attrKeys[i]];
    elem.setAttribute(attrKeys[i], String(value));
  }
  if (props?.idAttr) elem.setAttribute('id', cmp.id);

  // Classes
  let classes: string[] = [];
  if (props?.class && Array.isArray(props.class)) {
    classes = props.class;
  } else if (props?.class && typeof props?.class === 'string') {
    classes = props.class.split(' ');
  }
  for (let i = 0; i < classes.length; i++) {
    if (classes[i]) elem.classList.add(classes[i].trim());
  }

  // Styles
  if (props?.style) {
    const styleProps = Object.keys(props.style);
    for (let i = 0; i < styleProps.length; i++) {
      if (styleProps[i]) setElemStyle(elem, styleProps[i], props.style[styleProps[i]]);
    }
  }

  return elem;
};

/** The listener props and the event each one listens to (in the capture phase), keyed by it. */
const PROP_LISTENERS = [
  ['onClick', 'click'],
  ['onHover', 'mousemove'],
  ['onHoverOutside', 'mouseleave'],
  ['onFocus', 'focus'],
  ['onBlur', 'blur'],
  ['onInput', 'input'],
  ['onChange', 'change'],
] as const;

const createListeners = (cmp: TCMP, props?: TProps) => {
  // Remove possiple listeners
  removeListeners(cmp, true);
  const listeners = cmp.listeners;

  const cmpId = cmp.id;

  for (let i = 0; i < PROP_LISTENERS.length; i++) {
    const [prop, type] = PROP_LISTENERS[i];
    const listener = props?.[prop];
    if (listener) {
      const fn = (e: Event) => {
        const activeCmp = getCmpById(cmpId);
        if (activeCmp) listener(e, cmp);
      };
      listeners[type] = { fn, type };
      cmp.elem.addEventListener(type, fn, true);
    } else if (type in listeners) {
      delete listeners[type];
    }
  }
  // Add "outsideClick" listener
  createOutsideClickListener(cmp);
  if (props?.listeners) {
    // Add custom listeners
    for (let i = 0; i < props.listeners.length; i++) {
      const listenerFn = props.listeners[i].fn;
      if (!listenerFn) continue;
      const fn = (e: Event) => {
        const activeCmp = getCmpById(cmpId);
        if (activeCmp) listenerFn(e, cmp);
      };
      const type = props.listeners[i].type;
      // Capture by default, like the prop listeners; the options can change it
      const options = { capture: true, ...props.listeners[i].options };
      // Keyed apart from the prop listeners and each other: one type can have several
      listeners[`${type}#${i}`] = { fn, type, options };
      cmp.elem.addEventListener(type, fn, options);
    }
  }
  return listeners;
};

const removeListeners = (cmp: TCMP, nullify?: boolean) => {
  const listeners = cmp.listeners;
  const keys = Object.keys(listeners);

  // Remove possiple listeners
  for (let i = 0; i < keys.length; i++) {
    const listener = listeners[keys[i]];
    if (listener?.fn) {
      cmp.elem.removeEventListener(listener.type, listener.fn, {
        capture: listener.options?.capture ?? true,
      });
      if (nullify) listeners[keys[i]] = null;
    }
  }

  if (cmp.props?.onClickOutside) removeOutsideClickListener(cmp);
};

const removeCmp = (cmp: TCMP, doNotRemoveElem?: boolean) => {
  const id = cmp.id;

  // Remove children CMPs
  removeCmpChildren(cmp);

  // Remove reference from parent
  if (cmp.parent?.children.length) {
    cmp.parent.children = cmp.parent.children.filter((child) => child.id !== id);
  }

  // Remove possible wrapper
  removeWrapper(cmp.id);

  removeListeners(cmp, true);

  // Remove elem from dom and cmps
  removeAnims(cmp);
  if (!doNotRemoveElem) {
    cmp.elem.remove();
  }

  const originalProps = cmp.props;
  if (originalProps?.onRemoveCmp) originalProps.onRemoveCmp(cmp);

  delete cmps[cmp.id];

  // Clear every internal property to ensure GC can claim them independently
  cmp.props = undefined;
  cmp.children = [];
  cmp.parent = null;
  cmp.parentElem = null;
  cmp.listeners = {};
  cmp.timers = {};

  return cmp;
};

const removeCmpChildren = (cmp: TCMP) => {
  const children = cmp.children;
  for (let i = 0; i < children.length; i++) {
    children[i].remove();
  }
  return cmp;
};

const updateCmp = <WrapP extends TProps>(
  cmp: TCMP,
  newProps?: TProps | WrapP,
  callback?: (cmp: TCMP) => void
) => {
  const wrapper = getWrapper<WrapP>(cmp.id);
  if (wrapper) {
    // Wrapper component type
    const template = document.createElement('template');
    template.innerHTML = getTempTemplate(cmp.id, 'cmpw');
    const tempElem = template.content.children[0] as HTMLElement;
    removeListeners(cmp, true);
    cmp.elem.replaceWith(tempElem);
    if (cmp.props?.attach) rootCMP = null;
    const wrapperProps = wrapper.wrapperProps && {
      ...wrapper.wrapperProps,
      ...newProps,
    };
    setWrapper(cmp.id, wrapper.wrapper as (props?: unknown) => TCMP, wrapperProps);
    cmp.removeChildren();
    delete cmps[cmp.id];
    const newCmp = wrapper.wrapper(wrapperProps);
    replaceCmpWithAnother(cmp, newCmp);
    if (cmp.props?.attach) rootCMP = cmp;
    tempElem.replaceWith(cmp.elem);
  } else {
    // Added or template component type
    removeListeners(cmp, true);
    cmp.props = { ...cmp.props, ...toOwnProps(newProps) };
    const elem = createElem(cmp, cmp.props);
    cmp.elem.replaceWith(elem);
    cmp.elem = elem;
    // Remove old templateCmp children and added children
    const keepAddedChildren = [];

    const currentChildren = [...cmp.children];
    for (let i = 0; i < currentChildren.length; i++) {
      const child = currentChildren[i];
      if (!child.isTemplateCmp) {
        // DETACH instead of REMOVE
        // This preserves the object and its .elem for re-use
        child.elem.remove();
        child.parent = null;
        child.parentElem = null;
        keepAddedChildren.push(child);
      } else {
        child.remove();
      }
    }

    // Clear the array and re-add the migrated children
    cmp.children = [];
    for (let i = 0; i < keepAddedChildren.length; i++) {
      cmp.add(keepAddedChildren[i]);
    }
  }
  const listeners = createListeners(cmp, cmp.props);
  cmp.listeners = listeners;
  if (cmp.props?.focus) focusCmp(cmp);
  addTemplateChildCmp(cmp);
  runAnims(cmp);
  if (cmp.props?.onCreateCmp) cmp.props.onCreateCmp(cmp);
  if (callback) callback(cmp);
  return cmp;
};

const updateCmpClass = (
  cmp: TCMP,
  newClass: string | string[],
  action: TClassAction = 'replace'
) => {
  let classes: string[] = [];
  let oldClasses: string[] = [];
  if (Array.isArray(newClass)) {
    classes = newClass;
  } else if (newClass) {
    classes = newClass.split(' ');
  }
  if (cmp.props?.class && Array.isArray(cmp.props.class)) {
    oldClasses = cmp.props.class;
  } else if (typeof cmp.props?.class === 'string') {
    oldClasses = cmp.props.class.split(' ');
  }
  if (action === 'remove') {
    // Remove
    for (let i = 0; i < classes.length; i++) {
      oldClasses = oldClasses.filter((c) => c !== classes[i].trim());
      cmp.elem.classList.remove(classes[i].trim());
    }
    ownProps(cmp).class = oldClasses.join(' ').trim().split(' ');
  } else if (action === 'toggle') {
    // Toggle
    for (let i = 0; i < classes.length; i++) {
      oldClasses = oldClasses.filter((c) => c !== classes[i].trim());
      if (cmp.elem.classList.contains(classes[i])) {
        cmp.elem.classList.remove(classes[i].trim());
        continue;
      }
      cmp.elem.classList.add(classes[i].trim());
      oldClasses.push(classes[i].trim());
    }
    ownProps(cmp).class = oldClasses.join(' ').trim().split(' ');
  } else {
    if (action === 'replace') {
      // Replace
      cmp.elem.removeAttribute('class');
      ownProps(cmp).class = classes;
    } else {
      // Add
      const addedClass = `${oldClasses.join(' ').trim()} ${classes.join(' ')}`.trim();
      ownProps(cmp).class = addedClass.split(' ');
    }
    for (let i = 0; i < classes.length; i++) {
      cmp.elem.classList.add(classes[i].trim());
    }
  }

  return cmp;
};

const updateCmpAttr = (cmp: TCMP, newAttr: TAttr) => {
  const attrKeys = Object.keys(newAttr);
  // Recorded, so an update() rebuilds the element with them
  const attr = (ownProps(cmp).attr ??= {});
  for (let i = 0; i < attrKeys.length; i++) {
    const value = String(newAttr[attrKeys[i]]);
    cmp.elem.setAttribute(attrKeys[i], value);
    attr[attrKeys[i]] = value;
  }

  return cmp;
};

const removeCmpAttr = (cmp: TCMP, attrKey: string | string[]) => {
  let attributeKeys: string | string[] = [];
  const attrProps = cmp.props?.attr;
  if (Array.isArray(attrKey)) {
    attributeKeys = attrKey;
  } else if (typeof attrKey === 'string') {
    attributeKeys.push(attrKey);
  }
  for (let i = 0; i < attributeKeys.length; i++) {
    cmp.elem.removeAttribute(attributeKeys[i]);
    if (attrProps) delete attrProps[attributeKeys[i]];
  }

  return cmp;
};

/** Sets one inline style, or removes it (null). A custom property (`--x`) or a kebab-case name
 * goes through setProperty: the indexed form (`style['--x']`) ignores it. */
const setElemStyle = (elem: HTMLElement, prop: string, value: string | number | null) => {
  if (prop.includes('-')) {
    if (value === null) elem.style.removeProperty(prop);
    else elem.style.setProperty(prop, String(value));
    return;
  }
  elem.style[prop as unknown as number] = value === null ? '' : String(value);
};

const updateCmpStyle = (cmp: TCMP, newStyle: TStyle) => {
  const styleProps = Object.keys(newStyle);
  for (let i = 0; i < styleProps.length; i++) {
    const prop = styleProps[i];
    const value = newStyle[styleProps[i]];
    if (!prop) continue;
    setElemStyle(cmp.elem, prop, value);
    if (value !== null) {
      (ownProps(cmp).style ??= {})[prop] = String(value);
    } else if (cmp.props?.style) {
      delete cmp.props.style[prop];
    }
  }

  return cmp;
};

const updateCmpText = (cmp: TCMP, newText: string) => {
  if (!cmp.props?.text && typeof cmp.props?.text !== 'string') {
    throw new Error(
      'Cannot update text, CMP is not a text CMP. To change this to a text CMP, use the "cmp.update({ text })" function instead.'
    );
  }
  cmp.elem.textContent = newText;
  ownProps(cmp).text = newText;

  return cmp;
};

const focusCmp = (cmp: TCMP, focusValueToProps?: boolean) => {
  cmp.elem.focus();
  // The caret at the end, in an input that has a selection (a number, checkbox or range input
  // has none: its setSelectionRange throws)
  const input = cmp.elem;
  if (input instanceof HTMLInputElement && typeof input.selectionStart === 'number') {
    input.setSelectionRange(input.value.length, input.value.length);
  }
  if (focusValueToProps !== undefined) {
    ownProps(cmp).focus = focusValueToProps;
  }
  return cmp;
};

const blurCmp = (cmp: TCMP, focusValueToProps?: boolean) => {
  cmp.elem.blur();
  if (focusValueToProps !== undefined) {
    ownProps(cmp).focus = focusValueToProps;
  }
  return cmp;
};

const scrollCmpIntoView = (
  cmp: TCMP,
  params?: boolean | ScrollIntoViewOptions,
  timeout?: number
) => {
  if (timeout !== undefined) {
    if (cmp.timers.scrollIntoView)
      clearTimeout(cmp.timers.scrollIntoView.fn as SetTimeout | undefined);
    const timer = setTimeout(() => {
      cmp.elem.scrollIntoView(params);
      if (cmp.timers.scrollIntoView)
        clearTimeout(cmp.timers.scrollIntoView.fn as SetTimeout | undefined);
    }, timeout);
    cmp.timers.scrollIntoView = { fn: timer };
  } else {
    cmp.elem.scrollIntoView(params);
  }
  return cmp;
};

const checkMatchingParent = (elemToCheck: HTMLElement | null, elemTarget: HTMLElement): boolean => {
  if (!elemToCheck) return false;
  if (elemToCheck === elemTarget) return true;
  return checkMatchingParent(elemToCheck.parentElement, elemTarget);
};

const onClickOutsideListener: {
  count: number;
  fns: { [key: string]: { fn: (e: Event) => void; elem: HTMLElement } };
  mainFn: (e: Event) => void;
} = {
  count: 0,
  fns: {},
  mainFn: (e: Event) => {
    const clickedElem = e.target as HTMLElement;
    const fnsKeys = Object.keys(onClickOutsideListener.fns);
    for (let i = 0; i < fnsKeys.length; i++) {
      const listener = onClickOutsideListener.fns[fnsKeys[i]];
      if (!checkMatchingParent(clickedElem, listener.elem)) listener.fn(e);
    }
  },
};

const createOutsideClickListener = (cmp: TCMP) => {
  if (!cmp.props?.onClickOutside) {
    removeOutsideClickListener(cmp);
    return;
  }
  if (onClickOutsideListener.count === 0) {
    document.removeEventListener('click', onClickOutsideListener.mainFn);
    document.addEventListener('click', onClickOutsideListener.mainFn);
  }
  const onClickOutside = cmp.props.onClickOutside;
  onClickOutsideListener.fns[cmp.id] = { fn: (e: Event) => onClickOutside(e, cmp), elem: cmp.elem };
  onClickOutsideListener.count += 1;
};

const removeOutsideClickListener = (cmp: TCMP) => {
  if (!onClickOutsideListener.fns[cmp.id]) return;
  if (onClickOutsideListener.count === 1) {
    document.removeEventListener('click', onClickOutsideListener.mainFn);
  }
  delete onClickOutsideListener.fns[cmp.id];
  onClickOutsideListener.count -= 1;
};

/** A copy of the props a CMP is given (`style` and `attr` too), so its in-place writes never reach
 * the caller's objects (eg. a style constant several CMPs share). Made once per create or update. */
const toOwnProps = <P extends TProps | undefined>(props: P): P =>
  (props && {
    ...props,
    ...(props.style ? { style: { ...props.style } } : {}),
    ...(props.attr ? { attr: { ...props.attr } } : {}),
  }) as P;

/** The CMP's own props (made when it has none), which the update methods write in place: an app
 * HUD that updates a text or a style every frame makes no object for it. */
const ownProps = (cmp: TCMP): TProps => (cmp.props ??= {});

const replaceCmpWithAnother = (oldCmp: TCMP, newCmp: TCMP) => {
  const id = oldCmp.id;

  // Props
  const attach = oldCmp.props?.attach;
  const settings = oldCmp.props?.settings;
  oldCmp.props = newCmp.props;
  if (oldCmp.props?.id) oldCmp.props.id = id;
  if (attach && oldCmp.props?.attach) oldCmp.props.attach = attach;
  if (settings && oldCmp.props?.settings) oldCmp.props.settings = settings;

  // Do not reference the parent, parentElem or the functions,
  // reference everything else.
  oldCmp.id = id;
  oldCmp.elem = newCmp.elem;
  oldCmp.children = newCmp.children;
  oldCmp.listeners = newCmp.listeners;
  oldCmp.timers = newCmp.timers;

  // Set the replaced cmp back to cache
  cmps[id] = oldCmp;
};

/**
 * Joins class names and lists into one list, skipping the empty ones, eg. for a `class` prop:
 * `classes('btn', isActive ? 'active' : null, extraClasses)`.
 */
export const classes = (...classArgs: (string | string[] | undefined | null)[]) => {
  let classes: string[] = [];
  for (let i = 0; i < classArgs.length; i++) {
    const c = classArgs[i];
    if (!c) continue;
    if (typeof c === 'string') {
      classes.push(c);
      continue;
    }
    classes = [...classes, ...c];
  }
  return classes;
};
