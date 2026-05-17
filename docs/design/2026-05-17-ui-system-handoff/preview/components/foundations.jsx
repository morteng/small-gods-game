/* global React, Panel, Chip, Eyebrow, Btn, Badge, Sigil, Meter, Hr, G, Key */

// FOUNDATIONS — the system declared out loud. Palette derived from the iso
// world's colors so chrome and graphics agree.

function Swatch({ name, varName, hex }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 92 }}>
      <div style={{ height: 48, borderRadius: 4, background: `var(${varName})`, border: "1px solid var(--line)" }} />
      <div style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--ink)" }}>{name}</div>
      <div style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--ink-4)" }}>{varName}</div>
    </div>
  );
}

function Principle({ n, title, body }) {
  return (
    <div style={{ display: "flex", gap: 12 }}>
      <div style={{
        flexShrink: 0, width: 28, height: 28, borderRadius: "50%",
        background: "var(--paper-2)", border: "1px solid var(--line-2)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: "var(--f-mono)", fontWeight: 600, fontSize: 13, color: "var(--ink-2)",
      }}>{n}</div>
      <div>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 2 }}>{title}</div>
        <div style={{ fontSize: 13, color: "var(--ink-2)", lineHeight: 1.5 }}>{body}</div>
      </div>
    </div>
  );
}

