import {
  FeatureVector8,
  MLClassLabel,
  TrainedForestMetrics,
  TrainingSample,
} from '../types/aura';

export const ML_CLASSES: MLClassLabel[] = [
  'Survivor (Trapped)',
  'Dead (No Breathing)',
  'Pet (Animal)',
  'Rescuer (Active Movement)',
  'Clear Room (Empty)',
];

export const FEATURE_NAMES: { key: string; name: string; unit: string }[] = [
  { key: 'csiVar', name: 'Wi-Fi CSI Variance', unit: 'σ²' },
  { key: 'movEng', name: 'LD2410B Moving Energy', unit: '0-100' },
  { key: 'statEng', name: 'LD2410B Stationary Energy', unit: '0-100' },
  { key: 'peakMovGate', name: 'Peak Moving Gate', unit: 'G0-G8' },
  { key: 'peakStatGate', name: 'Peak Stationary Gate', unit: 'G0-G8' },
  { key: 'lm386Vpp', name: 'LM386 50/60Hz EMF', unit: 'mVpp' },
  { key: 'breathRate', name: 'DFT Respiration Rate', unit: 'RPM' },
  { key: 'breathConf', name: 'DFT Spectral Confidence', unit: '0-1' },
];

export interface CartNode {
  isLeaf: boolean;
  prediction?: number; // class index 0..4
  classCounts?: number[];
  featureIdx?: number;
  threshold?: number;
  left?: CartNode;
  right?: CartNode;
}

export interface SerializedRandomForest {
  version: string;
  trainedAt: string;
  treeCount: number;
  maxDepth: number;
  classes: MLClassLabel[];
  featureNames: string[];
  metrics: TrainedForestMetrics;
  trees: CartNode[];
}

// Deterministic pseudo-random generator for reproducible splits and benchmark datasets
export class SeededRandom {
  private seed: number;
  constructor(seed = 42) {
    this.seed = seed >>> 0;
  }
  public next(): number {
    this.seed = (1664525 * this.seed + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }
  public range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }
  public normal(mean: number, std: number): number {
    const u1 = Math.max(1e-7, this.next());
    const u2 = this.next();
    const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
    return mean + z0 * std;
  }
}

function giniImpurity(labels: number[], numClasses: number): number {
  const n = labels.length;
  if (n === 0) return 0;
  const counts = new Array(numClasses).fill(0);
  for (let i = 0; i < n; i++) {
    counts[labels[i]]++;
  }
  let sumSq = 0;
  for (let c = 0; c < numClasses; c++) {
    const p = counts[c] / n;
    sumSq += p * p;
  }
  return 1 - sumSq;
}

function majorityClass(labels: number[], numClasses: number): {
  bestClass: number;
  counts: number[];
} {
  const counts = new Array(numClasses).fill(0);
  for (const l of labels) counts[l]++;
  let bestClass = 0;
  let maxC = -1;
  for (let c = 0; c < numClasses; c++) {
    if (counts[c] > maxC) {
      maxC = counts[c];
      bestClass = c;
    }
  }
  return { bestClass, counts };
}

