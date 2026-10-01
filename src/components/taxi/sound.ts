let ctx: AudioContext | null = null;

export function unlockAudio() {
  const AC =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return;
  ctx ??= new AC();
  void ctx.resume();
}

/** Browser autoplay can block this until the driver has tapped the page once. */
export async function playRing(): Promise<boolean> {
  unlockAudio();
  if (!ctx) return false;
  try {
    await ctx.resume();
    if (ctx.state !== "running") return false;
    const tones = [880, 880, 660];
    let t = ctx.currentTime + 0.02;
    for (const freq of tones) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      osc.type = "sine";
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.07, t + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.22);
      t += 0.28;
    }
    navigator.vibrate?.([240, 80, 240, 80, 240, 80, 480]);
    return true;
  } catch {
    return false;
  }
}
