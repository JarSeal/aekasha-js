## Time series under load

Only on this page (p805 D14's performance pass). Eight time series of 600 samples, each pushed
every frame from one loop: one series a panel, or eight (64 lines, Phase 0's heavier probe).
**Pause the panels** keeps the pushes and stops the draws. The readout gives each frame's script
time from the loop's start to the end of the panels' draws (a frame callback that runs after
theirs), median and p95 of the last 120 frames, and the frame times. Chromium records the canvas
calls and rasterizes them later, so the frame times are the other half of the picture. Phase 5
section 3 measured them; the plan has the figures.
