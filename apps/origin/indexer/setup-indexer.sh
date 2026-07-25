#!/usr/bin/env bash
# One-time setup for the Nook AI indexer on the Raspberry Pi (or any Linux box).
# Creates a venv, installs deps, warms the model downloads, and prints the
# systemd steps. Re-runnable.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

echo "==> System build deps (sudo)…"
sudo apt-get update
sudo apt-get install -y python3-venv python3-dev build-essential cmake

echo "==> Python venv + deps…"
python3 -m venv .venv
# shellcheck disable=SC1091
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt

# insightface hard-depends on the CPU `onnxruntime`, whose wheel overwrites the GPU
# wheel's files and silently strips CUDAExecutionProvider. On a GPU host, drop the CPU
# runtime pip just dragged in; on a CPU-only host there is nothing to do.
if pip show onnxruntime-gpu >/dev/null 2>&1 && pip show onnxruntime >/dev/null 2>&1; then
  echo "==> Removing the CPU onnxruntime pulled in by insightface (keeps the GPU stack)…"
  pip uninstall -y onnxruntime
fi
python - <<'PY'
import onnxruntime as ort
print("[setup] onnxruntime", ort.__version__, "providers:", ort.get_available_providers())
PY

echo "==> Warming model downloads (one-time; needs internet)…"
python - <<'PY'
from fastembed import ImageEmbedding, TextEmbedding
ImageEmbedding("Qdrant/clip-ViT-B-32-vision")
TextEmbedding("Qdrant/clip-ViT-B-32-text")
try:
    from insightface.app import FaceAnalysis
    a = FaceAnalysis(name="buffalo_s", allowed_modules=["detection", "recognition"])
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

Manual run (for testing): source .venv/bin/activate && python main.py
EOF
