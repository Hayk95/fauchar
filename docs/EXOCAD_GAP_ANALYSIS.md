# exocad DentalCAD feature coverage: what FAUCHAR has, what is missing, what to build next

Reviewed 2026-11-16 against the public exocad wiki (DentalDB, DentalCAD wizard, Expert mode,
Tools, Hotkeys, and the module index) and against the code in `lib/client/**`, `server/**`,
`services/**`. Legend: ✅ implemented and wired to real geometry · 🟡 partial (works for the
simple case, or a different approach) · ❌ absent. A panel that only shows a label is counted as ❌.

**Honest framing.** exocad is 20 years of engine work plus licensed libraries. FAUCHAR today is a
complete, real single-crown and simple-bridge pipeline (scan → margin → axis → crown bottom →
library tooth → placement → freeform → contacts → connectors → merge → STL) running in the
browser with workers, undo and local persistence. That is roughly the "Anatomic crown / Anatomic
pontic" slice of exocad, at maybe 55–60 % feature depth inside that slice, and 0 % of every other
module. The plan below orders the work so each stage is shippable on its own.

Sources: wiki index, "wizard steps for a typical design", "Defining jobs for individual teeth",
"Detect / edit margins", "Setting insertion axis", "Designing the inside of the crown", "Correct
Tooth Placement", "Freeforming", "Anatomic Reduction", "Generating connectors", "Merge and Save",
"Expert Mode", "Tools", "Advanced options", "Copy/Mirror Tooth", "Visualizing intersections",
"Hotkeys", "AI Crown Design", "DentalCAD - overview" (all wiki.exocad.com, read 2026-11-16).

---

## 1. Code inventory (what exists today)

| Area | Where | Notes |
| --- | --- | --- |
| Job definition (DentalDB clone) | `lib/client/case-intake.js`, `case-plan.js`, `dental-chart.js` | Arch chart, 28 indications listed (4 enabled: crown, pontic, antagonist, adjacent), 13 materials, shades, cement/wall sliders, Ctrl-click copy, crown/bridge shortcuts, role-driven scan plan, IndexedDB save. |
| Scan import | `public/stl-worker.js`, `case-intake.js` | Binary/ASCII STL only. |
| Tooth identification | `cad/teeth.js` | Geometric arch numbering, manual renumber/merge/remove, appointment number anchored to a detected prep. |
| Workflow wizard | `cad/workflow.js`, `cad/session.js` | 10 steps, prerequisite gates, Wizard/Expert toggle, object bar, command rail. |
| Margin | `cad/editor.js`, `cad/ops.js` (`detectMargin`, `snapLoop`, `smoothLoop`, `magnetPoint`) | One-click detection, free draw, magnetic snap, handle edit, soft adjust, resample 12/24/48, smooth, snap, isolate tooth. |
| Insertion axis | `ops.bestInsertionAxis`, `undercutMap`, `editor.axisFromView/axisFromTilt` | Set from view, best fit, tilt, undercut map + % readout. |
| Crown bottom | `cad/crown-builder.js`, `cad/tooth-library-stl.js`, `kernel-worker.js` | Cement gap, margin gap, wall, margin border, emergence band; library tooth fitted to margin in a worker; closed solid. |
| Tooth library | `public/assets/teeth/*.stl`, `tooth-atlas.js`, `anatomy-library.js`, `tooth-forms.js` | 32 user-supplied STLs + 6 parametric variations; local user STL library (`restoration-library.js`). |
| Placement | `editor` gizmos, `seat-tooth.js` | Move/rotate/scale, numeric nudge, free drag, ±2 % size, reset. |
| Freeform | 8 brushes (`BRUSHES`), `ops.brushStamp/smoothWeighted`, anatomy sliders (`deformAnatomy`, `zoneWeights`) | Protected intaglio/margin, axial-only grab, restore-original. |
| Contacts/occlusion | `ops.signedGap/gapStats/relieve/buildToward/setClearance` | Static distance maps, target clearance, mesial/distal target gap fit. |
| Bridge | `ops.makePontic/makeConnector/unionMeshes` | Pontic from crown anatomy, connectors (w/h/waist/offset, min area readout), voxel union. |
| Review | `thicknessMap`, `cementMap`, `sliceMesh`, measure distance/thickness/angle, compare original/edited/overlay/deviation | |
| Export/persist | `writeBinarySTL`, merged/shells/unit export, IndexedDB scene incl. workflow state | No `.constructionInfo`-like sidecar. |
| Backend | `server/routes/projects.js` (CRUD metadata), MySQL | No scene/file sync. |
| AI | `services/tooth-seg` (2D, broken checkpoint, not used), ToothCraft evaluated, not runnable here | |

