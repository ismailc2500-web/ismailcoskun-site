import type { Character, Timeline, WordTiming } from "@/lib/types";

/**
 * STAGE 7 — subtitles. Chunks the timed words into short captions (max two
 * lines), then writes SRT and ASS. ASS styling is large, bold and outlined,
 * centred low but above the TikTok / Reels / Shorts UI, and supports
 * word-by-word highlighting.
 */

export interface CaptionChunk {
  start: number;
  end: number;
  words: WordTiming[];
  speaker: string;
}

export interface CaptionLayout {
  playResX: number;
  playResY: number;
  fontSize: number;
  marginV: number;
  marginL: number;
  marginR: number;
  maxLineChars: number;
}

/** Safe areas: vertical keeps clear of the bottom caption/UI band and the right-hand action buttons. */
export const LAYOUTS: Record<"vertical" | "landscape", CaptionLayout> = {
  vertical: { playResX: 1080, playResY: 1920, fontSize: 76, marginV: 600, marginL: 90, marginR: 160, maxLineChars: 20 },
  landscape: { playResX: 1920, playResY: 1080, fontSize: 64, marginV: 80, marginL: 200, marginR: 200, maxLineChars: 34 },
};

export function buildCaptionChunks(timeline: Timeline, maxLineChars = 20): CaptionChunk[] {
  const chunks: CaptionChunk[] = [];
  const maxChars = maxLineChars * 2;
  for (const clip of timeline.voice) {
    let current: WordTiming[] = [];
    const flush = () => {
      if (current.length) chunks.push({ start: current[0].start, end: current[current.length - 1].end, words: current, speaker: clip.speaker });
      current = [];
    };
    clip.words.forEach((w, i) => {
      const text = [...current, w].map((x) => x.word).join(" ");
      const gap = current.length ? w.start - current[current.length - 1].end : 0;
      // Avoid orphans: let the last word of a sentence ride along if it nearly fits.
      const closesSentence = /[.!?…]["”’)]?$/.test(w.word) && current.length >= 2;
      const tooLong = text.length > maxChars && !(closesSentence && text.length <= maxChars + 8);
      if (current.length && (tooLong || gap > 0.45)) flush();
      current.push(w);
      const next = clip.words[i + 1];
      const sentenceEnd = /[.!?…]["”’)]?$/.test(w.word);
      if (sentenceEnd && current.length >= 2 && next) flush();
    });
    flush();
  }
  // Hold each caption until just before the next one (min 0.6 s on screen).
  for (let i = 0; i < chunks.length; i++) {
    const next = chunks[i + 1];
    const holdUntil = next ? next.start - 0.04 : chunks[i].end + 0.5;
    chunks[i].end = Math.max(chunks[i].end + 0.15, Math.min(holdUntil, chunks[i].end + 0.6));
    chunks[i].end = Math.max(chunks[i].end, chunks[i].start + 0.6);
    if (next && chunks[i].end > next.start - 0.02) chunks[i].end = next.start - 0.02;
  }
  return chunks;
}

/** Splits a caption into at most two balanced lines. */
export function splitLines(words: string[], maxLineChars: number): string[][] {
  const text = words.join(" ");
  if (text.length <= maxLineChars || words.length < 2) return [words];
  let best = 1;
  let bestScore = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(" ").length;
    const b = words.slice(i).join(" ").length;
    const score = Math.abs(a - b) + (a > maxLineChars || b > maxLineChars ? 50 : 0) + (/[,;:]$/.test(words[i - 1]) ? -6 : 0);
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return [words.slice(0, best), words.slice(best)];
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

function srtTime(t: number) {
  const ms = Math.max(0, Math.round(t * 1000));
  return `${pad(Math.floor(ms / 3_600_000))}:${pad(Math.floor(ms / 60_000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
}

function assTime(t: number) {
  const cs = Math.max(0, Math.round(t * 100));
  return `${Math.floor(cs / 360_000)}:${pad(Math.floor(cs / 6000) % 60)}:${pad(Math.floor(cs / 100) % 60)}.${pad(cs % 100)}`;
}

function speakerLabel(speaker: string, characters: Character[]) {
  if (speaker === "narrator") return "";
  const c = characters.find((x) => x.id === speaker);
  const name = c ? (c.display_name.match(/["“](.+?)["”]/)?.[1] ?? c.display_name.split(" ")[0]) : speaker;
  return name.toUpperCase();
}

export function toSrt(chunks: CaptionChunk[], characters: Character[], maxLineChars = 32): string {
  return chunks
    .map((c, i) => {
      const label = speakerLabel(c.speaker, characters);
      const lines = splitLines(c.words.map((w) => w.word), maxLineChars).map((l) => l.join(" "));
      if (label) lines[0] = `${label}: ${lines[0]}`;
      return `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${lines.join("\n")}\n`;
    })
    .join("\n");
}

/** #RRGGBB → ASS &H00BBGGRR */
export function assColor(hex: string, alpha = 0): string {
  const h = hex.replace("#", "").padEnd(6, "0");
  const [r, g, b] = [h.slice(0, 2), h.slice(2, 4), h.slice(4, 6)];
  return `&H${alpha.toString(16).padStart(2, "0").toUpperCase()}${b}${g}${r}`.toUpperCase();
}

const escapeAss = (s: string) => s.replace(/\\/g, "/").replace(/[{}]/g, "").replace(/\n/g, " ");

export function toAss(
  chunks: CaptionChunk[],
  characters: Character[],
  opts: { layout: CaptionLayout; font: string; highlight: boolean; uppercase: boolean; highlightColor?: string },
): string {
  const L = opts.layout;
  const white = assColor("#FFFFFF");
  const highlight = assColor(opts.highlightColor ?? "#FFD23F");
  const header = `[Script Info]
; Generated by Fruit Saga Studio
ScriptType: v4.00+
PlayResX: ${L.playResX}
PlayResY: ${L.playResY}
WrapStyle: 2
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,${opts.font},${L.fontSize},${white},${highlight},&H00101010,&H96000000,-1,0,0,0,100,100,1,0,1,${Math.round(L.fontSize * 0.075)},${Math.round(L.fontSize * 0.04)},2,${L.marginL},${L.marginR},${L.marginV},1
Style: Speaker,${opts.font},${Math.round(L.fontSize * 0.5)},${highlight},${highlight},&H00101010,&H96000000,-1,0,0,0,100,100,2,0,1,${Math.round(L.fontSize * 0.05)},0,2,${L.marginL},${L.marginR},${L.marginV + Math.round(L.fontSize * 2.35)},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const events: string[] = [];
  for (const chunk of chunks) {
    const words = chunk.words.map((w) => escapeAss(opts.uppercase ? w.word.toUpperCase() : w.word));
    const lines = splitLines(words, L.maxLineChars);
    const character = characters.find((c) => c.id === chunk.speaker);
    const baseColor = character ? assColor(character.palette.accent) : white;
    const colorTag = character ? `{\\c${baseColor}}` : "";
    const render = (activeIndex: number | null) => {
      let idx = 0;
      return lines
        .map((line) =>
          line
            .map((w) => {
              const i = idx++;
              return i === activeIndex ? `{\\c${highlight}\\fscx108\\fscy108}${w}{\\c${character ? baseColor : white}\\fscx100\\fscy100}` : w;
            })
            .join(" "),
        )
        .join("\\N");
    };
    const label = speakerLabel(chunk.speaker, characters);
    if (label) events.push(`Dialogue: 1,${assTime(chunk.start)},${assTime(chunk.end)},Speaker,,0,0,0,,${escapeAss(label)}`);
    if (opts.highlight) {
      chunk.words.forEach((w, i) => {
        const start = i === 0 ? chunk.start : w.start;
        const end = i === chunk.words.length - 1 ? chunk.end : chunk.words[i + 1].start;
        if (end - start < 0.01) return;
        events.push(`Dialogue: 0,${assTime(start)},${assTime(end)},Caption,,0,0,0,,${colorTag}${render(i)}`);
      });
    } else {
      events.push(`Dialogue: 0,${assTime(chunk.start)},${assTime(chunk.end)},Caption,,0,0,0,,{\\fad(60,40)}${colorTag}${render(null)}`);
    }
  }
  return header + events.join("\n") + "\n";
}
