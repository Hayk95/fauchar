import os, io, base64, time
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage
import numpy as np

# ─────────────────────────────────────────────────────────────────────────────
MODEL_PATH = os.environ.get("MODEL_PATH", "best_model.pth")
MODEL_TYPE = "pytorch"
IMG_SIZE = int(os.environ.get("IMG_SIZE", "640"))
CONFIDENCE = float(os.environ.get("CONFIDENCE", "0.35"))
DEVICE = os.environ.get("DEVICE", "cpu")
NUM_CLASSES = 6  # background + 5 tooth classes
# ─────────────────────────────────────────────────────────────────────────────

# Class index 0 = background; 1..5 match training labels
TOOTH_CLASSES = ["background", "Molars", "Premolars", "Canines", "Incisors", "Filling"]

CLASS_COLORS = {
    "Molars": (255, 0, 250),
    "Premolars": (255, 0, 8),
    "Canines": (0, 127, 255),
    "Incisors": (42, 255, 0),
    "Filling": (196, 201, 255),
}
DEFAULT_COLOR = (99, 102, 241)

NAME_MAP = {
    "molar": "Molars", "Molar": "Molars", "Molars": "Molars",
    "premolar": "Premolars", "Premolar": "Premolars", "Premolars": "Premolars",
    "canine": "Canines", "Canine": "Canines", "Canines": "Canines",
    "cannine": "Canines", "canin": "Canines",
    "incisor": "Incisors", "Incisor": "Incisors", "Incisors": "Incisors",
    "incissors": "Incisors", "incissor": "Incisors",
    "filling": "Filling", "Filling": "Filling", "Fillings": "Filling",
    "background": "background",
}

def fix_name(raw: str) -> str:
    return NAME_MAP.get(raw, raw)

# ─────────────────────────────────────────────────────────────────────────────

