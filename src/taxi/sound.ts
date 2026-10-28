let ctx: AudioContext | null = null;

export function unlockAudio() {
  const AC =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return;
  ctx ??= new AC();
  void ctx.resume();
}

/** [start seconds, duration seconds, frequencies] — the same patterns as apps/mobile/scripts/make-sounds.mjs. */
type Tone = [number, number, number[]];

const DISPATCH: Tone[] = [0, 0.75].flatMap((base) =>
  [1047, 1319, 1568].map((f, k): Tone => [base + k * 0.16, 0.22, [f]]),
);
const RING: Tone[] = [0, 1.5].flatMap((base): Tone[] => [
  [base, 0.4, [440, 480]],
  [base + 0.55, 0.4, [440, 480]],
]);

/** Phone buzz patterns differ too, so a driver can tell them apart in a pocket. */
export const VIBRATE_DISPATCH = [400, 150, 400, 150, 400];
export const VIBRATE_RING = [900, 300, 900, 300, 900];

async function play(tones: Tone[], volume: number): Promise<boolean> {
  unlockAudio();
  if (!ctx) return false;
  try {
    await ctx.resume();
    if (ctx.state !== "running") return false;
    const t0 = ctx.currentTime + 0.02;
    for (const [start, dur, freqs] of tones) {
      for (const freq of freqs) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const t = t0 + start;
        osc.frequency.value = freq;
        osc.type = "sine";
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(volume / freqs.length, t + 0.02);
        gain.gain.setValueAtTime(volume / freqs.length, t + dur - 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t);
        osc.stop(t + dur + 0.02);
      }
    }
    return true;
  } catch {
    return false;
  }
}

/** New order: rising chime. Browser autoplay can block it until the driver has tapped the page once. */
export async function playDispatch(): Promise<boolean> {
  navigator.vibrate?.(VIBRATE_DISPATCH);
  return play(DISPATCH, 0.12);
}

/** Desk is ringing: telephone "brr-brr", clearly different from a new order. */
export async function playRing(): Promise<boolean> {
  navigator.vibrate?.(VIBRATE_RING);
  return play(RING, 0.14);
}
