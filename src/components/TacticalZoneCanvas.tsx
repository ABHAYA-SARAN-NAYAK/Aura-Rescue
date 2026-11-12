import React, { useEffect, useRef, useState } from 'react';
import {
  CsiLink,
  NodeStatus,
  TacticalTargetMarker,
} from '../types/aura';

interface TacticalZoneCanvasProps {
  nodes: NodeStatus[];
  csiLinks: CsiLink[];
  targets: TacticalTargetMarker[];
  gateStat: number[];
  gateMov: number[];
  classifierMode: 'RF' | 'RULES';
  onToggleClassifierMode: (mode: 'RF' | 'RULES') => void;
  hasCustomRfModel: boolean;
}

export const TacticalZoneCanvas: React.FC<TacticalZoneCanvasProps> = ({
  nodes,
  csiLinks,
  targets,
  gateStat,
  gateMov,
  classifierMode,
  onToggleClassifierMode,
  hasCustomRfModel,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [showRadarRings, setShowRadarRings] = useState(true);
  const [showCsiLinks, setShowCsiLinks] = useState(true);
  const [showTrails, setShowTrails] = useState(true);
  const [presetLayout, setPresetLayout] = useState<'CORNERS' | 'DIAMOND'>('CORNERS');
  const [zoomOffset, setZoomOffset] = useState({ scale: 1, panX: 0, panY: 0 });
  const [hoverCoord, setHoverCoord] = useState<{ xM: number; yM: number } | null>(
    null
  );

  // Store latest props in ref for smooth 30fps animation loop without tearing down canvas
  const stateRef = useRef({
    nodes,
    csiLinks,
    targets,
    gateStat,
    gateMov,
    showRadarRings,
    showCsiLinks,
    showTrails,
    presetLayout,
    zoomOffset,
  });

  useEffect(() => {
    stateRef.current = {
      nodes,
      csiLinks,
      targets,
      gateStat,
      gateMov,
      showRadarRings,
      showCsiLinks,
      showTrails,
      presetLayout,
      zoomOffset,
    };
  }, [
    nodes,
    csiLinks,
    targets,
    gateStat,
    gateMov,
    showRadarRings,
    showCsiLinks,
    showTrails,
    presetLayout,
    zoomOffset,
  ]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId = 0;
    let phase = 0;

    const render = () => {
      phase += 0.045;
      const {
        nodes: curNodes,
        csiLinks: curLinks,
        targets: curTargets,
        showRadarRings: ringsOn,
        showCsiLinks: linksOn,
        showTrails: trailsOn,
        presetLayout: layoutMode,
        zoomOffset: viewTransform,
      } = stateRef.current;

      const width = canvas.width;
      const height = canvas.height;
      ctx.clearRect(0, 0, width, height);

      // Deep Navy tactical canvas background
      const bgGrad = ctx.createRadialGradient(
        width * 0.5,
        height * 0.5,
        20,
        width * 0.5,
        height * 0.5,
        width * 0.65
      );
      bgGrad.addColorStop(0, '#0b1336');
      bgGrad.addColorStop(1, '#060a1e');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, width, height);

      const pad = 46;
      const roomW = 4.0;
      const roomH = 4.2;
      const usableW = (width - pad * 2) * viewTransform.scale;
      const usableH = (height - pad * 2) * viewTransform.scale;
      const originX = pad + viewTransform.panX;
      const originY = pad + viewTransform.panY;

      const toPxX = (xM: number) => originX + (xM / roomW) * usableW;
      const toPxY = (yM: number) => originY + (yM / roomH) * usableH;

      // 1. 24x24 Dynamic Gaussian Occupancy Heatmap
      const gridN = 24;
      const cellW = usableW / gridN;
      const cellH = usableH / gridN;

      if (curTargets.length > 0) {
        for (let gx = 0; gx < gridN; gx++) {
          for (let gy = 0; gy < gridN; gy++) {
            const cellXm = ((gx + 0.5) / gridN) * roomW;
            const cellYm = ((gy + 0.5) / gridN) * roomH;

            let heat = 0;
            let domCategory: TacticalTargetMarker['category'] = 'SURVIVOR';
            for (const tgt of curTargets) {
              const dx = cellXm - tgt.x;
              const dy = cellYm - tgt.y;
              const distSq = dx * dx + dy * dy;
              const contrib = Math.exp(-distSq / (2 * 0.42 * 0.42));
              if (contrib > heat) {
                heat = contrib;
                domCategory = tgt.category;
              }
            }

            if (heat > 0.06) {
              const alpha = Math.min(0.34, heat * 0.32);
              if (domCategory === 'SURVIVOR') {
                ctx.fillStyle = `rgba(34, 230, 240, ${alpha})`;
              } else if (domCategory === 'DEAD') {
                ctx.fillStyle = `rgba(167, 139, 250, ${alpha})`;
              } else if (domCategory === 'PET') {
                ctx.fillStyle = `rgba(255, 176, 46, ${alpha})`;
              } else if (domCategory === 'RESCUER') {
                ctx.fillStyle = `rgba(229, 32, 46, ${alpha})`;
              } else {
                ctx.fillStyle = `rgba(245, 158, 11, ${alpha})`;
              }
              ctx.fillRect(
                originX + gx * cellW,
                originY + gy * cellH,
                cellW + 0.5,
                cellH + 0.5
              );
            }
          }
        }
      }

      // 2. Room Boundary & Coordinate Grid (0.5m intervals)
      ctx.strokeStyle = 'rgba(96, 130, 255, 0.14)';
      ctx.lineWidth = 1;
      for (let xm = 0; xm <= roomW + 0.01; xm += 0.5) {
        const px = toPxX(xm);
        ctx.beginPath();
        ctx.moveTo(px, originY);
        ctx.lineTo(px, originY + usableH);
        ctx.stroke();
      }
      for (let ym = 0; ym <= roomH + 0.01; ym += 0.5) {
        const py = toPxY(ym);
        ctx.beginPath();
        ctx.moveTo(originX, py);
        ctx.lineTo(originX + usableW, py);
        ctx.stroke();
      }

      // Polar grid overlay centered on room
      const centerPxX = toPxX(roomW / 2);
      const centerPxY = toPxY(roomH / 2);
      ctx.strokeStyle = 'rgba(96, 130, 255, 0.09)';
      for (let r = 0.2; r <= 0.9; r += 0.22) {
        ctx.beginPath();
        ctx.arc(centerPxX, centerPxY, usableW * r * 0.5, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Outer tactical room border
      ctx.strokeStyle = 'rgba(96, 130, 255, 0.45)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(originX, originY, usableW, usableH);

      // Axis distance labels
      ctx.fillStyle = 'rgba(148, 163, 184, 0.75)';
      ctx.font = '10px "JetBrains Mono", monospace';
      for (let xm = 0; xm <= 4; xm += 1) {
        ctx.fillText(`${xm.toFixed(1)}m`, toPxX(xm) - 12, originY - 10);
      }
      for (let ym = 1; ym <= 4; ym += 1) {
        ctx.fillText(`${ym.toFixed(1)}m`, 6, toPxY(ym) + 3);
      }

      // 3. 120° mmWave Radar FOV Cone & Range Gate Arcs from Node 1 (0,0)
      if (ringsOn) {
        const n1PxX = toPxX(0);
        const n1PxY = toPxY(0);
        const centerAngle = Math.atan2(usableH, usableW); // ~46 deg diagonal into room
        const fovRad = (120 * Math.PI) / 180;
        const startAngle = Math.max(0, centerAngle - fovRad / 2);
        const endAngle = Math.min(Math.PI / 2, centerAngle + fovRad / 2);

        // Subtle FOV cone fill
        const maxRadiusPx = (6.0 / roomW) * usableW;
        const coneGrad = ctx.createRadialGradient(
          n1PxX,
          n1PxY,
          10,
          n1PxX,
          n1PxY,
          maxRadiusPx
        );
        coneGrad.addColorStop(0, 'rgba(34, 230, 240, 0.14)');
        coneGrad.addColorStop(0.7, 'rgba(34, 230, 240, 0.04)');
        coneGrad.addColorStop(1, 'rgba(34, 230, 240, 0.0)');

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(n1PxX, n1PxY);
        ctx.arc(n1PxX, n1PxY, maxRadiusPx, startAngle, endAngle);
        ctx.closePath();
        ctx.fillStyle = coneGrad;
        ctx.fill();
        ctx.restore();

        // Dashed range-gate arcs at gate * 0.75m
        ctx.save();
        ctx.setLineDash([4, 4]);
        for (let g = 1; g <= 7; g++) {
          const distM = g * 0.75;
          const rPx = (distM / roomW) * usableW;
          const isGateActive =
            (stateRef.current.gateStat[g] || 0) > 25 ||
            (stateRef.current.gateMov[g] || 0) > 35;

          ctx.strokeStyle = isGateActive
            ? 'rgba(34, 230, 240, 0.55)'
            : 'rgba(34, 230, 240, 0.18)';
          ctx.lineWidth = isGateActive ? 1.5 : 1;
          ctx.beginPath();
          ctx.arc(n1PxX, n1PxY, rPx, 0.03, Math.PI / 2 - 0.03);
          ctx.stroke();

          // Gate label along diagonal
          const lblX = n1PxX + rPx * Math.cos(centerAngle);
          const lblY = n1PxY + rPx * Math.sin(centerAngle);
          if (lblX < originX + usableW - 18 && lblY < originY + usableH - 12) {
            ctx.fillStyle = isGateActive
              ? 'rgba(34, 230, 240, 0.95)'
              : 'rgba(148, 163, 184, 0.55)';
            ctx.font = '9px "JetBrains Mono", monospace';
            ctx.fillText(`G${g} (${distM.toFixed(2)}m)`, lblX + 4, lblY - 4);
          }
        }
        ctx.restore();
      }

      // Compute effective node positions (CORNERS vs DIAMOND preset layout)
      const getNodePos = (n: NodeStatus) => {
        if (layoutMode === 'DIAMOND') {
          if (n.id === 1) return { x: 0.2, y: 0.2 };
          if (n.id === 2) return { x: 3.8, y: 0.6 };
          if (n.id === 3) return { x: 3.6, y: 3.9 };
          return { x: 0.4, y: 3.8 };
        }
        return { x: n.x, y: n.y };
      };

      // 4. 6 Curved Wi-Fi CSI Link Beams between all node pairs
      if (linksOn) {
        for (const link of curLinks) {
          const nA = curNodes.find((n) => n.id === link.fromNode);
          const nB = curNodes.find((n) => n.id === link.toNode);
          if (!nA || !nB) continue;

          const posA = getNodePos(nA);
          const posB = getNodePos(nB);
          const x1 = toPxX(posA.x);
          const y1 = toPxY(posA.y);
          const x2 = toPxX(posB.x);
          const y2 = toPxY(posB.y);

          // Shift color from blue (#3b82f6) to crimson (#e5202e) as CSI motion variance increases
          const normVar = Math.min(1, link.variance / 35);
          const r = Math.round(59 + normVar * (255 - 59));
          const g = Math.round(130 - normVar * 70);
          const b = Math.round(246 - normVar * 165);
          const alpha = 0.25 + normVar * 0.6;

          const midX = (x1 + x2) / 2;
          const midY = (y1 + y2) / 2;
          // Slight inward curve toward room center
          const ctrlX = midX + (centerPxX - midX) * 0.16;
          const ctrlY = midY + (centerPxY - midY) * 0.16;

          ctx.save();
          ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
          ctx.lineWidth = 1.2 + normVar * 2.4;
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.quadraticCurveTo(ctrlX, ctrlY, x2, y2);
          ctx.stroke();
          ctx.restore();
        }
      }

      // 5. Pulsing Target Markers, Motion Trails, Ripple Rings & Lock Rings
      for (const tgt of curTargets) {
        const tx = toPxX(tgt.x);
        const ty = toPxY(tgt.y);

        const colorMap: Record<
          TacticalTargetMarker['category'],
          { hex: string; rgb: string }
        > = {
          SURVIVOR: { hex: '#22e6f0', rgb: '34, 230, 240' },
          DEAD: { hex: '#a78bfa', rgb: '167, 139, 250' },
          PET: { hex: '#ffb02e', rgb: '255, 176, 46' },
          RESCUER: { hex: '#ff4d5a', rgb: '255, 77, 90' },
          CHECKING: { hex: '#f59e0b', rgb: '245, 158, 11' },
        };
        const palette = colorMap[tgt.category];

        // Motion trail
        if (trailsOn && tgt.trail.length > 1) {
          ctx.save();
          ctx.strokeStyle = `rgba(${palette.rgb}, 0.45)`;
          ctx.lineWidth = 2;
          ctx.beginPath();
          tgt.trail.forEach((pt, idx) => {
            const px = toPxX(pt.x);
            const py = toPxY(pt.y);
            if (idx === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          });
          ctx.stroke();
          ctx.restore();
        }

        // Expanding ripple rings
        const ripple1 = (phase % 1) * 34 + 10;
        const rippleAlpha1 = Math.max(0, (1 - (phase % 1)) * 0.65);
        ctx.beginPath();
        ctx.arc(tx, ty, ripple1, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${palette.rgb}, ${rippleAlpha1})`;
        ctx.lineWidth = 1.8;
        ctx.stroke();

        // White dashed tactical lock ring
        ctx.save();
        ctx.translate(tx, ty);
        ctx.rotate(phase * 0.35);
        ctx.setLineDash([5, 4]);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(0, 0, 17, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();

        // Center target core
        ctx.beginPath();
        ctx.arc(tx, ty, 7, 0, Math.PI * 2);
        ctx.fillStyle = palette.hex;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#060a1e';
        ctx.stroke();

        // Target callout tag
        ctx.fillStyle = 'rgba(6, 10, 30, 0.88)';
        ctx.strokeStyle = palette.hex;
        ctx.lineWidth = 1;
        const tagText = `${tgt.label} · G${tgt.gate} (${tgt.distanceM}m)`;
        ctx.font = 'bold 11px "JetBrains Mono", monospace';
        const textW = ctx.measureText(tagText).width;
        const boxX = Math.min(width - textW - 22, Math.max(8, tx + 18));
        const boxY = Math.max(24, ty - 14);
        ctx.fillRect(boxX, boxY - 13, textW + 12, 19);
        ctx.strokeRect(boxX, boxY - 13, textW + 12, 19);
        ctx.fillStyle = palette.hex;
        ctx.fillText(tagText, boxX + 6, boxY);
      }

      // 6. 4 ESP32 Mesh Nodes at Corners
      for (const node of curNodes) {
        const pos = getNodePos(node);
        const nx = toPxX(pos.x);
        const ny = toPxY(pos.y);

        // TDMA Active TX Halo
        if (node.isTxSlot) {
          ctx.beginPath();
          ctx.arc(nx, ny, 18 + Math.sin(phase * 3) * 3, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(255, 176, 46, 0.24)';
          ctx.fill();
          ctx.strokeStyle = '#ffb02e';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }

        ctx.beginPath();
        ctx.arc(nx, ny, 9, 0, Math.PI * 2);
        ctx.fillStyle = node.isTxSlot
          ? '#ffb02e'
          : node.id === 1
          ? '#22e6f0'
          : '#2dff7a';
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#060a1e';
        ctx.stroke();

        ctx.fillStyle = '#060a1e';
        ctx.font = 'bold 10px "JetBrains Mono", monospace';
        ctx.fillText(String(node.id), nx - 3, ny + 3.5);

        // Node corner label
        const labelOffsetX = pos.x < 2 ? 14 : -82;
        const labelOffsetY = pos.y < 2 ? 18 : -10;
        ctx.fillStyle = node.isTxSlot ? '#ffb02e' : '#cbd5e1';
        ctx.font = '600 10px "JetBrains Mono", monospace';
        ctx.fillText(
          node.id === 1 ? 'N1 HUB+RADAR' : `NODE ${node.id} CSI`,
          nx + labelOffsetX,
          ny + labelOffsetY
        );
      }

      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animId);
  }, []);

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const px = (e.clientX - rect.left) * scaleX;
    const py = (e.clientY - rect.top) * scaleY;

    const pad = 46;
    const usableW = (canvas.width - pad * 2) * zoomOffset.scale;
    const usableH = (canvas.height - pad * 2) * zoomOffset.scale;
    const xM = ((px - pad - zoomOffset.panX) / usableW) * 4.0;
    const yM = ((py - pad - zoomOffset.panY) / usableH) * 4.2;

    if (xM >= 0 && xM <= 4.0 && yM >= 0 && yM <= 4.2) {
      setHoverCoord({ xM: Number(xM.toFixed(2)), yM: Number(yM.toFixed(2)) });
    } else {
      setHoverCoord(null);
    }
  };

  return (
    <div className="aura-card rounded-xl p-4 flex flex-col gap-3">
      {/* Header & Classifier Mode Toggle */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold tracking-wider uppercase text-slate-100">
            Interactive 2D Tactical Zone Map (4.0m × 4.2m Sector)
          </h2>
          <p className="text-xs text-slate-400">
            24×24 Gaussian occupancy field · 120° HLK-LD2410B mmWave cone · 6 ESP-NOW CSI links
          </p>
        </div>

        {/* Classifier Mode Segmented Pill */}
        <div
          className="flex items-center bg-[#060a1e]/90 border border-slate-700/80 rounded-lg p-1 gap-1"
          role="group"
          aria-label="Classifier Engine Mode"
        >
          <button
            type="button"
            onClick={() => onToggleClassifierMode('RF')}
            className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              classifierMode === 'RF'
                ? 'bg-[#22e6f0] text-slate-950 font-semibold'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            AI Random Forest {hasCustomRfModel ? '(Custom)' : '(25 Trees)'}
          </button>
          <button
            type="button"
            onClick={() => onToggleClassifierMode('RULES')}
            className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              classifierMode === 'RULES'
                ? 'bg-[#ffb02e] text-slate-950 font-semibold'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            Simple Threshold Rules
          </button>
        </div>
      </div>

      {/* Canvas Viewport */}
      <div className="relative rounded-lg overflow-hidden border border-slate-800 bg-[#060a1e]">
        <canvas
          ref={canvasRef}
          width={640}
          height={360}
          data-testid="tactical-zone-canvas"
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHoverCoord(null)}
          className="w-full h-[300px] sm:h-[330px] block cursor-crosshair"
        />

        {/* Live Coordinate & Legend Overlay */}
        <div className="absolute bottom-2.5 left-3 right-3 flex flex-wrap items-center justify-between gap-2 pointer-events-none text-[11px] font-mono">
          <div className="flex items-center gap-3 bg-[#060a1e]/85 border border-slate-800 px-2.5 py-1 rounded text-slate-300">
            <span className="text-[#22e6f0]">SURV1: Survivor</span>
            <span className="text-slate-600">·</span>
            <span className="text-[#a78bfa]">DEAD?1: No Breath</span>
            <span className="text-slate-600">·</span>
            <span className="text-[#ffb02e]">PET1: Animal</span>
            <span className="text-slate-600">·</span>
            <span className="text-[#ff4d5a]">RESC1: Rescuer</span>
          </div>
          <div className="bg-[#060a1e]/85 border border-slate-800 px-2.5 py-1 rounded text-slate-300">
            {hoverCoord
              ? `CURSOR: X=${hoverCoord.xM.toFixed(2)}m, Y=${hoverCoord.yM.toFixed(2)}m`
              : 'GRID: 0.50m / GATE: 0.75m'}
          </div>
        </div>
      </div>

      {/* Map Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setShowRadarRings((v) => !v)}
            className={`px-2.5 py-1.5 text-xs font-mono rounded border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              showRadarRings
                ? 'bg-cyan-500/15 border-cyan-400/50 text-cyan-300'
                : 'bg-slate-900/60 border-slate-700 text-slate-400 hover:text-slate-200'
            }`}
          >
            Radar Rings: {showRadarRings ? 'ON' : 'OFF'}
          </button>
          <button
            type="button"
            onClick={() => setShowCsiLinks((v) => !v)}
            className={`px-2.5 py-1.5 text-xs font-mono rounded border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              showCsiLinks
                ? 'bg-blue-500/15 border-blue-400/50 text-blue-300'
                : 'bg-slate-900/60 border-slate-700 text-slate-400 hover:text-slate-200'
            }`}
          >
            CSI Links: {showCsiLinks ? 'ON' : 'OFF'}
          </button>
          <button
            type="button"
            onClick={() => setShowTrails((v) => !v)}
            className={`px-2.5 py-1.5 text-xs font-mono rounded border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              showTrails
                ? 'bg-emerald-500/15 border-emerald-400/50 text-emerald-300'
                : 'bg-slate-900/60 border-slate-700 text-slate-400 hover:text-slate-200'
            }`}
          >
            Trails: {showTrails ? 'ON' : 'OFF'}
          </button>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() =>
              setPresetLayout((p) => (p === 'CORNERS' ? 'DIAMOND' : 'CORNERS'))
            }
            className="px-2.5 py-1.5 text-xs font-mono rounded border border-slate-700 bg-slate-900/70 text-slate-300 hover:text-white hover:border-slate-500 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Preset Layout ({presetLayout === 'CORNERS' ? '4m×4.2m Corners' : 'Perimeter Inset'})
          </button>
          <button
            type="button"
            onClick={() => {
              setPresetLayout('CORNERS');
              setShowRadarRings(true);
              setShowCsiLinks(true);
              setShowTrails(true);
              setZoomOffset({ scale: 1, panX: 0, panY: 0 });
            }}
            className="px-2.5 py-1.5 text-xs font-mono rounded border border-slate-700 bg-slate-900/70 text-slate-300 hover:text-white hover:border-slate-500 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Reset View
          </button>
        </div>
      </div>
    </div>
  );
};
