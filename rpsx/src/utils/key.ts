// Small helpers to robustly match keyboard input across layouts/devices
// Prefer KeyboardEvent.code (physical key), with graceful fallback to key string.

export type AnyKeyEvent = KeyboardEvent | React.KeyboardEvent<any>;

function normKeyStr(k: string | undefined): string {
  if (!k) return '';
  // For single letters, normalize to lowercase; otherwise keep as-is (e.g., 'ArrowUp')
  return k.length === 1 ? k.toLowerCase() : k;
}

// Example: keyIs(e, ['KeyW'], ['w']) or keyIs(e, ['Digit5','Numpad5'], ['5'])
export function keyIs(e: AnyKeyEvent, codes: string[] = [], keys: string[] = []): boolean {
  const code = (e as any).code as string | undefined;
  if (code) {
    if (codes.includes(code)) return true;
    // Treat numpad digits as equivalent to DigitN if requested
    if (code.startsWith('Numpad')) {
      const n = code.substring('Numpad'.length);
      if (codes.includes(`Digit${n}`)) return true;
    }
    if (code.startsWith('Digit')) {
      const n = code.substring('Digit'.length);
      if (codes.includes(`Numpad${n}`)) return true;
    }
  }
  const k = normKeyStr((e as any).key);
  if (!k) return false;
  const keySet = new Set(keys.map(normKeyStr));
  return keySet.has(k);
}

export function anyKeyIs(e: AnyKeyEvent, options: Array<{ codes?: string[]; keys?: string[] }>): boolean {
  return options.some(opt => keyIs(e, opt.codes || [], opt.keys || []));
}

export function preventIf(match: boolean, e: AnyKeyEvent): boolean {
  if (match) {
    try { (e as any).preventDefault?.(); } catch {}
    return true;
  }
  return false;
}
