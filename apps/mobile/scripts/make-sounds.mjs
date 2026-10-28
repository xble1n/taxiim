// Writes the two alert sounds the Android app plays from its notifications
// (res/raw/taxi_dispatch.wav and taxi_ring.wav). The web app synthesises the same
// patterns in src/taxi/sound.ts. Run: node scripts/make-sounds.mjs
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RATE = 22050;
const out = join(dirname(fileURLToPath(import.meta.url)), "..", "android", "app", "src", "main", "res", "raw");

/** tones: [startSeconds, durationSeconds, frequencies[]] */
function render(totalSeconds, tones, volume) {
  const samples = new Float32Array(Math.round(totalSeconds * RATE));
  for (const [start, dur, freqs] of tones) {
    const from = Math.round(start * RATE);
    const n = Math.round(dur * RATE);
    for (let i = 0; i < n && from + i < samples.length; i += 1) {
      const t = i / RATE;
      // 10 ms fade in and out so the tones do not click.
      const env = Math.min(1, t / 0.01, (dur - t) / 0.01);
      let v = 0;
      for (const f of freqs) v += Math.sin(2 * Math.PI * f * t);
      samples[from + i] += (v / freqs.length) * env * volume;
    }
  }
  return samples;
}

function wav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, s)) * 32767), i * 2));
  const head = Buffer.alloc(44);
  head.write("RIFF", 0);
  head.writeUInt32LE(36 + data.length, 4);
  head.write("WAVEfmt ", 8);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20); // PCM
  head.writeUInt16LE(1, 22); // mono
  head.writeUInt32LE(RATE, 24);
  head.writeUInt32LE(RATE * 2, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write("data", 36);
  head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

// New order: a bright rising three-note chime, played twice.
const chime = [];
for (const base of [0, 0.75]) {
  [1047, 1319, 1568].forEach((f, k) => chime.push([base + k * 0.16, 0.22, [f]]));
}
writeFileSync(join(out, "taxi_dispatch.wav"), wav(render(1.5, chime, 0.6)));

// Ring: a telephone "brr-brr" (440 + 480 Hz), twice.
const ring = [];
for (const base of [0, 1.5]) {
  ring.push([base, 0.4, [440, 480]], [base + 0.55, 0.4, [440, 480]]);
}
writeFileSync(join(out, "taxi_ring.wav"), wav(render(2.6, ring, 0.7)));
console.log("wrote", out);