function buildCartTree(
  X: FeatureVector8[],
  y: number[],
  depth: number,
  maxDepth: number,
  numClasses: number,
  featureGainAccum: number[],
  rng: SeededRandom
): CartNode {
  const n = X.length;
  const { bestClass, counts } = majorityClass(y, numClasses);
  const parentGini = giniImpurity(y, numClasses);

  if (depth >= maxDepth || n <= 4 || parentGini <= 1e-5) {
    return {
      isLeaf: true,
      prediction: bestClass,
      classCounts: counts,
    };
  }

  // Random subset of features (sqrt(8) ~ 3 features, or 4 features for stability)
  const allIndices = [0, 1, 2, 3, 4, 5, 6, 7];
  for (let i = allIndices.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    const tmp = allIndices[i];
    allIndices[i] = allIndices[j];
    allIndices[j] = tmp;
  }
  const candidateFeatures = allIndices.slice(0, 4);

  let bestFeature = -1;
  let bestThreshold = 0;
  let bestGain = 0;
  let bestLeftIdx: number[] = [];
  let bestRightIdx: number[] = [];

  for (const fIdx of candidateFeatures) {
    // Collect unique sorted values and sample up to 16 candidate split thresholds
    const vals = X.map((row) => row[fIdx]).sort((a, b) => a - b);
    const uniqueVals: number[] = [];
    for (let i = 0; i < vals.length; i++) {
      if (i === 0 || vals[i] !== vals[i - 1]) uniqueVals.push(vals[i]);
    }
    if (uniqueVals.length <= 1) continue;

    const step = Math.max(1, Math.floor((uniqueVals.length - 1) / 14));
    for (let t = 0; t < uniqueVals.length - 1; t += step) {
      const threshold = (uniqueVals[t] + uniqueVals[t + 1]) / 2;
      const leftIdx: number[] = [];
      const rightIdx: number[] = [];
      const leftY: number[] = [];
      const rightY: number[] = [];

      for (let i = 0; i < n; i++) {
        if (X[i][fIdx] <= threshold) {
          leftIdx.push(i);
          leftY.push(y[i]);
        } else {
          rightIdx.push(i);
          rightY.push(y[i]);
        }
      }

      if (leftIdx.length === 0 || rightIdx.length === 0) continue;

      const leftGini = giniImpurity(leftY, numClasses);
      const rightGini = giniImpurity(rightY, numClasses);
      const weightedChildGini =
        (leftIdx.length / n) * leftGini + (rightIdx.length / n) * rightGini;
      const gain = parentGini - weightedChildGini;

      if (gain > bestGain) {
        bestGain = gain;
        bestFeature = fIdx;
        bestThreshold = threshold;
        bestLeftIdx = leftIdx;
        bestRightIdx = rightIdx;
      }
    }
  }

  if (bestFeature === -1 || bestGain <= 1e-6) {
    return {
      isLeaf: true,
      prediction: bestClass,
      classCounts: counts,
    };
  }

  featureGainAccum[bestFeature] += bestGain * n;

  const leftX = bestLeftIdx.map((i) => X[i]);
  const leftY = bestLeftIdx.map((i) => y[i]);
  const rightX = bestRightIdx.map((i) => X[i]);
  const rightY = bestRightIdx.map((i) => y[i]);

  return {
    isLeaf: false,
    featureIdx: bestFeature,
    threshold: Number(bestThreshold.toFixed(4)),
    left: buildCartTree(
      leftX,
      leftY,
      depth + 1,
      maxDepth,
      numClasses,
      featureGainAccum,
      rng
    ),
    right: buildCartTree(
      rightX,
      rightY,
      depth + 1,
      maxDepth,
      numClasses,
      featureGainAccum,
      rng
    ),
  };
}

export function predictSingleTree(node: CartNode, features: FeatureVector8): number {
  let curr = node;
  while (!curr.isLeaf) {
    const fIdx = curr.featureIdx ?? 0;
    const thresh = curr.threshold ?? 0;
    if (features[fIdx] <= thresh) {
      curr = curr.left!;
    } else {
      curr = curr.right!;
    }
  }
  return curr.prediction ?? 0;
}

export class AuraRandomForest {
  private trees: CartNode[] = [];
  private metrics: TrainedForestMetrics | null = null;
  private readonly treeCount: number;
  private readonly maxDepth: number;

  constructor(treeCount = 25, maxDepth = 6) {
    this.treeCount = treeCount;
    this.maxDepth = maxDepth;
  }

