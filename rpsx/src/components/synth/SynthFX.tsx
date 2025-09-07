import React from 'react'
import Knob from './Knob'
import { useBrowser } from '../../store/browser'
import { setFxPage } from '../../store/browser'

export default function SynthFX() {
  const s = useBrowser() as any;
  const selIdx: number = Math.max(0, Math.min(3, (s.fxSelect ?? 0)));
  const which = String(selIdx + 1);
  const ui = s.getSynthUI();
  const key = (`fx${which}`) as 'fx1'|'fx2'|'fx3'|'fx4';
  const fx = (ui as any)[key];
  // fx.type is stored as 0..8 integer in UI state (0=No Effect)
  const typeIdx = Math.max(0, Math.min(8, Math.round(fx.type as number)));
  const labelsByType: Record<number, [string,string,string,string]> = {
    0: ["Type","—","—","—"],
    1: ["Type","Decay","Room","Mix"],
    2: ["Type","Time","Feedback","Mix"],
    3: ["Type","RateHz","Depth","Mix"],
    4: ["Type","RateHz","Depth","Mix"],
    5: ["Type","RateHz","Depth","Mix"],
    6: ["Type","Drive dB","Tone","Mix"],
    7: ["Type","Curve","Drive","Mix"],
    8: ["Type","Bits","Rate Red","Mix"],
  };
  const L = labelsByType[typeIdx] || labelsByType[0];
  const disabledParams = typeIdx === 0;
  const part = s.selectedSoundPart ?? 0;
  const typeNames = ['No Effect','Reverb','Delay','Phaser','Chorus','Chorus 2','Distortion','Waveshaper','Bitcrusher'] as const;
  const pedalTypes = [ui.fx1.type, ui.fx2.type, ui.fx3.type, ui.fx4.type].map((t:number)=> Math.max(0, Math.min(8, Math.round(t||0))));
  return (
    <Page title={`FX · ${which}` }>
      <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
        {pedalTypes.map((tIdx, i) => (
          <Pedal 
            key={i} 
            typeIdx={tIdx} 
            label={typeNames[tIdx]} 
            selected={i===selIdx}
          />
        ))}
      </div>
      <Row>
        <Knob label={L[0]} value={fx.type/8} step={9}
              onChange={(v)=> { const t = Math.round(v*8); updateFx(s, key, { type: t }); s.setSynthParam(`part/${part}/${key}/type`, t, 'I32'); }}
              format={(v)=> typeNames[Math.round(v*8)]} />
        <Knob label={L[1]} value={fx.p1}
              onChange={(v)=> { if (disabledParams) return; updateFx(s, key, { p1: v }); s.setSynthParam(`part/${part}/${key}/p1`, v); }}
              format={(v)=> L[1]==='Time' ? `${Math.round(10 + v*990)} ms` : L[1]==='RateHz' ? `${(0.05 + v*(10-0.05)).toFixed(2)} Hz` : L[1]==='Drive dB' ? `${Math.round(v*20)} dB` : L[1]==='Curve' ? (v<0.34?'tanh':(v<0.67?'clip':'fold')) : L[1]==='Bits' ? `${Math.round(4 + v*12)} bits` : (L[1]==='—' ? '—' : `${Math.round(v*100)}%`)}
              disabled={disabledParams} />
        <Knob label={L[2]} value={fx.p2}
              onChange={(v)=> { if (disabledParams) return; updateFx(s, key, { p2: v }); s.setSynthParam(`part/${part}/${key}/p2`, v); }}
              format={(v)=> L[2]==='Feedback' ? `${Math.round(v*95)}%` : L[2]==='Drive' ? `${(v*10).toFixed(1)}` : L[2]==='Rate Red' ? `x${Math.max(1, Math.round(1 + v*15))}` : (L[2]==='—' ? '—' : `${Math.round(v*100)}%`)}
              disabled={disabledParams} />
        <Knob label={L[3]} value={fx.p3}
              onChange={(v)=> { if (disabledParams) return; updateFx(s, key, { p3: v }); s.setSynthParam(`part/${part}/${key}/p3`, v); }}
              format={(v)=> L[3]==='—' ? '—' : `${Math.round(v*100)}%`}
              disabled={disabledParams} />
      </Row>
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

function updateFx(s: any, key: 'fx1'|'fx2'|'fx3'|'fx4', patch: Partial<{type:number;p1:number;p2:number;p3:number}>) {
  s.updateSynthUI((ui: any) => ({ ...ui, [key]: { ...(ui as any)[key], ...patch } }));
}

// --- Pedalboard visualization ---
function Pedal({ typeIdx, label, selected }: { typeIdx: number; label: string; selected?: boolean }) {
  const muted = typeIdx === 0;
  return (
    <div style={{ marginBottom: 6 }}>
      <div 
        style={{
          display: 'inline-flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: 6,
          border: `3px solid ${selected ? 'var(--accent-2)' : 'var(--accent)'}`,
          background: 'var(--bg)',
          borderRadius: 0,
        }}
      >
        <div style={{
          width: 90,
          height: 58,
          background: 'var(--bg)',
          borderRadius: 0,
          boxShadow: 'inset 0 0 0 3px var(--accent)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <FxIcon typeIdx={typeIdx} invert={false} muted={muted} />
        </div>
        <div style={{ fontSize: 10, marginTop: 4, color: 'var(--text)' }}>{label}</div>
      </div>
    </div>
  );
}

function FxIcon({ typeIdx, invert, muted }: { typeIdx: number; invert?: boolean; muted?: boolean }) {
  const size = 48;
  const stroke = 'var(--accent)';
  const fillText = 'var(--accent)';
  const common = { stroke, fill: 'none', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
  if (typeIdx === 0) {
    return <div style={{ width: size, height: size }} />;
  }
  return (
    <svg width={size} height={size} viewBox="0 0 48 48">
      {typeIdx === 1 && (
        // Reverb: cube
        <g {...common as any}>
          <rect x="10" y="12" width="20" height="20" />
          <path d="M30 12 L38 16 L38 36 L30 32 Z" />
          <path d="M10 12 L18 16 L38 16" />
        </g>
      )}
      {typeIdx === 2 && (
        // Delay: bouncing line in cube
        <g {...common as any}>
          <rect x="6" y="6" width="36" height="36" />
          <polyline points="10,32 16,20 22,28 28,14 34,22" />
        </g>
      )}
      {typeIdx === 3 && (
        // Phaser: jet turbine (fan)
        <g {...common as any}>
          <circle cx="24" cy="24" r="12" />
          <path d="M24 12 L26 20 L22 20 Z" />
          <path d="M36 24 L28 26 L28 22 Z" />
          <path d="M24 36 L22 28 L26 28 Z" />
          <path d="M12 24 L20 22 L20 26 Z" />
        </g>
      )}
      {typeIdx === 4 && (
        // Chorus: two arrows left/right
        <g {...common as any}>
          <path d="M8 18 L24 18 M20 14 L24 18 L20 22" />
          <path d="M40 30 L24 30 M28 26 L24 30 L28 34" />
        </g>
      )}
      {typeIdx === 5 && (
        // Chorus 2: arrows with x2
        <g {...common as any}>
          <path d="M8 16 L20 16 M16 12 L20 16 L16 20" />
          <path d="M40 32 L28 32 M32 28 L28 32 L32 36" />
          <text x="22" y="26" fill={fillText} fontSize="10">×2</text>
        </g>
      )}
      {typeIdx === 6 && (
        // Distortion: jagged wave
        <g {...common as any}>
          <polyline points="6,30 10,22 14,34 18,18 22,32 26,16 30,30 34,14 38,26 42,20" />
        </g>
      )}
      {typeIdx === 7 && (
        // Waveshaper: odd-shaped sine
        <g {...common as any}>
          <path d="M6 24 C 10 10, 14 10, 18 24 S 26 38, 30 24 S 38 10, 42 24" />
        </g>
      )}
      {typeIdx === 8 && (
        // Bitcrusher: space invader (pixel grid)
        (() => {
          const s = 2; // pixel size
          const pat = [
            '00111011100',
            '01000100010',
            '10011111001',
            '11111111111',
            '11011111101',
            '11100110011',
            '00110000110',
            '01000000010',
          ];
          const rows = pat.length; const cols = pat[0].length;
          const x0 = Math.floor((48 - cols * s) / 2);
          const y0 = Math.floor((48 - rows * s) / 2);
          const rects: React.ReactElement[] = [];
          for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
              if (pat[r][c] === '1') {
                rects.push(<rect key={`${r}-${c}`} x={x0 + c * s} y={y0 + r * s} width={s} height={s} />);
              }
            }
          }
          return <g fill="var(--accent)" stroke="none">{rects}</g>;
        })()
      )}
    </svg>
  );
}
