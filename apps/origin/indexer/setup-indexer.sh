#!/usr/bin/env bash
# One-time setup for the Nook AI indexer on a Raspberry Pi, a Mac, or any Linux box.
# Creates a venv, installs deps, warms the model downloads, and prints the systemd
# steps. Re-runnable.
#
#   ./setup-indexer.sh          portable install: CPU everywhere, CoreML on Apple Silicon
#   ./setup-indexer.sh --gpu    then overwrite the runtime with the NVIDIA CUDA build
#
# --gpu is x86_64-only (Linux or Windows); see requirements-gpu.txt for why it has to
# be a second pip pass and why it stays pinned to onnxruntime-gpu 1.22.0.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

GPU=0
for arg in "$@"; do
  case "$arg" in
    --gpu) GPU=1 ;;
    *) echo "unknown option: $arg (expected --gpu)" >&2; exit 2 ;;
  esac
done

if [ -f /etc/debian_version ]; then
  echo "==> System deps (sudo)…"
  sudo apt-get update
  # No compiler needed any more: insightface 1.0.1 ships a py3-none-any wheel, and
  # numpy/scipy/opencv all have aarch64 wheels. (If a future dep ever falls back to
  # building an sdist, add: build-essential python3-dev.)
  # libgl1 + libglib2.0-0 are NOT optional — insightface imports cv2, which links
  # libGL at import time, and a headless Pi/server image has neither.
  sudo apt-get install -y python3-venv python3-pip libgl1 libglib2.0-0
fi

echo "==> Python venv + deps…"
python3 -m venv .venv
# shellcheck disable=SC1091
source .venv/bin/activate
# onnxruntime is cp311+ only. Fail here with a sentence rather than let pip quietly
# resolve a two-year-old runtime and have models misbehave later.
python - <<'PY'
import sys
if sys.version_info < (3, 11):
    sys.exit(f"Python 3.11+ required (this venv is {sys.version.split()[0]}). "
             "onnxruntime publishes no wheels for 3.10 or older.")
PY
pip install --upgrade pip
pip install -r requirements.txt

if [ "$GPU" = "1" ]; then
  # SECOND pass, on purpose. The CPU onnxruntime that insightface hard-depends on is
  # already installed and owns the same `onnxruntime/` directory, so the GPU build has
  # to be written LAST. --no-deps leaves the CPU distribution registered (insightface's
  # requirement stays satisfied, pip check passes) while replacing its files. This is
  # order-independent, unlike the `pip uninstall -y onnxruntime` this replaces, which
  # could delete files the GPU build had already taken over.
  echo "==> Overwriting the runtime with the NVIDIA GPU build (x86_64 only)…"
  pip install --force-reinstall --no-deps -r requirements-gpu.txt
fi

python - <<'PY'
import onnxruntime as ort
print("[setup] onnxruntime", ort.__version__, "providers:", ort.get_available_providers())
PY

echo "==> Warming model downloads (one-time; needs internet)…"
python - <<'PY'
# Providers are auto-detected at runtime (models.pick_providers), so nothing here
# names one — this only pre-fetches weights into the caches.
from fastembed import ImageEmbedding, TextEmbedding
ImageEmbedding("Qdrant/clip-ViT-B-32-vision")
TextEmbedding("Qdrant/clip-ViT-B-32-text")
try:
    from insightface.app import FaceAnalysis
    a = FaceAnalysis(name="buffalo_l", providers=["CPUExecutionProvider"],
                     allowed_modules=["detection", "recognition"])
    a.prepare(ctx_id=-1)
except Exception as e:
    print("faces model skipped:", e)
import reverse_geocoder as rg
rg.search([(0.0, 0.0)], mode=1, verbose=False)
print("models ready")
PY

if [ ! -f indexer.env ]; then
  cp indexer.env.example indexer.env
  echo "==> Created indexer.env — EDIT it (set NOOK_DATA_DIR + a long NOOK_INDEXER_SECRET)."
fi

cat <<EOF

Next steps:
  1) Edit  $DIR/indexer.env  (NOOK_DATA_DIR + NOOK_INDEXER_SECRET).
  2) Edit  $DIR/nook-indexer.service  paths if you cloned elsewhere.
  3) Install the service:
       sudo cp $DIR/nook-indexer.service /etc/systemd/system/
       sudo systemctl daemon-reload
       sudo systemctl enable --now nook-indexer
       systemctl status nook-indexer
  4) Restart your Node server with the SAME  NOOK_INDEXER_SECRET  in its env so
     it can reach the indexer. The app's Search screen will show People / Places
     and semantic search once the first index pass finishes.

On slow hardware (a Pi), face indexing is by far the most expensive stage — set
NOOK_ENABLE_FACES=0 in indexer.env to skip it, or NOOK_ENABLE_CLIP=0 to drop
semantic search. Both are optional; browsing, albums and dates never need either.
Check what you actually got:  curl -s localhost:8091/health

Manual run (for testing): source .venv/bin/activate && python main.py
EOF
