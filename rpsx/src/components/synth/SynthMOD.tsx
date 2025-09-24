import React from 'react'
import Knob from './Knob'
import ModMatrixTable, { MOD_DEST_LIST } from './ModMatrixTable'
import { useBrowser, useBrowserStore } from '../../store/browser'
import { useFourKnobHotkeys } from '../../hooks/useFourKnobHotkeys'

export default function SynthMOD() {
  const s = useBrowser() as any;
  const ui = s.getSynthUI();
  const lRow = ui.mod.lfoRow; const eRow = ui.mod.envRow;
  const k1Prev = React.useRef(0);
  const k3Prev = React.useRef(0);
  const asDelta = (prev: React.MutableRefObject<number>, v: number, isAbsolute = true) => {
    if (!isAbsolute) return v;
    const d = v - prev.current;
    prev.current = v;
    return d;
  };

  // Toggle R mode on key press (no need to hold)
  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'r' || e.key === 'R') {
        if (e.repeat) return; // ignore auto-repeat
        const cur = useBrowserStore.getState().isRDown;
        useBrowserStore.getState().setIsRDown(!cur);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => { window.removeEventListener('keydown', onKeyDown); };
  }, []);

  const knob1Handler = (v: number) => {
    if (s.isRDown) { // coarse amount
      const part = s.selectedSoundPart ?? 0;
      const rowIdx = s.getSynthUI().mod.lfoRow;
      const delta = asDelta(k1Prev, v); // 0..1 absolute -> delta
      const coarse = delta * 2; // map to [-1..1] scale
      const next = Math.max(-1, Math.min(1, (s.getSynthUI().mod.lfo[rowIdx].amount ?? 0) + Math.sign(coarse) * 0.05));
      s.updateSynthUI((ui:any)=>{ const rows=ui.mod.lfo.slice(); rows[rowIdx]={...rows[rowIdx], amount: next}; return {...ui, mod:{...ui.mod, lfo:rows}}; });
      s.setSynthParam(`part/${part}/mod/lfo/row${rowIdx}/amount`, next, 'F32');
    } else {
      const d = Math.sign(asDelta(k1Prev, v));
      if (d !== 0) updateRow(s,'lfoRow',(((s.getSynthUI().mod.lfoRow + d) % 5) + 5) % 5);
    }
  };

  const knob3Handler = (v: number) => {
    if (s.isRDown) { // fine amount
      const part = s.selectedSoundPart ?? 0;
      const rowIdx = s.getSynthUI().mod.lfoRow;
      const delta = asDelta(k3Prev, v);
      const fine = delta * 2;
      const next = Math.max(-1, Math.min(1, (s.getSynthUI().mod.lfo[rowIdx].amount ?? 0) + Math.sign(fine) * 0.01));
      s.updateSynthUI((ui:any)=>{ const rows=ui.mod.lfo.slice(); rows[rowIdx]={...rows[rowIdx], amount: next}; return {...ui, mod:{...ui.mod, lfo:rows}}; });
      s.setSynthParam(`part/${part}/mod/lfo/row${rowIdx}/amount`, next, 'F32');
    } else {
      const d = Math.sign(asDelta(k3Prev, v));
      if (d !== 0) updateRow(s,'envRow',(((s.getSynthUI().mod.envRow + d) % 5) + 5) % 5);
    }
  };

  // 4-knob hotkeys: K1 LFO Row or Amt (R), K2 LFO Dest, K3 ENV Row or Amt (R), K4 ENV Dest
  useFourKnobHotkeys({
    dec1: ()=> {
      const part = s.selectedSoundPart ?? 0;
      if (s.isRDown) {
        const rowIdx = s.getSynthUI().mod.lfoRow;
        const next = Math.max(-1, Math.min(1, (s.getSynthUI().mod.lfo[rowIdx].amount ?? 0) - 0.05));
        s.updateSynthUI((ui:any)=>{ const rows=ui.mod.lfo.slice(); rows[rowIdx]={...rows[rowIdx], amount: next}; return {...ui, mod:{...ui.mod, lfo:rows}}; });
        s.setSynthParam(`part/${part}/mod/lfo/row${rowIdx}/amount`, next, 'F32');
      } else {
        updateRow(s,'lfoRow', Math.max(0, Math.min(4, (s.getSynthUI().mod.lfoRow - 1))));
      }
    },
    inc1: ()=> {
      const part = s.selectedSoundPart ?? 0;
      if (s.isRDown) {
        const rowIdx = s.getSynthUI().mod.lfoRow;
        const next = Math.max(-1, Math.min(1, (s.getSynthUI().mod.lfo[rowIdx].amount ?? 0) + 0.05));
        s.updateSynthUI((ui:any)=>{ const rows=ui.mod.lfo.slice(); rows[rowIdx]={...rows[rowIdx], amount: next}; return {...ui, mod:{...ui.mod, lfo:rows}}; });
        s.setSynthParam(`part/${part}/mod/lfo/row${rowIdx}/amount`, next, 'F32');
      } else {
        updateRow(s,'lfoRow', Math.max(0, Math.min(4, (s.getSynthUI().mod.lfoRow + 1))));
      }
    },
    dec2: ()=> {
      const rowIdx = s.getSynthUI().mod.lfoRow;
      const cur = s.getSynthUI().mod.lfo[rowIdx].dest;
      updateDest(s,'lfo', Math.max(0, Math.min(MOD_DEST_LIST.length-1, cur - 1)));
    },
    inc2: ()=> {
      const rowIdx = s.getSynthUI().mod.lfoRow;
      const cur = s.getSynthUI().mod.lfo[rowIdx].dest;
      updateDest(s,'lfo', Math.max(0, Math.min(MOD_DEST_LIST.length-1, cur + 1)));
    },
    dec3: ()=> {
      const part = s.selectedSoundPart ?? 0;
      if (s.isRDown) {
        const rowIdx = s.getSynthUI().mod.lfoRow;
        const next = Math.max(-1, Math.min(1, (s.getSynthUI().mod.lfo[rowIdx].amount ?? 0) - 0.01));
        s.updateSynthUI((ui:any)=>{ const rows=ui.mod.lfo.slice(); rows[rowIdx]={...rows[rowIdx], amount: next}; return {...ui, mod:{...ui.mod, lfo:rows}}; });
        s.setSynthParam(`part/${part}/mod/lfo/row${rowIdx}/amount`, next, 'F32');
      } else {
        updateRow(s,'envRow', Math.max(0, Math.min(4, (s.getSynthUI().mod.envRow - 1))));
      }
    },
    inc3: ()=> {
      const part = s.selectedSoundPart ?? 0;
      if (s.isRDown) {
        const rowIdx = s.getSynthUI().mod.lfoRow;
        const next = Math.max(-1, Math.min(1, (s.getSynthUI().mod.lfo[rowIdx].amount ?? 0) + 0.01));
        s.updateSynthUI((ui:any)=>{ const rows=ui.mod.lfo.slice(); rows[rowIdx]={...rows[rowIdx], amount: next}; return {...ui, mod:{...ui.mod, lfo:rows}}; });
        s.setSynthParam(`part/${part}/mod/lfo/row${rowIdx}/amount`, next, 'F32');
      } else {
        updateRow(s,'envRow', Math.max(0, Math.min(4, (s.getSynthUI().mod.envRow + 1))));
      }
    },
    dec4: ()=> {
      const rowIdx = s.getSynthUI().mod.envRow;
      const cur = s.getSynthUI().mod.env[rowIdx].dest;
      updateDest(s,'env', Math.max(0, Math.min(MOD_DEST_LIST.length-1, cur - 1)));
    },
    inc4: ()=> {
      const rowIdx = s.getSynthUI().mod.envRow;
      const cur = s.getSynthUI().mod.env[rowIdx].dest;
      updateDest(s,'env', Math.max(0, Math.min(MOD_DEST_LIST.length-1, cur + 1)));
    },
    active: true,
  });
  return (
    <Page title={`MOD`}>
      <ModMatrixTable />
      <Row>
        <Knob label={s.isRDown?"LFO Amt (coarse)":"LFO Row"}
              value={s.isRDown?((ui.mod.lfo[lRow].amount+1)/2):(lRow/4)}
              step={s.isRDown?41:5}
              onChange={knob1Handler}
              format={(v)=> s.isRDown?`${(Math.round(((v*2-1)/0.05))*0.05).toFixed(2)}`:String(1+Math.round(v*4))} />
        <Knob label="LFO Dest"
              value={ui.mod.lfo[lRow].dest/(MOD_DEST_LIST.length-1)}
              step={MOD_DEST_LIST.length}
              onChange={(v)=> updateDest(s, 'lfo', Math.round(v*(MOD_DEST_LIST.length-1)))}
              format={(v)=> MOD_DEST_LIST[Math.round(v*(MOD_DEST_LIST.length-1))]} />
        <Knob label={s.isRDown?"LFO Amt (fine)":"ENV Row"}
              value={s.isRDown?((ui.mod.lfo[lRow].amount+1)/2):(eRow/4)}
              step={s.isRDown?201:5}
              onChange={knob3Handler}
              format={(v)=> s.isRDown?`${(Math.round(((v*2-1)/0.01))*0.01).toFixed(2)}`:String(1+Math.round(v*4))} />
        <Knob label="ENV Dest"
              value={ui.mod.env[eRow].dest/(MOD_DEST_LIST.length-1)}
              step={MOD_DEST_LIST.length}
              onChange={(v)=> updateDest(s, 'env', Math.round(v*(MOD_DEST_LIST.length-1)))}
              format={(v)=> MOD_DEST_LIST[Math.round(v*(MOD_DEST_LIST.length-1))]} />
      </Row>
      {s.isRDown && <div style={{fontSize:10,opacity:0.8,marginTop:4}}>LFO Amount mode (coarse/fine). Press R to toggle.</div>}
    </Page>
  );
}

