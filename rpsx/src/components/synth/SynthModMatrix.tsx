import React from 'react'
import Knob from './Knob'
import ModMatrixTable, { MOD_DEST_LIST } from './ModMatrixTable'
import { useBrowser } from '../../store/browser'
import { useFourKnobHotkeys } from '../../hooks/useFourKnobHotkeys'
import { keyIs } from '../../utils/key'

export default function SynthModMatrix() {
  const s = useBrowser() as any;
  const ui = s.getSynthUI();
  const lRow = ui.mod.lfoRow; const eRow = ui.mod.envRow;

  const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

  // Key modifier: hold R to edit amounts
  React.useEffect(() => {
  const down = (e: KeyboardEvent) => { if (keyIs(e, ['KeyR'], ['r','R']) && !s.isRDown) s.setIsRDown(true); };
  const up = (e: KeyboardEvent) => { if (keyIs(e, ['KeyR'], ['r','R'])) s.setIsRDown(false); };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []);

  // Display mappings for knobs (controlled values)
  const k1Display = s.isRDown ? ((ui.mod.lfo[lRow].amount ?? 0) + 1) / 2 : (lRow / 4);
  const k2Display = (ui.mod.lfo[lRow].dest ?? 0) / (MOD_DEST_LIST.length - 1);
  const k3Display = s.isRDown ? ((ui.mod.env[eRow].amount ?? 0) + 1) / 2 : (eRow / 4);
  const k4Display = (ui.mod.env[eRow].dest ?? 0) / (MOD_DEST_LIST.length - 1);

  // K1: LFO Row select OR Amount (with R)
  const onK1 = (vAbs: number) => {
    const v = clamp01(vAbs);
    const uiNow = s.getSynthUI();
    const lNow = uiNow.mod.lfoRow;
    if (s.isRDown) {
      const amt = Math.max(-1, Math.min(1, v * 2 - 1));
      s.updateLfoAmount(lNow, amt);
    } else {
      s.setLfoRow(Math.max(0, Math.min(4, Math.round(v * 4))));
    }
  };

  // K2: LFO Dest
  const onK2 = (vAbs: number) => {
    const v = clamp01(vAbs);
    const uiNow = s.getSynthUI();
    const lNow = uiNow.mod.lfoRow;
    const next = Math.max(0, Math.min(MOD_DEST_LIST.length - 1, Math.round(v * (MOD_DEST_LIST.length - 1))));
    s.setLfoDest(lNow, next);
  };

  // K3: ENV Row select OR Amount (with R)
  const onK3 = (vAbs: number) => {
    const v = clamp01(vAbs);
    const uiNow = s.getSynthUI();
    const eNow = uiNow.mod.envRow;
    if (s.isRDown) {
      const amt = Math.max(-1, Math.min(1, v * 2 - 1));
      s.updateEnvAmount(eNow, amt);
    } else {
      s.setEnvRow(Math.max(0, Math.min(4, Math.round(v * 4))));
    }
  };

  // K4: ENV Dest
  const onK4 = (vAbs: number) => {
    const v = clamp01(vAbs);
    const uiNow = s.getSynthUI();
    const eNow = uiNow.mod.envRow;
    const next = Math.max(0, Math.min(MOD_DEST_LIST.length - 1, Math.round(v * (MOD_DEST_LIST.length - 1))));
    s.setEnvDest(eNow, next);
  };

  // 4-knob hotkeys mirror the compact Mod page behavior
  useFourKnobHotkeys({
    dec1: ()=> s.isRDown ? s.updateLfoAmount(lRow, Math.max(-1, Math.min(1, (ui.mod.lfo[lRow].amount ?? 0) - 0.05)))
                         : s.setLfoRow(Math.max(0, Math.min(4, lRow - 1))),
    inc1: ()=> s.isRDown ? s.updateLfoAmount(lRow, Math.max(-1, Math.min(1, (ui.mod.lfo[lRow].amount ?? 0) + 0.05)))
                         : s.setLfoRow(Math.max(0, Math.min(4, lRow + 1))),
    dec2: ()=> s.setLfoDest(lRow, Math.max(0, Math.min(MOD_DEST_LIST.length-1, (ui.mod.lfo[lRow].dest ?? 0) - 1))),
    inc2: ()=> s.setLfoDest(lRow, Math.max(0, Math.min(MOD_DEST_LIST.length-1, (ui.mod.lfo[lRow].dest ?? 0) + 1))),
    dec3: ()=> s.isRDown ? s.updateEnvAmount(eRow, Math.max(-1, Math.min(1, (ui.mod.env[eRow].amount ?? 0) - 0.01)))
                         : s.setEnvRow(Math.max(0, Math.min(4, eRow - 1))),
    inc3: ()=> s.isRDown ? s.updateEnvAmount(eRow, Math.max(-1, Math.min(1, (ui.mod.env[eRow].amount ?? 0) + 0.01)))
                         : s.setEnvRow(Math.max(0, Math.min(4, eRow + 1))),
    dec4: ()=> s.setEnvDest(eRow, Math.max(0, Math.min(MOD_DEST_LIST.length-1, (ui.mod.env[eRow].dest ?? 0) - 1))),
    inc4: ()=> s.setEnvDest(eRow, Math.max(0, Math.min(MOD_DEST_LIST.length-1, (ui.mod.env[eRow].dest ?? 0) + 1))),
    active: true,
  });

  return (
    <Page title={`MOD`}>
      <ModMatrixTable />
      <Row>
        <Knob label={s.isRDown?"LFO Amt":"LFO Row"}
              value={k1Display}
              step={s.isRDown?undefined:5}
              onChange={onK1}
              format={(v)=> s.isRDown?`${(v*2-1).toFixed(2)}`:String(1+Math.round(v*4))} />
        <Knob label="LFO Dest"
              value={(ui.mod.lfo[lRow].dest ?? 0) / (MOD_DEST_LIST.length - 1)}
              step={MOD_DEST_LIST.length}
              onChange={onK2}
              format={(v)=> MOD_DEST_LIST[Math.round(v*(MOD_DEST_LIST.length-1))]} />
        <Knob label={s.isRDown?"ENV Amt":"ENV Row"}
              value={k3Display}
              step={s.isRDown?undefined:5}
              onChange={onK3}
              format={(v)=> s.isRDown?`${(v*2-1).toFixed(2)}`:String(1+Math.round(v*4))} />
        <Knob label="ENV Dest"
              value={(ui.mod.env[eRow].dest ?? 0) / (MOD_DEST_LIST.length - 1)}
              step={MOD_DEST_LIST.length}
              onChange={onK4}
              format={(v)=> MOD_DEST_LIST[Math.round(v*(MOD_DEST_LIST.length-1))]} />
      </Row>
    </Page>
  );
}

function Page({ title, children }: { title: string, children: React.ReactNode }) {
  return (
    <div style={{ padding: 8, borderTop: '1px solid var(--line)' }}>
      <div style={{ fontSize: 12, marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 12 }}>{children}</div>
  )
}
