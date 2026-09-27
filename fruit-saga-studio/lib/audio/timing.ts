import type { WordTiming } from "@/lib/types";

/**
 * Speech timing model. Used to (a) predict narration length before any TTS
 * call, (b) drive the mock voice, and (c) derive word timings for subtitles
 * when a TTS provider does not return them (the estimate is stretched to the
 * real, measured duration of the audio).
 */

export interface TimingEstimate {
  duration: number;
  words: WordTiming[];
  /** Continuous voiced spans (between pauses) — used by the mock voice. */
  spans: [number, number][];
}

const LEAD_IN = 0.05;
const TAIL = 0.12;

function pauseAfter(token: string): number {
  if (/(\.\.\.|…|—|–)$/.test(token)) return 0.45;
  if (/[.!?]["”’)]?$/.test(token)) return 0.32;
  if (/[,;:]["”’)]?$/.test(token)) return 0.18;
  return 0;
}

export function tokenize(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter((t) => /[\p{L}\p{N}]/u.test(t));
}

export function estimateTimings(text: string, wpm = 150, speed = 1, fitTo?: number): TimingEstimate {
  const tokens = tokenize(text);
  if (!tokens.length) return { duration: 0, words: [], spans: [] };
  const perWord = 60 / (wpm * speed);
  const weights = tokens.map((t) => {
    const letters = t.replace(/[^\p{L}\p{N}]/gu, "").length;
    return Math.min(1.8, 0.55 + 0.1 * letters);
  });
  const avg = weights.reduce((a, b) => a + b, 0) / weights.length;
  const speech = weights.map((w) => (w / avg) * perWord * 0.9);
  const pauses = tokens.map((t, i) => (i === tokens.length - 1 ? 0 : pauseAfter(t)));
  const natural = LEAD_IN + speech.reduce((a, b) => a + b, 0) + pauses.reduce((a, b) => a + b, 0) + TAIL;
  const scale = fitTo && fitTo > 0.2 ? (fitTo - LEAD_IN - TAIL) / (natural - LEAD_IN - TAIL) : 1;

  const words: WordTiming[] = [];
  const spans: [number, number][] = [];
  let t = LEAD_IN;
  let spanStart = t;
  tokens.forEach((token, i) => {
    const d = speech[i] * scale;
    words.push({ word: token, start: round(t), end: round(t + d) });
    t += d;
    const p = pauses[i] * scale;
    if (p >= 0.15 || i === tokens.length - 1) {
      spans.push([round(spanStart), round(t)]);
      spanStart = t + p;
    }
    t += p;
  });
  const duration = fitTo && fitTo > 0.2 ? fitTo : t + TAIL;
  return { duration: round(duration), words, spans };
}

/** Maps character-level timestamps (e.g. ElevenLabs alignment) to word timings. */
export function wordsFromCharacterAlignment(
  chars: string[],
  starts: number[],
  ends: number[],
): WordTiming[] {
  const words: WordTiming[] = [];
  let current = "";
  let start = 0;
  let end = 0;
  chars.forEach((ch, i) => {
    if (/\s/.test(ch)) {
      if (current) words.push({ word: current, start: round(start), end: round(end) });
      current = "";
      return;
    }
    if (!current) start = starts[i];
    current += ch;
    end = ends[i];
  });
  if (current) words.push({ word: current, start: round(start), end: round(end) });
  return words.filter((w) => /[\p{L}\p{N}]/u.test(w.word));
}

const round = (n: number) => Math.round(n * 1000) / 1000;
