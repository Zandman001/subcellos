import { useEffect, useSyncExternalStore } from 'react';
import { rpc } from '../rpc';

// Types
export type SequencerResolution = '1/4' | '1/8' | '1/16' | '1/32' | '1/8t' | '1/16t';
export type SequencerMode = 'tempo' | 'poly';
export type SequencerNote = { midi: number; vel: number; legato?: boolean };
export type SequencerStep = { time: number; notes: SequencerNote[] };

// Local-only, per-sound sequencer store. Designed to be backend-agnostic and later pluggable.
type Seq = {
  part?: number;
  moduleKind?: 'synth' | 'sampler' | 'drum';
  steps: SequencerStep[];
  length: number; // step count
  resolution: SequencerResolution;
  resolutionNorm: number; // 0..1 mapped to discrete items
  mode: SequencerMode;
  localBpm: number;
  // selection
  stepIndex: number;
  noteIndex: number;
  // transport
  playingLocal: boolean;
  playingGlobal: boolean;
  playheadFrac: number; // 0..1 across total row
  playheadStep: number; // integer index of the step under the playhead
  lastTriggered: boolean; // flash marker
};

const seqMap: Record<string, Seq> = {};

// Simple local persistence per soundId
function saveSeq(soundId: string) {
  if (typeof window === 'undefined') return;
  try {
    const s = seqMap[soundId];
    if (!s) return;
    const payload = {
      steps: s.steps,
      length: s.length,
      resolution: s.resolution,
      resolutionNorm: s.resolutionNorm,
      mode: s.mode,
      localBpm: s.localBpm,
    };
    localStorage.setItem(`seq:${soundId}`, JSON.stringify(payload));
  } catch {}
}

function loadSeq(soundId: string): Partial<Seq> | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(`seq:${soundId}`);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    // Basic validation
    if (!obj || typeof obj !== 'object') return null;
    const out: Partial<Seq> = {};
    if (Array.isArray(obj.steps)) out.steps = obj.steps;
    if (typeof obj.length === 'number') out.length = obj.length;
    if (typeof obj.resolution === 'string') out.resolution = obj.resolution as any;
    if (typeof obj.resolutionNorm === 'number') out.resolutionNorm = obj.resolutionNorm;
    if (typeof obj.mode === 'string') out.mode = obj.mode as any;
    if (typeof obj.localBpm === 'number') out.localBpm = obj.localBpm;
    return out;
  } catch { return null; }
}

function getDefault(): Seq {
  return {
    steps: [],
    length: 16,
    resolution: '1/16',
    resolutionNorm: 0.5,
    mode: 'tempo',
    localBpm: 120,
    stepIndex: 0,
    noteIndex: 0,
    playingLocal: false,
    playingGlobal: false,
    playheadFrac: 0,
    playheadStep: -1,
    lastTriggered: false,
  }
}

const listeners = new Set<() => void>();
const versions: Record<string, number> = {};
const snapshots: Record<string, any> = {};
function notify() { listeners.forEach(l => { try { l(); } catch {} }); }

function get(soundId: string): Seq {
  if (!seqMap[soundId]) {
    const base = getDefault();
    const loaded = loadSeq(soundId);
    seqMap[soundId] = loaded ? { ...base, ...loaded } : base;
  }
  return seqMap[soundId];
}

function set(soundId: string, patch: Partial<Seq>) {
  Object.assign(get(soundId), patch);
  versions[soundId] = (versions[soundId] || 0) + 1;
  snapshots[soundId] = undefined; // invalidate cached snapshot
  notify();
  saveSeq(soundId);
}

// Transient updates (playhead, flashes) that shouldn't hit localStorage
function touch(soundId: string) {
  versions[soundId] = (versions[soundId] || 0) + 1;
  snapshots[soundId] = undefined;
}

// Transport clock: drive playhead; sequences align to global if playingGlobal true
let rafId: number | undefined;
let lastT = 0; // ms
let globalStart = 0;
let globalPlaying = false;
let globalBpm = 120;
// throttle per-seq frac updates to ~30 Hz to avoid excessive renders
const lastFracNotify: Record<string, number> = {};
// Listen to global tempo changes dispatched by TopBar and others
if (typeof window !== 'undefined') {
  try {
    window.addEventListener('tempo-change', (e: any) => {
      const bpm = e?.detail?.bpm;
      if (typeof bpm === 'number' && Number.isFinite(bpm)) {
        globalBpm = Math.max(20, Math.min(240, bpm));
      }
    });
  } catch {}
}

