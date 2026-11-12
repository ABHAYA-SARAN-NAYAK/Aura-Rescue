import {
  BannerStateId,
  BreathDftResult,
  CalibrationBaseline,
  ClassificationOutput,
  ESP32RawPacket,
  FeatureVector8,
  MLClassLabel,
  TacticalTargetMarker,
  WristTag,
} from '../types/aura';

export function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

/**
 * 1. DFT BREATHING-RATE ESTIMATOR (AuraBreath)
 * - Maintains a 30-second rolling buffer of [timestampMs, stationaryEnergy]
 *   for the peak stationary range gate when a still body is present (statEng > 25 and low motion).
 * - Requires at least 20 seconds (minS = 20) of continuous samples before outputting ready: true.
 * - Subtracts mean, applies Hann window 0.5 * (1 - cos(2 * PI * i / (n - 1))),
 *   and computes Discrete Fourier Transform power across integer BPM frequencies from 6 to 48 breaths/min.
 * - Computes peak-to-average spectral ratio; converts to confidence conf = clamp((ratio - 4) / 12, 0, 1).
 *   If conf >= 0.35, reports bestBpm; otherwise reports rr = 0 (no breathing line found).
 */
export class AuraBreath {
  private buffer: [number, number][] = [];
  private readonly maxWindowMs = 30000;
  private readonly minWindowS = 20;

  public reset(): void {
    this.buffer = [];
  }

  public getBufferLength(): number {
    return this.buffer.length;
  }

  /**
   * Seed buffer with synthetic or pre-warmed samples so scenario switches can
   * either inspect immediate 20s state or watch the 0->20s progress bar live.
   */
  public seedBuffer(samples: [number, number][]): void {
    this.buffer = [...samples];
  }

  public pushSample(
    timestampMs: number,
    statEng: number,
    movEng: number,
    microWaveformVal?: number
  ): BreathDftResult {
    // Only accumulate stationary breathing energy when a still body is present (statEng > 25 and low motion at that gate)
    if (statEng <= 25 || movEng > 65) {
      // Decay or clear if scene lost still target for > 3 seconds
      const lastTs = this.buffer.length > 0 ? this.buffer[this.buffer.length - 1][0] : timestampMs;
      if (timestampMs - lastTs > 3000 || statEng <= 15) {
        this.buffer = [];
      }
      return this.computeResult(false);
    }

    const signalValue = microWaveformVal !== undefined ? statEng + microWaveformVal : statEng;
    this.buffer.push([timestampMs, signalValue]);

    // Prune samples older than 30 seconds
    const cutoff = timestampMs - this.maxWindowMs;
    while (this.buffer.length > 0 && this.buffer[0][0] < cutoff) {
      this.buffer.shift();
    }

    return this.computeResult(true);
  }

