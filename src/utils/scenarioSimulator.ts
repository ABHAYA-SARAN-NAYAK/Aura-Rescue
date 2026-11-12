import {
  CsiLink,
  ESP32RawPacket,
  NodeStatus,
  ScenarioId,
} from '../types/aura';
import { clamp } from './signalProcessing';

export interface ScenarioDefinition {
  id: ScenarioId;
  name: string;
  shortTag: string;
  description: string;
  defaultGate: number;
  distanceM: number;
  expectedRpm: number;
}

export const SCENARIO_DEFINITIONS: ScenarioDefinition[] = [
  {
    id: 'survivor',
    name: '1. Trapped Survivor (Gate 2 · 1.5m · 16 RPM)',
    shortTag: 'Trapped Survivor',
    description:
      'Stationary trapped survivor at Gate 2 (1.50m), StatEng ~65, 16 RPM rhythmic chest micro-motion, low Wi-Fi CSI variance.',
    defaultGate: 2,
    distanceM: 1.5,
    expectedRpm: 16,
  },
  {
    id: 'dead',
    name: '2. Dead / No Breathing (Gate 4 · 3.0m · 0 RPM)',
    shortTag: 'Dead (No Breathing)',
    description:
      'Still body at Gate 4 (3.00m), StatEng ~46, flatline 0 RPM respiration over 20s window (possible casualty; rescuer must verify).',
    defaultGate: 4,
    distanceM: 3.0,
    expectedRpm: 0,
  },
  {
    id: 'pet',
    name: '3. Pet / Animal (Gate 1 · 0.75m · 38 RPM)',
    shortTag: 'Pet / Animal',
    description:
      'Small stationary body at Gate 1 (0.75m), StatEng ~31, rapid 38 RPM respiration signature.',
    defaultGate: 1,
    distanceM: 0.75,
    expectedRpm: 38,
  },
  {
    id: 'rescuer',
    name: '4. Rescuer Searching (Active Motion · Tag #1 -58 dBm)',
    shortTag: 'Rescuer Searching',
    description:
      'Rescuer actively sweeping across range gates, MovEng ~84, high Wi-Fi CSI ~38.5, ESP32 Wrist Tag #1 verified at -58 dBm.',
    defaultGate: 3,
    distanceM: 2.25,
    expectedRpm: 0,
  },
  {
    id: 'rescuer_survivor',
    name: '5. Rescuer + Survivor (Dual Target · Gate 3 & Gate 1)',
    shortTag: 'Rescuer + Survivor',
    description:
      'Trapped survivor breathing at Gate 3 (2.25m, 16 RPM) while tagged rescuer approaches through Gate 1 (0.75m).',
    defaultGate: 3,
    distanceM: 2.25,
    expectedRpm: 16,
  },
  {
    id: 'live_wire',
    name: '6. Live Wire Hazard (LM386 520 Vpp · 50/60Hz Mains)',
    shortTag: 'Live Wire Hazard',
    description:
      'Exposed 50/60Hz AC live conduit inducing 520 Vpp (>= 350 limit) on LM386 EMF probe — immediate electrical hazard lock.',
    defaultGate: 2,
    distanceM: 1.5,
    expectedRpm: 16,
  },
  {
    id: 'rescuer_sos',
    name: '7. Rescuer SOS Emergency (Wrist Tag #1 SOS Triggered)',
    shortTag: 'Rescuer SOS Emergency',
    description:
      'Rescuer Wrist Beacon #1 hardware panic button latched (sos: true, RSSI -54 dBm) — immediate extraction priority.',
    defaultGate: 3,
    distanceM: 2.25,
    expectedRpm: 0,
  },
  {
    id: 'clear',
    name: '8. Clear Area (Baseline Noise Floor)',
    shortTag: 'Clear Area',
    description:
      'Empty rubble sector with ambient baseline multipath noise floor — all range gates clear.',
    defaultGate: 0,
    distanceM: 0.0,
    expectedRpm: 0,
  },
];

export interface SimulatedFrameOutput {
  packet: ESP32RawPacket;
  microWaveformSample: number;
  nodes: NodeStatus[];
  csiLinks: CsiLink[];
  meanRssi: number;
  targetPositions: {
    primaryX: number;
    primaryY: number;
    secondaryX?: number;
    secondaryY?: number;
  };
}

