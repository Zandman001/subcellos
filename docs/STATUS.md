# Project Status (Sep 19, 2025)

This doc captures what changed recently, what is verified done, and whats still open.

## Overview
- Legacy boxes UI is restored for all modules.
- Drum Sampler rebranded to Drubbles across frontend and backend.
- Audio engine stability and mixing updated; multi-part playback verified.

## Completed
- UI/UX
  - Restored legacy boxes UI across pages.
  - Removed the transient editing... banner in Right pane.
  - Reintroduced analog-style filter/envelope/modulation pages.
  - Synth preview suppressed when a Drum/Drubbles module is selected.
- Drums (Drubbles)
  - Renamed UI, files, and identifiers (FE/BE) to Drubbles.
  - Drum pack browser (Q to open) and per-slot sample grid.
  - A-only preview for drums (no background auto-preview); reversed W/R navigation.
  - Symphonia decoding path with proper PCM scaling, stereomono averaging, peak normalization, and preserved sample_rate.
- Engine & data
  - Unified module-kind mapping between FE/BE:
    - 0=Electricity(Analog), 1=Acid303, 2=String Theory, 3=Mushrooms, 4=Sampler, 5=Drubbles.
  - Mixer gain model: multiplicative composition (identity default 1.0), clamp to 0..2; soft-clip master; finite-sample guards.
  - FS API naming aligned (String Theory, Mushrooms, Drubbles) for new preset names/labels.
- Build
  - Backend compiles with warnings only; frontend builds cleanly via Vite.

## Open items / Next up
- Per-part level meters (UX):
  - Add small peak/RMS meters to Mixer page to visualize live part levels and quickly spot mutes/NaNs.
- FE control for mixer per-part gain_db (optional):
  - Engine already exposes `mixer/part{idx}/gain_db`; default is 0 dB. Wire FE if user-facing per-part gain is desired.
- Drum UI extras (low-risk):
  - Toggle for fixed velocity preview; small visual pad flash on A preview; quick assign to MIDI notes.
- Tech debt / warnings cleanup:
  - Silence or remove unused methods/imports; rename `soundRefs` to snake_case in fs_api serialization (breaking change caution; consider serde alias).

## Conventions & mapping
- Module kind mapping (FE/BE):
  - 0=Electricity, 1=Acid303, 2=String Theory (Karplus), 3=Mushrooms (Resonator Bank), 4=Sampler, 5=Drubbles (Drum).
- Naming (user-facing):
  - Karplus Strong → String Theory; Resonator Bank → Mushrooms; Drum Sampler → Drubbles.
- Drum params (per slot i on part p):
  - `part/{p}/drum/slot/{i}/volume`, `pan`, `pitch_semitones`, `pitch_fine`.
- Mixer / EQ params (per part p):
  - Mixer gain (BE path): `mixer/part{p}/gain_db` (FE currently not writing; default 0 dB).
  - EQ bands: `part/{p}/eq/gain_db/b{1..n}`.

## Verify quickly
- Drubbles does NOT mute others anymore:
  - Create two sounds: Electricity on Part 0, Drubbles on Part 1.
  - Play notes on Part 0, press A to preview Drubbles on Part 1.
  - Both should be audible; no global mute.
- Drum UX:
  - Press Q to open packs; W/R navigate reversed; A previews only the selected drum sample.
- Naming/UI:
  - Pages show String Theory and Mushrooms; Drubbles component present; no editing... banner.

## Known issues / watchlist
- Build warnings (unused fields/imports/methods) are benign but should be tidied.
- Fonts: Press Start 2P font resolves at runtime (Vite warns; acceptable for now).

## Contact / ownership
- Engine: src-tauri/src/engine/*
- FS API: src-tauri/src/fs_api.rs
- UI Store: rpsx/src/store/browser.ts
- Drubbles UI: rpsx/src/components/synth/Drubbles.tsx
- Renamed synth pages: StringTheory.tsx, Mushrooms.tsx
