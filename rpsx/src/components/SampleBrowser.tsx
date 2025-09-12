import React, { useEffect, useState } from 'react'
import { useBrowser, sampleBrowser } from '../store/browser'
import { rpc } from '../rpc'

interface SampleWaveformProps { samplePath: string; selectionStart?: number; selectionEnd?: number; }
function SampleWaveform({ samplePath, selectionStart = 0, selectionEnd = 1 }: SampleWaveformProps) {
  const [waveform, setWaveform] = useState<number[] | null>(null);
  useEffect(() => {
    if (!samplePath) return;
    setWaveform(null);
    rpc.getSampleWaveform(samplePath)
      .then(setWaveform)
      .catch(err => { console.error('Failed to load waveform:', err); setWaveform([]); });
  }, [samplePath]);

  const empty = !samplePath;
  const loading = samplePath && waveform === null;
  const noData = waveform !== null && waveform.length === 0;

  let pathD = '';
  if (waveform && waveform.length > 0) {
    const max = Math.max(0.00001, ...waveform.map(v => Math.abs(v)));
    const top: string[] = [];
    const bottom: string[] = [];
    for (let i = 0; i < waveform.length; i++) {
      const x = (i / (waveform.length - 1)) * 100;
      const amp = waveform[i] / max;
      const yTop = 50 - amp * 45;
      const yBot = 50 + amp * 45;
      top.push(`${x},${yTop}`);
      bottom.push(`${x},${yBot}`);
    }
    pathD = `M ${top[0]} L ${top.slice(1).join(' ')} L ${bottom.reverse().join(' ')} Z`;
  }

  return (
    <div style={{ position:'relative', height:72, background:'#161b1e', border:'1px solid #302c30', margin:'6px 8px 4px', borderRadius:2, overflow:'hidden' }}>
      {empty && <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, color:'#555' }}>No sample</div>}
      {loading && <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, color:'#555' }}>Loading…</div>}
      {noData && <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, color:'#555' }}>No waveform</div>}
      {pathD && (
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width:'100%', height:'100%' }}>
          <rect x={0} y={0} width={100} height={100} fill="#222" />
            <path d={pathD} fill="#ffffff" fillOpacity={0.85} stroke="#ffffff" strokeWidth={0.2} />
            <line x1="0" y1="50" x2="100" y2="50" stroke="#555" strokeWidth={0.4} strokeDasharray="2 2" />
            {selectionEnd > selectionStart && (
              <g>
                <rect x={selectionStart * 100} y={0} width={(selectionEnd - selectionStart) * 100} height={100} fill="#ffffff" fillOpacity={0.06} />
                <line x1={selectionStart * 100} y1={0} x2={selectionStart * 100} y2={100} stroke="#ffffff" strokeOpacity={0.5} strokeWidth={0.5} />
                <line x1={selectionEnd * 100} y1={0} x2={selectionEnd * 100} y2={100} stroke="#ffffff" strokeOpacity={0.5} strokeWidth={0.5} />
              </g>
            )}
        </svg>
      )}
    </div>
  );
}

