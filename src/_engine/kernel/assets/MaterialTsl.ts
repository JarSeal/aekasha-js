// The TSL path of createMaterial (Material.ts): a node material's graph functions, from a TSL file
// (a material JSON's `tslFile`, loaded on demand, p607 D11) or registered from code
// (registerTslMaterial, p302 D3), and the material's inputs made into the uniforms and texture
// nodes those functions get. A `setup` function builds any sockets from one graph with the
// material's `inputs`; each `nodes` socket's function builds that socket from its own (p302 D2).
// An input value a registered resolver matches is its node or bundle (MaterialInputResolvers.ts,
// p302 D4); the built-in rules here make the rest.
import * as THREE from 'three/webgpu';
import { color, texture, uniform } from 'three/tsl';
import { getTexture } from './Texture';
import { type MaterialInputContext, resolveRegisteredInput } from './MaterialInputResolvers';
import { getAppData } from '../scene/AppData';
import { lerror, lwarn } from '../../utils/Logger';
import { IS_DEBUG_ENV } from '../config/Config';

/**
 * What a TSL material's functions get as `inputs`: each input of the material (`inputs` for
 * `setup`, a socket's under `nodes` for that socket's function) by its key, as a TSL node: a
 * texture id as a texture node, any other value as a uniform, and a value a registered resolver
 * matches as its node or its bundle (an object of nodes; `registerMaterialInputResolver`). A
 * function types its own inputs by key (`{ albedo: TextureNode; scale: Node<'float'> }`): three's
 * node types differ by value type.
 */
export type TslInputs = Record<string, unknown>;

// Each type is a method's (`{ fn(…) }['fn']`): a method's parameters are bivariant, so a function
// typing its inputs by key is one of them. Written out in both, not through a shared helper type,
// which no entry exports and the public names would then name.

/**
 * A TSL material's `setup` function: sets any of the material's sockets (`material.colorNode`,
 * `material.normalNode`, …) from one graph, so the work they share (coordinates, blend weights,
 * texture samples) is built once. It runs before the `nodes` sockets' functions, which may set a
 * socket again. Its `inputs` are the material's `inputs`, its `staticDefines` the material's.
 */
export type TslSetupFn = {
  fn(inputs: TslInputs, material: THREE.NodeMaterial, staticDefines: Record<string, unknown>): void;
}['fn'];

/**
 * A TSL material's socket function (exported under the socket's name, `colorNode`, …): returns
 * that socket's node, built from the socket's own inputs under the material's `nodes`, which
 * `createMaterial` sets on the socket.
 */
export type TslSocketFn = {
  fn(
    inputs: TslInputs,
    material: THREE.NodeMaterial,
    staticDefines: Record<string, unknown>
  ): unknown;
}['fn'];

/**
 * A TSL material's functions, as {@link registerTslMaterial} takes them and a TSL file exports
 * them: an optional `setup` and a function per socket.
 */
export type TslMaterialFns = {
  /** Sets any sockets from one graph with the material's `inputs` (see {@link TslSetupFn}). */
  setup?: TslSetupFn;
  /** A socket's function (`colorNode`, …), with that socket's `nodes` inputs. */
  [socket: string]: TslSocketFn | TslSetupFn | undefined;
};

/** The props of the TSL path: a node material's (MatProps' node members) */
type TslGraphProps = {
  id?: string;
  tslFile?: string;
  tslMaterialId?: string;
  nodes?: Record<string, Record<string, unknown>>;
  inputs?: Record<string, unknown>;
  staticDefines?: Record<string, unknown>;
};

/** The TSL material files loaded so far, by material id (see loadTslMaterialFileAsync) */
const loadedTslMaterialFiles = new Map<string, Record<string, unknown>>();

/** The TSL materials registered from code, by id (see registerTslMaterial) */
const registeredTslMaterials = new Map<string, TslMaterialFns>();

// A TSL texture input whose id isn't registered samples this: one white texel, made on the first
// one, shared and never disposed (it isn't registered, so no release reaches it)
let missingTexture: THREE.DataTexture | null = null;
const getMissingTexture = () => {
  if (!missingTexture) {
    missingTexture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    missingTexture.name = 'aekMissingTexture';
    missingTexture.needsUpdate = true;
  }
  return missingTexture;
};

