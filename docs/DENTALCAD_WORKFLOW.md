# Dental CAD workflow and capability coverage

Status: original FAUCHAR implementation based on the public DentalCAD workflow,
reviewed 2026-11-14. This is **not full exocad parity**, an exocad integration or
an implementation of its proprietary scene formats, tooth libraries or cloud AI.

## Core order

The case editor now opens a full-scene purple WebGL workspace with a neutral
floating wizard, object visibility/opacity bar, command rail and bottom expert
tools. The ordinary dashboard remains separate. Wizard steps check actual
prerequisites; Expert mode permits returning to tools without marking work done.

| Step | FAUCHAR behavior |
| --- | --- |
| Scan review | View imported STL geometry, check orientation and visibility; imported scans are never modified by restoration edits. |
| Margin | Existing scan picking, editable spline/control points, detection, snapping, smoothing, tooth-specific boundaries. |
| Insertion | Set axis from camera; adjust tilt; show undercuts when a segmented preparation is available. |
| Crown bottom | Set cement/margin spacing and starter dimensions; build a hollow closed procedural shell from the preparation and margin in a worker. |
| Placement | Existing real move/rotate/scale gizmos and numeric transforms. |
| Freeforming | Existing add/remove/smooth/flatten/grab/ridge/groove/restore brushes and anatomic deformation. |
| Contacts | Existing measured antagonist and proximal gaps, relief/build-to-target, color maps and manual correction. |
| Connectors | Existing pontic placement, connector dimensions/waist/position, area readouts and selection. Optional for a single crown. |
| Review | Existing distances, thickness, angles, section contours, maps and original/edited comparison. |
| Merge / save | Edited STL, separate overlapping shells or voxel-unioned solid; merged export runs in a cancellable worker. Local editable scene persistence. |

The old illustrative pipeline is not used as the CAD workflow. Its launch button
and mock progress strip are hidden in the CAD session; no timer advances the real
wizard. Existing demo code remains for compatibility with old case records.

## What crown creation does, and does not do

The starter samples the real preparation with rays along the chosen insertion
axis. It constructs indexed inner/outer disks and a closed margin border, using
original anterior, premolar or molar relief profiles. The default has 4,610
vertices and 9,216 triangles. Segmentation metadata is explicit and survives save
and reopen, allowing protected intaglio/margin sculpting and subsequent gap and
thickness adjustments. Addition is undoable; STL export uses the edited vertices.

Supported inputs are one preparation with a closed, star-shaped margin in its
insertion view, in millimetres, with an unobstructed preparation surface. Folded
margins, unsupported dimensions, invalid axes and missing ray intersections fail
with a specific message. This is not a general reconstruction algorithm for every
scan, a morphology library, undercut block-out or guaranteed anatomical fitting.
It uses the uppermost ray intersection and needs correctly oriented, reviewed
scans. It does not diagnose scan alignment or infer material-specific settings.

Manifold edge and finite-geometry checks do not establish freedom from all
self-intersections or clinical suitability. Anatomic finishing and independent
margin, insertion, contact, wall and manufacturing review remain necessary.

## Broader DentalCAD feature map

“Existing” below means implemented in this repository before this change, not
equivalent accuracy or validation to DentalCAD. A tool is never marked complete
merely because a matching panel exists.

