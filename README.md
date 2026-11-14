# FAUCHAR

## Dental CAD workspace

Open a case in `/workspace` to enter the CAD-only editor. The floating wizard,
object visibility controls, right command rail and expert toolbar use the same
general desktop layout and core crown/bridge order documented by DentalCAD.
These are original FAUCHAR implementations, not exocad code, assets or libraries.

For a scan-only case: review the scan and its orientation, draw the preparation
margin, set the insertion direction, then choose **Crown bottom → Build editable
crown**. Finish the procedural starter with Placement, Freeforming, Contacts and
Review, and export the edited STL. A restoration STL can also be imported.
Generation and merged export run in cancellable module workers. **Quality** on
the right switches preview pixel density without changing export resolution.

Designs, margins, parameters and the workflow step are saved to IndexedDB in the
same browser. They are not cloud backups. See
[workflow and capability coverage](docs/DENTALCAD_WORKFLOW.md) for supported
geometry, missing modules, verification and the exact limitations of starters.

```bash
npm ci
npm test
npm run build
```

Next.js App Router site for FAUCHAR — dental intelligence marketing site and local workspace preview.

## Develop

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

| Route | Description |
|-------|-------------|
| `/` | Marketing landing |
| `/privacy` | Privacy policy |
| `/terms` | Terms |
| `/workspace` | Local case / STL workspace |

## Build

```bash
npm run build
npm start
```

## Notes

- Design CSS lives in `styles/` (`style.css` for marketing, `app.css` for workspace).
- Client behavior for CAD and workspace is preserved in `lib/client/` modules.
- Static media is under `public/assets/`.
- `_legacy/` holds the previous static HTML/JS snapshots (not part of the app).
