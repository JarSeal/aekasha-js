Gameplay code reads actions, never keys. An action map names what the player can do (move,
jump, look) and binds each action to the keyboard, the mouse, touch or a gamepad, as plain data.
The simulation reads its actions once per physics step, so a tap shorter than a step still lands
on one step, and a run can be recorded and replayed. UI and debug keys get a callback at the
press itself, also while the game is paused.

Every example scene with controls reads them through an action map: the
[character example](hub:examples/character)'s player brain, the
[physics example](hub:examples/physics)'s drop and the [sky box example](hub:examples/sky-box)'s
time controls.