| Capability family | Coverage in this PR / repository |
| --- | --- |
| Case records, tooth selection, projects | New definition-first job intake, per-tooth roles/material/shade, connectors, role-dependent scans and atomic local save; MySQL project metadata exists; full scene cloud sync absent. |
| Scan import and review | Binary/ASCII STL worker processing; no PLY/OBJ texture scan import or automatic inter-jaw registration. |
| Tooth identification | Existing geometric arch/FDI algorithm; manual corrections; not trained AI segmentation. |
| Margins | Existing detection and editing; new workflow prerequisite checks. |
| Insertion and undercut maps | Existing calculations exposed as a dedicated stage; full directional undercut block-out absent. |
| Crown bottom and cement gap | New scan-based starter plus existing intaglio spacing edits. Multiple painted gap zones, detailed border modes and milling-bur compensation absent. |
| Crown/tooth anatomy | One original STL per adult tooth (FDI 11–48) is fitted to the margin, with Standard, Youthful, Broad, Square, Tapered and Worn variations. Exocad and other licensed manufacturer libraries are not included. |
| Placement | Existing per-object transforms; multi-tooth chain placement/symmetry absent. |
| Freeforming | Existing geometry brushes, protected margin/intaglio, anatomy sliders and history. |
| Anatomic reduction / cutback | Not implemented as a thickness-constrained framework workflow. General remove/sculpt tools are not presented as equivalent. |
| Contacts and occlusion | Existing static scan-distance operations; no patient-specific dynamic occlusion. |
| Bridges | Existing pontics/connectors and voxel merge; connector free-curve multiview editing absent. |
| Measurement, section, compare | Existing real geometry tools and maps. |
| Editable scene save/reopen | IndexedDB including new segmentation, dimensions and workflow state; not `.dentalCAD` or `.constructionInfo` compatibility. |
| Final mesh output | Existing STL serialization; new worker merge, cancellation and memory preflight. Separate shells are explicitly overlapping shells, not a union. |
| Implant abutments, scanbody matching, emergence libraries, screw channels | Not implemented. |
| Telescopic crowns, post/core | Not implemented. |
| Full dentures / overdentures / hybrid All-on-X | Not implemented. |
| Partial frameworks and bars / split bars | Not implemented. |
| Bite splints | Not implemented. |
| Provisional / eggshell restorations | No dedicated workflow; a generic crown starter is not claimed as an eggshell system. |
| Model Creator, model segmentation / bases | Not implemented. |
| Virtual articulator / jaw movement | Not implemented. |
| Smile Creator / photo registration / DICOM | Not implemented. |
| Realistic visualization | Existing WebGL material rendering, not TruSmile or video simulation. |
| Attachment library and Boolean attachment operations | Not implemented. |
| Cloud AI crown design | Not integrated; no pretrained model weights or cloud API configured. |
| Dentalshare / CAM / nesting / machine output | Not integrated; STL export is the handoff boundary. |

## Responsiveness and performance

- No added runtime library. Existing demand-driven WebGL frames are preserved.
- Crown generation and voxel union execute in module workers; cancellation
  terminates the worker and reopening a job starts a fresh worker.
- Input meshes are cloned, not transferred away from the editor/undo state.
- A single calculation is allowed at a time; geometry editing is disabled during
  it, while camera interaction remains available. Escape cancels the calculation.
- Preview is capped at 1.5× device pixel ratio, with a 1× fast mode. Mesh precision
  and STL resolution are unaffected by this switch.
- Merging has an eight-million-cell preflight budget, with explicit errors rather
  than starting an unbounded voxel field. Output size and device capability still
  matter; this is not a frame-rate guarantee for arbitrary scans.

## Verification

Commands: `npm run test:workflow`, `npm run test:cad`, `npm run test:teeth`,
`npm run build`. New tests use the real bundled upper-jaw scan and run the exact
browser module-worker handler inside a Node worker thread. They cover topology,
STL round-trip, starter families, reversed margins, invalid input, wizard gates,
worker errors/cancel/restart, input-buffer retention, merged output and memory
limits, undo/redo, editable reopen, and parameter persistence.

Additional `test:intake` and `test:margin` suites cover the job definition DOM,
scan-role planning and direct margin drawing/editing. See
[job setup and margin details](JOB_SETUP_AND_MARGIN.md).

On the task host the default full-resolution starter took about 0.5 seconds for
generation, and under one second including an STL round-trip in the headless
test. This is a host measurement, not a browser interaction or FPS benchmark.

Browser visual/interaction QA could not start: managed Next preview exited with
`ERR_SYSTEM_ERROR: uv_interface_addresses`. A temporary local harness was removed
before committing. No authentication bypass or test route is included. Production
build and headless tests pass, but visual layout, touch behavior, shader execution
and browser-worker delivery still require verification in a browser before merge.