  public computeResult(hasStillTarget = true): BreathDftResult {
    if (!hasStillTarget || this.buffer.length < 8) {
      return {
        ready: false,
        progress: 0,
        spanSeconds: 0,
        bestBpm: 0,
        rr: 0,
        conf: 0,
        ratio: 0,
        spectrum: this.createEmptySpectrum(),
        waveform: [],
      };
    }

    const firstTs = this.buffer[0][0];
    const lastTs = this.buffer[this.buffer.length - 1][0];
    const spanSeconds = Math.max(0, (lastTs - firstTs) / 1000);
    const progress = clamp(spanSeconds / this.minWindowS, 0, 1);
    const ready = spanSeconds >= this.minWindowS - 0.05;

    const n = this.buffer.length;
    // Subtract mean
    let sum = 0;
    for (let i = 0; i < n; i++) {
      sum += this.buffer[i][1];
    }
    const mean = sum / n;

    const zeroMean: number[] = new Array(n);
    const windowed: number[] = new Array(n);
    for (let i = 0; i < n; i++) {
      const zm = this.buffer[i][1] - mean;
      zeroMean[i] = zm;
      const hann = n > 1 ? 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1))) : 1;
      windowed[i] = zm * hann;
    }

    // Compute Discrete Fourier Transform power across integer BPM frequencies from 6 to 48 breaths/min
    const powersByBpm: { bpm: number; power: number }[] = [];
    let bestBpm = 6;
    let maxPower = -1;
    let totalPower = 0;

    for (let bpm = 6; bpm <= 48; bpm++) {
      const freqHz = bpm / 60.0;
      let re = 0;
      let im = 0;
      for (let i = 0; i < n; i++) {
        const tSec = (this.buffer[i][0] - firstTs) / 1000.0;
        const angle = 2 * Math.PI * freqHz * tSec;
        re += windowed[i] * Math.cos(angle);
        im -= windowed[i] * Math.sin(angle);
      }
      const power = (re * re + im * im) / (n * n);
      powersByBpm.push({ bpm, power });
      totalPower += power;
      if (power > maxPower) {
        maxPower = power;
        bestBpm = bpm;
      }
    }

    const numFreqs = powersByBpm.length; // 43 integer frequencies (6..48)
    const avgPower = totalPower / Math.max(1, numFreqs);
    // Avoid micro-noise division explosion when signal is near-flatline
    const signalStd = Math.sqrt(
      zeroMean.reduce((acc, v) => acc + v * v, 0) / Math.max(1, n)
    );

    const ratio = signalStd < 0.12 || avgPower < 1e-6 ? 1.0 : maxPower / avgPower;
    const conf = clamp((ratio - 4) / 12, 0, 1);
    const rr = ready && conf >= 0.35 ? bestBpm : 0;

    // Sample 32 bins across 6..48 BPM for the 32-bin DFT Frequency Spectrum bar chart
    const spectrum32: { bpm: number; power: number }[] = [];
    for (let b = 0; b < 32; b++) {
      const idx = Math.min(
        powersByBpm.length - 1,
        Math.round((b / 31) * (powersByBpm.length - 1))
      );
      spectrum32.push(powersByBpm[idx]);
    }

    // Return last 100 zero-mean samples for smooth waveform display
    const recentWaveform = zeroMean.slice(-100);

    return {
      ready,
      progress,
      spanSeconds,
      bestBpm,
      rr,
      conf,
      ratio,
      spectrum: spectrum32,
      waveform: recentWaveform,
    };
  }

  private createEmptySpectrum(): { bpm: number; power: number }[] {
    const bins: { bpm: number; power: number }[] = [];
    for (let b = 0; b < 32; b++) {
      const bpm = Math.round(6 + (b / 31) * (48 - 6));
      bins.push({ bpm, power: 0 });
    }
    return bins;
  }
}

/**
 * 3. 3-SECOND EMPTY-ROOM RECALIBRATION ACCUMULATOR
 */
export class CalibrationAccumulator {
  private gateMovSums = new Array(9).fill(0);
  private gateStatSums = new Array(9).fill(0);
  private csiVarSum = 0;
  private count = 0;

  public reset(): void {
    this.gateMovSums.fill(0);
    this.gateStatSums.fill(0);
    this.csiVarSum = 0;
    this.count = 0;
  }

  public addFrame(gateMov: number[], gateStat: number[], csiVar: number): void {
    for (let i = 0; i < 9; i++) {
      this.gateMovSums[i] += gateMov[i] || 0;
      this.gateStatSums[i] += gateStat[i] || 0;
    }
    this.csiVarSum += csiVar || 0;
    this.count++;
  }

  public finalize(timestamp = Date.now()): CalibrationBaseline {
    if (this.count === 0) {
      return {
        active: false,
        timestamp: null,
        gateMov: new Array(9).fill(0),
        gateStat: new Array(9).fill(0),
        csiVar: 0,
      };
    }
    return {
      active: true,
      timestamp,
      gateMov: this.gateMovSums.map((s) => Number((s / this.count).toFixed(2))),
      gateStat: this.gateStatSums.map((s) => Number((s / this.count).toFixed(2))),
      csiVar: Number((this.csiVarSum / this.count).toFixed(2)),
    };
  }
}

