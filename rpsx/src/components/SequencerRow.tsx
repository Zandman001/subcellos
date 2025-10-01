import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { keyIs } from '../utils/key';
import Knob from './synth/Knob';
import { useSequencer, SequencerNote, chordNameFromMidiSet, SequencerStep } from '../store/sequencer';
import { useBrowser } from '../store/browser';
import { useFourKnobHotkeys } from '../hooks/useFourKnobHotkeys';

export default function SequencerRow({ soundId, part }: { soundId: string; part: number }) {
  const seq = useSequencer(soundId);
  // Replace local menu state with store-backed flag so other UIs can reflect it
  const [menu, setMenu] = useState(false);
  useEffect(() => {
    // keep local mirror in sync with store
    setMenu(!!(seq as any).uiMenuOpen);
  }, [(seq as any).uiMenuOpen]);
  const setMenuOpen = (open: boolean) => {
    setMenu(!!open);
    (seq as any).setMenuOpen?.(!!open);
  };

  const browser = useBrowser() as any;
  const isDrum = (browser?.moduleKindById?.[soundId] === 'drum') || (/drum|drubbles/i.test(browser?.selectedSoundName || ''));
  const drumSamples: string[] = (browser?.drumSampleItems || []) as string[];

  // keep store's part in sync for correct routing
  useEffect(() => { seq.setPart(part); }, [part]);
  // keep module kind in sync (for drum/sampler note-off behavior and label logic)
  useEffect(() => {
    const mk = browser?.moduleKindById?.[soundId];
    if (mk === 'drum') seq.setModuleKind('drum');
    else if (mk === 'sampler') seq.setModuleKind('sampler');
    else seq.setModuleKind('synth');
  }, [browser?.moduleKindById?.[soundId]]);

  // Keyboard: Q add, A remove, W toggle menu; 1 local play/pause; 2 global play/pause
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (keyIs(e, ['KeyW'], ['w','W'])) { e.preventDefault(); setMenuOpen(!menu); return; }
      if (menu) return; // when in menu, ignore edit keys
      if (keyIs(e, ['KeyQ'], ['q','Q'])) { e.preventDefault(); seq.addNoteAtSelection(); return; }
      if (keyIs(e, ['KeyA'], ['a','A'])) { e.preventDefault(); seq.removeNoteAtSelection(); return; }
      if (keyIs(e, ['KeyR'], ['r','R'])) { e.preventDefault(); seq.toggleLegatoAtSelection(); return; }
  // play controls moved to global (Shell): I = local, U = global
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [seq, menu]);

  // Knobs: 1 step selection, 2 note selection, 3 pitch, 4 velocity
  const [k1, setK1] = useState(0);
  const [k2, setK2] = useState(0);
  const [k3, setK3] = useState(0.5);
  const [k4, setK4] = useState(0.7);
  // No local guard needed; store-level ensureNoteAtSelection prevents duplicates

  // 4-knob hotkeys for controls: Step, Note, Pitch/Sample, Velocity (aligned to knob step grids)
  useFourKnobHotkeys({
    dec1: ()=> { const st = 1/Math.max(1, seq.length-1); onStepChange(k1 - st); },
    inc1: ()=> { const st = 1/Math.max(1, seq.length-1); onStepChange(k1 + st); },
    dec2: ()=> {
      const notes = seq.steps[seq.stepIndex]?.notes || [];
      const st = notes.length > 1 ? 1/(notes.length-1) : 1;
      onNoteChange(Math.max(0, k2 - st));
    },
    inc2: ()=> {
      const notes = seq.steps[seq.stepIndex]?.notes || [];
      const st = notes.length > 1 ? 1/(notes.length-1) : 1;
      onNoteChange(Math.min(1, k2 + st));
    },
    dec3: ()=> {
      if (isDrum) {
        const slots = Math.max(1, (drumSamples?.length || 16));
        const st = slots > 1 ? 1/(slots-1) : 1;
        onPitchChange(Math.max(0, k3 - st));
      } else {
        onPitchChange(Math.max(0, k3 - 1/48));
      }
    },
    inc3: ()=> {
      if (isDrum) {
        const slots = Math.max(1, (drumSamples?.length || 16));
        const st = slots > 1 ? 1/(slots-1) : 1;
        onPitchChange(Math.min(1, k3 + st));
      } else {
        onPitchChange(Math.min(1, k3 + 1/48));
      }
    },
    dec4: ()=> onVelChange(Math.max(0, k4 - 1/32)),
    inc4: ()=> onVelChange(Math.min(1, k4 + 1/32)),
    active: !menu,
  });

  // When in menu (W), map the same four-knob hotkeys to settings: Res, Length, Mode, Local BPM
  useFourKnobHotkeys({
    // Resolution: 6 discrete items
    dec1: () => {
      const items = ['1/4','1/8','1/16','1/32','1/8t','1/16t'] as const;
      const idx = items.indexOf(seq.resolution as any);
      const next = Math.max(0, idx - 1);
      const norm = next / (items.length - 1);
      seq.setResolutionNorm(norm);
    },
    inc1: () => {
      const items = ['1/4','1/8','1/16','1/32','1/8t','1/16t'] as const;
      const idx = items.indexOf(seq.resolution as any);
      const next = Math.min(items.length - 1, idx + 1);
      const norm = next / (items.length - 1);
      seq.setResolutionNorm(norm);
    },
    // Length 1..64
    dec2: () => seq.setLength(Math.max(1, seq.length - 1)),
    inc2: () => seq.setLength(Math.min(64, seq.length + 1)),
    // Mode: two-position switch
    dec3: () => seq.setMode('tempo'),
    inc3: () => seq.setMode('poly'),
    // Local BPM (only active in Poly mode, but allow adjusting anyway)
    dec4: () => seq.setLocalBpm(Math.max(20, Math.round(seq.localBpm - 1))),
    inc4: () => seq.setLocalBpm(Math.min(240, Math.round(seq.localBpm + 1))),
    active: menu,
  });

  // Reflect external selection
  useEffect(() => {
    // Map step knob across total sequence length (not just populated steps)
    setK1(seq.length <= 1 ? 0 : (seq.stepIndex / (seq.length - 1)));
    const notes = seq.steps[seq.stepIndex]?.notes || [];
    const nCount = notes.length || 1; // avoid div by zero
    const noteIdx = Math.max(0, Math.min(nCount - 1, seq.noteIndex));
    setK2(nCount <= 1 ? 0 : noteIdx / (nCount - 1));
    const cur = notes[noteIdx];
    if (cur) {
      if (isDrum) {
        const base = 36;
        const slots = Math.max(1, (drumSamples?.length || 16));
        const idx = Math.max(0, Math.min(slots - 1, Math.round((cur.midi || base) - base)));
        setK3(slots <= 1 ? 0 : idx / (slots - 1));
      } else {
        // Map across 4 octaves (48 semitones), e.g., C2(36)..C6(84)
        const MIN = 36, MAX = 84;
        const midi = Math.max(MIN, Math.min(MAX, cur.midi));
        const norm = (midi - MIN) / (MAX - MIN);
        setK3(norm);
      }
      setK4(cur.vel);
    }
  }, [seq.stepIndex, seq.noteIndex, seq.steps, isDrum, drumSamples.length]);

  const onStepChange = useCallback((v: number) => {
    const idx = Math.round(v * Math.max(0, seq.length - 1));
    seq.setStepIndex(idx);
  }, [seq]);
  const onNoteChange = useCallback((v: number) => {
    const notes = seq.steps[seq.stepIndex]?.notes || [];
    const idx = notes.length <= 1 ? 0 : Math.round(v * (notes.length - 1));
    seq.setNoteIndex(idx);
  }, [seq]);
  const onPitchChange = useCallback((v: number) => {
    const notes = seq.steps[seq.stepIndex]?.notes || [];
    const hasNotes = notes.length > 0;
    const noteIdx = hasNotes ? Math.max(0, Math.min(notes.length - 1, seq.noteIndex)) : 0;

    // Compute desired MIDI from knob
    let nextMidi: number;
    if (isDrum) {
      const slots = Math.max(1, (drumSamples?.length || 16));
      const idx = Math.max(0, Math.min(slots - 1, Math.round(v * (slots - 1))));
      nextMidi = 36 + idx;
    } else {
      const MIN = 36, MAX = 84;
      nextMidi = Math.round(MIN + v * (MAX - MIN));
    }

    // Ensure a single note exists if step was empty, then immediately set/update pitch
    if (!hasNotes) {
      seq.ensureNoteAtSelection(nextMidi, 0.7);
      // Immediately apply pitch to the just-created note for smooth feel
      seq.updateNote({ midi: nextMidi, vel: 0.7 });
      return;
    }

    // Update existing note pitch
    const cur = notes[noteIdx];
    if (cur && nextMidi !== cur.midi) {
      seq.updateNote({ ...cur, midi: nextMidi });
    }
  }, [seq, isDrum, drumSamples.length]);
  const onVelChange = useCallback((v: number) => {
    const notes = seq.steps[seq.stepIndex]?.notes || [];
    const cur = notes[seq.noteIndex];
    if (!cur) return;
    seq.updateNote({ ...cur, vel: Math.max(0.05, Math.min(1, v)) });
  }, [seq]);

  // STAR label (centered): note or chord name for currently highlighted step
  const activeNotes: SequencerNote[] = (seq.steps[seq.playheadStep]?.notes || []) as SequencerNote[];
  const starText = activeNotes.length ? chordNameFromMidiSet(activeNotes.map((n: SequencerNote) => n.midi)) : '';

  // Monochrome geometry: step circles with inside dots for multi-notes
  const rowRef = useRef<HTMLDivElement | null>(null);
  const CIRCLE = 48; // diameter of step circle
  const GAP = 10; // spacing between circles
  const STEP_UNIT = CIRCLE + GAP; // circle width + gap, must match styles

  // Auto-scroll: keep selected step centered/visible
  useEffect(() => {
    const el = rowRef.current;
    if (!el) return;
    const idx = Math.max(0, Math.min(seq.length - 1, seq.stepIndex));
  const target = idx * STEP_UNIT + (CIRCLE/2) - el.clientWidth / 2; // center selected
    const max = Math.max(0, el.scrollWidth - el.clientWidth);
    const left = Math.max(0, Math.min(max, target));
    try { el.scrollTo({ left, behavior: 'smooth' }); } catch { el.scrollLeft = left; }
  }, [seq.stepIndex, seq.length]);
  const onRowClick: React.MouseEventHandler<HTMLDivElement> = (e) => {
    const el = e.currentTarget;
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left + el.scrollLeft; // include scroll offset
    const idx = Math.floor(x / STEP_UNIT);
    seq.setStepIndex(Math.max(0, Math.min(seq.length - 1, idx)));
  };

  const row = (
    <div
      onClick={onRowClick}
      ref={rowRef}
      style={{ display: 'flex', alignItems: 'center', gap: GAP, justifyContent: 'flex-start', padding: '8px 6px', userSelect: 'none', cursor: 'pointer', overflowX: 'auto' }}
    >
    {Array.from({ length: Math.max(1, seq.length) }).map((_, i: number) => {
  const isPlaying = !!(seq.playingLocal || seq.playingGlobal);
  const active = isPlaying && (i === seq.playheadStep);
        const selected = i === seq.stepIndex;
        const st = seq.steps[i] as SequencerStep | undefined;
        const notes = (st?.notes) || [];
        const circleBg = active ? 'var(--accent)' : (selected ? 'rgba(255,255,255,0.14)' : 'transparent');
        return (
          <div
            key={i}
            className={`seq-step ${selected ? 'is-selected' : ''} ${active ? 'is-active' : ''}`}
            style={{
              width: CIRCLE,
              height: CIRCLE,
              minWidth: CIRCLE,
              background: circleBg,
            }}
          >
            {notes.map((n: SequencerNote, j: number) => {
              const pc = n.midi % 12; const theta = (pc / 12) * (Math.PI * 2) - Math.PI / 2;
              const oct = Math.floor(n.midi / 12) % 4; // 0..3
        const baseR = 8 + oct * 5; // adjusted for smaller circle
        const cx = (CIRCLE/2) + Math.cos(theta) * baseR;
        const cy = (CIRCLE/2) + Math.sin(theta) * baseR;
        const r = 3 + Math.round(n.vel * 3);
              const isSelectedNote = selected && j === Math.max(0, Math.min(notes.length - 1, seq.noteIndex));
              if (n.legato) {
                // High-contrast donut with clear punched hole: thin 2px ring
                const innerR = Math.max(1, r - 2);
                return (
                  <div key={j} style={{ position: 'absolute', left: cx - r, top: cy - r, width: r * 2, height: r * 2, background: 'var(--text)', borderRadius: r * 2, boxShadow: isSelectedNote ? '0 0 0 2px var(--accent)' : 'none', zIndex: isSelectedNote ? 2 : 1 }}>
                    <div style={{ position: 'absolute', left: r - innerR, top: r - innerR, width: innerR * 2, height: innerR * 2, background: 'var(--bg, #000)', borderRadius: innerR * 2 }} />
                  </div>
                );
              }
              return <div key={j} style={{ position: 'absolute', left: cx - r, top: cy - r, width: r * 2, height: r * 2, background: '#fff', borderRadius: r * 2, boxShadow: isSelectedNote ? '0 0 0 2px var(--accent)' : 'none', zIndex: isSelectedNote ? 2 : 1 }} />
            })}
          </div>
        );
      })}
    </div>
  );

  const menuView = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center', padding: 8 }}>
      <div style={{ fontSize: 12, color: 'var(--accent)' }}>SEQUENCE OPTIONS</div>
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', justifyContent: 'center' }}>
        {/* Resolution: discrete 6-step */}
        <Knob
          label={`Step Res  ${resLabel(seq.resolution)}`}
          value={seq.resolutionNorm}
          onChange={(v)=> seq.setResolutionNorm(v)}
          step={6}
          format={() => resLabel(seq.resolution)}
          onStepClick={(dir)=> {
            const steps = ['1/4','1/8','1/16','1/32','1/8t','1/16t'] as const;
            const idx = steps.indexOf(seq.resolution as any);
            const next = Math.max(0, Math.min(steps.length - 1, idx + dir));
            const norm = next / (steps.length - 1);
            seq.setResolutionNorm(norm);
          }}
        />
        {/* Length: 1..64 discrete */}
        <Knob
          label={`Steps  ${seq.length}`}
          value={(seq.length - 1) / 63}
          step={64}
          onChange={(v)=> seq.setLength(1 + Math.round(v * 63))}
          format={() => String(seq.length)}
          onStepClick={(dir)=> seq.setLength(Math.max(1, Math.min(64, seq.length + dir)))}
        />
        {/* Mode: 2-position switch */}
        <Knob
          label={`Mode  ${seq.mode === 'tempo' ? 'Tempo' : 'Polyrhythm'}`}
          value={seq.mode === 'tempo' ? 0 : 1}
          step={2}
          onChange={(v)=> seq.setMode(v < 0.5 ? 'tempo' : 'poly')}
          format={() => (seq.mode === 'tempo' ? 'Tempo' : 'Poly')}
          onStepClick={(dir)=> seq.setMode(seq.mode === 'tempo' ? 'poly' : 'tempo')}
        />
        {/* Local BPM: infinite drag mapped 40..240 */}
        <Knob
          label={`Local BPM  ${Math.round(seq.localBpm)}`}
          value={(seq.localBpm - 40) / 200}
          onChange={(v)=> seq.setLocalBpm(40 + v * 200)}
          inactive={seq.mode !== 'poly'}
          infinite
          format={() => `${Math.round(seq.localBpm)} BPM`}
        />
      </div>
      <div style={{ fontSize: 10, color: 'var(--text-soft)' }}>(Press W to return)</div>
    </div>
  );

  // Playhead sweep indicator
  const isPlaying = !!(seq.playingLocal || seq.playingGlobal);
  const sweep = (
    <div style={{ height: 2, width: '100%', background: 'var(--line)', position: 'relative', marginTop: 6, display: isPlaying ? 'block' : 'none' }}>
      <div style={{ position: 'absolute', left: `${seq.playheadFrac * 100}%`, top: -2, width: 2, height: 6, background: 'var(--accent)' }} />
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', height: '100%', color: 'var(--text)' }}>
      {/* STAR label */}
      <div style={{ textAlign: 'center', fontSize: 14, padding: 6, color: seq.lastTriggered ? 'var(--accent)' : 'var(--text)' }}>
        {starText || 'STAR'}
      </div>
      {/* Sequencer row or menu */}
      {menu ? menuView : row}
      {sweep}
      {/* Controls (Knobs) */}
      {!menu && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 24, padding: '8px 0' }}>
          <Knob label="Step" value={k1} step={Math.max(2, seq.length)} onChange={onStepChange} infinite format={() => `${seq.stepIndex + 1}/${Math.max(1, seq.length)}`} onStepClick={(d)=> onStepChange(k1 + (d>0? 1 : -1)/Math.max(1, seq.length-1))} />
          <Knob label="Note" value={k2} step={Math.max(2, (seq.steps[seq.stepIndex]?.notes?.length || 0) || 2)} onChange={onNoteChange} infinite format={() => { const notes = seq.steps[seq.stepIndex]?.notes || []; const count = notes.length; const idx = Math.max(0, Math.min(Math.max(0, count-1), seq.noteIndex)); return count ? `${idx+1}/${count}` : '0/0'; }} onStepClick={(d)=> onNoteChange(k2 + (d>0? 1 : -1)/Math.max(1, ((seq.steps[seq.stepIndex]?.notes||[]).length||1)-1 || 1))} />
          <Knob
            label={isDrum ? "Sample" : "Pitch"}
            value={k3}
            step={isDrum ? Math.max(2, (drumSamples?.length || 16)) : 49}
            onChange={onPitchChange}
            infinite
            format={() => {
              const notes = seq.steps[seq.stepIndex]?.notes || [];
              const cur = notes[seq.noteIndex];
              if (!cur) return '--';
              if (isDrum) {
                const base = 36;
                const slots = Math.max(1, (drumSamples?.length || 16));
                const idx = Math.max(0, Math.min(slots - 1, Math.round((cur.midi || base) - base)));
                const name = drumSamples[idx];
                return name ? name : `SLOT ${idx+1}`;
              }
              const names = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
              const pc = ((cur.midi % 12) + 12) % 12; const oct = Math.floor(cur.midi / 12) - 1;
              return `${names[pc]}${oct}`;
            }}
            onStepClick={(d)=> {
              if (isDrum) {
                const slots = Math.max(1, (drumSamples?.length || 16));
                const step = 1 / Math.max(1, slots - 1);
                onPitchChange(k3 + (d>0 ? step : -step));
              } else {
                // step by one semitone across 48 semis
                onPitchChange(k3 + (d>0? 1 : -1)/48);
              }
            }}
          />
          <Knob label="Velocity" value={k4} step={33} onChange={onVelChange} infinite format={() => { const notes = seq.steps[seq.stepIndex]?.notes || []; const cur = notes[seq.noteIndex]; if (!cur) return '--'; return `VEL ${Math.round(cur.vel * 127)}`; }} onStepClick={(d)=> onVelChange(k4 + (d>0? 0.05 : -0.05))} />
        </div>
      )}
    </div>
  );
}

function resLabel(r: SequencerResolution): string {
  switch (r) {
    case '1/4': return '1/4';
    case '1/8': return '1/8';
    case '1/16': return '1/16';
    case '1/32': return '1/32';
    case '1/8t': return '1/8T';
    case '1/16t': return '1/16T';
  }
}

export type SequencerResolution = '1/4' | '1/8' | '1/16' | '1/32' | '1/8t' | '1/16t';