app = FastAPI(title="DentalOS Tooth Segmentation API", version="1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

model = None


def build_model():
    import segmentation_models_pytorch as smp
    # Checkpoint matches Unet++ + ResNet50 + scSE decoder (cSE/sSE keys).
    return smp.UnetPlusPlus(
        encoder_name="resnet50",
        encoder_weights=None,
        in_channels=3,
        classes=NUM_CLASSES,
        activation=None,
        decoder_attention_type="scse",
    )


@app.on_event("startup")
async def load_model():
    global model
    if not os.path.exists(MODEL_PATH):
        print(f"⚠️  Model file not found: {MODEL_PATH} — inference unavailable")
        return

    print(f"🔄 Loading model from {MODEL_PATH} ...")
    t0 = time.time()

    import torch
    checkpoint = torch.load(MODEL_PATH, map_location=DEVICE, weights_only=False)

    net = build_model()
    state = None
    if isinstance(checkpoint, dict):
        if "model_state_dict" in checkpoint:
            state = checkpoint["model_state_dict"]
        elif "state_dict" in checkpoint:
            state = checkpoint["state_dict"]
        elif "model" in checkpoint and hasattr(checkpoint["model"], "state_dict"):
            state = checkpoint["model"].state_dict()
        elif all(isinstance(k, str) for k in checkpoint.keys()) and any(
            k.startswith("encoder.") or k.startswith("decoder.") for k in checkpoint.keys()
        ):
            state = checkpoint
        print(
            f"Checkpoint meta: epoch={checkpoint.get('epoch')}, "
            f"best_iou={checkpoint.get('best_iou')}"
        )
    elif hasattr(checkpoint, "state_dict"):
        state = checkpoint.state_dict()

    if state is None:
        print("⚠️  Could not find weights in checkpoint — inference unavailable")
        return

    # Strip possible DataParallel prefixes
    cleaned = {}
    for k, v in state.items():
        nk = k[7:] if k.startswith("module.") else k
        cleaned[nk] = v

    missing, unexpected = net.load_state_dict(cleaned, strict=True)
    if missing:
        print(f"Missing keys ({len(missing)}): {missing[:8]}...")
    if unexpected:
        print(f"Unexpected keys ({len(unexpected)}): {unexpected[:8]}...")

    net.to(DEVICE)
    net.eval()
    model = net
    print(f"✅ Model loaded in {time.time()-t0:.2f}s on {DEVICE}")


@app.get("/")
def root():
    return {
        "service": "DentalOS Tooth Segmentation API",
        "model_loaded": model is not None,
        "model_type": MODEL_TYPE,
        "status": "ready" if model else "unavailable",
    }


@app.get("/health")
def health():
    return {"status": "ok" if model is not None else "unavailable", "model": "loaded" if model is not None else "missing"}


@app.post("/segment")
async def segment(file: UploadFile = File(...)):
    if file.content_type not in ["image/jpeg", "image/png", "image/jpg", "image/webp"]:
        raise HTTPException(400, "Only JPG/PNG supported.")

    contents = await file.read()
    img_pil = Image.open(io.BytesIO(contents)).convert("RGB")
    t0 = time.time()

    if model is None:
        raise HTTPException(503, "Segmentation model weights are unavailable.")
    else:
        detections, annotated_b64 = _run_pytorch(img_pil)

    inference_ms = round((time.time() - t0) * 1000)

    summary = {
        "Molars": len([d for d in detections if d["label"] == "Molars"]),
        "Premolars": len([d for d in detections if d["label"] == "Premolars"]),
        "Canines": len([d for d in detections if d["label"] == "Canines"]),
        "Incisors": len([d for d in detections if d["label"] == "Incisors"]),
        "Fillings": len([d for d in detections if d["label"] == "Filling"]),
    }

    return JSONResponse({
        "annotated_image": annotated_b64,
        "detections": detections,
        "summary": summary,
        "inference_ms": inference_ms,
        "model_type": MODEL_TYPE,
        "is_demo": model is None,
    })


def _run_pytorch(img_pil: Image.Image):
    import torch
    import torch.nn.functional as F

    w, h = img_pil.size
    img_resized = img_pil.resize((IMG_SIZE, IMG_SIZE))
    img_arr = np.array(img_resized).astype(np.float32) / 255.0
    # ImageNet normalization used by ResNet encoders in SMP
    mean = np.array([0.485, 0.456, 0.406], dtype=np.float32)
    std = np.array([0.229, 0.224, 0.225], dtype=np.float32)
    img_arr = (img_arr - mean) / std
    img_tensor = torch.from_numpy(img_arr.transpose(2, 0, 1)).unsqueeze(0).to(DEVICE)

    with torch.no_grad():
        logits = model(img_tensor)
        if isinstance(logits, (list, tuple)):
            logits = logits[0]
        # logits: [1, C, H, W]
        if logits.shape[-2:] != (IMG_SIZE, IMG_SIZE):
            logits = F.interpolate(logits, size=(IMG_SIZE, IMG_SIZE), mode="bilinear", align_corners=False)
        probs = torch.softmax(logits, dim=1)[0].cpu().numpy()
        pred = probs.argmax(axis=0)

    return annotate_regions(img_pil, pred, probs)


def annotate_regions(image, pred, probs):
    height, width = pred.shape
    sx, sy = image.width / width, image.height / height
    composed = image.convert("RGBA")
    detections = []
    for cls_id, label in enumerate(TOOTH_CLASSES[1:], 1):
        pixels = (pred == cls_id) & (probs[cls_id] >= CONFIDENCE)
        components, _ = ndimage.label(pixels)
        for index, bounds in enumerate(ndimage.find_objects(components), 1):
            if bounds is None:
                continue
            region = components[bounds] == index
            area = int(region.sum())
            if area < 4:
                continue
            rows, cols = bounds
            box = [int(cols.start * sx), int(rows.start * sy),
                   min(image.width, int(np.ceil(cols.stop * sx))),
                   min(image.height, int(np.ceil(rows.stop * sy)))]
            mask = Image.fromarray(region.astype(np.uint8) * 255).resize(
                (box[2] - box[0], box[3] - box[1]), Image.Resampling.NEAREST)
            # Pad first so the outline follows edges touching the crop boundary.
            padded = Image.new("L", (mask.width + 2, mask.height + 2))
            padded.paste(mask, (1, 1))
            interior = padded.filter(ImageFilter.MinFilter(3)).crop((1, 1, mask.width + 1, mask.height + 1))
            alpha = np.where(np.asarray(mask) > np.asarray(interior), 235, np.asarray(mask) // 3).astype(np.uint8)
            layer = Image.new("RGBA", mask.size, CLASS_COLORS[label])
            layer.putalpha(Image.fromarray(alpha))
            composed.alpha_composite(layer, (box[0], box[1]))
            number = len(detections) + 1
            detections.append({"label": label, "instance_id": number, "tooth_id": None,
                               "confidence": round(float(probs[cls_id][bounds][region].mean()), 3),
                               "bbox": box, "area_px": round(area * sx * sy)})
            ImageDraw.Draw(composed).text((box[0], box[1]), str(number), fill="white", stroke_width=1, stroke_fill="black")
    return detections, _img_to_b64(composed.convert("RGB"))


def _img_to_b64(img: Image.Image) -> str:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="0.0.0.0", port=7860, reload=False)