/**
 * Loads a material's TSL file (its material JSON's `tslFile`) so `createMaterial` can build it:
 * the gathered data loads these files on demand (p607 D11). A scene load does it for the scene's
 * materials; code that creates such a material at another time awaits this first. A file loads
 * once. A production build has the files of the materials its scenes list (a development one has
 * all). A TSL material registered from code ({@link registerTslMaterial}) needs no load.
 * @param materialId the material JSON's id
 * @returns false when the app's data has no TSL file for this id
 * @example
 * ```ts
 * import { createMaterial, loadTslMaterialFileAsync } from 'aekasha';
 *
 * // A grid of its own, from the toolkit's triplanarGrid material file
 * if (await loadTslMaterialFileAsync('triplanarGrid')) {
 *   createMaterial({
 *     id: 'wideGrid',
 *     tslMaterialId: 'triplanarGrid',
 *     type: 'STANDARDNODEMATERIAL',
 *     tslFile: 'materials/triplanarGrid.tsl.ts',
 *     staticDefines: { minorLines: false },
 *     nodes: {
 *       colorNode: {
 *         lineThickness: 0.05,
 *         lineFrequency: 0.25,
 *         lineColor: '#4fc3f7',
 *         backgroundColor: '#202020',
 *       },
 *     },
 *   });
 * }
 * ```
 */
export const loadTslMaterialFileAsync = async (materialId: string) => {
  if (loadedTslMaterialFiles.has(materialId)) return true;
  const load = getAppData().tslMaterialFiles[materialId];
  if (!load) return false;
  const exports = await load();
  loadedTslMaterialFiles.set(materialId, exports);
  return true;
};

/** Whether two registrations hold the same functions under the same keys */
const isSameTslMaterialFns = (a: TslMaterialFns, b: TslMaterialFns) => {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
};

/**
 * Registers a TSL material's functions from code under an id, so `createMaterial` builds a
 * material from them as from a TSL file: `tslMaterialId` names the id, and no file loads. The
 * material gets variants, ownership, release and the material editor like a JSON one. Register on
 * the first call of the code that creates the material, never at its module's load (a top-level
 * registration would keep the graph in every build importing the module). A registered id is
 * looked up before the TSL files. An id registered again with the same functions does nothing;
 * with other functions the first stay (the debug env warns), as a texture id does.
 * @param id the id `createMaterial`'s `tslMaterialId` names (namespace it: `'myGame.stripes'`)
 * @param fns the `setup` function and the socket functions
 * @example
 * ```ts
 * import { createMaterial, registerTslMaterial, type TslMaterialFns } from 'aekasha';
 * import { float, mix, positionWorld, step } from 'three/tsl';
 * import type { Node } from 'three/webgpu';
 *
 * type StripesInputs = { frequency: Node<'float'>; colorA: Node<'color'>; colorB: Node<'color'> };
 *
 * // At the module's top level: functions only, nothing registered
 * const stripesFns = {
 *   // Three sockets from one stripe pattern, built once
 *   setup: (inputs: StripesInputs, material) => {
 *     const stripe = step(0.5, positionWorld.y.mul(inputs.frequency).fract());
 *     material.colorNode = mix(inputs.colorA, inputs.colorB, stripe);
 *     material.roughnessNode = mix(float(0.3), float(0.9), stripe);
 *     material.metalnessNode = stripe.oneMinus();
 *   },
 * } satisfies TslMaterialFns;
 *
 * export const createStripesMaterial = (id: string) => {
 *   registerTslMaterial('myGame.stripes', stripesFns);
 *   return createMaterial({
 *     id,
 *     type: 'STANDARDNODEMATERIAL',
 *     tslMaterialId: 'myGame.stripes',
 *     inputs: { frequency: 4, colorA: '#f0f0f0', colorB: '#202830' },
 *   });
 * };
 * ```
 */
export const registerTslMaterial = (id: string, fns: TslMaterialFns) => {
  const registered = registeredTslMaterials.get(id);
  if (!registered) {
    registeredTslMaterials.set(id, fns);
    return;
  }
  if (IS_DEBUG_ENV && !isSameTslMaterialFns(registered, fns)) {
    lwarn(
      `registerTslMaterial: "${id}" is registered already with other functions, which stay (register these under another id).`
    );
  }
};

const throwTslError = (msg: string): never => {
  lerror(msg);
  throw new Error(msg);
};

/** The material's TSL functions: the registered ones, else its loaded file's (null for a material
 * without either) */
