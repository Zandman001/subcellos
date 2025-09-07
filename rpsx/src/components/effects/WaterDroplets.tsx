import React, { useEffect, useRef, useState, useCallback } from 'react';

interface Droplet {
  id: number;
  x: number;
  y: number;
  velocity: number;
  size: number;
  opacity: number;
  tailLength: number;
  created: number;
}

interface WaterParticle {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  opacity: number;
  life: number;
  maxLife: number;
}

interface WaterRipple {
  id: number;
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  amplitude: number;
  life: number;
  maxLife: number;
}

interface WaterDropletsProps {
  isActive: boolean; // Only show in Acid303 tab
  triggerCount?: number; // Number to trigger droplets externally
}

export default function WaterDroplets({ isActive, triggerCount }: WaterDropletsProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | undefined>(undefined);
  const dropletsRef = useRef<Droplet[]>([]);
  const particlesRef = useRef<WaterParticle[]>([]);
  const ripplesRef = useRef<WaterRipple[]>([]);
  const nextDropletId = useRef(0);
  const nextParticleId = useRef(0);
  const nextRippleId = useRef(0);
  const lastTime = useRef(0);

  // Performance limits to prevent lag
  const MAX_DROPLETS = 25;
  const MAX_PARTICLES = 100;
  const MAX_RIPPLES = 8;

  // Water simulation at bottom
  const waterHeight = 100; // Increased from 60 to 100 for more dramatic effect
  const waveOffset = useRef(0);

  const createDroplet = useCallback(() => {
    if (!isActive) return;
    
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Enforce max droplet limit
    if (dropletsRef.current.length >= MAX_DROPLETS) {
      // Remove oldest droplets to make room
      dropletsRef.current = dropletsRef.current.slice(-MAX_DROPLETS + 1);
    }

    const droplet: Droplet = {
      id: nextDropletId.current++,
      x: Math.random() * canvas.width,
      y: -20,
      velocity: 2 + Math.random() * 3, // 2-5 pixels per frame
      size: 8 + Math.random() * 12, // 8-20px diameter
      opacity: 0.8 + Math.random() * 0.2,
      tailLength: 40 + Math.random() * 30,
      created: Date.now()
    };

    // Add slight horizontal drift to some droplets
    if (Math.random() > 0.7) {
      droplet.velocity *= 0.8; // Slower fall
      droplet.x += (Math.random() - 0.5) * 40; // Drift
    }

    dropletsRef.current.push(droplet);
  }, [isActive]);

  const createSplash = useCallback((x: number, y: number) => {
    // Enforce max particle limit
    if (particlesRef.current.length >= MAX_PARTICLES) {
      // Remove oldest particles to make room
      particlesRef.current = particlesRef.current.slice(-MAX_PARTICLES + 20);
    }

    // Enforce max ripple limit
    if (ripplesRef.current.length >= MAX_RIPPLES) {
      // Remove oldest ripples to make room
      ripplesRef.current = ripplesRef.current.slice(-MAX_RIPPLES + 1);
    }

    const particleCount = 12 + Math.random() * 8; // More particles: 12-20
    
    for (let i = 0; i < particleCount; i++) {
      const angle = (Math.PI * 2 * i) / particleCount + (Math.random() - 0.5) * 0.5;
      const speed = 3 + Math.random() * 6; // Faster particles: 3-9
      
      const particle: WaterParticle = {
        id: nextParticleId.current++,
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 3, // Higher initial velocity
        size: 4 + Math.random() * 6, // Bigger particles: 4-10px
        opacity: 1.0, // Start at full opacity
        life: 0,
        maxLife: 40 + Math.random() * 30 // Longer lasting
      };

      particlesRef.current.push(particle);
    }

    // Create ripple effect - focus on water surface ripples
    const ripple: WaterRipple = {
      id: nextRippleId.current++,
      x,
      y,
      radius: 0,
      maxRadius: 40 + Math.random() * 30,   // Much smaller visual rings: 40-70px
      amplitude: 35 + Math.random() * 30,   // Keep strong water displacement: 35-65px
      life: 0,
      maxLife: 60 + Math.random() * 40      // Shorter ring duration: 60-100 frames
    };

    ripplesRef.current.push(ripple);
  }, []);

  const updateDroplets = useCallback((deltaTime: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    dropletsRef.current = dropletsRef.current.filter(droplet => {
      droplet.y += droplet.velocity;
      
      // Check if droplet reached the water
      const waterSurface = canvas.height - waterHeight;
      if (droplet.y >= waterSurface) {
        createSplash(droplet.x, waterSurface);
        return false; // Remove droplet
      }

      // Remove if off screen
      return droplet.y < canvas.height + 50;
    });

    // Additional safety: enforce hard limit on droplets
    if (dropletsRef.current.length > MAX_DROPLETS) {
      dropletsRef.current = dropletsRef.current.slice(-MAX_DROPLETS);
    }

    // Update particles
    particlesRef.current = particlesRef.current.filter(particle => {
      particle.x += particle.vx;
      particle.y += particle.vy;
      particle.vy += 0.2; // Gravity
      particle.life++;
      
      const lifeFactor = 1 - (particle.life / particle.maxLife);
      particle.opacity = lifeFactor * 0.9;
      particle.size = Math.max(0.5, particle.size * 0.98);

      return particle.life < particle.maxLife;
    });

    // Update ripples
    ripplesRef.current = ripplesRef.current.filter(ripple => {
      ripple.life++;
      const lifeFactor = ripple.life / ripple.maxLife;
      ripple.radius = lifeFactor * ripple.maxRadius;
      ripple.amplitude = (1 - lifeFactor) * ripple.amplitude;

      return ripple.life < ripple.maxLife;
    });

    // Additional safety: enforce hard limits on particles and ripples
    if (particlesRef.current.length > MAX_PARTICLES) {
      particlesRef.current = particlesRef.current.slice(-MAX_PARTICLES);
    }
    if (ripplesRef.current.length > MAX_RIPPLES) {
      ripplesRef.current = ripplesRef.current.slice(-MAX_RIPPLES);
    }
  }, [createSplash]);

  const drawWater = useCallback((ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) => {
    const waterSurface = canvas.height - waterHeight;
    
    // Calculate ripple effects on water surface
    const getRippleHeight = (x: number, baseY: number) => {
      let totalRipple = 0;
      
      ripplesRef.current.forEach(ripple => {
        const distance = Math.abs(x - ripple.x);
        // Use larger area for water displacement than visual rings
        const waterRippleRadius = ripple.radius * 4; // Water effects extend much further
        if (distance < waterRippleRadius) {
          const rippleStrength = 1 - (distance / waterRippleRadius);
          const fadeOut = Math.pow(rippleStrength, 0.6); // Gentler falloff for wider effect
          
          // Enhanced multi-frequency water displacement
          const wave1 = Math.sin(distance * 0.08 - ripple.life * 0.3) * fadeOut * ripple.amplitude;
          const wave2 = Math.sin(distance * 0.2 - ripple.life * 0.5) * fadeOut * ripple.amplitude * 0.6;
          const wave3 = Math.sin(distance * 0.35 - ripple.life * 0.7) * fadeOut * ripple.amplitude * 0.4;
          const wave4 = Math.sin(distance * 0.02 - ripple.life * 0.15) * fadeOut * ripple.amplitude * 0.8; // Long wavelength
          totalRipple += wave1 + wave2 + wave3 + wave4;
        }
      });
      
      return totalRipple;
    };
    
    // Draw water surface with enhanced ripple physics
    const time = Date.now() * 0.003;
    waveOffset.current = time;
    
    ctx.beginPath();
    ctx.moveTo(0, waterSurface);
    
    for (let x = 0; x <= canvas.width; x += 0.5) { // Even higher resolution for ultra-smooth water
      const baseWaveHeight = Math.sin(x * 0.015 + time) * 8 + Math.sin(x * 0.04 + time * 1.3) * 5; // Enhanced base waves
      const rippleHeight = getRippleHeight(x, waterSurface);
      const totalHeight = baseWaveHeight + rippleHeight;
      ctx.lineTo(x, waterSurface + totalHeight);
    }
    
    ctx.lineTo(canvas.width, canvas.height);
    ctx.lineTo(0, canvas.height);
    ctx.closePath();
    
    // Water gradient - ACID GREEN for symbolizing acid
    const gradient = ctx.createLinearGradient(0, waterSurface, 0, canvas.height);
    gradient.addColorStop(0, 'rgba(0, 255, 50, 0.6)');
    gradient.addColorStop(0.3, 'rgba(50, 255, 100, 0.4)');
    gradient.addColorStop(1, 'rgba(0, 200, 50, 0.8)');
    
    ctx.fillStyle = gradient;
    ctx.fill();
    
    // Water surface glow - enhanced for dramatic effect - ACID GREEN
    ctx.strokeStyle = 'rgba(100, 255, 150, 1.0)'; // Full opacity
    ctx.lineWidth = 3; // Thicker line
    ctx.shadowColor = '#64FF96';
    ctx.shadowBlur = 15; // Stronger glow
    ctx.stroke();
    
    // Add second glow layer for extra drama - ACID GREEN
    ctx.strokeStyle = 'rgba(150, 255, 200, 0.6)';
    ctx.lineWidth = 1;
    ctx.shadowBlur = 25;
    ctx.stroke();
    
    ctx.shadowBlur = 0;

    // Draw ripple rings with subtle visibility - focus on water surface ripples - ACID GREEN
    ripplesRef.current.forEach(ripple => {
      const opacity = 1 - (ripple.life / ripple.maxLife);
      if (opacity > 0.1) {
        // Small, subtle ripple ring - ACID GREEN
        ctx.strokeStyle = `rgba(120, 255, 180, ${opacity * 0.3})`; // Even lower opacity
        ctx.lineWidth = 1; // Thin rings
        ctx.shadowColor = '#78FF96';
        ctx.shadowBlur = 4; // Minimal glow
        
        ctx.beginPath();
        ctx.arc(ripple.x, ripple.y, ripple.radius, 0, Math.PI * 2);
        ctx.stroke();
        
        // Very small secondary ring only for the largest ripples - ACID GREEN
        if (ripple.radius > 25 && opacity > 0.4) {
          ctx.strokeStyle = `rgba(150, 255, 200, ${opacity * 0.15})`;
          ctx.lineWidth = 0.5;
          ctx.shadowBlur = 2;
          ctx.beginPath();
          ctx.arc(ripple.x, ripple.y, ripple.radius * 0.6, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    });
    
    ctx.shadowBlur = 0;
  }, []);

  const drawDroplet = useCallback((ctx: CanvasRenderingContext2D, droplet: Droplet) => {
    const { x, y, size, opacity, tailLength } = droplet;
    
    // Draw tail - ACID GREEN
    const gradient = ctx.createLinearGradient(x, y - tailLength, x, y);
    gradient.addColorStop(0, `rgba(100, 255, 150, 0)`);
    gradient.addColorStop(0.5, `rgba(100, 255, 150, ${opacity * 0.3})`);
    gradient.addColorStop(1, `rgba(100, 255, 150, ${opacity * 0.7})`);
    
    ctx.strokeStyle = gradient;
    ctx.lineWidth = size * 0.3;
    ctx.lineCap = 'round';
    ctx.shadowColor = '#64FF96';
    ctx.shadowBlur = 6;
    
    ctx.beginPath();
    ctx.moveTo(x, y - tailLength);
    ctx.lineTo(x, y);
    ctx.stroke();
    
    // Draw droplet head - ACID GREEN
    const headGradient = ctx.createRadialGradient(x, y, 0, x, y, size / 2);
    headGradient.addColorStop(0, `rgba(150, 255, 200, ${opacity})`);
    headGradient.addColorStop(0.7, `rgba(100, 255, 150, ${opacity * 0.8})`);
    headGradient.addColorStop(1, `rgba(50, 200, 100, ${opacity * 0.6})`);
    
    ctx.fillStyle = headGradient;
    ctx.shadowBlur = 12;
    
    ctx.beginPath();
    ctx.arc(x, y, size / 2, 0, Math.PI * 2);
    ctx.fill();
    
    // Inner glow - ACID GREEN
    ctx.fillStyle = `rgba(200, 255, 220, ${opacity * 0.6})`;
    ctx.shadowBlur = 4;
    ctx.beginPath();
    ctx.arc(x, y, size / 4, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.shadowBlur = 0;
  }, []);

  const drawParticle = useCallback((ctx: CanvasRenderingContext2D, particle: WaterParticle) => {
    const { x, y, size, opacity } = particle;
    
    // Enhanced particle with glow and trail effect - ACID GREEN
    ctx.fillStyle = `rgba(100, 255, 150, ${opacity})`;
    ctx.shadowColor = '#64FF96';
    ctx.shadowBlur = 8;
    
    // Main particle
    ctx.beginPath();
    ctx.arc(x, y, size / 2, 0, Math.PI * 2);
    ctx.fill();
    
    // Bright core - ACID GREEN
    ctx.fillStyle = `rgba(200, 255, 220, ${opacity * 0.8})`;
    ctx.shadowBlur = 4;
    ctx.beginPath();
    ctx.arc(x, y, size / 4, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.shadowBlur = 0;
  }, []);

  const animate = useCallback((currentTime: number) => {
    if (!isActive) {
      animationRef.current = requestAnimationFrame(animate);
      return;
    }

    const deltaTime = currentTime - lastTime.current;
    lastTime.current = currentTime;

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) {
      animationRef.current = requestAnimationFrame(animate);
      return;
    }

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Update physics
    updateDroplets(deltaTime);

    // Draw water simulation (includes ripples)
    drawWater(ctx, canvas);

    // Draw droplets
    dropletsRef.current.forEach(droplet => {
      drawDroplet(ctx, droplet);
    });

    // Draw splash particles
    particlesRef.current.forEach(particle => {
      drawParticle(ctx, particle);
    });

    animationRef.current = requestAnimationFrame(animate);
  }, [isActive, updateDroplets, drawWater, drawDroplet, drawParticle]);

  // Setup canvas and animation
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resizeCanvas = () => {
      const parent = canvas.parentElement;
      if (parent) {
        canvas.width = parent.clientWidth;
        canvas.height = parent.clientHeight;
      }
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [animate]);

  // Trigger droplets when triggerCount changes
  const previousTriggerCount = useRef(0);
  useEffect(() => {
    if (triggerCount && triggerCount > previousTriggerCount.current) {
      const count = triggerCount - previousTriggerCount.current;
      for (let i = 0; i < count; i++) {
        setTimeout(() => {
          createDroplet();
        }, i * 50);
      }
    }
    previousTriggerCount.current = triggerCount || 0;
  }, [triggerCount, createDroplet]);

  if (!isActive) {
    return null;
  }

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 10,
        mixBlendMode: 'screen'
      }}
    />
  );
}