---

## 2. Core wizard: feature-by-feature

### 2.1 DentalDB – job definition

| exocad | FAUCHAR | Gap / what to add |
| --- | --- | --- |
| Tooth click → 3-column dialog (type / production+material / options) | ✅ | — |
| 28 restoration types | 🟡 4 enabled | Engines for the others (see §4). |
| Ctrl-click copy settings | ✅ | — |
| Shift-click range, click-and-drag to copy | ❌ | Small: `case-intake.js` pointer handlers. |
| Production method (3/4-axis vs 5-axis) driving a **unique insertion axis** for bridges | 🟡 field exists, no effect | Pass to editor; enforce common axis for bridge units in 3/4-axis mode. |
| Material drives parameter min/max and defaults | 🟡 13 materials, cement/wall only | Material table with per-material limits (min wall, min connector area, cement default, milling tool). |
| Dentist-specific stored defaults (red/yellow/white) | ❌ | Client-scoped defaults in IndexedDB + server. |
| Implant-based options (custom abutment / screw-retained / stock abutment), post & core, on substructure scan | ❌ (UI stubs) | Implant module, §4. |
| Pre-op model, extra gingiva scan, bite scan | 🟡 uploaded & displayed only | Pre-op → copy/mirror pipeline (§2.5); gingiva → basal adaptation; bite → registration. |
| Antagonist scan type (bite impression vs two models) | ❌ | Field + registration behaviour. |
| Omit in bridge | ❌ | Allow connectors across a skipped tooth. |
| Load / duplicate project, "Open in explorer", Ctrl+N/L/S/D | 🟡 list/open; no duplicate | Duplicate case (deep copy of files + job). |
| Work-type style (colorful / minimalistic) | ❌ | Cosmetic setting. |

### 2.2 Margin

| exocad | FAUCHAR | Gap |
| --- | --- | --- |
| One-click automatic detection from a seed | ✅ | — |
| 2D section "bubble" under cursor while seeding | ❌ | Live cross-section preview (reuse `sliceMesh`). |
| Add correction points to steer detection | 🟡 draw/handles after detection | Re-run detection through user points (constrained path). |
| Supragingival / Subgingival (convex vs concave feature line) | ❌ | Curvature sign option in `magnetPoint`/`detectMargin`. |
| Draw Free / Draw Magnetic / Edit modes | ✅ | — |
| Remove point with L+R click; add point on line | 🟡 insert exists; delete via key | Pointer gesture parity. |
| Move margin up/down (+/-) | ❌ | Offset loop along insertion axis. |
| Auto-hide adjacents (sectioned models) | 🟡 "show only this tooth" | — |
| Adjust light from view | ❌ | Viewer light direction control. |
| Repair/Draw: repair scan around margin, smooth margin, reset repaired scan, repair radius | ❌ | Local mesh repair (hole fill + smoothing) within radius; keep original. |
| Inlay: 4-point detection | ❌ | With inlay engine. |
| Hotkeys 1/2/3/4, +/-, Ctrl+X, PgUp/PgDn orbit | 🟡 M/Enter/Esc/Del | Add exocad key map (see §2.11). |
| Imported margins / auto-accept setting | ❌ | Margin import (from scanner JSON/XML) + setting. |

### 2.3 Insertion axis