  public train(samples: TrainingSample[], seed = 1337): TrainedForestMetrics {
    const rng = new SeededRandom(seed);
    const numClasses = ML_CLASSES.length;

    // Group samples by class for stratified 75/25 train-test split
    const byClass: Map<number, { x: FeatureVector8; y: number }[]> = new Map();
    for (let c = 0; c < numClasses; c++) byClass.set(c, []);

    for (const s of samples) {
      const cIdx = ML_CLASSES.indexOf(s.label);
      if (cIdx >= 0) {
        byClass.get(cIdx)!.push({ x: s.features, y: cIdx });
      }
    }

    const trainX: FeatureVector8[] = [];
    const trainY: number[] = [];
    const testX: FeatureVector8[] = [];
    const testY: number[] = [];

    for (let c = 0; c < numClasses; c++) {
      const group = [...(byClass.get(c) || [])];
      // Shuffle group
      for (let i = group.length - 1; i > 0; i--) {
        const j = Math.floor(rng.next() * (i + 1));
        const tmp = group[i];
        group[i] = group[j];
        group[j] = tmp;
      }
      const splitIdx = Math.max(1, Math.floor(group.length * 0.75));
      for (let i = 0; i < group.length; i++) {
        if (i < splitIdx || group.length === 1) {
          trainX.push(group[i].x);
          trainY.push(group[i].y);
        } else {
          testX.push(group[i].x);
          testY.push(group[i].y);
        }
      }
    }

    // If test set is empty (too few samples), evaluate on train set
    const evalX = testX.length > 0 ? testX : trainX;
    const evalY = testY.length > 0 ? testY : trainY;

    const featureGainAccum = new Array(8).fill(0);
    this.trees = [];

    const nTrain = trainX.length;
    for (let t = 0; t < this.treeCount; t++) {
      // Bootstrap sample of size nTrain
      const bootX: FeatureVector8[] = [];
      const bootY: number[] = [];
      for (let i = 0; i < nTrain; i++) {
        const idx = Math.floor(rng.next() * nTrain);
        bootX.push(trainX[idx]);
        bootY.push(trainY[idx]);
      }

      const tree = buildCartTree(
        bootX,
        bootY,
        0,
        this.maxDepth,
        numClasses,
        featureGainAccum,
        rng
      );
      this.trees.push(tree);
    }

    // Evaluate on test set and build 5x5 Confusion Matrix
    const confusionMatrix: number[][] = Array.from({ length: numClasses }, () =>
      new Array(numClasses).fill(0)
    );
    let correct = 0;
    for (let i = 0; i < evalX.length; i++) {
      const pred = this.predict(evalX[i]);
      const predIdx = ML_CLASSES.indexOf(pred.label);
      const actualIdx = evalY[i];
      confusionMatrix[actualIdx][predIdx]++;
      if (predIdx === actualIdx) correct++;
    }

    const accuracy = evalX.length > 0 ? correct / evalX.length : 1;

    const totalGain = featureGainAccum.reduce((a, b) => a + b, 0) || 1;
    const featureImportances = FEATURE_NAMES.map((f, idx) => ({
      name: f.name,
      key: f.key,
      importance: Number((featureGainAccum[idx] / totalGain).toFixed(4)),
    })).sort((a, b) => b.importance - a.importance);

    this.metrics = {
      accuracy: Number(accuracy.toFixed(4)),
      trainCount: trainX.length,
      testCount: evalX.length,
      treeCount: this.treeCount,
      maxDepth: this.maxDepth,
      confusionMatrix,
      featureImportances,
      trainedAt: new Date().toISOString(),
    };

    return this.metrics;
  }

  public predict(features: FeatureVector8): {
    label: MLClassLabel;
    confidence: number;
    votes: Record<MLClassLabel, number>;
  } {
    const votes = new Array(ML_CLASSES.length).fill(0);
    if (this.trees.length === 0) {
      return {
        label: 'Clear Room (Empty)',
        confidence: 0.5,
        votes: {
          'Survivor (Trapped)': 0,
          'Dead (No Breathing)': 0,
          'Pet (Animal)': 0,
          'Rescuer (Active Movement)': 0,
          'Clear Room (Empty)': 1,
        },
      };
    }

    for (const tree of this.trees) {
      const cIdx = predictSingleTree(tree, features);
      votes[cIdx]++;
    }

    let bestIdx = 0;
    let maxVotes = -1;
    for (let c = 0; c < votes.length; c++) {
      if (votes[c] > maxVotes) {
        maxVotes = votes[c];
        bestIdx = c;
      }
    }

    const voteRecord = {} as Record<MLClassLabel, number>;
    ML_CLASSES.forEach((cls, idx) => {
      voteRecord[cls] = votes[idx];
    });

    return {
      label: ML_CLASSES[bestIdx],
      confidence: Number((maxVotes / this.trees.length).toFixed(2)),
      votes: voteRecord,
    };
  }

