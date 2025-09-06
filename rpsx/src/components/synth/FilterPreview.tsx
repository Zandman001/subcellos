import React, { useEffect, useRef } from 'react'

export default function FilterPreview({ type, cutoff, q }: { type: number; cutoff: number; q: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const w = c.width, h = c.height; const g = c.getContext('2d'); if (!g) return;
    g.fillStyle = '#0b0c14'; g.fillRect(0,0,w,h);
    g.strokeStyle = '#00fff7'; g.lineWidth = 3;
    const bins = 256;
    const arr: number[] = [];
    const fc = 20 * Math.pow(10, cutoff * Math.log10(18000/20)); // 20..18k
    const qVal = 0.5 + q * (12 - 0.5);
    for (let i = 0; i < bins; i++) {
      const f = 20 * Math.pow(10, (i/(bins-1)) * Math.log10(24000/20));
      let mag = 1;
      const ratio = f / (fc+1e-6);
      const t = Math.atan(ratio);
      if (Math.round(type*3) === 0) { // LP
        mag = 1 / Math.sqrt(1 + Math.pow(ratio, 2*qVal));
      } else if (Math.round(type*3) === 1) { // HP
        mag = Math.sqrt(1 / (1 + Math.pow(1/ratio, 2*qVal)));
      } else if (Math.round(type*3) === 2) { // BP (rough)
        const bw = 1/qVal;
        mag = Math.exp(-Math.pow(Math.log(ratio),2)/(2*bw*bw));
      } else { // Notch (rough)
        mag = 1 - Math.exp(-Math.pow(Math.log(ratio),2)/(2*(1/qVal)*(1/qVal)));
      }
      arr.push(mag);
    }
    g.beginPath();
    arr.forEach((m, i) => {
      const x = (i/(bins-1))*w;
      const y = (1-m) * (h-4) + 2;
      if (i===0) g.moveTo(x,y); else g.lineTo(x,y);
    });
    g.stroke();
  }, [type, cutoff, q]);
  return <div style={{ border: '3px solid var(--accent)', marginBottom: 8 }}><canvas ref={ref} width={600} height={120} style={{ width: '100%', height: 120 }} /></div>
}