const getTslMaterialFns = (props: TslGraphProps): Record<string, unknown> | null => {
  const tslMaterialId = props.tslMaterialId || props.id || '';
  const registered = registeredTslMaterials.get(tslMaterialId);
  if (registered) return registered;
  if (!props.tslFile) return null;
  const loaded = loadedTslMaterialFiles.get(tslMaterialId);
  if (loaded) return loaded;
  return throwTslError(
    getAppData().tslMaterialFiles[tslMaterialId]
      ? `The TSL file of material "${tslMaterialId}" isn't loaded: a scene load loads its materials' files, other code awaits loadTslMaterialFileAsync("${tslMaterialId}") before createMaterial.`
      : `Material "${props.id}" names TSL functions "${tslMaterialId}" that no TSL file (a *.material.json's tslFile) and no registerTslMaterial call has.`
  );
};

/** A TSL texture input's texture: the registered one, else one white texel (warned) */
const getInputTexture = (textureId: string, where: string, id: string | undefined) => {
  const texResource = getTexture(textureId);
  if (texResource) return texResource;
  lwarn(
    `Could not locate texture resource for ${where} in material "${id}" with value "${textureId}": it samples one white texel.`
  );
  // A sampler still, so the TSL function gets the node type it expects
  return getMissingTexture();
};

/**
 * One TSL input as its node by the built-in rules: a texture id as a texture node (one white
 * texel when it isn't registered, warned), a `#rrggbb` colour, a boolean, a number, a 2-4 array or
 * a `{ x, y(, z, w) }` or `{ r, g, b(, a) }` object as a uniform. Throws for anything else.
 */
const createTslInputNode = (value: unknown, where: string, id: string | undefined) => {
  if (typeof value === 'string') {
    if (value.startsWith('#')) return uniform(color(value));
    // A sampler node, not a uniform buffer allocation
    return texture(getInputTexture(value, where, id));
  }
  if (typeof value === 'boolean') return uniform(value);
  if (typeof value === 'number') return uniform(value);
  if (Array.isArray(value)) {
    const v = value as number[];
    if (v.length === 4) return uniform(new THREE.Vector4(v[0], v[1], v[2], v[3]));
    if (v.length === 3) return uniform(new THREE.Vector3(v[0], v[1], v[2]));
    if (v.length === 2) return uniform(new THREE.Vector2(v[0], v[1]));
    return throwTslError(
      `Unsupported array length (${value.length}) for ${where} in material "${id}".`
    );
  }
  if (typeof value === 'object' && value !== null) {
    const obj = value as Record<string, number>;
    if ('w' in obj) {
      return uniform(new THREE.Vector4(obj.x || 0, obj.y || 0, obj.z || 0, obj.w || 0));
    }
    if ('z' in obj) return uniform(new THREE.Vector3(obj.x || 0, obj.y || 0, obj.z || 0));
    if ('y' in obj) return uniform(new THREE.Vector2(obj.x || 0, obj.y || 0));
    if ('r' in obj && 'g' in obj && 'b' in obj) {
      return 'a' in obj
        ? uniform(new THREE.Vector4(obj.r, obj.g, obj.b, obj.a))
        : uniform(new THREE.Color(obj.r, obj.g, obj.b));
    }
    return throwTslError(
      `Unknown object footprint for ${where} in material "${id}". Keys: ${Object.keys(obj).join(', ')}`
    );
  }
  return throwTslError(
    `Unsupported input value type for ${where} in material entry ID: "${id}". Value: ${JSON.stringify(value)}.`
  );
};

/**
 * A set of TSL inputs (the material's `inputs`, or a socket's under `nodes`) as the nodes its
 * function gets, and the static defines it gets: the material's, with an input named
 * `staticDefines` merged over them. A value a registered resolver matches is its node or bundle,
 * any other is made by the built-in rules. Each node is kept at `uniforms[<prefix>_<key>]`, each of
 * a bundle at `uniforms[<prefix>_<key>_<field>]` (where the material editor and runtime code find
 * them).
 */
