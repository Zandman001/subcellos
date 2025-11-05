import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { keyIs } from '../utils/key';
import Knob from './synth/Knob';
import { useSequencer, SequencerNote, SequencerStep, usePatternGhosts } from '../store/sequencer';
import { useBrowser } from '../store/browser';
import { useFourKnobHotkeys } from '../hooks/useFourKnobHotkeys';

// Lane 3 icon component: shows PNGs from /icons when available; otherwise uses vector fallback
function Lane3Icon({ mode }: { mode: 'tempo' | 'poly' }) {
  const [imgOk, setImgOk] = useState(true);
  const wrap: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  padding: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'none',
  };
  const imgStyle: React.CSSProperties = {
  maxWidth: '100%',
  maxHeight: '100%',
    imageRendering: 'pixelated' as any,
    filter: 'brightness(1.0)',
    display: imgOk ? 'block' : 'none',
  };
  const src = mode === 'tempo' ? '/icons/tempo.png' : '/icons/poly.png';

  const TempoSVG = (
    <svg viewBox="0 0 128 128" width="100%" height="100%" style={{ display: imgOk ? 'none' : 'block' }}>
      <g fill="#fff">
        <rect x="12" y="100" width="104" height="20" />
        <path d="M40 20 H88 L108 120 H20 Z" fill="none" stroke="#fff" strokeWidth="8" />
        <path d="M60 96 L92 24" stroke="#fff" strokeWidth="8" />
        <circle cx="94" cy="22" r="6" fill="#fff" />
      </g>
    </svg>
  );
  const PolySVG = (
    <svg viewBox="0 0 256 128" width="100%" height="100%" style={{ display: imgOk ? 'none' : 'block' }}>
      <g fill="#fff">
        <rect x="12" y="100" width="104" height="20" />
        <rect x="140" y="100" width="104" height="20" />
        <path d="M40 20 H88 L108 120 H20 Z" fill="none" stroke="#fff" strokeWidth="8" />
        <path d="M168 20 H216 L236 120 H148 Z" fill="none" stroke="#fff" strokeWidth="8" />
        <path d="M60 96 L92 24" stroke="#fff" strokeWidth="8" />
        <path d="M196 96 L164 24" stroke="#fff" strokeWidth="8" />
        <circle cx="94" cy="22" r="6" fill="#fff" />
        <circle cx="162" cy="22" r="6" fill="#fff" />
      </g>
    </svg>
  );

  return (
    <div style={wrap}>
      <img src={src} alt={mode} style={imgStyle} onError={() => setImgOk(false)} />
      {mode === 'tempo' ? TempoSVG : PolySVG}
    </div>
  );
}

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

  // Keyboard: 7 toggle menu, 8 legato, W/R step left/right; Q add, A remove; Space-hold selection; C copy; V paste
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // 7 toggles the Sequence Options menu
      if (keyIs(e, ['Digit7','Numpad7'], ['7'])) { e.preventDefault(); setMenuOpen(!menu); return; }
      if (menu) return; // when in menu, ignore edit keys
      // Selection begin on Space (ignore repeats)
      if (keyIs(e, ['Space'], [' '])) {
        if (!(seq as any).isSelecting && !e.repeat) { e.preventDefault(); (seq as any).beginSelection?.(); }
        return;
      }
      // Copy/Paste (ignore repeats to prevent double actions)
      if (keyIs(e, ['KeyC'], ['c','C'])) { if (!e.repeat) { e.preventDefault(); (seq as any).copySelection?.(); } return; }
      if (keyIs(e, ['KeyV'], ['v','V'])) { if (!e.repeat) { e.preventDefault(); (seq as any).pasteAt?.(seq.stepIndex); } return; }
      // W/R: navigate steps (left/right)
      if (keyIs(e, ['KeyW'], ['w','W'])) { e.preventDefault(); seq.setStepIndex(seq.stepIndex - 1); return; }
      if (keyIs(e, ['KeyR'], ['r','R'])) { e.preventDefault(); seq.setStepIndex(seq.stepIndex + 1); return; }
      // Edit keys
      if (keyIs(e, ['KeyQ'], ['q','Q'])) { e.preventDefault(); seq.addNoteAtSelection(); return; }
      if (keyIs(e, ['KeyA'], ['a','A'])) { e.preventDefault(); seq.removeNoteAtSelection(); return; }
      // 8 toggles legato
      if (keyIs(e, ['Digit8','Numpad8'], ['8'])) { e.preventDefault(); seq.toggleLegatoAtSelection(); return; }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (menu) return;
      if (keyIs(e, ['Space'], [' '])) { e.preventDefault(); (seq as any).endSelection?.(); }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => { window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp); };
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

  // Header label switches between 'sequencer' and 'sequencer settings'

  // Monochrome geometry: step circles with inside dots for multi-notes
  const rowRef = useRef<HTMLDivElement | null>(null);
  const CIRCLE = 48; // diameter of step circle
  const GAP = 10; // spacing between circles
  const STEP_UNIT = CIRCLE + GAP; // circle width + gap, must match styles
  const GHOST_H = 6; // height of each ghost rectangle
  const GHOST_GAP = 2; // vertical gap between ghost rectangles

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

  // Ghost sequences for the current pattern (exclude current sound)
  const ghostsAll = usePatternGhosts();
  const ghosts = useMemo(() => ghostsAll.filter(g => g.soundId !== soundId), [ghostsAll, soundId]);
  const maxGhostRows = Math.min(8, ghosts.length);

  const row = (
    <div
      onClick={onRowClick}
      ref={rowRef}
      style={{ padding: '8px 6px', userSelect: 'none', cursor: 'pointer', overflowX: 'auto', contain: 'paint', willChange: 'transform', transform: 'translateZ(0)', overscrollBehavior: 'contain' as any }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: GAP, justifyContent: 'flex-start' }}>
    {Array.from({ length: Math.max(1, seq.length) }).map((_, i: number) => {
  const isPlaying = !!(seq.playingLocal || seq.playingGlobal);
  const active = isPlaying && (i === seq.playheadStep);
    const selected = i === seq.stepIndex;
    // Selection highlight when actively selecting via Space
    const selStart = (seq as any).selectionStartStep as number | null;
    const selEnd = (seq as any).selectionEndStep as number | null;
    const inSel = (seq as any).isSelecting && selStart != null && selEnd != null && i >= Math.min(selStart, selEnd) && i <= Math.max(selStart, selEnd);
        const st = seq.steps[i] as SequencerStep | undefined;
        const notes = (st?.notes) || [];
    const circleBg = active ? 'var(--accent)' : (inSel ? 'rgba(255,255,255,0.18)' : (selected ? 'rgba(255,255,255,0.14)' : 'transparent'));
        // Bar markers: outer ring on first and every 4th step
        const isBar = (i % 4) === 0;
        const RING_PAD = 4;
        return (
          <div key={i} style={{ width: CIRCLE, minWidth: CIRCLE }}>
            <div
              className={`seq-step ${selected ? 'is-selected' : ''} ${active ? 'is-active' : ''}`}
              style={{
                width: CIRCLE,
                height: CIRCLE,
                position: 'relative',
                background: circleBg,
              }}
            >
              {isBar && (
                <div
                  style={{
                    position: 'absolute',
                    left: '50%',
                    top: '50%',
                    transform: 'translate(-50%, -50%)',
                    width: CIRCLE + RING_PAD * 2,
                    height: CIRCLE + RING_PAD * 2,
                    borderRadius: '50%',
                    border: `2px solid rgba(255,255,255,0.4)`,
                    pointerEvents: 'none',
                    zIndex: 0,
                  }}
                />
              )}
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
            {/* Ghost rectangles for other sequences at this same step index */}
            {maxGhostRows > 0 && (
              <div
                style={{
                  // push ghosts slightly further down from the main step circle
                  marginTop: 10,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: GHOST_GAP,
                  pointerEvents: 'none',
                }}
              >
                {ghosts.slice(0, maxGhostRows).map((g, gi) => {
                  const giStep = g.length > 0 ? (i % g.length) : 0;
                  const has = !!g.has[giStep];
                  return (
                    <div
                      key={gi}
                      style={{
                        width: CIRCLE,
                        height: GHOST_H,
                        borderRadius: 3,
                        background: has ? 'rgba(255,255,255,0.28)' : 'transparent',
                        border: has ? '1px solid rgba(255,255,255,0.18)' : '1px solid rgba(255,255,255,0.14)',
                        boxShadow: has ? '0 0 0 1px rgba(255,255,255,0.06) inset' : 'none',
                        opacity: 0.75,
                      }}
                    />
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
      </div>
    </div>
  );

  const menuView = (
  <div
      aria-hidden
      style={{
    display: 'flex',
        flexDirection: 'row',
        gap: 0,
        padding: 0,
        alignItems: 'stretch',
        justifyContent: 'stretch',
  width: '100%',
    flex: '1 1 auto',
    minHeight: 0,
  height: '100%',
        position: 'relative',
        boxSizing: 'border-box',
        background: 'var(--bg)',
  // Remove border to avoid any visual masking at edges
  border: 'none',
  marginBottom: 0
      }}
    >
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          style={{
            flex: 1,
            position: 'relative',
            height: '100%',
            // Subtle visual texture per lane
            backgroundImage:
              'radial-gradient(rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.05), rgba(255,255,255,0.02))',
            backgroundSize: '8px 8px, 100% 100%',
          }}
        >
          {/* Lane separator (between lanes) */}
          {i < 3 && (
            <div
              style={{
                position: 'absolute',
                right: 0,
                top: 0,
                bottom: 0,
                width: 1,
                background: 'var(--line)'
              }}
            />
          )}
          {/* Lane 1: 1-bit resolution visual (barcode of subdivisions per beat, triplets supported) */}
          {i === 0 && (() => {
            const res = String(seq.resolution || '1/16').toLowerCase();
            const perBeat = ((): number => {
              switch (res) {
                case '1/4': return 1;
                case '1/8': return 2;
                case '1/16': return 4;
                case '1/32': return 8;
                case '1/8t': return 3;
                case '1/16t': return 6;
                default: return 4;
              }
            })();
            const beats = 4; // show four beats
            const total = Math.max(1, beats * perBeat);
            // Use a 2x grid so each subdivision gets a 1-unit thin line with a 1-unit gap
            const scale = 2;
            const width = total * scale;
            // Draw full-height bars so they meet the knob footer
            const topPad = 0;
            const botPad = 0;
            const innerH = 100 - topPad - botPad;
            const minorTopPct = 0.40; // 40% from top inside
            const minorHPct = 0.60;   // 60% height inside
            return (
              <svg
                viewBox={`0 0 ${width} 100`}
                preserveAspectRatio="none"
                style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, display: 'block', imageRendering: 'pixelated' as any, pointerEvents: 'none' }}
                shapeRendering="crispEdges"
              >
                {Array.from({ length: total }).map((_, k) => {
                  const x = k * scale; // integer-aligned
                  const major = (k % perBeat) === 0; // beat boundary
                  const y = major ? topPad : (topPad + Math.round(innerH * minorTopPct));
                  const h = major ? innerH : Math.round(innerH * minorHPct);
                  return <rect key={k} x={x} y={y} width={1} height={h} fill="#fff" />;
                })}
              </svg>
            );
          })()}
          {/* Lane 2: tall rectangle (4 columns), blocks wider than tall; 64 steps reach top without overflow */}
          {i === 1 && (() => {
            const count = Math.max(1, seq.length);
            const gap = 2;  // px gap
            const cols = 4;  // fixed
            const blockW = 16; // px width (a little wider)
            // Height to fit 16 rows inside lane: innerH = 140 - 16 padding = 124; 16 rows => h <= (124 - 15*gap)/16
            const blockH = 5;  // px height (fits 16 rows with gap)
            return (
              <div
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  top: 0,
                  bottom: 0,
                  display: 'grid',
                  gridTemplateColumns: `repeat(${cols}, ${blockW}px)`,
                  gridAutoRows: `${blockH}px`,
                  gap: `${gap}px`,
          justifyContent: 'start',
          alignContent: 'start', // with flip, start means bottom of visual space
          transform: 'scaleY(-1)',
                  pointerEvents: 'none',
                }}
              >
                {Array.from({ length: count }).map((_, k) => (
                  <div
                    key={k}
                    style={{
                      width: blockW,
                      height: blockH,
                      background: '#fff',
            opacity: 0.9,
            transform: 'scaleY(-1)', // flip back upright
                    }}
                  />
                ))}
              </div>
            );
          })()}
          {/* Lane 3: mode icon */}
          {i === 2 && <Lane3Icon mode={seq.mode} />}
        </div>
      ))}
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
      {/* Header */}
  <div style={{ textAlign: 'center', fontSize: 'calc(14px * var(--ui-font-scale))', padding: 6, color: 'var(--text)' }}>
        {menu ? 'sequencer settings' : 'sequencer'}
      </div>
      {/* Sequencer row or menu */}
      {menu ? (
        // Stretch lanes to the knob footer: occupy remaining vertical space
        <div style={{ flex: '1 1 auto', minHeight: 0, display: 'flex' }}>
          {menuView}
        </div>
      ) : (
        <>
          {row}
          {sweep}
        </>
      )}
  {/* Controls (Knobs) always visible; menu visuals appear above */}
  <div style={{ display: 'flex', justifyContent: 'center', gap: 24, padding: `${menu ? 0 : 8}px 0 ${menu ? 0 : 8}px` }}>
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
    </div>
  );
}

