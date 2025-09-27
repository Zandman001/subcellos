import React, { useState } from 'react';
import './ark1bit.css';
import './font.css';
import { ArkSurface } from './primitives/ArkSurface';
import ArkLabel from './primitives/ArkLabel';
import ArkButton from './primitives/ArkButton';
import ArkToggle, { ArkToggleState } from './primitives/ArkToggle';
import ArkSlider from './primitives/ArkSlider';
import ArkEncoder from './primitives/ArkEncoder';
import ArkGrid from './primitives/ArkGrid';
import ArkGlyph from './primitives/ArkGlyph';
import { useGlitchFlash } from './hooks/useGlitchFlash';

export const ArkDemo: React.FC = () => {
  const [toggle, setToggle] = useState<ArkToggleState>('off');
  const [slider, setSlider] = useState(0.4);
  const [encoder, setEncoder] = useState(0.25);
  const [cells, setCells] = useState(Array.from({ length: 32 }, (_, i) => ({ id: String(i), active: i%4===0, pulse: i===2, accent: i%8===0 })));
  const { ref: glitchRef, trigger } = useGlitchFlash();
  return (
    <div className="ark-root ark-font" style={{ display:'flex', flexDirection:'column', gap:8, padding:8 }}>
      <ArkSurface>
        <ArkLabel text="ARK DEMO" glyph={<ArkGlyph kind="A" />} />
        <div style={{ height:4 }} />
        <ArkButton onClick={trigger}>GLITCH</ArkButton>
        <span ref={glitchRef} className="ark-glitch-layer" />
      </ArkSurface>
      <ArkSurface>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          <ArkToggle state={toggle} onChange={setToggle} />
          <ArkSlider value={slider} onChange={setSlider} />
          <ArkEncoder value={encoder} onChange={setEncoder} />
        </div>
      </ArkSurface>
      <ArkSurface>
        <ArkGrid
          cols={8}
          cells={cells}
          onToggle={(id)=> setCells(cells.map(c => c.id===id? {...c, active: !c.active}: c))}
        />
      </ArkSurface>
    </div>
  );
};
export default ArkDemo;
