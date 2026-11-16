# Bridge design: per-unit state proposal

Status: proposed, not implemented. Requires approval before changing the existing
single-crown state model. Based on `53585fe` plus the mesh repair increment.

## Existing behavior and concrete failure risk

Job intake already records multiple FDI units and the editor remembers margin
curves in `margins`. However, `editor.crown` returns the first crown, insertion
axis, preparation relationships, construction settings and workflow state are
shared, and `replaceWithLibrary()` removes every crown. Merely enabling more
crown buttons could therefore fit a second abutment against the first one's
preparation or remove an earlier unit. That is why the next change must address
state ownership before claiming multi-abutment bridges work.

## Proposed first change

Keep the existing editor, renderer, worker algorithms, object IDs and Crown UI.
Add an explicit active FDI unit and a per-unit record with reviewed margin/control
points, insertion direction, construction settings, workflow review state and
restoration object ID. Every crown carries its FDI association. Preparation/BVH
relationships are derived per active unit from the same immutable source scan.

Existing Crown controls operate on the active record. Changing teeth must commit
or cancel an unfinished edit before switching. Replacement/removal targets only
that unit. Undo commands retain the owning FDI and must not apply to another
unit when the visible selection changes. Connector endpoints refer to persistent
restoration IDs, never array positions.

Bridge groups record ordered units and selected connections. A common insertion
axis is an explicit bridge setting; do not assume every manufacturing mode needs
identical axes. Each preparation must be checked for undercuts against the chosen
axis before rebuilding its intaglio. No material-dependent threshold is treated
as a universal default.

## Affected files and compatibility

| File | Proposed responsibility |
| --- | --- |
| `lib/client/cad/editor.js` | Active-unit access, unit-scoped replacement/history, preparation cache, crown/axis lookup, migration and persistence |
| `lib/client/cad/panel.js` | Unit selector and per-unit review state using existing controls |
| `lib/client/cad/session.js`, `workflow.js` | Prerequisites per unit and whole-bridge readiness |
| New `lib/client/cad/unit-state.js` | Pure records, identity validation and v1 conversion without DOM |
| `lib/client/case-plan.js` / `case-intake.js` | Reuse existing unit/job definitions; only validate stable mapping |
| `lib/client/workspace-app.js` | Versioned local design key, v1 backup and explicit recovery entry point |
| `kernel-tasks.js`, builders | Pass the selected unit's inputs explicitly; retain current single-crown algorithm |
| Tests / sample cases | Two distinct preparation regions, independent margins and saved units |

Before any v2 save, retain the complete original v1 scene under a separate local
backup key through the existing design-store adapter. Conversion is explicit and
idempotent. A v1 single crown maps to its unambiguous job tooth; multiple crowns
or ambiguous FDI assignments require technician mapping and must not be silently
guessed. Save migrated multi-unit scenes as v2 rather than pretending old clients
understand them. Reopening a v1 file must continue to work. Do not overwrite or
remove source scan/STL files. Include a portable backup/recovery route before
writing v2 data. V2 uses a new design key; the legacy v1 key is preserved,
so an older client sees its last v1 design rather than silently ignoring v2.
New clients must report unsupported future versions explicitly.

## Acceptance and rollout

1. Existing single-crown fixtures produce the same geometry and keep current UI.
2. Build units A and B on different preparations; switching, replacing or undoing
   B leaves A's vertices, margin, axis and parameters unchanged.
3. Save/reopen both units with correct preparation mapping, settings and topology.
4. Test cancelled worker results, interrupted edits, ambiguous legacy cases,
   removed/restored units and connector endpoint invalidation.
5. No bridge-ready claim until every abutment is reviewed. Then develop pontic
   tissue adaptation and measured connector sections as separate increments.
6. Before manufacturing export, validate merged geometry and re-check fit, wall
   thickness, connection sections and tissue/opposing clearances.

Review this as a separate PR after approval. Rollback returns to the previous
branch and restores its untouched v1 backup; a v2 scene must never be silently
loaded by the old editor as an empty design. No renderer/kernel replacement or
hosted-data migration is part of this proposal.

## Public workflow references

- https://wiki.exocad.com/wiki/index.php/Setting_insertion_axis
- https://wiki.exocad.com/wiki/index.php/Generating_connectors

The references inform workflow requirements. They are not a specification for
exocad's internal implementation. FAUCHAR retains its own geometry pipeline.
