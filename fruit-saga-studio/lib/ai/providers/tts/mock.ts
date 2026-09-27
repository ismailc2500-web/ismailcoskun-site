import type { TTSOptions, TTSProvider, TTSResult, TTSVoiceConfig } from "@/lib/ai/types";
import { estimateTimings } from "@/lib/audio/timing";
import { runFfmpeg } from "@/lib/video/ffmpeg";
import { tempFile } from "@/lib/ai/cache";
import { SAMPLE_RATE } from "@/lib/audio/convert";

/**
 * Placeholder voice: a pitched, syllable-rhythm "murmur" synthesised with
 * FFmpeg, timed exactly like real narration would be. Subtitles, ducking and
 * scene timing can all be reviewed without paying for TTS.
 */
export class MockTTSProvider implements TTSProvider {
  readonly name = "mock";
  readonly model = "murmur-v1";

  async generate(text: string, voice: TTSVoiceConfig, options: TTSOptions): Promise<TTSResult> {
    const speed = voice.speed ?? 1;
    const t = estimateTimings(text, options.wordsPerMinute, speed);
    const duration = Math.max(0.3, t.duration);
    const pitch = voice.pitch_hz ?? 120;
    const spans = mergeSpans(t.spans, 14);
    const gate = spans.length
      ? spans.map(([a, b]) => `clip((t-${a.toFixed(3)})*30,0,1)*clip((${b.toFixed(3)}-t)*30,0,1)`).join("+")
      : "1";
    const phase = `(2*PI*${pitch}*t+2.2*sin(2*PI*1.3*t)+0.9*sin(2*PI*3.1*t))`;
    const tone = `(sin(${phase})+0.5*sin(2*${phase})+0.28*sin(3*${phase})+0.14*sin(4*${phase}))`;
    const syllables = `(0.3+0.7*pow(abs(sin(PI*${(4.3 * speed).toFixed(2)}*t)),0.8))`;
    const expr = `0.2*(${gate})*${syllables}*${tone}`;
    const out = tempFile("wav");
    await runFfmpeg([
      "-f",
      "lavfi",
      "-i",
      `aevalsrc=exprs='${expr}':s=${SAMPLE_RATE}:d=${duration.toFixed(3)}`,
      "-af",
      `highpass=f=90,lowpass=f=2600,afade=t=in:d=0.02,afade=t=out:st=${Math.max(0, duration - 0.05).toFixed(3)}:d=0.05`,
      "-ac",
      "1",
      "-ar",
      String(SAMPLE_RATE),
      "-c:a",
      "pcm_s16le",
      out,
    ]);
    return { wavPath: out, duration, words: t.words, cost: 0, model: this.model };
  }

  estimateCost() {
    return 0;
  }

  cacheParts(text: string, voice: TTSVoiceConfig, options: TTSOptions) {
    return { v: 1, text, pitch: voice.pitch_hz ?? 120, speed: voice.speed ?? 1, wpm: options.wordsPerMinute };
  }
}

function mergeSpans(spans: [number, number][], max: number): [number, number][] {
  const list = spans.map((s) => [...s] as [number, number]);
  while (list.length > max) {
    let best = 0;
    let gap = Infinity;
    for (let i = 0; i < list.length - 1; i++) {
      const g = list[i + 1][0] - list[i][1];
      if (g < gap) {
        gap = g;
        best = i;
      }
    }
    list.splice(best, 2, [list[best][0], list[best + 1][1]]);
  }
  return list;
}
