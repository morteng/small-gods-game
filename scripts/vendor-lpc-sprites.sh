#!/usr/bin/env bash
# Vendor LPC walk sprites locally so we don't depend on the upstream CDN
# (which dropped per-variant subfolders for body/head/face/hair, breaking
# the old path format). Downloads the subset of layers + variants actually
# used by src/render/lpc/character-builder.ts.

set -euo pipefail

BASE="https://liberatedpixelcup.github.io/Universal-LPC-Spritesheet-Character-Generator"
OUT="$(cd "$(dirname "$0")/.." && pwd)/public/sprites/lpc/spritesheets"

# Variantless walk.png — each is one fetch
VARIANTLESS=(
  body/bodies/male/walk.png
  body/bodies/child/walk.png
  head/heads/human/male/walk.png
  head/heads/human/male_elderly/walk.png
  head/heads/human/male_gaunt/walk.png
  head/heads/human/child/walk.png
  head/faces/male/neutral/walk.png
  head/faces/elderly/neutral/walk.png
  hair/buzzcut/adult/walk.png
  hair/plain/adult/walk.png
  hair/balding/adult/walk.png
  hair/parted/adult/walk.png
  hair/parted2/adult/walk.png
  hair/page/adult/walk.png
  hair/messy1/adult/walk.png
  hair/messy2/adult/walk.png
  hair/unkempt/adult/walk.png
  hair/pigtails/adult/walk.png
  torso/clothes/longsleeve/longsleeve2_polo/male/walk.png
  torso/clothes/longsleeve/longsleeve2_buttoned/male/walk.png
  torso/armour/plate/male/walk.png
  arms/armour/plate/male/walk.png
  legs/armour/plate/male/walk.png
)

# Per-variant walk/<variant>.png — base path + variant list
PER_VARIANT=(
  "legs/hose/male/walk leather black"
  "legs/leggings/male/walk black"
  "legs/leggings2/male/walk black"
  "legs/pants/child/walk black blue brown"
  "torso/clothes/shirt/child/walk black blue brown"
  "feet/sandals/male/walk brown"
  "feet/boots/basic/male/walk black"
  "feet/boots/revised/male/walk black"
  "feet/armour/plate/male/walk steel iron brass"
)

fetch_one() {
  local rel="$1"
  local dst="$OUT/$rel"
  mkdir -p "$(dirname "$dst")"
  if [[ -f "$dst" ]]; then
    echo "  skip $rel (exists)"
    return 0
  fi
  local url="$BASE/spritesheets/$rel"
  if curl -sSfL --max-time 30 -o "$dst" "$url"; then
    echo "  ok   $rel"
  else
    echo "  FAIL $rel"
    rm -f "$dst"
    return 1
  fi
}

mkdir -p "$OUT"
echo "Fetching variantless walk sprites..."
for p in "${VARIANTLESS[@]}"; do
  fetch_one "$p" || true
done

echo
echo "Fetching per-variant walk sprites..."
for line in "${PER_VARIANT[@]}"; do
  read -r base rest <<< "$line"
  for v in $rest; do
    fetch_one "$base/$v.png" || true
  done
done

echo
echo "Done. Vendor size:"
du -sh "$OUT" || true
