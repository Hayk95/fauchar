# Reference screen coverage and production readiness

The user supplied three frames and this video URL:
https://www.youtube.com/watch?v=-NkAd-v5AnQ
The video could not be retrieved in this environment. No claim is made to have
watched the full video. The supplied frames and the public official documentation
are the visual/behavior references for this change.

## Implemented in this iteration

- Large three-column tooth definition: 28 grouped/color-coded indications,
  13 original vector material thumbnails, shade chips, production metadata,
  scan options and live cement/minimal-wall sliders. All pictured indication
  groups are represented. Icons/art are original SVG, not extracted vendor assets.
- Crown, pontic, adjacent and antagonist remain the implemented indications.
  Other engines are explicitly disabled. Listing an indication is not an engine.
- Four original parametric morphology styles (Balanced, Soft, Pronounced, Worn)
  have distinct, editable generated outer relief. FDI determines incisor,
  canine, premolar, upper molar or lower molar morphology. Matching thumbnails
  sample the same function. They are not manufacturer/scanned tooth libraries.
- The generation worker, undo and saved construction use the selected style.
  The intaglio and rim remain independent of outer morphology; tests compare
  intaglio coordinates across all four styles on the real sample preparation.
- Browser-local user restoration STL library. Add closed binary STL files
  (20 MB/100,000 triangles maximum), retain FDI/name metadata, reload catalog,
  and import into the actual editable scene using the existing restoration
  importer. Catalog reads omit geometry buffers. Only selected geometry is read.
  Library import preserves coordinates and requires manual positioning/fit review.
  This is not a general natural-tooth fitting engine or an exocad library importer.

## AI / external model investigation (2026-11-14)

| Candidate | Verified source facts | Integration decision |
| --- | --- | --- |
| ToothCraft | Author repository documents PyTorch 2.9/CUDA setup, SDF preprocessing and Hugging Face checkpoints. Source is AGPL-3.0 with a separate commercial-license offer. Published checkpoint collection is labeled CC BY-NC 4.0. | Not bundled or executed. A proprietary commercial deployment needs compatible source AND weight rights, GPU inference, preprocessing and output validation. |
| DMC | Authors publish research code for dental mesh completion. The inspected root does not expose a clear LICENSE entry or a turnkey hosted inference API. | Not bundled; redistribution rights/checkpoints/deployment remain unverified. |
| ToothForge | Research on synthetic tooth generation using a private crown dataset. | Not a verified drop-in patient-specific production crown service. No weights/assets copied. |
| BodyParts3D / teeth-3d | The explorer documents separate CC BY-SA 2.1 Japan anatomy model rights and MIT application code; 28 educational permanent teeth. | Not bundled as restorative crown anatomy. Rooted educational teeth are not validated restorative crowns. |

Sources:
- https://wiki.exocad.com/wiki/index.php/Defining_jobs_for_individual_teeth
- https://wiki.exocad.com/wiki/index.php/Freeforming
- https://github.com/ikarus1211/VISAPP_ToothCraft
- https://huggingface.co/DejvaX/ToothCraft/tree/main
- https://github.com/Golriz-code/DMC
- https://github.com/tiborkubik/toothForge
- https://github.com/organui/teeth-3d

## 2026-11-15 continuation

The public DentalDB window is the appointment page: Project on the left, Job definition with one oval arch in the center, Actions on the right. Tooth numbers sit outside the symbols. Clicking a tooth opens the three-column definition (restoration, material, options). OK commits; Cancel leaves the saved job unchanged. A lower-right first molar, FDI 46, with an anatomic crown, zirconia and shade B2 requests a lower preparation scan and an upper antagonist scan.

The WebGL Segmentation button still calls the local arch-geometry numbering in `lib/client/cad/teeth.js`. It does not call `services/tooth-seg/app.py`. That 2D service remains a separate image-mask path. Its classes are tooth types, not FDI numbers, and `services/tooth-seg/best_model.pth` is a broken symlink: `/Users/haykmaruqyan/Downloads/best_model.pth` is not on this machine. An appointment number is used as a proposal. One detected preparation stump can receive that number. The amber highlight means it is not confirmed. A technician correction is stored with the design and reapplied when the case is reopened, provided the arch sampling length still matches.

ToothCraft was not executed. This computer is an Apple M4 Pro with Metal, not CUDA. PyTorch is not installed, and the normal-control / diffusion checkpoints are not present. The published weights are CC BY-NC 4.0 and the author terms separate internal evaluation from commercial production. No patient scan was sent anywhere. The crown that can be built today is the local editable starter, not a ToothCraft surface.

## Validation of this iteration

Chromium static intake harness: full three-column layout, material cards and
shade selection. Separate browser harness using the actual library module:
store a synthetic closed octahedron, reload the page, read metadata-only catalog,
retrieve STL and validate its closed 8-triangle geometry. Neither harness is
shipped. This does not exercise real WebGL library import/placement end to end.
Headless tests cover all four styles, inner-surface preservation, library mesh
rejection, toolbar/panel rendering and actual intake state propagation.

## Concrete gaps before a production release

1. Validate the complete Next/WebGL application in supported desktop browsers,
   including large user scans, uploads, storage quota/recovery, workers and export.
   Static intake QA and headless geometry tests are not that acceptance test.
2. The current single-preparation crown builder assumes a star-shaped margin and
   visible scan along the insertion direction. General preparations, holes,
   undercuts, arbitrary library-fitting and multi-unit automation need real
   geometry-engine work with representative case fixtures.
3. Copings/cutback, pressed/eggshell work, inlays/onlays/veneers, waxup transfer,
   implants/abutments/screw channels, bars/telescopes, removable dentures,
   splints, virtual gingiva and thimble workflows require their own implemented
   geometry, constraints, persistence and end-to-end validation. They are absent.
4. No manufacturer tooth/implant/attachment library pack has been licensed,
   obtained, imported or tested. User-STL reuse does not supply those packs.
5. Production material limits and CAM presets need actual manufacturer data;
   material names/shades in this UI currently describe planning choices.
6. Crown output requires expert assessment of anatomy, fit, occlusion, contacts,
   minimum thickness and manufacturability. A closed manifold alone is not proof.

This branch remains a draft implementation. It does not establish 1:1 exocad
parity, clinical validation, or a finished production release.