function stepTimeMs(res: SequencerResolution, bpm: number): number {
  const qnMs = 60000 / bpm;
  switch (res) {
    case '1/4': return qnMs;
    case '1/8': return qnMs / 2;
    case '1/16': return qnMs / 4;
    case '1/32': return qnMs / 8;
    case '1/8t': return (qnMs / 3); // triplet of quarter -> eighth-triplet ~ 1/3 of qn
    case '1/16t': return (qnMs / 6);
  }
}

function tick(ts: number) {
  if (!lastT) { lastT = ts; globalStart = ts; }
  const dt = ts - lastT; lastT = ts;
  const now = ts;
  const gElapsed = now - globalStart;
  // For each sequence: decide which clock to follow
  Object.keys(seqMap).forEach(id => {
    const s = seqMap[id];
    const followGlobal = (s.mode === 'tempo') && s.playingGlobal;
    const isActive = followGlobal || s.playingLocal; // in polyrhythm mode, allow local when global running
    const bpm = followGlobal ? globalBpm : (s.localBpm || 120);
    const stMs = stepTimeMs(s.resolution, bpm);
    if (!isActive) return; // paused entirely
    if (stMs <= 0 || s.length <= 0) return;
    const elapsed = followGlobal ? gElapsed : (s as any)._localStart ? (now - (s as any)._localStart) : 0;
    if (!followGlobal && !(s as any)._localStart) { (s as any)._localStart = now; }
    // Position in steps
    const totalMs = stMs * s.length;
    const loopPos = elapsed % totalMs;
    const frac = Math.max(0, Math.min(1, loopPos / totalMs));
    const step = Math.floor((loopPos / stMs) + 1e-6) % s.length;
  const prev = s.playheadStep;
    s.playheadFrac = frac;
    s.playheadStep = step;
    // If just started, trigger the very first step immediately
    if ((s as any)._needsTrigger) {
      (s as any)._needsTrigger = false;
      // On start, treat as a step-edge into current step
      const part = typeof s.part === 'number' ? s.part : undefined;
      const curr = (s.steps[step]?.notes) || [];
      const prevIdx = (step + (s.length - 1)) % Math.max(1, s.length);
      const prevNotes = (s.steps[prevIdx]?.notes) || [];
      const prevSet = new Set(prevNotes.map(n=>n.midi));
      if (s.moduleKind === 'synth') {
        const held: Set<number> = (s as any)._held || new Set<number>();
        (s as any)._held = held;
        // Start only non-legato notes
        for (const n of curr) {
          const cont = n.legato && prevSet.has(n.midi);
          if (!cont && typeof part === 'number') {
            try { rpc.noteOn(part, n.midi, n.vel); } catch {}
            held.add(n.midi);
          }
        }
      } else {
        // drums/sampler: fire all notes (one-shots)
        for (const n of curr) {
          if (typeof part === 'number') { try { rpc.noteOn(part, n.midi, n.vel); } catch {} }
        }
      }
      s.lastTriggered = true;
      setTimeout(() => { s.lastTriggered = false; touch(id); notify(); }, 80);
      touch(id);
      notify();
      return;
    }
    // Triggered step edge detection
    if (prev !== step) {
      s.lastTriggered = true;
      const part = typeof s.part === 'number' ? s.part : undefined;
      const curr = (s.steps[step]?.notes) || [];
      const prevNotes = (s.steps[prev >= 0 ? prev : 0]?.notes) || [];
      const prevSet = new Set(prevNotes.map(n=>n.midi));
      if (s.moduleKind === 'synth') {
        const held: Set<number> = (s as any)._held || new Set<number>();
        (s as any)._held = held;
        // NoteOff for held midis not continued
        const contMidis = new Set<number>();
        for (const n of curr) { if (n.legato && prevSet.has(n.midi)) contMidis.add(n.midi); }
        if (typeof part === 'number') {
          for (const m of Array.from(held)) {
            if (!contMidis.has(m)) {
              try { rpc.noteOff(part, m); } catch {}
              held.delete(m);
            }
          }
        }
        // NoteOn for current non-legato notes
        for (const n of curr) {
          const cont = n.legato && prevSet.has(n.midi);
          if (!cont && typeof part === 'number') {
            try { rpc.noteOn(part, n.midi, n.vel); } catch {}
            held.add(n.midi);
          }
        }
      } else {
        // drums/sampler: trigger all notes each step
        for (const n of curr) {
          if (typeof part === 'number') { try { rpc.noteOn(part, n.midi, n.vel); } catch {} }
        }
      }
      // small decay of flash
      setTimeout(() => { s.lastTriggered = false; touch(id); notify(); }, 80);
      // bump snapshot for step change immediately
      touch(id);
      notify();
    } else {
      // Throttle frac-only updates to ~30 Hz
      const nowMs = performance.now();
      const last = lastFracNotify[id] || 0;
      if (nowMs - last > 33) {
        lastFracNotify[id] = nowMs;
        touch(id);
        notify();
      }
    }
  });
  rafId = requestAnimationFrame(tick);
}
if (typeof window !== 'undefined') rafId = requestAnimationFrame(tick);

