/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  BreathDftResult,
  CalibrationBaseline,
  CsiLink,
  ESP32RawPacket,
  FeatureVector8,
  NodeStatus,
  ScenarioId,
  TacticalTargetMarker,
  TrainedForestMetrics,
  TrainingSample,
} from './types/aura';
import {
  AuraBreath,
  CalibrationAccumulator,
  applyBaselineToTelemetry,
  evaluateClassification,
  mergeNodePackets,
  parseEsp32JsonLine,
} from './utils/signalProcessing';
import {
  AuraRandomForest,
  generate750BenchmarkDataset,
  getPretrainedRandomForest,
} from './utils/randomForest';
import {
  buildPrewarmedBreathSamples,
  stepScenarioSimulation,
} from './utils/scenarioSimulator';
import { soundEngine } from './utils/soundEngine';
import { TacticalMonitorView } from './components/TacticalMonitorView';
import { AiTrainingStudioView } from './components/AiTrainingStudioView';
import { SystemBlueprintView } from './components/SystemBlueprintView';

type ActiveTab = 'MONITOR' | 'STUDIO' | 'BLUEPRINT';

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('MONITOR');
  const [mode, setMode] = useState<'DEMO' | 'LIVE'>('DEMO');
  const [scenario, setScenario] = useState<ScenarioId>('survivor');
  const [classifierMode, setClassifierMode] = useState<'RF' | 'RULES'>('RF');
  const [audioMuted, setAudioMuted] = useState<boolean>(false);

  // Web Serial & HTTP /state live connection state
  const [serialConnected, setSerialConnected] = useState<boolean>(false);
  const [serialStatusMsg, setSerialStatusMsg] = useState<string>('');
  const [httpPollEnabled, setHttpPollEnabled] = useState<boolean>(false);

  // 3-second Empty-Room Calibration state
  const [showCalibConfirmModal, setShowCalibConfirmModal] =
    useState<boolean>(false);
  const [isCalibrating, setIsCalibrating] = useState<boolean>(false);
  const [calibProgressPct, setCalibProgressPct] = useState<number>(0);
  const [baseline, setBaseline] = useState<CalibrationBaseline>({
    active: false,
    timestamp: null,
    gateMov: new Array(9).fill(0),
    gateStat: new Array(9).fill(0),
    csiVar: 0,
  });

  // AI Training Studio state & hot-swappable Random Forest
  const [trainingSamples, setTrainingSamples] = useState<TrainingSample[]>(() =>
    generate750BenchmarkDataset()
  );
  const activeRfRef = useRef<AuraRandomForest>(getPretrainedRandomForest());
  const [rfMetrics, setRfMetrics] = useState<TrainedForestMetrics>(
    () => getPretrainedRandomForest().getMetrics()!
  );
  const [hasCustomRfModel, setHasCustomRfModel] = useState<boolean>(false);

  // Signal processing instances in refs (seeded synchronously for immediate 20s readiness on first paint)
  const breathEstimatorRef = useRef<AuraBreath | null>(null);
  if (!breathEstimatorRef.current) {
    const ab = new AuraBreath();
    ab.seedBuffer(buildPrewarmedBreathSamples('survivor', Date.now()));
    breathEstimatorRef.current = ab;
  }
  const calibAccumRef = useRef<CalibrationAccumulator>(
    new CalibrationAccumulator()
  );
  const calibStartMsRef = useRef<number>(0);
  const liveNodePacketsRef = useRef<Map<number, ESP32RawPacket>>(new Map());
  const prevTargetsRef = useRef<TacticalTargetMarker[]>([]);
  const tickCountRef = useRef<number>(0);

  // Telemetry state rendered at 10 Hz
  const [initialSim] = useState(() =>
    stepScenarioSimulation('survivor', Date.now(), 0)
  );
  const [packet, setPacket] = useState<ESP32RawPacket>(initialSim.packet);
  const [nodes, setNodes] = useState<NodeStatus[]>(initialSim.nodes);
  const [csiLinks, setCsiLinks] = useState<CsiLink[]>(initialSim.csiLinks);
  const [meanRssi, setMeanRssi] = useState<number>(initialSim.meanRssi);
  const [csiHistory, setCsiHistory] = useState<number[]>(() =>
    new Array(40).fill(3.2)
  );
  const [targetPositions, setTargetPositions] = useState(
    initialSim.targetPositions
  );
  const [breathResult, setBreathResult] = useState<BreathDftResult>(() =>
    breathEstimatorRef.current!.computeResult(true)
  );

  // Switch scenario handler (seeds 24s breathing buffer so scenario reflects immediately, while "Test 0-20s Breath Check" button lets user watch the 0-20s progress bar live)
  const handleSelectScenario = useCallback((nextScenario: ScenarioId) => {
    setScenario(nextScenario);
    setMode('DEMO');
    const prewarmed = buildPrewarmedBreathSamples(nextScenario, Date.now());
    breathEstimatorRef.current!.seedBuffer(prewarmed);
    setBreathResult(
      breathEstimatorRef.current!.computeResult(prewarmed.length > 0)
    );
  }, []);

  // Reset breathing buffer to 0s so user can watch the 0->20s CHECKING BREATHING banner & progress bar live
  const handleRestartBreathingCheck = useCallback(() => {
    breathEstimatorRef.current!.reset();
    setBreathResult(breathEstimatorRef.current!.computeResult(true));
  }, []);

  // Start 3-second Empty-Room Recalibration after user confirms room is empty
  const startThreeSecondCalibration = () => {
    setShowCalibConfirmModal(false);
    calibAccumRef.current.reset();
    calibStartMsRef.current = Date.now();
    setCalibProgressPct(0);
    setIsCalibrating(true);
  };

  // Main 10 Hz Telemetry & Sensor Fusion Loop
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      tickCountRef.current += 1;

      let curPacket: ESP32RawPacket;
      let microWave = 0;

      if (mode === 'DEMO') {
        const sim = stepScenarioSimulation(scenario, now, tickCountRef.current);
        curPacket = sim.packet;
        microWave = sim.microWaveformSample;
        setNodes(sim.nodes);
        setCsiLinks(sim.csiLinks);
        setMeanRssi(sim.meanRssi);
        setTargetPositions(sim.targetPositions);
      } else {
        // LIVE HARDWARE MODE: Merge packets across Nodes 1..4
        if (liveNodePacketsRef.current.size > 0) {
          curPacket = mergeNodePackets(liveNodePacketsRef.current);
        } else {
          curPacket = packet;
        }
      }

      setPacket(curPacket);

      // If 3-second calibration is active, accumulate frames
      if (isCalibrating) {
        calibAccumRef.current.addFrame(
          curPacket.gateMov,
          curPacket.gateStat,
          curPacket.csiVar
        );
        const elapsed = now - calibStartMsRef.current;
        const pct = Math.min(100, Math.round((elapsed / 3000) * 100));
        setCalibProgressPct(pct);
        if (elapsed >= 3000) {
          const newBase = calibAccumRef.current.finalize(now);
          setBaseline(newBase);
          setIsCalibrating(false);
          soundEngine.playCalibrationComplete();
        }
      }

      // Apply baseline subtraction
      const cal = applyBaselineToTelemetry(
        curPacket.gateMov,
        curPacket.gateStat,
        curPacket.csiVar,
        baseline
      );

      // Update CSI sparkline history
      setCsiHistory((prev) => [...prev.slice(-49), cal.csiVar]);

      // Update AuraBreath 30-second rolling buffer & Hann-windowed DFT
      const bRes = breathEstimatorRef.current!.pushSample(
        now,
        cal.statEng,
        cal.movEng,
        microWave
      );
      setBreathResult(bRes);
    }, 100); // 10 Hz

    return () => clearInterval(interval);
  }, [mode, scenario, isCalibrating, baseline, packet]);

  // Poll local /state HTTP endpoint at 10 Hz when enabled in LIVE mode
  useEffect(() => {
    if (!httpPollEnabled) return;
    const pollTimer = setInterval(async () => {
      try {
        const res = await fetch('/state');
        if (!res.ok) return;
        const text = await res.text();
        const lines = text.split('\n');
        for (const line of lines) {
          const parsed = parseEsp32JsonLine(line);
          if (parsed) {
            liveNodePacketsRef.current.set(parsed.node, parsed);
            setMode('LIVE');
          }
        }
      } catch {
        // Ignore offline local endpoint errors in browser preview
      }
    }, 100);
    return () => clearInterval(pollTimer);
  }, [httpPollEnabled]);

  // Connect to ESP32 Node 1 via Browser Web Serial API (115200 baud)
  const handleConnectUsbSerial = async () => {
    const nav = navigator as unknown as {
      serial?: {
        requestPort: () => Promise<{
          open: (opts: { baudRate: number }) => Promise<void>;
          readable?: ReadableStream<Uint8Array>;
        }>;
      };
    };

    if (!nav.serial) {
      setSerialStatusMsg(
        'Web Serial API unavailable in this browser context — use DEMO Mode or HTTP /state polling.'
      );
      return;
    }

    try {
      const port = await nav.serial.requestPort();
      await port.open({ baudRate: 115200 });
      setSerialConnected(true);
      setMode('LIVE');
      setSerialStatusMsg('Connected to ESP32 Node 1 @ 115200 baud (10 Hz JSON stream)');

      const decoder = new TextDecoder();
      let buffer = '';
      const reader = port.readable?.getReader();
      if (!reader) return;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) {
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            const pkt = parseEsp32JsonLine(line);
            if (pkt) {
              liveNodePacketsRef.current.set(pkt.node, pkt);
            }
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Serial port cancelled';
      setSerialStatusMsg(`USB Serial notice: ${msg}`);
    }
  };

  // Compute current calibrated telemetry & Dual Classification Engine output
  const calibratedGates = applyBaselineToTelemetry(
    packet.gateMov,
    packet.gateStat,
    packet.csiVar,
    baseline
  );

  const liveFeatures: FeatureVector8 = [
    calibratedGates.csiVar,
    calibratedGates.movEng,
    calibratedGates.statEng,
    calibratedGates.peakMovGate,
    calibratedGates.peakStatGate,
    packet.lm386Vpp,
    breathResult.rr,
    breathResult.conf,
  ];

  const classification = evaluateClassification({
    features: liveFeatures,
    liveCurrent: packet.liveCurrent,
    tags: packet.tags,
    breathResult,
    classifierMode,
    rfPredictor: (feat) => activeRfRef.current.predict(feat),
    targetPositions: mode === 'DEMO' ? targetPositions : undefined,
    prevTargets: prevTargetsRef.current,
  });

  // Update target trails ref & trigger Web Audio tactical synthesizer
  useEffect(() => {
    prevTargetsRef.current = classification.targets;
    soundEngine.triggerBannerAlarm(classification.bannerState);
  }, [classification.bannerState, classification.targets]);

  const activeNodeCount = nodes.filter((n) => n.online).length;

  return (
    <div className="min-h-screen aura-bg text-slate-100 flex flex-col">
      {/* TOP NAVIGATION BAR */}
      <header className="sticky top-0 z-40 bg-[#060a1e]/90 backdrop-blur-md border-b border-blue-500/25 px-4 sm:px-6 py-3">
        <div className="max-w-[1440px] mx-auto flex flex-wrap items-center justify-between gap-4">
          {/* Zone 1: Brand Emblem & Active Nodes */}
          <div className="flex items-center gap-3 shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-[#e5202e] flex items-center justify-center font-display font-bold text-white text-base shadow-[0_0_15px_rgba(229,32,46,0.5)]">
                AR
              </div>
              <div>
                <div className="text-base sm:text-lg font-bold tracking-wider font-display text-white leading-none whitespace-nowrap">
                  AURA RESCUE
                </div>
                <div className="text-[10px] font-mono text-slate-400 whitespace-nowrap">
                  {activeNodeCount}/4 NODES ACTIVE · TEAM COMPILE ERROR
                </div>
              </div>
            </div>
          </div>

          {/* Zone 2: 3 Integrated View Tabs */}
          <nav
            aria-label="Primary View Navigation"
            className="flex items-center gap-1.5 bg-[#0b1230] border border-slate-700/80 rounded-lg p-1"
          >
            <button
              type="button"
              onClick={() => setActiveTab('MONITOR')}
              className={`px-3 py-1.5 text-xs font-mono font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'MONITOR'
                  ? 'bg-[#e5202e] text-white shadow-sm'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              📊 Tactical 2D Monitor
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('STUDIO')}
              className={`px-3 py-1.5 text-xs font-mono font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'STUDIO'
                  ? 'bg-[#22e6f0] text-slate-950 shadow-sm'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              🧠 AI Training Studio
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('BLUEPRINT')}
              className={`px-3 py-1.5 text-xs font-mono font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'BLUEPRINT'
                  ? 'bg-[#2dff7a] text-slate-950 shadow-sm'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              ⚙️ System & Wiring Blueprint
            </button>
          </nav>

          {/* Zone 3: Hardware Controls, 3s Recalibration & Audio Mute */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setMode((m) => (m === 'DEMO' ? 'LIVE' : 'DEMO'))}
              className={`px-2.5 py-1.5 text-xs font-mono font-bold rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                mode === 'DEMO'
                  ? 'border-cyan-400/50 bg-cyan-500/15 text-[#22e6f0]'
                  : 'border-emerald-400/50 bg-emerald-500/15 text-[#2dff7a]'
              }`}
            >
              {mode === 'DEMO' ? 'MODE: DEMO' : 'MODE: LIVE'}
            </button>

            <button
              type="button"
              onClick={handleConnectUsbSerial}
              className="px-3 py-1.5 text-xs font-mono font-medium rounded-lg border border-slate-600 bg-slate-900/90 text-slate-200 hover:border-[#22e6f0] hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              🔌 Connect USB Serial
            </button>

            <button
              type="button"
              onClick={() => setShowCalibConfirmModal(true)}
              disabled={isCalibrating}
              className="px-3 py-1.5 text-xs font-mono font-semibold rounded-lg border border-amber-400/50 bg-amber-500/15 text-[#ffb02e] hover:bg-amber-500/25 transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
            >
              {isCalibrating
                ? `Calibrating (${calibProgressPct}%)`
                : 'Recalibrate (3s)'}
            </button>

            <button
              type="button"
              aria-label={audioMuted ? 'Unmute Tactical Alarms' : 'Mute Tactical Alarms'}
              onClick={() => {
                const next = !audioMuted;
                setAudioMuted(next);
                soundEngine.setMuted(next);
              }}
              className={`px-2.5 py-1.5 text-xs font-mono font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                audioMuted
                  ? 'border-slate-700 bg-slate-900 text-slate-400'
                  : 'border-emerald-500/40 bg-emerald-500/10 text-[#2dff7a]'
              }`}
            >
              {audioMuted ? '🔕 OFF' : '🔔 ON'}
            </button>
          </div>
        </div>
      </header>

      {/* 3-SECOND EMPTY-ROOM RECALIBRATION MODAL */}
      {showCalibConfirmModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="calib-dialog-title"
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <div className="aura-card rounded-xl max-w-md w-full p-5 border border-amber-400/50 flex flex-col gap-3">
            <h2
              id="calib-dialog-title"
              className="text-base font-bold font-display uppercase text-[#ffb02e]"
            >
              Confirm 3-Second Empty-Room Recalibration
            </h2>
            <p className="text-xs text-slate-300 leading-relaxed">
              Ensure the 4.0m × 4.2m scan zone is clear of personnel. AURA RESCUE will sample 3 seconds (30 frames) of <code className="font-mono text-cyan-300">gateMov[0..8]</code>, <code className="font-mono text-cyan-300">gateStat[0..8]</code>, and <code className="font-mono text-cyan-300">csiVar</code> to subtract static rubble and wall reflections from all subsequent telemetry frames.
            </p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowCalibConfirmModal(false)}
                className="px-3.5 py-1.5 text-xs font-mono rounded-lg border border-slate-600 bg-slate-900 text-slate-300 hover:text-white cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={startThreeSecondCalibration}
                className="px-4 py-1.5 text-xs font-mono font-bold rounded-lg bg-[#ffb02e] text-slate-950 hover:bg-amber-300 cursor-pointer"
              >
                Start 3s Baseline Capture
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MAIN VIEWPORT */}
      <main className="flex-1 max-w-[1440px] w-full mx-auto px-4 sm:px-6 pt-4">
        {activeTab === 'MONITOR' && (
          <TacticalMonitorView
            mode={mode}
            onToggleMode={(m) => setMode(m)}
            scenario={scenario}
            onSelectScenario={handleSelectScenario}
            onRestartBreathingCheck={handleRestartBreathingCheck}
            onConnectUsbSerial={handleConnectUsbSerial}
            serialConnected={serialConnected}
            serialStatusMsg={serialStatusMsg}
            httpPollEnabled={httpPollEnabled}
            onToggleHttpPoll={() => setHttpPollEnabled((v) => !v)}
            packet={packet}
            calibratedGates={calibratedGates}
            breathResult={breathResult}
            classification={classification}
            nodes={nodes}
            csiLinks={csiLinks}
            meanRssi={meanRssi}
            csiHistory={csiHistory}
            classifierMode={classifierMode}
            onToggleClassifierMode={(m) => setClassifierMode(m)}
            hasCustomRfModel={hasCustomRfModel}
            baseline={baseline}
            onClearBaseline={() =>
              setBaseline({
                active: false,
                timestamp: null,
                gateMov: new Array(9).fill(0),
                gateStat: new Array(9).fill(0),
                csiVar: 0,
              })
            }
          />
        )}

        {activeTab === 'STUDIO' && (
          <AiTrainingStudioView
            liveFeatures={liveFeatures}
            samples={trainingSamples}
            onUpdateSamples={setTrainingSamples}
            activeMetrics={rfMetrics}
            onApplyTrainedForest={(forest, metrics) => {
              activeRfRef.current = forest;
              setRfMetrics(metrics);
              setHasCustomRfModel(true);
              setClassifierMode('RF');
            }}
            hasCustomModelApplied={hasCustomRfModel}
          />
        )}

        {activeTab === 'BLUEPRINT' && <SystemBlueprintView />}
      </main>
    </div>
  );
}
