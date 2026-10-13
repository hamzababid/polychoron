// Launch track: driving 120 BPM electronic, B minor (Bm–G–D–A).
// node synth2.mjs main|cutdown out.wav
import fs from 'fs';
const SR = 48000, BEAT = .5, BAR = 2;
const [mode, out] = process.argv.slice(2);

// ---- arrangement (times on this cut's own timeline) ----
const A = mode === 'main' ? {
  dur: 48.5,
  hookHits: [.3, 1.5],
  groove: [[4, 32], [37.6, 45]],
  tension: [32, 37.6],
  ticks: [34.5, 35.2, 35.9, 36.8],
  impacts: [4, 37.6, 45],          // big hits
  crashes: [8.6, 13.2, 21, 26, 40], // scene changes
  risers: [[2.4, 4], [30.4, 32], [36.9, 37.6], [43.6, 45]],
  arpUp: [[26, 32], [37.6, 45]],
  outro: 45,
} : {
  dur: 23.3,
  hookHits: [.3, 1.5],
  groove: [[4, 11.8], [17.4, 19.8]],
  tension: [11.8, 17.4],
  ticks: [14.3, 15.0, 15.7, 16.6],
  impacts: [4, 17.4, 19.8],
  crashes: [],
  risers: [[2.4, 4], [10.2, 11.8], [16.7, 17.4], [18.6, 19.8]],
  arpUp: [[17.4, 19.8]],
  outro: 19.8,
};
const inAny = (t, rs) => rs.some(([a, b]) => t >= a - 1e-6 && t < b - 1e-6);

const len = Math.ceil(A.dur * SR);
const bus = { drums: [new Float32Array(len), new Float32Array(len)], music: [new Float32Array(len), new Float32Array(len)], fx: [new Float32Array(len), new Float32Array(len)] };
const add = (b, i, v, pan = 0) => { if (i >= 0 && i < len) { bus[b][0][i] += v * (1 - pan); bus[b][1][i] += v * (1 + pan); } };
let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);

// chords: root midi (octave 2) + triad for arps/pads
const CH = [
  { root: 47, tones: [59, 62, 66] },   // Bm
  { root: 43, tones: [55, 59, 62] },   // G
  { root: 50, tones: [62, 66, 69] },   // D
  { root: 45, tones: [57, 61, 64] },   // A
];
const chordAt = (t) => CH[Math.floor(t / BAR) % 4];

