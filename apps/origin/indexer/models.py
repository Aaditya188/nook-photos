"""Model wrappers: CLIP (semantic), faces (detect + embed), places (geocode).

EVERY capability here is optional. If a model's deps or weights are unavailable —
or the host simply can't run it — that capability is disabled and the rest keeps
working. A box with no working AI at all still serves thumbnails, albums, dates
and browsing; it just has no semantic search, no People and no Places.

Which accelerator is reachable is decided at INSTALL time, not here: every ONNX
Runtime flavour is a separate PyPI distribution (see requirements.txt), so all this
module can do is ask the installed runtime what it has and pick the best of it.
"""
import numpy as np

# Conservative CUDA execution-provider options. onnxruntime's defaults
# (EXHAUSTIVE cuDNN algo search + max convolution workspace + a power-of-two
# growing arena) inflate GPU memory and lengthen session init. Heuristic algo
# search, no max workspace, and an arena that grows exactly as requested cut the
# GPU footprint substantially with negligible inference-speed cost — important on
# a shared 8 GB laptop GPU. All values must be strings for ORT.
# CUDA-ONLY: every other execution provider rejects unknown option keys, so these
# are only ever paired with CUDAExecutionProvider (see pick_providers).
CUDA_OPTS = {
    "cudnn_conv_algo_search": "HEURISTIC",
    "cudnn_conv_use_max_workspace": "0",
    "arena_extend_strategy": "kSameAsRequested",
}

# Execution providers we know how to use, best first. This is a *preference order
# over what the installed runtime actually offers* — it cannot enable anything.
# Each accelerator ships in its own mutually exclusive wheel (onnxruntime-gpu,
# -directml, -openvino) that overwrites the plain one, so a user who wants
# DirectML must have installed onnxruntime-directml; no amount of runtime probing
# will conjure DmlExecutionProvider out of a plain install. CoreML is the one
# freebie: it is compiled into the stock macOS arm64 wheel.
# Deliberately NOT listed:
#   TensorrtExecutionProvider — present in onnxruntime-gpu, but it builds a
#     per-shape engine on first use, which costs minutes of stall for no gain on
#     these small models.
#   XnnpackExecutionProvider — no desktop pip wheel ships it (Android/iOS only),
#     so it can never appear in get_available_providers() here.
PROVIDER_PREFERENCE = (
    "CUDAExecutionProvider",      # NVIDIA          — pip install onnxruntime-gpu
    "DmlExecutionProvider",       # Windows D3D12   — pip install onnxruntime-directml
    "CoreMLExecutionProvider",    # Apple Silicon   — in the stock macOS wheel
    "OpenVINOExecutionProvider",  # Intel CPU/iGPU  — pip install onnxruntime-openvino
    "CPUExecutionProvider",       # always available
)


_warned_no_ort = False


def available_providers() -> list:
    """What the installed onnxruntime can actually do. [] if it won't even import."""
    global _warned_no_ort
    try:
        import onnxruntime as ort
        return list(ort.get_available_providers())
    except Exception as e:
        if not _warned_no_ort:  # called once per model; say it once
            _warned_no_ort = True
            print("[models] onnxruntime unavailable:", e, flush=True)
        return []


def pick_providers():
    """(providers, provider_options) as PARALLEL lists, best accelerator first.

    Returns the shape onnxruntime itself wants (and insightface passes straight
    through). CPUExecutionProvider always rides along last: ORT falls back to it
    per-node for anything the accelerator can't take, and without it a single
    unsupported op is a hard failure. Options are only ever attached to CUDA.
    """
    avail = available_providers()
    chosen = [p for p in PROVIDER_PREFERENCE if p in avail]
    if "CPUExecutionProvider" not in chosen:
        chosen.append("CPUExecutionProvider")
    opts = [dict(CUDA_OPTS) if p == "CUDAExecutionProvider" else {} for p in chosen]
    return chosen, opts


