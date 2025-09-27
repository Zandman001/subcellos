import { useCallback, useRef } from 'react';

// Hook returns ref + trigger function. When triggered, adds class for one frame
export function useGlitchFlash() {
  const ref = useRef<HTMLDivElement | null>(null);
  const trigger = useCallback(() => {
    const el = ref.current; if (!el) return;
    el.classList.remove('ark-glitch-active');
    // force reflow
    void el.offsetWidth;
    el.classList.add('ark-glitch-active');
    // Optionally populate random pixels using inline box-shadow squares
    const w = el.clientWidth; const h = el.clientHeight;
    const dots = Array.from({ length: 24 }, () => {
      const x = Math.floor(Math.random()*w);
      const y = Math.floor(Math.random()*h);
      return `${x}px ${y}px 0 0 #fff`;
    });
    el.style.boxShadow = dots.join(',');
    requestAnimationFrame(()=> { el.style.boxShadow = ''; });
  }, []);
  return { ref, trigger };
}
export default useGlitchFlash;
