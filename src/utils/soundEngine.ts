import { BannerStateId } from '../types/aura';

/**
 * Web Audio API Tactical Alarm Generator
 * Distinct multi-tone patterns for:
 * - Survivor Found (Cyan dual ascending harmonic)
 * - Live-Wire Hazard (Rapid alternating high-voltage siren)
 * - Rescuer SOS (3-short-3-long morse tactical alert)
 * - No Breathing / Casualty (Low sustained solemn double-pulse)
 * - Calibration Complete (Crisp 3-tone confirmation chime)
 */
class TacticalSoundEngine {
  private ctx: AudioContext | null = null;
  private muted = false;
  private lastBannerAlertTime = 0;
  private lastBannerState: BannerStateId | null = null;

  public isMuted(): boolean {
    return this.muted;
  }

  public setMuted(mute: boolean): void {
    this.muted = mute;
  }

  private ensureContext(): AudioContext | null {
    if (this.muted || typeof window === 'undefined') return null;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return null;
    if (!this.ctx) {
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  private playTone(
    freq: number,
    startOffsetSec: number,
    durationSec: number,
    type: OscillatorType = 'sine',
    gainPeak = 0.08
  ): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const start = ctx.currentTime + startOffsetSec;
    const end = start + durationSec;

    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);

    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(gainPeak, start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(start);
    osc.stop(end + 0.01);
  }

  public playCalibrationComplete(): void {
    if (this.muted) return;
    this.playTone(587.33, 0.0, 0.11, 'triangle', 0.09); // D5
    this.playTone(880.0, 0.12, 0.11, 'triangle', 0.09); // A5
    this.playTone(1174.66, 0.24, 0.22, 'triangle', 0.1); // D6
  }

  public triggerBannerAlarm(state: BannerStateId, force = false): void {
    if (this.muted) return;
    const now = Date.now();
    const stateChanged = state !== this.lastBannerState;
    const cooldownMs =
      state === 'HAZARD' || state === 'SOS' ? 3500 : 7500;

    if (!force && !stateChanged && now - this.lastBannerAlertTime < cooldownMs) {
      return;
    }

    this.lastBannerState = state;
    this.lastBannerAlertTime = now;

    switch (state) {
      case 'HAZARD': {
        // High-priority alternating live-wire hazard siren
        this.playTone(960, 0.0, 0.14, 'sawtooth', 0.09);
        this.playTone(640, 0.15, 0.14, 'sawtooth', 0.09);
        this.playTone(960, 0.3, 0.14, 'sawtooth', 0.09);
        break;
      }
      case 'SOS': {
        // Tactical SOS burst
        this.playTone(1046.5, 0.0, 0.09, 'square', 0.08);
        this.playTone(1046.5, 0.12, 0.09, 'square', 0.08);
        this.playTone(1046.5, 0.24, 0.09, 'square', 0.08);
        this.playTone(784.0, 0.38, 0.22, 'square', 0.09);
        break;
      }
      case 'SURVIVOR': {
        // Cyan survivor lock harmonic
        this.playTone(523.25, 0.0, 0.14, 'sine', 0.08);
        this.playTone(783.99, 0.15, 0.22, 'sine', 0.09);
        break;
      }
      case 'DEAD': {
        // Violet no-breathing double low tone
        this.playTone(329.63, 0.0, 0.24, 'triangle', 0.08);
        this.playTone(261.63, 0.28, 0.32, 'triangle', 0.08);
        break;
      }
      case 'PET': {
        // Quick amber chirp
        this.playTone(740, 0.0, 0.08, 'sine', 0.06);
        this.playTone(880, 0.09, 0.1, 'sine', 0.06);
        break;
      }
      default:
        break;
    }
  }
}

export const soundEngine = new TacticalSoundEngine();
