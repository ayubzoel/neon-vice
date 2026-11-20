// Neon Vice — Builder C: audio, pure Web Audio synthesis, no CDN, no files.
// Engine hum (oscillator, pitch follows speed), gunshot (noise burst),
// siren (two-tone), pickup chime, and a simple ambient synth loop
// (slow minor-chord arpeggio). Everything is created lazily on the first
// user gesture; mute (N) silences the master gain.

export function createAudio() {
  let ctx = null;
  let master = null;
  let musicGain = null;
  let sfxGain = null; // SFX bus (shots, engine, siren, chimes) — separate from music
  let engineOsc = null;
  let engineGain = null;
  let sirenOsc = null;
  let sirenGain = null;
  let musicTimer = null;
  let muted = false;
  let volume = 0.7;
  let musicVolume = 0.8;
  let sfxVolume = 0.9;

  function ensure() {
    if (ctx) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : volume;
      master.connect(ctx.destination);
      musicGain = ctx.createGain();
      musicGain.gain.value = 0.16 * musicVolume;
      musicGain.connect(master);
      sfxGain = ctx.createGain();
      sfxGain.gain.value = sfxVolume;
      sfxGain.connect(master);
      engineGain = ctx.createGain();
      engineGain.gain.value = 0;
      engineGain.connect(sfxGain);
      engineOsc = ctx.createOscillator();
      engineOsc.type = 'sawtooth';
      engineOsc.frequency.value = 55;
      const engineFilter = ctx.createBiquadFilter();
      engineFilter.type = 'lowpass';
      engineFilter.frequency.value = 320;
      engineOsc.connect(engineFilter);
      engineFilter.connect(engineGain);
      engineOsc.start();
      sirenGain = ctx.createGain();
      sirenGain.gain.value = 0;
      sirenGain.connect(sfxGain);
      sirenOsc = ctx.createOscillator();
      sirenOsc.type = 'triangle';
      sirenOsc.frequency.value = 700;
      sirenOsc.connect(sirenGain);
      sirenOsc.start();
      startMusic();
      return true;
    } catch {
      return false;
    }
  }

  function resume() {
    if (ctx && ctx.state === 'suspended') ctx.resume();
  }

  // Slow synthwave-ish loop: Am – F – C – G arpeggios, one note per 0.42 s.
  const CHORDS = [
    [110, 130.81, 164.81, 220],
    [87.31, 130.81, 174.61, 220],
    [130.81, 164.81, 196, 261.63],
    [98, 146.83, 196, 246.94],
  ];
  function startMusic() {
    if (musicTimer) return;
    let step = 0;
    musicTimer = window.setInterval(() => {
      if (!ctx || muted) return;
      const chord = CHORDS[Math.floor(step / 4) % CHORDS.length];
      const note = chord[step % 4] * 2;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = note;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.5, ctx.currentTime + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4);
      osc.connect(g);
      g.connect(musicGain);
      osc.start();
      osc.stop(ctx.currentTime + 0.45);
      step += 1;
    }, 420);
  }

  function noiseBurst(duration, filterFreq, gainValue) {
    if (!ctx) return;
    const len = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq;
    const g = ctx.createGain();
    g.gain.value = gainValue;
    src.connect(filter);
    filter.connect(g);
    g.connect(sfxGain);
    src.start();
  }

  function tone(freq, duration, type, gainValue, slideTo) {
    if (!ctx) return;
    const osc = ctx.createOscillator();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, ctx.currentTime + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gainValue, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
    osc.connect(g);
    g.connect(sfxGain);
    osc.start();
    osc.stop(ctx.currentTime + duration + 0.02);
  }

  return {
    unlock() {
      if (ensure()) resume();
    },
    setVolume(v) {
      volume = Math.max(0, Math.min(1, v));
      if (master) master.gain.value = muted ? 0 : volume;
    },
    setMusicVolume(v) {
      musicVolume = Math.max(0, Math.min(1, v));
      if (musicGain) musicGain.gain.value = 0.16 * musicVolume;
    },
    getMusicVolume() { return musicVolume; },
    setSfxVolume(v) {
      sfxVolume = Math.max(0, Math.min(1, v));
      if (sfxGain) sfxGain.gain.value = sfxVolume;
    },
    getSfxVolume() { return sfxVolume; },
    setMuted(m) {
      muted = m;
      if (master) master.gain.value = muted ? 0 : volume;
    },
    isMuted() {
      return muted;
    },
    shot(isSmg) {
      if (!ensure()) return;
      noiseBurst(isSmg ? 0.09 : 0.16, isSmg ? 2600 : 1400, isSmg ? 0.35 : 0.55);
      tone(isSmg ? 220 : 140, 0.08, 'square', 0.12, 60);
    },
    enemyShot() {
      if (!ensure()) return;
      noiseBurst(0.12, 1200, 0.22);
    },
    chime() {
      if (!ensure()) return;
      tone(880, 0.12, 'sine', 0.25);
      window.setTimeout(() => tone(1318, 0.18, 'sine', 0.25), 90);
    },
    cash() {
      if (!ensure()) return;
      tone(1046, 0.1, 'triangle', 0.3);
      window.setTimeout(() => tone(1568, 0.16, 'triangle', 0.3), 80);
    },
    fail() {
      if (!ensure()) return;
      tone(220, 0.35, 'sawtooth', 0.2, 110);
    },
    setEngine(speed01, driving) {
      if (!ctx) return;
      const target = driving ? 0.05 + speed01 * 0.1 : 0;
      engineGain.gain.setTargetAtTime(target, ctx.currentTime, 0.1);
      engineOsc.frequency.setTargetAtTime(55 + speed01 * 90, ctx.currentTime, 0.1);
    },
    setSiren(on) {
      if (!ctx) return;
      sirenGain.gain.setTargetAtTime(on ? 0.05 : 0, ctx.currentTime, 0.2);
      if (on && !sirenOsc._sweeping) {
        sirenOsc._sweeping = true;
        const sweep = () => {
          if (!ctx) return;
          const now = ctx.currentTime;
          sirenOsc.frequency.setValueAtTime(700, now);
          sirenOsc.frequency.linearRampToValueAtTime(950, now + 0.45);
          sirenOsc.frequency.linearRampToValueAtTime(700, now + 0.9);
        };
        sweep();
        sirenOsc._sweepTimer = window.setInterval(sweep, 900);
      } else if (!on && sirenOsc._sweepTimer) {
        window.clearInterval(sirenOsc._sweepTimer);
        sirenOsc._sweepTimer = null;
        sirenOsc._sweeping = false;
      }
    },
  };
}
