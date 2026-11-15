"""Loopback ToothCraft evaluation server. Uses the authors' normal checkpoint pair."""
import io
import os
from pathlib import Path
from threading import Lock

import mesh2sdf
import numpy as np
import torch
import trimesh
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from omegaconf import OmegaConf
from skimage.measure import marching_cubes
from starlette.concurrency import run_in_threadpool

from model.network import initialize_control_net, initialize_diff_net
from model.diffusion import initialize_diff_model
from model.diffusion.gaussian_diffusion import get_named_beta_schedule

origin = os.environ["FAUCHAR_ORIGIN"]
app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=[origin], allow_methods=["POST"],
                   allow_headers=["Content-Type", "X-Fauchar-Evaluation"])
lock = Lock()


@app.on_event("startup")
def load():
    if not torch.cuda.is_available():
        raise RuntimeError("ToothCraft evaluation requires CUDA")
    cfg = OmegaConf.load(Path(os.environ["TOOTHCRAFT_SRC"]) / "configs/test/test_normal.yaml")
    for key, factory, name in [("control", initialize_control_net, "control"),
                                ("diff", initialize_diff_net, "diff")]:
        model = factory(cfg)
        path = Path(os.environ["TOOTHCRAFT_WEIGHTS"]) / f"ToothCraft_normal_{name}_branch.pth"
        model.load_state_dict(torch.load(path, map_location="cpu", weights_only=True)["state_dict"])
        setattr(app.state, key, model.cuda().eval())
    schedule = cfg.diffusion
    betas = get_named_beta_schedule(schedule.beta_schedule, schedule.step, schedule.scale_ratio)
    app.state.sampler = initialize_diff_model(betas, cfg, schedule.model)


@torch.inference_mode()
def complete(data):
    mesh = trimesh.load(io.BytesIO(data), file_type="stl", force="mesh")
    if mesh.is_empty or not np.isfinite(mesh.vertices).all() or np.abs(mesh.vertices).max() > 1.001:
        raise ValueError("Expected a normalized local preparation mesh")
    field = mesh2sdf.compute(mesh.vertices, mesh.faces, size=64)
    if not np.isfinite(field).all() or field.min() >= 0:
        raise ValueError("Scan context has no usable signed interior")
    hint = torch.from_numpy(field.clip(-1, 1).astype("float32")).cuda()[None, None]
    prediction = app.state.sampler.p_sample_loop(
        model=app.state.diff, control_model=app.state.control, shape=hint.shape,
        device=hint.device, progress=False, noise=None, clip_denoised=False,
        model_kwargs=dict(hint=hint, y=None, antag=None, noise_save_path=None))
    volume = prediction[0, 0].float().cpu().numpy()
    if not np.isfinite(volume).all() or not volume.min() < 0 < volume.max():
        raise ValueError("Model produced no finite zero surface")
    vertices, faces, _, _ = marching_cubes(volume, level=0)
    return trimesh.Trimesh(vertices=vertices / 32 - 1, faces=faces, process=False).export(file_type="stl")


@app.post("/complete")
async def evaluate(request: Request):
    if request.headers.get("origin") != origin or request.headers.get("x-fauchar-evaluation") != "1":
        raise HTTPException(403, "Unexpected client origin")
    if not lock.acquire(blocking=False):
        raise HTTPException(409, "ToothCraft is processing another scan")
    try:
        data = bytearray()
        async for chunk in request.stream():
            if len(data) + len(chunk) > 16 * 1024 * 1024:
                raise HTTPException(413, "Scan crop exceeds 16 MB")
            data.extend(chunk)
        if len(data) < 84 or len(data) != 84 + 50 * int.from_bytes(data[80:84], "little"):
            raise HTTPException(400, "Invalid binary STL")
        result = await run_in_threadpool(complete, bytes(data))
        return Response(result, media_type="model/stl")
    except ValueError as error:
        raise HTTPException(422, str(error)) from error
    finally:
        lock.release()
