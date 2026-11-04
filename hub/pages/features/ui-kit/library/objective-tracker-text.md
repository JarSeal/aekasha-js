## Objective tracker

`createObjectiveTracker({ title, placement })` lists what the player is doing: objectives with a
count ("Collect crystals 3 / 5") or steps, `setObjective(id, …)` adding or rewriting one in place.
`complete(id)` checks and strikes it through, reads it, then removes it after a moment. A list
named by its title; a new objective, a changed count, a step done and a completion are read once.
In a HUD it sits in a corner; here `inline`.

- **States:** in the page: a count and steps, a crystal collected, a step done, a completion (held,
  then gone) and a new objective.
