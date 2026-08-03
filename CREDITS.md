# Art Credits

All art assets in this project are used under their respective licenses.
CC-BY-SA 3.0: https://creativecommons.org/licenses/by-sa/3.0/
CC-BY-SA 4.0: https://creativecommons.org/licenses/by-sa/4.0/
CC0: https://creativecommons.org/publicdomain/zero/1.0/

---

## Terrain Tiles

**[LPC] Terrains**
- Author: bluecarrot16
- License: CC-BY-SA 3.0 / CC-BY-SA 4.0
- Source: https://opengameart.org/content/lpc-terrains
- File: `public/sprites/terrain/lpc-terrain.png`
- Used for: Ground terrain tiles (grass, water, dirt, sand, stone, rocky)
  with 8-neighbor blob autotiling (47-variant layout)
- Credit chain: See the CREDITS.txt included in the [LPC] Terrains pack for
  full attribution of contributing artists

---

## Building Sprites

**[LPC] Thatched-roof Cottage**
- Author: bluecarrot16
- License: CC-BY-SA 3.0
- Source: https://opengameart.org/content/lpc-thatched-roof-cottage
- File: `public/sprites/buildings/` (planned, not yet included)
- Used for: Cottage, barn, tavern building sprites

**[LPC] Medieval Village Decorations**
- Author: bluecarrot16
- License: CC-BY-SA 3.0 / CC-BY-SA 4.0
- Source: https://opengameart.org/content/lpc-medieval-village-decorations
- File: `public/sprites/buildings/` (planned, not yet included)
- Used for: Market stall, temple, and decoration sprites

---

## Tree Sprites

**LPC Trees**
- Based on LPC (Liberated Pixel Cup) art
- License: CC-BY-SA 3.0
- Source: https://opengameart.org/content/liberated-pixel-cup-lpc-base-assets-sprites-map-tiles
- Files: `public/sprites/trees/trees-green.png`, `trees-orange.png`,
  `trees-dead.png`, `trees-pale.png`, `trees-brown.png`
- Used for: Decorative tree sprites placed on forest tiles

---

## Tile Sprites (Fallback)

**Kenney Tiny Town**
- Author: Kenney (kenney.nl)
- License: CC0 (Public Domain)
- Source: https://kenney.nl/assets/tiny-town
- File: `public/sprites/tiles/kenney-town.png`
- Used for: Road, river, bridge overlay sprites; legacy fallback rendering

---

## NPC Sprites

**LPC Base Assets — Characters**
- License: CC-BY-SA 3.0
- Source: https://opengameart.org/content/liberated-pixel-cup-lpc-base-assets-sprites-map-tiles
- Used for: NPC character spritesheets (procedurally composited via LPC generator)
- File: `public/sprites/lpc/spritesheets/` (vendored walk-cycle sprites only —
  body, head, face, hair, clothes, legs, feet, armour; male/female/child body
  types). Pulled from the
  upstream Universal-LPC-Spritesheet-Character-Generator repo via
  `scripts/vendor-lpc-sprites.sh`. See that repo's CREDITS for the full
  per-file contributor chain (bluecarrot16, JaidynReiman, makrohn, wulax,
  Redshrike, and many others).

---

## Motion Capture Data

**CMU Graphics Lab Motion Capture Database** (BVH conversion by Bruce Hahne)
- License: free for research **and commercial** use worldwide; the BVH
  conversion adds no further restrictions. Credit is requested, not required —
  we give it anyway (see the acknowledgement below).
- Source: https://mocap.cs.cmu.edu/ — BVH conversion vendored from
  https://github.com/una-dinosauria/cmu-mocap
- Files: `vendor/mocap/cmu/*.bvh` (`07_01` walk, `104_02` neutral walk with
  exact footfalls, `138_01` march, `141_16` wave, `79_04` digging, `62_07`
  hammering, `05_02` dance) plus the conversion's own `READMEFIRST.txt`.
- Used for: author-time only. `scripts/motion-import-bvh.ts` projects these
  onto the paperdoll rig and emits checked-in `Clip` modules; **the runtime
  never reads a BVH file** and none of this data ships to players.

> The data used in this project was obtained from mocap.cs.cmu.edu. The
> database was created with funding from NSF EIA-0196217.

**These files are NOT CC-BY-SA** and are not covered by the LPC notice below.
The clips derived from them are our own code; the share-alike obligation on
NPC sprites comes from the LPC *pixels*, never from the motion.

---

## Attribution Notice

This project uses and adapts assets from the
**Liberated Pixel Cup (LPC)**, a collaborative game art project.
When distributing modified versions, you must:
1. Provide attribution to the original authors (listed above)
2. Release your modifications under the same license (CC-BY-SA 3.0 or 4.0)

See each pack's bundled CREDITS.txt for the full contributor chain.
