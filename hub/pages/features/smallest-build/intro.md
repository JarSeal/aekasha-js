Every byte a page downloads before its first frame is a byte the visitor waits for. Ækasha is
built so that an app ships only the engine it uses: each feature is opt-in, the heavy parts
(the physics engine, the model and texture loaders, the decoders) load when something needs them,
and the debug tooling never reaches a production build. `yarn sbp` measures every build, says why
each part is in it, and fails the build when a part grows past its budget.

::: embed banner
The banner profile, live: one scene made in code, no engine feature, and
**{{sbp:banner.initial}}** of gzip before its first frame. It's mounted into this page with
[`mountAekasha`](api:mountAekasha), like any site would embed it, and pauses when it scrolls out of
view.
:::
