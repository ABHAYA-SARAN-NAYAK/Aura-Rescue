import React, { useEffect, useRef } from 'react';
import { BreathDftResult } from '../types/aura';

interface RespirationChartsProps {
  breathResult: BreathDftResult;
  statEng: number;
}

export const RespirationCharts: React.FC<RespirationChartsProps> = ({
  breathResult,
  statEng,
}) => {
  const waveCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const specCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Draw Chest-Wall Micro-Motion Waveform Canvas
  useEffect(() => {
    const canvas = waveCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = '#060a1e';
    ctx.fillRect(0, 0, w, h);

    // Subtle horizontal grid lines
    ctx.strokeStyle = 'rgba(96, 130, 255, 0.14)';
    ctx.lineWidth = 1;
    for (let y = h * 0.25; y < h; y += h * 0.25) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    const samples = breathResult.waveform;
    if (samples.length < 2 || statEng <= 25) {
      // Flat baseline line
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.stroke();

      ctx.fillStyle = 'rgba(148, 163, 184, 0.7)';
      ctx.font = '11px "JetBrains Mono", monospace';
      ctx.fillText(
        statEng <= 25
          ? 'NO STATIONARY CHEST REFLECTION LOCKED (StatEng <= 25)'
          : 'COLLECTING PHASE SAMPLES...',
        14,
        h / 2 - 8
      );
      return;
    }

    const maxAbs = Math.max(4, ...samples.map((v) => Math.abs(v)));
    const isAnimal = breathResult.rr > 30;
    const isFlatline = breathResult.ready && breathResult.rr === 0;
    const strokeColor = isFlatline
      ? '#a78bfa'
      : isAnimal
      ? '#ffb02e'
      : '#22e6f0';

    ctx.save();
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    samples.forEach((val, idx) => {
      const x = (idx / Math.max(1, samples.length - 1)) * w;
      const y = h / 2 - (val / maxAbs) * (h * 0.38);
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.restore();
  }, [breathResult, statEng]);

  // Draw 32-Bin DFT Frequency Spectrum Bar Chart (6 to 48 BPM)
  useEffect(() => {
    const canvas = specCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = '#060a1e';
    ctx.fillRect(0, 0, w, h);

    const bins = breathResult.spectrum;
    const maxPower = Math.max(0.5, ...bins.map((b) => b.power));
    const padBottom = 18;
    const chartH = h - padBottom - 8;
    const barSlotW = w / bins.length;
    const barW = Math.max(3, barSlotW - 3);

    bins.forEach((bin, idx) => {
      const x = idx * barSlotW + 1.5;
      const normH = Math.min(1, bin.power / maxPower);
      const barH = Math.max(2, normH * chartH);
      const y = h - padBottom - barH;

      // Highlight human breathing band (6-30 BPM) in cyan (#22e6f0) and animal band (>30 BPM) in amber (#ffb02e)
      const isPeak =
        breathResult.rr > 0 && Math.abs(bin.bpm - breathResult.bestBpm) <= 1;
      if (bin.bpm <= 30) {
        ctx.fillStyle = isPeak
          ? '#22e6f0'
          : 'rgba(34, 230, 240, 0.45)';
      } else {
        ctx.fillStyle = isPeak
          ? '#ffb02e'
          : 'rgba(255, 176, 46, 0.45)';
      }

      ctx.fillRect(x, y, barW, barH);
    });

    // Frequency band axis labels
    ctx.fillStyle = 'rgba(148, 163, 184, 0.8)';
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.fillText('6 BPM (Human Band 6–30)', 6, h - 4);
    ctx.fillStyle = 'rgba(255, 176, 46, 0.85)';
    ctx.fillText('30+ BPM (Animal Band -> 48)', w - 168, h - 4);
  }, [breathResult]);

  return (
    <div className="aura-card rounded-xl p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold tracking-wider uppercase text-slate-100">
            Respiration Waveform & 32-Bin DFT Spectrum
          </h2>
          <p className="text-xs text-slate-400">
            Hann-windowed 20–30s stationary gate phase demodulation (6–48 BPM)
          </p>
        </div>
        <div className="text-right font-mono">
          <span className="text-xs text-slate-400">PEAK DFT: </span>
          <span className="text-sm font-bold text-[#22e6f0]">
            {breathResult.rr > 0 ? `${breathResult.rr} BPM` : '0 BPM'}
          </span>
          <span className="text-xs text-slate-500 ml-1.5">
            (Conf {Math.round(breathResult.conf * 100)}%)
          </span>
        </div>
      </div>

      {/* Top Canvas: Chest-wall Micro-motion Waveform */}
      <div>
        <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 mb-1">
          <span>CHEST-WALL MICRO-MOTION WAVEFORM (ZERO-MEAN)</span>
          <span>
            WINDOW: {breathResult.spanSeconds.toFixed(1)}s / 20.0s{' '}
            {breathResult.ready ? '[READY]' : '[FILLING]'}
          </span>
        </div>
        <canvas
          ref={waveCanvasRef}
          width={520}
          height={86}
          data-testid="respiration-waveform-canvas"
          className="w-full h-[86px] rounded border border-slate-800 block"
        />
      </div>

      {/* Bottom Canvas: 32-bin DFT Frequency Spectrum */}
      <div>
        <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 mb-1">
          <span>32-BIN DISCRETE FOURIER TRANSFORM SPECTRUM</span>
          <span>
            SNR RATIO: {breathResult.ratio.toFixed(1)}x
          </span>
        </div>
        <canvas
          ref={specCanvasRef}
          width={520}
          height={96}
          data-testid="respiration-spectrum-canvas"
          className="w-full h-[96px] rounded border border-slate-800 block"
        />
      </div>
    </div>
  );
};

interface CsiSparklineCanvasProps {
  history: number[];
}

export const CsiSparklineCanvas: React.FC<CsiSparklineCanvasProps> = ({
  history,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = '#060a1e';
    ctx.fillRect(0, 0, w, h);

    // Threshold reference line at CSI = 15
    const maxV = Math.max(45, ...history);
    const threshY = h - (15 / maxV) * (h - 8) - 4;
    ctx.strokeStyle = 'rgba(255, 176, 46, 0.3)';
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(0, threshY);
    ctx.lineTo(w, threshY);
    ctx.stroke();
    ctx.setLineDash([]);

    if (history.length < 2) return;

    ctx.strokeStyle = '#2dff7a';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    history.forEach((val, idx) => {
      const x = (idx / Math.max(1, history.length - 1)) * w;
      const y = h - (Math.min(maxV, val) / maxV) * (h - 10) - 4;
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }, [history]);

  return (
    <canvas
      ref={canvasRef}
      width={300}
      height={54}
      data-testid="csi-sparkline-canvas"
      className="w-full h-[54px] rounded border border-slate-800 block"
    />
  );
};
