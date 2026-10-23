A major version of the engine or the toolkit changes how an app uses them. Each one has a section
here, newest first: every change that breaks an app's code, and how to make it.

An app made from the template takes the new engine, toolkit and tools from the template first,
then works through its section. `yarn build` (the type check) and `yarn lint` show what's left.

The next section is engine 6.0.0's. It removes what the 5.x minors deprecated: each
`@deprecated` name in the [API reference](hub:documentation) already says what replaces it, so
an app can move over before the major lands.