function Page({ title, children }: { title: string, children: React.ReactNode }) {
  return (
    <div style={{ padding: 8, borderTop: '3px solid var(--accent)' }}>
      <div style={{ height: 2, background: 'var(--accent)' }} />
      <div style={{ fontSize: 12, margin: '6px 0 8px' }}>{title}</div>
      {children}
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 12 }}>{children}</div>
  )
}

function updateRow(s: any, which: 'lfoRow'|'envRow', idx: number) {
  s.updateSynthUI((ui: any) => ({ ...ui, mod: { ...ui.mod, [which]: Math.max(0, Math.min(4, idx)) } }));
}
function updateDest(s: any, column: 'lfo'|'env', dest: number) {
  s.updateSynthUI((ui: any) => {
    const rows = ui.mod[column].slice();
    const rowIdx = column === 'lfo' ? ui.mod.lfoRow : ui.mod.envRow;
    rows[rowIdx] = { ...rows[rowIdx], dest: Math.max(0, Math.min(MOD_DEST_LIST.length-1, dest)) };
    return { ...ui, mod: { ...ui.mod, [column]: rows } };
  });
  const part = s.selectedSoundPart ?? 0;
  const rowIdx = column === 'lfo' ? s.getSynthUI().mod.lfoRow : s.getSynthUI().mod.envRow;
  s.setSynthParam(`part/${part}/mod/${column}/row${rowIdx}/dest`, dest, 'I32');
}
// Note: Per-component knob handlers are defined inline above.
