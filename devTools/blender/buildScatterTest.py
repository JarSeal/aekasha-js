"""Builds scatterTest's Blender scatter (p308 Phase 2) into src/app/scenes/scatterTest/blenderScatter/:
one Geometry Nodes scatter exported both ways D3 names, scripted so it can be made again:

- `ScatterGround`, a flat 24 m plane, centred (the engine's block is the ground: not exported);
- the `ScatterRocks` collection, `RockA` (an icosphere) and `RockB` (a cube), each 0.5 m, its origin
  at its bottom centre, exported as nodes of their own (the point cloud's items draw them);
- the node group `AekScatter`: _Distribute Points on Faces_ (Poisson Disk) on the ground, a random
  rotation (yaw, and a tilt of up to 0.3 rad), scale and item each stored on the points
  (_Store Named Attribute_: `_ROT` a Quaternion, `_SCALE` a Vector, `_ITEM` an Integer), then
  either _Instance on Points_ of the collection (_Pick Instance_, the stored item, rotation and
  scale) or the points themselves, by its `Points` input;
- `ScatterInstances` (the group, `Points` off) exported with GPU Instances and Geometry Nodes
  Instances on: scatterTestGnGpu.glb, a node `ScatterInstances` whose children `ScatterInstances.0`
  and `.1` hold the GPU instances of RockA's and RockB's meshes;
- `ScatterPoints` (a copy of the group, `AekScatterPoints`, its `Points` on) with the custom prop
  `aekScatterPoints` 1, exported with Geometry Nodes Instances, Point Clouds and Attributes on:
  scatterTestGnPoints.glb, a node `ScatterPoints` (the custom prop) whose child `GN Instance` is the
  points (a POINTS primitive with `_ROT`, `_SCALE`, `_ITEM` and `_RADIUS`). No conversion: Object →
  Convert → Point Cloud makes an empty one (the points aren't the object's mesh);
- scatterTestGn.blend, the scene, to look at.

Run (a Windows blender.exe from WSL2 takes `wslpath -w` paths):
blender -b --factory-startup --python-exit-code 1 --python buildScatterTest.py -- <repo root>
"""

import math
import os
import sys

import bpy

sys.dont_write_bytecode = True

args = sys.argv[sys.argv.index("--") + 1 :]
REPO_ROOT = args[0]
FOLDER = os.path.join(REPO_ROOT, "src", "app", "scenes", "scatterTest", "blenderScatter")

GROUND_SIZE = 24
#: Poisson Disk's minimum distance and density (points per m²)
DISTANCE_MIN, DENSITY = 1.2, 0.5
SEED = 7


def progress(line):
    print(f"[aek] {line}", flush=True)


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.unit_settings.system = "METRIC"


def add_ground():
    bpy.ops.mesh.primitive_grid_add(x_subdivisions=8, y_subdivisions=8, size=GROUND_SIZE)
    ground = bpy.context.active_object
    ground.name = "ScatterGround"
    return ground


def add_rocks():
    rocks = bpy.data.collections.new("ScatterRocks")
    bpy.context.scene.collection.children.link(rocks)
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=0.25, location=(0, 0, 0.25))
    rock_a = bpy.context.active_object
    bpy.ops.mesh.primitive_cube_add(size=0.5, location=(0, 0, 0.25))
    rock_b = bpy.context.active_object
    for name, rock, x in (("RockA", rock_a, -20), ("RockB", rock_b, -18)):
        rock.name = name
        rock.data.name = name
        # The origin at the bottom centre: the geometry up by its half, the object at z 0
        bpy.context.view_layer.objects.active = rock
        bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
        rock.location = (x, 0, 0)
        for collection in rock.users_collection:
            collection.objects.unlink(rock)
        rocks.objects.link(rock)
    return rocks


def link(tree, from_socket, to_socket):
    tree.links.new(from_socket, to_socket)


def random_value(tree, data_type, minimum, maximum, seed):
    node = tree.nodes.new("FunctionNodeRandomValue")
    node.data_type = data_type
    inputs = [s for s in node.inputs if s.enabled]
    inputs[0].default_value = minimum
    inputs[1].default_value = maximum
    node.inputs["Seed"].default_value = seed
    return node


def store(tree, geometry_socket, name, data_type, value_socket):
    node = tree.nodes.new("GeometryNodeStoreNamedAttribute")
    node.data_type = data_type
    node.domain = "POINT"
    node.inputs["Name"].default_value = name
    link(tree, geometry_socket, node.inputs["Geometry"])
    link(tree, value_socket, next(s for s in node.inputs if s.enabled and s.name == "Value"))
    return node


def read(tree, name, data_type):
    node = tree.nodes.new("GeometryNodeInputNamedAttribute")
    node.data_type = data_type
    node.inputs["Name"].default_value = name
    return next(s for s in node.outputs if s.enabled and s.name == "Attribute")


