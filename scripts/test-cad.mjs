// Headless checks for the CAD kernel on the real sample case: node scripts/test-cad.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { BVH, V, meshStats, parseBinarySTL, writeBinarySTL } from "../lib/client/cad/mesh.js";
import * as ops from "../lib/client/cad/ops.js";

const dir = new URL("../public/assets/sample/", import.meta.url);
const load = (name) => {
  const b = readFileSync(new URL(name, dir));
  return parseBinarySTL(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
};
let failed = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "pass" : "FAIL"}  ${label}${detail ? `  ·  ${detail}` : ""}`);
};
const f3 = (x) => (x === null || x === undefined ? "n/a" : Number(x).toFixed(3));
const time = (fn) => { const t = performance.now(); const r = fn(); return [r, performance.now() - t]; };

const json = JSON.parse(readFileSync(new URL("demo-22.json", dir), "utf8"));
const toScan = (w) => [w[0], -w[2], w[1]];
const refMargin = json.margin.map(toScan);

const crownRaw = load("demo-crown-22.stl");
const upperRaw = load("demo-upper.stl");
const lowerRaw = load("demo-lower.stl");
console.log(`crown ${crownRaw.indices.length / 3} tris, upper ${upperRaw.indices.length / 3}, lower ${lowerRaw.indices.length / 3}`);

const crown = ops.makeMesh(crownRaw.positions, crownRaw.indices);
const original = crownRaw.positions.slice();
const base = meshStats(crown.pos, crown.idx);
check("sample crown is closed", base.closed, `${base.vertices} v, volume ${base.volume.toFixed(1)} mm³`);

/* ---- segmentation against the design data of this case */
const [seg, segMs] = time(() => ops.segmentCrown(crown));
const nIn = seg.intaglio.reduce((s, x) => s + x, 0);
console.log(`segmentCrown ${segMs.toFixed(0)} ms · intaglio ${nIn}, rim ${seg.rim.length}, loop ${seg.rimLoop.length}`);
const rimPts = Array.from(seg.rimLoop, (v) => [crown.pos[v * 3], crown.pos[v * 3 + 1], crown.pos[v * 3 + 2]]);
const rimErr = refMargin.map((p) => V.dist(p, ops.closestOnLoop(p, rimPts))).sort((a, b) => a - b);
check("detected rim matches the design margin", rimErr[rimErr.length >> 1] < 0.1 && rimErr[Math.floor(rimErr.length * 0.95)] < 0.25, `median ${f3(rimErr[rimErr.length >> 1])} p95 ${f3(rimErr[Math.floor(rimErr.length * 0.95)])} mm`);

const frame = ops.crownFrame(crown, seg, upperRaw.positions);
const truth = { occlusal: toScan(json.frame.occlusal), mesial: toScan(json.frame.mesial), facial: toScan(json.frame.facial) };
const angle = (a, b) => (Math.acos(Math.min(1, Math.abs(V.dot(a, b)))) * 180) / Math.PI;
check("occlusal axis near design", angle(frame.occlusal, truth.occlusal) < 25 && V.dot(frame.occlusal, truth.occlusal) > 0, `${angle(frame.occlusal, truth.occlusal).toFixed(1)}°`);
check("facial axis near design", angle(frame.facial, truth.facial) < 30 && V.dot(frame.facial, truth.facial) > 0, `${angle(frame.facial, truth.facial).toFixed(1)}°`);
check("mesial axis near design", angle(frame.mesial, truth.mesial) < 30 && V.dot(frame.mesial, truth.mesial) > 0, `${angle(frame.mesial, truth.mesial).toFixed(1)}° dot ${V.dot(frame.mesial, truth.mesial).toFixed(2)}`);
const useFrame = { ...frame, ...truth };

/* ---- regional BVHs */
const center = frame.center;
const [upBvh, upMs] = time(() => new BVH(upperRaw.positions, upperRaw.indices, ops.regionTriangles(upperRaw.positions, upperRaw.indices, center, 30)));
const [loBvh, loMs] = time(() => new BVH(lowerRaw.positions, lowerRaw.indices, ops.regionTriangles(lowerRaw.positions, lowerRaw.indices, center, 30)));
console.log(`regional BVH upper ${upBvh.count} tris ${upMs.toFixed(0)} ms, lower ${loBvh.count} tris ${loMs.toFixed(0)} ms`);

const inTris = new BVH(crown.pos, crown.idx, seg.inTris);
const { weight, rimDist } = ops.outerWeights(crown, seg);
const reset = () => { crown.pos.set(original); ops.refresh(crown); inTris.refit(); };

/* ---- distances */
const [occ, occMs] = time(() => ops.gapStats(crown, weight, loBvh, 3));
check("occlusal minimum matches the offline measurement", Math.abs(occ.min - json.stats.occlusalMin) < 0.05, `${f3(occ.min)} vs ${json.stats.occlusalMin} mm · ${occMs.toFixed(0)} ms`);
const th = ops.thicknessMap(crown, seg, inTris);
check("minimum thickness matches the offline measurement", Math.abs(th.min - json.stats.minThickness) < 0.1, `${f3(th.min)} vs ${json.stats.minThickness} mm`);
const cm = ops.cementMap(crown, seg, upBvh);
check("cement gap matches the offline measurement", Math.abs(cm.median - json.stats.cementMeasured) < 0.03, `median ${f3(cm.median)} vs ${json.stats.cementMeasured} mm`);

/* ---- occlusal relief */
{
  const [res, ms] = time(() => ops.setClearance(crown, weight, loBvh, 0.3));
  check("set occlusal clearance to 0.300 mm", Math.abs(res.after - 0.3) < 0.006, `${f3(res.before)} → ${f3(res.after)} mm · ${ms.toFixed(0)} ms`);
  const s = meshStats(crown.pos, crown.idx);
  check("still closed after relief", s.closed && !s.invalid, `volume ${s.volume.toFixed(1)}`);
  let rimMove = 0;
  for (const v of seg.rim) rimMove = Math.max(rimMove, V.dist([crown.pos[v * 3], crown.pos[v * 3 + 1], crown.pos[v * 3 + 2]], [original[v * 3], original[v * 3 + 1], original[v * 3 + 2]]));
  check("relief leaves the margin alone", rimMove < 1e-4, `${rimMove.toExponential(1)} mm`);
  reset();
  const [up] = time(() => ops.setClearance(crown, weight, loBvh, 0.02));
  check("build occlusal contact to 0.020 mm", Math.abs(up.after - 0.02) < 0.03, `${f3(up.before)} → ${f3(up.after)} mm`);
  reset();
}

/* ---- brushes */
{
  const scratch = ops.newScratch(crown.count);
  const hit = crown.bvh.raycast(V.add(center, V.mul(frame.occlusal, 30)), V.mul(frame.occlusal, -1));
  check("ray hits the outer surface from above", !!hit && !seg.intaglio[crown.idx[hit.tri * 3]], hit ? `t=${f3(hit.t)}` : "");
  const v0 = meshStats(crown.pos, crown.idx).volume;
  for (const kind of ["add", "remove", "smooth", "flatten", "ridge", "groove"]) {
    reset();
    for (let i = 0; i < 12; i++) {
      ops.brushStamp(crown, { kind, hit, radius: 1.5, strength: 0.6, mask: weight, scratch });
      ops.refresh(crown);
    }
    let moved = 0;
    for (let i = 0; i < crown.pos.length; i += 3) moved = Math.max(moved, Math.hypot(crown.pos[i] - original[i], crown.pos[i + 1] - original[i + 1], crown.pos[i + 2] - original[i + 2]));
    const st = meshStats(crown.pos, crown.idx);
    const dV = st.volume - v0;
    const expected = kind === "add" ? dV > 0.05 : kind === "remove" ? dV < -0.05 : true;
    check(`brush ${kind}`, moved > 0.005 && st.closed && expected, `max move ${f3(moved)} mm · ΔV ${dV.toFixed(2)} mm³`);
  }
  // Restore must walk an edited surface back to the original.
  reset();
  for (let i = 0; i < 10; i++) { ops.brushStamp(crown, { kind: "add", hit, radius: 1.5, strength: 0.6, mask: weight, scratch }); ops.refresh(crown); }
  const origBvh = new BVH(original, crown.idx);
  for (let i = 0; i < 12; i++) { ops.brushStamp(crown, { kind: "restore", hit, radius: 2.2, strength: 0.8, mask: weight, restore: origBvh, scratch }); ops.refresh(crown); }
  let residual = 0;
  for (let v = 0; v < crown.count; v++) residual = Math.max(residual, origBvh.closest([crown.pos[v * 3], crown.pos[v * 3 + 1], crown.pos[v * 3 + 2]], 2)?.d ?? 0);
  check("restore brush returns to the original surface", residual < 0.02, `residual ${f3(residual)} mm`);
  reset();
}

/* ---- anatomy */
{
  const before = original.slice();
  const dim = (axis, intaglio = false) => {
    let lo = Infinity, hi = -Infinity;
    for (let v = 0; v < crown.count; v++) {
      if (!intaglio && seg.intaglio[v]) continue;
      const d = (crown.pos[v * 3] - center[0]) * axis[0] + (crown.pos[v * 3 + 1] - center[1]) * axis[1] + (crown.pos[v * 3 + 2] - center[2]) * axis[2];
      if (d < lo) lo = d;
      if (d > hi) hi = d;
    }
    return hi - lo;
  };
  const h0 = dim(useFrame.occlusal);
  ops.deformAnatomy(crown, before, { weight, rimDist }, useFrame, { height: 1.1 });
  ops.refresh(crown);
  const h1 = dim(useFrame.occlusal);
  check("height +10% with margin locked", h1 > h0 * 1.03 && h1 < h0 * 1.13, `${f3(h0)} → ${f3(h1)} mm`);
  let rimMove = 0;
  for (const v of seg.rim) rimMove = Math.max(rimMove, Math.abs(crown.pos[v * 3] - before[v * 3]));
  check("anatomy edit leaves the rim alone", rimMove < 1e-5);
  reset();
  const { weights, normals } = ops.zoneWeights(crown, before, weight, useFrame, "facial");
  ops.offsetByWeights(crown, before, normals, weights, 0.25);
  ops.refresh(crown);
  check("individual facial surface offset", meshStats(crown.pos, crown.idx).volume > base.volume + 1, `ΔV ${(meshStats(crown.pos, crown.idx).volume - base.volume).toFixed(2)} mm³`);
  reset();
  ops.emergence(crown, before, { weight, rimDist }, useFrame, { amount: 0.25 });
  ops.refresh(crown);
  check("emergence profile bulge", meshStats(crown.pos, crown.idx).volume > base.volume + 0.5, `ΔV ${(meshStats(crown.pos, crown.idx).volume - base.volume).toFixed(2)} mm³`);
  reset();
}

/* ---- crown parameters */
{
  ops.enforceThickness(crown, seg, inTris, { min: 0.8, minMargin: 0.2 });
  inTris.refit();
  const t = ops.thicknessMap(crown, seg, inTris);
  check("enforce 0.8 mm wall away from the margin", t.min > 0.79, `min beyond margin zone ${f3(th.min)} → ${f3(t.min)} mm`);
  check("closed after thickening", meshStats(crown.pos, crown.idx).closed);
  reset();
  ops.setCementGap(crown, seg, upBvh, { gap: 0.1, marginGap: 0.03 });
  const c2 = ops.cementMap(crown, seg, upBvh);
  check("cement gap set to 0.100 mm", Math.abs(c2.median - 0.1) < 0.012, `median ${f3(cm.median)} → ${f3(c2.median)} mm`);
  check("cement edit never pushes the intaglio into the die", c2.min > -0.01, `range ${f3(c2.min)} to ${f3(c2.max)} mm`);
  check("closed after cement edit", meshStats(crown.pos, crown.idx).closed);
  reset();
}

/* ---- margin */
{
  const fit = ops.marginFit(refMargin, upBvh);
  check("design margin lies on the die scan", fit.median < 0.05, `median ${f3(fit.median)} mm`);
  const upperScan = ops.makeMesh(upperRaw.positions, upperRaw.indices);
  const seed = refMargin.reduce((s, p) => V.add(s, p), [0, 0, 0]).map((x) => x / refMargin.length);
  const axisHigh = V.add(seed, V.mul(truth.occlusal, 3));
  const [auto, autoMs] = time(() => ops.detectMargin(upBvh, axisHigh, truth.occlusal));
  if (auto) {
    const smooth = ops.smoothLoop(auto, 2, 0.5, upBvh);
    const e = smooth.map((p) => V.dist(p, ops.closestOnLoop(p, refMargin))).sort((a, b) => a - b);
    console.log(`auto margin ${autoMs.toFixed(0)} ms · error to design median ${f3(e[e.length >> 1])} p95 ${f3(e[Math.floor(e.length * 0.95)])} max ${f3(e[e.length - 1])} mm`);
    check("auto-detect margin is within 0.2 mm of design at the median", e[e.length >> 1] < 0.2);
  } else check("auto-detect margin returned a loop", false);

  const moved = refMargin.map((p) => V.add(p, V.mul(truth.occlusal, 0.15)));
  ops.fitRimToMargin(crown, seg, moved);
  const rimNow = Array.from(seg.rimLoop, (v) => [crown.pos[v * 3], crown.pos[v * 3 + 1], crown.pos[v * 3 + 2]]);
  const e2 = rimNow.map((p) => V.dist(p, ops.closestOnLoop(p, moved))).sort((a, b) => a - b);
  check("crown rim follows an edited margin", e2[e2.length >> 1] < 0.02, `median ${f3(e2[e2.length >> 1])} mm`);
  check("closed after margin fit", meshStats(crown.pos, crown.idx).closed);
  reset();

  const [jaw, jawMs] = time(() => ops.segmentJaw(upperScan, refMargin, useFrame));
  console.log(`segmentJaw ${jawMs.toFixed(0)} ms · die ${jaw.prepVerts} v, neighbour M ${jaw.neighborM}, neighbour D ${jaw.neighborD}`);
  check("die found", jaw.prepVerts > 500 && jaw.prepVerts < upperScan.count / 6);
  check("neighbour teeth found", jaw.neighborM > 500 && jaw.neighborD > 500);
  const verts = [];
  for (let v = 0; v < upperScan.count; v++) if (jaw.label[v] === ops.LABEL.PREP) verts.push(v);
  const u = ops.undercutMap(upperScan, verts, truth.occlusal, upBvh);
  console.log(`undercuts at the design axis: ${(u.fraction * 100).toFixed(1)}% of die, max ${f3(u.max)} mm`);
  const best = ops.bestInsertionAxis(upperScan, verts, truth.occlusal, upBvh);
  const u2 = ops.undercutMap(upperScan, verts, best, upBvh);
  check("best-fit axis does not worsen undercuts", u2.fraction <= u.fraction + 1e-6, `${(u2.fraction * 100).toFixed(1)}% at ${angle(best, truth.occlusal).toFixed(1)}° tilt`);

  const buildSide = (id) => {
    const tris = [];
    for (let t = 0; t < upperRaw.indices.length / 3; t++) if (jaw.label[upperRaw.indices[t * 3]] === id) tris.push(t);
    return new BVH(upperRaw.positions, upperRaw.indices, tris);
  };
  for (const [side, id] of [["mesial", ops.LABEL.NEIGHBOR_M], ["distal", ops.LABEL.NEIGHBOR_D]]) {
    const nb = buildSide(id);
    const g = ops.gapStats(crown, weight, nb, 4);
    console.log(`${side} contact ${f3(g.min)} mm (offline ${side === "mesial" ? json.stats.contactMesial : json.stats.contactDistal})`);
    const res = ops.setClearance(crown, weight, nb, 0.05, { radius: 1.8 });
    check(`${side} contact set to 0.050 mm`, Math.abs(res.after - 0.05) < 0.03, `${f3(res.before)} → ${f3(res.after)} mm`);
    reset();
  }
}

/* ---- bridge */
{
  const off = V.mul(useFrame.mesial, -8.5);
  const pontic = ops.makePontic(crown, seg, useFrame, { at: V.add(center, off), scale: [1, 1, 1] });
  const pStats = meshStats(pontic.positions, pontic.indices);
  check("pontic is one closed shell", pStats.closed && !pStats.invalid, `volume ${pStats.volume.toFixed(1)} mm³`);
  const pMesh = ops.makeMesh(pontic.positions, pontic.indices);
  const pair = ops.closestPair(crown, pMesh);
  const conn = ops.makeConnector(pair.a, pair.b, useFrame.occlusal, { width: 3, height: 3.5, waist: 0.9 });
  const cStats = meshStats(conn.positions, conn.indices);
  check("connector is one closed shell", cStats.closed, `area ${conn.area.toFixed(1)} mm² · gap ${f3(pair.d)} mm`);
  const ell = ops.makeEllipsoid(center, [useFrame.mesial, useFrame.facial, useFrame.occlusal], [3, 3, 4]);
  check("fallback pontic is one closed shell", meshStats(ell.positions, ell.indices).closed);
  const shells = [{ positions: crown.pos, indices: crown.idx }, { positions: pontic.positions, indices: pontic.indices }, { positions: conn.positions, indices: conn.indices }];
  const [merged, mMs] = time(() => ops.unionMeshes(shells, 0.12));
  const ms = meshStats(merged.positions, merged.indices);
  check("bridge union is watertight and manifold", ms.closed && !ms.invalid, `${ms.triangles} tris, ${ms.boundary} boundary, ${ms.nonManifold} non-manifold, ${ms.degenerate} degenerate · ${(mMs / 1000).toFixed(1)} s`);
  const sum = base.volume + pStats.volume + cStats.volume;
  check("bridge volume is plausible", ms.volume < sum * 1.02 && ms.volume > base.volume + pStats.volume * 0.9, `${ms.volume.toFixed(1)} of ${sum.toFixed(1)} mm³ summed`);
  const stl = writeBinarySTL([merged]);
  const back = parseBinarySTL(stl);
  const backStats = meshStats(back.positions, back.indices);
  check("merged STL round-trips closed", backStats.closed, `${backStats.boundary} boundary, ${backStats.nonManifold} non-manifold`);
  if (process.argv.includes("--write")) writeFileSync(new URL("./bridge-test.stl", `file://${process.cwd()}/`), Buffer.from(stl));
}

