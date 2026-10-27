## Accordion

`createAccordion({ level, items })` stacks sections, each a heading of `level` holding a button
(`aria-expanded`, `aria-controls`) over a panel that opens and shuts with its height animated (at
once under reduced motion). One section is open at a time, or several with `multiple: true`. A
panel's `content` is a CMP or a function that builds it when the section first opens. Each header
is a tab stop: Enter or Space opens or shuts its section, Up and Down move between the headers
(wrapping, disabled ones skipped), Home and End to the first and last. Each panel is a
`role="region"` named by its header while there are at most six.

- **States:** drawn in the page: a help list with one section open at a time, and settings with
  several open, a disabled section and an Audio panel built when it first opens (saying how often
  it was); **Open every section** opens all of settings' enabled ones. The status line says what
  the user opened.
- Not the [folder](#folder): a folder groups fields and has no heading.