| exocad | FAUCHAR | Gap |
| --- | --- | --- |
| Auto-detect, show from axis, undercut colour scale | ✅ | — |
| Set current view as axis | ✅ | — |
| Drag arrow-tip sphere to adjust | 🟡 tilt sliders | 3D handle on the arrow. |
| Common axis across selected teeth / unique axis for bridge | ❌ | Needs multi-unit prep model (today: one prep). |
| Only prompt when uncertain | ❌ | Confidence heuristic to skip the step. |

### 2.4 Crown bottom (inside of the crown)

| exocad | FAUCHAR | Gap |
| --- | --- | --- |
| Cement gap value, margin gap | ✅ | — |
| **Painted cement-gap zones** (yellow/green brush, third zone with own width) | ❌ | Brush on prep mesh → per-vertex gap weights into `setCementGap`. |
| Axial / radial extra spacing (lockable) | ❌ | Two offsets in intaglio build. |
| Crown border: horizontal, angled length, angle, vertical, below-margin | 🟡 single "margin border" | Full 5-parameter border profile in `crown-builder.js`. |
| **Undercut block-out** (on/off, angle, untouchable zone near margin) | ✅ 2026-11-16 (`cad/intaglio.js`) | Cylindrical hull per meridian; zone keeps the edge on the margin; zone 0 opens the edge. Applies to library-tooth crowns, not the procedural fallback starter. |
| Milling tool compensation (diameter, bullnose, flat %) | ✅ 2026-11-16 | Per-meridian opening in the height/radius plane; relief capped at the tool radius; reported separately for wall and top. Not a full 3D opening. |
| Show remaining undercuts | 🟡 prep undercut map only | Map on intaglio after block-out. |
| Apply (non-realtime) | ✅ worker | — |

### 2.5 Copy / Mirror / Pre-op / Virtual extraction

| exocad | FAUCHAR | Gap |
| --- | --- | --- |
| Direct copy of a scanned tooth as model tooth | ❌ | Tooth segmentation from the scan (have arch regions in `teeth.js`) → extract crown shell → fit to margin like a library tooth (`fitLibraryCrown` already accepts an open shell). |
| Mirror cross-arch | ❌ | Mirror plane from arch fit + same pipeline. |
| Virtual pre-op from several teeth | ❌ | — |
| Correct tab (brush to fix extracted region) | ❌ | — |
| Virtual extraction with gingiva collapse | ❌ | — |
| Automated pre-op (copy from the pre-op scan) | ❌ | Pre-op is uploaded already; needs registration + extraction. |

### 2.6 Tooth placement

| exocad | FAUCHAR | Gap |
| --- | --- | --- |
| Move / rotate / scale, axis restriction, Ctrl/Shift modifiers | ✅ | — |
| Move all simultaneously | ❌ | Group transform. |
| Tooth library switch (dropdown, Ctrl+wheel) | 🟡 6 variations of one library | Multiple library sets; licensed sets are a business question. |
| Advanced: instant anatomic morphing, axis scaling, ROI freeform, parts freeform | 🟡 anatomy sliders after placement | Make anatomy deformation live during placement. |
| Anterior symmetry / 1-to-1 mirroring | ❌ | Multi-unit anterior cases. |
| Cut / deform with antagonist while moving; keep minimum thickness live | ❌ | Run `setClearance`/`enforceThickness` on drop (worker). |
| Natural abrasion slider | 🟡 "Worn" variation | Continuous abrasion parameter. |
| **Chain mode** (chain/single/tube, pins, keep-in-contact, symmetry, reset options) | ❌ | Requires multi-unit placement model; big item. |
| Choose a different library tooth per unit | ✅ | — |

### 2.7 Freeforming

