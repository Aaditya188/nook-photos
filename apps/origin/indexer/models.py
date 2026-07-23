"""Model wrappers: CLIP (semantic), faces (detect + embed), places (geocode).

Faces and geocoding degrade gracefully — if their optional deps or model files
are unavailable, that capability is simply disabled and the rest keeps working.
"""
import numpy as np


class Clip:
    """OpenCLIP ViT-B-32 via fastembed (ONNX/CPU). Image + text land in the same
    512-d space, so cosine similarity is a semantic match."""

    def __init__(self):
        from fastembed import ImageEmbedding, TextEmbedding
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
