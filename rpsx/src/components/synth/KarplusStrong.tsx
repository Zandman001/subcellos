import React from 'react';
import Knob from './Knob';
import { useBrowser } from '../../store/browser';

export const KarplusStrong: React.FC = () => {
  const s = useBrowser() as any;
  const ui = s.getSynthUI();
  const part = s.selectedSoundPart ?? 0;
  
  // Ensure module is set to KarplusStrong when page is active
  React.useEffect(() => { 
    try { 
      s.setSynthParam(`part/${part}/module_kind`, 2, 'I32'); 
    } catch {} 
  }, [part]);

  // Mirror values in UI state; apply robust defaults so NaN/undefined never leak into knobs
  const raw = (ui as any).karplus || {};
  const karplus = {
    decay: typeof raw.decay === 'number' && isFinite(raw.decay) ? raw.decay : 0.8,
    damp: typeof raw.damp === 'number' && isFinite(raw.damp) ? raw.damp : 0.5,
    excite: typeof raw.excite === 'number' && isFinite(raw.excite) ? raw.excite : 0.7,
    tune: typeof raw.tune === 'number' && isFinite(raw.tune) ? raw.tune : 0.0,
  };
  
  const update = (patch: Partial<typeof karplus>) => 
    s.updateSynthUI((u: any) => ({ ...u, karplus: { ...(u.karplus || {}), ...patch } }));

  return (
    <Page title="KarplusStrong">
      <Row>
        <Knob
          label="Decay"
          value={karplus.decay}
          onChange={(v) => { 
            update({ decay: v }); 
            s.setSynthParam(`part/${part}/ks/decay`, v); 
          }}
          format={(v) => `${(v * 100).toFixed(0)}%`}
        />
        <Knob
          label="Damp"
          value={karplus.damp}
          onChange={(v) => { 
            update({ damp: v }); 
            s.setSynthParam(`part/${part}/ks/damp`, v); 
          }}
          format={(v) => `${(v * 100).toFixed(0)}%`}
        />
        <Knob
          label="Excite"
          value={karplus.excite}
          onChange={(v) => { 
            update({ excite: v }); 
            s.setSynthParam(`part/${part}/ks/excite`, v); 
          }}
          format={(v) => `${(v * 100).toFixed(0)}%`}
        />
        <Knob
          label="Tune"
          value={karplus.tune}
          onChange={(v) => { 
            update({ tune: v }); 
            s.setSynthParam(`part/${part}/ks/tune`, v); 
          }}
          format={(v) => `${(v * 12 - 6).toFixed(1)} st`}
        />
      </Row>

      <div className="help-text">
        <p><strong>Decay:</strong> String sustain - how long the pluck resonates</p>
        <p><strong>Damp:</strong> High frequency damping - controls brightness decay</p>
        <p><strong>Excite:</strong> Initial pluck intensity - affects attack brightness</p>
        <p><strong>Tune:</strong> Fine pitch adjustment in semitones</p>
      </div>
    </Page>
  );
};

function Page({ title, children }: { title: string, children: React.ReactNode }) {
  return (
    <div style={{ 
      padding: 8
    }}>
      <div style={{ 
        fontSize: 12, 
        margin: '6px 0 8px', 
        color: 'var(--accent)',
        textShadow: '0 0 8px currentColor'
      }}>{title}</div>
      {children}
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 12 }}>{children}</div>
  )
}