export function applyBaselineToTelemetry(
  rawGateMov: number[],
  rawGateStat: number[],
  rawCsiVar: number,
  baseline: CalibrationBaseline
): {
  gateMov: number[];
  gateStat: number[];
  csiVar: number;
  peakMovGate: number;
  peakStatGate: number;
  movEng: number;
  statEng: number;
} {
  const gateMov = new Array(9).fill(0);
  const gateStat = new Array(9).fill(0);

  let peakMovGate = 0;
  let movEng = 0;
  let peakStatGate = 0;
  let statEng = 0;

  for (let i = 0; i < 9; i++) {
    const baseM = baseline.active ? baseline.gateMov[i] || 0 : 0;
    const baseS = baseline.active ? baseline.gateStat[i] || 0 : 0;
    gateMov[i] = clamp(Math.round((rawGateMov[i] || 0) - baseM), 0, 100);
    gateStat[i] = clamp(Math.round((rawGateStat[i] || 0) - baseS), 0, 100);

    if (gateMov[i] > movEng) {
      movEng = gateMov[i];
      peakMovGate = i;
    }
    if (gateStat[i] > statEng) {
      statEng = gateStat[i];
      peakStatGate = i;
    }
  }

  const csiVar = baseline.active
    ? Math.max(0.1, Number((rawCsiVar - baseline.csiVar).toFixed(2)))
    : Number(rawCsiVar.toFixed(2));

  return {
    gateMov,
    gateStat,
    csiVar,
    peakMovGate,
    peakStatGate,
    movEng,
    statEng,
  };
}

/**
 * 4. ESP32 JSON PACKET PARSER & MULTI-NODE MERGER
 */
export function parseEsp32JsonLine(line: string): ESP32RawPacket | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
    return null;
  }
  try {
    const obj = JSON.parse(trimmed);
    if (typeof obj !== 'object' || obj === null) return null;
    const gateMov = Array.isArray(obj.gateMov)
      ? obj.gateMov.slice(0, 9).map((n: unknown) => clamp(Number(n) || 0, 0, 100))
      : new Array(9).fill(0);
    while (gateMov.length < 9) gateMov.push(0);

    const gateStat = Array.isArray(obj.gateStat)
      ? obj.gateStat.slice(0, 9).map((n: unknown) => clamp(Number(n) || 0, 0, 100))
      : new Array(9).fill(0);
    while (gateStat.length < 9) gateStat.push(0);

    const tags: WristTag[] = Array.isArray(obj.tags)
      ? obj.tags.map((t: Record<string, unknown>) => ({
          id: Number(t?.id) || 1,
          rssi: Number(t?.rssi) || -99,
          sos: Boolean(t?.sos),
        }))
      : [];

    return {
      node: clamp(Number(obj.node) || 1, 1, 4),
      activeTx: clamp(Number(obj.activeTx) || 1, 1, 4),
      target: Number(obj.target) || 0,
      movDist: Number(obj.movDist) || 0,
      movEng: clamp(Number(obj.movEng) || 0, 0, 100),
      statDist: Number(obj.statDist) || 0,
      statEng: clamp(Number(obj.statEng) || 0, 0, 100),
      liveCurrent: Number(obj.liveCurrent) || 0,
      lm386Vpp: Math.max(0, Number(obj.lm386Vpp) || 0),
      csiVar: Math.max(0, Number(obj.csiVar) || 0),
      eng: Number(obj.eng) || 0,
      gateMov,
      gateStat,
      tags,
    };
  } catch {
    return null;
  }
}