def build_node_group(ground, rocks):
    tree = bpy.data.node_groups.new("AekScatter", "GeometryNodeTree")
    tree.interface.new_socket("Geometry", in_out="INPUT", socket_type="NodeSocketGeometry")
    points_input = tree.interface.new_socket("Points", in_out="INPUT", socket_type="NodeSocketBool")
    points_input.default_value = False
    tree.interface.new_socket("Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")
    group_in = tree.nodes.new("NodeGroupInput")
    group_out = tree.nodes.new("NodeGroupOutput")

    ground_info = tree.nodes.new("GeometryNodeObjectInfo")
    ground_info.inputs["Object"].default_value = ground
    distribute = tree.nodes.new("GeometryNodeDistributePointsOnFaces")
    distribute.distribute_method = "POISSON"
    distribute.inputs["Distance Min"].default_value = DISTANCE_MIN
    distribute.inputs["Density Max"].default_value = DENSITY
    distribute.inputs["Seed"].default_value = SEED
    link(tree, ground_info.outputs["Geometry"], distribute.inputs["Mesh"])

    euler = random_value(tree, "FLOAT_VECTOR", (-0.3, -0.3, 0), (0.3, 0.3, 2 * math.pi), SEED + 1)
    to_rotation = tree.nodes.new("FunctionNodeEulerToRotation")
    link(tree, euler.outputs["Value"], to_rotation.inputs["Euler"])
    scale = random_value(tree, "FLOAT_VECTOR", (0.6, 0.6, 0.5), (1.4, 1.4, 1.2), SEED + 2)
    item = random_value(tree, "INT", 0, 1, SEED + 3)

    stored = store(tree, distribute.outputs["Points"], "_ROT", "QUATERNION", to_rotation.outputs["Rotation"])
    stored = store(tree, stored.outputs["Geometry"], "_SCALE", "FLOAT_VECTOR", scale.outputs["Value"])
    stored = store(
        tree, stored.outputs["Geometry"], "_ITEM", "INT", next(s for s in item.outputs if s.enabled)
    )

    rocks_info = tree.nodes.new("GeometryNodeCollectionInfo")
    rocks_info.inputs["Collection"].default_value = rocks
    rocks_info.inputs["Separate Children"].default_value = True
    rocks_info.inputs["Reset Children"].default_value = True
    instance = tree.nodes.new("GeometryNodeInstanceOnPoints")
    link(tree, stored.outputs["Geometry"], instance.inputs["Points"])
    link(tree, rocks_info.outputs["Instances"], instance.inputs["Instance"])
    instance.inputs["Pick Instance"].default_value = True
    link(tree, read(tree, "_ITEM", "INT"), instance.inputs["Instance Index"])
    link(tree, read(tree, "_ROT", "QUATERNION"), instance.inputs["Rotation"])
    link(tree, read(tree, "_SCALE", "FLOAT_VECTOR"), instance.inputs["Scale"])

    switch = tree.nodes.new("GeometryNodeSwitch")
    switch.input_type = "GEOMETRY"
    link(tree, group_in.outputs["Points"], switch.inputs["Switch"])
    link(tree, instance.outputs["Instances"], switch.inputs["False"])
    link(tree, stored.outputs["Geometry"], switch.inputs["True"])
    link(tree, switch.outputs["Output"], group_out.inputs["Geometry"])
    return tree


def add_scatter(name, tree, points):
    """An object of the scatter, its `Points` input on or off: through a copy of the group whose
    input defaults to it (Blender 5.3 takes no modifier input as an ID property)"""
    if points:
        tree = tree.copy()
        tree.name = "AekScatterPoints"
        next(item for item in tree.interface.items_tree if item.name == "Points").default_value = True
    mesh = bpy.data.meshes.new(name)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.modifiers.new("AekScatter", "NODES").node_group = tree
    return obj


def select_only(objects):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]


def export(file_name, objects, **options):
    select_only(objects)
    path = os.path.join(FOLDER, file_name)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_extras=True,
        export_apply=True,
        export_materials="NONE",
        **options,
    )
    progress(f"exported {path}")


def main():
    os.makedirs(FOLDER, exist_ok=True)
    clear_scene()
    ground = add_ground()
    rocks = add_rocks()
    tree = build_node_group(ground, rocks)
    instances = add_scatter("ScatterInstances", tree, False)
    points = add_scatter("ScatterPoints", tree, True)
    rock_objects = list(rocks.objects)
    bpy.context.view_layer.update()
    points["aekScatterPoints"] = 1
    blend = os.path.join(FOLDER, "scatterTestGn.blend")
    bpy.ops.wm.save_as_mainfile(filepath=blend, compress=True)
    progress(f"saved {blend}")

    export(
        "scatterTestGnGpu.glb",
        [instances, *rock_objects],
        export_gpu_instances=True,
        export_gn_mesh=True,
    )
    export(
        "scatterTestGnPoints.glb",
        [points, *rock_objects],
        export_gn_mesh=True,
        export_pointclouds=True,
        export_attributes=True,
    )


main()
