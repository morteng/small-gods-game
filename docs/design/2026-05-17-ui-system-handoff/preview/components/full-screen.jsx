/* global React, Panel, Chip, Eyebrow, Btn, Badge, Sigil, Meter, Hr, G, Key,
   IsoWorld, SpiritChip, SpiritPanel, SpiritDock,
   SelectionCallout, SelectionCard,
   EventChip, EventPanel,
   TimeChip, TimeBar */

// FULL SCREEN — the same 1920×1080 viewport in different states.
// Default state: world fills the screen. Only three small chips at the corners.
// On interaction: panels appear as overlays, never as fixed sidebars.

function FullScreen({ state = "calm" }) {
  // states:
  //   "calm"     — nothing open (the rest state)
  //   "spirit"   — spirit panel open
  //   "selected" — npc callout visible
  //   "deep"     — npc card open on the right
  //   "time"     — time bar slid up
  //   "scrubbed" — time bar slid up, scrub head moved back
  //   "vista"    — area "look closer" panel open

  const showSpirit   = state === "spirit";
  const showSelected = state === "selected" || state === "deep";
  const showDeep     = state === "deep";
  const showTime     = state === "time" || state === "scrubbed";
  const scrubbed     = state === "scrubbed";
  const showEvents   = state === "deep" || state === "spirit";
  const showVista    = state === "vista";
  const showQueue    = state === "vista" || state === "deep";

  return (
    <div style={{
      position: "relative",
      width: 1920, height: 1080,
      background: "var(--bg)",
      overflow: "hidden",
      fontFamily: "var(--f-sans)",
      color: "var(--ink)",
    }}>
      {/* world (fills) */}
      <IsoWorld width={1920} height={1080} scrubbed={scrubbed} label="the realm · 142 ▢" />

      {/* corners */}
      {/* TOP-LEFT: spirit */}
      <div style={{ position: "absolute", top: 18, left: 18, display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-start" }}>
        <SpiritChip open={showSpirit} />
        {showSpirit && <SpiritPanel />}
      </div>

      {/* TOP-RIGHT: time + events + (optional) queue */}
      <div style={{ position: "absolute", top: 18, right: 18, display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
        <div style={{ display: "flex", gap: 8 }}>
          {showQueue && <ImageQueueChip painting={1} queued={2} />}
          <EventChip newCount={3} />
          <TimeChip rate={scrubbed ? 0 : 1} />
        </div>
        {showEvents && <EventPanel width={340} heightLimit={340} />}
      </div>

      {/* RIGHT-MIDDLE: NPC card */}
      {showDeep && (
        <div style={{ position: "absolute", top: 110, right: 18 }}>
          <SelectionCard portraitState="painting" />
        </div>
      )}

      {/* NPC callout */}
      {showSelected && !showDeep && (
        <div style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-30px, -120px)" }}>
          <SelectionCallout />
        </div>
      )}

      {/* VISTA panel (anchored bottom-left, larger) */}
      {showVista && (
        <div style={{ position: "absolute", left: 18, bottom: 60 }}>
          <Vista imgState="painting" />
        </div>
      )}

      {/* BOTTOM: time bar */}
      {showTime && (
        <div style={{ position: "absolute", left: 18, right: 18, bottom: 18 }}>
          <TimeBar initialTick={scrubbed ? 1180 : MAX_TICK} initialRate={1} />
        </div>
      )}

      {/* tiny help hint */}
      <div style={{
        position: "absolute", left: 18, bottom: 18,
        display: (showTime || showVista) ? "none" : "flex", alignItems: "center", gap: 6,
        background: "var(--shade)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        padding: "4px 10px",
        border: "1px solid var(--line)",
        borderRadius: "var(--r-pill)",
        fontSize: 11, color: "var(--ink-3)",
      }}>
        <Key>T</Key> <span>time</span>
        <span style={{ margin: "0 4px", color: "var(--ink-4)" }}>·</span>
        <Key>L</Key> <span>log</span>
        <span style={{ margin: "0 4px", color: "var(--ink-4)" }}>·</span>
        <Key>V</Key> <span>look closer</span>
        <span style={{ margin: "0 4px", color: "var(--ink-4)" }}>·</span>
        <Key>Space</Key> <span>pause</span>
      </div>
    </div>
  );
}

window.FullScreen = FullScreen;
