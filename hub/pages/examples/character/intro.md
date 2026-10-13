::: scene exampleCharacter
A character on a small course of crates, stairs and a ramp. W A S D or the arrow keys move it
North, West, South and East, Space jumps, Shift held runs and C crouches.
:::

The character is a dynamic [character](hub:features/characters): a physics body its controller
pushes around, so slopes, steps and bumps are the physics engine's. A player brain reads the
keys through an action map and tells the controller what the player wants, once per physics
step. The camera is the toolkit's follow rig, set to keep its view direction and to look a little
ahead of where the character is going.
