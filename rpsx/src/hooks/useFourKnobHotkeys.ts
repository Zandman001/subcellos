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
      const k = e.key.toLowerCase();
      switch (k) {
        case '5': if (dec1) { e.preventDefault(); dec1(); } break;
        case '6': if (inc1) { e.preventDefault(); inc1(); } break;
        case 't': if (dec2) { e.preventDefault(); dec2(); } break;
        case 'y': if (inc2) { e.preventDefault(); inc2(); } break;
        case 'g': if (dec3) { e.preventDefault(); dec3(); } break;
        case 'h': if (inc3) { e.preventDefault(); inc3(); } break;
        case 'b': if (dec4) { e.preventDefault(); dec4(); } break;
        case 'n': if (inc4) { e.preventDefault(); inc4(); } break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [inc1, dec1, inc2, dec2, inc3, dec3, inc4, dec4, active]);
}
