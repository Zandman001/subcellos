import { useEffect, useSyncExternalStore } from 'react';
import { rpc } from '../rpc';

// Types
export type SequencerResolution = '1/4' | '1/8' | '1/16' | '1/32' | '1/8t' | '1/16t';
export type SequencerMode = 'tempo' | 'poly';
export type SequencerNote = { midi: number; vel: number; legato?: boolean };
export type SequencerStep = { time: number; notes: SequencerNote[] };
// Read-only ghost summary type for pattern-wide visualization
export type PatternSeqGhost = { soundId: string; length: number; has: boolean[] };

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
  // range selection and copy buffer (transient UI state)
  isSelecting?: boolean;
  selectionStartStep?: number | null;
  selectionEndStep?: number | null;
  copyBuffer?: SequencerStep[] | null;
  // transport
  playingLocal: boolean;
  playingGlobal: boolean;
  playheadFrac: number; // 0..1 across total row
  playheadStep: number; // integer index of the step under the playhead
  lastTriggered: boolean; // flash marker
  // UI (transient)
  uiMenuOpen?: boolean; // true when the Sequencer Options menu (W) is shown
};

// Pattern-scoped sequences. Composite key: `${patternId}::${soundId}`.
let currentPatternId: string = 'default';
try { if (typeof window !== 'undefined') { (window as any).__seqCurrentPattern = currentPatternId; } } catch {}
const seqMap: Record<string, Seq> = {};

// Optional allowlist of soundIds that are eligible to run for the current pattern.
// When null, all sequences for the current pattern are eligible.
let allowedSoundIds: Set<string> | null = null;
try { if (typeof window !== 'undefined') { (window as any).__seqAllowed = allowedSoundIds; } } catch {}

function soundFromKey(k: string): string { const i = k.indexOf('::'); return i >= 0 ? k.slice(i+2) : k; }
function isIdAllowed(id: string): boolean {
  if (!allowedSoundIds) return true;
  const sid = soundFromKey(id);
  return allowedSoundIds.has(sid);
}

// External: set the allowlist of sounds for the active pattern.
export function sequencerSetAllowedSounds(ids?: string[] | Set<string> | null) {
  allowedSoundIds = ids ? new Set(ids as any) : null;
  try { if (typeof window !== 'undefined') { (window as any).__seqAllowed = allowedSoundIds; } } catch {}
  // If global is running, immediately stop any disallowed sequences in the current pattern
  if (globalPlaying) {
    Object.keys(seqMap).forEach(id => {
      if (patternFromKey(id) !== currentPatternId) return;
      if (isIdAllowed(id)) return;
      const s = get(id);
      if (s.playingGlobal) {
        const held: Set<number> = (s as any)._held || new Set<number>();
        const part = typeof s.part === 'number' ? s.part : undefined;
        if (typeof part === 'number') { for (const m of Array.from(held)) { try { rpc.noteOff(part, m); } catch {} } }
        (s as any)._held = new Set<number>();
        set(id, { playingGlobal: false });
      }
    });
  }
}

export function sequencerSetCurrentPattern(pid: string) {
  const prev = currentPatternId;
  const next = pid || 'default';
  currentPatternId = next;
  try { if (typeof window !== 'undefined') { (window as any).__seqCurrentPattern = currentPatternId; } } catch {}
  // Notify subscribers so useSequencer re-subscribes to the new pattern
  notify();
  // If global transport is running, switch active sequences from prev to new pattern
  if (globalPlaying) {
    // Stop sequences from the previous pattern: release held notes and mark not playingGlobal
    Object.keys(seqMap).forEach(id => {
      if (patternFromKey(id) !== prev) return;
      const s = get(id);
      const held: Set<number> = (s as any)._held || new Set<number>();
      const part = typeof s.part === 'number' ? s.part : undefined;
      if (typeof part === 'number') { for (const m of Array.from(held)) { try { rpc.noteOff(part, m); } catch {} } }
      (s as any)._held = new Set<number>();
      if (s.playingGlobal) set(id, { playingGlobal: false });
    });
    // Start sequences in the new pattern aligned to globalStart
    Object.keys(seqMap).forEach(id => {
      if (patternFromKey(id) !== currentPatternId) return;
      if (!isIdAllowed(id)) return;
      const s = get(id);
      if (typeof s.part !== 'number') s.part = 0;
      s.playheadFrac = 0; s.playheadStep = -1; s.lastTriggered = false;
      (s as any)._schedulerMode = true;
      // Switch occurs at a bar boundary; fire step 0 immediately to avoid a perceptible gap.
      const now = performance.now();
      try {
        const len = Math.max(1, s.length|0);
        const prevIdx = (len + 0 - 1) % len; // last step wraps to step 0
        triggerStepEdge(s, id, prevIdx, 0);
      } catch {}
      // Schedule the following step precisely one step later
      const stMs = stepTimeMs(s.resolution, globalBpm);
      const anchor = globalStart;
      const stepsElapsed = stMs ? Math.max(0, Math.floor(Math.max(0, now - anchor) / stMs)) : 0;
      (s as any)._anchorTime = anchor;
      if (stMs && stMs > 0) {
        (s as any)._stepCounter = stepsElapsed + 1;
        (s as any)._nextStepTime = anchor + (stepsElapsed + 1) * stMs;
      } else {
        (s as any)._stepCounter = 0;
        (s as any)._nextStepTime = now;
      }
      // For poly sequences, still keep a local anchor but we follow global step timing during global playback
      (s as any)._localStart = globalStart;
      (s as any)._lastStepIdx = 0;
      s.playheadStep = 0;
      touch(id); notify();
      set(id, { playingGlobal: true });
    });
  }
}

