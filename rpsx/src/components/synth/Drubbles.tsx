import React from 'react';
import { useBrowser } from '../../store/browser';
import Knob from './Knob';

// Drubbles (legacy Drum Sampler UI) – grid squircles + knobs at bottom
export default function Drubbles() {
  const s: any = useBrowser();
  const part = s.selectedSoundPart ?? 0;
  const packs: string[] = s.drumPackItems || [];
  const packSel: number = s.drumPackSelected || 0;
  const packBrowserOpen: boolean = !!s.drumPackBrowserOpen;
  const samples: string[] = s.drumSampleItems || [];
  const sampleSel: number = s.drumSampleSelected || 0;
  const ui: any = s.getSynthUI?.();

  React.useEffect(()=>{
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (packBrowserOpen) {
        if(['q','e','d','w','r','escape'].includes(k)) e.preventDefault();
        switch(k){
          case 'q': s.drumPackLoadSelected?.(); break; // load with Q
          case 'e': s.drumPackMoveUp?.(); break;
          case 'd': s.drumPackMoveDown?.(); break;
          case 'w': s.drumPackMoveDown?.(); break; // alias down (reversed)
          case 'r': s.drumPackMoveUp?.(); break;   // alias up (reversed)
          case 'escape': s.closeDrumPackBrowser?.(); break; // optional close
        }
        return;
      } else if (k === 'q') {
        e.preventDefault();
        s.openDrumPackBrowser?.();
        return;
      }
      if(['w','r','a'].includes(k)) e.preventDefault();
      switch(k){
        case 'w': s.drumSampleMoveUp?.(); break;   // move left (reversed)
        case 'r': s.drumSampleMoveDown?.(); break; // move right (reversed)
        case 'a': s.drumTogglePreview?.(); break;  // preview selected
      }
    };
    window.addEventListener('keydown', onKey);
    return ()=> window.removeEventListener('keydown', onKey);
  }, [packBrowserOpen, samples.length, packs.length, sampleSel, packSel]);

  const selectedPack = packs[packSel] || ui?.drum?.current_pack;
  const paramBase = (slot: number) => `part/${part}/drum/slot/${slot}`;

  const volPath = `${paramBase(sampleSel)}/volume`;
  const panPath = `${paramBase(sampleSel)}/pan`;
  const semiPath = `${paramBase(sampleSel)}/pitch_semitones`;
  const finePath = `${paramBase(sampleSel)}/pitch_fine`;

  const [vol, setVol] = React.useState(0.85);
  const [pan, setPan] = React.useState(0.5);
  const [semi, setSemi] = React.useState(0.5);
  const [fine, setFine] = React.useState(0.5);
  const send = (path: string, v: number) => s.setSynthParam?.(path, v);

  // Grid layout: we let flex-wrap handle columns; width fixed for squircles
  const sampleGrid = (
    <div style={{ flex:1, overflowY:'auto', padding:4, display:'flex', flexWrap:'wrap', gap:12, alignContent:'flex-start' }}>
      {samples.length===0 && <div style={{ fontSize:11, opacity:0.6, padding:6 }}>Select a Drubbles pack (Q)</div>}
      {samples.map((sm: string, i: number) => {
        const baseName = sm.replace(/\.[a-z0-9]+$/i,'');
        const sel = i===sampleSel;
        return (
          <div
            key={sm}
            style={{
              width:80,
              height:80,
              border:'1px solid var(--line)',
              display:'flex',
              alignItems:'center',
              justifyContent:'center',
              fontSize:10,
              textAlign:'center',
              padding:'4px 6px',
              lineHeight:1.2,
              background: sel? 'rgba(var(--accent-rgb),0.15)':'#000',
              boxShadow: sel? '0 0 0 1px var(--accent), 0 2px 6px rgba(0,0,0,0.6)':'none',
              cursor:'default',
              userSelect:'none',
              overflow:'hidden'
            }}
          >{baseName}</div>
        );
      })}
    </div>
  );

  const knobs = (
    <div style={{ display:'flex', gap:24, justifyContent:'center', padding:'8px 0' }}>
      <Knob label='Vol' value={vol} onChange={v=>{ setVol(v); send(volPath, v); }} format={v=> (v*100).toFixed(0)+'%'} />
      <Knob label='Pan' value={pan} onChange={v=>{ setPan(v); send(panPath, v); }} format={v=> ((v-0.5)*200).toFixed(0)+'%'} />
      <Knob label='Semi' value={semi} onChange={v=>{ setSemi(v); send(semiPath, (v-0.5)*24); }} format={v=> ((v-0.5)*24).toFixed(1)} />
      <Knob label='Fine' value={fine} onChange={v=>{ setFine(v); send(finePath, (v-0.5)*100); }} format={v=> ((v-0.5)*100).toFixed(0)+'c'} />
    </div>
  );

  return (
    <div style={{ padding:12, display:'flex', flexDirection:'column', gap:12, height:'100%' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <div style={{ fontSize:12 }}>Pack: {selectedPack || 'None'} {selectedPack && `(${samples.length} samples)`}</div>
        <button onClick={()=> packBrowserOpen ? s.closeDrumPackBrowser?.() : s.openDrumPackBrowser?.()} style={{ fontSize:10 }}>[Q Drum Packs]</button>
      </div>
      {packBrowserOpen ? (
        <div style={{ maxHeight:160, overflowY:'auto', border:'1px solid var(--line)', marginTop:4 }}>
          {(packs||[]).map((p,i)=> (
            <div key={p} style={{ padding:'6px 8px', borderBottom:'1px solid var(--line)', background: i===packSel? 'rgba(var(--accent-rgb),0.14)':'transparent', fontWeight: i===packSel? 'bold':'normal' }}>{p}</div>
          ))}
          {(!packs || packs.length===0) && <div style={{ padding:'6px 8px', fontSize:11, opacity:0.6 }}>Place folders in Documents/Drums</div>}
          <div style={{ padding:'4px 8px', fontSize:10, color:'var(--text-soft)', borderTop:'1px solid var(--line)', textAlign:'center' }}>E/D (or R/W) select · Q load · Esc close</div>
        </div>
      ) : sampleGrid }
      {knobs}
      <div style={{ fontSize:10, opacity:0.6 }}>Q open/load packs · W left · R right · A preview</div>
    </div>
  );
}
