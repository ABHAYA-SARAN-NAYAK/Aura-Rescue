import React from 'react';
import {
  BannerStateId,
  BreathDftResult,
  CalibrationBaseline,
  ClassificationOutput,
  CsiLink,
  ESP32RawPacket,
  NodeStatus,
  ScenarioId,
} from '../types/aura';
import { SCENARIO_DEFINITIONS } from '../utils/scenarioSimulator';
import { TacticalZoneCanvas } from './TacticalZoneCanvas';
import { CsiSparklineCanvas, RespirationCharts } from './RespirationCharts';

interface TacticalMonitorViewProps {
  mode: 'DEMO' | 'LIVE';
  onToggleMode: (mode: 'DEMO' | 'LIVE') => void;
  scenario: ScenarioId;
  onSelectScenario: (scenario: ScenarioId) => void;
  onRestartBreathingCheck: () => void;
  onConnectUsbSerial: () => void;
  serialConnected: boolean;
  serialStatusMsg: string;
  httpPollEnabled: boolean;
  onToggleHttpPoll: () => void;
  packet: ESP32RawPacket;
  calibratedGates: {
    gateMov: number[];
    gateStat: number[];
    csiVar: number;
    peakMovGate: number;
    peakStatGate: number;
    movEng: number;
    statEng: number;
  };
  breathResult: BreathDftResult;
  classification: ClassificationOutput;
  nodes: NodeStatus[];
  csiLinks: CsiLink[];
  meanRssi: number;
  csiHistory: number[];
  classifierMode: 'RF' | 'RULES';
  onToggleClassifierMode: (mode: 'RF' | 'RULES') => void;
  hasCustomRfModel: boolean;
  baseline: CalibrationBaseline;
  onClearBaseline: () => void;
}