  public getMetrics(): TrainedForestMetrics | null {
    return this.metrics;
  }

  public toJSON(): SerializedRandomForest {
    return {
      version: 'AURA-RF-1.0',
      trainedAt: this.metrics?.trainedAt || new Date().toISOString(),
      treeCount: this.treeCount,
      maxDepth: this.maxDepth,
      classes: ML_CLASSES,
      featureNames: FEATURE_NAMES.map((f) => f.key),
      metrics:
        this.metrics || {
          accuracy: 0,
          trainCount: 0,
          testCount: 0,
          treeCount: this.treeCount,
          maxDepth: this.maxDepth,
          confusionMatrix: Array.from({ length: 5 }, () => new Array(5).fill(0)),
          featureImportances: [],
          trainedAt: new Date().toISOString(),
        },
      trees: this.trees,
    };
  }
}

/**
 * Generates realistic synthetic 8-feature vectors for any of the 5 classes
 * [csiVar, movEng, statEng, peakMovGate, peakStatGate, lm386Vpp, breathRate, breathConf]
 */
export function generateSyntheticSamplesForClass(
  label: MLClassLabel,
  count: number,
  seed = Date.now(),
  source: 'SYNTHETIC' | 'BENCHMARK' = 'SYNTHETIC'
): TrainingSample[] {
  const rng = new SeededRandom(seed);
  const samples: TrainingSample[] = [];
  const clampVal = (v: number, min: number, max: number) =>
    Math.max(min, Math.min(max, v));

  for (let i = 0; i < count; i++) {
    let f: FeatureVector8;

    switch (label) {
      case 'Survivor (Trapped)': {
        const csiVar = Number(clampVal(rng.normal(3.4, 1.4), 0.8, 11.0).toFixed(2));
        const movEng = Math.round(clampVal(rng.normal(6, 4), 0, 24));
        const statEng = Math.round(clampVal(rng.normal(64, 14), 32, 98));
        const peakMovGate = Math.floor(rng.range(1, 6));
        const peakStatGate = Math.floor(rng.range(1, 6));
        const lm386Vpp = Math.round(clampVal(rng.normal(82, 25), 25, 220));
        const breathRate = Math.round(clampVal(rng.normal(16, 4), 8, 27));
        const breathConf = Number(clampVal(rng.normal(0.76, 0.12), 0.42, 0.99).toFixed(2));
        f = [
          csiVar,
          movEng,
          statEng,
          peakMovGate,
          peakStatGate,
          lm386Vpp,
          breathRate,
          breathConf,
        ];
        break;
      }
      case 'Dead (No Breathing)': {
        const csiVar = Number(clampVal(rng.normal(2.1, 0.9), 0.5, 6.5).toFixed(2));
        const movEng = Math.round(clampVal(rng.normal(3, 2), 0, 12));
        const statEng = Math.round(clampVal(rng.normal(46, 11), 28, 82));
        const peakMovGate = Math.floor(rng.range(1, 6));
        const peakStatGate = Math.floor(rng.range(2, 7));
        const lm386Vpp = Math.round(clampVal(rng.normal(75, 22), 20, 210));
        const breathRate = 0;
        const breathConf = Number(clampVal(rng.normal(0.11, 0.08), 0.0, 0.31).toFixed(2));
        f = [
          csiVar,
          movEng,
          statEng,
          peakMovGate,
          peakStatGate,
          lm386Vpp,
          breathRate,
          breathConf,
        ];
        break;
      }
      case 'Pet (Animal)': {
        const csiVar = Number(clampVal(rng.normal(6.2, 2.2), 1.5, 14.0).toFixed(2));
        const movEng = Math.round(clampVal(rng.normal(14, 6), 2, 32));
        const statEng = Math.round(clampVal(rng.normal(33, 7), 26, 52));
        const peakMovGate = Math.floor(rng.range(1, 4));
        const peakStatGate = Math.floor(rng.range(1, 4));
        const lm386Vpp = Math.round(clampVal(rng.normal(78, 20), 25, 200));
        const breathRate = Math.round(clampVal(rng.normal(38, 4), 31, 47));
        const breathConf = Number(clampVal(rng.normal(0.68, 0.13), 0.38, 0.96).toFixed(2));
        f = [
          csiVar,
          movEng,
          statEng,
          peakMovGate,
          peakStatGate,
          lm386Vpp,
          breathRate,
          breathConf,
        ];
        break;
      }
      case 'Rescuer (Active Movement)': {
        const csiVar = Number(clampVal(rng.normal(36.5, 8.5), 16.5, 58.0).toFixed(2));
        const movEng = Math.round(clampVal(rng.normal(82, 11), 42, 100));
        const statEng = Math.round(clampVal(rng.normal(40, 15), 12, 78));
        const peakMovGate = Math.floor(rng.range(1, 7));
        const peakStatGate = peakMovGate;
        const lm386Vpp = Math.round(clampVal(rng.normal(95, 30), 30, 260));
        const breathRate = Math.round(clampVal(rng.normal(22, 6), 0, 32));
        const breathConf = Number(clampVal(rng.normal(0.24, 0.12), 0.05, 0.55).toFixed(2));
        f = [
          csiVar,
          movEng,
          statEng,
          peakMovGate,
          peakStatGate,
          lm386Vpp,
          breathRate,
          breathConf,
        ];
        break;
      }
      case 'Clear Room (Empty)':
      default: {
        const csiVar = Number(clampVal(rng.normal(1.2, 0.5), 0.2, 3.2).toFixed(2));
        const movEng = Math.round(clampVal(rng.normal(2, 2), 0, 9));
        const statEng = Math.round(clampVal(rng.normal(8, 4), 0, 21));
        const peakMovGate = 0;
        const peakStatGate = 0;
        const lm386Vpp = Math.round(clampVal(rng.normal(64, 18), 18, 140));
        const breathRate = 0;
        const breathConf = Number(clampVal(rng.normal(0.05, 0.04), 0.0, 0.18).toFixed(2));
        f = [
          csiVar,
          movEng,
          statEng,
          peakMovGate,
          peakStatGate,
          lm386Vpp,
          breathRate,
          breathConf,
        ];
        break;
      }
    }

    samples.push({
      id: `${source.toLowerCase()}-${label.slice(0, 4).toLowerCase()}-${seed}-${i}`,
      label,
      features: f,
      source,
      timestamp: Date.now() - (count - i) * 100,
    });
  }

  return samples;
}

