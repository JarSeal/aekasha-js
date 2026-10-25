## Skeleton

`createSkeleton({ shape? })` is a grey shape where content is still loading, shaped like it: text
lines (`lines`, the last shorter), a block or a circle, so the layout doesn't jump when the
content comes. It's `aria-hidden`: the container that's loading takes `aria-busy="true"` until
its content is there, which is the app's to set and take off. A shimmer crosses it; under
reduced motion there's none.

- **States:** drawn in the page: the shapes, and a card loading whose Hub button puts its content
  in (the skeletons removed, `aria-busy` taken off). The screenshots pause the shimmer at its
  start.
