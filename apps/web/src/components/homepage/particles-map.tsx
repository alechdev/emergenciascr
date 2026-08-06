import { memo, useCallback, useEffect, useRef } from "react";

import mapData from "@/data/costa_rica.json";
import { cn } from "@/lib/utils";

import type React from "react";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface ParticleOrigin {
  x: number;
  y: number;
}

interface ParticlesMapProps {
  className?: string;
  canvasClassName?: string;
  interactive?: boolean;
}

function ParticlesMap({ className, canvasClassName, interactive = true }: ParticlesMapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | undefined>(undefined);
  const mouseRef = useRef({ x: -1000, y: -1000 });
  const lastTouchTime = useRef<number>(0);
  const touchThrottleMs = 33;

  const particlesRef = useRef<Particle[]>([]);
  const particleOriginsRef = useRef<ParticleOrigin[]>([]);
  const isMouseDownRef = useRef(false);
  const particleSizeRef = useRef<number>(mapData.settings.particleSize);
  const gravityRef = useRef<number>(mapData.settings.gravity);
  const mouseRadiusRef = useRef<number>(mapData.settings.mouseRadius);

  const loadParticlesFromMap = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.width = mapData.canvasWidth;
    canvas.height = mapData.canvasHeight;

    const newParticles: Particle[] = [];
    const newOrigins: ParticleOrigin[] = [];

    for (const particleData of mapData.particles) {
      newParticles.push({
        x: particleData.x,
        y: particleData.y,
        vx: 0,
        vy: 0
      });
      newOrigins.push({
        x: particleData.x,
        y: particleData.y
      });
    }

    particlesRef.current = newParticles;
    particleOriginsRef.current = newOrigins;
  }, []);

  const updateParticles = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const particles = particlesRef.current;
    const origins = particleOriginsRef.current;
    const mouseRadius = mouseRadiusRef.current ?? 100;
    const gravity = gravityRef.current ?? 0.1;
    const isMouseDown = isMouseDownRef.current;

    for (let index = 0; index < particles.length; index += 1) {
      const particle = particles[index];
      if (!particle) continue;
      const dx = mouseRef.current.x - particle.x;
      const dy = mouseRef.current.y - particle.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      let newVx = particle.vx;
      let newVy = particle.vy;

      if (distance < mouseRadius && distance > 0) {
        const force = (mouseRadius - distance) / mouseRadius;
        const angle = Math.atan2(dy, dx);

        const repelForce = isMouseDown ? force * 1.2 : force * 0.6;

        newVx -= Math.cos(angle) * repelForce;
        newVy -= Math.sin(angle) * repelForce;
      }

      const origin = origins[index];
      if (origin) {
        const returnForceX = (origin.x - particle.x) * 0.05;
        const returnForceY = (origin.y - particle.y) * 0.05;

        newVx += returnForceX;
        newVy += returnForceY + gravity;
      }

      newVx *= 0.95;
      newVy *= 0.95;

      particle.x += newVx;
      particle.y += newVy;
      particle.vx = newVx;
      particle.vy = newVy;
    }
  }, []);

  const animate = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const particles = particlesRef.current;
    const origins = particleOriginsRef.current;
    const particleRadius = (particleSizeRef.current ?? 4) / 2.5;

    for (let index = 0; index < particles.length; index += 1) {
      const particle = particles[index];
      if (!particle) continue;
      const origin = origins[index];
      if (origin) {
        const displacement = Math.sqrt((particle.x - origin.x) ** 2 + (particle.y - origin.y) ** 2);
        const maxDisplacement = 50;
        const intensity = Math.min(displacement / maxDisplacement, 1);
        const opacity = Math.max(0.1, 1 - intensity * 1.4);
        const r = Math.floor(30 + intensity * 40);
        const g = Math.floor(80 + intensity * 60);
        const b = Math.floor(150 + intensity * 80);
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${opacity})`;
      } else {
        ctx.fillStyle = "rgba(59, 130, 246, 0.8)";
      }

      ctx.beginPath();
      ctx.arc(particle.x, particle.y, particleRadius, 0, Math.PI * 2);
      ctx.fill();
    }

    updateParticles();
    animationRef.current = requestAnimationFrame(animate);
  }, [updateParticles]);

  useEffect(() => {
    loadParticlesFromMap();
    animationRef.current = requestAnimationFrame(animate);
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [loadParticlesFromMap, animate]);

  const handleMouseMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    mouseRef.current = {
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY
    };
  };

  const handleTouchMove = (event: React.TouchEvent<HTMLCanvasElement>) => {
    event.preventDefault();

    const now = Date.now();
    if (now - lastTouchTime.current < touchThrottleMs) {
      return;
    }
    lastTouchTime.current = now;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const touch = event.touches[0];
    if (!touch) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    mouseRef.current = {
      x: (touch.clientX - rect.left) * scaleX,
      y: (touch.clientY - rect.top) * scaleY
    };
  };

  const handleTouchStart = (event: React.TouchEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    isMouseDownRef.current = true;
    lastTouchTime.current = 0;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const touch = event.touches[0];
    if (!touch) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    mouseRef.current = {
      x: (touch.clientX - rect.left) * scaleX,
      y: (touch.clientY - rect.top) * scaleY
    };
  };

  const handleTouchEnd = (event: React.TouchEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    isMouseDownRef.current = false;
    mouseRef.current = { x: -1000, y: -1000 };
  };

  return (
    <div className={cn("flex w-full items-center justify-center p-8", className)}>
      <canvas
        ref={canvasRef}
        onMouseMove={interactive ? handleMouseMove : undefined}
        onMouseDown={
          interactive
            ? () => {
                isMouseDownRef.current = true;
              }
            : undefined
        }
        onMouseUp={
          interactive
            ? () => {
                isMouseDownRef.current = false;
              }
            : undefined
        }
        onMouseLeave={
          interactive
            ? () => {
                isMouseDownRef.current = false;
              }
            : undefined
        }
        onTouchStart={interactive ? handleTouchStart : undefined}
        onTouchMove={interactive ? handleTouchMove : undefined}
        onTouchEnd={interactive ? handleTouchEnd : undefined}
        className={cn(
          "w-full max-w-[600px]",
          !interactive && "pointer-events-none",
          canvasClassName
        )}
        style={{ aspectRatio: "600/600", touchAction: "none" }}
      />
    </div>
  );
}

export default memo(ParticlesMap);
