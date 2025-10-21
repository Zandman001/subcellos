import React, { useEffect, useRef } from 'react'
import { useBrowser } from '../store/browser'
import { UI_THEMES } from '../store/browser'

export default function ProjectSettings() {
  const s = useBrowser() as any;
  const open = !!s.projectSettingsOpen;
  const idx: number = s.projectSettingsIndex || 0;
  const bpm: number = typeof s.globalBpm === 'number' ? s.globalBpm : 120;
  const uiTheme: string = s.uiTheme || 'Off';

  const listRef = useRef<HTMLDivElement | null>(null);
  const itemRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const k = (e.key || '').toLowerCase();
      if (['e','d','w','r','s','o','arrowup','arrowdown'].includes(k)) e.preventDefault();
      switch (k) {
        case 'e':
        case 'arrowup': s.projectSettingsMoveUp?.(); break;
        case 'd':
        case 'arrowdown': s.projectSettingsMoveDown?.(); break;
        case 'r': s.projectSettingsInc?.(1); break; // +1
        case 'w': s.projectSettingsDec?.(1); break; // -1
        case 'o':
        case 's': s.closeProjectSettings?.(); break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    // keep selected visible (single item for now, but future-proof)
    const c = listRef.current; const sel = itemRef.current;
    if (!c || !sel) return;
    const cb = c.getBoundingClientRect(); const sb = sel.getBoundingClientRect();
    if (sb.top < cb.top) c.scrollTop += (sb.top - cb.top) - 8;
    else if (sb.bottom > cb.bottom) c.scrollTop += (sb.bottom - cb.bottom) + 8;
  }, [idx, open]);

  if (!open) return null;

  return (
    <div style={{ position:'absolute', top:40, left:'10%', width:'80%', height:180, display:'flex', flexDirection:'column', overflow:'hidden',
      border:'1px solid var(--line)', background:'var(--bg)', color:'var(--text)', boxShadow:'0 0 0 2px var(--bg)', zIndex:25,
      backgroundImage: 'radial-gradient(rgba(255,255,255,0.06) 1px, transparent 1px)', backgroundSize:'6px 6px' }}>
      <div style={{ padding:'6px 8px', borderBottom:'1px solid var(--line)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <span style={{ fontWeight:'bold' }}>Project Settings</span>
      </div>
      <div ref={listRef} style={{ flex:'1 1 auto', minHeight: 0, overflowY:'auto' }}>
        <div ref={itemRef} style={{
          padding:'6px 8px', borderBottom:'1px solid var(--line)',
          background: idx === 0 ? 'rgba(var(--accent-rgb),0.14)' : 'transparent',
          fontWeight: idx === 0 ? 'bold' : 'normal', cursor:'default', display:'flex', justifyContent:'space-between'
        }}>
          <span>Global Tempo</span>
          <span style={{ opacity:0.9 }}>{bpm} BPM</span>
        </div>
        <div style={{
          padding:'6px 8px', borderBottom:'1px solid var(--line)',
          background: idx === 1 ? 'rgba(var(--accent-rgb),0.14)' : 'transparent',
          fontWeight: idx === 1 ? 'bold' : 'normal', cursor:'default', display:'flex', justifyContent:'space-between'
        }}>
          <span>UI Theme</span>
          <span style={{ opacity:0.9 }}>{uiTheme}</span>
        </div>
      </div>
      <div style={{ padding:'6px 8px', borderTop:'1px solid var(--line)', fontSize:10, textAlign:'center', color:'var(--text-soft)' }}>
        E/D select · R next · W prev · O/S close
      </div>
    </div>
  );
}
