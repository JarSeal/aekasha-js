## Number fields under load

Only on this page (p804 D14's performance pass): 200 number fields with `interval: 0` in one
scheduler, so its tick reads all of them every frame. "Values change every frame" changes every
bound value each frame (each field redraws its text and ARIA values), "Values stay" keeps them (a
tick that should find nothing to do), "Stop" hides the scheduler (no tick). The readout averages
the last 120 frame times. Phase 2 section 4 measured it with a profile; the plan has the figures.
