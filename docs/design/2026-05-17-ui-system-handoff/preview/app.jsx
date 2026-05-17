/* global React, ReactDOM, DesignCanvas, DCSection, DCArtboard,
   Foundations, IsoWorld,
   SpiritChip, SpiritPanel, SpiritDock,
   SelectionCallout, SelectionCard,
   EventChip, EventPanel,
   TimeChip, TimeBar,
   FullScreen,
   Branching, Cinematic, Book,
   Panel, Btn, G, Eyebrow */

function Bg({ children, w, h, dim }) {
  return (
    <div style={{
      width: w, height: h,
      background: dim ? "var(--paper-2)" : "var(--bg)",
      display: "flex", alignItems: "stretch",
      position: "relative",
    }}>
      {children}
    </div>
  );
}

// Show a UI piece floating over a slice of the iso world for honest context.
function OnWorld({ w, h, children, anchor = "tl" }) {
  const map = {
    tl: { top: 18, left: 18 },
    tr: { top: 18, right: 18 },
    br: { bottom: 18, right: 18 },
    bl: { bottom: 18, left: 18 },
    c:  { top: "50%", left: "50%", transform: "translate(-50%, -50%)" },
    cb: { bottom: 18, left: 18, right: 18 },
  }[anchor];
  return (
    <Bg w={w} h={h}>
      <div style={{ position: "absolute", inset: 0 }}>
        <IsoWorld width={w} height={h} />
      </div>
      <div style={{ position: "absolute", ...map }}>{children}</div>
    </Bg>
  );
}

