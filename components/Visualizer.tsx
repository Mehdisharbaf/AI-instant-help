import React, { useEffect, useRef } from 'react';

interface VisualizerProps {
  isActive: boolean;
  analyser: AnalyserNode | null;
  color?: string;
}

export const Visualizer: React.FC<VisualizerProps> = ({ isActive, analyser, color = '#3b82f6' }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set fixed dimensions to avoid blur
    canvas.width = 300;
    canvas.height = 100;

    const draw = () => {
      if (!isActive || !analyser) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        // Draw a flat line
        ctx.beginPath();
        ctx.moveTo(0, canvas.height / 2);
        ctx.lineTo(canvas.width, canvas.height / 2);
        ctx.strokeStyle = '#334155';
        ctx.lineWidth = 2;
        ctx.stroke();
        return;
      }

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      analyser.getByteFrequencyData(dataArray);

      ctx.fillStyle = '#0f172a'; // bg-slate-900
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const barWidth = (canvas.width / bufferLength) * 2.5;
      let barHeight;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        barHeight = dataArray[i] / 2;
        
        // Create gradient
        const gradient = ctx.createLinearGradient(0, canvas.height, 0, 0);
        gradient.addColorStop(0, color);
        gradient.addColorStop(1, '#a855f7'); // purple-500

        ctx.fillStyle = gradient;
        
        // Center the bars vertically
        const y = (canvas.height - barHeight) / 2;
        
        // Rounded caps for aesthetic
        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, barHeight, 5);
        ctx.fill();

        x += barWidth + 1;
      }

      animationRef.current = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      cancelAnimationFrame(animationRef.current);
    };
  }, [isActive, analyser, color]);

  return <canvas ref={canvasRef} className="w-full h-24 rounded-lg opacity-90" />;
};