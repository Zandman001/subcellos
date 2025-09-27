import React, { useEffect, useState } from 'react';

export interface ArkEncoderProps { value: number; onChange?: (v:number)=>void; steps?: number; active?: boolean; size?: number; }

export const ArkEncoder: React.FC<ArkEncoderProps> = ({ value, onChange, steps=100, active=true, size=14 }) => {
  const clamp = (x:number)=> Math.max(0, Math.min(1, x));
  const [pos, setPos] = useState(0); // orbit index
  useEffect(()=> {
    if (!active) return;
    let i = 0; let raf: number;
    const tick = () => { i = (i+1)%12; setPos(i); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return ()=> cancelAnimationFrame(raf);
  }, [active]);
  const onWheel = (e: React.WheelEvent) => {
    const delta = e.deltaY > 0 ? -1 : 1;
    const next = clamp(value + delta / steps);
    onChange?.(next);
  };
  return (
    <div className="ark-encoder" data-pos={pos} style={{ width:size, height:size }} onWheel={onWheel}>
      <div className="ark-encoder-base" />
      <div className="ark-encoder-dot" />
    </div>
  );
};
export default ArkEncoder;
