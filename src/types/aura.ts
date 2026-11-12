export type ScenarioId =
  | 'survivor'
  | 'dead'
  | 'pet'
  | 'rescuer'
  | 'rescuer_survivor'
  | 'live_wire'
  | 'rescuer_sos'
  | 'clear';

export type MLClassLabel =
  | 'Survivor (Trapped)'
  | 'Dead (No Breathing)'
  | 'Pet (Animal)'
  | 'Rescuer (Active Movement)'
  | 'Clear Room (Empty)';

export type BannerStateId =
  | 'HAZARD'
  | 'SOS'
  | 'SURVIVOR'
  | 'DEAD'
  | 'CHECKING'
  | 'PET'
  | 'RESCUER'
  | 'CLEAR';

export interface WristTag {
  id: number;
  rssi: number;
  sos: boolean;
}

export interface ESP32RawPacket {
  node: number;
  activeTx: number;
  target: number;
  movDist: number;
  movEng: number;
  statDist: number;
  statEng: number;
  liveCurrent: number;
  lm386Vpp: number;
  csiVar: number;
  eng: number;
  gateMov: number[];
  gateStat: number[];
  tags: WristTag[];
}

export interface CalibrationBaseline {
  active: boolean;
  timestamp: number | null;
  gateMov: number[];
  gateStat: number[];
  csiVar: number;
}

export interface BreathDftResult {
  ready: boolean;
  progress: number; // 0..1 over 20s window
  spanSeconds: number;
  bestBpm: number;
  rr: number; // reported breaths/min (0 if conf < 0.35 or not ready)
  conf: number; // 0..1
  ratio: number;
  spectrum: { bpm: number; power: number }[]; // 32 bins across 6..48 BPM
  waveform: number[]; // recent normalized zero-mean samples for chest micro-motion
}

export interface TacticalTargetMarker {
  id: string;
  label: string; // 'SURV1', 'DEAD?1', 'PET1', 'RESC1', '?1'
  category: 'SURVIVOR' | 'DEAD' | 'PET' | 'RESCUER' | 'CHECKING';
  x: number; // 0..4.0m
  y: number; // 0..4.2m
  gate: number;
  distanceM: number;
  trail: { x: number; y: number }[];
}

export interface NodeStatus {
  id: number;
  name: string;
  role: string;
  x: number;
  y: number;
  online: boolean;
  isTxSlot: boolean;
  csiVar: number;
  lm386Vpp: number;
  rssiMean: number;
  lastSeenMs: number;
}

export interface CsiLink {
  id: string;
  fromNode: number;
  toNode: number;
  variance: number; // 0..60
}

export type FeatureVector8 = [
  number, // 0: csiVar
  number, // 1: movEng
  number, // 2: statEng
  number, // 3: peakMovGate
  number, // 4: peakStatGate
  number, // 5: lm386Vpp
  number, // 6: breathRate
  number  // 7: breathConf
];

export interface ClassificationOutput {
  bannerState: BannerStateId;
  targetKpiLabel:
    | 'NONE'
    | 'SURVIVOR'
    | '2 PEOPLE'
    | 'NO BREATHING'
    | 'PET'
    | 'RESCUER'
    | 'HAZARD'
    | 'SOS';
  targetRangeM: number;
  vitalsKpiLabel: string;
  vitalsSubLabel: string;
  confidencePct: number;
  mlPredictedClass: MLClassLabel;
  hasHazard: boolean;
  hasSos: boolean;
  detectedPersonsCount: number;
  targets: TacticalTargetMarker[];
}

export interface TrainingSample {
  id: string;
  label: MLClassLabel;
  features: FeatureVector8;
  source: 'LIVE' | 'SYNTHETIC' | 'BENCHMARK';
  timestamp: number;
}

export interface TrainedForestMetrics {
  accuracy: number;
  trainCount: number;
  testCount: number;
  treeCount: number;
  maxDepth: number;
  confusionMatrix: number[][]; // 5x5 matrix aligned with ML_CLASSES
  featureImportances: { name: string; key: string; importance: number }[];
  trainedAt: string;
}