function Foundations() {
  return (
    <div style={{ padding: 36, display: "flex", flexDirection: "column", gap: 28 }}>
      {/* header */}
      <div>
        <Eyebrow tone="you">Small Gods · UI System v2</Eyebrow>
        <h1 style={{ fontSize: 36, fontWeight: 700, margin: "8px 0 6px", letterSpacing: "-0.01em" }}>
          Out of the way
        </h1>
        <p style={{ fontSize: 15, color: "var(--ink-2)", lineHeight: 1.55, maxWidth: 720, margin: 0 }}>
          The game is an isometric 2D world of small lives. The UI is its
          companion — not its frame. Colors come from the world itself; the
          chrome stays quiet so the world can do the talking.
        </p>
      </div>

      {/* principles */}
      <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 28 }}>
        <Principle n="1" title="Calm by default"
          body="Three small chips at the corners. That's it. Power, time, recent. Everything else is summoned by the player when they want it." />
        <Principle n="2" title="Same palette as the graphics"
          body="Grass, water, earth, sand, harvest sun — the world's colors are also the UI's. Nothing fights." />
        <Principle n="3" title="The world is the canvas"
          body="No fixed sidebars. Panels float over the world only while the player is using them. Click outside, and they're gone." />
        <Principle n="4" title="Plainspoken"
          body="“Try a different way” instead of “Re-roll & commit.” The dramatic phrasing belongs in the simulation, not the buttons." />
      </section>

      {/* palette */}
      <section>
        <Eyebrow style={{ marginBottom: 10 }}>palette · drawn from the iso world</Eyebrow>

        <div style={{ fontSize: 12, color: "var(--ink-3)", marginBottom: 8 }}>source · the world's own colors</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 18 }}>
          <Swatch name="grass" varName="--w-grass" />
          <Swatch name="leaf"  varName="--w-leaf" />
          <Swatch name="water" varName="--w-water" />
          <Swatch name="sand"  varName="--w-sand" />
          <Swatch name="earth" varName="--w-earth" />
          <Swatch name="stone" varName="--w-stone" />
          <Swatch name="sun"   varName="--w-sun" />
          <Swatch name="dusk"  varName="--w-dusk" />
          <Swatch name="clay"  varName="--w-clay" />
        </div>

        <div style={{ fontSize: 12, color: "var(--ink-3)", marginBottom: 8 }}>surfaces · paper</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 18 }}>
          <Swatch name="bg"      varName="--bg" />
          <Swatch name="paper"   varName="--paper" />
          <Swatch name="paper 2" varName="--paper-2" />
          <Swatch name="line"    varName="--line" />
          <Swatch name="line 2"  varName="--line-2" />
        </div>

        <div style={{ fontSize: 12, color: "var(--ink-3)", marginBottom: 8 }}>accents · each carries meaning</div>
        <div style={{ display: "flex", gap: 12, marginTop: 6, fontSize: 12, color: "var(--ink-2)", flexWrap: "wrap" }}>
          <span><b style={{ color: "var(--you)" }}>you</b> · your spirit, prayer answered, primary action</span>
          <span><b style={{ color: "var(--time)" }}>time</b> · replay, lore, the Book</span>
          <span><b style={{ color: "oklch(0.55 0.13 80)" }}>faith</b> · belief thresholds, miracle</span>
          <span><b style={{ color: "var(--w-leaf)" }}>life</b> · growing, good</span>
          <span><b style={{ color: "var(--danger)" }}>danger</b> · rivals, loss</span>
        </div>
      </section>

      {/* type */}
      <section>
        <Eyebrow style={{ marginBottom: 10 }}>type</Eyebrow>
        <Panel style={{ padding: 22 }}>
          <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-0.01em", marginBottom: 6 }}>
            Manrope — clean, friendly, calm.
          </div>
          <div style={{ display: "flex", gap: 16, fontSize: 13, color: "var(--ink-2)", marginBottom: 14 }}>
            <span>400 regular</span>
            <span>500 medium</span>
            <span style={{ fontWeight: 600 }}>600 semibold</span>
            <span style={{ fontWeight: 700 }}>700 bold</span>
          </div>
          <Hr style={{ margin: "12px 0" }} />
          <div style={{ display: "flex", gap: 24, alignItems: "baseline" }}>
            <div>
              <div className="sg-data" style={{ fontSize: 22, fontWeight: 500, color: "var(--ink)" }}>
                67 / 100 · t 1840 · ev #142
              </div>
              <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 4 }}>IBM Plex Mono · numbers, ticks, IDs</div>
            </div>
          </div>
        </Panel>
      </section>

      {/* voice */}
      <section>
        <Eyebrow style={{ marginBottom: 10 }}>voice</Eyebrow>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
          <Panel style={{ padding: 16 }}>
            <Eyebrow tone="you" style={{ marginBottom: 6 }}>the world · italic</Eyebrow>
            <p style={{ fontSize: 13, lineHeight: 1.55, fontStyle: "italic", color: "var(--ink)" }}>
              Mira pauses while grinding grain. She should visit old Tam.
            </p>
          </Panel>
          <Panel style={{ padding: 16 }}>
            <Eyebrow style={{ marginBottom: 6 }}>the system · plain</Eyebrow>
            <p style={{ fontSize: 13, lineHeight: 1.55, color: "var(--ink-2)" }}>
              Whisper cast. Cost 1. Mira's faith rose to 0.34.
            </p>
          </Panel>
          <Panel style={{ padding: 16 }}>
            <Eyebrow tone="time" style={{ marginBottom: 6 }}>the book · roman</Eyebrow>
            <p style={{ fontSize: 13, lineHeight: 1.55, color: "var(--ink)" }}>
              And in the third winter the rain came, and Mira knelt upon the stone.
            </p>
          </Panel>
        </div>
      </section>

      {/* glyphs */}
      <section>
        <Eyebrow style={{ marginBottom: 10 }}>glyphs · the event vocabulary</Eyebrow>
        <Panel style={{ padding: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: 10 }}>
            {[
              ["whisper",    "whisper",     "you"],
              ["miracle",    "miracle",     "faith"],
              ["beliefRise", "belief ↑",    "faith"],
              ["beliefFall", "belief ↓",    "danger"],
              ["mood",       "mood",        "ink-3"],
              ["birth",      "birth",       "life"],
              ["death",      "death",       "ink-3"],
              ["realize",    "realized",    "time"],
              ["rival",      "rival",       "danger"],
              ["book",       "chapter",     "time"],
              ["branch",     "branch",      "time"],
              ["reroll",     "re-roll",     "danger"],
              ["clock",      "clock",       "ink-3"],
              ["pause",      "pause",       "ink-3"],
              ["play",       "play",        "ink-3"],
              ["chat",       "speak",       "you"],
            ].map(([k, lbl, tone]) => {
              const c = tone === "you" ? "var(--you)" : tone === "faith" ? "var(--w-sun)" : tone === "time" ? "var(--time)" : tone === "danger" ? "var(--danger)" : tone === "life" ? "var(--w-leaf)" : "var(--ink-3)";
              return (
                <div key={k} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: 6,
                    background: "var(--paper)", border: "1px solid var(--line)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    color: c, fontSize: 16,
                  }}>{G[k]}</div>
                  <div style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--ink-3)" }}>{lbl}</div>
                </div>
              );
            })}
          </div>
        </Panel>
      </section>

      {/* primitives */}
      <section>
        <Eyebrow style={{ marginBottom: 10 }}>primitives</Eyebrow>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
          <Panel style={{ padding: 18 }}>
            <Eyebrow style={{ marginBottom: 12 }}>buttons</Eyebrow>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-start" }}>
              <Btn>Observe</Btn>
              <Btn primary>{G.whisper}<span>Whisper</span><Key>W</Key></Btn>
              <Btn tone="time">{G.book}<span>Open the book</span></Btn>
              <Btn tone="danger">{G.reroll}<span>Try differently</span></Btn>
              <Btn ghost>Cancel</Btn>
              <div style={{ display: "flex", gap: 4 }}>
                <Btn active>1×</Btn>
                <Btn>2×</Btn>
                <Btn>4×</Btn>
                <Btn>8×</Btn>
              </div>
            </div>
          </Panel>
          <Panel style={{ padding: 18 }}>
            <Eyebrow style={{ marginBottom: 12 }}>chips · sigils · badges</Eyebrow>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-start" }}>
              <Chip><Sigil glyph="ƒ" /><span className="sg-data" style={{ fontSize: 13, fontWeight: 600 }}>67</span><span style={{ color: "var(--ink-3)", fontSize: 12 }}>4 believers</span></Chip>
              <Chip><span style={{ color: "var(--ink-3)", display: "inline-flex" }}>{G.clock}</span><span style={{ fontSize: 12 }}>Y1 spring · 30/96</span><span className="sg-data" style={{ fontSize: 11, padding: "1px 6px", borderRadius: 999, background: "var(--paper-2)", border: "1px solid var(--line)", color: "var(--ink-2)" }}>1×</span></Chip>
              <div style={{ display: "flex", gap: 6 }}>
                <Sigil glyph="ƒ" size="lg" />
                <Sigil glyph="ϟ" size="lg" tone="danger" />
                <Sigil glyph="☾" size="lg" tone="time" />
              </div>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                <Badge tone="you">believer</Badge>
                <Badge>habit</Badge>
                <Badge tone="faith">faith 0.34</Badge>
                <Badge tone="life">growing</Badge>
                <Badge tone="danger">fearful</Badge>
                <Badge tone="time">chapter</Badge>
              </div>
            </div>
          </Panel>
          <Panel style={{ padding: 18 }}>
            <Eyebrow style={{ marginBottom: 12 }}>meters</Eyebrow>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontSize: 11, color: "var(--ink-3)" }}>power</span>
                  <span className="sg-data" style={{ fontSize: 11, color: "var(--you)" }}>0.67</span>
                </div>
                <Meter value={0.67} />
              </div>
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontSize: 11, color: "var(--ink-3)" }}>Mira's faith</span>
                  <span className="sg-data" style={{ fontSize: 11, color: "var(--w-sun)" }}>0.34</span>
                </div>
                <Meter value={0.34} tone="faith" pips={[0.3, 0.6, 0.9]} />
              </div>
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontSize: 11, color: "var(--ink-3)" }}>time</span>
                  <span className="sg-data" style={{ fontSize: 11, color: "var(--time)" }}>1180 / 1840</span>
                </div>
                <Meter value={1180/1840} tone="time" />
              </div>
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontSize: 11, color: "var(--ink-3)" }}>rival pressure</span>
                  <span className="sg-data" style={{ fontSize: 11, color: "var(--danger)" }}>0.22</span>
                </div>
                <Meter value={0.22} tone="danger" />
              </div>
            </div>
          </Panel>
        </div>
      </section>
    </div>
  );
}

window.Foundations = Foundations;
