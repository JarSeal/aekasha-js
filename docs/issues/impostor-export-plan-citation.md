**Title:** The impostor exporter writes a plan citation into every exported JSON

Status: open | small, for the LOD feature's next change
Category: LOD, Debug
Found: 2026-10-22, p620 Phase 5 (J4: the plan citations in user-visible asset descriptions)
Our workaround: none; the text is harmless, it shows in the asset's description

## What happens

The LOD tab's impostor export (`features/lod/debug/_dbg__ImpostorExport.ts`, `DEBUG_DESCRIPTION`)
writes "Written by the LOD tab's impostor Export (docs/plans/_DONE_p351_impostor-billboard-lod.md
Phase 4): re-export the impostor instead of editing this file." into the description of each
`*.impostor.json` and its `*.textureAtlas.json`. The app's four exports carry it (eight files:
`largeWorldRockImpostor`, `largeWorldTreeCross`, `lodShowcaseKnotImpostor`,
`lodShowcaseTreeCross`), and p620 removed every other plan citation from the app's asset
descriptions. A done plan is an
internal file that will be deleted with its epic; an app made from the template gets the path in
its own assets.

## Fix

Drop the citation from the string ("Written by the LOD tab's impostor export: re-export the
impostor instead of editing this file."), then re-export the four impostors, or edit the eight
descriptions by hand.
