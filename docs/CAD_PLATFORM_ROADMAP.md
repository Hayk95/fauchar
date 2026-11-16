# FAUCHAR dental CAD development roadmap

Updated 2026-11-16. Repository baseline `06142ea7891ff5dcfcd7b076e61b2d171bbb90cc`.

## Goal and delivery method

Extend the current single-crown workspace into a browser dental laboratory CAD
platform. Keep the current Crown Design entry points, case format and existing
editing behavior working while adding one tested capability at a time. Each
stage has an input, editable result, persistence behavior and export acceptance
criteria. Commit working increments and record their verification below.

The present increment adds mesh topology inspection, component STL extraction
and reversible restoration face cleanup. It uses the existing worker transport,
editor history and scene persistence. It introduces no runtime dependency.

## Audited repository baseline

| Capability | Existing implementation | Evidence and remaining work |
| --- | --- | --- |
| Job setup | `case-plan.js`, `case-intake.js`, FDI chart | Crown/bridge scan planning and IndexedDB creation have DOM tests. The indication catalog contains disabled families whose geometry engines still need implementation. |
| Scan input | STL worker, Y/Z-up viewer | Binary/ASCII STL parsing. Units, orientation, partial scans and aligned bite require case-level verification. OBJ/PLY support needs separate parsing tests. |
| Single crowns | Margin, axis, STL tooth placement, `intaglio.js`, freeform and contacts | Existing sample and geometry tests. New work must retain these buffers, segmentation, settings and history. Representative technician-reviewed cases are still needed for acceptance. |
| Tooth libraries | 32 user-provided STLs, FDI atlas, shape variants, local reusable STL storage | Actual file assets are present. Provenance, usage rights, material-specific limits and fit need individual review. |
| Bridges | Manual pontics, connectors, voxel union | Simple geometry tests exist. Multiple independently prepared abutments, basal adaptation, common-axis rules and connector validation need dedicated work. |
| Analysis | Static occlusion/contacts, thickness, undercut, measurements and sections | These operations exist in `ops.js` and editor panels. Validate ranges, sign conventions and error cases before using them as manufacturing gates. |
| Project state | Local IndexedDB, editable object geometry, margins, axis, construction settings | Save/reopen tests exist. Remote account metadata is separate from local scene/files. Portable archives and remote scene sync remain future work. |
| AI | 2D semantic segmentation service; loopback ToothCraft evaluation overlay | Actual model inference, FDI instance segmentation and production crown quality are unverified. GPU inference and model/source usage rights are separate dependencies. |
| Geometry kernel | Indexed typed arrays, BVH, original JS algorithms, module workers | Suitable for the current incremental work. Existing voxel merge resamples the whole surface. Exact booleans and general offsetting need a separately evaluated backend. |

`docs/EXOCAD_GAP_ANALYSIS.md` contains a more detailed earlier inventory. Its
percentage estimates are not measurements. Completion is determined by the
acceptance criteria and verification records in this roadmap.

## Public reference scope

exocad's core covers anatomic crowns, copings/cutback, attachments, bridge
frameworks, inlays/onlays/overlays, veneers, waxups and telescopic crowns. Its
wizard and Expert mode share access to design operations. Use these workflows
to identify technician needs and input/output contracts.

https://exocad.com/our-products/dentalcad
https://wiki.exocad.com/wiki/index.php/CAD_Module
https://wiki.exocad.com/wiki/index.php/Defining_jobs_for_individual_teeth

The public Scan/3D Data Editor describes mesh selection, crop/cut/delete,
divide, gap bridging, hole closure, orientation correction and reversible
editing. The first mesh increment implements only inspection, connected-part
export and duplicate/zero-area face removal.

https://wiki.exocad.com/wiki/index.php/3D_Data_Editor

Additional product families include custom abutments and screw-retained work,
bars, physical working models, splints, provisionals, partial frameworks and
full dentures. Virtual articulation, patient jaw-motion import, DICOM viewing,
Smile Creator, photorealistic rendering and nesting broaden the ecosystem.

