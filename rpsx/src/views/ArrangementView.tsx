import React, { useEffect, useMemo, useRef, useState } from 'react'
import { sequencerSetCurrentPattern, useSequencer, sequencerEstimatePatternBars } from '../store/sequencer'
import { useBrowser, useBrowserStore } from '../store/browser'
import { fsClient } from '../fsClient'
import { useFourKnobHotkeys } from '../hooks/useFourKnobHotkeys'
import Knob from '../components/synth/Knob'

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
  // Selection & clipboard for arrangement
  const [isSelecting, setIsSelecting] = useState(false);
  const [selStart, setSelStart] = useState<number | null>(null);
  const [selEnd, setSelEnd] = useState<number | null>(null);
  const [copyBuf, setCopyBuf] = useState<ArrItem[] | null>(null);
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
        // Try restore from Tauri first, fallback to localStorage
        let restored: { items?: { id: string; len: number }[]; order?: string[]; lengths?: Record<string, number> } | undefined;
        try { const a = await fsClient.readArrangement(project); restored = a as any; } catch {}
        if (!restored || !Array.isArray((restored as any).items)) {
          try { const raw = localStorage.getItem(`arrangement::${project}`); if (raw) restored = JSON.parse(raw); } catch {}
        }
        let items: ArrItem[] = [];
        if (Array.isArray(restored?.items)) {
          items = restored!.items!
            .filter(it => typeof it?.id === 'string' && list.includes(it.id))
            .map(it => {
              const est = sequencerEstimatePatternBars(it.id);
              const fallback = est || 1;
              return ({ id: it.id, label: it.id, len: Math.max(1, Math.min(8, Math.round(it.len || fallback))) });
            });
        } else if (Array.isArray(restored?.order)) {
          const lens = restored?.lengths || {};
          items = restored!.order!
            .filter(n => list.includes(n))
            .map(n => {
              const est = sequencerEstimatePatternBars(n);
              const fallback = est || 1;
              return ({ id: n, label: n, len: Math.max(1, Math.min(8, Math.round((lens as any)[n] || fallback))) });
            });
        } else {
          items = list.map(n => ({ id: n, label: n, len: sequencerEstimatePatternBars(n) || 1 }));
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
      const data = { items: arr.map(a=>({ id: a.id, len: a.len })) } as any;
      // Write to Tauri if possible
      fsClient.writeArrangement(project, data).catch(()=>{
        // fallback to localStorage when not in Tauri
        try { localStorage.setItem(`arrangement::${project}`, JSON.stringify(data)); } catch {}
      });
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
  const barsRemainingRef = useRef<number>(1);
  const queuedNextIdxRef = useRef<number | null>(null);

  // Listen for global play transport events
  useEffect(() => {
    const onTransport = (e: any) => {
      const playing = !!(e?.detail?.globalPlaying);
      if (playing && arr.length > 0) {
        // Start arrangement playback from selected pattern
        setArrPlaying(true);
        setArrPlayIdx(sel);
        barsRemainingRef.current = Math.max(1, arr[sel]?.len || 1);
        sequencerSetCurrentPattern(arr[sel]?.id);
        queuedNextIdxRef.current = null;
      } else {
        setArrPlaying(false);
        lastStepRef.current = -1;
        barsRemainingRef.current = 1;
        queuedNextIdxRef.current = null;
      }
    };
    window.addEventListener('seq-transport', onTransport);
    return () => window.removeEventListener('seq-transport', onTransport);
  }, [arr, sel]);

  // Expose arrangement context to FooterHints (live values)
  useEffect(() => {
    try {
      const bars = Math.max(1, Math.min(8, (arr[sel]?.len ?? 1)));
      const pattern = arr[sel]?.id || '';
      const total = Math.max(0, arr.length);
      const patternIdx = Math.max(0, allPatterns.indexOf(pattern));
      const patternTotal = Math.max(0, allPatterns.length);
      const offsetNorm = 0.5 + (offset / 10);
      (window as any).__arrCtx = {
        total,
        selectedIndex: sel,
        bars,
        pattern,
        patternIdx,
        patternTotal,
        isPlaying: !!isArrPlaying,
        playIndex: arrPlayIdx,
        offsetNorm: Math.max(0, Math.min(1, isFinite(offsetNorm) ? offsetNorm : 0.5)),
      };
    } catch {}
  }, [arr, sel, allPatterns, isArrPlaying, arrPlayIdx, offset]);

  // Listen to global step events to coordinate pattern switches precisely
  useEffect(() => {
    const onStep = (e: any) => {
      if (!isArrPlaying || arr.length === 0) return;
      const d = e?.detail || {};
      const pid = String(d.patternId || '');
      const step = Number(d.step);
      const len = Number(d.length);
      const activePid = arr[arrPlayIdx]?.id;
      if (!activePid || pid !== activePid) return;
      if (!Number.isFinite(step) || !Number.isFinite(len)) return;
      if (step !== lastStepRef.current) {
        lastStepRef.current = step;
        if (queuedNextIdxRef.current != null && step === 0) {
          const idx = queuedNextIdxRef.current;
          queuedNextIdxRef.current = null;
          setArrPlayIdx(idx);
          barsRemainingRef.current = Math.max(1, arr[idx!]?.len || 1);
          sequencerSetCurrentPattern(arr[idx!]?.id);
          return;
        }
        if (step === len - 1) {
          const rem0 = Math.max(1, barsRemainingRef.current || 1);
          const rem = rem0 - 1;
          if (rem > 0) {
            barsRemainingRef.current = rem;
          } else {
            let nextIdx = arrPlayIdx + 1;
            if (nextIdx >= arr.length) nextIdx = 0;
            try {
              const win: any = window as any;
              const hasSeqFor = (p?: string) => !!p && !!Object.keys(win.__seqKeys || {}).some((k: string) => (k||'').startsWith(`${p}::`));
              if (!hasSeqFor(arr[nextIdx]?.id)) {
                for (let i = 0; i < arr.length; i++) {
                  const cand = (nextIdx + i) % arr.length;
                  if (hasSeqFor(arr[cand]?.id)) { nextIdx = cand; break; }
                }
              }
            } catch {}
            queuedNextIdxRef.current = nextIdx;
          }
        }
      }
    };
    window.addEventListener('seq-pattern-step', onStep as any);
    return () => window.removeEventListener('seq-pattern-step', onStep as any);
  }, [isArrPlaying, arrPlayIdx, arr]);
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

  // Selection/copy/paste keyboard workflow for Arrangement (Space hold + C/V)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const curView = (useBrowserStore.getState() as any).currentView;
      if (curView !== 'Arrangement') return;
      // Begin selection with Space (ignore repeat)
      if ((e.code === 'Space' || (e.key || '') === ' ') && !e.repeat) {
        e.preventDefault();
        if (!isSelecting) {
          setIsSelecting(true);
          setSelStart(sel);
          setSelEnd(sel);
        }
        return;
      }
      // Copy selection with C (ignore repeat)
      if ((e.code === 'KeyC' || (e.key || '').toLowerCase() === 'c') && !e.repeat) {
        const a = selStart, b = selEnd;
        if (a != null && b != null && arr.length > 0) {
          e.preventDefault();
          const lo = Math.max(0, Math.min(arr.length - 1, Math.min(a, b)));
          const hi = Math.max(0, Math.min(arr.length - 1, Math.max(a, b)));
          const out = [] as ArrItem[];
          for (let i = lo; i <= hi; i++) {
            const it = arr[i]; if (!it) continue;
            out.push({ id: it.id, label: it.label, len: Math.max(1, Math.min(8, it.len || 1)) });
          }
          setCopyBuf(out);
        }
        return;
      }
      // Paste at current selection with V (insert before current position)
      if ((e.code === 'KeyV' || (e.key || '').toLowerCase() === 'v') && !e.repeat) {
        if (copyBuf && copyBuf.length > 0 && arr.length > 0) {
          e.preventDefault();
          setArr(cur => {
            const list = [...cur];
            // Insert AFTER the currently selected item, matching insertFromBrowser()
            const t = Math.max(0, Math.min(list.length, sel + 1));
            const toInsert = copyBuf.map(src => ({ id: src.id, label: src.label, len: Math.max(1, Math.min(8, src.len || 1)) }));
            list.splice(t, 0, ...toInsert);
            const newSel = Math.max(0, Math.min(list.length - 1, t + toInsert.length - 1));
            setSel(newSel);
            // Keep centered
            setOffset(0);
            return list;
          });
        }
        return;
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const curView = (useBrowserStore.getState() as any).currentView;
      if (curView !== 'Arrangement') return;
      if ((e.code === 'Space' || (e.key || '') === ' ')) {
        e.preventDefault();
        setIsSelecting(false);
        setSelStart(null);
        setSelEnd(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => { window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp); };
  }, [arr, sel, isSelecting, selStart, selEnd, copyBuf]);

  // no animation cleanup needed

  // Encoders via hotkeys: 5/6 (position select), T/Y (pattern change), G/H (length), B/N (unused now)
  useFourKnobHotkeys({
    active: s.currentView === 'Arrangement',
    // 5/6 behave like W/R: change position
    dec1: () => moveSel(-1),
    inc1: () => moveSel(1),
    // T/Y now change pattern at current position
    dec2: () => swapPattern(-1),
    inc2: () => swapPattern(1),
    dec3: () => adjustLength(-1),
    inc3: () => adjustLength(1),
    // 4th knob reserved for scroll; keyboard B/N unchanged to avoid conflict
    dec4: () => setOffset(o => o - 0.2),
    inc4: () => setOffset(o => o + 0.2),
  });

  function moveSel(d: number) {
    setSel(i => {
      const n = arr.length; if (n === 0) return 0;
      const ni = (i + d + n) % n;
      if (isSelecting) setSelEnd(ni);
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
        const est = sequencerEstimatePatternBars(name) || 1;
        n.splice(idx, 0, { id: name, label: name, len: est });
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

  // Geometry for straight horizontal line layout
  const geom = useMemo(() => {
    const cx = Math.floor(size.w / 2);
    const cy = 44; // near the top
    return { cx, cy } as const;
  }, [size.w]);

  // Positions along the bottom semicircle arc (left -> right), equally spaced
  const itemsWithPos = useMemo(() => {
    const GAP = 8; // tight spacing between bubbles
    const MARGIN = 200;
    if (!arr.length) return [] as any[];
    // Estimate each item's width based on bars -> rx/ry used in render
    const widths = arr.map(it => {
      const bars = Math.max(1, Math.min(8, (it?.len ?? 1)));
      const rx = 20 + (bars - 1) * 8;
      return 2 * rx;
    });
    const avgStep = (widths.reduce((a,b)=>a+b,0) / Math.max(1, widths.length)) + GAP;
    const xCenters: number[] = new Array(arr.length);
    // Center selected item, apply fractional offset as average-step pixels
    xCenters[sel] = geom.cx - (offset * avgStep);
    // Right side
    for (let i = sel + 1; i < arr.length; i++) {
      const prev = i - 1;
      xCenters[i] = xCenters[prev] + (widths[prev] / 2) + GAP + (widths[i] / 2);
    }
    // Left side
    for (let i = sel - 1; i >= 0; i--) {
      const next = i + 1;
      xCenters[i] = xCenters[next] - (widths[next] / 2) - GAP - (widths[i] / 2);
    }
    const list = arr.map((it, i) => {
      const x = xCenters[i];
      const y = geom.cy;
      if (!(x >= -MARGIN && x <= (size.w + MARGIN))) return null;
      return { ...it, x, y, tangentDeg: 0, i } as any;
    }).filter(Boolean) as any[];
    return list;
  }, [arr, sel, offset, geom, size.w]);

  return (
    <div ref={containerRef} className="view-container" style={{ position:'relative', overflow:'hidden' }}>
      {!project && (
        <div className="pixel-text" style={{ padding: 8, color:'var(--text-soft)' }}>Open a project to arrange patterns.</div>
      )}
  <svg width={size.w} height={size.h} style={{ display:'block' }}>
  {/* baseline straight line across top */}
  <line x1={0} y1={geom.cy} x2={size.w} y2={geom.cy} stroke="var(--line)" strokeWidth={1} />
  {itemsWithPos.map((it: any) => {
          const isSel = it.i === sel;
    const inSel = isSelecting && selStart != null && selEnd != null && it.i >= Math.min(selStart, selEnd) && it.i <= Math.max(selStart, selEnd);
          const bars = Math.max(1, Math.min(8, (arr[it.i]?.len ?? 1)));
          // Bigger bubbles
          const rx = 20 + (bars - 1) * 8;
          const ry = 20;
          const disp = formatPatternLabel(it.id);
          return (
            <g key={it.id + ':' + it.i} style={{ transition:'transform 160ms linear' }}>
              <g transform={`translate(${it.x},${it.y})`}>
                {/* Rotated group for oval + label */}
                <g transform={`rotate(${it.tangentDeg})`}>
      <ellipse cx={0} cy={0} rx={rx} ry={ry} fill={inSel ? 'rgba(255,255,255,0.16)' : 'transparent'} stroke={isSel ? 'var(--text)' : 'var(--line)'} strokeWidth={isSel ? 2 : 1} />
      <text x={0} y={4} textAnchor="middle" fontSize={10} fill={isSel ? 'var(--text)' : inSel ? 'var(--text)' : 'var(--text-soft)'} className="pixel-text">{disp}</text>
                </g>
                {/* Unrotated selection dot directly above the oval in screen space */}
                {isSel && (
                  <g transform={`translate(0,${ry + 10})`}>
                    <circle r={3} fill="var(--text)" />
                  </g>
                )}
              </g>
            </g>
          );
        })}
      </svg>
      {/* Contextual 4-knob bar */}
      <div style={{ position:'absolute', left:0, right:0, bottom:0, height:84, borderTop:'1px solid var(--line)', background:'var(--bg)', display:'flex', alignItems:'center', justifyContent:'space-around', padding:'6px 10px', boxSizing:'border-box' }}>
        {/* Knob 1: Position (PO 1..N) */}
        <Knob
          label="PO"
          value={(() => {
            const n = arr.length; if (n <= 1) return 0;
            return Math.max(0, Math.min(1, (sel || 0) / (n - 1)));
          })()}
          onChange={(nv) => {
            const n = arr.length; if (n <= 0) return;
            const target = Math.max(0, Math.min(n - 1, Math.round(nv * (n - 1))));
            const cur = sel;
            if (target === cur) return;
            const forward = (target - cur + n) % n;
            const backward = (cur - target + n) % n;
            const delta = forward <= backward ? forward : -backward;
            moveSel(delta);
          }}
          step={arr.length > 1 ? arr.length : 1}
          format={() => `P${String(arr.length ? (sel + 1) : 0).padStart(2, '0')}`}
        />
        {/* Knob 2: Pattern for current position */}
        <Knob
          label="PATTERN"
          value={(() => {
            const item = arr[sel]; const n = allPatterns.length;
            if (!item || n <= 1) return 0;
            const idx = Math.max(0, allPatterns.indexOf(item.id));
            return Math.max(0, Math.min(1, idx / Math.max(1, n - 1)));
          })()}
          onChange={(nv) => {
            const n = allPatterns.length; if (n <= 0) return;
            const idx = Math.max(0, Math.min(n - 1, Math.round(nv * (n - 1))));
            const next = allPatterns[idx]; if (!next) return;
            setArr(cur => {
              if (!cur.length) return cur;
              const list = [...cur];
              const curLen = Math.max(1, Math.min(8, (list[sel]?.len || 1)));
              list[sel] = { id: next, label: next, len: curLen } as any;
              return list;
            });
            if (isArrPlaying && arrPlayIdx === sel) {
              sequencerSetCurrentPattern(next);
            }
          }}
          step={Math.max(1, allPatterns.length)}
          format={() => {
            const item = arr[sel];
            return item ? formatPatternLabel(item.id) : '';
          }}
        />
        {/* Knob 3: Length (1..8 bars) */}
        <Knob
          label="LENGTH"
          value={(() => {
            const item = arr[sel];
            const bars = Math.max(1, Math.min(8, item?.len || 1));
            return (bars - 1) / 7;
          })()}
          onChange={(nv) => {
            const bars = Math.max(1, Math.min(8, Math.round(1 + nv * 7)));
            setArr(cur => {
              if (!cur.length) return cur;
              const n = [...cur];
              const it = { ...(n[sel] || {}) } as any;
              it.len = bars; n[sel] = it;
              return n;
            });
          }}
          step={8}
          format={(v) => `${Math.max(1, Math.min(8, Math.round(1 + v * 7)))} bar${Math.max(1, Math.min(8, Math.round(1 + v * 7))) === 1 ? '' : 's'}`}
        />
        {/* Knob 4: Scroll (visual arc offset) */}
        <Knob
          label="SCROLL"
          value={(() => {
            const v = 0.5 + (offset / 10);
            return Math.max(0, Math.min(1, isFinite(v) ? v : 0.5));
          })()}
          onChange={(nv) => {
            const off = (nv - 0.5) * 10;
            setOffset(off);
          }}
          infinite
          dragScale={1.2}
          format={() => `${Math.round((0.5 + (offset/10)) * 100)}%`}
        />
      </div>
    </div>
  )
}

function formatPatternLabel(name: string): string {
  const m = name.match(/(\d+)/);
  const n = m ? parseInt(m[1], 10) : 1;
  return `P${String(Math.max(0, n)).padStart(2, '0')}`;
}