/* ---- section, subdivision, STL */
{
  const d = V.dot(center, useFrame.mesial);
  const sec = ops.sliceMesh(crown.pos, crown.idx, useFrame.mesial, d, useFrame.facial, useFrame.occlusal);
  check("section contour", sec.segments.length > 100 && sec.width > 3 && sec.width < 10, `length ${sec.length.toFixed(1)} mm, ${sec.width.toFixed(2)} × ${sec.height.toFixed(2)} mm`);
  const sub = ops.subdivide(crown.pos, crown.idx);
  const ss = meshStats(sub.positions, sub.indices);
  check("subdivision stays closed", ss.closed && ss.triangles === base.triangles * 4, `${ss.triangles} tris`);
  const subMesh = ops.makeMesh(sub.positions, sub.indices);
  const subSeg = ops.segmentCrown(subMesh);
  const subRim = Array.from(subSeg.rimLoop, (v) => [subMesh.pos[v * 3], subMesh.pos[v * 3 + 1], subMesh.pos[v * 3 + 2]]);
  const subErr = refMargin.map((p) => V.dist(p, ops.closestOnLoop(p, subRim))).sort((a, b) => a - b);
  check("refined crown keeps the same margin rim", subErr[subErr.length >> 1] < 0.02, `median ${f3(subErr[subErr.length >> 1])} mm, ${subSeg.rimLoop.length} rim vertices`);
  const stl = writeBinarySTL([{ positions: crown.pos, indices: crown.idx }]);
  const back = parseBinarySTL(stl);
  const bs = meshStats(back.positions, back.indices);
  check("edited crown STL round-trips closed", bs.closed && bs.triangles === base.triangles, `${stl.byteLength} bytes`);
}

console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