https://exocad.com/our-products/our-products
https://content.exocad.com/content/brochures/exocad_DentalCAD_brochure_EN_screen.pdf

## Current increment — mesh inspection and face cleanup

Purpose: inspect loaded scans and restoration objects before further editing,
extract disconnected parts and remove face defects from accepted restorations.

Workflow: Expert tools → Mesh (G) → choose object → Inspect. The panel reports
open edges, non-manifold edges, winding conflicts, duplicate faces, zero-area
faces, unused vertices and connected parts. Select a part to export its STL in
original coordinates. Face cleanup on a restoration is one Undo/Redo step and
its geometry and remapped intaglio face labels are saved with the existing scene.

- Inspection, cleanup and extraction run in the cancellable module worker.
- Connected parts share triangle edges. A vertex-only contact does not join shells.
- Cleanup preserves all coordinates and vertex IDs. It removes only repeated
  indexed faces and faces whose double area is less than `1e-12` in model units.
- Restorations retain vertex protection and rim IDs. Face labels are remapped
  through the exact retained face list. Measurements are remapped to retained
  triangles; measurements touching removed faces are removed and restored by Undo.
- Scans can be inspected and extracted. Source scan files remain the inputs to
  existing preparation segmentation. General scan repair needs its own editing
  and persistence work in the next mesh increment.
- Topology reports become stale after edits, replacement or Undo/Redo. A stale
  report cannot authorize extraction of an old component.
- Inspection bounds each object to 750,000 triangles / 2,000,000 vertices to
  contain the edge-map and worker-clone memory cost. Oversized inputs fail before
  allocating those structures.
- The report checks indexed edge topology and orientation consistency. It does
  not check triangle self-intersections, absolute outward orientation, seating
  fit, contacts or material-specific manufacturing suitability.

## Development sequence