function App() {
  return (
    <DesignCanvas
      title="Small Gods · UI System"
      subtitle="Calm by default. Same palette as the iso world. Out of the way until needed."
      bg="oklch(0.93 0.012 80)"
    >
      {/* ───────── FOUNDATIONS ───────── */}
      <DCSection id="foundations" title="Foundations" subtitle="Principles, palette, type, voice, glyphs, primitives.">
        <DCArtboard id="foundations-doc" label="Out of the way" width={1180} height={1820}>
          <Bg w={1180} h={1820}><Foundations /></Bg>
        </DCArtboard>
      </DCSection>

      {/* ───────── IN CONTEXT ─────────
          The same 1920×1080 viewport across the player's possible states. */}
      <DCSection id="in-context" title="In context · the same screen, different moods" subtitle="Click any to focus. By default the world fills the frame and the UI is three small chips.">
        <DCArtboard id="screen-calm" label="① Calm · default · UI is three chips" width={1920} height={1080}>
          <FullScreen state="calm" />
        </DCArtboard>
        <DCArtboard id="screen-spirit" label="② Spirit panel · opened (click the top-left chip)" width={1920} height={1080}>
          <FullScreen state="spirit" />
        </DCArtboard>
        <DCArtboard id="screen-selected" label="③ NPC selected · small callout near them" width={1920} height={1080}>
          <FullScreen state="selected" />
        </DCArtboard>
        <DCArtboard id="screen-deep" label="④ NPC opened · full card slides in from the right" width={1920} height={1080}>
          <FullScreen state="deep" />
        </DCArtboard>
        <DCArtboard id="screen-time" label="⑤ Time bar · summoned by T (or clicking the time chip)" width={1920} height={1080}>
          <FullScreen state="time" />
        </DCArtboard>
        <DCArtboard id="screen-scrubbed" label="⑥ Looking back · Continue or Try a different way" width={1920} height={1080}>
          <FullScreen state="scrubbed" />
        </DCArtboard>
      </DCSection>

      {/* ───────── SPEC B — TIME ─────────
          The in-flight piece. Collapsed and expanded states. */}
      <DCSection id="time-bar" title="Spec B · Time" subtitle="Lives as a corner chip 99% of the time. Slides up as a full bar only when summoned.">
        <DCArtboard id="time-chip" label="Time chip · the resting state" width={520} height={140}>
          <Bg w={520} h={140}>
            <div style={{ margin: "auto", display: "flex", gap: 10 }}>
              <TimeChip rate={1} />
              <TimeChip rate={0} year="Y1 spring · 30/96" />
              <TimeChip rate={4} />
            </div>
          </Bg>
        </DCArtboard>

        <DCArtboard id="time-on-world" label="Time chip · on top of the world" width={680} height={300}>
          <OnWorld w={680} h={300} anchor="tr">
            <TimeChip rate={1} />
          </OnWorld>
        </DCArtboard>

        <DCArtboard id="time-bar-live" label="Full bar · live (running at 1×)" width={1500} height={120}>
          <Bg w={1500} h={120}>
            <div style={{ padding: 20, width: "100%", margin: "auto" }}>
              <TimeBar initialTick={1840} />
            </div>
          </Bg>
        </DCArtboard>

        <DCArtboard id="time-bar-scrubbed" label="Full bar · scrubbed (Continue or Try a different way)" width={1500} height={170}>
          <Bg w={1500} h={170}>
            <div style={{ padding: 20, width: "100%", margin: "auto" }}>
              <TimeBar initialTick={1180} />
            </div>
          </Bg>
        </DCArtboard>

        <DCArtboard id="time-bar-rationale" label="Why this shape" width={900} height={300}>
          <Bg w={900} h={300}>
            <div style={{ padding: 32, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 28 }}>
              <div>
                <Eyebrow tone="you">resting</Eyebrow>
                <h3 style={{ fontSize: 18, fontWeight: 600, margin: "6px 0 8px" }}>A chip in the corner</h3>
                <p style={{ fontSize: 13, color: "var(--ink-2)", lineHeight: 1.55, margin: 0 }}>
                  At rest, time is a glanceable pill — the season, a speed indicator, a clock icon.
                  Almost invisible. Like the date in a phone status bar.
                </p>
              </div>
              <div>
                <Eyebrow tone="time">summoned</Eyebrow>
                <h3 style={{ fontSize: 18, fontWeight: 600, margin: "6px 0 8px" }}>A bar across the bottom</h3>
                <p style={{ fontSize: 13, color: "var(--ink-2)", lineHeight: 1.55, margin: 0 }}>
                  Press <span className="sg-key">T</span> or tap the chip. The bar slides up: transport,
                  scrub, glyph track, speed, tick label. Press <span className="sg-key">T</span> again to dismiss.
                </p>
                <p style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 8, fontStyle: "italic" }}>
                  Commit / Re-roll become <b>Continue</b> / <b>Try a different way</b>.
                </p>
              </div>
            </div>
          </Bg>
        </DCArtboard>
      </DCSection>

      {/* ───────── COMPONENTS ───────── */}
      <DCSection id="components" title="Components" subtitle="Each piece in isolation, at its native size — collapsed and expanded forms.">
        <DCArtboard id="spirit-chip" label="Spirit chip · resting" width={360} height={100}>
          <Bg w={360} h={100}>
            <div style={{ margin: "auto" }}><SpiritChip /></div>
          </Bg>
        </DCArtboard>
        <DCArtboard id="spirit-panel" label="Spirit panel · expanded" width={360} height={500}>
          <Bg w={360} h={500}>
            <div style={{ padding: 20, margin: "auto" }}>
              <SpiritDock open />
            </div>
          </Bg>
        </DCArtboard>

        <DCArtboard id="event-chip" label="Event chip · resting (3 new)" width={300} height={100}>
          <Bg w={300} h={100}>
            <div style={{ margin: "auto" }}><EventChip newCount={3} /></div>
          </Bg>
        </DCArtboard>
        <DCArtboard id="event-panel" label="Event panel · expanded" width={400} height={520}>
          <Bg w={400} h={520}>
            <div style={{ padding: 20, margin: "auto" }}>
              <EventPanel width={360} heightLimit={420} />
            </div>
          </Bg>
        </DCArtboard>

        <DCArtboard id="callout" label="NPC callout · floats near the NPC" width={500} height={200}>
          <Bg w={500} h={200}>
            <div style={{ margin: "auto" }}><SelectionCallout /></div>
          </Bg>
        </DCArtboard>
        <DCArtboard id="card" label="NPC card · slides in from the right" width={400} height={760}>
          <Bg w={400} h={760}>
            <div style={{ padding: 20, margin: "auto" }}><SelectionCard /></div>
          </Bg>
        </DCArtboard>

        <DCArtboard id="iso-stub" label="The iso 2D world (stub placeholder)" width={900} height={520}>
          <Bg w={900} h={520}>
            <div style={{ margin: "auto", width: 800, height: 480, border: "1px solid var(--line)", borderRadius: 8, overflow: "hidden" }}>
              <IsoWorld width={800} height={480} label="placeholder · real LPC iso art lands here" />
            </div>
          </Bg>
        </DCArtboard>
      </DCSection>

      {/* ───────── REST OF THE ARC ───────── */}
      <DCSection id="future" title="The rest of the arc" subtitle="Same primitives, same palette, same voice.">
        <DCArtboard id="branching" label="Spec C · Branches" width={1180} height={620}>
          <Bg w={1180} h={620}><Branching /></Bg>
        </DCArtboard>
        <DCArtboard id="cinematic" label="Spec D · Cinematic" width={1180} height={620}>
          <Bg w={1180} h={620}><Cinematic /></Bg>
        </DCArtboard>
        <DCArtboard id="book" label="Spec E · The Book" width={1180} height={720}>
          <Bg w={1180} h={720}><Book /></Bg>
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App />);