function keyFor(soundId: string): string { return `${currentPatternId}::${soundId}`; }
function patternFromKey(k: string): string { const i = k.indexOf('::'); return i >= 0 ? k.slice(0,i) : 'default'; }

// Simple local persistence per soundId
function saveSeq(soundId: string) {
  if (typeof window === 'undefined') return;
  try {
  const k = soundId.includes('::') ? soundId : keyFor(soundId);
  const s = seqMap[k];
    if (!s) return;
    const payload = {
      steps: s.steps,
      length: s.length,
      resolution: s.resolution,
      resolutionNorm: s.resolutionNorm,
      mode: s.mode,
      localBpm: s.localBpm,
    };
  localStorage.setItem(`seq:${k}`, JSON.stringify(payload));
  } catch {}
}

function loadSeq(soundId: string): Partial<Seq> | null {
  if (typeof window === 'undefined') return null;
  try {
  const k = soundId.includes('::') ? soundId : keyFor(soundId);
  const raw = localStorage.getItem(`seq:${k}`);
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
  isSelecting: false,
  selectionStartStep: null,
  selectionEndStep: null,
  copyBuffer: null,
    playingLocal: false,
    playingGlobal: false,
    playheadFrac: 0,
    playheadStep: -1,
    lastTriggered: false,
  uiMenuOpen: false,
  }
}

const listeners = new Set<() => void>();
const versions: Record<string, number> = {};
const snapshots: Record<string, any> = {};
let __notifyScheduled = false;
function __flushNotify() {
  __notifyScheduled = false;
  listeners.forEach(l => { try { l(); } catch {} });
}
function notify() {
  if (__notifyScheduled) return;
  __notifyScheduled = true;
  try { requestAnimationFrame(__flushNotify); } catch { setTimeout(__flushNotify, 0); }
}
// Cached pattern-wide ghost snapshots keyed by pattern id with composite version
const patternGhostVersions: Record<string, string> = {};
const patternGhostSnapshots: Record<string, any> = {};

function get(soundId: string): Seq {
  const k = soundId.includes('::') ? soundId : keyFor(soundId);
  if (!seqMap[k]) {
    const base = getDefault();
    const loaded = loadSeq(k);
    const s = loaded ? { ...base, ...loaded } : base;
    seqMap[k] = s;
    // Track keys on window for cross-module queries (Arrangement view)
    try { if (typeof window !== 'undefined') { const w: any = window as any; w.__seqKeys = w.__seqKeys || {}; w.__seqKeys[k] = true; } } catch {}
  }
  return seqMap[k];
}

function set(soundId: string, patch: Partial<Seq>) {
  const k = soundId.includes('::') ? soundId : keyFor(soundId);
  Object.assign(get(k), patch);
  versions[k] = (versions[k] || 0) + 1;
  snapshots[k] = undefined; // invalidate cached snapshot
  notify();
  saveSeq(k);
}

// Transient updates (playhead, flashes) that shouldn't hit localStorage
function touch(soundId: string) {
  const k = soundId.includes('::') ? soundId : keyFor(soundId);
  versions[k] = (versions[k] || 0) + 1;
  snapshots[k] = undefined;
}

// Transport clock: drive playhead; sequences align to global if playingGlobal true
let rafId: number | undefined;
let lastT = 0; // ms
let globalStart = 0;
let globalPlaying = false;
let globalBpm = 120;
let localPlayingId: string | undefined;
function emitTransport() {
  try {
    (window as any).__seqGlobalPlaying = globalPlaying;
    (window as any).__seqGlobalStart = globalStart;
    (window as any).__seqLocalPlayingId = localPlayingId;
    window.dispatchEvent(new CustomEvent('seq-transport', { detail: { globalPlaying, localPlayingId } }));
  } catch {}
}
// Preview debounce
let lastPreviewAt = 0;
const PREVIEW_THROTTLE_MS = 60;

function previewNote(seq: Seq, note: SequencerNote | undefined) {
  if (!note) return;
  const now = performance.now();
  if (now - lastPreviewAt < PREVIEW_THROTTLE_MS) return;
  lastPreviewAt = now;
  const part = typeof seq.part === 'number' ? seq.part : undefined;
  if (typeof part !== 'number') return;
  try { rpc.startAudio(); } catch {}
  try { rpc.noteOn(part, note.midi, Math.min(1, Math.max(0.1, note.vel || 0.7))); } catch {}
  // Schedule quick noteOff for synth previews (not for drums/sampler which are one-shots)
  if (seq.moduleKind === 'synth') {
    setTimeout(()=>{ try { rpc.noteOff(part, note.midi); } catch {} }, 180);
  }
}

export function sequencerStopAll() {
  Object.keys(seqMap).forEach(id => {
    const s = seqMap[id];
    if (s.playingGlobal || s.playingLocal) {
      const held: Set<number> = (s as any)._held || new Set<number>();
      const part = typeof s.part === 'number' ? s.part : undefined;
      if (typeof part === 'number') {
        for (const m of Array.from(held)) { try { rpc.noteOff(part, m); } catch {} }
      }
      (s as any)._held = new Set<number>();
      s.playingGlobal = false;
      s.playingLocal = false;
    }
  });
  try { (window as any).__seqGlobalPlaying = false; } catch {}
  globalPlaying = false;
  localPlayingId = undefined;
  emitTransport();
  notify();
}