function snapResolutionFromNorm(v: number): SequencerResolution {
  const items: SequencerResolution[] = ['1/4','1/8','1/16','1/32','1/8t','1/16t'];
  const idx = Math.max(0, Math.min(items.length - 1, Math.round(v * (items.length - 1))));
  return items[idx];
}

export function useSequencer(soundId: string) {
  useEffect(() => { get(soundId); }, [soundId]);
  const subscribe = (cb: () => void) => { listeners.add(cb); return () => listeners.delete(cb); };
  // Versioned snapshot: new identity only when set() mutates state
  const getSnapshot = () => {
    const v = versions[soundId] || 0;
    const cached = snapshots[soundId];
    if (cached && cached.__v === v) return cached;
    const snap = { ...get(soundId), __v: v } as any;
    snapshots[soundId] = snap;
    return snap;
  };
  const s = useSyncExternalStore(subscribe, getSnapshot);

  const api = {
    ...s,
  setPart: (p: number) => set(soundId, { part: Math.max(0, Math.min(5, Math.floor(p))) }),
  setModuleKind: (k: 'synth'|'sampler'|'drum') => set(soundId, { moduleKind: k }),
  setGlobalBpm: (bpm: number) => { globalBpm = Math.max(20, Math.min(240, Math.round(bpm))); },
    setStepIndex: (i: number) => set(soundId, { stepIndex: Math.max(0, Math.min(get(soundId).length - 1, Math.round(i))) }),
    setNoteIndex: (i: number) => set(soundId, { noteIndex: Math.max(0, Math.min(((get(soundId).steps[get(soundId).stepIndex]?.notes.length)||1) - 1, Math.round(i))) }),
    addNoteAtSelection: () => {
      const st = get(soundId);
      const idx = st.stepIndex;
      const steps = st.steps.slice();
      while (steps.length < st.length) steps.push({ time: steps.length, notes: [] });
      const notes = steps[idx].notes.slice();
      const baseMidi = 60; // C4
      const vel = 0.7;
  notes.push({ midi: baseMidi, vel });
      steps[idx] = { ...steps[idx], notes };
  set(soundId, { steps, noteIndex: Math.max(0, notes.length - 1) });
    },
    // Add at most one note: only when the step is empty. Used by pitch knob to avoid spamming.
    ensureNoteAtSelection: (midi: number, vel: number = 0.7) => {
      const st = get(soundId);
      const idx = st.stepIndex;
      const steps = st.steps.slice();
      while (steps.length < st.length) steps.push({ time: steps.length, notes: [] });
      const notes = steps[idx].notes.slice();
      if (notes.length > 0) return; // already populated, do nothing
      notes.push({ midi, vel });
      steps[idx] = { ...steps[idx], notes };
      set(soundId, { steps, noteIndex: Math.max(0, notes.length - 1) });
    },
    removeNoteAtSelection: () => {
      const st = get(soundId);
      const idx = st.stepIndex;
      const steps = st.steps.slice();
      const notes = (steps[idx]?.notes || []).slice();
      if (notes.length > 0) {
        const ni = Math.max(0, Math.min(notes.length - 1, st.noteIndex));
        notes.splice(ni, 1);
        steps[idx] = { ...steps[idx], notes };
        set(soundId, { steps, noteIndex: Math.max(0, Math.min(ni, notes.length - 1)) });
      }
    },
    updateNote: (n: SequencerNote) => {
      const st = get(soundId);
      const idx = st.stepIndex;
      const ni = Math.max(0, Math.min(((st.steps[idx]?.notes.length)||1)-1, st.noteIndex));
      const steps = st.steps.slice();
      const notes = (steps[idx]?.notes || []).slice();
      notes[ni] = n;
      steps[idx] = { ...steps[idx], notes };
      set(soundId, { steps });
    },
    toggleLegatoAtSelection: () => {
      const st = get(soundId);
      const idx = st.stepIndex;
      const steps = st.steps.slice();
      const notes = (steps[idx]?.notes || []).slice();
      if (!notes.length) return;
      const ni = Math.max(0, Math.min(notes.length - 1, st.noteIndex));
      let targetIndex = ni;
      let cur = { ...(notes[targetIndex] || {}) } as SequencerNote;
      const prevIdx = (idx + (st.length - 1)) % Math.max(1, st.length);
      const prevNotes = (steps[prevIdx]?.notes || []) as SequencerNote[];
      const hasPrevSame = prevNotes.some(n => n.midi === cur.midi);
      if (!cur.legato && !hasPrevSame) {
        // Try to find any current note that matches a prev note
        const prevSet = new Set(prevNotes.map(n=>n.midi));
        const j = notes.findIndex(n => prevSet.has(n.midi));
        if (j >= 0) {
          targetIndex = j;
          cur = { ...(notes[targetIndex] || {}) } as SequencerNote;
        } else {
          return; // no candidate to legato
        }
      }
      // Toggle
      cur.legato = !cur.legato;
      notes[targetIndex] = cur;
      steps[idx] = { ...steps[idx], notes };
      set(soundId, { steps, noteIndex: targetIndex });
    },
    setResolutionNorm: (v: number) => {
      const res = snapResolutionFromNorm(v);
      set(soundId, { resolution: res, resolutionNorm: Math.max(0, Math.min(1, v)) });
    },
    setLength: (n: number) => {
      const len = Math.max(1, Math.min(64, Math.round(n)));
      set(soundId, { length: len });
    },
    setMode: (m: 'tempo' | 'poly') => set(soundId, { mode: m }),
    setLocalBpm: (bpm: number) => set(soundId, { localBpm: Math.max(20, Math.min(240, Math.round(bpm))) }),
    toggleLocalPlay: () => {
      const cur = get(soundId);
      const next = !cur.playingLocal;
      // If enabling a local, ensure no global and no other locals are playing
      if (next) {
        // Stop global playback entirely (mutually exclusive)
        if (globalPlaying) {
          globalPlaying = false;
          Object.keys(seqMap).forEach(id => {
            const s = get(id);
            // release any held notes (from synth legs)
            const held: Set<number> = (s as any)._held || new Set<number>();
            const part = typeof s.part === 'number' ? s.part : undefined;
            if (typeof part === 'number') { for (const m of Array.from(held)) { try { rpc.noteOff(part, m); } catch {} } }
            (s as any)._held = new Set<number>();
            if (s.playingGlobal) set(id, { playingGlobal: false });
          });
        }
        // Stop other locals so only one local can run at a time
        Object.keys(seqMap).forEach(id => {
          if (id === soundId) return;
          const s = get(id);
          if (s.playingLocal) {
            const held: Set<number> = (s as any)._held || new Set<number>();
            const part = typeof s.part === 'number' ? s.part : undefined;
            if (typeof part === 'number') { for (const m of Array.from(held)) { try { rpc.noteOff(part, m); } catch {} } }
            (s as any)._held = new Set<number>();
            set(id, { playingLocal: false });
          }
        });
        // Start this local
        (cur as any)._localStart = performance.now();
        cur.playheadFrac = 0; cur.playheadStep = 0; cur.lastTriggered = false;
        (cur as any)._needsTrigger = true;
      } else {
        // release any held notes for this local
        const held: Set<number> = (cur as any)._held || new Set<number>();
        const part = typeof cur.part === 'number' ? cur.part : undefined;
        if (typeof part === 'number') { for (const m of Array.from(held)) { try { rpc.noteOff(part, m); } catch {} } }
        (cur as any)._held = new Set<number>();
      }
      set(soundId, { playingLocal: next });
    },
    toggleGlobalPlay: () => {
      const wantStart = !globalPlaying;
      if (wantStart) {
        // Stop all locals first (mutually exclusive)
        Object.keys(seqMap).forEach(id => {
          const s = get(id);
          if (s.playingLocal) {
            const held: Set<number> = (s as any)._held || new Set<number>();
            const part = typeof s.part === 'number' ? s.part : undefined;
            if (typeof part === 'number') { for (const m of Array.from(held)) { try { rpc.noteOff(part, m); } catch {} } }
            (s as any)._held = new Set<number>();
            set(id, { playingLocal: false });
          }
        });
        // Start global
        globalPlaying = true;
        globalStart = performance.now();
        Object.keys(seqMap).forEach(id => {
          const s = get(id);
          s.playheadFrac = 0; s.playheadStep = 0; s.lastTriggered = false;
          (s as any)._needsTrigger = true;
          set(id, { playingGlobal: true });
        });
      } else {
        // Stop global and release held notes
        globalPlaying = false;
        Object.keys(seqMap).forEach(id => {
          const s = get(id);
          const held: Set<number> = (s as any)._held || new Set<number>();
          const part = typeof s.part === 'number' ? s.part : undefined;
          if (typeof part === 'number') { for (const m of Array.from(held)) { try { rpc.noteOff(part, m); } catch {} } }
          (s as any)._held = new Set<number>();
          set(id, { playingGlobal: false });
        });
      }
    },
  };
  return api as typeof s & {
  setPart(p: number): void;
  toggleLegatoAtSelection(): void;
  setModuleKind(k: 'synth'|'sampler'|'drum'): void;
  setGlobalBpm(bpm: number): void;
    setStepIndex(i: number): void;
    setNoteIndex(i: number): void;
    addNoteAtSelection(): void;
  ensureNoteAtSelection(midi: number, vel?: number): void;
    removeNoteAtSelection(): void;
    updateNote(n: SequencerNote): void;
    setResolutionNorm(v: number): void;
    setLength(n: number): void;
    setMode(m: 'tempo'|'poly'): void;
    setLocalBpm(bpm: number): void;
    toggleLocalPlay(): void;
    toggleGlobalPlay(): void;
  };
}

