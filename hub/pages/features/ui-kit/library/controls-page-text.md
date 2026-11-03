## Controls page

`createControlsPage({ actions, onRebind })` rebinds an action map: a row per action, a column per
device (the keyboard and mouse, a gamepad), a slot per binding. Enter or a click waits for the next
key, mouse button or gamepad button (Escape cancels), kept from the action maps and the overlays;
another action's input asks to swap or keep both. `onRebind` reports the action's whole new list,
which the app gives `map.setBindings` and saves. The gamepad column's labels follow the prompts'
family.

- **States:** in the page: the actions (a composite, buttons, a mouse button, one that can't be
  rebound), and the gamepad column in PlayStation's and Nintendo's labels. A capture and a
  conflict are the keyboard scripts'.