| Stage | Professional workflow and actual result | Dependencies | Acceptance before marking complete |
| --- | --- | --- | --- |
| 0. Preserve crown baseline | Import → margin → axis → library tooth → intaglio → anatomy → contacts → save/reopen → STL | Current application and sample assets | Existing tests plus a repeatable full-browser case. Record failures before changing algorithms. |
| 1A. Mesh inspection | Diagnose face/edge defects, isolate connected components, reversible face cleanup | Existing workers, history and save format | Known open/closed/non-manifold fixtures, actual sample crown, component export round-trip, Undo/Redo and saved protected surfaces. Current increment. |
| 1B. Mesh editing and repair | Surface/through selection, crop/delete/cut, component isolation, bounded small-hole fill, explicit orientation correction | Boundary loops, robust polygon triangulation and scan edit persistence | Known cut/hole fixtures and scanned examples. Prevent accidental closure of intended openings. Undo/Redo restores original triangles and selection. |
| 1C. Geometry and export validation | Self-intersection detection, deterministic mesh reports, orientation and units, reproducible material constraints | Accelerated triangle intersection and verified material documents | Known intersecting fixtures, exact export bytes re-parsed and checked, numerical error bounds. Each reported check states what was actually evaluated. |
| 2. Reliable single-crown release | Technician can confirm each geometric step and finish a crown from a real preparation | Stage 1, current intaglio and placement | Specialist-reviewed fit/contact/thickness results across anterior, canine, premolar and molar cases; partial scans; saved design recovery; browser performance results. |
| 3. Multiple crowns and bridges | Independent units, prepared abutment margins, coordinated axes, pontic tissue contact, connectors | Per-unit state and validated geometry/booleans | At least two prepared abutments; missing/misaligned scans; connector section minimums; collision/fit checks after union; edited project reopen. |
| 4. Copings and fixed-restoration families | Controlled cutback, offset coping, inlay/onlay/overlay, veneer, scanned waxup transfer, eggshell provisionals | General offset/trim, surface correspondence, boundary constraints | Family-specific preparation fixtures, protected margins and cement surface, actual thickness results, correct output components and manufacturing handoff. |
| 5. Model Creator | Align scan, crop/base, hollow/drain, die extraction, pin/socket clearances, gingiva masks | Robust clipping/booleans, label geometry, working model parameters | Closed printable model with separately removable dies and measured clearances. Save/edit/rebuild retains per-die settings. |
| 6. Static splints and night guards | Block out undercuts, draw outline, shell/trim, set opposing clearance, finish appliance | General offsetting, registered bite, export validation | Repeatable insertion/seating checks, edge thickness, occlusion clearance and watertight output. Technician-reviewed appliance fixtures. |
| 7. Articulation and jaw motion | Set reference planes/articulator parameters, reproduce trajectories, dynamic contact analysis | Registered arches, calibrated motion data and device formats | Reproduce known transforms and measured reference motions. Distinguish static from dynamic contact results. Reopen retains the selected motion model. |
| 8. Implant foundations | Identify manufacturer scanbody, register verified library component, establish implant frame, design abutment/screw-retained crown | Manufacturer libraries, identity/version/checksum and permitted use; validated registration | Verify component and connection dimensions, registration residuals, locked mating surface, minimum walls, approved screw axis/channel and export conventions. |
| 9. Multi-implant / bars | All-on-4/6/X planning, common prosthetic setup, bar sections, screw channels and tissue relief | Stage 8 and multi-unit framework constraints | Every implant frame traces to a verified component. Fit, section, tool access and collision checks across the whole framework. |
| 10. Full dentures | Model/ridge analysis, tooth arrangement and occlusal plane, gingival base, sockets and production variants | Verified tooth library, articulation and manufacturing workflow | Editable full arch setup, correct base/tooth component separation and bonding clearances, specialist review and saved setup recovery. |
| 11. Partial dentures | Survey, insertion path, blockout, major/minor connectors, clasps, rests and retention | Framework surface construction and material constraints | Verify sections/relief/retention and framework output on representative cases. Use actual clasp geometry and insertion analysis. |
| 12. Attachments and telescopes | Verified attachment placement, subtraction, primary/secondary surfaces and friction zones | Library rights and dimensions, offset and insertion constraints | Preserve mating surfaces and direction, measured clearances, repeatable separate-part outputs. |
| 13. Aesthetic and imaging tools | Photo/face scan registration, smile planning, CT/CBCT reference, realistic rendering | Calibrated registration and DICOM/privacy handling | Landmark/transform verification, stable source references and editable plan. Track rendering separately from geometry accuracy. |
| 14. Manufacturing preparation | Milling axis/tool access, blank placement, sprues/support handoff and CAM metadata | Machine/material profiles and verified tool geometry | Validate machine constraints and final file units/orientation. Do not silently substitute one manufacturer's limits for another's. |
| 15. Team workflow and AI | Portable cases, cloud file/scene sync, review, batch jobs, controlled AI proposals | Ownership/version handling, storage recovery, dataset/model evaluation | Reopen and replay across supported browsers; interrupted upload/job recovery; real paired-case evaluation and explicit expert acceptance. |

Stage order can be adjusted when representative cases or manufacturer libraries
become available. The next stage starts from the last accepted state, and
regression checks for previous stages remain part of verification.

## Architecture decisions

### Retain for ordinary incremental work

- Existing Next/React application shell, imperative CAD editor, viewer, IndexedDB
  scene model and REST account metadata.
- Existing object IDs, margin/insertion representations, segmented crown surfaces
  and sparse geometry history. Topology changes use complete before/after states.
- Current module worker protocol, cancellation and cloned editable geometry.
- On-demand rendering and existing pixel quality control. Geometry precision
  must not depend on the viewer's render resolution.
- Per-operation validation near each geometry entry point and typed-array budgets.

### Evaluate and obtain approval before changing the architecture

