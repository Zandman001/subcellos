# Subcellos – Sampler Envelope Handoff (2025-09-14)

This notes the latest sampler envelope behavior changes, where to look in the code, and what’s next.

## Summary

- Sampler envelope acts only in Loop or Keytrack modes. One-Shot bypasses ADSR (no cropping).
- Envelope page visibility:
  - One-Shot: ENVELOPE tab hidden (also LOOP hidden).
  - Loop: ENVELOPE and LOOP tabs shown.
  - Keytrack: ENVELOPE shown, LOOP hidden.
- Presets store sampler ADSR in milliseconds; UI uses normalized 0..1 like analog AMP env.
- On preset apply and project preload, sample file is loaded first, then sampler params.

## Current Behavior (Sampler)

- Playback modes: 0=One-Shot, 1=Loop, 2=Keytrack
- Envelope trigger:
  - On note_on: starts ADSR only for Loop/Keytrack; One-Shot sets envelope to full level internally.
  - On note_off: for Loop/Keytrack, envelope releases; One-Shot plays to end unaffected by ADSR.
- Envelope gain application:
  - Loop/Keytrack: multiply audio by env.
  - One-Shot: env is bypassed (audio unaffected; no ADSR gating/cropping).

## Key Files and Symbols

- Frontend page logic and state
  - `rpsx/src/store/browser.ts`
    - compute pages: `computeSynthPagesForCurrent()` (Sampler section toggles ENVELOPE/LOOP by `sampler.playback_mode`).
    - Preset mapping: `uiToSchema()` converts normalized ADSR -> ms; `applyPreset()` converts ms -> normalized and sends ms to engine.
    - Helper: `invMapTimeMs()` converts ms-or-sec to normalized.
  - `rpsx/src/components/synth/Sampler.tsx`
    - Playback mode knob send: updates `sampler/playback_mode` and calls `refreshSynthPages()` so tabs update immediately.
  - `rpsx/src/components/synth/SamplerEnvelope.tsx`
    - Normalized ADSR UI; sends milliseconds to engine.
    - Disables knobs when `playback_mode` is One-Shot; shows hint text.

- Engine (Rust)
  - `src-tauri/src/engine/modules/sampler.rs`
    - Envelope gating in `SamplerVoice::render(...)` near end:
      - Applies `self.envelope.process()` only for Loop/Keytrack; One-Shot keeps level at 1.0 while audio is present.
      - On `just_triggered`, calls `envelope.note_on()` only for Loop/Keytrack; One-Shot sets `stage=Sustain` and `level=1.0`.
    - `note_on()` and retrig no longer force `envelope.note_on()`; render handles mode-specific trigger.
    - Param keys expect sampler ADSR in milliseconds: `attack`, `decay`, `sustain`, `release`.

## Persistence

- Sampler `current_sample` filename is persisted in presets and loaded before applying sampler params on:
  - Preset apply (active sound)
  - Project preload (engine only, no UI selection changes)

## How to run

Frontend build:

```sh
npm run build --silent
```

Tauri backend build:

```sh
cd src-tauri
cargo build
```

Dev app:

```sh
npm run tauri dev
```

Notes: Last cargo build showed warnings only; a previous run exited with code 130 (likely interrupted).

## Quick test checklist

- One-Shot mode
  - ENVELOPE tab is hidden.
  - Playing notes sounds unaffected by ADSR (plays to end even if note-off early and when selection is small).
- Loop mode
  - ENVELOPE tab visible; ADSR shapes sound; note-off triggers release.
  - LOOP tab visible; tempo-follow retrigs work as before.
- Keytrack mode
  - ENVELOPE tab visible; ADSR shapes sound; pitch follows key.
- Presets
  - Save a preset with ADSR and a sample; reload app → sample auto-loads and ADSR restored.

## Known edges / follow-ups

- UI “disabled” on `Knob` is now passed for SamplerEnvelope; if the component lacks styling for disabled, consider greying out via CSS.
- One-Shot bypass forces env sustain visually; ensure this matches UX expectations (no clicks introduced; de-click ramp still applied).
- Consider adding an explicit “Amp Env Enable” toggle for more flexibility if needed.

## Where to edit next

- Change tab visibility: `computeSynthPagesForCurrent()` in `browser.ts`.
- Sampler envelope UI behavior: `SamplerEnvelope.tsx`.
- Engine ADSR/evaluation: `SamplerVoice::render` in `sampler.rs`.
- Preset/schema conversions: `uiToSchema` and `applyPreset` in `browser.ts`.
