// Web Audio API sound effects — all synthesized, no external files

let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;

function getCtx(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

function getMaster(): GainNode {
  const ac = getCtx();
  if (!masterGain) {
    masterGain = ac.createGain();
    masterGain.connect(ac.destination);
  }
  return masterGain;
}

export function setSoundVolume(v: number) { // 0–100
  getMaster().gain.value = v / 100;
}

function noiseBuffer(duration: number): AudioBuffer {
  const ac = getCtx();
  const len = Math.floor(ac.sampleRate * duration);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

/** Card deal — quick snap/flick */
export function playCardDeal() {
  const ac = getCtx();
  const src = ac.createBufferSource();
  src.buffer = noiseBuffer(0.04);
  const filter = ac.createBiquadFilter();
  filter.type = "highpass";
  filter.frequency.value = 4000;
  const gain = ac.createGain();
  gain.gain.setValueAtTime(0.15, ac.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.04);
  src.connect(filter).connect(gain).connect(getMaster());
  src.start();
}

/** Chip bet/call/raise — two rapid high-freq sine pings */
export function playChipBet() {
  const ac = getCtx();
  const now = ac.currentTime;
  for (let i = 0; i < 2; i++) {
    const osc = ac.createOscillator();
    osc.type = "sine";
    osc.frequency.value = 3200 + i * 400;
    const gain = ac.createGain();
    gain.gain.setValueAtTime(0.12, now + i * 0.04);
    gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.04 + 0.04);
    osc.connect(gain).connect(getMaster());
    osc.start(now + i * 0.04);
    osc.stop(now + i * 0.04 + 0.05);
  }
}

/** Check — soft tap */
export function playCheck() {
  const ac = getCtx();
  const src = ac.createBufferSource();
  src.buffer = noiseBuffer(0.03);
  const filter = ac.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 800;
  const gain = ac.createGain();
  gain.gain.setValueAtTime(0.1, ac.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.03);
  src.connect(filter).connect(gain).connect(getMaster());
  src.start();
}

/** Fold — soft whoosh */
export function playFold() {
  const ac = getCtx();
  const src = ac.createBufferSource();
  src.buffer = noiseBuffer(0.15);
  const filter = ac.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.setValueAtTime(3000, ac.currentTime);
  filter.frequency.exponentialRampToValueAtTime(300, ac.currentTime + 0.15);
  filter.Q.value = 1;
  const gain = ac.createGain();
  gain.gain.setValueAtTime(0.1, ac.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.15);
  src.connect(filter).connect(gain).connect(getMaster());
  src.start();
}

/** Your turn — gentle chime: two-note ascending tones */
export function playYourTurn() {
  const ac = getCtx();
  const now = ac.currentTime;
  const notes = [660, 880];
  notes.forEach((freq, i) => {
    const osc = ac.createOscillator();
    osc.type = "sine";
    osc.frequency.value = freq;
    const gain = ac.createGain();
    gain.gain.setValueAtTime(0.1, now + i * 0.15);
    gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.15 + 0.15);
    osc.connect(gain).connect(getMaster());
    osc.start(now + i * 0.15);
    osc.stop(now + i * 0.15 + 0.2);
  });
}

/** Win/pot award — pleasant ascending arpeggio */
export function playWin() {
  const ac = getCtx();
  const now = ac.currentTime;
  const notes = [523, 659, 784];
  notes.forEach((freq, i) => {
    const osc = ac.createOscillator();
    osc.type = "sine";
    osc.frequency.value = freq;
    const gain = ac.createGain();
    gain.gain.setValueAtTime(0.12, now + i * 0.12);
    gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.12 + 0.2);
    osc.connect(gain).connect(getMaster());
    osc.start(now + i * 0.12);
    osc.stop(now + i * 0.12 + 0.25);
  });
}

/** Street transition — subtle rising sweep */
export function playStreetTransition() {
  const ac = getCtx();
  const src = ac.createBufferSource();
  src.buffer = noiseBuffer(0.2);
  const filter = ac.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.setValueAtTime(500, ac.currentTime);
  filter.frequency.exponentialRampToValueAtTime(4000, ac.currentTime + 0.2);
  filter.Q.value = 2;
  const gain = ac.createGain();
  gain.gain.setValueAtTime(0.08, ac.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.2);
  src.connect(filter).connect(gain).connect(getMaster());
  src.start();
}

/** Clock tick — sharp metronome click (plays once per second when on the clock) */
export function playClockTick(urgent = false) {
  const ac = getCtx();
  const now = ac.currentTime;
  // A short transient: quick sine burst at a high frequency
  const osc = ac.createOscillator();
  osc.type = "sine";
  osc.frequency.value = urgent ? 1200 : 900;
  const gain = ac.createGain();
  gain.gain.setValueAtTime(urgent ? 0.18 : 0.1, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
  osc.connect(gain).connect(getMaster());
  osc.start(now);
  osc.stop(now + 0.07);
}
