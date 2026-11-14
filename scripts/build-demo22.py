#!/usr/bin/env python3
"""Build the homepage CAD demo asset for crown 22 from the exocad case files.

    python build-demo22.py "<case folder>" [--check]

Needs numpy, scipy and fast-simplification (build-time only, not site dependencies).

Placement: exocad exports the crown in its milling frame, not the scan frame.
constructionInfo records the link as ZRotationMatrix (row-vector convention), and
the crown returns to the scan frame through its inverse, p = (p' - t) * R^T.
The margin line then lies on the upper scan (median about 0.03 mm).

Writes to public/assets/sample/:
  demo-crown-22.stl   crown seated in scan coordinates (also used by /workspace)
  demo-22.bin/.json   decimated jaws, full crown, per-vertex maps, measurements
All map values are measured against the full-resolution scans.
"""
from __future__ import annotations

import json
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

import fast_simplification
import numpy as np
from scipy.spatial import cKDTree

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public/assets/sample"
UPPER_TRIS = 110_000
LOWER_TRIS = 70_000
STL_DTYPE = np.dtype([("n", "<3f4"), ("v", "<9f4"), ("a", "<u2")])


def load_stl(path: Path) -> np.ndarray:
    raw = path.read_bytes()
    count = int.from_bytes(raw[80:84], "little")
    if 84 + count * 50 != len(raw):
        raise SystemExit(f"{path.name}: not a binary STL")
    rec = np.frombuffer(raw, dtype=STL_DTYPE, count=count, offset=84)
    return rec["v"].reshape(-1, 3, 3).astype(np.float64)


def weld(tris: np.ndarray, eps: float = 1e-4):
    key = np.round(tris.reshape(-1, 3) / eps).astype(np.int64)
    _, first, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
    faces = inv.reshape(-1, 3)
    good = (faces[:, 0] != faces[:, 1]) & (faces[:, 1] != faces[:, 2]) & (faces[:, 0] != faces[:, 2])
    return tris.reshape(-1, 3)[first], faces[good]


def vertex_normals(v: np.ndarray, f: np.ndarray) -> np.ndarray:
    fn = np.cross(v[f[:, 1]] - v[f[:, 0]], v[f[:, 2]] - v[f[:, 0]])
    n = np.zeros_like(v)
    for k in range(3):
        np.add.at(n, f[:, k], fn)
    return n / (np.linalg.norm(n, axis=1, keepdims=True) + 1e-12)


def cavity(v: np.ndarray, f: np.ndarray, n: np.ndarray, rings: int = 3) -> np.ndarray:
    """Baked crevice shading: 1 on open surface, darker in fissures and saw cuts."""
    a = np.concatenate([f[:, 0], f[:, 1], f[:, 2], f[:, 1], f[:, 2], f[:, 0]])
    b = np.concatenate([f[:, 1], f[:, 2], f[:, 0], f[:, 0], f[:, 1], f[:, 2]])
    deg = np.bincount(a, minlength=len(v)).astype(np.float64)[:, None] + 1e-9
    avg = v.copy()
    for _ in range(rings):
        s = np.zeros_like(v)
        np.add.at(s, a, avg[b])
        avg = 0.5 * avg + 0.5 * s / deg
    concave = np.einsum("ij,ij->i", avg - v, n)
    return np.clip(1 - np.clip(concave, 0, None) * 3.2, 0.45, 1)


def in_polygon(pts: np.ndarray, poly: np.ndarray) -> np.ndarray:
    x, y = pts[:, 0][:, None], pts[:, 1][:, None]
    x0, y0 = poly[:, 0], poly[:, 1]
    x1, y1 = np.roll(x0, -1), np.roll(y0, -1)
    cross = (y0 > y) != (y1 > y)
    with np.errstate(divide="ignore", invalid="ignore"):
        xi = x0 + (y - y0) * (x1 - x0) / (y1 - y0)
    return (cross & (x < xi)).sum(axis=1) % 2 == 1


def signed_distance(p: np.ndarray, verts: np.ndarray, normals: np.ndarray) -> np.ndarray:
    d, i = cKDTree(verts).query(p)
    side = np.einsum("ij,ij->i", p - verts[i], normals[i])
    return np.where(side < 0, -d, d)


