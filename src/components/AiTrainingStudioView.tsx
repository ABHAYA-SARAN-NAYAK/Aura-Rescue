import React, { useState } from 'react';
import {
  FeatureVector8,
  MLClassLabel,
  TrainedForestMetrics,
  TrainingSample,
} from '../types/aura';
import {
  AuraRandomForest,
  FEATURE_NAMES,
  ML_CLASSES,
  exportSamplesToCsv,
  generate750BenchmarkDataset,
  generateSyntheticSamplesForClass,
} from '../utils/randomForest';

interface AiTrainingStudioViewProps {
  liveFeatures: FeatureVector8;
  samples: TrainingSample[];
  onUpdateSamples: (samples: TrainingSample[]) => void;
  activeMetrics: TrainedForestMetrics;
  onApplyTrainedForest: (forest: AuraRandomForest, metrics: TrainedForestMetrics) => void;
  hasCustomModelApplied: boolean;
}

export const AiTrainingStudioView: React.FC<AiTrainingStudioViewProps> = ({
  liveFeatures,
  samples,
  onUpdateSamples,
  activeMetrics,
  onApplyTrainedForest,
  hasCustomModelApplied,
}) => {
  const [selectedClass, setSelectedClass] = useState<MLClassLabel>(
    'Survivor (Trapped)'
  );
  const [batchSize, setBatchSize] = useState<50 | 100 | 250 | 500>(100);
  const [trainedForest, setTrainedForest] = useState<AuraRandomForest | null>(
    null
  );
  const [latestMetrics, setLatestMetrics] =
    useState<TrainedForestMetrics>(activeMetrics);
  const [statusBanner, setStatusBanner] = useState<string>(
    'Pre-trained 25-Tree Random Forest active. Record new vectors or load the 750-sample benchmark dataset to train a custom model.'
  );

  // Count samples per class
  const countByClass = (cls: MLClassLabel) =>
    samples.filter((s) => s.label === cls).length;

  // Record from Live Stream
  const handleRecordLiveBatch = () => {
    const newSamples: TrainingSample[] = [];
    for (let i = 0; i < batchSize; i++) {
      // Perturb current live vector slightly across batch to simulate stream capture ticks
      const jitter = (idx: number, scale: number) =>
        Number((liveFeatures[idx] + (Math.sin(i * 1.7 + idx) * scale)).toFixed(2));
      const vec: FeatureVector8 = [
        Math.max(0.1, jitter(0, 0.35)),
        Math.max(0, Math.min(100, Math.round(jitter(1, 2)))),
        Math.max(0, Math.min(100, Math.round(jitter(2, 2)))),
        liveFeatures[3],
        liveFeatures[4],
        Math.max(10, Math.round(jitter(5, 5))),
        Math.max(0, Math.round(jitter(6, 1))),
        Math.max(0, Math.min(1, Number(jitter(7, 0.03).toFixed(2)))),
      ];
      newSamples.push({
        id: `live-${Date.now()}-${i}`,
        label: selectedClass,
        features: vec,
        source: 'LIVE',
        timestamp: Date.now() - (batchSize - i) * 50,
      });
    }
    const merged = [...samples, ...newSamples];
    onUpdateSamples(merged);
    setStatusBanner(
      `Recorded ${batchSize} LIVE stream vectors for class "${selectedClass}". Total dataset: ${merged.length} samples.`
    );
  };

  // Generate Synthetic Vectors for Selected Class
  const handleGenerateSyntheticBatch = () => {
    const synth = generateSyntheticSamplesForClass(
      selectedClass,
      batchSize,
      Date.now(),
      'SYNTHETIC'
    );
    const merged = [...samples, ...synth];
    onUpdateSamples(merged);
    setStatusBanner(
      `Generated ${batchSize} synthetic physics vectors for "${selectedClass}". Total dataset: ${merged.length} samples.`
    );
  };

  // 1-Click Load 750-Sample Benchmark Dataset
  const handleLoad750Benchmark = () => {
    const bench = generate750BenchmarkDataset();
    onUpdateSamples(bench);
    setStatusBanner(
      'Loaded 750-Sample Benchmark Dataset (150 samples × 5 classes). Ready for stratified 75/25 CART Random Forest training.'
    );
  };

  // Train 25-Tree Random Forest (Max Depth 6, Gini Impurity, Stratified 75/25 Split)
  const handleTrainForest = () => {
    if (samples.length < 10) {
      setStatusBanner(
        'Please load the 750-Sample Benchmark Dataset or record at least 10 samples before training.'
      );
      return;
    }
    const rf = new AuraRandomForest(25, 6);
    const metrics = rf.train(samples, Date.now() % 10000);
    setTrainedForest(rf);
    setLatestMetrics(metrics);
    setStatusBanner(
      `Trained 25 CART Decision Trees (max depth 6, Gini impurity) on ${metrics.trainCount} train / ${metrics.testCount} test samples — Test Accuracy: ${(metrics.accuracy * 100).toFixed(2)}%.`
    );
  };

  // Apply Trained Model to Live Monitor
  const handleApplyToLiveMonitor = () => {
    if (trainedForest) {
      onApplyTrainedForest(trainedForest, latestMetrics);
      setStatusBanner(
        `Applied newly trained Random Forest (${(latestMetrics.accuracy * 100).toFixed(2)}% accuracy) directly to Live Tactical Monitor.`
      );
    } else {
      const rf = new AuraRandomForest(25, 6);
      const dataset = samples.length >= 25 ? samples : generate750BenchmarkDataset();
      const metrics = rf.train(dataset, 777);
      setTrainedForest(rf);
      setLatestMetrics(metrics);
      onApplyTrainedForest(rf, metrics);
      setStatusBanner(
        `Trained and applied Random Forest (${(metrics.accuracy * 100).toFixed(2)}% accuracy) to Live Tactical Monitor.`
      );
    }
  };

  // Export CSV
  const handleExportCsv = () => {
    const csvContent = exportSamplesToCsv(samples);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `aura_rescue_dataset_${samples.length}_samples.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setStatusBanner(`Exported ${samples.length} samples to CSV.`);
  };

  // Download Model JSON
  const handleDownloadModelJson = () => {
    const rf = trainedForest || new AuraRandomForest(25, 6);
    if (!trainedForest) {
      rf.train(samples.length >= 25 ? samples : generate750BenchmarkDataset(), 42);
    }
    const jsonStr = JSON.stringify(rf.toJSON(), null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'aura_rescue_random_forest_25trees.json';
    a.click();
    URL.revokeObjectURL(url);
    setStatusBanner('Downloaded serialized 25-tree Random Forest JSON model.');
  };

  const classColorMap: Record<MLClassLabel, string> = {
    'Survivor (Trapped)': 'border-[#22e6f0] text-[#22e6f0]',
    'Dead (No Breathing)': 'border-[#a78bfa] text-[#a78bfa]',
    'Pet (Animal)': 'border-[#ffb02e] text-[#ffb02e]',
    'Rescuer (Active Movement)': 'border-[#ff4d5a] text-[#ff4d5a]',
    'Clear Room (Empty)': 'border-[#2dff7a] text-[#2dff7a]',
  };

  return (
    <div className="flex flex-col gap-5 pb-12">
      {/* Studio Header Banner */}
      <div className="aura-card rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">
            AI Training Studio — In-Browser Dataset Recorder & CART Random Forest Lab
          </h1>
          <p className="text-xs font-mono text-slate-300 mt-1">
            {statusBanner}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleLoad750Benchmark}
            className="px-3.5 py-2 text-xs font-mono font-semibold rounded-lg bg-[#22e6f0] text-slate-950 hover:bg-cyan-300 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Load 750-Sample Benchmark Dataset
          </button>
          <button
            type="button"
            onClick={handleExportCsv}
            className="px-3.5 py-2 text-xs font-mono font-medium rounded-lg border border-slate-600 bg-slate-900 text-slate-200 hover:text-white hover:border-slate-400 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Export CSV ({samples.length})
          </button>
        </div>
      </div>

      {/* 1. CLASS SELECTOR CARDS & LIVE SAMPLE COUNTERS (5 Classes) */}
      <section aria-label="Target Class Selector Cards">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xs font-mono uppercase tracking-wider text-slate-400">
            1. Select Target Class & Inspect Sample Distribution ({samples.length} Total Vectors)
          </h2>
          <button
            type="button"
            onClick={() => {
              onUpdateSamples([]);
              setStatusBanner('Cleared dataset buffer.');
            }}
            className="text-xs font-mono text-rose-400 hover:text-rose-300 cursor-pointer"
          >
            Clear Dataset
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {ML_CLASSES.map((cls) => {
            const count = countByClass(cls);
            const isSelected = selectedClass === cls;
            return (
              <button
                key={cls}
                type="button"
                onClick={() => setSelectedClass(cls)}
                className={`text-left rounded-xl p-3.5 transition-all cursor-pointer border ${
                  isSelected
                    ? `${classColorMap[cls]} bg-slate-900/95 shadow-lg`
                    : 'border-slate-800 bg-[#0e1434]/75 text-slate-300 hover:border-slate-600'
                }`}
              >
                <div className="text-xs font-mono uppercase text-slate-400">
                  CLASS TARGET
                </div>
                <div className="text-sm font-bold text-white mt-0.5 truncate">
                  {cls}
                </div>
                <div className="mt-2 flex items-baseline justify-between font-mono">
                  <span className="text-2xl font-bold text-white">{count}</span>
                  <span className="text-xs text-slate-400">samples</span>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* 2. SAMPLE RECORDER & TRAINER CONTROLS */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Left 5 Cols: Recorder Controls + Feature Importances */}
        <div className="lg:col-span-5 flex flex-col gap-4">
          <div className="aura-card rounded-xl p-4 flex flex-col gap-3.5">
            <h2 className="text-sm font-bold uppercase tracking-wider text-slate-100">
              2. Vector Sample Recorder & Batch Generator
            </h2>

            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-mono text-slate-400">
                Selected Class: <strong className="text-white">{selectedClass}</strong>
              </span>
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-slate-400">Batch Size:</span>
                {([50, 100, 250, 500] as const).map((sz) => (
                  <button
                    key={sz}
                    type="button"
                    onClick={() => setBatchSize(sz)}
                    className={`px-2.5 py-1 text-xs font-mono rounded border cursor-pointer ${
                      batchSize === sz
                        ? 'bg-[#22e6f0] text-slate-950 border-[#22e6f0] font-bold'
                        : 'bg-slate-900 border-slate-700 text-slate-300 hover:text-white'
                    }`}
                  >
                    {sz}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={handleRecordLiveBatch}
                className="px-3 py-2 text-xs font-mono font-semibold rounded-lg border border-emerald-400/50 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25 transition-colors cursor-pointer"
              >
                Record {batchSize} Live Stream Samples
              </button>
              <button
                type="button"
                onClick={handleGenerateSyntheticBatch}
                className="px-3 py-2 text-xs font-mono font-semibold rounded-lg border border-cyan-400/50 bg-cyan-500/15 text-cyan-200 hover:bg-cyan-500/25 transition-colors cursor-pointer"
              >
                Generate {batchSize} Synthetic Vectors
              </button>
            </div>

            <div className="border-t border-slate-800 pt-3 flex flex-col gap-2.5">
              <div className="flex items-center justify-between text-xs font-mono text-slate-300">
                <span>CART Random Forest Hyperparameters</span>
                <span className="text-[#22e6f0]">25 Trees · Depth 6 · Gini</span>
              </div>
              <button
                type="button"
                onClick={handleTrainForest}
                className="w-full py-2.5 text-xs font-mono font-bold uppercase tracking-wider rounded-lg bg-[#e5202e] hover:bg-[#ff4d5a] text-white transition-colors cursor-pointer"
              >
                Train Random Forest (25 Trees · 75/25 Split)
              </button>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={handleApplyToLiveMonitor}
                  className="px-3 py-2 text-xs font-mono font-semibold rounded-lg bg-[#2dff7a] text-slate-950 hover:bg-emerald-300 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Apply Trained Model
                </button>
                <button
                  type="button"
                  onClick={handleDownloadModelJson}
                  className="px-3 py-2 text-xs font-mono font-medium rounded-lg border border-slate-600 bg-slate-900 text-slate-200 hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Download Model JSON
                </button>
              </div>
            </div>
          </div>

          {/* Feature Importance Breakdown */}
          <div className="aura-card rounded-xl p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold uppercase tracking-wider text-slate-100">
                Gini Feature Importance Breakdown
              </h2>
              <span className="text-xs font-mono text-slate-400">8 Features</span>
            </div>

            <div className="flex flex-col gap-2">
              {latestMetrics.featureImportances.map((fi) => {
                const pct = Math.round(fi.importance * 100);
                return (
                  <div key={fi.key} className="flex flex-col gap-1">
                    <div className="flex justify-between text-xs font-mono">
                      <span className="text-slate-300">{fi.name}</span>
                      <span className="text-[#22e6f0] font-semibold">
                        {(fi.importance * 100).toFixed(1)}%
                      </span>
                    </div>
                    <div className="w-full h-2 bg-slate-950 rounded overflow-hidden border border-slate-800">
                      <div
                        className="h-full bg-[#22e6f0]"
                        style={{ width: `${Math.max(3, pct)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right 7 Cols: 5x5 Confusion Matrix + Accuracy Readout + Recent Vectors Table */}
        <div className="lg:col-span-7 flex flex-col gap-4">
          {/* Confusion Matrix & Test Accuracy Card */}
          <div className="aura-card rounded-xl p-4 flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-bold uppercase tracking-wider text-slate-100">
                  Interactive 5×5 Confusion Matrix (Stratified 25% Holdout Test Set)
                </h2>
                <p className="text-xs font-mono text-slate-400">
                  Train Split: {latestMetrics.trainCount} vectors · Test Split:{' '}
                  {latestMetrics.testCount} vectors ·{' '}
                  {hasCustomModelApplied ? 'Custom Model Active in HUD' : 'Default Pre-trained Model'}
                </p>
              </div>
              <div className="bg-slate-950/90 border border-emerald-500/40 rounded-lg px-3.5 py-2 text-right font-mono">
                <div className="text-[10px] text-slate-400">TEST ACCURACY</div>
                <div
                  data-testid="rf-test-accuracy"
                  className="text-2xl font-bold text-[#2dff7a]"
                >
                  {(latestMetrics.accuracy * 100).toFixed(1)}%
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs font-mono border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400">
                    <th className="py-2 px-2 text-left">Actual \ Pred</th>
                    {ML_CLASSES.map((c) => (
                      <th key={c} className="py-2 px-2 text-center">
                        {c.split(' ')[0]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ML_CLASSES.map((rowCls, rIdx) => (
                    <tr key={rowCls} className="border-b border-slate-800/60">
                      <td className="py-2 px-2 font-semibold text-slate-200">
                        {rowCls}
                      </td>
                      {ML_CLASSES.map((colCls, cIdx) => {
                        const val =
                          latestMetrics.confusionMatrix[rIdx]?.[cIdx] ?? 0;
                        const isDiag = rIdx === cIdx;
                        return (
                          <td
                            key={colCls}
                            className={`py-2 px-2 text-center rounded ${
                              isDiag && val > 0
                                ? 'bg-emerald-500/20 text-[#2dff7a] font-bold'
                                : val > 0
                                ? 'bg-rose-500/20 text-rose-300 font-semibold'
                                : 'text-slate-600'
                            }`}
                          >
                            {val}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Recent Samples Vector Table */}
          <div className="aura-card rounded-xl p-4 flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold uppercase tracking-wider text-slate-100">
                Recent 8-Feature Telemetry Vectors (Last 10 Recorded Samples)
              </h2>
              <span className="text-xs font-mono text-slate-400">
                Showing {Math.min(10, samples.length)} of {samples.length}
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs font-mono border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400">
                    <th className="py-1.5 px-2 text-left">Class Label</th>
                    <th className="py-1.5 px-2 text-left">Source</th>
                    {FEATURE_NAMES.map((f) => (
                      <th key={f.key} className="py-1.5 px-1.5 text-right">
                        {f.key}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {samples.slice(-10).reverse().map((s) => (
                    <tr
                      key={s.id}
                      className="border-b border-slate-800/50 hover:bg-slate-900/50"
                    >
                      <td className="py-1.5 px-2 text-slate-200 font-semibold">
                        {s.label}
                      </td>
                      <td className="py-1.5 px-2 text-slate-400">{s.source}</td>
                      {s.features.map((v, i) => (
                        <td key={i} className="py-1.5 px-1.5 text-right text-slate-300">
                          {Number(v.toFixed(2))}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