// ---- instruments ----
function kick(t0, amp = 1) {
  const s0 = Math.round(t0 * SR), n = Math.round(.42 * SR); let ph = 0;
  for (let i = 0; i < n; i++) { const t = i / SR, f = 45 + 120 * Math.exp(-t * 28); ph += 2 * Math.PI * f / SR;
    add('drums', s0 + i, (Math.sin(ph) * Math.exp(-t * 7) + (i < 90 ? rnd() * .25 * (1 - i / 90) : 0)) * amp * .9); }
}
function clap(t0, amp = 1) {
  const s0 = Math.round(t0 * SR), n = Math.round(.25 * SR); let lp = 0, prev = 0;
  for (let i = 0; i < n; i++) { const t = i / SR, nz = rnd(); lp += (nz - lp) * .5; const bp = lp - prev; prev = lp;
    const env = [0, .011, .022].reduce((e, d) => e + (t >= d ? Math.exp(-(t - d) * (d === .022 ? 18 : 90)) : 0), 0);
    add('drums', s0 + i, bp * env * amp * .55, .05); }
}
function hat(t0, amp = 1, open = false) {
  const s0 = Math.round(t0 * SR), n = Math.round((open ? .16 : .05) * SR); let p1 = 0, p2 = 0;
  for (let i = 0; i < n; i++) { const t = i / SR, nz = rnd(), h1 = nz - p1; p1 = nz; const h2 = h1 - p2; p2 = h1;
    add('drums', s0 + i, h2 * Math.exp(-t * (open ? 22 : 75)) * amp * .11, .25); }
}
function bassNote(t0, m, dur, amp = 1, cut = .18) {
  const s0 = Math.round(t0 * SR), n = Math.round((dur + .03) * SR), f = hz(m); let lp = 0, ph = 0;
  for (let i = 0; i < n; i++) { const t = i / SR; ph += f / SR; const saw = 2 * (ph % 1) - 1;
    lp += (saw - lp) * (cut * Math.exp(-t * 6) + .04);
    const env = Math.min(1, t / .004) * (t > dur ? Math.max(0, 1 - (t - dur) / .03) : 1);
    add('music', s0 + i, (lp * .8 + Math.sin(2 * Math.PI * f * t) * .5) * env * amp * .32); }
}
function pluck(t0, m, amp = 1, pan = 0) {
  const s0 = Math.round(t0 * SR), n = Math.round(.32 * SR), f = hz(m);
  for (let i = 0; i < n; i++) { const t = i / SR; let v = 0;
    for (let h = 1; h <= 9; h += 2) v += Math.sin(2 * Math.PI * f * h * t) * Math.exp(-t * (10 + h * 6)) / h; // square-ish, darkening fast
    add('music', s0 + i, v * Math.min(1, t / .002) * amp * .2, pan); }
}
function padChord(t0, dur, tones, amp = 1, bright = 1) {
  const s0 = Math.round(t0 * SR), n = Math.round((dur + .6) * SR);
  tones.forEach((m, vi) => { const f = hz(m), pan = (vi - 1) * .35;
    for (let i = 0; i < n; i++) { const t = i / SR, env = Math.min(1, t / .25) * (t > dur ? Math.exp(-(t - dur) * 5) : 1); let v = 0;
      for (const d of [-.004, .004]) for (let h = 1; h <= 5; h++) v += Math.sin(2 * Math.PI * f * (1 + d) * h * t) / (h * (h > 2 ? 2.5 / bright : 1));
      add('music', s0 + i, v * env * amp * .03, pan); } });
}
function riser(t0, t1, amp = 1) {
  const s0 = Math.round(t0 * SR), n = Math.round((t1 - t0) * SR); let lp = 0, ph = 0;
  for (let i = 0; i < n; i++) { const k = i / n; lp += (rnd() - lp) * (.02 + .5 * k * k); ph += (200 + 1400 * k * k) / SR;
    add('fx', s0 + i, (lp * .6 + Math.sin(2 * Math.PI * ph) * .12) * Math.pow(k, 1.6) * amp * .5); }
}
function impact(t0, amp = 1) {
  const s0 = Math.round(t0 * SR), n = Math.round(1.6 * SR); let ph = 0, lp = 0;
  for (let i = 0; i < n; i++) { const t = i / SR, f = 38 + 90 * Math.exp(-t * 9); ph += 2 * Math.PI * f / SR; lp += (rnd() - lp) * .35;
    add('fx', s0 + i, (Math.sin(ph) * Math.exp(-t * 2.6) * .9 + lp * Math.exp(-t * 3.2) * .35) * amp); }
  kick(t0, .9);
}
function crash(t0, amp = 1) {
  const s0 = Math.round(t0 * SR), n = Math.round(1.4 * SR); let p = 0;
  for (let i = 0; i < n; i++) { const t = i / SR, nz = rnd(), h = nz - p; p = nz; add('fx', s0 + i, h * Math.exp(-t * 2.8) * amp * .16, -.2); }
}
function tick(t0, m, amp = 1) {
  const s0 = Math.round(t0 * SR), n = Math.round(.5 * SR), f = hz(m); let p = 0;
  for (let i = 0; i < n; i++) { const t = i / SR, nz = rnd(), h = nz - p; p = nz;
    add('fx', s0 + i, (h * Math.exp(-t * 700) * .5 + Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 10) * .45) * amp * .45, .1); }
}