// Remove sequencer state for a sound id (optionally only for a specific pattern)
export function sequencerDeleteForSound(soundId: string, patternId?: string) {
  const keys = Object.keys(seqMap);
  const suffix = `::${soundId}`;
  for (const k of keys) {
    const pat = patternFromKey(k);
    if ((patternId && pat !== (patternId || 'default')) || !k.endsWith(suffix)) continue;
    const s = seqMap[k];
    // Release any held notes
    try {
      const held: Set<number> = (s as any)._held || new Set<number>();
      const part = typeof s.part === 'number' ? s.part : undefined;
      if (typeof part === 'number') {
        for (const m of Array.from(held)) { try { rpc.noteOff(part, m); } catch {} }
      }
    } catch {}
    delete seqMap[k];
    delete versions[k];
    delete snapshots[k];
    try { if (typeof window !== 'undefined') { const w: any = window as any; if (w.__seqKeys) delete w.__seqKeys[k]; } } catch {}
    try { if (typeof window !== 'undefined') localStorage.removeItem(`seq:${k}`); } catch {}
  }
  notify();
}

// Remove all sequencer state for a given pattern id across all sounds
export function sequencerDeleteForPattern(patternId: string) {
  const keys = Object.keys(seqMap);
  for (const k of keys) {
    const pat = patternFromKey(k);
    if (pat !== (patternId || 'default')) continue;
    const s = seqMap[k];
    // Release any held notes
    try {
      const held: Set<number> = (s as any)._held || new Set<number>();
      const part = typeof s.part === 'number' ? s.part : undefined;
      if (typeof part === 'number') {
        for (const m of Array.from(held)) { try { rpc.noteOff(part, m); } catch {} }
      }
    } catch {}
    delete seqMap[k];
    delete versions[k];
    delete snapshots[k];
    try { if (typeof window !== 'undefined') { const w: any = window as any; if (w.__seqKeys) delete w.__seqKeys[k]; } } catch {}
    try { if (typeof window !== 'undefined') localStorage.removeItem(`seq:${k}`); } catch {}
  }
  notify();
}
// High-resolution step scheduler (interval based) to reduce rAF jitter
let schedId: any;
// Low-power heuristics (Raspberry Pi / few cores): relax scheduler/UI refresh a bit
const __ua = (typeof navigator !== 'undefined' && typeof navigator.userAgent === 'string') ? navigator.userAgent.toLowerCase() : '';
const __cores = (typeof navigator !== 'undefined' && (navigator as any).hardwareConcurrency) ? Number((navigator as any).hardwareConcurrency) : undefined;
const __uaLowPower = (__ua.includes('raspberry') || __ua.includes('raspbian'));
const __coreLowPower = (typeof __cores === 'number' && isFinite(__cores) && __cores > 0 && __cores <= 4);
const __isLowPower = !!(__uaLowPower || __coreLowPower);
const SCHED_INTERVAL_MS = __isLowPower ? 16 : 8; // ~62 Hz on low-power, ~125 Hz otherwise
const STEP_TOLERANCE_MS = 2; // allow slight early trigger window
const FRAC_THROTTLE_MS = __isLowPower ? 50 : 33; // UI playhead/frac updates: ~20 Hz vs ~30 Hz
// throttle per-seq frac updates to avoid excessive renders
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

function stepsPerBar(res: SequencerResolution): number {
  switch (res) {
    case '1/4': return 4;   // 4 steps per 4/4 bar
    case '1/8': return 8;   // 8 steps per bar
    case '1/16': return 16; // 16 steps per bar
    case '1/32': return 32; // 32 steps per bar
    case '1/8t': return 12; // 12 eighth-triplets per bar (3 per beat * 4)
    case '1/16t': return 24; // 24 sixteenth-triplets per bar
  }
}

// Phase-aware scheduler re-anchor: align next step to the next boundary based on current clock position
function reanchorScheduler(s: Seq) {
  const now = performance.now();
  // Match clock selection used elsewhere
  const usingGlobalClock = globalPlaying ? true : (s.mode !== 'poly');
  const bpm = usingGlobalClock ? globalBpm : (s.localBpm || 120);
  const stMs = stepTimeMs(s.resolution, bpm);
  if (!stMs || stMs <= 0 || s.length <= 0) {
    (s as any)._schedulerMode = true;
    (s as any)._lastStepIdx = -1;
    const anchor = usingGlobalClock ? globalStart : now;
    if (!usingGlobalClock) (s as any)._localStart = anchor;
    (s as any)._anchorTime = anchor;
    (s as any)._stepCounter = 0;
    (s as any)._nextStepTime = now;
    return;
  }
  const start = usingGlobalClock ? globalStart : ((s as any)._localStart || now);
  if (!usingGlobalClock && !(s as any)._localStart) (s as any)._localStart = start;
  const elapsed = Math.max(0, now - start);
  const totalMs = stMs * Math.max(1, s.length|0);
  const loopPos = elapsed % totalMs;
  const idx = Math.floor(loopPos / stMs) % Math.max(1, s.length|0);
  const lastBoundaryTime = start + Math.floor(elapsed / stMs) * stMs;
  (s as any)._schedulerMode = true;
  (s as any)._lastStepIdx = idx;
  (s as any)._anchorTime = start;
  const stepsCompleted = Math.floor(elapsed / stMs);
  (s as any)._stepCounter = stepsCompleted + 1;
  (s as any)._nextStepTime = start + (stepsCompleted + 1) * stMs;
}

