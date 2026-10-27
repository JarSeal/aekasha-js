## Range slider

[What it is and its states](hub:features/ui-kit/library#range-slider), on the public page.

::: note For a later plan
p804 Phase 3 section 2: `forms/RangeSlider.ts` on the slider's track (`forms/SliderTrack.ts`,
`@internal`: the rail, the ticks, the histogram, the thumbs and the drag, which section 2 moved
out of `Slider.ts`). Its drags (the nearer thumb, the grab offset, the span, two thumbs at one
value) have no keyboard script here: `yarn verify:ui` has no pointer drag step
(`RangeSlider.test.ts` checks them).
:::
