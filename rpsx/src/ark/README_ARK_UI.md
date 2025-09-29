# ArkTeam 1-Bit UI Language

## 1. Purpose
A distinctive, efficient, 1‑bit (pure black/white) interaction language for the ArkTeam groovebox. Designed for tiny OLED / e‑ink style displays and scalable to desktop preview. Prioritizes clarity, rhythm-centric feedback, and a mythic techno personality (organic glyph + astral vector + glitch minimalism).

## 2. Core Aesthetic Pillars
1. Organic 1-Bit
   - Imperfect pixel circles, hand‑offset lines.
   - Uneven ring gaps suggest engraved runes.
   - Avoid smooth gradients; use ordered dithers or sparse stipple (2–8% fill) for emphasis only.
2. Astral Vector
   - Motifs: concentric orbits, triangles (navigation), polar ticks, harmonic arcs.
   - Encoder focus represented by orbiting pixel or comet trail.
3. Glitch Minimalism
   - Micro 1–2 frame spark noise bursts for save/load.
   - Occasional 1px horizontal tear line (rare, opt‑in) to suggest transmission.
   - Selection pulse = contrast inversion or dither phase shift (2-state toggle @ ~2Hz).
4. Typography / ARK Glyph System
   - Blocky mono font (6×8 or 8×8 cell) with custom alternates for A,R,K.
   - Optional rune logotype built from triangles + vertical stems.

## 3. Screen & Grid Assumptions (Adjustable)
- Target hardware preview: 128×64 or 256×64 monochrome OLED.
- Base unit: 1 px. Layout grid: 4 px macro cells (grouping) with 1 px internal separators.
- Safe typography sizes: 6 px cap height (micro), 8 px (primary), 10 px (headline preview on desktop only).

## 4. Primitive Components
| Primitive | Purpose | Visual Grammar |
|----------|---------|----------------|
| Surface (Frame) | Grouping / module region | 1 px outer stroke + optional inner orbit ring when active |
| Label | Text w/ optional glyph prefix | Uppercase; truncated w/ ellipsis rune (··) |
| Button | Discrete action | Inverted fill on active; press flash (invert 1 frame) |
| Toggle | Binary / multi-state | 3-state: OFF (hollow), ON (filled), ALT (filled + notch) |
| Slider | Linear param | 1 px rail + filled rect; orbit focus highlight at handle |
| Encoder (Knob proxy) | Rotational param | Circle (approx 9–15 px) irregular; active shows orbit pixel |
| Grid | Step / pattern / matrix | Cells 8×8 or 8×6; selected pulses; accents show triangular corner |
| Glyph | Symbolic rune | Composed from primitives: triangles, lines, dots |

## 5. Interaction Feedback
- Focus: thin inverse ring or 1 px inner ring + orbit animation.
- Change (value tweak): brief (80 ms) handle flash (invert or white flash).
- Save / Load: trigger glitchFlash(); overlays noise patch (random 12–24 pixels) for 1 frame + subtle top tear.
- Selection Pulse: alternate between base fill + dithered variant (#pattern-a ↔ #pattern-b) every 500 ms.
- Disabled: 40% pixel density (ordered dither) rather than gray.

## 6. Animation Guidelines
All animations must be CPU-light and frame-independent:
- Orbit: 8 or 12 discrete angular positions (precomputed bitmasks). Advance at 12 FPS while active.
- Pulses: Use class toggle + two static background patterns.
- Glitch: Single RAF tick injection; no long timelines.
- No sub-pixel transforms; snap positions to integers.

## 7. Font Strategy
- Provide placeholder CSS class `.ark-font` using existing monospace as fallback.
- Introduce custom pseudo-glyph substitutions via components (ArkGlyph) until a real bitmap font pipeline (e.g. BMFont / sprite sheet) is integrated.

## 8. Color & Contrast
- Pure black (#000) and pure white (#fff) only.
- Dither illusions via patterned backgrounds (repeating 2×2, 4×4) not gray codes.

## 9. Accessibility / Legibility
- Minimum interactive target: 9×9 px.
- Maintain 1 px separation between interactive neighbors.

## 10. Performance Philosophy
- Prefer CSS class flips to style mutations.
- Pre-generate SVG orbit frames or sprite sheet.
- Avoid box-shadow, blur, filters.
- Use a single off-screen canvas if dynamic rendering required (batch orbit overlays for many knobs).

## 11. File Layout (Proposed)
```
/ark
  ark1bit.css          # tokens, patterns, animations
  font.css             # future bitmap font face, now placeholder
  primitives/
    ArkSurface.tsx
    ArkLabel.tsx
    ArkButton.tsx
    ArkToggle.tsx
    ArkSlider.tsx
    ArkEncoder.tsx
    ArkGrid.tsx
    ArkGlyph.tsx
  hooks/
    useOrbit.ts
    useGlitchFlash.ts
  ArkDemo.tsx
  README_ARK_UI.md
```

## 12. State Classes (BEM-lite)
- `.is-focus`, `.is-active`, `.is-disabled`, `.is-pulse`, `.is-glitch`.

## 13. Future Extensions
- Audio-responsive shimmer (thresholded to 1-bit).
- Macro performance page with constellation sequencer.

## 14. Integration Summary
Import the stylesheet and use the primitives; they remain namespaced under `ark-` to avoid collision with existing app classes.

## 15. Bitmap Font Implementation (Prototype)
- Custom 6x8 glyph sheet encoded in `glyphs.ts` as bit rows.
- Render path: `ArkBitmapText` component draws into a canvas per label (cheap at small sizes).
- Props: `text`, `scale` (integer), `invert` (boolean).
- Integration: `ArkLabel` accepts `bitmap` flag to switch to canvas rendering.
- Performance: ~32 chars * 6x8 = 1536 pixels; negligible on modern JS engines. Batch updates by avoiding re-renders unless `text` changes.
- Future: Replace per-canvas with atlas blitter or WebGL batch if many hundreds of labels required.

## 16. Preview Route
 - Ark preview route removed; the app always runs in Ark mode. Use Ark primitives within existing pages for demos.

## 17. Next Steps
1. Add sprite sheet export pipeline (e.g. JSON + PNG) for hardware firmware.
2. Add kerning pairs if moving beyond strict monospace.
3. Provide build script to spit out C header arrays for embedded target.

---
This document will evolve as primitives & font assets mature.