/**
 * Generates the complete 750-Sample Benchmark Dataset (150 per class across all 5 classes)
 */
export function generate750BenchmarkDataset(): TrainingSample[] {
  const dataset: TrainingSample[] = [];
  ML_CLASSES.forEach((cls, idx) => {
    const classSamples = generateSyntheticSamplesForClass(
      cls,
      150,
      2026 + idx * 101,
      'BENCHMARK'
    );
    dataset.push(...classSamples);
  });
  return dataset;
}

export function exportSamplesToCsv(samples: TrainingSample[]): string {
  const header = [
    'id',
    'label',
    'source',
    'csiVar',
    'movEng',
    'statEng',
    'peakMovGate',
    'peakStatGate',
    'lm386Vpp',
    'breathRate',
    'breathConf',
  ].join(',');

  const rows = samples.map((s) =>
    [
      s.id,
      `"${s.label}"`,
      s.source,
      ...s.features.map((v) => Number(v.toFixed(3))),
    ].join(',')
  );

  return [header, ...rows].join('\n');
}

// Create and pre-train the default in-browser Random Forest model on boot
let defaultPretrainedForest: AuraRandomForest | null = null;

export function getPretrainedRandomForest(): AuraRandomForest {
  if (!defaultPretrainedForest) {
    const rf = new AuraRandomForest(25, 6);
    const benchmark = generate750BenchmarkDataset();
    rf.train(benchmark, 42);
    defaultPretrainedForest = rf;
  }
  return defaultPretrainedForest;
}