export function mergeNodePackets(
  packetsByNode: Map<number, ESP32RawPacket>
): ESP32RawPacket {
  const node1 = packetsByNode.get(1);
  let maxCsiVar = 0;
  let maxLm386Vpp = 0;
  let liveCurrent = 0;
  let activeTx = node1?.activeTx || 1;
  const tagMap = new Map<number, WristTag>();

  for (const pkt of packetsByNode.values()) {
    if (pkt.csiVar > maxCsiVar) maxCsiVar = pkt.csiVar;
    if (pkt.lm386Vpp > maxLm386Vpp) maxLm386Vpp = pkt.lm386Vpp;
    if (pkt.liveCurrent === 1) liveCurrent = 1;
    if (pkt.activeTx) activeTx = pkt.activeTx;

    for (const tag of pkt.tags) {
      const existing = tagMap.get(tag.id);
      if (!existing || tag.rssi > existing.rssi || tag.sos) {
        tagMap.set(tag.id, {
          id: tag.id,
          rssi: existing ? Math.max(existing.rssi, tag.rssi) : tag.rssi,
          sos: Boolean(existing?.sos || tag.sos),
        });
      }
    }
  }

  const gateMov = node1 ? [...node1.gateMov] : new Array(9).fill(0);
  const gateStat = node1 ? [...node1.gateStat] : new Array(9).fill(0);

  return {
    node: 1,
    activeTx,
    target: node1?.target || 0,
    movDist: node1?.movDist || 0,
    movEng: node1?.movEng || Math.max(...gateMov, 0),
    statDist: node1?.statDist || 0,
    statEng: node1?.statEng || Math.max(...gateStat, 0),
    liveCurrent,
    lm386Vpp: maxLm386Vpp,
    csiVar: maxCsiVar,
    eng: node1?.eng || 1,
    gateMov,
    gateStat,
    tags: Array.from(tagMap.values()),
  };
}

/**
 * 2. DUAL CLASSIFICATION ENGINE
 * Input 8-feature vector:
 * [csiVar, movEng, statEng, peakMovGate, peakStatGate, lm386Vpp, breathRate, breathConf]
 */
