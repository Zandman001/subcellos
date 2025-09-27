# Agent Context: Subcellos Project and Ark 1‑Bit Theme

Date: 2025‑09‑27

This document orients future contributors/agents to the codebase and the new Ark 1‑bit design language now applied globally.

## Project overview

- Stack: React (Vite) + Tauri (Rust) desktop app.
- Frontend root: `rpsx/`
  - App shell: `rpsx/src/App.tsx`, `rpsx/src/Shell.tsx`
  - UI components: `rpsx/src/components/**/*`
  - Synth UI: `rpsx/src/components/synth/*`
  - Global styles: `rpsx/src/styles/global.css`
  - Ark design system: `rpsx/src/ark/*` (tokens, primitives, integrations)
  - Store/state: `rpsx/src/store/browser.ts`
- Backend (audio engine): `src-tauri/src/**/*` (Rust)
  - RPC surface consumed by the UI in `rpsx/src/rpc.ts` and `fsClient.ts`

## State management

A lightweight external store lives in `rpsx/src/store/browser.ts` using `useSyncExternalStore`. It holds navigation, selection, synth UI state, and provides methods to send params to the engine via `rpc.setParam`. Sequencer helpers also integrate here.

## Ark 1‑bit design language

- Goals: strictly black/white UI with pixel-art energy; no soft gradients; use dithers and 1‑bit patterns; crisp borders; minimal motion.
- Core tokens and utilities: `rpsx/src/ark/ark1bit.css`
- App-wide integration overrides: `rpsx/src/ark/ark-integrations.css`
- Primitives (optional/demo usage): `rpsx/src/ark/primitives/*`
- Glyph/bitmap systems: `rpsx/src/ark/glyphs.ts`, `ArkBitmapText.tsx`

Key choices:
- No gray hexes; use white with alpha over black for softness.
- Discrete, chunky geometry (e.g., segment rings) instead of skeuomorphic chrome.
- Reduced motion; if animation is used, it’s discrete/stepped.

## Recent theme integration changes (permanent Ark)

- Ark mode is now always on:
  - `rpsx/src/App.tsx` always adds `body.ark-mode` and imports Ark CSS bundles.
  - The previous Ark/Lc toggles in the top bar were removed.
- Removed buttons in `rpsx/src/components/TopBar.tsx`:
  - Low-contrast (LC) and Ark toggle buttons deleted.
- Store cleanup in `rpsx/src/store/browser.ts`:
  - Removed `arkMode` flag, toggle, and persistence. Theme is global now.
- Knob redesign in `rpsx/src/components/synth/Knob.tsx`:
  - Removed orbit animation and rotating pointer.
  - New flat, 1‑bit segmented ring (16 segments) reflects value; optional step markers near center.
- CSS updates in `rpsx/src/ark/ark-integrations.css`:
  - Stronger, obvious Ark look: bold borders, panel dithers, 1‑bit tabs/buttons, simplified knobs, patterned main area, high-contrast list active states.

## What to watch for

- Many components still rely on legacy class names (`.panel`, `.tab`, `.btn`, etc.). Ark applies via `body.ark-mode` and integration stylesheet. Prefer enhancing `ark-integrations.css` over restyling each component unless you are replacing them with Ark primitives.
- Keep UI purely B/W. If you need gradations, use alpha on white over black backgrounds.
- Performance: keep animations step-based and cheap (no heavy blurs/shadows).

## Likely next steps (safe improvements)

- Extend Ark integration to sampler waveform chrome, sequencer grid accents, and per-page synth section headers.
- Remove the optional `#ark` preview route if no longer useful (`ArkPreviewView`).
- Normalize control sizes and spacing using Ark tokens from `ark1bit.css`.
- Add unit/UI tests around store interactions for synth param mapping if you change public behavior.

## Run/dev

- Dev (Tauri): `npm run tauri dev`
- Frontend is Vite-based; types live in `rpsx/src/types/*`.

## Acceptance criteria for Ark-styled components

- Uses 1‑bit visual language (B/W only, discrete geometry, crisp borders).
- No skeuomorphic highlights, bevels, or glows.
- Keyboard/mouse interactions preserved; ARIA roles intact where applicable.
- No measurable regression in interaction responsiveness.

If you need deeper historical design notes, see `rpsx/src/ark/README_ARK_UI.md`.
