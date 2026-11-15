// Tooth identification on the real sample jaws: node scripts/test-teeth.mjs [debug-dir]
// With a debug dir it also writes an occlusal height-map image per jaw, to check numbers by eye.
import { readFileSync, writeFileSync } from "node:fs";
import { V, parseBinarySTL } from "../lib/client/cad/mesh.js";
import * as ops from "../lib/client/cad/ops.js";
import { anchorJobTooth, detectTeeth, labelTeeth } from "../lib/client/cad/teeth.js";

const dir = new URL("../public/assets/sample/", import.meta.url);
const load = (name) => {
  const b = readFileSync(new URL(name, dir));
  return parseBinarySTL(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
};
const debugDir = process.argv[2];
let failed = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "pass" : "FAIL"}  ${label}${detail ? `  ·  ${detail}` : ""}`);
};

{
  const model = {
    jaw: "lower", status: "ok", anteriorKnown: false,
    frame: { a: [1, 0, 0], b: [0, 1, 0], O: [0, 0, 1] },
    curve: { points: [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]] },
    teeth: [
      { fdi: 36, from: 0, to: 1, width: 10, center: [0.5, 0, 0], stump: true, confidence: 0.8 },
      { fdi: 35, from: 2, to: 4, width: 7, center: [3, 0, 0], confidence: 0.8 },
    ],
  };
  anchorJobTooth(model, 46);
  check("a single preparation stump takes the appointment number 46", model.teeth.some((t) => t.fdi === 46), model.teeth.map((t) => t.fdi).join(" "));
  check("46 stays unconfirmed until a technician sets it", model.jobToothConfirmed === false);
  model.status = "reviewed"; model.teeth[0].manual = true; model.teeth[0].fdi = 46;
  anchorJobTooth(model, 46);
  check("a reviewed correction confirms 46", model.jobToothConfirmed === true);
}

// Scan axes of this case: Z-up, upper teeth point toward -Z.
const crownRaw = load("demo-crown-22.stl");
const crown = ops.makeMesh(crownRaw.positions, crownRaw.indices);
const seg = ops.segmentCrown(crown);
const rim = Array.from(seg.rimLoop, (v) => [crown.pos[v * 3], crown.pos[v * 3 + 1], crown.pos[v * 3 + 2]]);
const crownPoint = rim.reduce((s, p) => V.add(s, p), [0, 0, 0]).map((x) => x / rim.length);

function run(name, jaw, occlusal, anchor = null) {
  const raw = load(name);
  const t0 = performance.now();
  const model = detectTeeth(raw.positions, raw.indices, jaw, { occlusal, anchor });
  const ms = performance.now() - t0;
  console.log(`\n${name} (${jaw}): ${model.teeth.length} teeth in ${ms.toFixed(0)} ms, status ${model.status}, arch ${model.archLength?.toFixed(0)} mm, turning ${model.archTurn?.toFixed(0)}°`);
  for (const t of model.teeth) console.log(`  ${t.fdi ?? "??"}  width ${t.width.toFixed(1)} mm  confidence ${t.confidence}${t.stump ? "  prepared" : ""}${t.partial ? "  cut off by scan" : ""}`);
  if (debugDir && model.curve) writeDebug(name, model);
  return { raw, model };
}

function writeDebug(name, model) {
  const { map, curve } = model;
  const scale = 3;
  const W = map.w, H = map.h;
  const lo = model.top - 12;
  const img = new Uint8Array(W * H * 3);
  for (let k = 0; k < W * H; k++) {
    const g = map.grid[k];
    const c = g < -1e8 ? 0 : Math.round(255 * Math.max(0, Math.min(1, (g - lo) / 12)));
    img[k * 3] = c; img[k * 3 + 1] = c; img[k * 3 + 2] = c;
  }
  const marks = model.teeth.map((t) => {
    const mid = curve.points[Math.round((t.from + t.to) / 2)];
    const cut = curve.points[t.from], nrm = model.normals[t.from];
    return { fdi: t.fdi, x: (mid[0] - map.u0) / map.cell, y: (mid[1] - map.v0) / map.cell, cx: (cut[0] - map.u0) / map.cell, cy: (cut[1] - map.v0) / map.cell, nx: nrm[0], ny: nrm[1] };
  });
  const last = model.teeth[model.teeth.length - 1];
  if (last) {
    const cut = curve.points[last.to], nrm = model.normals[last.to];
    marks.push({ fdi: "", x: 0, y: 0, cx: (cut[0] - map.u0) / map.cell, cy: (cut[1] - map.v0) / map.cell, nx: nrm[0], ny: nrm[1] });
  }
  const line = curve.points.filter((_, i) => i % 2 === 0).map((p) => [(p[0] - map.u0) / map.cell, (p[1] - map.v0) / map.cell]);
  const base = `${debugDir}/${name.replace(".stl", "")}`;
  writeFileSync(`${base}.raw`, Buffer.from(img));
  writeFileSync(`${base}.json`, JSON.stringify({ W, H, scale, marks, line, cellMm: map.cell }));
}

const upper = run("demo-upper.stl", "upper", [0, 0, -1], null);
const lower = run("demo-lower.stl", "lower", [0, 0, 1], null);

/* Tooth 22 and the 3x quadrant sit on the patient's left, so they must share a side of the head. */
{
  const side = (m, t) => V.dot(t.center, m.right);
  const u = upper.model, l = lower.model;
  const q2 = u.teeth.filter((t) => t.fdi > 20), q1 = u.teeth.filter((t) => t.fdi < 20);
  const q3 = l.teeth.filter((t) => t.fdi < 40), q4 = l.teeth.filter((t) => t.fdi > 40);
  const mean = (m, a) => a.reduce((s, t) => s + side(m, t), 0) / a.length;
  check("upper and lower agree on the patient's left", mean(u, q2) < mean(u, q1) && mean(l, q3) < mean(l, q4) && V.dot(u.right, l.right) > 0.8, `axes agree ${V.dot(u.right, l.right).toFixed(2)}`);
}

/* The one tooth with independent ground truth: the crown belongs to tooth 22. */
{
  const { index } = (await import("../lib/client/cad/teeth.js")).archIndexAt(upper.model, crownPoint);
  const t = upper.model.teeth.find((x) => index >= x.from && index <= x.to);
  check("the crown sits on the tooth numbered 22, with no hint given", t?.fdi === 22, `found ${t?.fdi ?? "none"}`);
}
{
  const teeth = upper.model.teeth;
  const nums = teeth.map((t) => t.fdi);
  check("upper numbers are unique", new Set(nums).size === nums.length, nums.join(" "));
  check("upper numbers are all upper quadrants", nums.every((f) => f >= 11 && f <= 28));
  const lowerNums = lower.model.teeth.map((t) => t.fdi);
  check("lower numbers are unique", new Set(lowerNums).size === lowerNums.length, lowerNums.join(" "));
  check("lower numbers are all lower quadrants", lowerNums.every((f) => f >= 31 && f <= 48));
}

const mesh = ops.makeMesh(upper.raw.positions, upper.raw.indices);
const t0 = performance.now();
const label = labelTeeth(mesh, upper.model);
const per = upper.model.teeth.map((t) => t.vertices);
console.log(`\nmesh labels ${(performance.now() - t0).toFixed(0)} ms · vertices per tooth ${per.join(" ")}`);
check("every upper tooth got a mesh region", per.every((n) => n > 200));
const share = label.reduce((s, x) => s + (x >= 0 ? 1 : 0), 0) / label.length;
check("teeth are a plausible share of the scan, not the whole jaw", share > 0.1 && share < 0.75, `${(share * 100).toFixed(0)}%`);

/* ---- robustness on the same real scan */
const numbersOf = (m) => m.teeth.map((t) => t.fdi).sort((a, b) => a - b).join(" ");
const baseNumbers = numbersOf(upper.model);

{
  // Arbitrary scanner orientation: a rigid turn must not change a single number.
  const rotate = (pos, ax, ay, az) => {
    const out = new Float32Array(pos.length);
    const [ca, sa, cb, sb, cc, sc] = [Math.cos(ax), Math.sin(ax), Math.cos(ay), Math.sin(ay), Math.cos(az), Math.sin(az)];
    const R = [[cb * cc, cc * sa * sb - ca * sc, ca * cc * sb + sa * sc], [cb * sc, ca * cc + sa * sb * sc, ca * sb * sc - cc * sa], [-sb, cb * sa, ca * cb]];
    for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) out[i + k] = R[k][0] * pos[i] + R[k][1] * pos[i + 1] + R[k][2] * pos[i + 2] + 40;
    return { out, apply: (v) => R.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]) };
  };
  for (const [ax, ay, az] of [[0.5, -0.3, 1.2], [-0.4, 0.6, -2.4], [0.2, 0.2, 3.0], [1.1, 0.1, 0.4]]) {
    const r = rotate(upper.raw.positions, ax, ay, az);
    const m = detectTeeth(r.out, upper.raw.indices, "upper", { occlusal: r.apply([0, 0, -1]) });
    check(`same numbers with the scan turned ${ax}, ${ay}, ${az}`, numbersOf(m) === baseNumbers, numbersOf(m));
  }
}

const withoutTooth = (raw, model, fdi) => {
  // Removes the crown: what an extraction would leave on the height map.
  const t = model.teeth.find((x) => x.fdi === fdi);
  const a = model.curve.points[t.from], b = model.curve.points[t.to];
  const { frame } = model;
  const keep = [];
  const cut = (p) => {
    const u = V.dot(p, frame.a), v = V.dot(p, frame.b);
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const along = ((u - a[0]) * dx + (v - a[1]) * dy) / (dx * dx + dy * dy);
    const across = Math.abs((u - a[0]) * -dy + (v - a[1]) * dx) / Math.hypot(dx, dy);
    return along > 0.06 && along < 0.94 && across < 8 && V.dot(p, frame.O) > t.height - 9;
  };
  const P = raw.positions;
  for (let i = 0; i < raw.indices.length; i += 3) {
    const v = raw.indices[i];
    if (!cut([P[v * 3], P[v * 3 + 1], P[v * 3 + 2]])) keep.push(raw.indices[i], raw.indices[i + 1], raw.indices[i + 2]);
  }
  return new Uint32Array(keep);
};

for (const [jawName, jaw, axis, data, gone] of [["upper", "upper", [0, 0, -1], upper, 14], ["upper", "upper", [0, 0, -1], upper, 24], ["upper", "upper", [0, 0, -1], upper, 12], ["lower", "lower", [0, 0, 1], lower, 35], ["lower", "lower", [0, 0, 1], lower, 44]]) {
  const idx = withoutTooth(data.raw, data.model, gone);
  const m = detectTeeth(data.raw.positions, idx, jaw, { occlusal: axis });
  // A sliver cut off by the end of the scan may merge with its neighbour; complete teeth may not move.
  const sliver = data.model.teeth.filter((t) => t.partial && t.width < 5).map((t) => t.fdi);
  const expected = data.model.teeth.map((t) => t.fdi).filter((f) => f !== gone && !sliver.includes(f)).sort((a, b) => a - b).join(" ");
  const got = m.teeth.map((t) => t.fdi).filter((f) => !sliver.includes(f)).sort((a, b) => a - b).join(" ");
  check(`${jawName} ${gone} removed: the others keep their numbers`, got === expected, `got ${got}`);
}

{
  // Partial scan: one quadrant has no midline, so it must not invent numbers on its own.
  const { frame } = upper.model;
  const P = upper.raw.positions;
  const R = upper.model.right;
  const keep = [];
  for (let i = 0; i < upper.raw.indices.length; i += 3) {
    const v = upper.raw.indices[i];
    if (V.dot([P[v * 3], P[v * 3 + 1], P[v * 3 + 2]], R) < V.dot(upper.model.teeth.find((t) => t.fdi === 22).center, R) + 3) keep.push(upper.raw.indices[i], upper.raw.indices[i + 1], upper.raw.indices[i + 2]);
  }
  void frame;
  const idx = new Uint32Array(keep);
  const blind = detectTeeth(P, idx, "upper", { occlusal: [0, 0, -1] });
  console.log(`\npartial, no anchor: status ${blind.status}, arch ${blind.archLength?.toFixed(0)} mm, turning ${blind.archTurn?.toFixed(0)}°, ${blind.teeth.length} teeth: ${blind.teeth.map((t) => t.fdi ?? "??").join(" ")}`);
  check("partial scan does not invent numbers", blind.status === "partial" ? blind.teeth.every((t) => t.fdi === null) : blind.teeth.length === 0 || blind.teeth.every((t) => t.fdi > 20), blind.status);
  const anchored = detectTeeth(P, idx, "upper", { occlusal: [0, 0, -1], anchor: { fdi: 22, point: crownPoint } });
  const list = anchored.teeth.map((t) => t.fdi ?? "??").join(" ");
  check("the same partial scan with crown 22 as anchor is numbered from it", anchored.teeth.some((t) => t.fdi === 22) && anchored.teeth.every((t) => !t.fdi || t.fdi > 20), list);
}

{
  // Partial lower arch whose 46 preparation keeps its width but lost its height (Y-up fixture).
  const s46 = load("sample-lower-scan.stl");
  const m46 = detectTeeth(s46.positions, s46.indices, "lower", { occlusal: [0, 1, 0] });
  const prep = m46.teeth.find((t) => t.stump);
  check("a low preparation is found on the 46 fixture", !!prep && Math.hypot(prep.center[0] + 21.3, prep.center[2] + 28.3) < 4, prep ? prep.center.map((v) => v.toFixed(1)).join(",") : "none");
  anchorJobTooth(m46, 46);
  check("the appointment number 46 lands on that preparation, unconfirmed", m46.teeth.find((t) => t.fdi === 46) === prep && m46.jobToothConfirmed === false, m46.teeth.map((t) => t.fdi).join(" "));
}

console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