// Utility: chord naming (basic triads/sevenths by pitch-class set)
export function chordNameFromMidiSet(midis: number[]): string {
  const pcs = Array.from(new Set(midis.map(m => ((m % 12)+12)%12))).sort((a,b)=>a-b);
  if (pcs.length === 0) return '';
  const names = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  // Try every rotation as possible root
  const isSubset = (a: number[], b: number[]) => a.length === b.length && a.every((v,i)=>v===b[i]);
  const patterns: { name: string; ints: number[] }[] = [
    { name: 'maj', ints: [0,4,7] },
    { name: 'min', ints: [0,3,7] },
    { name: 'dim', ints: [0,3,6] },
    { name: 'aug', ints: [0,4,8] },
    { name: 'sus2', ints: [0,2,7] },
    { name: 'sus4', ints: [0,5,7] },
    { name: '7', ints: [0,4,7,10] },
    { name: 'm7', ints: [0,3,7,10] },
    { name: 'maj7', ints: [0,4,7,11] },
  ];
  for (let root of pcs) {
    const rel = pcs.map(p => (p - root + 12) % 12).sort((a,b)=>a-b);
    for (const p of patterns) {
      if (isSubset(rel, p.ints)) return `${names[root]} ${p.name}`;
    }
  }
  // Fallback: show stacked note names
  return pcs.map(p => names[p]).join('-');
}
