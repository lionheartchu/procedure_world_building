# Nimbus Style Guide

> **Superseded — kept for history.** This describes the UI of *Nimbus*, the
> storm prototype this repo started as, before the Trace Habitat / Residual
> Ecology direction. The current visual rules are in
> [`AESTHETIC_LANGUAGE.md`](../AESTHETIC_LANGUAGE.md).

Graphic system for the app UI. Inspired by **TouchDesigner** and **Max/MSP**: dense, technical, instrument-like chrome over a live viewport—not a marketing site.

---

## North star

The interface should feel like a **node-based visual instrument**: calm dark panels, precise type, one active signal color, and zero decorative fluff. The 3D scene is the stage; the UI is the rack.

**Feel:** patch bay · operator panel · scope · live parameter surface  
**Not:** glassmorphism dashboard · soft SaaS cards · purple gradients · playful illustration UI

---

## Color

### Rule: one highlight

Use a single accent for interaction, focus, and “live” state. Everything else stays in a narrow dark neutrals band.

| Token | Hex | Role |
| --- | --- | --- |
| `--bg-void` | `#0A0C0E` | App / viewport surround |
| `--bg-panel` | `#12151A` | Panels, drawers, racks |
| `--bg-panel-2` | `#1A1E25` | Nested blocks, header bars |
| `--bg-control` | `#0E1115` | Input wells, slider tracks |
| `--stroke` | `#2A3038` | Hairline borders, separators |
| `--stroke-strong` | `#3A424C` | Focus rings (neutral), dividers |
| `--text` | `#C8CED6` | Primary UI copy |
| `--text-dim` | `#7A8490` | Labels, hints, inactive |
| `--text-mute` | `#4E5660` | Units, indices, placeholders |
| `--accent` | `#FF6A00` | **Only highlight** — active, selected, value, cable |
| `--accent-dim` | `#A34500` | Accent at rest / track fill |
| `--danger` | `#FF6A00` | Reuse accent for errors (no second hue) |

### Usage

- **Accent appears only for:** slider thumbs & filled range, focused control outline, active tab/toggle, selected value readout, recording/live dots, key connectors.
- **Do not** tint backgrounds with accent washes.
- **Do not** introduce a second brand hue (no cyan UI chrome, no purple, no teal buttons). Scene lighting may stay cool; **UI chrome does not**.
- Borders stay neutral grey. Accent is never used as a large fill.

### Contrast

- Body text on panel ≥ readable mid-grey on near-black.
- Accent on dark for small marks only (1–3px lines, 8–12px thumbs, 10–12px type for values).

---

## Typography

Technical UIs read like schematics. Prefer **mono for data**, tight sans for structure.

| Role | Face | Notes |
| --- | --- | --- |
| UI / labels | `IBM Plex Mono` or `JetBrains Mono` | All caps optional for section labels; tracked |
| Values / numbers | Same mono | Tabular nums; fixed precision (`0.72`) |
| Brand / title | Same mono, slightly larger | No display serif; no expressive poster fonts |
| Body / hints | Mono at smaller size, dim color | One family keeps the rack coherent |

### Type rules

- **Sizes:** 10–11px labels · 12–13px values · 14–16px panel titles · brand ≤ 20–24px
- **Weight:** regular / medium only. Avoid bold slabs.
- **Case:** `SECTION` labels in small caps or uppercase + letter-spacing `0.08–0.12em`
- **No** soft geometric marketing fonts (Syne, Inter display, etc.) in chrome

---

## Layout & density

Borrow TD/Max density without clutter.

- **Viewport first:** full-bleed canvas; UI floats as thin overlays or edge racks.
- **Panels:** rectangular, axis-aligned, hairline 1px stroke, **0–2px radius** (prefer square).
- **No cards:** no soft shadow stacks, no floating media tiles. Flat panels over the scene.
- **Grid:** 4px base; panel padding 10–14px; control rows 22–28px tall.
- **One job per panel:** e.g. “PARAMS” only—no mixed marketing copy inside the rack.
- **Edge docking:** title top-left; params right or bottom—like an operator inspector.

---

## Controls

Match patcher / parameter strip conventions.

### Sliders

- Track: 2px, `--bg-control` with `--stroke`
- Fill: `--accent-dim` → thumb `--accent`
- Thumb: square or hard circle (8–10px), not oversized pills
- Label left / value right on one row; mono value with 2 decimal places

### Toggles & buttons

- Flat rectangles, 1px stroke
- Off: dark fill, dim label
- On / armed: accent stroke or accent left bar (2px), not full accent fill

### Readouts

- Show live numbers next to every continuous param
- Prefer `param.name` style or short uppercase tags (`INTENSITY`, `DRIFT`)

### Cursor & feedback

- `crosshair` or default over viewport; `ew-resize` on sliders
- Focus: 1px accent outline offset 1px—not glow blooms

---

## Motion

Instrument UI moves for **state**, not decoration.

| Allowed | Avoid |
| --- | --- |
| Instant or 80–120ms control feedback | Long fade-ins, bounce, springy panels |
| Subtle value tick / meter | Parallax, floating badges |
| Scene-driven motion (particles, lights) | UI glow pulses competing with the storm |

Prefer **no panel entrance animation**, or a hard cut. If motion exists, keep it linear and short.

---

## Materials & effects

- Panels: opaque or ~92–96% opaque dark fill—readable over bright scene flashes
- **No** heavy backdrop-blur as identity (optional ≤4px if needed for legibility)
- **No** multi-layer drop shadows; at most a flat 1px occlusion edge
- Separators: 1px `--stroke`, full width of content column
- Icons: geometric, 1px stroke, monochrome; accent only when active

---

## Hierarchy (viewport composition)

1. **3D scene** — full window, primary content  
2. **Brand lockup** — small, top-left, mono, non-interactive  
3. **Param rack** — side/bottom inspector with sliders  
4. **Status** (future) — FPS, coords, mode flags in mute mono  

Nothing in the first layer should look like a landing-page hero. The product *is* the viewport.

---

## Voice & labeling

- Short, technical labels: `INTENSITY`, `DRIFT`, `GLOW`, not “Make it dreamier”
- Hints as operator notes: `drag orbit · scroll zoom`
- Avoid emoji, badges, “New”, and marketing CTAs in chrome

---

## Do / Don’t

**Do**

- Dark void + charcoal panels + orange signal
- Mono type, tight rows, hairline rules
- One accent for live/active only
- Square, dense, patcher-like controls

**Don’t**

- Soft gradients, glass cards, large radii
- Second accent color in UI
- Hero typography overpowering the scene
- Decorative animation on chrome
- Warm cream / purple SaaS defaults

---

## CSS token starter

```css
:root {
  --bg-void: #0a0c0e;
  --bg-panel: #12151a;
  --bg-panel-2: #1a1e25;
  --bg-control: #0e1115;
  --stroke: #2a3038;
  --stroke-strong: #3a424c;
  --text: #c8ced6;
  --text-dim: #7a8490;
  --text-mute: #4e5660;
  --accent: #ff6a00;
  --accent-dim: #a34500;

  --font-ui: "IBM Plex Mono", "JetBrains Mono", ui-monospace, monospace;
  --radius: 0px;
  --stroke-w: 1px;
  --pad-panel: 12px;
  --row-gap: 10px;
}
```

---

## References (mood)

- TouchDesigner network editor & parameter dialogs  
- Max/MSP patcher chrome and object inspectors  
- Modular synth front panels / scope readouts  

When unsure: **darker, flatter, more mono, less color.**
