import { useEffect, useState } from 'react';

// Discrete orbit index progression (0..11). Returns index for binding to data-pos.
export function useOrbit(active: boolean) {
  const [idx, setIdx] = useState(0);
  useEffect(()=> {
    if (!active) return; let frame: number; let i = 0;
    const tick = () => { i = (i+1)%12; setIdx(i); frame = requestAnimationFrame(tick); };
    frame = requestAnimationFrame(tick);
    return ()=> cancelAnimationFrame(frame);
  }, [active]);
  return idx;
}
export default useOrbit;
