#!/usr/bin/env bash
# Vendor LPC sprites locally so we don't depend on the upstream CDN (which
# dropped per-variant subfolders for body/head/face/hair, breaking the old path
# format). Downloads the subset of layers + variants actually used by
# src/render/lpc/character-builder.ts, across the animations we render.
#
# ANIMS controls which animation sheets to fetch. The classic LPC universal
# layout serves one PNG per animation per layer (walk.png, slash.png, …); the
# vendored renderer composites whichever it finds into the universal sheet
# (src/render/lpc/canvas/renderer.js). Layers that don't support an animation
# 404 — that's expected and harmless (the body carries every animation; some
# clothing/hair only ship a subset, and missing rows just render empty).

set -euo pipefail

BASE="https://liberatedpixelcup.github.io/Universal-LPC-Spritesheet-Character-Generator"
OUT="$(cd "$(dirname "$0")/.." && pwd)/public/sprites/lpc/spritesheets"

# Animations to vendor. 'walk' is the baseline; the rest power the action
# prototype (worship→spellcast, soldier drill→slash/thrust/shoot, death→hurt).
ANIMS=(walk spellcast thrust slash shoot hurt)

# Layer directories served as a single variantless <anim>.png (no per-colour
# subfolder upstream). Skin tone & hair colour do NOT vary — diversity comes
# from body type, hair STYLE, and clothing colour.
VARIANTLESS_DIRS=(
  body/bodies/male
  body/bodies/female
  body/bodies/child
  body/bodies/teen
  head/heads/human/male
  head/heads/human/female
  head/heads/human/male_elderly
  head/heads/human/male_gaunt
  head/heads/human/child
  head/faces/male/neutral
  head/faces/female/neutral
  head/faces/elderly/neutral
  hair/buzzcut/adult
  hair/plain/adult
  hair/balding/adult
  hair/parted/adult
  hair/parted2/adult
  hair/page/adult
  hair/messy1/adult
  hair/messy2/adult
  hair/unkempt/adult
  hair/pigtails/adult
  hair/afro/adult
  hair/bob/adult
  hair/bob_side_part/adult
  hair/long/adult
  hair/long_straight/adult
  hair/bangs/adult
  hair/pixie/adult
  torso/clothes/longsleeve/longsleeve2_polo/male
  torso/clothes/longsleeve/longsleeve2_buttoned/male
  torso/armour/plate/male
  arms/armour/plate/male
  legs/armour/plate/male
)

# Layers served as <anim>/<variant>.png. Female clothing lives under a
# `female`/`thin` body folder (male-clothing itemIds 404 on female paths).
PER_VARIANT=(
  "legs/hose/male leather black brown gray"
  "legs/leggings/male black"
  "legs/leggings2/male black"
  "legs/pants/child black blue brown"
  "torso/clothes/shirt/child black blue brown"
  "feet/sandals/male brown"
  "feet/boots/basic/male black brown"
  "feet/boots/revised/male black"
  "feet/armour/plate/male steel iron brass"
  # ── Female wardrobe ──
  "torso/clothes/blouse/female black blue green red walnut white"
  "torso/clothes/blouse_longsleeve/female black blue green walnut"
  "legs/hose/thin black leather brown gray"
  "legs/leggings/thin black brown gray"
  "feet/boots/basic/thin black brown"
  "feet/sandals/thin brown black"
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
    echo "  miss $rel"
    rm -f "$dst"
    return 1
  fi
}

mkdir -p "$OUT"
echo "Fetching variantless sprites (${#ANIMS[@]} animations × ${#VARIANTLESS_DIRS[@]} layers)..."
for dir in "${VARIANTLESS_DIRS[@]}"; do
  for anim in "${ANIMS[@]}"; do
    fetch_one "$dir/$anim.png" || true
  done
done

echo
echo "Fetching per-variant sprites..."
for line in "${PER_VARIANT[@]}"; do
  read -r dir rest <<< "$line"
  for anim in "${ANIMS[@]}"; do
    for v in $rest; do
      fetch_one "$dir/$anim/$v.png" || true
    done
  done
done

echo
echo "Done. Vendor size:"
du -sh "$OUT" || true
