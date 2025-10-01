import { useEffect } from 'react';

export type FourKnobHotkeys = {
  inc1?: () => void; dec1?: () => void;
  inc2?: () => void; dec2?: () => void;
  inc3?: () => void; dec3?: () => void;
  inc4?: () => void; dec4?: () => void;
  active?: boolean;
};

// Global key bindings:
// knob1: 5 (dec), 6 (inc)
// knob2: t (dec), y (inc)
// knob3: g (dec), h (inc)
// knob4: b (dec), n (inc)
export function useFourKnobHotkeys({ inc1, dec1, inc2, dec2, inc3, dec3, inc4, dec4, active = true }: FourKnobHotkeys) {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const code = e.code;
      const k = (e.key || '').toLowerCase();
      const hit = (...vals: string[]) => vals.includes(code) || vals.includes(k);
      if (hit('Digit5','Numpad5','5')) { if (dec1) { e.preventDefault(); dec1(); } return; }
      if (hit('Digit6','Numpad6','6')) { if (inc1) { e.preventDefault(); inc1(); } return; }
      if (hit('KeyT','t')) { if (dec2) { e.preventDefault(); dec2(); } return; }
      if (hit('KeyY','y','KeyZ','z')) { // support QWERTZ where physical Y may report 'z'
        if (inc2) { e.preventDefault(); inc2(); } return;
      }
      if (hit('KeyG','g')) { if (dec3) { e.preventDefault(); dec3(); } return; }
      if (hit('KeyH','h')) { if (inc3) { e.preventDefault(); inc3(); } return; }
      if (hit('KeyB','b')) { if (dec4) { e.preventDefault(); dec4(); } return; }
      if (hit('KeyN','n')) { if (inc4) { e.preventDefault(); inc4(); } return; }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [inc1, dec1, inc2, dec2, inc3, dec3, inc4, dec4, active]);
}
