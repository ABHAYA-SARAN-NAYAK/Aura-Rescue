import React from 'react';

export const SystemBlueprintView: React.FC = () => {
  const pinoutRows = [
    {
      module: 'HLK-LD2410B 24 GHz Radar',
      pin: 'UART TX',
      esp32Pin: 'GPIO 16 (UART2 RX)',
      voltage: '3.3V TTL',
      notes: '256000 baud binary frame stream (9 range gates @ 0.75m)',
    },
    {
      module: 'HLK-LD2410B 24 GHz Radar',
      pin: 'UART RX',
      esp32Pin: 'GPIO 17 (UART2 TX)',
      voltage: '3.3V TTL',
      notes: 'Engineering mode configuration & sensitivity commands',
    },
    {
      module: 'HLK-LD2410B 24 GHz Radar',
      pin: 'VCC / GND',
      esp32Pin: '5V (VIN) / GND',
      voltage: '5.0V DC (~90mA)',
      notes: 'Requires clean 5V rail for 24 GHz MMIC oscillator stability',
    },
    {
      module: 'LM386 EMF Live-Wire Probe',
      pin: 'OUT (Envelope / AC)',
      esp32Pin: 'GPIO 34 (ADC1_CH6)',
      voltage: '0–3.3V Analog',
      notes: 'Samples 50/60 Hz mains induction Vpp (Hazard >= 350 Vpp)',
    },
    {
      module: 'LM386 EMF Live-Wire Probe',
      pin: 'IN + 15cm Copper Antenna',
      esp32Pin: 'High-Z Probe Input',
      voltage: 'Passive Capacitive',
      notes: 'Non-contact E-field pickup for hidden live AC conduits',
    },
    {
      module: 'LM386 EMF Live-Wire Probe',
      pin: 'VCC / GND',
      esp32Pin: '3.3V / GND',
      voltage: '3.3V DC',
      notes: 'Prevents ADC1 over-voltage clipping on ESP32 GPIO 34',
    },
  ];

  const bomItems = [
    {
      item: 'ESP32 DevKit V1 (Wi-Fi CSI + ESP-NOW Mesh Nodes 1–4)',
      qty: '4 Units',
      unitCost: '₹400',
      totalCost: '₹1,600',
      role: 'Node 1 Coordinator + Nodes 2–4 TDMA CSI Perimeter Transceivers',
    },
    {
      item: 'Hi-Link HLK-LD2410B 24 GHz FMCW mmWave Radar Module',
      qty: '1 Unit',
      unitCost: '₹450',
      totalCost: '₹450',
      role: '9-Gate Moving/Stationary Energy & Chest Micro-Motion Phase Sensing',
    },
    {
      item: 'LM386 Audio Amplifier Module + 15cm Solid Copper Antenna + Jumpers',
      qty: '1 Set',
      unitCost: '₹155',
      totalCost: '₹155',
      role: '50/60 Hz Non-Contact Live-Wire EMF Hazard Detector',
    },
  ];

  return (
    <div className="flex flex-col gap-5 pb-12">
      {/* Header & Team Credits */}
      <div className="aura-card rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">
            System Architecture, Hardware Pinout & Engineering Blueprint
          </h1>
          <p className="text-xs font-mono text-slate-300 mt-1">
            Designed & Built by Team &ldquo;Compile error&rdquo; — Team Leader: Durai babu.P · Members: Gokul.D, Gokul Nath.M, Vetrivel.K
          </p>
        </div>
        <div className="bg-slate-950/90 border border-cyan-500/40 rounded-lg px-4 py-2 text-right font-mono">
          <div className="text-[10px] text-slate-400">TOTAL PROTOTYPE BOM</div>
          <div className="text-2xl font-bold text-[#22e6f0]">₹2,205</div>
        </div>
      </div>

      {/* 1. Interactive System Architecture Diagram */}
      <section className="aura-card rounded-xl p-5 flex flex-col gap-3">
        <h2 className="text-sm font-bold uppercase tracking-wider text-slate-100">
          1. End-to-End Sensor Fusion & TDMA Mesh Architecture
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs font-mono">
          <div className="bg-slate-950/85 border border-cyan-500/40 rounded-lg p-3.5 flex flex-col gap-1.5">
            <div className="text-[#22e6f0] font-bold">STAGE 1: SENSING FRONTEND</div>
            <div className="text-white font-semibold">
              HLK-LD2410B (24 GHz) + LM386 Probe
            </div>
            <p className="text-slate-400 leading-relaxed">
              LD2410B streams 9 range gates (0.0m–6.0m at 0.75m steps) over UART2 @ 256000 baud. LM386 amplifies 50/60 Hz AC electric fields into ADC1 GPIO34.
            </p>
          </div>

          <div className="bg-slate-950/85 border border-amber-500/40 rounded-lg p-3.5 flex flex-col gap-1.5">
            <div className="text-[#ffb02e] font-bold">STAGE 2: RF MESH & BEACONS</div>
            <div className="text-white font-semibold">
              Nodes 2–4 ESP-NOW CSI + Wrist Tags
            </div>
            <p className="text-slate-400 leading-relaxed">
              4 ESP32 nodes rotate TX slots every 250ms (TDMA) to measure Wi-Fi Channel State Information (CSI) multipath variance across 6 links while listening for Rescuer Wrist Beacons.
            </p>
          </div>

          <div className="bg-slate-950/85 border border-emerald-500/40 rounded-lg p-3.5 flex flex-col gap-1.5">
            <div className="text-[#2dff7a] font-bold">STAGE 3: COORDINATOR HUB</div>
            <div className="text-white font-semibold">
              Node 1 ESP32 Sensor Fusion Packetizer
            </div>
            <p className="text-slate-400 leading-relaxed">
              Aggregates Node 1 radar gates, max CSI variance, max LM386 Vpp, and strongest wrist tag RSSI/SOS flags into 10 Hz newline-delimited JSON over USB Serial (115200) or HTTP /state.
            </p>
          </div>

          <div className="bg-slate-950/85 border border-rose-500/40 rounded-lg p-3.5 flex flex-col gap-1.5">
            <div className="text-[#ff4d5a] font-bold">STAGE 4: TACTICAL COMMAND HUD</div>
            <div className="text-white font-semibold">
              AuraBreath DFT + 25-Tree Random Forest
            </div>
            <p className="text-slate-400 leading-relaxed">
              Computes Hann-windowed 20–30s DFT across 6–48 BPM and fuses 8 telemetry features via deterministic safety rules + CART Random Forest.
            </p>
          </div>
        </div>
      </section>

      {/* 2. Hardware Wiring Pinout & Bill of Materials */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Pinout Table (7 cols) */}
        <div className="lg:col-span-7 aura-card rounded-xl p-5 flex flex-col gap-3">
          <h2 className="text-sm font-bold uppercase tracking-wider text-slate-100">
            2. Node 1 ESP32 Hardware Wiring Pinout Table
          </h2>

          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="py-2 px-2 text-left">Sensor Module</th>
                  <th className="py-2 px-2 text-left">Module Pin</th>
                  <th className="py-2 px-2 text-left">ESP32 Node 1 Pin</th>
                  <th className="py-2 px-2 text-left">Level / Rail</th>
                </tr>
              </thead>
              <tbody>
                {pinoutRows.map((r, i) => (
                  <tr
                    key={i}
                    className="border-b border-slate-800/60 hover:bg-slate-900/50"
                  >
                    <td className="py-2 px-2 text-slate-200 font-semibold">
                      {r.module}
                    </td>
                    <td className="py-2 px-2 text-[#22e6f0]">{r.pin}</td>
                    <td className="py-2 px-2 text-[#2dff7a] font-bold">
                      {r.esp32Pin}
                    </td>
                    <td className="py-2 px-2 text-slate-300">{r.voltage}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Complete BOM Table totaling ₹2,205 (5 cols) */}
        <div className="lg:col-span-5 aura-card rounded-xl p-5 flex flex-col justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold uppercase tracking-wider text-slate-100 mb-3">
              3. Bill of Materials (BOM Breakdown — ₹2,205)
            </h2>

            <div className="overflow-x-auto">
              <table className="w-full text-xs font-mono border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400">
                    <th className="py-2 px-2 text-left">Component</th>
                    <th className="py-2 px-2 text-right">Qty</th>
                    <th className="py-2 px-2 text-right">Unit</th>
                    <th className="py-2 px-2 text-right">Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  {bomItems.map((b, i) => (
                    <tr key={i} className="border-b border-slate-800/60">
                      <td className="py-2.5 px-2 text-slate-200">{b.item}</td>
                      <td className="py-2.5 px-2 text-right text-slate-300">
                        {b.qty}
                      </td>
                      <td className="py-2.5 px-2 text-right text-slate-400">
                        {b.unitCost}
                      </td>
                      <td className="py-2.5 px-2 text-right font-bold text-white">
                        {b.totalCost}
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-slate-900/90">
                    <td
                      colSpan={3}
                      className="py-2.5 px-2 font-bold text-[#22e6f0]"
                    >
                      TOTAL HARDWARE COST
                    </td>
                    <td className="py-2.5 px-2 text-right text-base font-bold text-[#2dff7a]">
                      ₹2,205
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-slate-950/90 border border-slate-800 rounded-lg p-3 text-xs font-mono text-slate-300">
            <div className="text-slate-400 mb-1">ESP32 SERIAL JSON PACKET SCHEMA (115200 BAUD / 10 Hz):</div>
            <code className="text-[11px] text-[#22e6f0] break-all">
              {`{"node":1,"activeTx":1,"target":2,"movDist":0,"movEng":4,"statDist":150,"statEng":65,"liveCurrent":0,"lm386Vpp":80,"csiVar":3.20,"eng":1,"gateMov":[0,0,4,0,0,0,0,0,0],"gateStat":[0,18,65,0,0,0,0,0,0],"tags":[{"id":1,"rssi":-58,"sos":false}]}`}
            </code>
          </div>
        </div>
      </div>

      {/* 4. Transparent Engineering Limitations Box */}
      <section
        aria-label="Transparent Engineering Limitations"
        className="aura-card-danger rounded-xl p-5 flex flex-col gap-3"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold uppercase tracking-wider text-rose-200">
            4. Transparent Engineering Limitations & Field Safety Disclosures
          </h2>
          <span className="text-xs font-mono text-rose-300">
            MANDATORY FIELD PROTOCOL
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs leading-relaxed text-slate-200">
          <div className="bg-slate-950/70 border border-rose-500/30 rounded-lg p-3.5">
            <div className="font-mono font-bold text-rose-300 mb-1">
              1. 24 GHz RF Material Penetration Limits
            </div>
            <p className="text-slate-300">
              The 24 GHz ISM band (HLK-LD2410B) reliably penetrates smoke, thick dust, timber, drywall, glass, and thin brick/masonry partitions. It <strong>cannot penetrate</strong> thick reinforced concrete slabs, metal decking, or heavy wet rubble piles; 2.4 GHz Wi-Fi CSI assists with deeper multipath motion sensing.
            </p>
          </div>

          <div className="bg-slate-950/70 border border-rose-500/30 rounded-lg p-3.5">
            <div className="font-mono font-bold text-rose-300 mb-1">
              2. Single-Axis Range Resolution (0.75m Gates)
            </div>
            <p className="text-slate-300">
              A single HLK-LD2410B resolves radial distance across 9 range gates (0.75m spacing) within a 120° cone rather than full 2D azimuth beamforming. Two targets sitting within the same 0.75m radial arc blend into the same range gate until separated or triangulated by the 4-node Wi-Fi CSI mesh.
            </p>
          </div>

          <div className="bg-slate-950/70 border border-rose-500/30 rounded-lg p-3.5">
            <div className="font-mono font-bold text-rose-300 mb-1">
              3. Non-Diagnostic Respiration Triage Only
            </div>
            <p className="text-slate-300">
              Radar phase demodulation detects sub-millimeter chest-wall motion over a 20-second stationary window, but <strong>radar cannot medically confirm death</strong>. A &ldquo;NO BREATHING DETECTED (Possible Casualty)&rdquo; alert indicates zero detected respiration in that gate—physical verification by a human rescuer is always mandatory.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
};