def session_provider(sess, asked: str) -> str:
    """The provider a built session ACTUALLY bound — not the one we asked for.

    These differ silently and it is the single most confusing failure in this stack:
    a CUDA-capable build whose cuDNN/cuBLAS DLLs aren't on the loader path fails over
    to CPU with nothing but a warning, and the only symptom is that indexing is ~10x
    slower forever. (On Windows that path is set up by main._register_cuda_dlls,
    which is why it has to run before the first session is created.) So the startup
    line reports this, not the request.
    """
    try:
        got = list(sess.get_providers())
    except Exception:
        return asked
    for p in PROVIDER_PREFERENCE:
        if p in got:
            return p
    return got[0] if got else asked


# ---- model identity ----------------------------------------------------------
# Embeddings from different models are NOT comparable: cosine similarity between
# vectors from two models is noise, so mixing them silently corrupts search and
# face grouping. These constants are the single source of truth for "which model
# produced the vectors", and the fingerprints below are recorded in the index (see
# store.sync_model_fingerprints) so a swap is detected instead of ignored.
#
# A fingerprint covers ONLY things that change the vector space: model identity,
# weights pack, quantization, and dimensionality. It deliberately excludes the
# execution provider and the package version — the same weights on CPU vs CUDA, or
# under fastembed 0.8 vs 0.9, land in the same space, and folding those in would
# force a pointless full re-index every time someone toggled the GPU.
CLIP_VISION_MODEL = "Qdrant/clip-ViT-B-32-vision"
CLIP_TEXT_MODEL = "Qdrant/clip-ViT-B-32-text"
CLIP_QUANT = "fp32"
CLIP_DIM = 512
FACE_PACK = "buffalo_l"          # det_10g (SCRFD-10GF) + w600k_r50 (ArcFace R50)
FACE_QUANT = "fp32"
FACE_DIM = 512


def clip_fingerprint() -> str:
    return f"fastembed/{CLIP_VISION_MODEL}+{CLIP_TEXT_MODEL}/{CLIP_QUANT}/{CLIP_DIM}"


def face_fingerprint() -> str:
    return f"insightface/{FACE_PACK}/{FACE_QUANT}/{FACE_DIM}"