| exocad | FAUCHAR | Gap |
| --- | --- | --- |
| Free: add/remove, smooth/flatten, strength, size | ✅ | — |
| Brush types (ball / pointed / flat) | ❌ | Falloff kernels in `brushStamp`. |
| Ctrl shape-preserving smooth | 🟡 | — |
| Anatomic presets: cusps / tooth parts / entire tooth / ridge | 🟡 sliders + ridge brush | Click-drag on cusp/part using atlas landmarks (`tooth-atlas.js` has occlusal outline; add cusp tips). |
| Lock cusp tips / lock equator / occlusal only | 🟡 axial-only | Constraint weights. |
| Paint & Pull (moving / elastic / static areas, advanced) | ❌ | Painted-weight Laplacian deformation (have `zoneWeights`, `offsetByWeights`). |
| Adapt: static occlusion (direct cut vs shape-preserving, desired distance, exclude painted parts) | 🟡 target clearance + relieve/build | Add shape-preserving mode + exclusion brush. |
| Adapt: approximal to adjacents | ✅ mesial/distal targets | — |
| Adapt: basal to gingiva (distance, pull down) | ❌ | Gingiva scan exists; add basal gap op for pontics. |
| Dynamic occlusion | ❌ | Needs articulator (§4). |
| Cut all intersections (Ctrl+X/G/N/A) | 🟡 occlusal only | One command over antagonist+adjacents+gingiva. |
| Attachments / text attachments | ❌ | Attachment library + boolean union (have `unionMeshes`). |
| Visualize affected area in green while forming | ❌ | Overlay weights. |

### 2.8 Anatomic reduction (coping / cutback)

Entirely ❌. Required for Coping, Reduced pontic, Pressed crown, Reduced waxup, and most
zirconia-layered work. Needs: offset-inward with enforced min wall (have `enforceThickness`
in the other direction), exclude-brush, lingual % reduction, lingual band collar, multi-level
reduction, basal reduction depth, cutback design library (facial/incisal patterns), toggle anatomic ↔ reduced.

### 2.9 Connectors

| exocad | FAUCHAR | Gap |
| --- | --- | --- |
| Min cross-section area **or** height/width | 🟡 w/h sliders + area readout | Enforce minimum automatically; red when it fails. |
| Shapes presets | ❌ | Shape catalogue (round, oval, drop, trapezoid). |
| Visualize connector thickness (magenta where thin) | ❌ | Thickness map on connector. |
| Minimum basal distance to jaw/gingiva | ❌ | Clamp against gingiva scan. |
| Advanced placement (below / behind approximal contact), auto-apply | 🟡 up/down offset | Contact-point-relative placement. |
| Drag connector, Ctrl-click to move one docking point | 🟡 from/to selection | Direct manipulation. |
| Multi-view 2D/3D editor, control-point free curve, copy ring | ❌ | Multi-viewport section editor. |
| Omit-in-bridge spans | ❌ | — |

### 2.10 Merge and save

| exocad | FAUCHAR | Gap |
| --- | --- | --- |
| Merge all parts, one mesh per physical part, progress/cancel/restart | ✅ worker | — |
| Optimize for 3D printing (watertight, no inner surfaces) | 🟡 voxel union is watertight but coarse; shells are not | Exact boolean / remesh pass. |
| `.constructionInfo` (margins, axes, tooth numbers for CAM) | ❌ | Write a JSON/XML sidecar with margin loops, insertion axes, FDI, material, cement params. |
| Remove merged parts → re-enter expert | 🟡 edit remains possible | — |
| Save scene / save as / export visible to STL / scan info / OBJ tooth models | 🟡 IndexedDB scene, STL | File-based scene export/import (portable `.json` + blobs) and cloud sync via `server/routes/projects.js`. |
| 3D PDF, HTML export, dentalshare webview link | ❌ | HTML export is cheap (self-contained viewer); 3D PDF is niche. |
| Screw holes through superstructure | ❌ | Implant module. |
| Next steps: Design model / Proceed to production | ❌ | Model Creator / CAM. |

### 2.11 Expert mode, tools, navigation, hotkeys

