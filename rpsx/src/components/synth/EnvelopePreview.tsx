import React, { useEffect, useRef } from 'react'

export default function EnvelopePreview({ a, d, s, r }: { a: number; d: number; s: number; r: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const w = c.width, h = c.height; const g = c.getContext('2d'); if (!g) return;
    g.fillStyle = '#0b0c14'; g.fillRect(0,0,w,h);
    g.strokeStyle = '#00fff7'; g.lineWidth = 3;
    const ax = 0 + a * 0.2 * w;
    const dx = ax + d * 0.3 * w;
    const sx = w * 0.9;
    const sr = s;
    g.beginPath();
    g.moveTo(0, h-2);
    g.lineTo(ax, 2);
    g.lineTo(dx, 2 + (1 - sr) * (h-4));
    g.lineTo(sx, 2 + (1 - sr) * (h-4));
    g.lineTo(w, h-2);
    g.stroke();
  }, [a,d,s,r]);
  return <div style={{ border: '3px solid var(--accent)', marginBottom: 8 }}><canvas ref={ref} width={600} height={120} style={{ width: '100%', height: 120 }} /></div>
}
