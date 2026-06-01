'use client';

import { useEffect, useRef } from 'react';
import { useRadioStream } from '@/hooks/useRadioStream';
import { useRadioStore } from '@/stores/radioStore';

export function SpectrumVisualizer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { getFrequencyData } = useRadioStream();
  const { colors } = useRadioStore();
  const animationRef = useRef<number>();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const draw = () => {
      const dataArray = getFrequencyData();
      const bufferLength = dataArray.length;

      ctx.fillStyle = 'rgba(5, 5, 8, 0.1)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const barWidth = (canvas.width / bufferLength) * 2.5;
      let barHeight: number;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        barHeight = (dataArray[i] / 255) * canvas.height;

        const hue = (i / bufferLength) * 360;
        ctx.fillStyle = `hsl(${hue}, 100%, 50%)`;
        ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);

        x += barWidth + 1;
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