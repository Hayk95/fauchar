# ToothCraft internal evaluation

Crown bottom can send a margin-centered local preparation crop to the technician's own loopback inference service. It uses the normal (ODD) checkpoint pair. The returned surface includes context and appears as a translucent overlay in original scan coordinates. It does not provide a milled intaglio, contact adaptation or a finished restoration. Inspect input orientation and results. An open scan crop can fail signed-distance conversion.

Use a CUDA workstation, Python 3.10 and a compatible PyTorch 2.9/xformers installation. From the FAUCHAR checkout:

    git clone https://github.com/ikarus1211/VISAPP_ToothCraft ../ToothCraft
    git -C ../ToothCraft checkout 53091b77f1e0a8cd71341674f43a8976f578ddde
    export TOOTHCRAFT_SRC="$(realpath ../ToothCraft)"
    export TOOTHCRAFT_WEIGHTS="$(pwd)/../toothcraft-weights"
    python -m pip install -r "$TOOTHCRAFT_SRC/requirements.txt"
    python -m pip install fastapi uvicorn trimesh mesh2sdf huggingface_hub
    hf download DejvaX/ToothCraft ToothCraft_normal_control_branch.pth ToothCraft_normal_diff_branch.pth --local-dir "$TOOTHCRAFT_WEIGHTS"
    export FAUCHAR_ORIGIN=http://localhost:3000
    PYTHONPATH="$TOOTHCRAFT_SRC" python -m uvicorn service:app --app-dir services/toothcraft --host 127.0.0.1 --port 7861

Launch the local FAUCHAR web app with NEXT_PUBLIC_TOOTHCRAFT_EVALUATION=1 set before starting/building Next. Open Crown bottom after confirming the preparation margin and insertion direction. Click Generate AI preview. Clear preview removes the overlay. The service accepts only the configured browser origin. No hosted inference provider is required.

Model and source terms are separate. The model authors permit internal commercial evaluation for 90 days after obtaining the model, with no production deployment or third-party outputs under that permission. For commercial deployment obtain appropriate rights from the authors. See https://huggingface.co/DejvaX/ToothCraft and https://github.com/ikarus1211/VISAPP_ToothCraft for attribution and current terms.

## Status on the development Mac (November 2026)
Not run. Apple M4 Pro has no CUDA (the service refuses to start without it), torch is not installed,
and neither the authors' source nor the weights are on disk. The STL crown pipeline does not depend on it.
