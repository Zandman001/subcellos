import React, { useEffect, useRef, useState } from 'react'

interface DualVUMeterProps {
  leftLevel: number   // 0-1
  rightLevel: number  // 0-1
  pan: number        // 0-1 (0.5 = center)
  haas: number       // 0-1
}

export default function DualVUMeter({ leftLevel, rightLevel, pan, haas }: DualVUMeterProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    
    const width = canvas.width
    const height = canvas.height
    
    // Clear canvas
    ctx.clearRect(0, 0, width, height)
    
    // VU meter dimensions - wider bars with spacing
    const meterWidth = 40
    const meterHeight = height - 20
    const spacing = 20
    const totalWidth = (meterWidth * 2) + spacing
    const startX = (width - totalWidth) / 2
    
    // Calculate meter positions
    const leftX = startX
    const rightX = startX + meterWidth + spacing
    
    // Draw meters
    drawVUMeter(ctx, leftX, 10, meterWidth, meterHeight, leftLevel, 'L')
    drawVUMeter(ctx, rightX, 10, meterWidth, meterHeight, rightLevel, 'R')
    
  }, [leftLevel, rightLevel, pan, haas])
  
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
      <canvas
        ref={canvasRef}
        width={120}
        height={100}
        style={{
          imageRendering: 'pixelated',
        }}
      />
    </div>
  )
}

function drawVUMeter(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  level: number,
  label: string
) {
  // Background - subtle transparent dark background
  ctx.fillStyle = 'rgba(20, 20, 20, 0.4)'
  ctx.fillRect(x, y, width, height)
  
  // Border - subtle cyan border
  ctx.strokeStyle = 'rgba(0, 200, 255, 0.3)'
  ctx.lineWidth = 1
  ctx.strokeRect(x, y, width, height)
  
  // Calculate fill height
  const fillHeight = level * height
  const fillY = y + height - fillHeight
  
  // Create gradient - simple cyan to yellow progression
  const gradient = ctx.createLinearGradient(x, y + height, x, y)
  
  if (level > 0.9) {
    // Peak - yellow
    gradient.addColorStop(0, 'rgba(0, 220, 255, 0.8)')   // Cyan at bottom
    gradient.addColorStop(0.8, 'rgba(255, 255, 0, 0.9)')  // Yellow at peak
  } else if (level > 0.7) {
    // High
    gradient.addColorStop(0, 'rgba(0, 220, 255, 0.8)')   // Cyan at bottom
    gradient.addColorStop(1, 'rgba(220, 220, 0, 0.8)')   // Yellow transition
  } else {
    // Normal - cyan only
    gradient.addColorStop(0, 'rgba(0, 220, 255, 0.6)')   // Cyan at bottom
    gradient.addColorStop(1, 'rgba(0, 200, 255, 0.8)')   // Slightly brighter cyan at top
  }
  
  // Fill the meter
  ctx.fillStyle = gradient
  ctx.fillRect(x + 2, fillY, width - 4, fillHeight)
  
  // Add outer glow effect
  ctx.shadowColor = level > 0.8 ? 'rgba(255, 255, 0, 0.6)' : 'rgba(0, 220, 255, 0.6)'
  ctx.shadowBlur = 10
  ctx.fillRect(x + 2, fillY, width - 4, fillHeight)
  ctx.shadowBlur = 0
  
  // Add inner glow
  if (level > 0.3) {
    ctx.fillStyle = level > 0.8 ? 'rgba(255, 255, 0, 0.3)' : 'rgba(0, 220, 255, 0.3)'
    ctx.fillRect(x + 4, fillY + 2, width - 8, Math.max(0, fillHeight - 4))
  }
  
  // Label at bottom
  ctx.fillStyle = 'rgba(210, 212, 214, 0.8)'
  ctx.font = '10px monospace'
  ctx.textAlign = 'center'
  ctx.fillText(label, x + width/2, y + height + 14)
}
