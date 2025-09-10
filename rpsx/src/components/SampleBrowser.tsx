import React, { useEffect, useState } from 'react'
import { useBrowser, sampleBrowser } from '../store/browser'
import { rpc } from '../rpc'

interface SampleWaveformProps {
  samplePath: string;
}

function SampleWaveform({ samplePath }: SampleWaveformProps) {
  const [waveform, setWaveform] = useState<number[]>([])
  
  useEffect(() => {
    if (!samplePath) return
    
    rpc.getSampleWaveform(samplePath)
      .then(setWaveform)
      .catch(err => console.error('Failed to load waveform:', err))
  }, [samplePath])

  if (waveform.length === 0) {
    return (
      <div className="h-16 bg-gray-900 border border-gray-600 rounded mb-3 flex items-center justify-center">
        <span className="text-gray-500 text-sm">Loading waveform...</span>
      </div>
    )
  }

  const max = Math.max(...waveform.map(Math.abs))
  const normalizedWaveform = waveform.map(sample => sample / max)

  return (
    <div className="h-16 bg-gray-900 border border-gray-600 rounded mb-3 p-1">
      <svg className="w-full h-full">
        <polyline
          fill="none"
          stroke="#06b6d4"
          strokeWidth="1"
          points={normalizedWaveform
            .map((sample, i) => {
              const x = (i / (normalizedWaveform.length - 1)) * 100
              const y = 50 - (sample * 45) // Center line at 50%, scale to ±45%
              return `${x},${y}`
            })
            .join(' ')}
        />
        {/* Center line */}
        <line x1="0" y1="50%" x2="100%" y2="50%" stroke="#374151" strokeWidth="1" strokeDasharray="2,2" />
      </svg>
    </div>
  )
}

export default function SampleBrowser() {
  const { sampleBrowserOpen, sampleBrowserItems, sampleBrowserSelected, isRecording } = useBrowser() as any;
  const { sampleBrowserMoveUp, sampleBrowserMoveDown, loadSelectedSample, closeSampleBrowser } = sampleBrowser;
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
  const currentSample = sampleBrowserItems[sampleBrowserSelected];

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
