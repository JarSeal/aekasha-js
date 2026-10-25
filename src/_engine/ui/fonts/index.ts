// The `aekasha/ui/fonts` entry (p801 D8): `import 'aekasha/ui/fonts'` opts an app's kit into
// IBM Plex Sans and Mono (fonts.css). It exports nothing: the one entry holding a stylesheet
// import instead of `export … from` lines, so package.json's `sideEffects` lists it (a build
// drops a side-effect-free module's imports with it) and aliases.test.ts allows it.
import './fonts.css';
