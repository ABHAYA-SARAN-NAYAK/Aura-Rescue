import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AuraBreath,
  CalibrationAccumulator,
  applyBaselineToTelemetry,
  evaluateClassification,
  mergeNodePackets,
  parseEsp32JsonLine,
} from './signalProcessing';
import {
  AuraRandomForest,
  exportSamplesToCsv,
  generate750BenchmarkDataset,
  getPretrainedRandomForest,
} from './randomForest';
import {
  buildPrewarmedBreathSamples,
  stepScenarioSimulation,
} from './scenarioSimulator';

test('AuraBreath requires 20s window before ready=true and accurately estimates 16 BPM survivor breathing', () => {
  const breath = new AuraBreath();
  const startMs = 100000;

  // Feed 10 seconds at 10Hz (not ready yet)
  let res = breath.computeResult(false);
  for (let i = 0; i <= 100; i++) {
    const t = startMs + i * 100;
    const elapsedSec = i * 0.1;
    const wave = 8.0 * Math.sin((2 * Math.PI * 16 * elapsedSec) / 60);
    res = breath.pushSample(t, 65, 4, wave);
  }
  assert.equal(res.ready, false);
  assert.ok(res.progress >= 0.48 && res.progress <= 0.52);

  // Feed up to 22 seconds at 10Hz -> ready=true, bestBpm=16
  for (let i = 101; i <= 220; i++) {
    const t = startMs + i * 100;
    const elapsedSec = i * 0.1;
    const wave = 8.0 * Math.sin((2 * Math.PI * 16 * elapsedSec) / 60);
    res = breath.pushSample(t, 65, 4, wave);
  }
  assert.equal(res.ready, true);
  assert.equal(res.progress, 1);
  assert.ok(Math.abs(res.rr - 16) <= 1, `Expected ~16 BPM, got ${res.rr}`);
  assert.ok(res.conf >= 0.35, `Expected conf >= 0.35, got ${res.conf}`);
  assert.equal(res.spectrum.length, 32);
});

test('AuraBreath detects 0 RPM (no breathing line) on flatline signal after 20s', () => {
  const breath = new AuraBreath();
  const samples = buildPrewarmedBreathSamples('dead', 500000);
  breath.seedBuffer(samples);
  const res = breath.computeResult(true);
  assert.equal(res.ready, true);
  assert.equal(res.rr, 0);
  assert.ok(res.conf < 0.35);
});

test('AuraBreath detects 38 RPM rapid breathing for Pet / Animal scenario', () => {
  const breath = new AuraBreath();
  const samples = buildPrewarmedBreathSamples('pet', 500000);
  breath.seedBuffer(samples);
  const res = breath.computeResult(true);
  assert.equal(res.ready, true);
  assert.ok(Math.abs(res.rr - 38) <= 1, `Expected ~38 BPM, got ${res.rr}`);
  assert.ok(res.conf >= 0.35);
});

test('ESP32 JSON packet parser and multi-node merger follow exact firmware schema', () => {
  const rawLine =
    '{"node":1,"activeTx":1,"target":2,"movDist":0,"movEng":4,"statDist":150,"statEng":65,"liveCurrent":0,"lm386Vpp":80,"csiVar":3.20,"eng":1,"gateMov":[0,0,4,0,0,0,0,0,0],"gateStat":[0,18,65,0,0,0,0,0,0],"tags":[{"id":1,"rssi":-58,"sos":false}]}';
  const pkt1 = parseEsp32JsonLine(rawLine);
  assert.ok(pkt1);
  assert.equal(pkt1.node, 1);
  assert.equal(pkt1.statEng, 65);
  assert.equal(pkt1.gateStat[2], 65);
  assert.equal(pkt1.tags[0].rssi, -58);

  const pkt2 = parseEsp32JsonLine(
    '{"node":2,"activeTx":2,"target":0,"movDist":0,"movEng":0,"statDist":0,"statEng":0,"liveCurrent":1,"lm386Vpp":410,"csiVar":19.5,"eng":1,"gateMov":[0,0,0,0,0,0,0,0,0],"gateStat":[0,0,0,0,0,0,0,0,0],"tags":[{"id":1,"rssi":-52,"sos":true}]}'
  );
  assert.ok(pkt2);

  const map = new Map();
  map.set(1, pkt1);
  map.set(2, pkt2);
  const merged = mergeNodePackets(map);
  assert.equal(merged.gateStat[2], 65); // Radar gates from Node 1
  assert.equal(merged.csiVar, 19.5); // Max CSI across nodes
  assert.equal(merged.lm386Vpp, 410); // Max LM386 Vpp across nodes
  assert.equal(merged.tags[0].rssi, -52); // Strongest RSSI per tag ID
  assert.equal(merged.tags[0].sos, true);
});