| Decision | Investigation required | Change requiring approval |
| --- | --- | --- |
| General Boolean/offset backend | Compare existing voxel geometry with a maintained WASM mesh kernel on actual margins, thin walls and large cases. Verify library terms and provenance. Measure geometric error, memory and cancellation. | Add/replace the core geometry engine or change the topology representation across all modules. |
| Precision model | Measure current Float32 narrowing and accumulated error across transforms; test Float64 record geometry with separate render copies. | Migrate persistent scene geometry and every operation to a new precision contract. |
| Per-unit multi-restoration state | Inventory current single `margin`, `insertionAxis`, `crown` and preparation assumptions. Define migration and backward compatibility. | Redesign the case schema and workflow around multiple prepared units. |
| WebGPU | Profile supported browser/device coverage, worker uploads and fallback behavior. | Replace renderer or require new GPU APIs. WebGL remains the current entry point. |
| Server project storage / AI | Versioned scene/file transport, resumability, private dataset ownership and a measured inference workflow. | Move design data/inference to hosted services or change project ownership/storage semantics. |

No decision in this table is implemented by the mesh increment. A concrete
proposal must include affected files, migration, compatibility, tests and rollback
before approval is requested. Continue independent reversible work while such a
decision is pending.

## Manufacturer components and measured cases

Obtain exact manufacturer component geometry and metadata for implant connections,
scanbodies, Ti-bases, lab analogs and attachments. Store source/version/checksum,
units and component frame together. Identify which mating surfaces are immutable.
Use verified data for screw sizes, channel angulation, minimum material and
production compatibility. The implant work depends on those actual libraries.

https://exocad.com/our-products/exocad-dentalcad/implant-module
https://exocad.com/integration/dentalcad-library-integration

Collect anonymized, technician-reviewed cases per family. Record preparation and
opposing scan identities, scale/orientation, bite registration, approved margins,
axis, approved design and material/machine reference. Paired scan/crown counts and
pair quality must be measured independently from total scan count.

## Additional functionality identified during research

Track copy/mirror anatomy, gingiva construction, thimble crowns, scanned waxup
transfer, attachment Boolean workflows, telescopic friction surfaces, guided and
Expert operation, library registration, removable gingiva masks, articulated
models, jaw-motion import, DICOM/face reference, smile planning, realistic display,
nesting/tool access, portable projects, review/communication and batch proposals.
Some are cross-module capabilities, and their acceptance criteria belong to the
owning stage above.

https://wiki.exocad.com/wiki/index.php/Telescopic_crowns
https://exocad.com/our-products/exocad-dentalcad/provisional-module
https://exocad.com/our-products/exocad-dentalcad/bar-module
https://wiki.exocad.com/wiki/index.php/Model_Creator_Module
https://wiki.exocad.com/wiki/index.php/Model_Design
https://exocad.com/our-products/exocad-dentalcad/bite-splint-module
https://exocad.com/our-products/exocad-dentalcad/full-denture-module
https://exocad.com/our-products/exocad-dentalcad/partialcad
https://exocad.com/our-products/exocad-dentalcad/virtual-articulator
https://exocad.com/our-products/exocad-dentalcad/jaw-motion-import
https://exocad.com/our-products/exocad-dentalcad/dicom-viewer
https://exocad.com/our-products/exocad-dentalcad/smile-creator
https://exocad.com/our-products/exocad-dentalcad/trusmile-module

## Verification log

- Baseline at `06142ea`: `npm test` passed before the new geometry entry points.
- Stage 1A: full `npm test` passed, including the existing Crown Design,
  margin, anatomy placement, intaglio, worker, workflow and geometry regressions.
- `npm run test:mesh`: 6/6 tests passed, including actual module-worker transport,
  disconnected shells, invalid inputs, face provenance, measurement remapping,
  protected crown intaglio, Undo/Redo and saved-scene reopen. Painting is mocked
  in editor unit tests; geometry, history and serialization are real.
- `npm run build` passed. `git diff --check` passed.
- Live browser check was attempted with an isolated harness importing the actual
  viewer/editor/panel/worker modules. The browser reported `WebGL unavailable`
  before editor initialization. Interactive WebGL behavior and authenticated
  application integration remain unverified; this is not a browser QA pass.
- The existing lockfile lacked transitive optional dependency entries and failed
  `npm ci`. Regenerating it repaired the lock without adding runtime dependencies.
- Remaining stages are planned. Stage 1A does not certify fit, self-intersection
  freedom or manufacturing readiness.
