import React from 'react';
import Knob from './Knob';
import { useBrowser } from '../../store/browser';

export default function StringTheory() {
  const s = useBrowser() as any;
  const ui = s.getSynthUI();
  const part = s.selectedSoundPart ?? 0;
  const selectedSoundId = s.selectedSoundId;
  const moduleKindById = s.moduleKindById;
  React.useEffect(() => { 
    try { 
      if (!selectedSoundId) return;
      const moduleKind = moduleKindById?.[selectedSoundId];
      if (moduleKind !== 'karplus') {
        s.setSynthParam(`part/${part}/module_kind`, 2, 'I32'); 
      }
    } catch {} 
  }, [part, selectedSoundId, moduleKindById, s.setSynthParam]);

  const raw = (ui as any).karplus || {};
  const karplus = {
    decay: typeof raw.decay === 'number' && isFinite(raw.decay) ? raw.decay : 0.8,
    damp: typeof raw.damp === 'number' && isFinite(raw.damp) ? raw.damp : 0.5,
    excite: typeof raw.excite === 'number' && isFinite(raw.excite) ? raw.excite : 0.7,
    tune: typeof raw.tune === 'number' && isFinite(raw.tune) ? raw.tune : 0.0,
  };
  const update = (patch: Partial<typeof karplus>) => s.updateSynthUI((u: any) => ({ ...u, karplus: { ...(u.karplus || {}), ...patch } }));

  return (
    <Page title="String Theory">
      <Row>
        <Knob label="Decay" value={karplus.decay} onChange={(v) => { update({ decay: v }); s.setSynthParam(`part/${part}/ks/decay`, v); }} format={(v) => `${(v * 100).toFixed(0)}%`} />
        <Knob label="Damp" value={karplus.damp} onChange={(v) => { update({ damp: v }); s.setSynthParam(`part/${part}/ks/damp`, v); }} format={(v) => `${(v * 100).toFixed(0)}%`} />
        <Knob label="Excite" value={karplus.excite} onChange={(v) => { update({ excite: v }); s.setSynthParam(`part/${part}/ks/excite`, v); }} format={(v) => `${(v * 100).toFixed(0)}%`} />
        <Knob label="Tune" value={karplus.tune} onChange={(v) => { update({ tune: v }); s.setSynthParam(`part/${part}/ks/tune`, v); }} format={(v) => `${(v * 12 - 6).toFixed(1)} st`} />
      </Row>

      <div className="help-text">
        <p><strong>Decay:</strong> String sustain - how long the pluck resonates</p>
        <p><strong>Damp:</strong> High frequency damping - controls brightness decay</p>
        <p><strong>Excite:</strong> Initial pluck intensity - affects attack brightness</p>
        <p><strong>Tune:</strong> Fine pitch adjustment in semitones</p>
      </div>
    </Page>
  );
}

function Page({ title, children }: { title: string, children: React.ReactNode }) {
  return (
    <div style={{ padding: 12, background: 'var(--neutral-1)', margin: '8px' }}>
      <div style={{ fontSize: 12, margin: '0 0 12px', color: 'var(--accent)', fontWeight: 'bold' }}>{title}</div>
      {children}
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 16, justifyContent: 'center' }}>{children}</div>
  )
}
