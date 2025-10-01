import React, { useEffect, useMemo, useRef, useState } from 'react'
// @ts-ignore
import { listen } from '@tauri-apps/api/event'

// Dual VU meter driven by engine meters (dBFS), reversed direction, with dB scale bar
export default function DualVUMeter() {
	const [rms, setRms] = useState<[number, number]>([-80, -80])
	const [peak, setPeak] = useState<[number, number]>([-80, -80])
	const peakHold = useRef<[number, number]>([-80, -80])
	const lastTime = useRef<number>(performance.now())

	useEffect(() => {
		let unlisten: any
		listen<(number | string)[]>("vu_meter", (event) => {
			const [lRms, rRms, lPeak, rPeak] = event.payload as unknown as [number, number, number, number]
			setRms([lRms, rRms])
			setPeak([lPeak, rPeak])
		}).then((f: any) => (unlisten = f))
		return () => { if (unlisten) unlisten() }
	}, [])

	// Peak-hold decay
	useEffect(() => {
		const now = performance.now()
		const dt = Math.min(100, now - lastTime.current)
		lastTime.current = now
		const decayPerSec = 20 // dB per second
		const decay = (decayPerSec * dt) / 1000
		peakHold.current = [
			Math.max(peakHold.current[0] - decay, peak[0]),
			Math.max(peakHold.current[1] - decay, peak[1]),
		]
	})

	const dbMin = -80
	const toPercent = (db: number) => Math.max(0, Math.min(100, ((db - dbMin) / (0 - dbMin)) * 100))
	const dbTicks = useMemo(() => [-80, -60, -36, -24, -12, -6, -3, 0], [])

				// horizontal bars: long and thin, stacked vertically; fill from right to left using dB mapping
						const barHeight = 30
					const barStyle: React.CSSProperties = { position: 'relative', height: barHeight, width: '100%', background: '#0a0a0a', border: '1px solid #3a3a3a' }

						return (
							<div style={{ width: '100%', display: 'flex', justifyContent: 'center' }}>
								<div className="dual-vu-horizontal" style={{ display: 'grid', gap: 14, width: '98%', maxWidth: 980 }}>
						{([1, 0] as const).map((idx) => { // top: Right, bottom: Left (like the first prototype)
							const valDb = rms[idx]
							const peakDb = peakHold.current[idx]
							return (
														<div key={idx} style={{ display: 'grid', gridTemplateColumns: '30px 1fr', alignItems: 'center', columnGap: 10 }}>
															<span style={{ width: 30, textAlign: 'right', fontSize: 12, letterSpacing: 1, color: '#ddd', fontFamily: 'monospace' }}>{idx === 1 ? 'R' : 'L'}</span>
									<div style={barStyle}>
										{/* subtle vertical dB ticks inside bar (horizontal ruler) */}
														{dbTicks.map((db) => (
															<div key={db} style={{ position: 'absolute', top: 2, bottom: 2, left: `${toPercent(db)}%`, width: 1, background: '#222' }} />
														))}
														{/* fill from left -> right based on dB */}
														<div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${toPercent(valDb)}%`, background: 'linear-gradient(90deg, #e0e0e0, #bbbbbb 70%, #888888)' }} />
														{/* peak marker: thin vertical line at peak dB */}
														<div style={{ position: 'absolute', top: 0, bottom: 0, left: `${toPercent(peakDb)}%`, width: 2, background: '#dcdcdc' }} />
									</div>
								</div>
							)
						})}
						{/* dB scale below */}
								<div className="db-scale" style={{ position: 'relative', height: 18 }}>
							{dbTicks.map((db) => (
								<React.Fragment key={db}>
													<div style={{ position: 'absolute', left: `${toPercent(db)}%`, top: 0, height: 8, width: 1, background: '#2b2b2b' }} />
													<div style={{ position: 'absolute', left: `${toPercent(db)}%`, top: 8, transform: 'translateX(-50%)', color:'#bbb', fontSize:10, fontFamily:'monospace' }}>{db}</div>
								</React.Fragment>
							))}
						</div>
								</div>
							</div>
				)
}
// Removed unused DualVUMeter component
export {};
