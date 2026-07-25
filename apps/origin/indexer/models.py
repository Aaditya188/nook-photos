"""Model wrappers: CLIP (semantic), faces (detect + embed), places (geocode).

Faces and geocoding degrade gracefully — if their optional deps or model files
are unavailable, that capability is simply disabled and the rest keeps working.
"""
import numpy as np

# Conservative CUDA execution-provider options. onnxruntime's defaults
# (EXHAUSTIVE cuDNN algo search + max convolution workspace + a power-of-two
# growing arena) inflate GPU memory and lengthen session init. Heuristic algo
# search, no max workspace, and an arena that grows exactly as requested cut the
# GPU footprint substantially with negligible inference-speed cost — important on
# a shared 8 GB laptop GPU. All values must be strings for ORT.
CUDA_OPTS = {
    "cudnn_conv_algo_search": "HEURISTIC",
    "cudnn_conv_use_max_workspace": "0",
    "arena_extend_strategy": "kSameAsRequested",
}


class Clip:
    """OpenCLIP ViT-B-32 via fastembed (ONNX/CUDA). Image + text land in the same
    512-d space, so cosine similarity is a semantic match."""

    def __init__(self):
        from fastembed import ImageEmbedding, TextEmbedding
        providers = [("CUDAExecutionProvider", CUDA_OPTS), "CPUExecutionProvider"]
        try:
            self.img = ImageEmbedding("Qdrant/clip-ViT-B-32-vision", providers=providers)
            self.txt = TextEmbedding("Qdrant/clip-ViT-B-32-text", providers=providers)
        except Exception as e:
            # Older/newer fastembed that rejects the tuple form → plain CUDA path.
            print("[models] CLIP tuned providers unavailable, using default CUDA:", e, flush=True)
            self.img = ImageEmbedding("Qdrant/clip-ViT-B-32-vision", cuda=True)
            self.txt = TextEmbedding("Qdrant/clip-ViT-B-32-text", cuda=True)
        self.dim = 512

    @staticmethod
    def _norm(v) -> np.ndarray:
        v = np.asarray(v, dtype=np.float32)
        n = np.linalg.norm(v)
        return v / n if n > 0 else v

    def embed_image(self, path: str):
        try:
            return self._norm(next(iter(self.img.embed([path]))))
        except Exception:
            return None

    def embed_text(self, text: str) -> np.ndarray:
        return self._norm(next(iter(self.txt.embed([text]))))


class Faces:
    """InsightFace buffalo_l: RetinaFace-10G detector + ResNet50 ArcFace (w600k_r50)
    embeddings. The large pack separates identities far better than buffalo_s's
    MobileFaceNet, which is what keeps the same person from splitting into many
    "people". Heavier, but fine on the RTX 4060."""

    def __init__(self, det_size: int = 640):
        from insightface.app import FaceAnalysis
        try:
            self.app = FaceAnalysis(
                name="buffalo_l",
                providers=["CUDAExecutionProvider", "CPUExecutionProvider"],
                provider_options=[CUDA_OPTS, {}],
                allowed_modules=["detection", "recognition"],
            )
        except Exception as e:
            print("[models] faces tuned providers unavailable, using default CUDA:", e, flush=True)
            self.app = FaceAnalysis(
                name="buffalo_l",
                providers=["CUDAExecutionProvider", "CPUExecutionProvider"],
                allowed_modules=["detection", "recognition"],
            )
        self.app.prepare(ctx_id=0, det_size=(det_size, det_size))

    def detect(self, bgr_image) -> list:
        out = []
        for f in self.app.get(bgr_image):
            emb = getattr(f, "normed_embedding", None)
            if emb is None:
                continue
            out.append({
                "bbox": [float(x) for x in f.bbox.tolist()],
                "det_score": float(f.det_score),
                "embedding": np.asarray(emb, dtype=np.float32),
            })
        return out


