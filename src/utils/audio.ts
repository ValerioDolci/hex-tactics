/**
 * Audio manager procedurale (Web Audio API).
 *
 * Niente asset esterni: i suoni sono generati al volo con oscillatori.
 * Singleton lazy-init per evitare problemi con autoplay policies del browser.
 *
 * Suoni disponibili:
 *   - click(): UI click (corto, alto)
 *   - hit(): colpo a segno (basso, percussivo)
 *   - miss(): colpo schivato/parato (corto, sussurrato)
 *   - dice(): tiro dadi (rapido, multipli pop)
 *   - turn(): inizio turno (notifica gentile)
 *   - victory() / defeat(): fine partita
 */

class AudioManager {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private enabled = true;

  /** Inizializza al primo uso (dopo interazione utente, evita autoplay block). */
  private ensureContext(): AudioContext | null {
    if (this.ctx) return this.ctx;
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return null;
      this.ctx = new Ctx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.4;
      this.masterGain.connect(this.ctx.destination);
      return this.ctx;
    } catch {
      return null;
    }
  }

  /** Abilita/disabilita audio (utente). */
  setEnabled(v: boolean): void {
    this.enabled = v;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /** Volume globale (0..1). */
  setVolume(v: number): void {
    if (!this.masterGain) return;
    this.masterGain.gain.value = Math.max(0, Math.min(1, v));
  }

  /**
   * Suona una nota con un'inviluppo ADSR semplice.
   * Se il context non è disponibile o disabled, no-op.
   */
  private tone(opts: {
    freq: number;
    duration: number;
    type?: OscillatorType;
    attack?: number;
    decay?: number;
    sustain?: number;
    release?: number;
    volume?: number;
    delay?: number;
  }): void {
    if (!this.enabled) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;

    const start = ctx.currentTime + (opts.delay ?? 0);
    const attack = opts.attack ?? 0.01;
    const decay = opts.decay ?? 0.05;
    const sustain = opts.sustain ?? 0.5;
    const release = opts.release ?? 0.1;
    const volume = opts.volume ?? 0.3;
    const dur = opts.duration;

    const osc = ctx.createOscillator();
    osc.type = opts.type ?? 'sine';
    osc.frequency.value = opts.freq;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(volume, start + attack);
    gain.gain.linearRampToValueAtTime(volume * sustain, start + attack + decay);
    gain.gain.setValueAtTime(volume * sustain, start + dur);
    gain.gain.linearRampToValueAtTime(0, start + dur + release);

    osc.connect(gain).connect(this.masterGain);
    osc.start(start);
    osc.stop(start + dur + release + 0.05);
  }

  /** Click UI: pop alto e corto */
  click(): void {
    this.tone({ freq: 800, duration: 0.04, type: 'square', volume: 0.12 });
  }

  /** Colpo: tono basso percussivo */
  hit(): void {
    this.tone({ freq: 110, duration: 0.12, type: 'square', volume: 0.35, decay: 0.02 });
    this.tone({ freq: 70, duration: 0.18, type: 'sawtooth', volume: 0.2, delay: 0.02 });
  }

  /** Miss/parato: sussurro alto + breve */
  miss(): void {
    this.tone({ freq: 1200, duration: 0.05, type: 'triangle', volume: 0.15 });
    this.tone({ freq: 900, duration: 0.07, type: 'triangle', volume: 0.1, delay: 0.04 });
  }

  /** Tiro dadi: pop rapidi */
  dice(): void {
    for (let i = 0; i < 3; i++) {
      this.tone({
        freq: 600 + i * 100,
        duration: 0.03,
        type: 'square',
        volume: 0.1,
        delay: i * 0.05,
      });
    }
  }

  /** Notifica turno: tono caldo medio */
  turn(): void {
    this.tone({ freq: 440, duration: 0.12, type: 'sine', volume: 0.2 });
    this.tone({ freq: 660, duration: 0.15, type: 'sine', volume: 0.15, delay: 0.08 });
  }

  /** Vittoria: arpeggio ascendente */
  victory(): void {
    const notes = [523, 659, 784, 1047]; // do mi sol do
    notes.forEach((f, i) => {
      this.tone({
        freq: f,
        duration: 0.18,
        type: 'triangle',
        volume: 0.25,
        delay: i * 0.12,
      });
    });
  }

  /** Sconfitta: arpeggio discendente minor */
  defeat(): void {
    const notes = [523, 466, 415, 311]; // do si la mi♭
    notes.forEach((f, i) => {
      this.tone({
        freq: f,
        duration: 0.22,
        type: 'sine',
        volume: 0.25,
        delay: i * 0.15,
      });
    });
  }

  /** Dado che cade sul tavolo: thump basso percussivo */
  diceFall(): void {
    this.tone({ freq: 90, duration: 0.08, type: 'sine', volume: 0.3, decay: 0.02 });
    this.tone({ freq: 150, duration: 0.05, type: 'square', volume: 0.18, delay: 0.04 });
  }

  /** Asta movimento avviata: tensione (due note che salgono) */
  biddingStart(): void {
    this.tone({ freq: 330, duration: 0.10, type: 'sine', volume: 0.2 });
    this.tone({ freq: 440, duration: 0.12, type: 'sine', volume: 0.2, delay: 0.06 });
  }

  /** Hit forte (danno >5): impatto profondo + sustain */
  hitHard(): void {
    this.tone({ freq: 80, duration: 0.18, type: 'square', volume: 0.45, decay: 0.03 });
    this.tone({ freq: 50, duration: 0.25, type: 'sawtooth', volume: 0.3, delay: 0.03, decay: 0.05 });
    this.tone({ freq: 40, duration: 0.35, type: 'sine', volume: 0.18, delay: 0.08 });
  }

  /** Death: rumble grave finale */
  death(): void {
    this.tone({ freq: 60, duration: 0.5, type: 'sawtooth', volume: 0.3, decay: 0.1 });
    this.tone({ freq: 90, duration: 0.4, type: 'square', volume: 0.2, delay: 0.05, decay: 0.1 });
  }
}

// Singleton
export const audio = new AudioManager();