export function evaluateClassification(params: {
  features: FeatureVector8;
  liveCurrent: number;
  tags: WristTag[];
  breathResult: BreathDftResult;
  classifierMode: 'RF' | 'RULES';
  rfPredictor?: (features: FeatureVector8) => {
    label: MLClassLabel;
    confidence: number;
  };
  targetPositions?: {
    primaryX: number;
    primaryY: number;
    secondaryX?: number;
    secondaryY?: number;
  };
  prevTargets?: TacticalTargetMarker[];
}): ClassificationOutput {
  const [
    csiVar,
    movEng,
    statEng,
    peakMovGate,
    peakStatGate,
    lm386Vpp,
    breathRate,
    breathConf,
  ] = params.features;

  const hasHazard = lm386Vpp >= 350 || params.liveCurrent === 1;
  const sosTag = params.tags.find((t) => t.sos);
  const hasSos = Boolean(sosTag);
  const activeRescuerTag = params.tags.find((t) => t.rssi >= -75);

  const hasActiveMover = movEng > 35 || csiVar > 15;
  const isTaggedRescuerMoving = hasActiveMover && Boolean(activeRescuerTag);
  const isUntaggedMover = hasActiveMover && !activeRescuerTag;

  // Check if there is a still body in quiet scene OR at a separate gate from the mover
  const hasSeparateStillBody =
    statEng > 25 && (!hasActiveMover || Math.abs(peakStatGate - peakMovGate) >= 1);

  // Rule classification for still body
  let stillBodyCategory: 'SURVIVOR' | 'DEAD' | 'PET' | 'CHECKING' | null = null;
  if (hasSeparateStillBody) {
    if (!params.breathResult.ready) {
      stillBodyCategory = 'CHECKING';
    } else if (
      breathConf >= 0.35 &&
      (breathRate > 30 || (breathRate >= 24 && statEng < 35))
    ) {
      stillBodyCategory = 'PET';
    } else if (breathConf >= 0.35 && breathRate >= 6 && breathRate <= 30) {
      stillBodyCategory = 'SURVIVOR';
    } else {
      stillBodyCategory = 'DEAD';
    }
  }

  // Evaluate Random Forest prediction if in RF mode
  let mlPredictedClass: MLClassLabel = 'Clear Room (Empty)';
  let rfConf = 0.88;
  if (params.rfPredictor) {
    const pred = params.rfPredictor(params.features);
    mlPredictedClass = pred.label;
    rfConf = pred.confidence;
  } else {
    if (stillBodyCategory === 'SURVIVOR' || isUntaggedMover) {
      mlPredictedClass = 'Survivor (Trapped)';
    } else if (stillBodyCategory === 'DEAD') {
      mlPredictedClass = 'Dead (No Breathing)';
    } else if (stillBodyCategory === 'PET') {
      mlPredictedClass = 'Pet (Animal)';
    } else if (isTaggedRescuerMoving) {
      mlPredictedClass = 'Rescuer (Active Movement)';
    } else {
      mlPredictedClass = 'Clear Room (Empty)';
    }
  }

  // If RF mode is active and breathing buffer is ready (or no still body checking), allow RF to drive class when no hardware safety override (Hazard / SOS / Checking)
  if (
    params.classifierMode === 'RF' &&
    params.breathResult.ready &&
    hasSeparateStillBody &&
    !isTaggedRescuerMoving
  ) {
    if (mlPredictedClass === 'Survivor (Trapped)') stillBodyCategory = 'SURVIVOR';
    else if (mlPredictedClass === 'Dead (No Breathing)') stillBodyCategory = 'DEAD';
    else if (mlPredictedClass === 'Pet (Animal)') stillBodyCategory = 'PET';
  }

  // Determine Priority Banner State:
  // 1. Live-Wire Hazard
  // 2. Rescuer SOS
  // 3. Survivor Detected (or Rescuer + Survivor)
  // 4. Possible Casualty (DEAD)
  // 5. Checking Breathing
  // 6. Pet / Animal
  // 7. Rescuer Active
  // 8. Zone Clear
  let bannerState: BannerStateId = 'CLEAR';
  if (hasHazard) {
    bannerState = 'HAZARD';
  } else if (hasSos) {
    bannerState = 'SOS';
  } else if (stillBodyCategory === 'SURVIVOR' || isUntaggedMover) {
    bannerState = 'SURVIVOR';
  } else if (stillBodyCategory === 'DEAD') {
    bannerState = 'DEAD';
  } else if (stillBodyCategory === 'CHECKING') {
    bannerState = 'CHECKING';
  } else if (stillBodyCategory === 'PET') {
    bannerState = 'PET';
  } else if (isTaggedRescuerMoving) {
    bannerState = 'RESCUER';
  } else {
    bannerState = 'CLEAR';
  }

  // Build 2D tactical target markers
  const targets: TacticalTargetMarker[] = [];
  const prevMap = new Map<string, { x: number; y: number }[]>();
  if (params.prevTargets) {
    for (const pt of params.prevTargets) {
      prevMap.set(pt.id, pt.trail);
    }
  }

  const defaultStillPos = gateToRoomCoords(peakStatGate, 0);
  const defaultMovPos = gateToRoomCoords(peakMovGate, 0.35);

  if (stillBodyCategory) {
    const x = params.targetPositions?.primaryX ?? defaultStillPos.x;
    const y = params.targetPositions?.primaryY ?? defaultStillPos.y;
    const id = 'target-still-1';
    const prevTrail = prevMap.get(id) || [];
    const labelMap: Record<'SURVIVOR' | 'DEAD' | 'PET' | 'CHECKING', string> = {
      SURVIVOR: 'SURV1',
      DEAD: 'DEAD?1',
      PET: 'PET1',
      CHECKING: '?1',
    };
    targets.push({
      id,
      label: labelMap[stillBodyCategory],
      category: stillBodyCategory,
      x,
      y,
      gate: peakStatGate,
      distanceM: Number((peakStatGate * 0.75).toFixed(2)),
      trail: [...prevTrail.slice(-18), { x, y }],
    });
  }

  if (isTaggedRescuerMoving || hasSos) {
    const x =
      params.targetPositions?.secondaryX ??
      (stillBodyCategory ? defaultMovPos.x : params.targetPositions?.primaryX ?? defaultMovPos.x);
    const y =
      params.targetPositions?.secondaryY ??
      (stillBodyCategory ? defaultMovPos.y : params.targetPositions?.primaryY ?? defaultMovPos.y);
    const id = 'target-resc-1';
    const prevTrail = prevMap.get(id) || [];
    targets.push({
      id,
      label: 'RESC1',
      category: 'RESCUER',
      x,
      y,
      gate: peakMovGate,
      distanceM: Number((peakMovGate * 0.75).toFixed(2)),
      trail: [...prevTrail.slice(-24), { x, y }],
    });
  } else if (isUntaggedMover && !stillBodyCategory) {
    const x = params.targetPositions?.primaryX ?? defaultMovPos.x;
    const y = params.targetPositions?.primaryY ?? defaultMovPos.y;
    const id = 'target-surv-mov-1';
    const prevTrail = prevMap.get(id) || [];
    targets.push({
      id,
      label: 'SURV1',
      category: 'SURVIVOR',
      x,
      y,
      gate: peakMovGate,
      distanceM: Number((peakMovGate * 0.75).toFixed(2)),
      trail: [...prevTrail.slice(-24), { x, y }],
    });
  }

  // Target KPI card label
  let targetKpiLabel: ClassificationOutput['targetKpiLabel'] = 'NONE';
  if (hasHazard) {
    targetKpiLabel = 'HAZARD';
  } else if (hasSos) {
    targetKpiLabel = 'SOS';
  } else if (stillBodyCategory && isTaggedRescuerMoving) {
    targetKpiLabel = '2 PEOPLE';
  } else if (stillBodyCategory === 'SURVIVOR' || isUntaggedMover) {
    targetKpiLabel = 'SURVIVOR';
  } else if (stillBodyCategory === 'DEAD') {
    targetKpiLabel = 'NO BREATHING';
  } else if (stillBodyCategory === 'PET') {
    targetKpiLabel = 'PET';
  } else if (stillBodyCategory === 'CHECKING') {
    targetKpiLabel = 'SURVIVOR';
  } else if (isTaggedRescuerMoving) {
    targetKpiLabel = 'RESCUER';
  } else {
    targetKpiLabel = 'NONE';
  }

  // Primary distance
  const primaryGate = stillBodyCategory
    ? peakStatGate
    : hasActiveMover
    ? peakMovGate
    : 0;
  const targetRangeM = Number((primaryGate * 0.75).toFixed(2));

  // Vitals KPI label
  let vitalsKpiLabel = 'STANDBY';
  let vitalsSubLabel = 'No stationary life signature';
  if (stillBodyCategory === 'CHECKING') {
    const pct = Math.round(params.breathResult.progress * 100);
    vitalsKpiLabel = 'CHECKING…';
    vitalsSubLabel = `Window ${params.breathResult.spanSeconds.toFixed(0)}s / 20s (${pct}%)`;
  } else if (stillBodyCategory === 'SURVIVOR' || stillBodyCategory === 'PET') {
    vitalsKpiLabel = `${breathRate} RPM`;
    vitalsSubLabel =
      stillBodyCategory === 'PET'
        ? `Rapid animal respiration (${Math.round(breathConf * 100)}% conf)`
        : `Human chest micro-motion (${Math.round(breathConf * 100)}% conf)`;
  } else if (stillBodyCategory === 'DEAD') {
    vitalsKpiLabel = 'NO BREATHING';
    vitalsSubLabel = '0 RPM over 20s window — verify manually';
  } else if (hasActiveMover) {
    vitalsKpiLabel = 'MICRO-MOTION';
    vitalsSubLabel = 'High macro-motion masks chest DFT';
  }

  const confidencePct =
    params.classifierMode === 'RF'
      ? Math.round(rfConf * 100)
      : stillBodyCategory === 'SURVIVOR' || stillBodyCategory === 'PET'
      ? Math.round(clamp(breathConf * 100, 55, 99))
      : stillBodyCategory === 'DEAD'
      ? 92
      : hasHazard || hasSos
      ? 99
      : isTaggedRescuerMoving
      ? 95
      : 98;

  const detectedPersonsCount = targets.length;

  return {
    bannerState,
    targetKpiLabel,
    targetRangeM,
    vitalsKpiLabel,
    vitalsSubLabel,
    confidencePct,
    mlPredictedClass,
    hasHazard,
    hasSos,
    detectedPersonsCount,
    targets,
  };
}

export function gateToRoomCoords(
  gate: number,
  angleOffsetRad = 0
): { x: number; y: number } {
  const dist = clamp(gate * 0.75, 0.4, 5.2);
  const baseAngle = Math.atan2(4.2, 4.0) + angleOffsetRad;
  const x = clamp(Number((dist * Math.cos(baseAngle)).toFixed(2)), 0.35, 3.65);
  const y = clamp(Number((dist * Math.sin(baseAngle)).toFixed(2)), 0.35, 3.85);
  return { x, y };
}