// Estimate bar length of a pattern (max across its sequences, rounded up, clamped 1..8)
export function sequencerEstimatePatternBars(patternId: string): number {
  let bars = 0;
  const pid = patternId || 'default';
  Object.keys(seqMap).forEach(k => {
    if (patternFromKey(k) !== pid) return;
    const s = seqMap[k];
    const spb = stepsPerBar(s.resolution);
    if (!spb || spb <= 0) return;
    const b = Math.ceil(Math.max(1, s.length) / spb);
    if (b > bars) bars = b;
  });
  if (bars <= 0) bars = 1;
  return Math.max(1, Math.min(8, bars));
}

function tick(ts: number) {
  if (!lastT) { lastT = ts; globalStart = ts; }
  const dt = ts - lastT; lastT = ts;
  const now = ts;
  const gElapsed = now - globalStart;
  // For each sequence: decide which clock to follow
  Object.keys(seqMap).forEach(id => {
    if (patternFromKey(id) !== currentPatternId) return;
    const s = seqMap[id];
    const usingGlobalClock = globalPlaying ? true : (s.mode !== 'poly');
    const isActive = !!(s.playingLocal || s.playingGlobal);
    const bpm = usingGlobalClock ? globalBpm : (s.localBpm || 120);
    const stMs = stepTimeMs(s.resolution, bpm);
    if (!isActive) return; // paused entirely
    if (stMs <= 0 || s.length <= 0) return;
    // If scheduler mode is active, only update fractional playhead here; step edges handled by scheduler.
    if ((s as any)._schedulerMode) {
      const startTime = usingGlobalClock ? globalStart : (s as any)._localStart || globalStart;
      const elapsed = now - startTime;
      const totalMs = stMs * s.length;
      const loopPos = elapsed % totalMs;
      const frac = Math.max(0, Math.min(1, loopPos / totalMs));
      s.playheadFrac = frac;
      // throttle notify
      const nowMs = performance.now();
      const last = lastFracNotify[id] || 0;
  if (nowMs - last > FRAC_THROTTLE_MS) { lastFracNotify[id] = nowMs; touch(id); notify(); }
      return;
    }
    const elapsed = usingGlobalClock ? gElapsed : (s as any)._localStart ? (now - (s as any)._localStart) : 0;
    if (!usingGlobalClock && !(s as any)._localStart) { (s as any)._localStart = now; }
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
      // Process all crossed steps between prev and current to avoid skipping at low frame rates
      const part = typeof s.part === 'number' ? s.part : undefined;
      const stepDiff = (step - Math.max(0, prev));
      // Determine how many steps advanced considering wrap
      const advanced = prev < 0 ? 1 : ((stepDiff > 0 ? stepDiff : stepDiff + s.length) || 1);
      for (let k = 1; k <= advanced; k++) {
        const from = (prev < 0) ? step : ((Math.max(0, prev) + k - 1) % s.length);
        const to = (from + 1) % s.length;
        const curr = (s.steps[to]?.notes) || [];
        const prevNotes = (s.steps[from]?.notes) || [];
        const prevSet = new Set(prevNotes.map(n=>n.midi));
        if (s.moduleKind === 'synth') {
          const held: Set<number> = (s as any)._held || new Set<number>();
          (s as any)._held = held;
          // NoteOff for held midis not continued
          const contMidis = new Set<number>();
          for (const n of curr) { if (n.legato && prevSet.has(n.midi)) contMidis.add(n.midi); }
          if (typeof part === 'number') {
            for (const m of Array.from(held)) {
              if (!contMidis.has(m)) { try { rpc.noteOff(part, m); } catch {}; held.delete(m); }
            }
          }
          // NoteOn for current non-legato notes
          for (const n of curr) {
            const cont = n.legato && prevSet.has(n.midi);
            if (!cont && typeof part === 'number') { try { rpc.noteOn(part, n.midi, n.vel); } catch {}; held.add(n.midi); }
          }
        } else {
          // drums/sampler: trigger all notes each step
          for (const n of curr) { if (typeof part === 'number') { try { rpc.noteOn(part, n.midi, n.vel); } catch {} } }
        }
      }
      s.lastTriggered = true;
      setTimeout(() => { s.lastTriggered = false; touch(id); notify(); }, 80);
      touch(id);
      notify();
    } else {
      // Throttle frac-only updates to ~30 Hz
      const nowMs = performance.now();
      const last = lastFracNotify[id] || 0;
  if (nowMs - last > FRAC_THROTTLE_MS) {
        lastFracNotify[id] = nowMs;
        touch(id);
        notify();
      }
    }
  });
  rafId = requestAnimationFrame(tick);
}
if (typeof window !== 'undefined') rafId = requestAnimationFrame(tick);

