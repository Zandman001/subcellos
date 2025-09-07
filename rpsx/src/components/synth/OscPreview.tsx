import React, { useEffect, useRef } from 'react'
import { useBrowser } from '../../store/browser'

export default function OscPreview({ which }: { which: 'A' | 'B' }) {
  const s = useBrowser() as any;
  const ui = s.getSynthUI();
  const osc = which === 'A' ? ui.oscA : ui.oscB;
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const c = ref.current; if (!c) return;
    const w = c.width, h = c.height;
    const g = c.getContext('2d'); if (!g) return;
    // Background - monochrome theme
    g.fillStyle = '#000000';
    g.fillRect(0,0,w,h);
    g.lineWidth = 2;
    const N = w;
    const accent = '#ffffff';  // white accent for main waveform
    const ghost = '#666666';   // gray for ghost waveform

    const drawGrid = () => {
      g.strokeStyle = '#2a2a2a';  // neutral-2 for grid
      g.beginPath();
      // vertical gridlines at quarters
      for (let i=1;i<4;i++) {
        const x = Math.floor((w * i)/4) + 0.5;
        g.moveTo(x, 0); g.lineTo(x, h);
      }
      g.stroke();
      // zero axis
      g.strokeStyle = '#444444';  // line color for zero axis
      g.beginPath();
      g.moveTo(0, Math.floor(h/2)+0.5); g.lineTo(w, Math.floor(h/2)+0.5);
      g.stroke();
    };

    const drawWave = (shapeNorm: number, color = accent) => {
      const sIdx = Math.round(shapeNorm * 7); // 0..7
      if (sIdx >= 5) { // noise shapes handled elsewhere
        drawNoise(sIdx);
        return;
      }
      g.strokeStyle = color;
      g.beginPath();
      for (let x = 0; x < N; x++) {
        const t = x / N;
        const phi = t * 2 * Math.PI;
        let y = 0;
        if (sIdx === 0) {
          y = Math.sin(phi);
        } else if (sIdx === 1) {
          y = 2 * (t - Math.floor(t + 0.5)); // saw -1..1
        } else if (sIdx === 2) {
          y = Math.sign(Math.sin(phi)); // square
        } else if (sIdx === 3) {
          y = (2 / Math.PI) * Math.asin(Math.sin(phi)); // tri
        } else if (sIdx === 4) {
          const pw = 0.4; // pulse width ~40%
          y = (t % 1) < pw ? 1 : -1;
        }
        const yy = (h/2) + (-y) * (h/2 - 4);
        if (x === 0) g.moveTo(x, yy); else g.lineTo(x, yy);
      }
      g.stroke();
    };

    const drawNoise = (sIdx: number) => {
      // TV static with different density/brightness per noise type - monochrome
      // 5: white, 6: pink, 7: brown
      const dots = sIdx === 5 ? 0.18 : sIdx === 6 ? 0.12 : 0.08; // toned-down fill
      const minB = sIdx === 5 ? 180 : sIdx === 6 ? 140 : 100;  // brighter whites/grays
      const maxB = sIdx === 5 ? 255 : sIdx === 6 ? 200 : 160;  // pure white for white noise
      // Sparse grid of pixels to keep performance reasonable
      const step = 2; // 2px grid
      for (let y = 0; y < h; y += step) {
        for (let x = 0; x < w; x += step) {
          if (Math.random() < dots) {
            const b = Math.floor(minB + Math.random() * (maxB - minB));
            g.fillStyle = `rgb(${b},${b},${b})`;  // pure grayscale
            g.fillRect(x, y, step, step);
          }
        }
      }
      // Light scanlines overlay for retro feel - monochrome
      g.fillStyle = 'rgba(0,0,0,0.15)';  // slightly stronger for better contrast
      for (let y = 1; y < h; y += 2) { g.fillRect(0, y, w, 1); }
    };

    // Draw grid
    drawGrid();
    // Draw current shape
    drawWave(osc.shape);
    // Overlay FM source in ghost color when relevant and non-noise
    const sIdxMain = Math.round(osc.shape * 7);
    if (osc.fm > 0.01 && sIdxMain < 5) {
      drawWave((which === 'A' ? ui.oscB.shape : ui.oscA.shape), ghost);
    }
  }, [ui, which]);

  return (
    <div style={{ border: '2px solid var(--line)', marginBottom: 8 }}>
      <canvas ref={ref} width={600} height={120} style={{ width: '100%', height: 120, display: 'block' }} />
    </div>
  )
}