// ---- sequence ----
const steps = Math.floor(A.dur / (BEAT / 4));
for (let s = 0; s < steps; s++) {
  const t = s * BEAT / 4, beatPos = s % 4, beat = Math.floor(s / 4), c = chordAt(t);
  const groove = inAny(t, A.groove), tense = t >= A.tension[0] && t < A.tension[1];
  if (t < 4) { // hook: ticking build
    if (beatPos === 0 || (t >= 2 && beatPos === 2)) hat(t, .45 + t * .12);
    if (beatPos === 0 && beat % 2 === 0 && t >= 1) bassNote(t, 47, .22, .5, .08);
    if (beatPos === 0 && beat % 4 === 0) pluck(t, [71, 74, 78, 83][beat / 4 % 4] + 12, .35);
  }
  if (groove) {
    if (beatPos === 0) kick(t);
    if (beatPos === 0 && beat % 2 === 1) clap(t);
    hat(t, beatPos === 2 ? 1 : .55, beatPos === 2 && beat % 2 === 1);
    if (beatPos % 2 === 0) bassNote(t, c.root + (beatPos === 2 ? 12 : 0), BEAT / 2 - .03, 1);
    const arp = [0, 1, 2, 1, 2, 0, 1, 2], up = inAny(t, A.arpUp) ? 12 : 0, idx = (beat * 4 + beatPos) % 8;
    pluck(t, c.tones[arp[idx]] + (idx >= 4 ? 12 : 0) + up, beatPos === 0 ? 1 : .7, (idx % 2 ? .3 : -.3));
    if (s % 16 === 0 && Math.abs(t % BAR) < 1e-6) padChord(t, BAR - .05, c.tones.map(m => m - 12), .9, 1.4);
  }
  if (tense) {
    if (beatPos === 0) hat(t, .5);
    if (s % 16 === 0 && Math.abs(t % BAR) < 1e-6) { padChord(t, BAR, [47, 54, 59], .7, .6); bassNote(t, 35, BAR - .05, .7, .03); }
  }
}
// hook hits under the two title lines
A.hookHits.forEach((t) => { kick(t, .8); crash(t, .6); });
A.ticks.forEach((t, i) => { tick(t, [83, 86, 88, 90][i]); kick(t, .45); });
A.impacts.forEach((t) => { impact(t); crash(t, 1.2); });
A.crashes.forEach((t) => crash(t, .8));
A.risers.forEach(([a, b]) => riser(a, b, b - a < 1 ? .7 : 1));
// outro: sustained Bm, arp tail
padChord(A.outro, A.dur - A.outro - .4, [59, 62, 66, 71], 1.3, 1.6);
bassNote(A.outro, 47, A.dur - A.outro - .6, .8, .05);
[71, 74, 78, 83, 86].forEach((m, i) => pluck(A.outro + .25 + i * .125, m, .7 - i * .08));

// ---- mix: sidechain music to the kick, reverb on music + fx ----
const kickEnv = new Float32Array(len);
for (let s = 0; s < steps; s++) { const t = s * BEAT / 4; if (s % 4 === 0 && (inAny(t, A.groove))) { const s0 = Math.round(t * SR); for (let i = 0; i < .25 * SR && s0 + i < len; i++) kickEnv[s0 + i] = Math.max(kickEnv[s0 + i], Math.exp(-i / SR / .09)); } }
function reverb(x, combs, fb) {
  const y = new Float32Array(x.length);
  for (const d of combs) { const D = Math.round(d * SR / 1000), b = new Float32Array(D); let j = 0, lp = 0;
    for (let i = 0; i < x.length; i++) { const o = b[j]; lp = o * .6 + lp * .4; b[j] = x[i] + lp * fb; y[i] += o / combs.length; j = (j + 1) % D; } }
  for (const d of [5.0, 1.7]) { const D = Math.round(d * SR / 1000), b = new Float32Array(D); let j = 0;
    for (let i = 0; i < y.length; i++) { const o = b[j], v = y[i]; b[j] = v + o * .5; y[i] = o - v * .5; j = (j + 1) % D; } }
  return y;
}
const L = new Float32Array(len), R = new Float32Array(len);
for (let i = 0; i < len; i++) { const sc = 1 - .55 * kickEnv[i]; bus.music[0][i] *= sc; bus.music[1][i] *= sc; }
const send = [0, 1].map(c => { const x = new Float32Array(len); for (let i = 0; i < len; i++) x[i] = bus.music[c][i] * .5 + bus.fx[c][i] * .6; return x; });
const wl = reverb(send[0], [29.7, 37.1, 41.1, 43.7], .8), wr = reverb(send[1], [31.3, 36.1, 42.7, 45.1], .8);
let peak = 0;
for (let i = 0; i < len; i++) {
  const fade = Math.min(1, (len - i) / (.8 * SR));
  L[i] = Math.tanh((bus.drums[0][i] + bus.music[0][i] + bus.fx[0][i] * .8 + wl[i] * .35) * .85) * fade;
  R[i] = Math.tanh((bus.drums[1][i] + bus.music[1][i] + bus.fx[1][i] * .8 + wr[i] * .35) * .85) * fade;
  peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
}
const g = .9 / peak, buf = Buffer.alloc(44 + len * 4);
buf.write('RIFF', 0); buf.writeUInt32LE(36 + len * 4, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(len * 4, 40);
for (let i = 0; i < len; i++) { buf.writeInt16LE(Math.round(L[i] * g * 32767), 44 + i * 4); buf.writeInt16LE(Math.round(R[i] * g * 32767), 46 + i * 4); }
fs.writeFileSync(out, buf);
console.log(mode, 'dur', A.dur, 'gain', g.toFixed(2));
