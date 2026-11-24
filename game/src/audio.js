// Neon Vice — sound, synthesized live with Web Audio, no downloads.
//
// A low engine drone whose pitch tracks speed, gunshots from filtered
// noise, a two-tone police siren, pickup chimes, and a slow synth loop
// cycling minor chords. Nodes are built lazily on the first user gesture,
// and N mutes everything through the master gain.

function createAudio() {
  let ac = null;
  let masterBus, musicBus, sfxBus, engineBus, sirenBus;
  let engineOsc, sirenOsc;
  let musicTimer = null, sirenTimer = null;
  let muted = false, sirenSweeping = false;
  let volume = 0.7, musicVolume = 0.8, sfxVolume = 0.9;

  function makeGain(value, dest) {
    const g = ac.createGain();
    g.gain.value = value;
    g.connect(dest);
    return g; // wired into dest by the caller chain
  }

  function makeOsc(type, freq) {
    const o = ac.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    return o; // caller connects + starts it
  }

  function makeFilter(type, freq) {
    const f = ac.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    return f; // caller drops it between source and bus
  }

  function chain(...nodes) {
    for (let i = 0; i + 1 < nodes.length; i++) nodes[i].connect(nodes[i + 1]);
  }

  function boot() {
    if (ac) return true;
    let ready = false;
    try {
      const AC = window.AudioContext || window["webkitAudioContext"];
      if (AC) {
        ac = new AC();
        masterBus = makeGain(muted ? 0 : volume, ac.destination);
        musicBus = makeGain(0.16 * musicVolume, masterBus);
        sfxBus = makeGain(sfxVolume, masterBus);
        engineBus = makeGain(0, sfxBus);
        engineOsc = makeOsc("sawtooth", 55);
        const engineFilter = makeFilter("lowpass", 320);
        chain(engineOsc, engineFilter, engineBus);
        sirenBus = makeGain(0, sfxBus);
        sirenOsc = makeOsc("triangle", 700);
        chain(sirenOsc, sirenBus);
        for (const o of [engineOsc, sirenOsc]) o.start();
        beginLoop();
        ready = true;
      }
    } catch (failure) {
      ready = false;
    }
    return ready;
  }

  function wake() {
    if (ac && ac.state === "suspended") ac.resume();
  }

  // Am – F – C – G arpeggios, one note every 0.42 s, played two octaves up.
  const CHORDS = "110,130.81,164.81,220|87.31,130.81,174.61,220|130.81,164.81,196,261.63|98,146.83,196,246.94"
    .split("|")
    .map((row) => row.split(",").map(Number));

  function pluck(note) {
    const osc = makeOsc("sine", note);
    const g = ac.createGain();
    const now = ac.currentTime;
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.5, now + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);
    chain(osc, g, musicBus);
    osc.start(); osc.stop(now + 0.45);
  }

  function beginLoop() {
    if (musicTimer) {
      return;
    }
    let step = 0; // counts the plucks played so far
    musicTimer = window.setInterval(() => { // one pluck per tick
      if (!ac || muted) return;
      const chord = CHORDS[(step >> 2) % CHORDS.length];
      pluck(chord[step & 3] * 2);
      step = step + 1;
    }, 420);
  }

  function noiseBurst(dur, cutoff, level) {
    if (!ac) return;
    const len = Math.max(1, Math.floor(ac.sampleRate * dur));
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const data = buf.getChannelData(0); // mono buffer
    for (let i = len - 1; i >= 0; i--) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    }
    const src = ac.createBufferSource();
    Object.assign(src, { buffer: buf });
    const filter = makeFilter("lowpass", cutoff);
    const g = makeGain(level, sfxBus);
    chain(src, filter, g);
    src.start(0);
  }

  function tone(freq, len, type, level, slideTo) {
    if (!ac) return;
    const osc = makeOsc(type || "sine", freq);
    const now = ac.currentTime;
    osc.frequency.setValueAtTime(freq, now);
    if (slideTo) {
      osc.frequency.exponentialRampToValueAtTime(slideTo, now + len);
    }
    const g = ac.createGain();
    g.gain.setValueAtTime(level, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + len);
    chain(osc, g, sfxBus);
    osc.start(); osc.stop(now + len + 0.02);
  }

  function clamp01(v) {
    return v < 0 ? 0 : v > 1 ? 1 : v;
  }

  function later(fn, ms) {
    window.setTimeout(fn, ms);
  }

  return {
    unlock: () => {
      if (boot()) wake();
    },
    setVolume: (v) => {
      volume = clamp01(v);
      if (masterBus) masterBus.gain.value = muted ? 0 : volume;
    },
    setMusicVolume: (v) => {
      musicVolume = clamp01(v);
      if (musicBus) musicBus.gain.value = 0.16 * musicVolume;
    },
    getMusicVolume: () => musicVolume,
    setSfxVolume: (v) => {
      sfxVolume = clamp01(v);
      if (sfxBus) sfxBus.gain.value = sfxVolume;
    },
    getSfxVolume: () => sfxVolume,
    setMuted: (m) => {
      muted = Boolean(m);
      if (masterBus) masterBus.gain.value = muted ? 0 : volume;
    },
    isMuted: () => !!muted,
    shot: (isSmg) => {
      if (!boot()) return;
      const [dur, cut, level, pitch] = isSmg
        ? [0.09, 2600, 0.35, 220]
        : [0.16, 1400, 0.55, 140];
      noiseBurst(dur, cut, level);
      tone(pitch, 0.08, "square", 0.12, 60);
    },
    enemyShot: () => {
      if (!boot()) return;
      noiseBurst(0.12, 1200, 0.22); // distant crack, quieter than ours
    },
    chime: () => {
      if (!boot()) return;
      tone(880, 0.12, "sine", 0.25);
      later(() => tone(1318, 0.18, "sine", 0.25), 90);
    },
    cash: () => {
      if (!boot()) return;
      tone(1046, 0.1, "triangle", 0.3);
      later(() => tone(1568, 0.16, "triangle", 0.3), 80);
    },
    fail: () => {
      if (!boot()) return;
      tone(220, 0.35, "sawtooth", 0.2, 110);
    },
    setEngine: (speed01, driving) => {
      if (!ac) return;
      const now = ac.currentTime;
      const target = driving ? speed01 * 0.1 + 0.05 : 0;
      engineBus.gain.setTargetAtTime(target, now, 0.1);
      engineOsc.frequency.setTargetAtTime(55 + speed01 * 90, now, 0.1);
    },
    setSiren: (on) => {
      if (!ac) return;
      const now = ac.currentTime;
      sirenBus.gain.setTargetAtTime(on ? 0.05 : 0, now, 0.2);
      if (on && !sirenSweeping) {
        sirenSweeping = true;
        const sweep = () => { // 700 <-> 950 Hz wail
          if (!ac) return;
          const t0 = ac.currentTime;
          sirenOsc.frequency.setValueAtTime(700, t0);
          sirenOsc.frequency.linearRampToValueAtTime(950, t0 + 0.45);
          sirenOsc.frequency.linearRampToValueAtTime(700, t0 + 0.9);
        };
        sweep();
        sirenTimer = window.setInterval(sweep, 900);
      } else if (!on && sirenTimer) {
        window.clearInterval(sirenTimer);
        sirenTimer = null;
        sirenSweeping = false;
      }
    },
  };
}

export { createAudio };