An existing clean-install lockfile mismatch was repaired, and four existing
Next.js internal-link lint errors were corrected so the production build can run.

## Primary references

Public behavior and screen layout were researched from the official documentation;
no exocad source code, branded artwork or proprietary library was copied.

- [Documentation index](https://wiki.exocad.com/wiki/index.php/Dental_CAD_Platform_Documentation_-_Index_of_topics)
- [Typical wizard order](https://wiki.exocad.com/wiki/index.php/Documentation_of_the_%E2%80%9Ewizard%E2%80%9C_steps_for_a_typical_design)
- [DentalCAD overview](https://wiki.exocad.com/wiki/index.php/DentalCAD_-_overview)
- [Margins](https://wiki.exocad.com/wiki/index.php/Detect_/_edit_margins)
- [Crown bottom](https://wiki.exocad.com/wiki/index.php/Designing_the_inside_of_the_crown)
- [Tooth placement](https://wiki.exocad.com/wiki/index.php/Correct_Tooth_Placement)
- [Freeforming](https://wiki.exocad.com/wiki/index.php/Freeforming)
- [Anatomic reduction](https://wiki.exocad.com/wiki/index.php/Anatomic_Reduction)
- [Connectors](https://wiki.exocad.com/wiki/index.php/Generating_connectors)
- [Merge and save](https://wiki.exocad.com/wiki/index.php/Saving_restorations)
- [Expert mode](https://wiki.exocad.com/wiki/index.php/Expert_Mode)
- [Tools](https://wiki.exocad.com/wiki/index.php/Tools)

## Library tooth STLs (November 2026)

- `public/assets/teeth/<FDI>.stl` (11–48) are open crown shells in one shared arch frame. They are the
  tooth library. `scripts/build-tooth-atlas.mjs` reads them (read-only) and writes
  `lib/client/cad/tooth-atlas.js`: cervical rim centre, occlusal/mesial/facial axes, size and occlusal outline.
  Re-run it after replacing any tooth file.
- Crown bottom → *Place tooth N* runs `fitLibraryCrown` (`lib/client/cad/tooth-library-stl.js`) in the
  kernel worker:
  1. placement like a library tooth setup: the library arch (all 32 files share one frame) is fitted
     to the numbered neighbours of the scan (rotation, translation, uniform scale; surface height at each
     crown centre), which gives the tooth its position, inclination, labial line and incisal/occlusal level.
     Without at least three reliable neighbours it falls back to measuring the gap and chewing height;
  2. the outer surface is resampled along meridians from one point inside the crown: ring 0 lies on
     margin + margin border, the emergence profile leaves the margin straight and blends into the anatomy.
     Rays from one point cannot fold the surface;
  3. along every ray the outer surface stays at least the wall beyond the intaglio (tapering to the margin
     border); where the preparation comes close, the extra thickness is spread smoothly like added wax;
  4. intaglio = preparation + cement gap (margin gap at the rim) → one closed solid.
- An open shell dropped on the 3D view goes through the same pipeline (frame guessed from the shell).
- The appointment chart draws both arches from the same outlines.

### Verified
- Real scan (demo upper, tooth 22, arch fit to 23 21 24 11 25 12, rms 0.89 mm): height 7.90 mm vs 8.18 mm,
  volume 101 vs 90 mm³, wall median 0.91 vs 0.85 mm, surface 0.29 mm mean from the exocad-made crown of the case.
- Procedural fixture (lower partial arch, tooth 46): neighbours found (11.0 mm gap), mesial along the arch;
  in the browser: appointment → scans → tooth confirmation → one-click margin → axis → placement →
  occlusal clearance → save → reopen → export (closed, 0 open edges, mm, scan coordinates).

### Open
- No real preparation scan of a 46 was available; the 46 case is a procedural fixture.
- Arch-geometry numbering still mislabels unusual partial arches; the appointment tooth is anchored
  on a detected preparation and must be confirmed by the technician.
- The 2D segmentation service's checkpoint symlink is broken and the service is not used by the STL path.
- ToothCraft cannot run on this machine (no CUDA, no torch, no weights).
