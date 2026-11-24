The same game runs on a desktop GPU and on a five-year-old laptop. The device capability check
measures the device it runs on once: what the browser says about the GPU, the memory, the cores
and the display, plus a benchmark of a second or so. It rates each part on the shadow presets'
scale, `LOW` to `ULTRA`, checks the device against your targets (a frame rate, memory, WebGPU) and
suggests settings: a pixel ratio, antialiasing, a shadow quality, PostFX. The engine applies none
of it: the report is data your app reads to pick its defaults, or to tell a player their device
is short of what the game needs.
