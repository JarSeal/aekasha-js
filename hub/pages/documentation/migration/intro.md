A major version of the engine or the toolkit changes how an app uses them. Each one has a section
here, newest first: every change that breaks an app's code, and how to make it.

An app made from the template takes the new engine, toolkit and tools from the template first,
then works through its section, which starts with "Before you start". A major with a codemod
(`devTools/layout/migrateToEntries.ts` for engine 5, `devTools/migrate/migrateEngine6.ts` for
engine 6) runs it next: it rewrites what has one answer and reports the rest, each report naming
its subsection here. `yarn build` (the type check) and `yarn lint` show what's left.

A minor never breaks an app: it deprecates instead, and each `@deprecated` name in the
[API reference](hub:documentation) says what replaces it and in which major it goes, so an app can
move over before the major lands.
