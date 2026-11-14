# Job setup and margin editing

New jobs now use a DentalDB-style definition-first flow. A job/appointment here
is a dental design work order, not a scheduled calendar event.

## Define → import → design

1. Enter a job name, client/laboratory, patient reference, technician and optional
   due date. Choose the scan mode, planning material/shade and production method.
2. Click an FDI tooth in the curved upper/lower arch chart. A three-column dialog
   provides restoration type, production/material and scan/design options. OK
   commits the settings; Cancel or Escape discards the draft. Assign its indication,
   material and shade. The crown
   shortcut assigns one prepared tooth. The bridge shortcut takes two end teeth,
   assigns crown abutments at the ends and pontics between them, and creates
   editable connector toggles. Per-tooth adjacent and antagonist roles are also
   available. Ctrl-click copies the current indication settings.
3. Import the scans requested by that job. Each role has its own upload/drop
   target, file validation/progress, replacement and removal. Changing a job
   never silently deletes previously uploaded files; obsolete roles are shown
   and must be removed before saving.
4. Review the tooth table, materials, connectors and scan list. Save the job and
   all its files in one IndexedDB transaction, then open its actual WebGL case.

| Job choice | Requested scan roles |
| --- | --- |
| Upper restoration | Upper prepared-jaw scan required. |
| Lower restoration | Lower prepared-jaw scan required. |
| Include opposing jaw, or mark an antagonist | Opposite jaw required for static occlusion. |
| Opposing jaw not requested | Antagonist recommended; design can proceed without its checks. |
| Bridge with pontics | Gingiva/ridge reference recommended. |
| Require gingiva / add pre-op / add bite reference | Corresponding reference file required. |

Pre-op, gingiva and bite references are stored and can be displayed separately;
they start hidden and are never selected as the preparation, opposing jaw or a
restoration unit. All scans must already be in their intended shared coordinates.
Uploading a bite file does not perform automatic bite registration, and pre-op
upload does not perform shape transfer.

Single-crown and connected-bridge jobs are supported. Disconnected independent
crowns, restorations in opposing jaws, unsupported indications, missing prepared
scans and incompatible connector materials cannot silently launch the wrong
workflow. Other DentalCAD indication families are shown disabled with their module
status. They remain unavailable, as documented in the capability matrix.

Material, shade and production fields describe the plan. They are not proprietary
manufacturer material libraries or CAM output. Explicit cement/wall parameters
are passed to the real editor and remain editable there. The single-crown wizard
skips the connector stage; bridge jobs retain it. Existing cases stay readable.

## Libraries and reference catalog

The expanded tooth dialog contains all 28 indication entries from the supplied
reference frames, 13 planning materials with original SVG art, shade chips,
live cement/minimal-wall sliders and the pictured option sections. Disabled
engines are visibly unavailable. Material choice does not silently install
manufacturer production presets.

Crown bottom offers four original parametric morphology styles. Their preview
and generated relief use the same FDI-aware function, with separate anterior,
premolar and upper/lower molar structure. The inner geometry is unchanged by
style selection. Construction settings and source metadata survive design save.

The CAD Library tool (L) adds/reloads user-owned binary restoration STLs in
browser IndexedDB and imports a selected model into the actual editor. Catalog
metadata is stored separately from geometry to avoid loading every mesh merely
to list models. Files must be closed, non-degenerate, positive-volume meshes,
up to 20 MB / 100,000 triangles. Original coordinates are preserved: manual
placement and fit assessment are required. The library is local to this browser.

See [reference and readiness](EXOCAD_REFERENCE_AND_READINESS.md) for AI research,
asset-license findings and concrete missing production capabilities.

## Margin usability

- Empty margin opens in Trace mode on the job's prepared tooth. Opening the tool
  no longer waits for whole-arch FDI identification.
- Hold and draw on the surface, release to pause, and continue from another view;
  individual point clicks still work. Alt-drag rotates, Shift/right-drag pans.
- A highlighted start target closes a sufficiently long trace when approached on
  the actual scan. Finish line is an explicit alternative; Enter also works.
- Undo stroke removes the last drawing gesture. Backspace/Ctrl-Z use the same
  behavior for a draft. Cancel restores the previous closed margin. Short drafts
  keep their points rather than disappearing when finished too early.
- Trace preview is raw and frame-coalesced. Spline fitting and scan snapping run
  when closing; long traces become at most 48 editable control points.
- Existing handles have larger mouse/touch hit areas. Obscured back-side handles
  are excluded. Dragging the line between handles inserts and moves a point in
  one undoable operation. Clicking away retains camera navigation.
- Find margin explicitly asks for the preparation top. It proposes a line for
  review; it does not label the result clinically correct. Center line and Look
  from above help inspect the result without first identifying the whole arch.
- The wizard refuses to build from an old line while a replacement draft is open.

## Tests and limits

`npm run test:intake` checks role-dependent scan plans, invalid spans/materials,
references, editor parameters, scene classification, and the actual intake DOM
from tooth definition through required uploads to save/navigation. `linkedom` is
a development-only DOM test dependency; it is not loaded by the web application.

`npm run test:margin` exercises drawing defaults, complete stroke/close/undo/redo,
short draft preservation, cancellation, seed selection, line dragging, occluded
handle selection, camera modifiers and wizard gating.

The job page uses the DentalDB desktop arrangement: Project fields and preview
status on the left, curved FDI arches in the center, and an Actions rail on the
right. Tooth symbols are original lightweight SVGs. Unimplemented modules remain
disabled and labeled rather than opening a placeholder design.

The desktop layout and tooth-dialog apply interaction were checked in Chromium
using an isolated static harness loading the actual intake JS/CSS. That harness
mocks file parsing and persistence, so it does not validate the real upload,
IndexedDB, worker or WebGL integration. The full Next managed preview still
encounters the previously observed `uv_interface_addresses` host error. Touch
gestures and full browser file/worker behavior need verification before merging.
The intake DOM suite also checks modal cancellation, commit and scan-option state.

Primary behavior references:

- [DentalDB application](https://wiki.exocad.com/wiki/index.php/DentalDB_Application)
- [Individual tooth definitions](https://wiki.exocad.com/wiki/index.php/Defining_jobs_for_individual_teeth)
- [Margin editing](https://wiki.exocad.com/wiki/index.php/Detect_/_edit_margins)