| exocad | FAUCHAR | Gap |
| --- | --- | --- |
| Expert: jump freely between steps | ✅ | — |
| Context menu (root / per tooth / multi-select) | ❌ | Right-click menu with per-object actions (change margin, change type, connectors…). |
| Expert toolbar with next-step highlighted, pin | 🟡 step bar | — |
| Change reconstruction type in CAD | ❌ | After cutback engine exists. |
| Group selector with per-group transparency, Alt = show all, Auto-hide opposing jaw | 🟡 object bar | Grouped tree + auto-hide. |
| Custom views (Ctrl+F1/F2) | ❌ | Save camera presets. |
| Measurement tool (distance / thickness / spacing) | ✅ | — |
| Sectional view / Cut view window | 🟡 clipping plane | Dedicated 2D section window with contours of all objects. |
| Screenshot, image management, 2D image loader | ❌ | Canvas capture is trivial; image management later. |
| Align meshes (3-point + best fit) | ❌ | ICP in worker; unlocks bite/pre-op/antagonist correction. |
| Adjust light | ❌ | — |
| Annotation editor | ❌ | — |
| Add/remove mesh, mesh editor (delete, crop) | ❌ | Scan clean-up (artifact removal). |
| Tooth colour selection / TruSmile / colour-texture scans | 🟡 single material | PLY/OBJ with vertex colour import; shade-mapped rendering. |
| Free-text search for features | ❌ | — |
| Settings (language, numbering scheme, GPU, UI) | ❌ | Universal/FDI numbering at least. |
| Hotkeys: full exocad map (Ctrl+Space next, Numpad views, A/C/P/S/G/B group toggles, 1–7 in freeform, Ctrl+T/U/M…) | 🟡 own map | Offer "exocad key map" option. |
| Touch / 3Dconnexion | ❌ | — |

---

## 3. Infrastructure gaps that block many features

1. **Multi-unit preparation model.** Editor holds one `prep`/`margin`/`insertionAxis`. Bridges with
   several abutments, common axis, per-tooth parameters and the context menu all need
   `units[].{margin, axis, prep, params}`. This is the first refactor to do.
2. **Mesh registration (ICP).** Needed by bite registration, pre-op, antagonist correction,
   copy/mirror, model creator.
3. **Robust booleans / remesh.** Voxel union is a stopgap; cutback, attachments, screw channels,
   block-out and print-ready output need an exact mesh boolean (or an isosurface remesh at ≤0.05 mm).
4. **Scan segmentation.** Arch-geometry numbering is fragile on partial arches. A real
   tooth/gingiva segmentation (mesh-based, runs locally or as a service) unlocks copy/mirror,
   adjacency-aware contacts, chain mode and AI crown input. `services/tooth-seg` is 2D and not
   wired; replace with a 3D model or a geometric fallback that is validated on 20+ real scans.
5. **Import formats.** PLY/OBJ (with colour), scanner margin/axis metadata, DCM order files.
6. **Scene file + sync.** Portable scene export, server storage of scans/scenes, resume on another
   machine. Today everything is IndexedDB-local.
7. **Material parameter tables.** Min wall, min connector, cement, tool diameter, cutback per material.
8. **Real-case validation set.** The crown pipeline was verified on one real scan (22) and one
   synthetic 46. Collect 20–50 anonymised cases (upper/lower, anterior/posterior, bridges) and
   turn them into regression fixtures before adding engines.

---

## 4. Modules with zero coverage

