## Tables under load

Only on this page (p805 D14's performance pass). The first box: 500 rows of five figures, every
column given a width (the fixed layout), a sticky header and stripes in a box that scrolls. Its
modes update at 10 Hz: `setCell` on a tenth of the rows (a different tenth each time, as a
profiler's figures move), `setCell` on every figure, and a `refresh` of every figure (the rows
read again). The second: 10,000 virtual rows, a `refresh` of every figure at 10 Hz, or the box
scrolled 37 px a frame. The readout gives each update's script time with the style and layout
it forces (read back at once, as Phase 0's probe did), median and p95 of the last 50, and the
frame times. Phase 4 section 3 measured them; the plan has the figures.