test('3-second Empty-Room Calibration subtracts static wall baseline accurately', () => {
  const acc = new CalibrationAccumulator();
  acc.addFrame([2, 4, 10, 0, 0, 0, 0, 0, 0], [5, 20, 30, 0, 0, 0, 0, 0, 0], 2.0);
  acc.addFrame([2, 6, 10, 0, 0, 0, 0, 0, 0], [5, 22, 30, 0, 0, 0, 0, 0, 0], 2.4);
  const baseline = acc.finalize(123456);
  assert.equal(baseline.active, true);
  assert.equal(baseline.gateStat[1], 21);

  const calibrated = applyBaselineToTelemetry(
    [2, 5, 10, 0, 0, 0, 0, 0, 0],
    [5, 21, 80, 0, 0, 0, 0, 0, 0],
    3.2,
    baseline
  );
  assert.equal(calibrated.gateStat[1], 0);
  assert.equal(calibrated.gateStat[2], 50); // 80 - 30 = 50
  assert.equal(calibrated.peakStatGate, 2);
});

test('DualClassificationEngine correctly prioritizes all 8 tactical scenarios', () => {
  const rf = getPretrainedRandomForest();
  const rfPredict = (f: [number, number, number, number, number, number, number, number]) =>
    rf.predict(f);

  // 1. Live-Wire Hazard priority
  const hazardSim = stepScenarioSimulation('live_wire', 600000, 1);
  const breathSurv = new AuraBreath();
  breathSurv.seedBuffer(buildPrewarmedBreathSamples('survivor', 600000));
  const outHazard = evaluateClassification({
    features: [4.1, 5, 62, 2, 2, 520, 16, 0.85],
    liveCurrent: hazardSim.packet.liveCurrent,
    tags: hazardSim.packet.tags,
    breathResult: breathSurv.computeResult(true),
    classifierMode: 'RULES',
    rfPredictor: rfPredict,
  });
  assert.equal(outHazard.bannerState, 'HAZARD');
  assert.equal(outHazard.targetKpiLabel, 'HAZARD');

  // 2. Rescuer SOS priority
  const sosSim = stepScenarioSimulation('rescuer_sos', 600000, 1);
  const outSos = evaluateClassification({
    features: [21.5, 48, 54, 3, 3, 110, 0, 0.1],
    liveCurrent: 0,
    tags: sosSim.packet.tags,
    breathResult: breathSurv.computeResult(false),
    classifierMode: 'RULES',
    rfPredictor: rfPredict,
  });
  assert.equal(outSos.bannerState, 'SOS');
  assert.equal(outSos.targetKpiLabel, 'SOS');

  // 3. Trapped Survivor
  const outSurv = evaluateClassification({
    features: [3.2, 4, 65, 2, 2, 80, 16, 0.82],
    liveCurrent: 0,
    tags: [],
    breathResult: breathSurv.computeResult(true),
    classifierMode: 'RF',
    rfPredictor: rfPredict,
  });
  assert.equal(outSurv.bannerState, 'SURVIVOR');
  assert.equal(outSurv.targetKpiLabel, 'SURVIVOR');

  // 4. Dead (No Breathing)
  const breathDead = new AuraBreath();
  breathDead.seedBuffer(buildPrewarmedBreathSamples('dead', 600000));
  const outDead = evaluateClassification({
    features: [2.1, 1, 46, 4, 4, 74, 0, 0.08],
    liveCurrent: 0,
    tags: [],
    breathResult: breathDead.computeResult(true),
    classifierMode: 'RULES',
    rfPredictor: rfPredict,
  });
  assert.equal(outDead.bannerState, 'DEAD');
  assert.equal(outDead.targetKpiLabel, 'NO BREATHING');
});

test('AuraRandomForest trains 25 CART trees on 750-sample benchmark with >90% test accuracy', () => {
  const dataset = generate750BenchmarkDataset();
  assert.equal(dataset.length, 750);

  const rf = new AuraRandomForest(25, 6);
  const metrics = rf.train(dataset, 99);
  assert.equal(metrics.treeCount, 25);
  assert.equal(metrics.maxDepth, 6);
  assert.ok(metrics.accuracy >= 0.9, `Expected accuracy >= 0.90, got ${metrics.accuracy}`);
  assert.equal(metrics.confusionMatrix.length, 5);

  const csv = exportSamplesToCsv(dataset.slice(0, 5));
  assert.equal(csv.split('\n').length, 6);
});

test('Pre-warmed survivor buffer followed by 50 live simulation ticks maintains 16 RPM and high confidence', () => {
  const startNow = 1700000000000;
  const breath = new AuraBreath();
  breath.seedBuffer(buildPrewarmedBreathSamples('survivor', startNow));

  let lastRes = breath.computeResult(true);
  assert.equal(lastRes.ready, true);
  assert.equal(lastRes.rr, 16);
  assert.ok(lastRes.conf >= 0.75);

  for (let tick = 1; tick <= 50; tick++) {
    const t = startNow + tick * 100;
    const sim = stepScenarioSimulation('survivor', t, tick);
    lastRes = breath.pushSample(
      t,
      sim.packet.statEng,
      sim.packet.movEng,
      sim.microWaveformSample
    );
  }
  assert.equal(lastRes.ready, true);
  assert.equal(lastRes.rr, 16);
  assert.ok(lastRes.conf >= 0.75, `Expected conf >= 0.75 after 50 live ticks, got ${lastRes.conf}`);
});