// Step scheduler interval
function scheduleSteps() {
  const now = performance.now();
  Object.keys(seqMap).forEach(id => {
    if (patternFromKey(id) !== currentPatternId) return;
    if (!isIdAllowed(id)) return;
    const s = seqMap[id];
    if (!(s.playingLocal || s.playingGlobal)) return;
  const usingGlobalClock = globalPlaying ? true : (s.mode !== 'poly');
  const bpm = usingGlobalClock ? globalBpm : (s.localBpm || 120);
    const stMs = stepTimeMs(s.resolution, bpm);
    if (!stMs || stMs <= 0 || s.length <= 0) return;
    if (!(s as any)._schedulerMode) return; // only for scheduler-enabled sequences
    if ((s as any)._nextStepTime == null) {
      const anchor = usingGlobalClock ? globalStart : (s as any)._localStart || now;
      (s as any)._anchorTime = anchor;
      (s as any)._nextStepTime = now;
      (s as any)._lastStepIdx = -1;
      (s as any)._stepCounter = Math.max(0, Math.floor((now - anchor) / stMs));
    }
    // Process all steps whose scheduled time has arrived
    let checkNow = now;
    while (((s as any)._nextStepTime - STEP_TOLERANCE_MS) <= checkNow) {
      const scheduledTime = (s as any)._nextStepTime;
      const prevIdx = (s as any)._lastStepIdx;
      const nextIdx = ((prevIdx + 1) % s.length + s.length) % s.length;
      triggerStepEdge(s, id, prevIdx, nextIdx);
      (s as any)._lastStepIdx = nextIdx;
      s.playheadStep = nextIdx;
      (s as any)._lastStepTime = scheduledTime;
      const anchor = (s as any)._anchorTime ?? (usingGlobalClock ? globalStart : (s as any)._localStart || scheduledTime);
      const stepCounter = ((s as any)._stepCounter ?? 0) + 1;
      (s as any)._stepCounter = stepCounter;
      (s as any)._nextStepTime = anchor + stepCounter * stMs;
      // Update playheadFrac immediately after step for snappy UI
  const loopElapsed = ((s as any)._lastStepTime - (usingGlobalClock ? globalStart : (s as any)._localStart || globalStart));
      const totalMs = stMs * s.length;
      s.playheadFrac = Math.max(0, Math.min(1, (loopElapsed % totalMs) / totalMs));
      touch(id); notify();
      // Emit a global step event for arrangement tracking
      try {
        const pid = patternFromKey(id);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('seq-pattern-step', { detail: { patternId: pid, step: nextIdx, length: s.length } }));
        }
      } catch {}
      const after = performance.now();
      checkNow = after;
      const lateness = after - scheduledTime;
      if (lateness > stMs * 0.6) {
        // If we were significantly late triggering this step, push the next boundary forward to avoid rapid catch-up bursts.
        const anchorReset = usingGlobalClock ? globalStart : (s as any)._localStart || after;
        (s as any)._anchorTime = anchorReset;
        (s as any)._stepCounter = Math.max(0, Math.floor((after - anchorReset) / stMs));
        (s as any)._nextStepTime = anchorReset + ((s as any)._stepCounter + 1) * stMs;
        break;
      }
      if (((s as any)._nextStepTime - checkNow) > stMs * 4) break; // safety
    }
  });
}
if (typeof window !== 'undefined') {
  schedId = setInterval(scheduleSteps, SCHED_INTERVAL_MS);
}

function triggerStepEdge(s: Seq, id: string, prev: number, step: number) {
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
        if (!contMidis.has(m)) { try { rpc.noteOff(part, m); } catch {}; held.delete(m); }
      }
    }
    // NoteOn for current non-legato notes
    for (const n of curr) {
      const cont = n.legato && prevSet.has(n.midi);
      if (!cont && typeof part === 'number') { try { rpc.noteOn(part, n.midi, n.vel); } catch {}; held.add(n.midi); }
    }
  } else {
    // drums/sampler: trigger all notes each step
    for (const n of curr) { if (typeof part === 'number') { try { rpc.noteOn(part, n.midi, n.vel); } catch {} } }
  }
  s.lastTriggered = true;
  setTimeout(() => { s.lastTriggered = false; touch(id); notify(); }, 80);
}

function snapResolutionFromNorm(v: number): SequencerResolution {
  const items: SequencerResolution[] = ['1/4','1/8','1/16','1/32','1/8t','1/16t'];
  const idx = Math.max(0, Math.min(items.length - 1, Math.round(v * (items.length - 1))));
  return items[idx];
}

