#!/usr/bin/env python3
"""Align demo crown 22 onto the upper prep using translation ICP on intaglio points."""
from __future__ import annotations

import math
import random
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "public/assets/sample/demo-crown-22.raw.stl"
OUT = ROOT / "public/assets/sample/demo-crown-22.stl"
UPPER = ROOT / "public/assets/sample/demo-upper.stl"

INSERTION = (-0.0032579589169472456, -0.37263569235801697, -0.9279720187187195)


def read_tris(path: Path):
    data = path.read_bytes()
    n = struct.unpack_from("<I", data, 80)[0]
    tris = []
    for i in range(n):
        o = 84 + i * 50
        nrm = struct.unpack_from("<3f", data, o)
        vs = [list(struct.unpack_from("<3f", data, o + 12 + 12 * v)) for v in range(3)]
        tris.append((nrm, vs[0], vs[1], vs[2]))
    return tris


def write_stl(path: Path, tris) -> None:
    out = bytearray(80)
    out += struct.pack("<I", len(tris))
    for _, a, b, c in tris:
        ax, ay, az = b[0] - a[0], b[1] - a[1], b[2] - a[2]
        bx, by, bz = c[0] - a[0], c[1] - a[1], c[2] - a[2]
        nx, ny, nz = ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx
        length = math.hypot(nx, ny, nz) or 1.0
        out += struct.pack(
            "<12fH",
            nx / length,
            ny / length,
            nz / length,
            *a,
            *b,
            *c,
            0,
        )
    path.write_bytes(bytes(out))


def read_pts(path: Path, step: int = 1):
    data = path.read_bytes()
    n = struct.unpack_from("<I", data, 80)[0]
    pts = []
    for i in range(0, n, step):
        o = 84 + i * 50
        for v in range(3):
            pts.append(list(struct.unpack_from("<3f", data, o + 12 + 12 * v)))
    return pts


def norm(v):
    length = math.hypot(*v) or 1.0
    return (v[0] / length, v[1] / length, v[2] / length)


def dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def main() -> None:
    if not RAW.exists():
        RAW.write_bytes(OUT.read_bytes())

    tris = read_tris(RAW)
    upper = read_pts(UPPER, step=2)
    ins = norm(INSERTION)
    gingiva = (-ins[0], -ins[1], -ins[2])

    intaglio = []
    for nrm, a, b, c in tris:
        if dot(nrm, gingiva) > 0.35:
            intaglio.append(
                (
                    (a[0] + b[0] + c[0]) / 3,
                    (a[1] + b[1] + c[1]) / 3,
                    (a[2] + b[2] + c[2]) / 3,
                )
            )
    random.seed(2)
    sample = random.sample(intaglio, min(600, len(intaglio)))

    all_pts = [v for _, a, b, c in tris for v in (a, b, c)]
    cc = [sum(p[i] for p in all_pts) / len(all_pts) for i in range(3)]
    near = [
        p
        for p in upper
        if (p[0] - cc[0]) ** 2 + (p[1] - cc[1]) ** 2 + (p[2] - cc[2]) ** 2 < 14**2
    ]

    cell = 0.4
    grid = {}
    for p in near:
        key = (
            int(math.floor(p[0] / cell)),
            int(math.floor(p[1] / cell)),
            int(math.floor(p[2] / cell)),
        )
        grid.setdefault(key, []).append(p)

    def closest(p):
        best = None
        best_d = 1e9
        ix = int(math.floor(p[0] / cell))
        iy = int(math.floor(p[1] / cell))
        iz = int(math.floor(p[2] / cell))
        for dx in range(-3, 4):
            for dy in range(-3, 4):
                for dz in range(-3, 4):
                    for q in grid.get((ix + dx, iy + dy, iz + dz), []):
                        d = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2
                        if d < best_d:
                            best_d = d
                            best = q
        if best is None:
            return None, None
        return best, math.sqrt(best_d)

    # Pure translation ICP along full XYZ, then project residual onto insertion axis.
    t = [0.0, 0.0, 0.0]
    for it in range(12):
        paired = []
        for p in sample:
            q, d = closest((p[0] + t[0], p[1] + t[1], p[2] + t[2]))
            if q is not None and d is not None and d < 3.5:
                paired.append((p, q, d))
        if len(paired) < 80:
            raise SystemExit(f"too few pairs at iter {it}: {len(paired)}")
        # mean of (q - p_moved) = correction
        mx = my = mz = 0.0
        for p, q, _ in paired:
            mx += q[0] - (p[0] + t[0])
            my += q[1] - (p[1] + t[1])
            mz += q[2] - (p[2] + t[2])
        n = len(paired)
        t[0] += mx / n
        t[1] += my / n
        t[2] += mz / n
        dists = sorted(d for _, _, d in paired)
        print(
            f"it{it} n={n} p50={dists[n // 2]:.3f} p90={dists[int(n * 0.9)]:.3f} t={t}"
        )

    print("final translation", t)
    seated = []
    for _, a, b, c in tris:
        seated.append(
            (
                None,
                [a[0] + t[0], a[1] + t[1], a[2] + t[2]],
                [b[0] + t[0], b[1] + t[1], b[2] + t[2]],
                [c[0] + t[0], c[1] + t[1], c[2] + t[2]],
            )
        )
    write_stl(OUT, seated)
    print("wrote", OUT)


if __name__ == "__main__":
    main()