class Clip:
    """OpenCLIP ViT-B-32 via fastembed (ONNX). Image + text land in the same 512-d
    space, so cosine similarity is a semantic match."""

    def __init__(self):
        from fastembed import ImageEmbedding, TextEmbedding
        providers, opts = pick_providers()
        self.provider = providers[0]
        self.fingerprint = clip_fingerprint()
        # fastembed takes ONE list whose entries are either "Name" or a
        # ("Name", {options}) tuple — not the parallel lists insightface wants — and
        # it raises ValueError for any name missing from get_available_providers().
        # Feeding it detected names is what stops that from happening on a Pi.
        tuned = [(p, o) if o else p for p, o in zip(providers, opts)]
        try:
            self.img = ImageEmbedding(CLIP_VISION_MODEL, providers=tuned)
            self.txt = TextEmbedding(CLIP_TEXT_MODEL, providers=tuned)
        except Exception as e:
            # A fastembed that rejects the tuple form: same providers, no tuning.
            print("[models] CLIP tuned providers unavailable, retrying untuned:", e, flush=True)
            try:
                self.img = ImageEmbedding(CLIP_VISION_MODEL, providers=providers)
                self.txt = TextEmbedding(CLIP_TEXT_MODEL, providers=providers)
            except Exception as e2:
                # Last resort: let fastembed choose (its `cuda` default is AUTO, so
                # this still finds CUDA when it's there). Never pass `cuda=` together
                # with `providers=` — fastembed warns they are mutually exclusive.
                print("[models] CLIP explicit providers failed, using fastembed default:",
                      e2, flush=True)
                self.img = ImageEmbedding(CLIP_VISION_MODEL)
                self.txt = TextEmbedding(CLIP_TEXT_MODEL)
                self.provider = "auto"
        # Best-effort: reach through fastembed's wrapper for the real ORT session so the
        # startup log can't claim CUDA when it silently fell back. Private-ish, hence
        # the getattr chain — worst case we keep reporting what we asked for.
        sess = getattr(getattr(self.img, "model", None), "model", None)
        if sess is not None:
            self.provider = session_provider(sess, self.provider)
        self.dim = CLIP_DIM

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
    """InsightFace buffalo_l: SCRFD-10GF detector (det_10g) + ResNet50 ArcFace
    (w600k_r50) embeddings. The large pack separates identities far better than
    buffalo_s's MobileFaceNet, which is what keeps the same person from splitting
    into many "people". Heavier, but fine on the RTX 4060.

    NOTE for low-power hosts: buffalo_l is ~15-20x the compute of buffalo_s and is
    the single most expensive thing the indexer does — it, not CLIP, is what makes a
    Raspberry Pi crawl. Set NOOK_ENABLE_FACES=0 there."""

    def __init__(self, det_size: int = 640):
        from insightface.app import FaceAnalysis
        providers, opts = pick_providers()
        self.provider = providers[0]
        self.fingerprint = face_fingerprint()
        # insightface forwards **kwargs to onnxruntime.InferenceSession, so here
        # `providers` and `provider_options` are PARALLEL lists (unlike fastembed's
        # single list-of-tuples above). Its own default is a hardcoded
        # ["CUDAExecutionProvider", "CPUExecutionProvider"], which is exactly what
        # used to make face indexing fail on any non-NVIDIA box.
        try:
            self.app = FaceAnalysis(
                name=FACE_PACK,
                providers=providers,
                provider_options=opts,
                allowed_modules=["detection", "recognition"],
            )
        except Exception as e:
            print("[models] faces tuned providers unavailable, retrying untuned:", e, flush=True)
            self.app = FaceAnalysis(
                name=FACE_PACK,
                providers=providers,
                allowed_modules=["detection", "recognition"],
            )
        # insightface's ctx_id is a GPU device index, and ctx_id < 0 makes prepare()
        # call session.set_providers(["CPUExecutionProvider"]) — which would throw
        # away a DirectML/CoreML session we just built. So -1 is used only when CPU
        # really is the chosen provider.
        ctx_id = -1 if self.provider == "CPUExecutionProvider" else 0
        self.app.prepare(ctx_id=ctx_id, det_size=(det_size, det_size))
        # Report what the detector session really bound (see session_provider).
        sess = getattr(self.app.models.get("detection"), "session", None) \
            if hasattr(self.app, "models") else None
        if sess is not None:
            self.provider = session_provider(sess, self.provider)

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


def load_models(enable_clip: bool = True, enable_faces: bool = True):
    """Load available models; None for any that is disabled or fails.

    NOTHING is required. CLIP used to be allowed to raise on the theory that an
    indexer without semantic search is pointless — but that theory kills the whole
    sidecar on a host that can't run CLIP, taking People, Places and the index's own
    bookkeeping down with it. A photo app whose search box is text-only is a lot
    better than one that won't boot, so every model is optional and the callers
    (pipeline, store, HTTP handlers) all check for None.
    """
    print(f"[models] onnxruntime providers: {available_providers() or '(none)'}", flush=True)
    clip = None
    if enable_clip:
        try:
            clip = Clip()
            print(f"[models] CLIP enabled on {clip.provider} [{clip.fingerprint}]", flush=True)
        except Exception as e:
            print("[models] CLIP DISABLED (no semantic search):", e, flush=True)
    else:
        print("[models] CLIP disabled by NOOK_ENABLE_CLIP=0", flush=True)
    faces = None
    if enable_faces:
        try:
            faces = Faces()
            print(f"[models] faces enabled on {faces.provider} [{faces.fingerprint}]", flush=True)
        except Exception as e:
            print("[models] faces DISABLED:", e, flush=True)
    else:
        print("[models] faces disabled by NOOK_ENABLE_FACES=0", flush=True)
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