/**
 * Generates pre-warmed 22-second buffer of [timestampMs, signalValue] for a scenario
 * so when a user picks a scenario in DEMO mode, the 20-second DFT window is ready immediately,
 * while also allowing the user to click "Restart 20s Breathing Check" to watch the 0->20s progress bar live.
 */
export function buildPrewarmedBreathSamples(
  scenario: ScenarioId,
  nowMs: number
): [number, number][] {
  if (
    scenario !== 'survivor' &&
    scenario !== 'dead' &&
    scenario !== 'pet' &&
    scenario !== 'rescuer_survivor' &&
    scenario !== 'live_wire'
  ) {
    return [];
  }

  const samples: [number, number][] = [];
  const durationMs = 30000; // Full 30s rolling buffer (> 20s threshold)
  const stepMs = 100; // 10 Hz
  // Align startMs to 100ms grid for phase continuity with 10Hz interval
  const alignedNow = Math.floor(nowMs / 100) * 100;
  const startMs = alignedNow - durationMs;

  const baseStat =
    scenario === 'dead'
      ? 46
      : scenario === 'pet'
      ? 31
      : scenario === 'rescuer_survivor'
      ? 66
      : scenario === 'live_wire'
      ? 62
      : 65;
  const bpm =
    scenario === 'dead' ? 0 : scenario === 'pet' ? 38 : 16;
  const amp =
    scenario === 'dead' ? 0.0 : scenario === 'pet' ? 6.5 : 8.5;

  for (let t = startMs; t <= alignedNow; t += stepMs) {
    const tSec = t / 1000;
    const wave =
      bpm > 0
        ? amp * Math.sin((2 * Math.PI * bpm * tSec) / 60)
        : 0;
    samples.push([t, baseStat + wave]);
  }

  return samples;
}