def dense_points(tris: np.ndarray, mask: np.ndarray | None = None) -> np.ndarray:
    """Vertices plus edge midpoints and centroids, so nearest-point distances track the surface."""
    t = tris if mask is None else tris[mask]
    return np.vstack([t.reshape(-1, 3), t.mean(1), (t[:, 0] + t[:, 1]) / 2, (t[:, 1] + t[:, 2]) / 2, (t[:, 2] + t[:, 0]) / 2])


def densify_loop(loop: np.ndarray, steps: int = 6) -> np.ndarray:
    t = np.linspace(0, 1, steps, endpoint=False)[:, None, None]
    return (loop[None] * (1 - t) + np.roll(loop, -1, axis=0)[None] * t).reshape(-1, 3)


def to_world(p: np.ndarray) -> np.ndarray:
    """Scan frame (Z toward the upper jaw, -Y anterior) to viewer frame (Y up, +Z toward the viewer)."""
    return np.stack([p[..., 0], p[..., 2], -p[..., 1]], axis=-1)


def main() -> None:
    case = Path(sys.argv[1])
    stem = next(case.glob("*.constructionInfo")).stem
    tooth = ET.fromstring(next(case.glob("*.constructionInfo")).read_text(encoding="utf-8-sig", errors="replace")).find("Teeth/Tooth")

    Z = tooth.find("ZRotationMatrix")
    M = np.array([[float(Z.find(f"_{r}{c}").text) for c in range(4)] for r in range(4)])
    R, T = M[:3, :3], M[3, :3]
    to_scan_p = lambda p: (p - T) @ R.T
    to_scan_d = lambda d: d @ R.T

    vec = lambda name: np.array([float(tooth.find(name).find(k).text) for k in "xyz"])
    margin = to_scan_p(np.array([[float(q.find(k).text) for k in "xyz"] for q in tooth.find("Margin").findall("Vec3")]))
    occl = vec("AxisInsertionScanInfo")
    occl /= np.linalg.norm(occl)
    mesial = to_scan_d(vec("AxisMesial"))
    facial = to_scan_d(vec("AxisBuccal"))

    upper_t = load_stl(case / f"{stem}-UpperJaw.stl")
    lower_t = load_stl(case / f"{stem}-LowerJaw.stl")
    crown_raw = load_stl(case / f"{stem}-22-crown_cad.stl")
    crown_t = to_scan_p(crown_raw.reshape(-1, 3)).reshape(-1, 3, 3)
    print("axes  occlusal", occl.round(3), "mesial", mesial.round(3), "facial", facial.round(3))

    # Refuse to ship a placement that does not fit its own preparation.
    upper_full = dense_points(upper_t)
    upper_tree = cKDTree(upper_full)
    margin_fit = upper_tree.query(margin)[0]
    print("margin to upper scan p50/p95/max", np.percentile(margin_fit, [50, 95, 100]).round(3))
    if np.median(margin_fit) > 0.1:
        raise SystemExit("crown does not seat on the preparation")

    if "--check" in sys.argv:
        return

    # Seated crown in scan coordinates, for /workspace.
    fn = np.cross(crown_t[:, 1] - crown_t[:, 0], crown_t[:, 2] - crown_t[:, 0])
    fn /= np.linalg.norm(fn, axis=1, keepdims=True) + 1e-12
    rec = np.zeros(len(crown_t), dtype=STL_DTYPE)
    rec["n"], rec["v"] = fn, crown_t.reshape(-1, 9)
    (OUT / "demo-crown-22.stl").write_bytes(b"FAUCHAR demo crown 22 - scan coordinates".ljust(80, b" ") + len(rec).to_bytes(4, "little") + rec.tobytes())

    # Tooth frame: u along mesial, w along facial; h along the occlusal axis.
    u = mesial - occl * (mesial @ occl)
    u /= np.linalg.norm(u)
    w = np.cross(occl, u)
    if w @ facial < 0:
        w = -w
    origin = margin.mean(0)
    flat = lambda p: np.stack([(p - origin) @ u, (p - origin) @ w], axis=1)
    poly = flat(margin)

    # Crown vertices: the closed shell splits in two along the margin line. Flood across
    # the mesh from a point deep in the intaglio, stopping at the margin.
    cv, cf = weld(crown_t)
    cn = vertex_normals(cv, cf)
    die_gap = upper_tree.query(cv)[0]
    margin_dist = cKDTree(densify_loop(margin)).query(cv)[0]
    seed_pool = np.flatnonzero((die_gap < 0.2) & in_polygon(flat(cv), poly * 0.5) & (margin_dist > 1))
    barrier = margin_dist < 0.07
    adj = [[] for _ in cv]
    for a, b, c in cf:
        adj[a] += [b, c]
        adj[b] += [a, c]
        adj[c] += [a, b]
    intaglio = np.zeros(len(cv), bool)
    stack = [int(seed_pool[0])]
    intaglio[stack[0]] = True
    while stack:
        for q in adj[stack.pop()]:
            if not intaglio[q]:
                intaglio[q] = True
                if not barrier[q]:
                    stack.append(q)
    outer = ~intaglio
    print("crown verts", len(cv), "faces", len(cf), "intaglio", int(intaglio.sum()), "outer", int(outer.sum()))
    if not 0.2 < intaglio.mean() < 0.6:
        raise SystemExit("intaglio flood leaked across the margin")

    # Thickness: outer surface to the nearest intaglio point.
    inner_tree = cKDTree(cv[intaglio])
    thickness = inner_tree.query(cv)[0]
    thickness[intaglio] = 30
    away = outer & (margin_dist >= float(_param(tooth, "MinThicknessFullDistanceToPreparationMargin")))
    i_thick = np.flatnonzero(away)[np.argmin(thickness[away])]

    # Occlusion: signed distance from the crown to the real lower scan.
    lv, lf = weld(lower_t)
    occlusal = signed_distance(cv, lv, vertex_normals(lv, lf))
    occlusal[intaglio] = 30
    i_occl = np.flatnonzero(outer)[np.argmin(occlusal[outer])]

    # Proximal: distance to the neighbouring teeth, the upper-scan surface beside the die on
    # each side. Scan vertices outside the margin loop and coronal to it, within the tooth's
    # faciolingual width, so gingiva and the die itself are excluded.
    uv, uf = weld(upper_t)
    un = vertex_normals(uv, uf)
    uflat = flat(uv)
    h_u = (uv - origin) @ occl
    lat = (np.linalg.norm(uv - origin, axis=1) < 14) & (h_u > 1.0) & (np.abs(uflat[:, 1]) < 3.2) & ~in_polygon(uflat, poly * 1.04)
    side = (cv - origin) @ u
    proximal = np.full(len(cv), 30.0)

    def contact(sign):
        pick = lat & (uflat[:, 0] * sign > 0)
        mask = outer & (side * sign > 0)
        verts, norms = uv[pick], un[pick]
        d, near_i = cKDTree(verts).query(cv[mask])
        toward = np.einsum("ij,ij->i", cv[mask] - verts[near_i], norms[near_i])
        # The sign is only meaningful right at the surface.
        signed = np.where((toward < 0) & (d < 0.5), -d, d)
        proximal[mask] = signed
        i = np.flatnonzero(mask)[np.argmin(signed)]
        return float(proximal[i]), cv[i], int(pick.sum())

    d_mesial, p_mesial, n_m = contact(1)
    d_distal, p_distal, n_d = contact(-1)
    print("neighbour points mesial/distal", n_m, n_d)

    cement = upper_tree.query(cv[intaglio & (margin_dist > 0.8)])[0]
    f2 = flat(cv[outer])
    h2 = (cv[outer] - origin) @ occl
    stats = {
        "tooth": 22,
        "marginFit": round(float(np.median(margin_fit)), 3),
        "marginFitP95": round(float(np.percentile(margin_fit, 95)), 3),
        "marginPoints": len(margin),
        "mesiodistal": round(float(np.ptp(f2[:, 0])), 2),
        "faciolingual": round(float(np.ptp(f2[:, 1])), 2),
        "height": round(float(np.ptp(h2)), 2),
        "volume": round(abs(float(np.einsum("ij,ij->i", crown_t[:, 0], np.cross(crown_t[:, 1], crown_t[:, 2])).sum())) / 6, 1),
        "minThickness": round(float(thickness[i_thick]), 2),
        "occlusalMin": round(float(occlusal[i_occl]), 3),
        "contactMesial": round(d_mesial, 3),
        "contactDistal": round(d_distal, 3),
        "cementMeasured": round(float(np.median(cement)), 3),
        "design": {
            "cementGap": float(_param(tooth, "CementGapThickness")),
            "minThickness": float(_param(tooth, "MinThickness")),
            "minThicknessMargin": float(_param(tooth, "MinThicknessNearPreparationMargin")),
            "antagonistDistance": float(_param(tooth, "DistanceToAntagonist")),
        },
    }
    print(json.dumps(stats, indent=1))

    # Decimate the scans for the browser; analytics above already used full resolution.
    def reduce(v, f, target):
        v2, f2_ = fast_simplification.simplify(v.astype(np.float32), f.astype(np.int32), target_count=target, agg=3.0)
        if len(v2) >= 65535:
            raise SystemExit("too many vertices for 16-bit indices")
        return v2.astype(np.float64), f2_.astype(np.int64)

    uv2, uf2 = reduce(uv, uf, UPPER_TRIS)
    lv2, lf2 = reduce(lv, lf, LOWER_TRIS)
    print("decimated upper", len(uv2), len(uf2), "lower", len(lv2), len(lf2))
    print("margin to decimated upper p50/p95", np.percentile(cKDTree(dense_points(uv2[uf2])).query(margin)[0], [50, 95]).round(3))

    die_mask = in_polygon(flat(uv2), poly * 1.04) & (np.linalg.norm(uv2 - origin, axis=1) < 14)

    blob = bytearray()
    meta: dict = {"meshes": {}}

    def put(arr: np.ndarray) -> list:
        while len(blob) % arr.dtype.alignment:
            blob.append(0)
        at = len(blob)
        blob.extend(arr.tobytes())
        return [at, int(arr.size)]

    def add_mesh(name, v, f, **fields):
        wv = to_world(v)
        lo, hi = wv.min(0), wv.max(0)
        q = np.round((wv - lo) / (hi - lo) * 65535).astype("<u2")
        entry = {"min": lo.tolist(), "max": hi.tolist(), "pos": put(q.reshape(-1)), "idx": put(f.astype("<u2").reshape(-1))}
        for key, val in fields.items():
            entry[key] = put(val)
        meta["meshes"][name] = entry

    to8 = lambda a: np.round(np.clip(a, 0, 1) * 255).astype(np.uint8)
    add_mesh("upper", uv2, uf2, ao=to8(cavity(uv2, uf2, vertex_normals(uv2, uf2))), die=die_mask.astype(np.uint8))
    add_mesh("lower", lv2, lf2, ao=to8(cavity(lv2, lf2, vertex_normals(lv2, lf2))))
    to16 = lambda a: np.round(np.clip(a, -30, 30) * 1000).astype("<i2")
    add_mesh("crown", cv, cf, ao=to8(cavity(cv, cf, cn)), outer=outer.astype(np.uint8), thickness=to16(thickness), occlusal=to16(occlusal), proximal=to16(proximal))

    w3 = lambda p: np.round(to_world(np.asarray(p)), 3).tolist()
    meta.update(
        stats=stats,
        margin=w3(margin),
        frame={
            "center": w3(cv.mean(0)),
            "marginCenter": w3(origin),
            "occlusal": w3(occl),
            "mesial": w3(u),
            "facial": w3(w),
            "archCenter": w3((upper_t.reshape(-1, 3).min(0) + upper_t.reshape(-1, 3).max(0) + lower_t.reshape(-1, 3).min(0) + lower_t.reshape(-1, 3).max(0)) / 4),
        },
        points={"contactMesial": w3(p_mesial), "contactDistal": w3(p_distal), "thickness": w3(cv[i_thick]), "occlusal": w3(cv[i_occl])},
    )
    (OUT / "demo-22.bin").write_bytes(bytes(blob))
    (OUT / "demo-22.json").write_text(json.dumps(meta, separators=(",", ":")))
    print("wrote demo-22.bin", round(len(blob) / 1e6, 2), "MB")


def _param(tooth, name: str) -> str:
    for p in tooth.iter("Parameter"):
        if p.find("Type").text == name:
            return p.find("Value").text
    raise SystemExit(f"missing parameter {name}")


if __name__ == "__main__":
    main()