| Module | What it is | Dependencies | Size |
| --- | --- | --- | --- |
| Coping / cutback (Anatomic reduction) | Framework from anatomy with veneer space | §3.3 booleans | M |
| Inlay / Onlay / Veneer / Overlay | Partial-coverage with multi-point margin, no insertion block-out, veneer min thickness | multi-margin, §3.3 | M–L |
| Provisional (eggshell) | Design on un-prepped scan, hollow shell with wall | pre-op registration | M |
| Waxup / digital copy milling | Replicate a scanned wax-up over a prep | registration, segmentation | M |
| Telescopic crowns, post & core | Primary/secondary with parallel walls, friction | §3.3 | M–L |
| Implant module | Scanbody matching, emergence profile, custom abutment, screw channel (straight/angulated), screw-retained bridges, hybrid/All-on-X | scanbody libraries (licensing!), registration, booleans | XL |
| Bars / split bars | Bar pillars & segments on implants | implant module | L |
| Bite splint | Bottom, blocking, tooth placement, top, adaptation | articulator helpful | L |
| Full / partial denture | Occlusal rim, tooth setup, gingiva design, duplication, overdentures | libraries, articulator | XL |
| Partial frameworks (PartialCAD) | Clasps, meshes, finish-line profiles | | XL |
| Model Creator | Plateless/plated models, segmentation into dies, articulator interfaces, implant models | registration, booleans | L |
| Virtual articulator / jaw movement | Average-value articulator, patient jaw motion, dynamic occlusion | | L |
| Smile Creator / TruSmile video / 2D images / DICOM | Photo matching, realistic rendering, CBCT view | | L–XL |
| Attachments | Library + boolean place/subtract | booleans | S–M |
| dentalshare / webview / HTML export | Case sharing, 3D preview links | server storage | M |
| CAM (exocam) / nesting | Toolpaths, nesting | out of scope; keep STL + constructionInfo handoff | — |
| AI Crown Design (cloud) | Style, dist-to-antagonist/adjacent, contact area, smooth↔detail, hi-res; needs ≥4 teeth + adjacents | segmentation, a model you have rights to deploy (ToothCraft weights are CC BY-NC) | L + licensing |

---

## 5. Recommended order

**Stage A – make the existing crown workflow production-grade (4–6 weeks)**
1. ~~Undercut block-out + margin untouchable zone + tool compensation in crown bottom.~~ Done 2026-11-16.
2. Painted cement-gap zones; axial/radial spacing; 5-parameter border.
3. Margin: section bubble, supra/sub-gingival, move up/down, correction points steering detection, repair-around-margin.
4. Cut all intersections (antagonist + adjacents + gingiva); basal adaptation for pontics; shape-preserving occlusal adapt.
5. Brush types; cusp/parts/entire presets using atlas landmarks; lock cusps/equator.
6. Connectors: auto-enforce min area, red/magenta warnings, shape presets, basal distance.
7. `constructionInfo` sidecar; HTML export; screenshot; custom views; exocad hotkey map.
8. Real-case regression set (§3.8) and browser E2E for the full wizard.

**Stage B – multi-unit and expert parity (6–8 weeks)**
9. Multi-unit prep/margin/axis model; common insertion axis; per-tooth parameters; context menu.
10. Chain mode (chain/single/tube, keep-in-contact, symmetry).
11. Mesh registration (ICP) → bite, pre-op, antagonist correction, Align Meshes tool.
12. Copy / mirror / virtual pre-op from scan; automated pre-op.
13. Material parameter tables + dentist defaults; PLY/OBJ colour import; scene export + server sync.

**Stage C – new indication engines (8–12 weeks)**
14. Exact mesh booleans / remesh.
15. Cutback engine → Coping, Reduced pontic, Pressed crown, Reduced waxup; change type in CAD.
16. Inlay/Onlay/Veneer; Provisional eggshell; Waxup copy-milling; Attachments; Telescopes.

**Stage D – modules (quarters, each)**
17. Implant module (scanbodies, abutments, screw channels) — highest commercial value after crowns.
18. Model Creator; Virtual articulator + dynamic occlusion; Bite splint.
19. Dentures, partial frameworks, bars; Smile Creator; AI crown service (own model, own rights).

Out of scope unless a partner exists: licensed tooth/implant/attachment libraries, exocam, dentalshare network, DICOM. Those are contracts, not code.

---

## 6. What "works maximally well" means in practice

- Every geometry op in a worker with cancel, progress and a memory preflight (already the pattern in `kernel-worker.js`); nothing blocks the frame.
- Watertight, self-intersection-free output from the merge step, checked by `meshStats` and a self-intersection test before download.
- Fit parameters (gap, border, block-out, tool) that match a material table and are reproducible from the saved scene.
- A fixture set of real cases per indication; `npm test` runs geometry regression on them.
- Keyboard-first UI with the exocad key map, context menu, and group selector so a technician trained on exocad is productive in an hour.