export function stepScenarioSimulation(
  scenario: ScenarioId,
  nowMs: number,
  tickCount: number
): SimulatedFrameOutput {
  const tSec = nowMs / 1000;
  // 250ms TDMA slot rotation across Nodes 1..4
  const activeTx = (Math.floor(nowMs / 250) % 4) + 1;

  const gateMov = new Array(9).fill(0);
  const gateStat = new Array(9).fill(0);

  // Subtle ambient noise on non-peak gates
  for (let g = 0; g < 9; g++) {
    gateMov[g] = Math.round(clamp(1 + Math.sin(tSec * 1.7 + g) * 1.2, 0, 4));
    gateStat[g] = Math.round(clamp(4 + Math.cos(tSec * 1.1 + g) * 2.0, 0, 9));
  }

  let csiVar = Number((1.2 + Math.abs(Math.sin(tSec * 0.9)) * 0.6).toFixed(2));
  let lm386Vpp = Math.round(68 + Math.sin(tSec * 2.3) * 12);
  let liveCurrent = 0;
  let tags: ESP32RawPacket['tags'] = [];
  let microWaveformSample = 0;
  let primaryX = 1.65;
  let primaryY = 1.75;
  let secondaryX: number | undefined;
  let secondaryY: number | undefined;

  switch (scenario) {
    case 'survivor': {
      // Gate 2 (1.5m), StatEng 65, 16 RPM breathing, low CSI
      gateStat[1] = 18;
      gateStat[2] = 65;
      gateStat[3] = 14;
      gateMov[2] = 4;
      csiVar = Number((3.2 + Math.sin(tSec * 1.4) * 0.35).toFixed(2));
      lm386Vpp = Math.round(80 + Math.sin(tSec * 3.1) * 5);
      // Pure 16 breaths/min harmonic aligned with tSec = nowMs / 1000
      microWaveformSample = 8.5 * Math.sin((2 * Math.PI * 16 * tSec) / 60);
      primaryX = 1.18 + Math.sin(tSec * 0.5) * 0.02;
      primaryY = 1.24 + Math.cos(tSec * 0.5) * 0.02;
      break;
    }

    case 'dead': {
      // Gate 4 (3.0m), StatEng 46, flatline 0 RPM
      gateStat[3] = 15;
      gateStat[4] = 46;
      gateStat[5] = 12;
      gateMov[4] = 1;
      csiVar = Number((2.1 + Math.sin(tSec * 0.8) * 0.2).toFixed(2));
      lm386Vpp = Math.round(74 + Math.cos(tSec * 2.0) * 5);
      microWaveformSample = 0;
      primaryX = 2.25;
      primaryY = 2.38;
      break;
    }

    case 'pet': {
      // Gate 1 (0.75m), StatEng 31, rapid 38 RPM breathing
      gateStat[1] = 31;
      gateStat[2] = 12;
      gateMov[1] = Math.round(11 + Math.abs(Math.sin(tSec * 2.2)) * 4);
      csiVar = Number((5.8 + Math.sin(tSec * 2.8) * 0.9).toFixed(2));
      lm386Vpp = Math.round(76 + Math.sin(tSec * 1.9) * 5);
      microWaveformSample = 6.5 * Math.sin((2 * Math.PI * 38 * tSec) / 60);
      primaryX = 0.68 + Math.sin(tSec * 1.8) * 0.05;
      primaryY = 0.72 + Math.cos(tSec * 1.5) * 0.05;
      break;
    }

    case 'rescuer': {
      // Moving across gates, MovEng ~84, high CSI ~38.5, Wrist Tag #1 at -58 dBm
      const sweepPos = 2 + Math.sin(tSec * 0.65) * 1.5; // Sweeps gates 1..4
      const primaryGate = clamp(Math.round(sweepPos), 1, 5);
      gateMov[primaryGate] = Math.round(84 + Math.sin(tSec * 4.0) * 6);
      if (primaryGate > 0) gateMov[primaryGate - 1] = 34;
      if (primaryGate < 8) gateMov[primaryGate + 1] = 28;
      gateStat[primaryGate] = 38;
      csiVar = Number((38.5 + Math.sin(tSec * 3.2) * 4.2).toFixed(2));
      lm386Vpp = Math.round(92 + Math.sin(tSec * 2.5) * 10);
      tags = [{ id: 1, rssi: Math.round(-58 + Math.sin(tSec * 1.2) * 3), sos: false }];
      microWaveformSample = 14.0 * Math.sin(tSec * 6.5) + 6.0 * Math.cos(tSec * 9.2);
      primaryX = clamp(1.8 + Math.cos(tSec * 0.65) * 0.95, 0.5, 3.5);
      primaryY = clamp(2.0 + Math.sin(tSec * 0.95) * 0.95, 0.5, 3.7);
      break;
    }

    case 'rescuer_survivor': {
      // Survivor still at Gate 3 (2.25m, 16 RPM) + Tagged Rescuer approaching at Gate 1 (0.75m)
      gateStat[3] = 66;
      gateStat[2] = 19;
      gateMov[1] = Math.round(78 + Math.sin(tSec * 3.4) * 6);
      gateMov[2] = 26;
      csiVar = Number((29.4 + Math.sin(tSec * 2.6) * 3.2).toFixed(2));
      lm386Vpp = Math.round(86 + Math.sin(tSec * 2.1) * 7);
      tags = [{ id: 1, rssi: -56, sos: false }];
      microWaveformSample = 8.5 * Math.sin((2 * Math.PI * 16 * tSec) / 60);
      // Survivor at Gate 3
      primaryX = 1.82;
      primaryY = 1.95;
      // Rescuer moving near Gate 1
      secondaryX = clamp(0.78 + Math.cos(tSec * 0.8) * 0.25, 0.4, 1.4);
      secondaryY = clamp(0.85 + Math.sin(tSec * 0.8) * 0.25, 0.4, 1.5);
      break;
    }

    case 'live_wire': {
      // LM386 Vpp = 520 >= 350 threshold, triggering red hazard alarm
      gateStat[2] = 62;
      gateMov[2] = 5;
      csiVar = Number((4.1 + Math.sin(tSec * 1.7) * 0.5).toFixed(2));
      lm386Vpp = Math.round(520 + Math.sin(tSec * 8.0) * 16);
      liveCurrent = 1;
      microWaveformSample = 8.5 * Math.sin((2 * Math.PI * 16 * tSec) / 60);
      primaryX = 1.22;
      primaryY = 1.28;
      break;
    }

    case 'rescuer_sos': {
      // Wrist Tag #1 SOS flag = true, triggering SOS alarm
      gateMov[3] = Math.round(48 + Math.sin(tSec * 2.5) * 8);
      gateStat[3] = 54;
      csiVar = Number((21.5 + Math.sin(tSec * 2.0) * 3.0).toFixed(2));
      lm386Vpp = Math.round(110 + Math.sin(tSec * 3.0) * 12);
      tags = [{ id: 1, rssi: -54, sos: true }];
      microWaveformSample = 9.5 * Math.sin((2 * Math.PI * 24 * tSec) / 60);
      primaryX = 1.75 + Math.sin(tSec * 1.2) * 0.08;
      primaryY = 1.85 + Math.cos(tSec * 1.2) * 0.08;
      break;
    }

    case 'clear':
    default: {
      // Baseline noise floor, all clear
      csiVar = Number((1.1 + Math.sin(tSec * 0.7) * 0.3).toFixed(2));
      lm386Vpp = Math.round(62 + Math.sin(tSec * 1.4) * 6);
      liveCurrent = 0;
      tags = [];
      microWaveformSample = 0.25 * Math.sin(tSec * 1.9);
      primaryX = 2.0;
      primaryY = 2.1;
      break;
    }
  }

  let peakMovGate = 0;
  let movEng = 0;
  let peakStatGate = 0;
  let statEng = 0;
  for (let g = 0; g < 9; g++) {
    if (gateMov[g] > movEng) {
      movEng = gateMov[g];
      peakMovGate = g;
    }
    if (gateStat[g] > statEng) {
      statEng = gateStat[g];
      peakStatGate = g;
    }
  }

  const packet: ESP32RawPacket = {
    node: 1,
    activeTx,
    target: statEng > 25 && movEng > 35 ? 3 : statEng > 25 ? 2 : movEng > 35 ? 1 : 0,
    movDist: Math.round(peakMovGate * 75),
    movEng,
    statDist: Math.round(peakStatGate * 75),
    statEng,
    liveCurrent,
    lm386Vpp,
    csiVar,
    eng: 1,
    gateMov,
    gateStat,
    tags,
  };

  const nodeCoords = [
    { id: 1, name: 'Node 1 (Hub)', role: 'Coordinator + LD2410B + LM386', x: 0.0, y: 0.0 },
    { id: 2, name: 'Node 2 (NE)', role: 'ESP-NOW CSI Transceiver', x: 4.0, y: 0.0 },
    { id: 3, name: 'Node 3 (SE)', role: 'ESP-NOW CSI Transceiver', x: 4.0, y: 4.2 },
    { id: 4, name: 'Node 4 (SW)', role: 'ESP-NOW CSI Transceiver', x: 0.0, y: 4.2 },
  ];

  const nodes: NodeStatus[] = nodeCoords.map((nc) => ({
    id: nc.id,
    name: nc.name,
    role: nc.role,
    x: nc.x,
    y: nc.y,
    online: true,
    isTxSlot: activeTx === nc.id,
    csiVar: Number(
      clamp(csiVar * (0.75 + 0.25 * Math.sin(tSec + nc.id)), 0.4, 60).toFixed(2)
    ),
    lm386Vpp: nc.id === 1 ? lm386Vpp : Math.round(lm386Vpp * 0.35),
    rssiMean: Math.round(-46 - nc.id * 2 + Math.sin(tSec * 0.8 + nc.id) * 2),
    lastSeenMs: nowMs,
  }));

  // 6 curved Wi-Fi CSI link beams between all node pairs
  const pairs: [number, number][] = [
    [1, 2],
    [2, 3],
    [3, 4],
    [4, 1],
    [1, 3],
    [2, 4],
  ];

  const csiLinks: CsiLink[] = pairs.map(([fromNode, toNode], idx) => {
    const linkMod =
      idx >= 4 ? 1.15 : 0.85 + 0.2 * Math.abs(Math.sin(tSec * 1.3 + idx));
    return {
      id: `link-${fromNode}-${toNode}`,
      fromNode,
      toNode,
      variance: Number(clamp(csiVar * linkMod, 0.5, 60).toFixed(2)),
    };
  });

  const meanRssi = Math.round(-48 + Math.sin(tSec * 0.6 + (tickCount % 5)) * 2);

  return {
    packet,
    microWaveformSample,
    nodes,
    csiLinks,
    meanRssi,
    targetPositions: {
      primaryX,
      primaryY,
      secondaryX,
      secondaryY,
    },
  };
}