const createTslInputs = (
  rawInputs: Record<string, unknown>,
  prefix: string,
  staticDefines: Record<string, unknown>,
  mat: THREE.NodeMaterial,
  id: string | undefined
) => {
  const uniforms = mat.userData.uniforms as Record<string, unknown>;
  const inputs: TslInputs = {};
  let defines = staticDefines;
  for (const key of Object.keys(rawInputs)) {
    const value = rawInputs[key];
    if (key === 'staticDefines' && typeof value === 'object' && value !== null) {
      defines = { ...staticDefines, ...(value as Record<string, unknown>) };
      continue;
    }
    const where = prefix === 'setup' ? `input "${key}"` : `socket "${prefix}" input "${key}"`;
    const ctx: MaterialInputContext = {
      materialId: id,
      group: prefix,
      key,
      material: mat,
      getTexture: (textureId) => getInputTexture(textureId, where, id),
    };
    const resolved = resolveRegisteredInput(value, ctx);
    if (resolved?.bundle) {
      for (const field of Object.keys(resolved.bundle)) {
        uniforms[`${prefix}_${key}_${field}`] = resolved.bundle[field];
      }
      inputs[key] = resolved.bundle;
      continue;
    }
    const node = resolved ? resolved.node : createTslInputNode(value, where, id);
    uniforms[`${prefix}_${key}`] = node;
    inputs[key] = node;
  }
  return { inputs, defines };
};

/** A TSL export as a function, or a thrown error for one that isn't (a file's empty export) */
const asTslGraphFn = (fn: unknown, name: string, id: string | undefined) => {
  if (typeof fn !== 'function') {
    return throwTslError(
      `The TSL export "${name}" of material "${id}" isn't a function (${JSON.stringify(fn)}).`
    );
  }
  return fn as TslSocketFn;
};

/**
 * The material's `nodes` sockets' values before `setup` runs, compared after it (the debug env's
 * warning for a socket function replacing what `setup` set).
 */
const readSocketValues = (mat: THREE.NodeMaterial, nodes: TslGraphProps['nodes']) => {
  const values = new Map<string, unknown>();
  for (const socket of Object.keys(nodes ?? {})) {
    values.set(socket, (mat as unknown as Record<string, unknown>)[socket]);
  }
  return values;
};

/**
 * Builds a node material's TSL graph from its functions (registered or its loaded TSL file's):
 * `setup` with the material's `inputs` first, then each `nodes` socket's function, which may set
 * a socket `setup` set (the debug env warns). Inputs are kept in `userData.uniforms`
 * (`setup_<key>`, `<socket>_<key>`). Does nothing for a material without TSL functions (warned when
 * it has inputs).
 * @internal
 * @throws for a TSL file that isn't loaded, functions no file and no registration has, an export
 * that isn't a function, or an input value that can't be made into a node
 */
export const applyTslGraph = (mat: THREE.NodeMaterial, props: TslGraphProps) => {
  const id = props.id;
  const fns = getTslMaterialFns(props);
  if (!fns) {
    if (props.nodes || props.inputs) {
      lwarn(
        `Material "${id}" has TSL inputs but no TSL functions: no tslFile, and no registerTslMaterial call under "${props.tslMaterialId || id}".`
      );
    }
    return;
  }

  const staticDefines = props.staticDefines || {};
  mat.userData.uniforms ??= {};
  const sockets = mat as unknown as Record<string, unknown>;
  const nodes = props.nodes ?? {};

  let setBySetup: Map<string, unknown> | null = null;
  if (fns.setup !== undefined) {
    const setup = asTslGraphFn(fns.setup, 'setup', id);
    const rawInputs = props.inputs ?? {};
    const { inputs, defines } = createTslInputs(rawInputs, 'setup', staticDefines, mat, id);
    if (IS_DEBUG_ENV) setBySetup = readSocketValues(mat, nodes);
    setup(inputs, mat, defines);
  } else if (props.inputs && Object.keys(props.inputs).length) {
    lwarn(`Material "${id}" has inputs, but its TSL functions have no setup to take them.`);
  }

  for (const socket of Object.keys(nodes)) {
    const fn = fns[socket];
    // NodeMaterial has a setup method: never a socket
    if (socket === 'setup') {
      lwarn(
        `Material "${id}" has a "setup" under nodes: setup isn't a socket, its inputs are the material's inputs.`
      );
      continue;
    }
    if (fn === undefined || !(socket in mat)) {
      lwarn(`Could not locate node "${socket}" for material id "${id}".`);
      continue;
    }
    const socketFn = asTslGraphFn(fn, socket, id);
    const { inputs, defines } = createTslInputs(nodes[socket], socket, staticDefines, mat, id);
    if (setBySetup?.has(socket) && setBySetup.get(socket) !== sockets[socket]) {
      lwarn(`Material "${id}": its nodes' ${socket} function replaces the ${socket} setup set.`);
    }
    sockets[socket] = socketFn(inputs, mat, defines);
  }

  mat.userData.hasTslFile = true;
};