export function useSequencer(soundId: string) {
  useEffect(() => { get(soundId); }, [soundId, currentPatternId]);
  const subscribe = (cb: () => void) => { listeners.add(cb); return () => listeners.delete(cb); };
  // Versioned snapshot: new identity only when set() mutates state
  const getSnapshot = () => {
    const k = keyFor(soundId);
    const v = versions[k] || 0;
    const cached = snapshots[k];
    if (cached && cached.__v === v) return cached;
    const snap = { ...get(k), __v: v } as any;
    snapshots[k] = snap;
    return snap;
  };
  const s = useSyncExternalStore(subscribe, getSnapshot);

  const api = {
    ...s,
  setPart: (p: number) => set(soundId, { part: Math.max(0, Math.min(5, Math.floor(p))) }),
  setModuleKind: (k: 'synth'|'sampler'|'drum') => set(soundId, { moduleKind: k }),
  setGlobalBpm: (bpm: number) => { globalBpm = Math.max(20, Math.min(240, Math.round(bpm))); },
    setStepIndex: (i: number) => {
      const st = get(soundId);
      const idx = Math.max(0, Math.min(st.length - 1, Math.round(i)));
      if (st.isSelecting) {
        set(soundId, { stepIndex: idx, selectionEndStep: idx });
      } else {
        set(soundId, { stepIndex: idx });
      }
    },
    setNoteIndex: (i: number) => set(soundId, { noteIndex: Math.max(0, Math.min(((get(soundId).steps[get(soundId).stepIndex]?.notes.length)||1) - 1, Math.round(i))) }),
    // Selection workflow
    beginSelection: () => {
      const st = get(soundId);
      const idx = Math.max(0, Math.min(st.length - 1, st.stepIndex|0));
      set(soundId, { isSelecting: true, selectionStartStep: idx, selectionEndStep: idx });
    },
    endSelection: () => {
      // Clear selection markers on release of Space
      set(soundId, { isSelecting: false, selectionStartStep: null, selectionEndStep: null });
    },
    copySelection: () => {
      const st = get(soundId);
      const a = st.selectionStartStep;
      const b = st.selectionEndStep;
      if (a == null || b == null) return;
      const lo = Math.max(0, Math.min(st.length - 1, Math.min(a, b)));
      const hi = Math.max(0, Math.min(st.length - 1, Math.max(a, b)));
      const out: SequencerStep[] = [];
      for (let i = lo; i <= hi; i++) {
        const src = st.steps[i] || { time: i, notes: [] };
        const notes = (src.notes || []).map(n => ({ midi: n.midi, vel: n.vel, legato: !!n.legato }));
        out.push({ time: out.length, notes });
      }
      set(soundId, { copyBuffer: out });
    },
    pasteAt: (targetIndex: number) => {
      const st = get(soundId);
      const buf = (st.copyBuffer || []) as SequencerStep[];
      if (!buf || buf.length === 0) return;
      // Prepare steps up to current length
      const steps = st.steps.slice();
      for (let i = 0; i < st.length; i++) { if (!steps[i]) steps[i] = { time: i, notes: [] }; }
      const t = Math.max(0, Math.min(st.length - 1, Math.round(targetIndex)));
      const writeCount = Math.max(0, Math.min(buf.length, st.length - t));
      for (let k = 0; k < writeCount; k++) {
        const src = buf[k];
        steps[t + k] = {
          time: t + k,
          notes: (src.notes || []).map(n => ({ midi: n.midi, vel: n.vel, legato: !!n.legato })),
        };
      }
      const normalized = steps.slice(0, st.length).map((s, i) => ({ time: i, notes: (s?.notes || []) }));
      const newStepIdx = Math.max(0, Math.min(st.length - 1, t + Math.max(0, writeCount - 1)));
      set(soundId, { steps: normalized, stepIndex: newStepIdx });
    },
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
      // Preview newly added note
      previewNote(st, notes[notes.length-1]);
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
      previewNote(st, notes[0]);
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
      const prev = notes[ni];
      notes[ni] = n;
      steps[idx] = { ...steps[idx], notes };
      set(soundId, { steps });
      // If pitch changed, preview
      if (!prev || prev.midi !== n.midi) previewNote(st, n);
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
      // If playing, re-anchor scheduler so tempo/resolution change takes effect immediately and consistently
      const st = get(soundId);
      const isPlaying = !!(st.playingLocal || st.playingGlobal);
      if (isPlaying) { reanchorScheduler(st); }
    },
    setLength: (n: number) => {
      const len = Math.max(1, Math.min(64, Math.round(n)));
      set(soundId, { length: len });
      // If playing, re-anchor scheduler to avoid drift with new loop length
      const st = get(soundId);
      const isPlaying = !!(st.playingLocal || st.playingGlobal);
      if (isPlaying) { reanchorScheduler(st); }
    },
    setMode: (m: 'tempo' | 'poly') => {
      const st = get(soundId);
      // Apply mode
      set(soundId, { mode: m });
      // If currently playing, reset scheduler anchors so timing changes apply immediately
      const isPlaying = !!(st.playingLocal || st.playingGlobal);
      if (!isPlaying) return;
      const now = performance.now();
      if (m === 'poly') {
        // Switch to local tempo: ensure local start and next step times are based on local clock
        (st as any)._localStart = now;
        (st as any)._schedulerMode = true;
        (st as any)._anchorTime = now;
        (st as any)._stepCounter = 0;
        (st as any)._nextStepTime = now;
        (st as any)._lastStepIdx = -1;
      } else {
        // Switch to tempo mode: follow global if available, else keep local running
        const followGlobal = globalPlaying;
        (st as any)._schedulerMode = true;
        (st as any)._lastStepIdx = -1;
        const anchor = followGlobal ? globalStart : now;
        (st as any)._anchorTime = anchor;
        (st as any)._stepCounter = 0;
        (st as any)._nextStepTime = anchor;
        if (!followGlobal) { (st as any)._localStart = now; }
      }
    },
    setLocalBpm: (bpm: number) => {
      const clamped = Math.max(20, Math.min(240, Math.round(bpm)));
      set(soundId, { localBpm: clamped });
      const st = get(soundId);
      // If locally clocked (not following global), re-anchor so the new BPM applies without stutter/drift
      const isPlaying = !!(st.playingLocal || st.playingGlobal);
      const usingGlobalClock = globalPlaying ? true : (st.mode !== 'poly');
      if (isPlaying && !usingGlobalClock) { reanchorScheduler(st); }
    },
  // UI state
  setMenuOpen: (open: boolean) => set(soundId, { uiMenuOpen: !!open }),
  toggleMenuOpen: () => set(soundId, { uiMenuOpen: !get(soundId).uiMenuOpen }),
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
  // Ensure a valid part routing; default to 0 if unset
  if (typeof cur.part !== 'number') cur.part = 0;
  // Warm up audio engine
  try { rpc.startAudio(); } catch {}
  // Start this local
  const start = performance.now();
  (cur as any)._localStart = start;
  cur.playheadFrac = 0; cur.playheadStep = -1; cur.lastTriggered = false;
  (cur as any)._schedulerMode = true;
  (cur as any)._anchorTime = start;
  (cur as any)._stepCounter = 0;
  (cur as any)._nextStepTime = start; (cur as any)._lastStepIdx = -1;
      } else {
        // release any held notes for this local
        const held: Set<number> = (cur as any)._held || new Set<number>();
        const part = typeof cur.part === 'number' ? cur.part : undefined;
        if (typeof part === 'number') { for (const m of Array.from(held)) { try { rpc.noteOff(part, m); } catch {} } }
        (cur as any)._held = new Set<number>();
      }
  set(soundId, { playingLocal: next });
  // Mirror local transport id and emit event
  localPlayingId = next ? (soundId.includes('::') ? soundId.split('::')[1] : soundId) : undefined;
  emitTransport();
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
  // Warm up audio engine to avoid first-note drop
  try { rpc.startAudio(); } catch {}
        // Start global
  globalPlaying = true;
  globalStart = performance.now();
  localPlayingId = undefined;
  emitTransport();
        Object.keys(seqMap).forEach(id => {
          if (patternFromKey(id) !== currentPatternId) return;
          if (!isIdAllowed(id)) return;
          const s = get(id);
          if (typeof s.part !== 'number') s.part = 0;
          s.playheadFrac = 0; s.playheadStep = -1; s.lastTriggered = false;
          (s as any)._schedulerMode = true;
          if (s.mode !== 'poly') {
            // tempo mode: follow global clock
            (s as any)._localStart = globalStart;
          } else {
            // poly mode: start in sync with global press, then run at local tempo
            (s as any)._localStart = globalStart;
          }
          const anchor = s.mode !== 'poly' ? globalStart : (s as any)._localStart;
          (s as any)._anchorTime = anchor;
          (s as any)._stepCounter = 0;
          (s as any)._nextStepTime = anchor;
          (s as any)._lastStepIdx = -1;
          set(id, { playingGlobal: true });
        });
      } else {
        // Stop global and release held notes
  globalPlaying = false;
  emitTransport();
        Object.keys(seqMap).forEach(id => {
          if (patternFromKey(id) !== currentPatternId) return;
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
  beginSelection(): void;
  endSelection(): void;
  copySelection(): void;
  pasteAt(targetIndex: number): void;
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

// Hook: summary of all sequences in the current pattern (read-only ghosts)
export function usePatternGhosts(): PatternSeqGhost[] {
  const subscribe = (cb: () => void) => { listeners.add(cb); return () => listeners.delete(cb); };
  const getSnapshot = () => {
    const pid = currentPatternId || 'default';
    // Build composite version string from per-seq versions for this pattern
    const keys = Object.keys(seqMap).filter(k => patternFromKey(k) === pid);
    keys.sort();
    const verStr = keys.map(k => `${k}:${versions[k] || 0}`).join('|');
    const prevV = patternGhostVersions[pid];
    const cached = patternGhostSnapshots[pid];
    if (cached && prevV === verStr) return cached as PatternSeqGhost[];
    // Recompute snapshot only when composite version changed
    const out: PatternSeqGhost[] = [];
    // For consistent UI order, sort by soundId label order
    keys.sort((a, b) => (soundFromKey(a)).localeCompare(soundFromKey(b)));
    for (const k of keys) {
      const s = get(k);
      const len = Math.max(1, s.length | 0);
      const has: boolean[] = new Array(len);
      for (let i = 0; i < len; i++) {
        const st = s.steps[i];
        has[i] = !!(st && Array.isArray(st.notes) && st.notes.length > 0);
      }
      out.push({ soundId: soundFromKey(k), length: len, has });
    }
    const snap = out as any;
    patternGhostVersions[pid] = verStr;
    patternGhostSnapshots[pid] = snap;
    return snap as PatternSeqGhost[];
  };
  // Reuse the same external store used by per-sound sequencers to update when any sequence changes
  const ghosts = useSyncExternalStore(subscribe, getSnapshot);
  return ghosts as PatternSeqGhost[];
}

// External helper: ensure a sequencer entry has correct part & moduleKind without mounting UI
export function sequencerSetPart(soundId: string, part: number, kind?: 'synth'|'sampler'|'drum') {
  const s = get(soundId);
  s.part = Math.max(0, Math.min(5, Math.floor(part)));
  if (kind) s.moduleKind = kind;
  // If global is currently playing, auto-enlist this sequence so user doesn't need to scroll/mount UI first.
  if ((s as any).playingGlobal !== true && (typeof (globalThis as any).requestAnimationFrame !== 'undefined')) {
    // Access internal globalPlaying flag via closure by scheduling a no-op tick read; simpler approach: mirror flag on window.
    // We maintain a mirrored flag on window for cross-module visibility.
    try {
      const gp = (window as any).__seqGlobalPlaying;
      if (gp) {
        // Only auto-enlist if allowed for current pattern
        const k = soundId.includes('::') ? soundId : keyFor(soundId);
        if (isIdAllowed(k)) {
          s.playheadFrac = 0; s.playheadStep = -1; s.lastTriggered = false;
          (s as any)._schedulerMode = true;
          const start = (window as any).__seqGlobalStart || performance.now();
          (s as any)._anchorTime = start;
          (s as any)._stepCounter = 0;
          (s as any)._nextStepTime = start; (s as any)._lastStepIdx = -1;
          s.playingGlobal = true;
        }
      }
    } catch {}
  }
}

// External helper: toggle local playback for a specific sound without using the hook
export function sequencerToggleLocalFor(soundId: string) {
  const cur = get(soundId);
  const next = !cur.playingLocal;
  if (next) {
    // Stop global if running
    if (globalPlaying) {
      globalPlaying = false;
      try { (window as any).__seqGlobalPlaying = false; } catch {}
      Object.keys(seqMap).forEach(id => {
        const s = get(id);
        const held: Set<number> = (s as any)._held || new Set<number>();
        const part = typeof s.part === 'number' ? s.part : undefined;
        if (typeof part === 'number') { for (const m of Array.from(held)) { try { rpc.noteOff(part, m); } catch {} } }
        (s as any)._held = new Set<number>();
        if (s.playingGlobal) set(id, { playingGlobal: false });
      });
    }
    // Stop other locals
    Object.keys(seqMap).forEach(id => {
      if (id === keyFor(soundId) || id === soundId) return;
      const s = get(id);
      if (s.playingLocal) {
        const held: Set<number> = (s as any)._held || new Set<number>();
        const part = typeof s.part === 'number' ? s.part : undefined;
        if (typeof part === 'number') { for (const m of Array.from(held)) { try { rpc.noteOff(part, m); } catch {} } }
        (s as any)._held = new Set<number>();
        set(id, { playingLocal: false });
      }
    });
    // Ensure routing
    if (typeof cur.part !== 'number') cur.part = 0;
    try { rpc.startAudio(); } catch {}
    const start = performance.now();
    (cur as any)._localStart = start;
    cur.playheadFrac = 0; cur.playheadStep = -1; cur.lastTriggered = false;
    (cur as any)._schedulerMode = true;
  (cur as any)._anchorTime = start;
  (cur as any)._stepCounter = 0;
  (cur as any)._nextStepTime = start; (cur as any)._lastStepIdx = -1;
  } else {
    // Release held notes for this local
    const held: Set<number> = (cur as any)._held || new Set<number>();
    const part = typeof cur.part === 'number' ? cur.part : undefined;
    if (typeof part === 'number') { for (const m of Array.from(held)) { try { rpc.noteOff(part, m); } catch {} } }
    (cur as any)._held = new Set<number>();
  }
  set(soundId, { playingLocal: next });
  localPlayingId = next ? (soundId.includes('::') ? soundId.split('::')[1] : soundId) : undefined;
  emitTransport();
}

// External helper: toggle global transport without a hook
export function sequencerToggleGlobalPlay() {
  const wantStart = !globalPlaying;
  if (wantStart) {
    // Stop all locals first
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
    // Warm up audio engine
    try { rpc.startAudio(); } catch {}
    globalPlaying = true;
    globalStart = performance.now();
    localPlayingId = undefined;
    emitTransport();
    Object.keys(seqMap).forEach(id => {
      if (patternFromKey(id) !== currentPatternId) return;
      if (!isIdAllowed(id)) return;
      const s = get(id);
      if (typeof s.part !== 'number') s.part = 0;
      s.playheadFrac = 0; s.playheadStep = -1; s.lastTriggered = false;
      (s as any)._schedulerMode = true;
      if (s.mode !== 'poly') {
        (s as any)._localStart = globalStart;
      } else {
        (s as any)._localStart = globalStart;
      }
      const anchor = s.mode !== 'poly' ? globalStart : (s as any)._localStart;
      (s as any)._anchorTime = anchor;
      (s as any)._stepCounter = 0;
      (s as any)._nextStepTime = anchor;
      (s as any)._lastStepIdx = -1;
      set(id, { playingGlobal: true });
    });
  } else {
    // Stop global
    globalPlaying = false;
    emitTransport();
    Object.keys(seqMap).forEach(id => {
      if (patternFromKey(id) !== currentPatternId) return;
      const s = get(id);
      const held: Set<number> = (s as any)._held || new Set<number>();
      const part = typeof s.part === 'number' ? s.part : undefined;
      if (typeof part === 'number') { for (const m of Array.from(held)) { try { rpc.noteOff(part, m); } catch {} } }
      (s as any)._held = new Set<number>();
      set(id, { playingGlobal: false });
    });
  }
}

// External helper: stop any currently playing local
export function sequencerStopLocalPlaying() {
  if (!localPlayingId) return;
  const sid = localPlayingId;
  try {
    const sids = Object.keys(seqMap).filter(k => k.endsWith(`::${sid}`) || k === sid);
    for (const k of sids) {
      const s = get(k);
      if (s.playingLocal) {
        const held: Set<number> = (s as any)._held || new Set<number>();
        const part = typeof s.part === 'number' ? s.part : undefined;
        if (typeof part === 'number') { for (const m of Array.from(held)) { try { rpc.noteOff(part, m); } catch {} } }
        (s as any)._held = new Set<number>();
        set(k, { playingLocal: false });
      }
    }
  } finally {
    localPlayingId = undefined;
    emitTransport();
  }
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