class Places:
    """Offline reverse geocoding (GPS → city/country) via reverse_geocoder."""

    def __init__(self):
        import reverse_geocoder as rg
        self.rg = rg
        # mode=1 = single-threaded: no multiprocessing (avoids the macOS spawn /
        # freeze_support re-import issue; on the Pi it's plenty fast anyway).
        self.rg.search([(0.0, 0.0)], mode=1, verbose=False)  # warm the k-d tree

    def lookup(self, lat: float, lon: float):
        try:
            r = self.rg.search([(float(lat), float(lon))], mode=1, verbose=False)[0]
        except Exception:
            return None
        city = (r.get("name") or "").strip()
        admin1 = (r.get("admin1") or "").strip()
        cc = (r.get("cc") or "").strip()
        label = ", ".join(p for p in [city, cc] if p)
        return {"city": city, "admin1": admin1, "cc": cc, "label": label}


def load_models(enable_faces: bool = True):
    """Load available models; None for any that fail so the service still runs."""
    clip = Clip()  # required — if CLIP fails, the indexer is pointless, let it raise
    faces = None
    if enable_faces:
        try:
            faces = Faces()
            print("[models] faces enabled (buffalo_l)", flush=True)
        except Exception as e:
            print("[models] faces DISABLED:", e, flush=True)
    places = None
    try:
        places = Places()
        print("[models] places enabled (reverse_geocoder)", flush=True)
    except Exception as e:
        print("[models] places DISABLED:", e, flush=True)
    return clip, faces, places


def load_bgr(path: str):
    """Load an image as a BGR numpy array for insightface (via PIL, no cv2 IO)."""
    from PIL import Image
    try:
        img = Image.open(path).convert("RGB")
        return np.asarray(img)[:, :, ::-1].copy()  # RGB→BGR
    except Exception:
        return None


# Face crops are judged at a common effective resolution: a crop larger than this is
# integer-subsampled down to roughly this side before the Laplacian, so a 300 px
# close-up and a 60 px face are scored on comparable pixel density. Subsampling (not
# interpolating) is deliberate — resampling filters smooth the image and would make
# every small crop read as blurry.
SHARPNESS_TARGET_PX = 96


def face_sharpness(bgr, box) -> float:
    """Blur score for one face crop: the variance of its Laplacian (higher = sharper).

    A blurred crop (motion smear, out-of-focus background face) carries almost no
    high-frequency energy, so its second derivative stays near zero and the variance
    collapses; a crisp crop has strong edges and a large variance. Measured on this
    library, sharp faces land in the hundreds-to-thousands and the blurry tail sits
    under ~100. `box` is the normalized [x, y, w, h] crop stored on the face row.
    Returns 0.0 for an unusable crop.
    """
    ih, iw = bgr.shape[0], bgr.shape[1]
    x1 = max(0, int(box[0] * iw))
    y1 = max(0, int(box[1] * ih))
    x2 = min(iw, int((box[0] + box[2]) * iw))
    y2 = min(ih, int((box[1] + box[3]) * ih))
    if x2 - x1 < 8 or y2 - y1 < 8:
        return 0.0
    crop = bgr[y1:y2, x1:x2]
    # Rec.601 luma from BGR, float32 so the differences don't wrap.
    g = (0.114 * crop[:, :, 0] + 0.587 * crop[:, :, 1] + 0.299 * crop[:, :, 2]).astype(np.float32)
    step = max(1, min(g.shape[0], g.shape[1]) // SHARPNESS_TARGET_PX)
    if step > 1:
        g = g[::step, ::step]
    if g.shape[0] < 5 or g.shape[1] < 5:
        return 0.0
    # 4-neighbour Laplacian as a second difference — no cv2/scipy convolution needed.
    lap = g[:-2, 1:-1] + g[2:, 1:-1] + g[1:-1, :-2] + g[1:-1, 2:] - 4.0 * g[1:-1, 1:-1]
    return float(lap.var())
