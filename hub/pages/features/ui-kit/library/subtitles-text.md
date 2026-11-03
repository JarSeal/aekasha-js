## Subtitles

`createSubtitles({ maxLines, placement })` shows what's said, `show({ text, speaker?,
speakerColor?, durationMs? })` a line at a time at the bottom of the HUD (here `inline`), the
speaker's name bold and in its own colour (not the colour alone). Its element is a polite live
region, so a line is read once as it's added, speaker first; past `maxLines` the oldest goes. Its
size and background are custom properties (a subtitle size setting).

- **States:** in the page: two speakers, a sound and three lines past the maximum.
