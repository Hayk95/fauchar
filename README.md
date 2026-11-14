# FAUCHAR

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
