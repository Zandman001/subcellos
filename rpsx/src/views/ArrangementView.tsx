import React, { useEffect, useMemo, useRef, useState } from 'react'
import { sequencerSetCurrentPattern, useSequencer } from '../store/sequencer'
import { useBrowser, useBrowserStore } from '../store/browser'
import { fsClient } from '../fsClient'
import { useFourKnobHotkeys } from '../hooks/useFourKnobHotkeys'

type ArrItem = { id: string; label: string; len: number };

export default function ArrangementView() {
  const s = useBrowser() as any;
  const project = s.projectName as string | undefined;
  const selectedSoundId: string = s?.selectedSoundId || '__none__';
  const seq = useSequencer(selectedSoundId);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 800, h: 260 });
  const [allPatterns, setAllPatterns] = useState<string[]>([]);
  const [arr, setArr] = useState<ArrItem[]>([]);
  const [sel, setSel] = useState(0);
  const [offset, setOffset] = useState(0);
  // no selection animation
  // Center is always the middle of the right pane; no overrides

  // load patterns for current project on mount/when project changes
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!project) { setAllPatterns([]); setArr([]); return; }
      try {
        const list = await fsClient.listPatterns(project);
        if (!alive) return;
        setAllPatterns(list);
        // Try restore from localStorage first
        const key = `arrangement::${project}`;
        let restored: { items?: { id: string; len: number }[]; order?: string[]; lengths?: Record<string, number> } | undefined;
        try { const raw = localStorage.getItem(key); if (raw) restored = JSON.parse(raw); } catch {}
        let items: ArrItem[] = [];
        if (Array.isArray(restored?.items)) {
          items = restored!.items!
            .filter(it => typeof it?.id === 'string' && list.includes(it.id))
            .map(it => ({ id: it.id, label: it.id, len: Math.max(1, Math.min(8, Math.round(it.len || 1))) }));
        } else if (Array.isArray(restored?.order)) {
          const lens = restored?.lengths || {};
          items = restored!.order!
            .filter(n => list.includes(n))
            .map(n => ({ id: n, label: n, len: Math.max(1, Math.min(8, Math.round((lens as any)[n] || 1))) }));
        } else {
          items = list.map(n => ({ id: n, label: n, len: 1 }));
        }
        setArr(items);
        setSel(0);

      } catch (e) {
        console.error('listPatterns failed', e);
      }
    })();
    return () => { alive = false; };
  }, [project]);

  // Persist on change
  useEffect(() => {
    if (!project) return;
    try {
      const key = `arrangement::${project}`;
      const data = { items: arr.map(a=>({ id: a.id, len: a.len })) };
      localStorage.setItem(key, JSON.stringify(data));
    } catch {}
  }, [project, arr]);

  // measure container
  useEffect(() => {
    const el = containerRef.current; if (!el) return;
    const ro = new ResizeObserver(entries => {
      for (const e of entries) { const cr = e.contentRect; setSize({ w: Math.max(300, cr.width), h: Math.max(140, cr.height) }); }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Arrangement playback state
  const [isArrPlaying, setArrPlaying] = useState(false);
  const [arrPlayIdx, setArrPlayIdx] = useState<number>(sel);
  const lastStepRef = useRef<number>(-1);

  // Listen for global play transport events
  useEffect(() => {
    const onTransport = (e: any) => {
      const playing = !!(e?.detail?.globalPlaying);
      if (playing && arr.length > 0) {
        // Start arrangement playback from selected pattern
        setArrPlaying(true);
        setArrPlayIdx(sel);
        sequencerSetCurrentPattern(arr[sel]?.id);
      } else {
        setArrPlaying(false);
        lastStepRef.current = -1;
      }
    };
    window.addEventListener('seq-transport', onTransport);
    return () => window.removeEventListener('seq-transport', onTransport);
  }, [arr, sel]);

  // Listen for step completion via sequencer hook and advance pattern
  useEffect(() => {
    if (!isArrPlaying || arr.length === 0) return;
    if (!seq || !seq.playingGlobal) return;
    // Ensure we're tracking the active arrangement pattern
    const activePid = arr[arrPlayIdx]?.id;
    // If currentPattern changed elsewhere, ignore until transport handler re-syncs
    // Detect last-step edge
    const step = Number(seq.playheadStep);
    const len = Math.max(1, Number(seq.length || 0));
    if (!Number.isFinite(step) || !Number.isFinite(len)) return;
    if (step !== lastStepRef.current) {
      lastStepRef.current = step;
      if (step === len - 1) {
        let nextIdx = arrPlayIdx + 1;
        if (nextIdx >= arr.length) nextIdx = 0;
        setArrPlayIdx(nextIdx);
        sequencerSetCurrentPattern(arr[nextIdx]?.id);
      }
    }
  }, [isArrPlaying, seq.playingGlobal, seq.playheadStep, seq.length, arrPlayIdx, arr]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const curView = (useBrowserStore.getState() as any).currentView;
      if (curView !== 'Arrangement') return;
      const k = (e.key || '').toLowerCase();
      if (['w','r','q','a'].includes(k)) e.preventDefault();
      if (k === 'w') moveSel(-1);
      else if (k === 'r') moveSel(1);
      else if (k === 'q') insertFromBrowser();
      else if (k === 'a') removeSelected();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [arr, sel]);

  // no animation cleanup needed

  // Encoders via hotkeys: 5/6 (scroll), T/Y (big scroll), G/H (length), B/N (swap id)
  useFourKnobHotkeys({
    active: s.currentView === 'Arrangement',
    dec1: () => setOffset(o => o - 0.2),
    inc1: () => setOffset(o => o + 0.2),
    dec2: () => setOffset(o => o - 3),
    inc2: () => setOffset(o => o + 3),
    dec3: () => adjustLength(-1),
    inc3: () => adjustLength(1),
    dec4: () => swapPattern(-1),
    inc4: () => swapPattern(1),
  });

  function moveSel(d: number) {
    setSel(i => {
      const n = arr.length; if (n === 0) return 0;
      const ni = (i + d + n) % n;
      return ni;
    });
    // Always keep selection centered on the arc
    setOffset(0);
    // If arrangement is playing, update play index and pattern
    if (isArrPlaying && arr.length > 0) {
      // Try to find the next arrangement entry that has sequences
      let hop = d;
      let tries = 0;
      let nextIdx = sel;
      const win = window as any;
      while (tries < arr.length) {
        nextIdx = (nextIdx + hop + arr.length) % arr.length;
        const pid = arr[nextIdx]?.id;
        const hasSeq = Object.keys((win && win.__seqKeys) || {}).some((k: string) => (k||'').startsWith(`${pid}::`));
        if (hasSeq) break;
        tries++;
      }
      setArrPlayIdx(nextIdx);
      sequencerSetCurrentPattern(arr[nextIdx]?.id);
    }
  }
  function removeSelected() {
    setArr(cur => {
      if (cur.length === 0) return cur;
      const n = [...cur];
      n.splice(sel, 1);
      const nextSel = Math.max(0, Math.min(sel, n.length - 1));
      setSel(nextSel);
      return n;
    });
    // Keep center on current selection after removal
    setOffset(0);
  }
  function insertFromBrowser() {
    try {
      const st = useBrowserStore.getState() as any;
      if (st.level !== 'patterns') return; // only when browser shows patterns list
      const name = st.items?.[st.selected];
      if (typeof name !== 'string' || !name) return;
      setArr(cur => {
        const n = [...cur];
  // Insert AFTER the currently selected item
  const idx = Math.max(0, Math.min(sel + 1, n.length));
  n.splice(idx, 0, { id: name, label: name, len: 1 });
  // Move selection to the newly inserted instance
  setSel(idx);
        return n;
      });
      // Newly inserted should appear centered
      setOffset(0);
    } catch {}
  }
  function adjustLength(d: number) {
    const item = arr[sel]; if (!item) return;
    setArr(cur => {
      const n = [...cur];
      const it = { ...n[sel] };
      it.len = Math.max(1, Math.min(8, (it.len ?? 1) + d));
      n[sel] = it;
      return n;
    });
  }
  function swapPattern(d: number) {
    const item = arr[sel]; if (!item) return;
    if (allPatterns.length === 0) return;
    const idx = Math.max(0, allPatterns.indexOf(item.id));
    const next = allPatterns[(idx + d + allPatterns.length) % allPatterns.length];
    setArr(cur => {
      const n = [...cur]; n[sel] = { id: next, label: next, len: (cur[sel]?.len ?? 1) }; return n;
    });
  }

  // Geometry helpers (bottom semicircle arc spanning the width)
  const geom = useMemo(() => {
    // Visual paddings and clearances
    const cometPad = 12;         // comet marker above selection
    const labelPad = 10;         // label text inside oval
    const ovalRy = 16;           // vertical radius of item oval (fixed in render)
    const topClear = 8 + ovalRy + cometPad + labelPad; // clearance from top for arc apex
    const bottomClear = 28;      // keep space for bottom help text

    // Estimate max horizontal radius of any item (rx) to avoid clipping near the sides
    const maxBars = Math.max(1, ...arr.map(it => Math.max(1, Math.min(8, (it.len ?? 1)))));
    const rxMax = 16 + (maxBars - 1) * 6; // matches render logic
    const sidePad = 8 + rxMax;            // ensure longest oval doesn't clip at ends

    const cx = Math.floor(size.w / 2);
    const cy = Math.max(topClear + 40, Math.floor(size.h - bottomClear)); // baseline (diameter line) near bottom

    // Radius limited by width and height
    const rByWidth = Math.max(40, (size.w - 2 * sidePad) / 2);
    const rByHeight = Math.max(40, cy - topClear);
    const r = Math.floor(Math.max(40, Math.min(rByWidth, rByHeight)));

    return { r, cx, cy, sidePad };
  }, [size, arr]);

  // Positions along the bottom semicircle arc (left -> right), equally spaced
  const itemsWithPos = useMemo(() => {
    const STEP = Math.PI / 9; // constant spacing (~20°) between items, independent of count
    const THETA_CENTER = 1.5 * Math.PI;
    const THETA_MIN = Math.PI;
    const THETA_MAX = 2 * Math.PI;

    const list = arr.map((it, i) => {
      // offset is fractional item scroll; selected index is centered at offset=0
      const theta = THETA_CENTER + (i - sel - offset) * STEP;
      if (!(theta >= THETA_MIN && theta <= THETA_MAX)) return null; // off-screen; don't render
      const x = geom.cx + geom.r * Math.cos(theta);
      const y = geom.cy + geom.r * Math.sin(theta);
      const tangentDeg = 180 - (theta * 180 / Math.PI);
      return { ...it, theta, x, y, tangentDeg, i } as any;
    }).filter(Boolean) as any[];

    // Keep stable order for React keys (already unique by id+i)
    return list;
  }, [arr, offset, sel, geom]);

  return (
    <div ref={containerRef} className="view-container" style={{ position:'relative', overflow:'hidden' }}>
      {!project && (
        <div className="pixel-text" style={{ padding: 8, color:'var(--text-soft)' }}>Open a project to arrange patterns.</div>
      )}
  <svg width={size.w} height={size.h} style={{ display:'block' }}>
        {/* baseline bottom semicircle arc spanning side to side */}
        {geom.r > 0 && (
          <path
            d={`M ${geom.cx - geom.r} ${geom.cy} A ${geom.r} ${geom.r} 0 0 0 ${geom.cx + geom.r} ${geom.cy}`}
            fill="none"
            stroke="var(--line)"
            strokeWidth={1}
          />
        )}
        {itemsWithPos.map((it: any) => {
          const isSel = it.i === sel;
          const bars = Math.max(1, Math.min(8, (arr[it.i]?.len ?? 1)));
          const rx = 16 + (bars - 1) * 6;
          const ry = 16;
          const disp = formatPatternLabel(it.id);
          return (
            <g key={it.id + ':' + it.i} style={{ transition:'transform 160ms linear' }}>
              <g transform={`translate(${it.x},${it.y})`}>
                {/* Rotated group for oval + label */}
                <g transform={`rotate(${it.tangentDeg})`}>
                  <ellipse cx={0} cy={0} rx={rx} ry={ry} fill="transparent" stroke={isSel ? 'var(--text)' : 'var(--line)'} strokeWidth={isSel ? 2 : 1} />
                  <text x={0} y={4} textAnchor="middle" fontSize={10} fill={isSel ? 'var(--text)' : 'var(--text-soft)'} className="pixel-text">{disp}</text>
                </g>
                {/* Unrotated selection dot directly above the oval in screen space */}
                {isSel && (
                  <g transform={`translate(0,${-ry - 10})`}>
                    <circle r={3} fill="var(--text)" />
                  </g>
                )}
              </g>
            </g>
          );
        })}
      </svg>
      <div className="pixel-text" style={{ position:'absolute', bottom:4, left:8, fontSize:10, color:'var(--text-soft)' }}>
        W/R move · Q insert from patterns · A remove · 5/6 scroll · T/Y jump · G/H length · B/N swap
      </div>
    </div>
  )
}

function formatPatternLabel(name: string): string {
  const m = name.match(/(\d+)/);
  const n = m ? parseInt(m[1], 10) : 1;
  return `P${String(Math.max(0, n)).padStart(2, '0')}`;
}