export default function SampleBrowser() {
  const browser = useBrowser() as any;
  const { sampleBrowserOpen, sampleBrowserItems, sampleBrowserSelected, isRecording } = browser;
  const { sampleBrowserMoveUp, sampleBrowserMoveDown, loadSelectedSample, closeSampleBrowser } = sampleBrowser;
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
  const currentSample = sampleBrowserItems[sampleBrowserSelected];
  // pull current sampler UI for selection overlay (if existing)
  const ui = browser.getSynthUI ? browser.getSynthUI() : undefined;
  const selStart = ui?.sampler?.sample_start ?? 0;
  const selEnd = ui?.sampler?.sample_end ?? 1;

  const deleteCurrent = async () => {
    if (!currentSample) return;
    try {
      await rpc.deleteSubsample(currentSample);
    } catch (e) {
      console.error('delete sample failed', e);
    }
    // Refresh list by closing and reopening quickly (simple approach)
    closeSampleBrowser();
    setTimeout(()=>{ sampleBrowser.openSampleBrowser(); }, 10);
  };

  // Window key handling (menu style like module picker)
  useEffect(() => {
    if (!sampleBrowserOpen) return;
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (['e','d','q','enter','a','w','r'].includes(k)) e.preventDefault();
      switch (k) {
        case 'e': sampleBrowserMoveUp(); break;
        case 'd': sampleBrowserMoveDown(); break;
        case 'q':
        case 'enter': loadSelectedSample(); break;
        case 'a': togglePreview(); break;
        case 'r': deleteCurrent(); break; // R deletes while browser open
        case 'w': stopPreview(true); break; // toggle close
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sampleBrowserOpen, sampleBrowserSelected, currentSample, isPreviewPlaying]);

  const stopPreview = async (close?: boolean) => {
    if (isPreviewPlaying) {
      try { await rpc.stopPreview(); } catch {}
      setIsPreviewPlaying(false);
    }
    if (close) closeSampleBrowser();
  };

  const togglePreview = async () => {
    if (!currentSample) return;
    try {
      if (isPreviewPlaying) {
        await rpc.stopPreview();
        setIsPreviewPlaying(false);
      } else {
        await rpc.previewSample(currentSample);
        setIsPreviewPlaying(true);
        // Auto-stop after 3s
        setTimeout(() => setIsPreviewPlaying(false), 3000);
      }
    } catch (e) {
      console.error('preview failed', e);
      setIsPreviewPlaying(false);
    }
  };

  // Stop preview on selection change
  useEffect(() => { if (isPreviewPlaying) { (async()=>{ try { await rpc.stopPreview(); } catch {} setIsPreviewPlaying(false); })(); } }, [sampleBrowserSelected]);
  // Stop when closing
  useEffect(() => { if (!sampleBrowserOpen && isPreviewPlaying) { (async()=>{ try { await rpc.stopPreview(); } catch {} setIsPreviewPlaying(false); })(); } }, [sampleBrowserOpen]);

  if (!sampleBrowserOpen) return null;

  return (
    <div style={{ position:'absolute', top:60, left:'10%', width:'80%', border:'1px solid var(--line)', background:'var(--bg)', color:'var(--text)', boxShadow:'0 0 0 2px var(--bg)', zIndex:20 }}>
      <div style={{ padding:'6px 8px', borderBottom:'1px solid var(--line)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <span style={{ fontWeight:'bold' }}>Samples</span>
        {isRecording && <span style={{ color:'#f33', fontSize:10, animation:'blink 1s steps(2,start) infinite' }}>● REC</span>}
      </div>
      {currentSample && (
        <div style={{ padding:'6px 8px', borderBottom:'1px solid var(--line)', display:'flex', justifyContent:'space-between', alignItems:'center', background:'rgba(var(--accent-rgb),0.04)' }}>
          <span style={{ fontSize:11, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', maxWidth:'70%' }}>{currentSample}</span>
          <button onClick={togglePreview} style={{ fontSize:10, padding:'2px 6px', cursor:'pointer', background:isPreviewPlaying? 'var(--accent)' : 'transparent', color:isPreviewPlaying? 'var(--bg)' : 'var(--text)', border:'1px solid var(--line)' }}>{isPreviewPlaying? 'Stop' : 'Preview'}</button>
        </div>
      )}
      {currentSample && (
        <SampleWaveform samplePath={currentSample} selectionStart={selStart} selectionEnd={selEnd} />
      )}
      <div style={{ maxHeight:240, overflowY:'auto' }}>
        {sampleBrowserItems.length === 0 && (
          <div style={{ padding:'6px 8px', color:'var(--text-soft)' }}>(no samples)</div>
        )}
        {sampleBrowserItems.map((item:string, i:number) => (
          <div key={item} style={{
            padding:'6px 8px',
            borderBottom:'1px solid var(--line)',
            background: i === sampleBrowserSelected ? 'rgba(var(--accent-rgb),0.14)' : 'transparent',
            fontWeight: i === sampleBrowserSelected ? 'bold' : 'normal',
            cursor: 'pointer'
          }}
            onClick={() => {
              if (i === sampleBrowserSelected) loadSelectedSample();
              else {
                const diff = i - sampleBrowserSelected;
                if (diff > 0) for (let n=0;n<diff;n++) sampleBrowserMoveDown(); else for (let n=0;n<-diff;n++) sampleBrowserMoveUp();
              }
            }}
            onDoubleClick={() => loadSelectedSample()}
          >
            {item}
          </div>
        ))}
      </div>
      <div style={{ padding:'6px 8px', borderTop:'1px solid var(--line)', fontSize:10, textAlign:'center', color:'var(--text-soft)' }}>
        E/D move · Q/Enter load · A preview · R delete · W close
      </div>
    </div>
  );
}
