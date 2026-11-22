// An import's physics groups (i030): which nodes make one rigid body. The kernel's spawn reads them
// for its `merge` (a moving body's pieces are left out), the physics extension spawns them.
import type { ImportSpawnNode } from './ImportTypes';

/**
 * One rigid body of a spawn: the node carrying it and the nodes of its group, the body's node
 * first. A second node with a `rigidType` in an `index` group isn't in `nodes`.
 * @internal
 */
export type ImportPhysicsGroup = { rigid: ImportSpawnNode; nodes: ImportSpawnNode[] };

const names = (nodes: readonly ImportSpawnNode[]) =>
  nodes.map((node) => `"${node.localName}"`).join(', ');

/**
 * Groups a spawn's nodes into rigid bodies: one per custom prop `index` (carried by the group's
 * first node with a `rigidType`), and one per node with a `rigidType` and no `index`. The nodes
 * with neither join the file's one body without an `index`; with several, they join none. The
 * groups without an `index` come first, then by `index` in node order.
 * @internal
 * @returns the groups, and a warning for each node left without physics
 */
export const groupImportPhysicsNodes = (nodes: readonly ImportSpawnNode[]) => {
  const groups: ImportPhysicsGroup[] = [];
  const warnings: string[] = [];

  const withoutIndex = nodes.filter((n) => typeof n.props.index !== 'number');
  const loneRigids = withoutIndex.filter((n) => n.props.rigidType);
  const loose = withoutIndex.filter((n) => !n.props.rigidType);
  const loosePhysics = loose.filter((n) => n.props.isPhysObj);
  if (loneRigids.length === 1) {
    groups.push({ rigid: loneRigids[0], nodes: [loneRigids[0], ...loose] });
  } else {
    for (const rigid of loneRigids) groups.push({ rigid, nodes: [rigid] });
    if (loneRigids.length && loosePhysics.length) {
      warnings.push(
        `the physics nodes ${names(loosePhysics)} have no "index" and the file has ${loneRigids.length} bodies without one (${names(loneRigids)}), so they join none and get no physics. Give each body and its colliders an "index".`
      );
    } else if (loosePhysics.length) {
      warnings.push(
        `the physics nodes ${names(loosePhysics)} have no "index" and no node without one has a "rigidType", so they get no physics.`
      );
    }
  }

  const indexes = [
    ...new Set(nodes.map((n) => n.props.index).filter((i) => typeof i === 'number')),
  ];
  for (const index of indexes) {
    const group = nodes.filter((n) => n.props.index === index);
    const [rigid, ...extraRigids] = group.filter((n) => n.props.rigidType);
    if (!rigid) {
      const physics = group.filter((n) => n.props.isPhysObj);
      if (physics.length) {
        warnings.push(
          `the physics nodes ${names(physics)} of "index" ${index} have no node with a "rigidType", so they get no physics.`
        );
      }
      continue;
    }
    if (extraRigids.length) {
      warnings.push(
        `"index" ${index} has more than one node with a "rigidType": ${names(extraRigids)} get no physics (the body is "${rigid.localName}"'s). Give each body its own "index".`
      );
    }
    groups.push({
      rigid,
      nodes: [rigid, ...group.filter((n) => n !== rigid && !n.props.rigidType)],
    });
  }
  return { groups, warnings };
};
