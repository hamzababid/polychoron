#!/bin/sh
# Rebuilds the launch video end to end from the running local stack:
# capture data -> screen captures -> frames -> music -> brag.mp4 / brag-20s.mp4,
# then puts the demo environment back to its clean state.
#
# Needs: the Docker dev stack up (frontend on :5173), an LLM key for the
# two scenario cases, and once: `npm ci && npx playwright install chromium-headless-shell`.
set -e
cd "$(dirname "$0")"
FF=node_modules/ffmpeg-static/ffmpeg
Q="docker exec -i polychoron-postgres psql -U polychoron -d polychoron -v ON_ERROR_STOP=1 -q"

echo "1/6 capture data (synthetic volume, clean names, sampling reviews)"
./rebuild-data.sh

echo "2/6 screen captures"
rm -rf shots && mkdir -p shots
node capture.mjs > cap1.log 2>&1
echo "update aml_str_filings set goaml_reference = replace(goaml_reference,'GOAML-DEMO-','GOAML-')" | $Q
node capture2.mjs > cap2.log 2>&1

echo "3/6 frames"
rm -rf frames-main frames-cut
node render.mjs frames frames-main 30 > render-main.log 2>&1
node render.mjs frames frames-cut 30 cutdown > render-cut.log 2>&1

echo "4/6 poster (Case Workspace citation frame), baked in as frame 0"
cp frames-main/f00594.jpg ../brag.jpg
cp ../brag.jpg frames-main/f00000.jpg
cp frames-cut/f00318.jpg frames-cut/f00000.jpg

echo "5/6 music + encode"
node synth2.mjs main music2-main.wav
node synth2.mjs cutdown music2-cut.wav
for pair in "main:../brag.mp4" "cut:../brag-20s.mp4"; do
  k=${pair%%:*}; v=${pair#*:}
  $FF -y -loglevel error -framerate 30 -i frames-$k/f%05d.jpg -i music2-$k.wav \
    -c:v libx264 -preset slow -crf 17 -pix_fmt yuv420p \
    -af "loudnorm=I=-14:TP=-1.0:LRA=11" -ar 48000 -c:a aac -b:a 192k \
    -movflags +faststart -shortest "$v"
done

echo "6/6 restore the clean demo environment"
docker exec -e TEMPORAL_ADDRESS=temporal:7233 -e APP_API_BASE_URL=http://app-api:3000 -w /app \
  polychoron-agent-service-api python scripts/reset_demo_environment.py | grep Injected
$Q <<'SQL'
UPDATE platform_users SET display_name = v.n FROM (VALUES
 ('demo-analyst-1','Amina Raza (Demo Analyst)'), ('demo-compliance-officer-1','Bilal Siddiqui (Demo Compliance Officer)'),
 ('demo-mlro-1','Fatima Noor (Demo MLRO)'), ('demo-model-risk-audit-1','Usman Ali (Demo Model Risk & Audit)'),
 ('demo-external-examiner-1','Sana Iqbal (Demo External Examiner)')) v(id, n) WHERE user_id = v.id;
SQL
rm -rf frames-main frames-cut
grep -h ERRS cap1.log cap2.log render-main.log render-cut.log
echo "done: ../brag.mp4 ../brag-20s.mp4 ../brag.jpg"
