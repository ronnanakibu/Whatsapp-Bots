'use client';

import { useEffect, useRef } from 'react';
import { useRadioStream } from '@/hooks/useRadioStream';
import { useRadioStore } from '@/stores/radioStore';

export function WaveformVisualizer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { getWaveformData } = useRadioStream();
  const { colors } = useRadioStore();
  const animationRef = useRef<number>();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const draw = () => {
      const dataArray = getWaveformData();

      ctx.fillStyle = 'rgba(5, 5, 8, 0.1)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.lineWidth = 3;
      ctx.strokeStyle = colors?.primary || '#8B5CF6';
      ctx.beginPath();

      const sliceWidth = (canvas.width * 1.0) / dataArray.length;
      let x = 0;

      for (let i = 0; i < dataArray.length; i++) {
        const v = dataArray[i] / 128.0;
        const y = (v * canvas.height) / 2;

        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }

        x += sliceWidth;
      }

      ctx.lineTo(canvas.width, canvas.height / 2);
      ctx.stroke();

      animationRef.current = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [getWaveformData, colors]);

  return <canvas ref={canvasRef} className="w-full h-full" />;
}