export const TacticalMonitorView: React.FC<TacticalMonitorViewProps> = ({
  mode,
  onToggleMode,
  scenario,
  onSelectScenario,
  onRestartBreathingCheck,
  onConnectUsbSerial,
  serialConnected,
  serialStatusMsg,
  httpPollEnabled,
  onToggleHttpPoll,
  packet,
  calibratedGates,
  breathResult,
  classification,
  nodes,
  csiLinks,
  meanRssi,
  csiHistory,
  classifierMode,
  onToggleClassifierMode,
  hasCustomRfModel,
  baseline,
  onClearBaseline,
}) => {
  // A. TOP EMERGENCY STATUS BANNER CONFIGURATION (8 Priority States)
  const getBannerConfig = (state: BannerStateId) => {
    switch (state) {
      case 'HAZARD':
        return {
          wrapperClass:
            'bg-[#2a0812]/95 border-2 border-[#ff4d5a] shadow-[0_0_28px_rgba(229,32,46,0.35)]',
          badgeColor: 'text-[#ff4d5a]',
          title:
            '⚠️ ELECTRICAL HAZARD DETECTED! 50/60Hz Live Mains EMF Induction — Cut circuit before entry!',
          subtitle: `LM386 Non-Contact Probe: ${packet.lm386Vpp} Vpp (>= 350 Vpp critical limit) · Live Current Flag: ${packet.liveCurrent}`,
        };
      case 'SOS': {
        const sosTag = packet.tags.find((t) => t.sos);
        return {
          wrapperClass:
            'bg-[#2a0812]/95 border-2 border-[#ff4d5a] shadow-[0_0_28px_rgba(229,32,46,0.35)]',
          badgeColor: 'text-[#ff4d5a]',
          title: '🆘 RESCUER SOS — Wrist tag emergency triggered!',
          subtitle: `Rescuer Wrist Beacon #${sosTag?.id || 1} SOS Latch Active · RSSI ${sosTag?.rssi || -54} dBm · Peak Gate G${calibratedGates.peakMovGate} (${(calibratedGates.peakMovGate * 0.75).toFixed(2)}m)`,
        };
      }
      case 'SURVIVOR':
        return {
          wrapperClass:
            'bg-[#071f2e]/90 border-2 border-[#22e6f0] shadow-[0_0_24px_rgba(34,230,240,0.22)]',
          badgeColor: 'text-[#22e6f0]',
          title: `SURVIVOR LIKELY (TRAPPED) — Gate ${calibratedGates.peakStatGate} · ${(calibratedGates.peakStatGate * 0.75).toFixed(2)}m · ${breathResult.rr || 16} RPM`,
          subtitle: `Stationary Energy ${calibratedGates.statEng}/100 · DFT Spectral Confidence ${Math.round(breathResult.conf * 100)}% · Classifier: ${classification.mlPredictedClass}`,
        };
      case 'DEAD':
        return {
          wrapperClass:
            'bg-[#191032]/90 border-2 border-[#a78bfa] shadow-[0_0_22px_rgba(167,139,250,0.22)]',
          badgeColor: 'text-[#a78bfa]',
          title:
            'NO BREATHING DETECTED — Still body with zero respiration over 20s window (possible casualty; rescuer must verify)',
          subtitle: `Stationary Reflection at Gate ${calibratedGates.peakStatGate} (${(calibratedGates.peakStatGate * 0.75).toFixed(2)}m, StatEng ${calibratedGates.statEng}) · 0 RPM detected across 6–48 BPM DFT band`,
        };
      case 'CHECKING':
        return {
          wrapperClass:
            'bg-[#261a08]/90 border-2 border-[#ffb02e] shadow-[0_0_20px_rgba(255,176,46,0.18)]',
          badgeColor: 'text-[#ffb02e]',
          title: 'STILL TARGET · CHECKING BREATHING',
          subtitle: `Sampling stationary micro-motion at Gate ${calibratedGates.peakStatGate} (${(calibratedGates.peakStatGate * 0.75).toFixed(2)}m) — ${breathResult.spanSeconds.toFixed(1)}s / 20.0s DFT integration window`,
        };
      case 'PET':
        return {
          wrapperClass:
            'bg-[#261a08]/90 border-2 border-[#ffb02e] shadow-[0_0_20px_rgba(255,176,46,0.2)]',
          badgeColor: 'text-[#ffb02e]',
          title: `PET / ANIMAL LIKELY — Rapid Breathing (${breathResult.rr} RPM > 30 RPM Band)`,
          subtitle: `Gate ${calibratedGates.peakStatGate} (${(calibratedGates.peakStatGate * 0.75).toFixed(2)}m) · Stationary Energy ${calibratedGates.statEng}/100 · High-frequency chest oscillation`,
        };
      case 'RESCUER': {
        const tag = packet.tags[0];
        return {
          wrapperClass:
            'bg-[#260d18]/90 border-2 border-[#ff4d5a]/80 shadow-[0_0_18px_rgba(229,32,46,0.18)]',
          badgeColor: 'text-[#ff4d5a]',
          title: `RESCUER IN ACTIVE MOTION — Wrist Tag #${tag?.id || 1} Confirmed (${tag?.rssi || -58} dBm)`,
          subtitle: `Moving Gate G${calibratedGates.peakMovGate} (${(calibratedGates.peakMovGate * 0.75).toFixed(2)}m) · MovEng ${calibratedGates.movEng} · Wi-Fi CSI Variance ${calibratedGates.csiVar.toFixed(1)}`,
        };
      }
      case 'CLEAR':
      default:
        return {
          wrapperClass:
            'bg-[#062118]/90 border border-[#2dff7a]/60 shadow-[0_0_18px_rgba(45,255,122,0.12)]',
          badgeColor: 'text-[#2dff7a]',
          title: 'ZONE CLEAR — Perimeter scan active',
          subtitle: `4/4 ESP32 Mesh Nodes synchronized · All 9 mmWave range gates below occupancy threshold · LM386 EMF safe (${packet.lm386Vpp} Vpp)`,
        };
    }
  };

  const banner = getBannerConfig(classification.bannerState);
  const activeTag = packet.tags[0];

  return (
    <div className="flex flex-col gap-4 pb-24">
      {/* A. TOP EMERGENCY STATUS BANNER */}
      <section
        aria-label="Emergency Tactical Status Banner"
        data-testid="emergency-status-banner"
        className={`rounded-xl px-5 py-3.5 transition-all duration-200 ${banner.wrapperClass}`}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2.5 text-xs font-mono uppercase tracking-wider text-slate-300">
              <span className={`font-bold ${banner.badgeColor}`}>
                PRIORITY STATUS: {classification.bannerState}
              </span>
              <span>·</span>
              <span>
                CLASSIFIER:{' '}
                {classifierMode === 'RF'
                  ? `RANDOM FOREST (${classification.confidencePct}%)`
                  : `THRESHOLD RULES (${classification.confidencePct}%)`}
              </span>
              {baseline.active && (
                <>
                  <span>·</span>
                  <span className="text-emerald-300">
                    BASELINE CALIBRATED
                  </span>
                </>
              )}
            </div>
            <h1 className="text-lg sm:text-xl font-bold tracking-tight text-white">
              {banner.title}
            </h1>
            <p className="text-xs sm:text-sm font-mono text-slate-300">
              {banner.subtitle}
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {calibratedGates.statEng > 25 && (
              <button
                type="button"
                onClick={onRestartBreathingCheck}
                className="px-3 py-1.5 text-xs font-mono font-medium rounded-lg border border-amber-400/50 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Test 0–20s Breath Check
              </button>
            )}
            {baseline.active && (
              <button
                type="button"
                onClick={onClearBaseline}
                className="px-3 py-1.5 text-xs font-mono font-medium rounded-lg border border-slate-600 bg-slate-800/80 text-slate-300 hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Clear Baseline
              </button>
            )}
          </div>
        </div>

        {/* Live 0-20s Progress Bar when Checking Breathing */}
        {classification.bannerState === 'CHECKING' && (
          <div className="mt-3">
            <div className="flex items-center justify-between text-xs font-mono text-amber-300 mb-1">
              <span>DFT PHASE BUFFER ACCUMULATION (MIN 20.0 SECONDS)</span>
              <span>
                {breathResult.spanSeconds.toFixed(1)}s / 20.0s (
                {Math.round(breathResult.progress * 100)}%)
              </span>
            </div>
            <div className="w-full h-2.5 bg-slate-950/90 rounded-full overflow-hidden border border-amber-500/40">
              <div
                className="h-full bg-[#ffb02e] transition-all duration-150"
                style={{ width: `${Math.round(breathResult.progress * 100)}%` }}
              />
            </div>
          </div>
        )}
      </section>

      {/* B. 4 KPI SUMMARY CARDS (Top Row) */}
      <section
        aria-label="Key Tactical Telemetry Metrics"
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5"
      >
        {/* Card 1 (Hero Red Border): TARGET IN ZONE */}
        <div
          data-testid="kpi-target-in-zone"
          className="aura-card-danger rounded-xl p-4 flex flex-col justify-between"
        >
          <div className="flex items-center justify-between text-xs font-mono uppercase tracking-wider text-rose-300">
            <span>TARGET IN ZONE</span>
            <span>GATE {calibratedGates.statEng > 25 ? calibratedGates.peakStatGate : calibratedGates.peakMovGate}</span>
          </div>
          <div className="my-1.5 flex items-baseline justify-between gap-2">
            <span
              className={`text-2xl sm:text-3xl font-bold font-display tracking-tight ${
                classification.targetKpiLabel === 'SURVIVOR' ||
                classification.targetKpiLabel === '2 PEOPLE'
                  ? 'text-[#22e6f0]'
                  : classification.targetKpiLabel === 'NO BREATHING'
                  ? 'text-[#a78bfa]'
                  : classification.targetKpiLabel === 'PET'
                  ? 'text-[#ffb02e]'
                  : classification.targetKpiLabel === 'NONE'
                  ? 'text-[#2dff7a]'
                  : 'text-[#ff4d5a]'
              }`}
            >
              {classification.targetKpiLabel}
            </span>
            <span className="text-lg font-mono font-bold text-white">
              {classification.targetRangeM.toFixed(2)} m
            </span>
          </div>
          <div className="text-xs font-mono text-slate-300">
            Detected Targets: {classification.detectedPersonsCount} · Mode: {mode}
          </div>
        </div>

        {/* Card 2: VITALS & RESPIRATION */}
        <div
          data-testid="kpi-vitals-respiration"
          className="aura-card rounded-xl p-4 flex flex-col justify-between"
        >
          <div className="flex items-center justify-between text-xs font-mono uppercase tracking-wider text-slate-400">
            <span>VITALS & RESPIRATION</span>
            <span>DFT 6–48 BPM</span>
          </div>
          <div className="my-1.5 flex items-baseline justify-between gap-2">
            <span
              className={`text-2xl sm:text-3xl font-bold font-mono ${
                classification.vitalsKpiLabel === 'NO BREATHING'
                  ? 'text-[#a78bfa]'
                  : classification.vitalsKpiLabel === 'CHECKING…' ||
                    classification.vitalsKpiLabel === 'MICRO-MOTION'
                  ? 'text-[#ffb02e]'
                  : breathResult.rr > 30
                  ? 'text-[#ffb02e]'
                  : breathResult.rr >= 6
                  ? 'text-[#2dff7a]'
                  : 'text-slate-300'
              }`}
            >
              {classification.vitalsKpiLabel}
            </span>
            <span className="text-xs font-mono text-slate-400">
              CONF {Math.round(breathResult.conf * 100)}%
            </span>
          </div>
          <div className="text-xs font-mono text-slate-400 truncate">
            {classification.vitalsSubLabel}
          </div>
        </div>

        {/* Card 3: ELECTRICAL FIELD (LM386) */}
        <div
          data-testid="kpi-electrical-field"
          className={`rounded-xl p-4 flex flex-col justify-between ${
            classification.hasHazard ? 'aura-card-danger' : 'aura-card'
          }`}
        >
          <div className="flex items-center justify-between text-xs font-mono uppercase tracking-wider text-slate-400">
            <span>ELECTRICAL FIELD (LM386)</span>
            <span>50/60 Hz PROBE</span>
          </div>
          <div className="my-1.5 flex items-baseline justify-between gap-2">
            <span
              className={`text-2xl sm:text-3xl font-bold font-display ${
                classification.hasHazard ? 'text-[#ff4d5a]' : 'text-[#2dff7a]'
              }`}
            >
              {classification.hasHazard ? 'DANGER: LIVE' : 'CLEAR'}
            </span>
            <span className="text-lg font-mono font-bold text-white">
              {packet.lm386Vpp} <span className="text-xs text-slate-400">Vpp</span>
            </span>
          </div>
          <div className="text-xs font-mono text-slate-400">
            Threshold Limit: 350 Vpp · AC Mains: {packet.liveCurrent ? 'LIVE' : 'SAFE'}
          </div>
        </div>

        {/* Card 4: LD2410B RADAR */}
        <div
          data-testid="kpi-ld2410b-radar"
          className="aura-card rounded-xl p-4 flex flex-col justify-between"
        >
          <div className="flex items-center justify-between text-xs font-mono uppercase tracking-wider text-slate-400">
            <span>LD2410B RADAR</span>
            <span>24 GHz FMCW</span>
          </div>
          <div className="my-1.5 flex items-baseline justify-between gap-2">
            <span className="text-2xl sm:text-3xl font-bold font-mono text-[#22e6f0]">
              Gate{' '}
              {calibratedGates.statEng >= calibratedGates.movEng
                ? calibratedGates.peakStatGate
                : calibratedGates.peakMovGate}
            </span>
            <span className="text-xs font-mono text-slate-300">
              0.75m / gate
            </span>
          </div>
          <div className="text-xs font-mono text-slate-300">
            Mov: <span className="text-[#ff4d5a] font-bold">{calibratedGates.movEng}</span> | Stat:{' '}
            <span className="text-[#22e6f0] font-bold">{calibratedGates.statEng}</span>
          </div>
        </div>
      </section>

      {/* C. MAIN 2-COLUMN WORKSPACE */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
        {/* LEFT COLUMN (7 cols on desktop): 2D Map + 2 Sub-Cards */}
        <div className="lg:col-span-7 flex flex-col gap-4">
          <TacticalZoneCanvas
            nodes={nodes}
            csiLinks={csiLinks}
            targets={classification.targets}
            gateStat={calibratedGates.gateStat}
            gateMov={calibratedGates.gateMov}
            classifierMode={classifierMode}
            onToggleClassifierMode={onToggleClassifierMode}
            hasCustomRfModel={hasCustomRfModel}
          />

          {/* Bottom Sub-Cards (2-Column) */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Sub-Card 1: VITAL SIGNS & BREATHING */}
            <div className="aura-card rounded-xl p-4 flex flex-col justify-between gap-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold font-mono uppercase tracking-wider text-slate-200">
                  VITAL SIGNS & BREATHING
                </h3>
                <span className="text-xs font-mono text-[#22e6f0]">
                  {classification.mlPredictedClass}
                </span>
              </div>

              {/* Bar 1: Respiration Rate (0-48 RPM) */}
              <div className="flex flex-col gap-1">
                <div className="flex justify-between text-xs font-mono">
                  <span className="text-slate-400">Respiration Rate (0–48 RPM)</span>
                  <span className="text-white font-semibold">{breathResult.rr} RPM</span>
                </div>
                <div className="w-full h-2 bg-slate-950 rounded overflow-hidden border border-slate-800">
                  <div
                    className={`h-full transition-all duration-150 ${
                      breathResult.rr > 30 ? 'bg-[#ffb02e]' : 'bg-[#22e6f0]'
                    }`}
                    style={{
                      width: `${Math.min(100, Math.round((breathResult.rr / 48) * 100))}%`,
                    }}
                  />
                </div>
              </div>

              {/* Bar 2: AI Confidence / Rule Margin (0-100%) */}
              <div className="flex flex-col gap-1">
                <div className="flex justify-between text-xs font-mono">
                  <span className="text-slate-400">
                    {classifierMode === 'RF' ? 'AI RF Confidence' : 'Rule Margin'} (0–100%)
                  </span>
                  <span className="text-[#2dff7a] font-semibold">
                    {classification.confidencePct}%
                  </span>
                </div>
                <div className="w-full h-2 bg-slate-950 rounded overflow-hidden border border-slate-800">
                  <div
                    className="h-full bg-[#2dff7a] transition-all duration-150"
                    style={{ width: `${classification.confidencePct}%` }}
                  />
                </div>
              </div>

              {/* Bar 3: LM386 EMF Induction (0-600 Vpp) */}
              <div className="flex flex-col gap-1">
                <div className="flex justify-between text-xs font-mono">
                  <span className="text-slate-400">LM386 EMF Induction (0–600 Vpp)</span>
                  <span
                    className={`font-semibold ${
                      packet.lm386Vpp >= 350 ? 'text-[#ff4d5a]' : 'text-slate-200'
                    }`}
                  >
                    {packet.lm386Vpp} / 350 Vpp
                  </span>
                </div>
                <div className="w-full h-2 bg-slate-950 rounded overflow-hidden border border-slate-800">
                  <div
                    className={`h-full transition-all duration-150 ${
                      packet.lm386Vpp >= 350 ? 'bg-[#ff4d5a]' : 'bg-blue-400'
                    }`}
                    style={{
                      width: `${Math.min(100, Math.round((packet.lm386Vpp / 600) * 100))}%`,
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Sub-Card 2: WIFI CSI SIGNAL */}
            <div className="aura-card rounded-xl p-4 flex flex-col justify-between gap-2.5">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold font-mono uppercase tracking-wider text-slate-200">
                  WIFI CSI SIGNAL
                </h3>
                <span className="text-xs font-mono text-[#2dff7a]">
                  TDMA 250ms SYNC
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                <div className="bg-slate-950/70 border border-slate-800/80 rounded p-2">
                  <div className="text-slate-400 text-[10px]">MEAN RSSI</div>
                  <div className="text-sm font-bold text-white">{meanRssi} dBm</div>
                </div>
                <div className="bg-slate-950/70 border border-slate-800/80 rounded p-2">
                  <div className="text-slate-400 text-[10px]">CSI VARIANCE</div>
                  <div
                    className={`text-sm font-bold ${
                      calibratedGates.csiVar > 15 ? 'text-[#ff4d5a]' : 'text-[#2dff7a]'
                    }`}
                  >
                    {calibratedGates.csiVar.toFixed(2)} σ²
                  </div>
                </div>
                <div className="bg-slate-950/70 border border-slate-800/80 rounded p-2">
                  <div className="text-slate-400 text-[10px]">ACTIVE TX SLOT</div>
                  <div className="text-sm font-bold text-[#ffb02e]">
                    Node {packet.activeTx}
                  </div>
                </div>
                <div className="bg-slate-950/70 border border-slate-800/80 rounded p-2">
                  <div className="text-slate-400 text-[10px]">DETECTED PERSONS</div>
                  <div className="text-sm font-bold text-[#22e6f0]">
                    {classification.detectedPersonsCount}
                  </div>
                </div>
              </div>

              <div>
                <div className="flex justify-between text-[10px] font-mono text-slate-400 mb-1">
                  <span>LIVE CSI MULTIPATH VARIANCE SPARKLINE</span>
                  <span>THRESH: 15.0</span>
                </div>
                <CsiSparklineCanvas history={csiHistory} />
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN (5 cols on desktop): Waveform/Spectrum + 9 Range Gates + Mesh Nodes */}
        <div className="lg:col-span-5 flex flex-col gap-4">
          {/* 1. RESPIRATION WAVEFORM & SPECTRUM */}
          <RespirationCharts
            breathResult={breathResult}
            statEng={calibratedGates.statEng}
          />

          {/* 2. LD2410B RANGE GATES (0..8) */}
          <div className="aura-card rounded-xl p-4 flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold tracking-wider uppercase text-slate-100">
                LD2410B Range Gates (G0..G8 · 0.75m Resolution)
              </h2>
              <div className="flex items-center gap-3 text-xs font-mono">
                <span className="text-[#ff4d5a]">■ Mov (0–100)</span>
                <span className="text-[#22e6f0]">■ Stat (0–100)</span>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              {Array.from({ length: 9 }).map((_, g) => {
                const distM = (g * 0.75).toFixed(2);
                const mVal = calibratedGates.gateMov[g] || 0;
                const sVal = calibratedGates.gateStat[g] || 0;
                const isPeak =
                  (g === calibratedGates.peakStatGate && sVal > 25) ||
                  (g === calibratedGates.peakMovGate && mVal > 35);

                return (
                  <div
                    key={g}
                    className={`grid grid-cols-12 items-center gap-2 px-2 py-1 rounded text-xs font-mono ${
                      isPeak
                        ? 'bg-slate-900/90 border border-cyan-500/40'
                        : 'bg-slate-950/50 border border-slate-800/50'
                    }`}
                  >
                    <div className="col-span-3 flex items-center justify-between">
                      <span className={isPeak ? 'font-bold text-white' : 'text-slate-300'}>
                        G{g}
                      </span>
                      <span className="text-slate-400">{distM}m</span>
                    </div>

                    {/* Dual horizontal bars: Moving (red) & Stationary (cyan) */}
                    <div className="col-span-6 flex flex-col gap-1">
                      <div className="w-full h-1.5 bg-slate-950 rounded overflow-hidden">
                        <div
                          className="h-full bg-[#ff4d5a] transition-all duration-150"
                          style={{ width: `${mVal}%` }}
                        />
                      </div>
                      <div className="w-full h-1.5 bg-slate-950 rounded overflow-hidden">
                        <div
                          className="h-full bg-[#22e6f0] transition-all duration-150"
                          style={{ width: `${sVal}%` }}
                        />
                      </div>
                    </div>

                    <div className="col-span-3 text-right">
                      <span className="text-[#ff4d5a]">{String(mVal).padStart(2, '0')}</span>
                      <span className="text-slate-600 mx-1">/</span>
                      <span className="text-[#22e6f0]">{String(sVal).padStart(2, '0')}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 3. ESP-NOW MESH NODES & CSI LINKS */}
          <div className="aura-card rounded-xl p-4 flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold tracking-wider uppercase text-slate-100">
                ESP-NOW Mesh Nodes & Rescuer Wrist Beacon
              </h2>
              <span className="text-xs font-mono text-slate-400">
                250ms TDMA Ring
              </span>
            </div>

            <div className="flex flex-col gap-1.5">
              {nodes.map((n) => (
                <div
                  key={n.id}
                  className="flex items-center justify-between px-3 py-2 rounded-lg bg-slate-950/70 border border-slate-800/80 text-xs font-mono"
                >
                  <div>
                    <div className="font-bold text-slate-100">
                      Node {n.id}: {n.role}
                    </div>
                    <div className="text-[11px] text-slate-400">
                      Pos ({n.x.toFixed(1)}m, {n.y.toFixed(1)}m) · CSI {n.csiVar.toFixed(1)} · RSSI {n.rssiMean} dBm
                    </div>
                  </div>
                  <div className="text-right">
                    {!n.online ? (
                      <span className="text-[#ff4d5a] font-bold">OFFLINE</span>
                    ) : n.isTxSlot ? (
                      <span className="text-[#ffb02e] font-bold">TX SLOT</span>
                    ) : (
                      <span className="text-[#2dff7a] font-bold">RX SYNC</span>
                    )}
                  </div>
                </div>
              ))}

              {/* Active Rescuer Wrist Tag Readout */}
              <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-slate-900/90 border border-slate-700/80 text-xs font-mono mt-1">
                <div>
                  <span className="text-slate-300 font-semibold">
                    RESCUER WRIST BEACON #1:
                  </span>{' '}
                  {activeTag ? (
                    <span className="text-[#2dff7a]">
                      ACTIVE ({activeTag.rssi} dBm)
                    </span>
                  ) : (
                    <span className="text-slate-400">STANDBY (NO TAG IN RANGE)</span>
                  )}
                </div>
                <div>
                  {activeTag?.sos ? (
                    <span className="text-[#ff4d5a] font-bold">SOS LATCHED</span>
                  ) : activeTag ? (
                    <span className="text-[#22e6f0]">BEACON OK</span>
                  ) : (
                    <span className="text-slate-500">RSSI &lt; -75 dBm</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* D. FLOATING BOTTOM QUICK-DEMO DOCK */}
      <div
        role="region"
        aria-label="Quick Demo and Hardware Stream Control Dock"
        className="fixed bottom-3 left-1/2 -translate-x-1/2 z-30 w-[96%] max-w-5xl aura-card rounded-xl px-4 py-2.5 shadow-2xl border border-blue-400/30 flex flex-wrap items-center justify-between gap-3"
      >
        {/* Mode Switcher */}
        <div className="flex items-center gap-2">
          <div
            className="flex items-center bg-[#060a1e] border border-slate-700 rounded-lg p-0.5"
            role="group"
            aria-label="Simulation or Hardware Stream Mode"
          >
            <button
              type="button"
              onClick={() => onToggleMode('DEMO')}
              className={`px-3 py-1 text-xs font-mono font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                mode === 'DEMO'
                  ? 'bg-[#22e6f0] text-slate-950'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              DEMO MODE
            </button>
            <button
              type="button"
              onClick={() => onToggleMode('LIVE')}
              className={`px-3 py-1 text-xs font-mono font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                mode === 'LIVE'
                  ? 'bg-[#2dff7a] text-slate-950'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              LIVE STREAM
            </button>
          </div>

          <button
            type="button"
            onClick={onConnectUsbSerial}
            className="px-3 py-1.5 text-xs font-mono font-medium rounded-lg border border-cyan-500/40 bg-cyan-500/10 text-cyan-200 hover:bg-cyan-500/20 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {serialConnected ? 'USB Serial Connected (115200)' : 'Connect USB'}
          </button>

          <button
            type="button"
            onClick={onToggleHttpPoll}
            className={`px-2.5 py-1.5 text-xs font-mono rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              httpPollEnabled
                ? 'border-emerald-400/60 bg-emerald-500/15 text-emerald-200'
                : 'border-slate-700 bg-slate-900/70 text-slate-400 hover:text-slate-200'
            }`}
          >
            HTTP /state: {httpPollEnabled ? 'POLLING' : 'OFF'}
          </button>
        </div>

        {/* Scenario Dropdown (8 Realistic Disaster Scenarios) */}
        <div className="flex items-center gap-2 flex-1 min-w-[260px] justify-end">
          <label
            htmlFor="scenario-select"
            className="text-xs font-mono uppercase text-slate-300 whitespace-nowrap shrink-0"
          >
            Disaster Scenario:
          </label>
          <select
            id="scenario-select"
            aria-label="Disaster Scenario"
            value={scenario}
            onChange={(e) => onSelectScenario(e.target.value as ScenarioId)}
            className="bg-[#060a1e] border border-slate-600 text-slate-100 text-xs font-mono rounded-lg px-3 py-1.5 focus:outline-none focus:border-[#22e6f0] w-full max-w-xs cursor-pointer"
          >
            {SCENARIO_DEFINITIONS.map((sc) => (
              <option key={sc.id} value={sc.id}>
                {sc.name}
              </option>
            ))}
          </select>
        </div>

        {serialStatusMsg && (
          <div className="w-full text-[11px] font-mono text-amber-300 border-t border-slate-800 pt-1">
            HARDWARE LINK: {serialStatusMsg}
          </div>
        )}
      </div>
    </div>
  );
};
