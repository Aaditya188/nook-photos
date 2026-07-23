#!/usr/bin/env bash
# Runs on the Pi (detached). Waits for the indexer model warm-up to finish,
# then installs + enables the nook-indexer service and restarts Node so the
# app flips to ai:true. Independent of the (flaky) SSH session.
cd /home/raspberrypi/nook-server/indexer || exit 1

# Wait up to ~50 min for the warm-up to finish (or setup-indexer.sh to exit).
for i in $(seq 1 200); do
  grep -q "models ready" setup.log 2>/dev/null && break
  pgrep -f "[s]etup-indexer.sh" >/dev/null 2>&1 || break
  sleep 15
done

if ! grep -q "models ready" setup.log 2>/dev/null; then
  echo "SETUP NOT READY -- not enabling service"
  tail -25 setup.log
  exit 1
fi

echo "=== models ready; installing nook-indexer service ==="
sudo cp nook-indexer.service /etc/systemd/system/nook-indexer.service
sudo systemctl daemon-reload
sudo systemctl enable --now nook-indexer
sleep 12
echo "indexer active: $(systemctl is-active nook-indexer)"
systemctl --no-pager status nook-indexer 2>/dev/null | sed -n '1,6p'

echo "=== restart nook to pick up the ai flag ==="
sudo systemctl restart nook
sleep 5
echo "api/server: $(curl -s http://127.0.0.1:8080/api/server)"
echo "=== FINALIZE DONE ==="
