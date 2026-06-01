'use client';

import { useEffect, useRef } from 'react';
import { useRadioStream } from '@/hooks/useRadioStream';
import { useRadioStore } from '@/stores/radioStore';

export function CircularVisualizer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { getFrequencyData } = useRadioStream();
  const { colors } = useRadioStore();
  const animationRef = useRef<number>();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;

    const draw = () => {
      const dataArray = getFrequencyData();

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const radius = Math.min(centerX, centerY) - 50;
      const bars = dataArray.length;
      const angleSlice = (Math.PI * 2) / bars;

      for (let i = 0; i < bars; i++) {
        const angle = angleSlice * i - Math.PI / 2;
        const barHeight = (dataArray[i] / 255) * 100;

        const x1 = centerX + Math.cos(angle) * radius;
        const y1 = centerY + Math.sin(angle) * radius;
        const x2 = centerX + Math.cos(angle) * (radius + barHeight);
        const y2 = centerY + Math.sin(angle) * (radius + barHeight);

        const hue = (i / bars) * 360;
        ctx.strokeStyle = `hsl(${hue}, 100%, 50%)`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }

      animationRef.current = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [getFrequencyData, colors]);

  return <canvas ref={canvasRef} className="w-full h-full" />;
}