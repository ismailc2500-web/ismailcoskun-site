import fs from "node:fs";
import path from "node:path";
import { paths } from "@/lib/config";
import { cachedGenerate, hashKey, tempFile } from "@/lib/ai/cache";
import { runFfmpeg } from "@/lib/video/ffmpeg";
import { SAMPLE_RATE } from "@/lib/audio/convert";

/**
 * Original, procedurally generated music and sound effects (FFmpeg lavfi
 * sources). If you drop licensed files into data/audio-library/, they are used
 * instead: sfx/<type>*.wav|mp3 (e.g. sfx/footsteps_gravel.wav) and
 * music/<mood>*.mp3 (e.g. music/dark-epic_theme.mp3). See the README there.
 */

const AUDIO_EXT = /\.(wav|mp3|ogg|flac|m4a|aac)$/i;

export function libraryFile(kind: "sfx" | "music", name: string, seed = 0): string | null {
  const dir = path.join(paths.audioLibrary, kind);
  if (!fs.existsSync(dir)) return null;
  const files = fs
    .readdirSync(dir)
    .filter((f) => AUDIO_EXT.test(f) && f.toLowerCase().startsWith(name.toLowerCase()))
    .sort();
  if (!files.length) return null;
  return path.join(dir, files[seed % files.length]);
}

type Recipe = (d: number) => { inputs: string[]; filter: string };

const aeval = (expr: string, d: number) => `aevalsrc=exprs='${expr}':s=${SAMPLE_RATE}:d=${d.toFixed(3)}`;
const noise = (color: string, amp: number, d: number, seed = 7) => `anoisesrc=d=${d.toFixed(3)}:c=${color}:a=${amp}:r=${SAMPLE_RATE}:s=${seed}`;

const RECIPES: Record<string, Recipe> = {
  wind: (d) => ({ inputs: [noise("brown", 0.7, d)], filter: "[0]lowpass=f=520,tremolo=f=0.22:d=0.75,volume=2[out]" }),
  rain: (d) => ({ inputs: [noise("white", 0.35, d)], filter: "[0]highpass=f=900,lowpass=f=7000,tremolo=f=9:d=0.2[out]" }),
  forest_ambience: (d) => ({
    inputs: [noise("pink", 0.22, d), aeval("0.08*sin(2*PI*(2900+900*sin(2*PI*11*t))*t)*gt(sin(2*PI*0.31*t+1),0.94)+0.06*sin(2*PI*(3600+700*sin(2*PI*14*t))*t)*gt(sin(2*PI*0.23*t),0.95)", d)],
    filter: "[0]highpass=f=250,lowpass=f=2400,tremolo=f=0.13:d=0.5[a];[1]aecho=0.6:0.5:180:0.3[b];[a][b]amix=inputs=2:normalize=0[out]",
  }),
  village_ambience: (d) => ({
    inputs: [noise("pink", 0.14, d), aeval("0.07*sin(2*PI*(3300+1200*sin(2*PI*16*t))*t)*gt(sin(2*PI*0.41*t),0.9)+0.05*sin(2*PI*(2500+600*sin(2*PI*9*t))*t)*gt(sin(2*PI*0.27*t+2),0.92)", d)],
    filter: "[0]highpass=f=400,lowpass=f=3000[a];[a][1]amix=inputs=2:normalize=0[out]",
  }),
  fire_ambience: (d) => ({
    inputs: [noise("brown", 0.5, d), aeval("0.7*(random(0)-0.5)*gt(random(1),0.9975)", d)],
    filter: "[0]lowpass=f=700,tremolo=f=0.4:d=0.4[a];[1]highpass=f=900[b];[a][b]amix=inputs=2:normalize=0[out]",
  }),
  water_ambience: (d) => ({ inputs: [noise("white", 0.3, d)], filter: "[0]bandpass=f=900:w=1400,tremolo=f=0.6:d=0.45,volume=1.4[out]" }),
  cave_ambience: (d) => ({
    inputs: [noise("brown", 0.35, d), aeval("0.45*sin(2*PI*(1900-1100*mod(t,1.9))*t)*exp(-45*mod(t,1.9))", d)],
    filter: "[0]lowpass=f=260[a];[1]aecho=0.7:0.6:320|640:0.35|0.2[b];[a][b]amix=inputs=2:normalize=0[out]",
  }),
  footsteps: (d) => ({ inputs: [aeval("(random(0)*2-1)*exp(-38*mod(t,0.47))*0.9", d)], filter: "[0]lowpass=f=950,highpass=f=70,volume=1.6[out]" }),
  sword: (d) => ({
    inputs: [aeval("(0.35*sin(2*PI*2350*t)+0.25*sin(2*PI*3710*t)+0.15*sin(2*PI*5300*t))*exp(-3.2*t)+(random(0)*2-1)*exp(-30*t)*0.45", d)],
    filter: "[0]highpass=f=450,aecho=0.7:0.5:60:0.25[out]",
  }),
  magic: (d) => ({
    inputs: [aeval("0.12*(sin(2*PI*(880+60*sin(2*PI*6*t))*t)+sin(2*PI*(1320+80*sin(2*PI*5*t))*t)+sin(2*PI*1760*(1+0.12*t)*t))*(1-exp(-3*t))", d)],
    filter: `[0]aecho=0.8:0.7:120|240:0.4|0.3,afade=t=out:st=${Math.max(0, d - 0.8).toFixed(2)}:d=0.8[out]`,
  }),
  ring_hum: (d) => ({ inputs: [aeval("0.25*sin(2*PI*220*t)*(0.6+0.4*sin(2*PI*3*t))+0.12*sin(2*PI*331*t)", d)], filter: "[0]lowpass=f=1200[out]" }),
  hit: (d) => ({
    inputs: [aeval("0.95*sin(2*PI*(52+90*exp(-9*t))*t)*exp(-2.1*t)+0.35*(random(0)*2-1)*exp(-20*t)", d)],
    filter: "[0]lowpass=f=3200,aecho=0.6:0.4:90:0.25[out]",
  }),
  whoosh: (d) => ({
    inputs: [noise("white", 0.9, d)],
    filter: `[0]bandpass=f=1300:w=2200,volume='pow(sin(PI*t/${d.toFixed(3)}),2)':eval=frame[out]`,
  }),
  creature: (d) => ({
    inputs: [aeval("0.5*(sin(2*PI*(72+18*sin(2*PI*7*t))*t)+0.6*sin(2*PI*(144+30*sin(2*PI*7*t))*t)+0.3*(random(0)*2-1))*(0.5+0.5*sin(2*PI*1.1*t))*min(1,t*3)", d)],
    filter: `[0]lowpass=f=900,afade=t=out:st=${Math.max(0, d - 0.6).toFixed(2)}:d=0.6[out]`,
  }),
  riser: (d) => ({
    inputs: [aeval(`0.3*sin(2*PI*(180+900*pow(t/${d.toFixed(3)},2))*t)*(t/${d.toFixed(3)})+0.15*(random(0)*2-1)*pow(t/${d.toFixed(3)},2)`, d)],
    filter: "[0]highpass=f=140[out]",
  }),
  heartbeat: (d) => ({
    inputs: [aeval("0.9*sin(2*PI*48*t)*(exp(-25*mod(t,0.85))+0.7*exp(-25*mod(t-0.22,0.85))*gt(mod(t,0.85),0.22))", d)],
    filter: "[0]lowpass=f=160,volume=1.8[out]",
  }),
  thunder: (d) => ({ inputs: [noise("brown", 1, d)], filter: "[0]lowpass=f=380,volume='exp(-1.1*t)*(1-exp(-18*t))*3':eval=frame[out]" }),
  creak: (d) => ({ inputs: [aeval("0.3*sin(2*PI*(170+60*sin(2*PI*3*t))*t)*gt(sin(2*PI*23*t),0)", d)], filter: "[0]bandpass=f=600:w=500[out]" }),
  clank: (d) => ({ inputs: [aeval("(0.3*sin(2*PI*820*t)+0.25*sin(2*PI*1370*t)+0.2*sin(2*PI*2210*t))*exp(-9*mod(t,0.33))", d)], filter: "[0]highpass=f=300[out]" }),
  rustle: (d) => ({ inputs: [noise("pink", 0.6, d)], filter: "[0]bandpass=f=3200:w=3000,tremolo=f=11:d=0.8[out]" }),
};

export const SFX_TYPES = Object.keys(RECIPES);

async function renderRecipe(recipe: Recipe, duration: number, out: string) {
  const { inputs, filter } = recipe(duration);
  const d = duration.toFixed(3);
  const fade = `afade=t=in:d=${Math.min(0.02, duration / 4).toFixed(3)},afade=t=out:st=${Math.max(0, duration - 0.08).toFixed(3)}:d=0.08`;
  await runFfmpeg([
    ...inputs.flatMap((i) => ["-f", "lavfi", "-i", i]),
    "-filter_complex",
    `${filter};[out]${fade},atrim=end=${d},aformat=sample_rates=${SAMPLE_RATE}:channel_layouts=mono[final]`,
    "-map",
    "[final]",
    "-c:a",
    "pcm_s16le",
    out,
  ]);
}

/** Returns a mono WAV for one cue: licensed library file if present, otherwise procedural. */
export async function sfxFile(type: string, duration: number, seed = 0): Promise<{ path: string; source: "library" | "procedural" }> {
  const lib = libraryFile("sfx", type, seed);
  if (lib) return { path: lib, source: "library" };
  const recipe = RECIPES[type] ?? RECIPES.whoosh;
  const d = Math.max(0.1, Math.round(duration * 10) / 10);
  const key = hashKey({ kind: "sfx", type, d, v: 2 });
  const res = await cachedGenerate({
    kind: "sfx",
    key,
    provider: "procedural",
    model: "lavfi-v2",
    generate: async () => {
      const out = tempFile("wav");
      await renderRecipe(recipe, d, out);
      return { filePath: out, ext: "wav", cost: 0 };
    },
  });
  return { path: res.path, source: "procedural" };
}

// ---------------------------------------------------------------------------
// Procedural score
// ---------------------------------------------------------------------------

interface MoodSpec {
  chords: number[][]; // chord tones in Hz per bar
  bar: number; // seconds per chord
  pulse: number; // seconds between drum hits
  bright: number; // amount of upper shimmer
}

const MOODS: Record<string, MoodSpec> = {
  // A minor: Am – F – C – G
  "dark-epic": {
    chords: [
      [110, 130.81, 164.81, 220],
      [87.31, 130.81, 174.61, 220],
      [130.81, 164.81, 196, 261.63],
      [98, 146.83, 196, 246.94],
    ],
    bar: 4,
    pulse: 1,
    bright: 0.4,
  },
  // D minor drone with a slow pulse
  tense: {
    chords: [
      [73.42, 110, 146.83, 174.61],
      [73.42, 103.83, 146.83, 155.56],
    ],
    bar: 6,
    pulse: 0.85,
    bright: 0.2,
  },
  // G major: G – Em – C – D
  whimsical: {
    chords: [
      [98, 123.47, 146.83, 196],
      [82.41, 123.47, 164.81, 196],
      [130.81, 164.81, 196, 261.63],
      [146.83, 185, 220, 293.66],
    ],
    bar: 2.5,
    pulse: 0.5,
    bright: 0.7,
  },
  // C major heroic: C – G – Am – F
  heroic: {
    chords: [
      [130.81, 164.81, 196, 261.63],
      [98, 146.83, 196, 246.94],
      [110, 130.81, 164.81, 220],
      [87.31, 130.81, 174.61, 220],
    ],
    bar: 3,
    pulse: 0.75,
    bright: 0.6,
  },
};

function musicExpression(mood: MoodSpec, total: number, swells: number[]): string {
  const n = mood.chords.length;
  const bar = mood.bar;
  const sel = `mod(floor(t/${bar}),${n})`;
  const tone = (k: number) => {
    let e = `${mood.chords[n - 1][k]}`;
    for (let i = n - 2; i >= 0; i--) e = `if(eq(${sel},${i}),${mood.chords[i][k]},${e})`;
    return e;
  };
  const env = `min(1,mod(t,${bar})*3)*min(1,(${bar}-mod(t,${bar}))*3)`;
  const pad = [0, 1, 2, 3]
    .map((k) => `sin(2*PI*${tone(k)}*t)+0.5*sin(2*PI*${tone(k)}*1.003*t)`)
    .join("+");
  const swell = swells.length ? swells.map((s) => `exp(-pow((t-${s.toFixed(2)})/2.5,2))`).join("+") : "0";
  const intensity = `(0.5+0.35*(t/${total.toFixed(2)})+0.35*(${swell}))`;
  const drum = `sin(2*PI*(48+40*exp(-30*mod(t,${mood.pulse})))*t)*exp(-7*mod(t,${mood.pulse}))`;
  const shimmer = `${mood.bright}*0.25*sin(2*PI*${tone(3)}*4*t)*(0.5+0.5*sin(2*PI*0.25*t))`;
  return `0.05*${env}*(${pad})*${intensity}+0.3*${drum}*${intensity}*${intensity}+0.02*${shimmer}*${intensity}`;
}

/** Returns a music bed covering the whole episode (library track or procedural score). */
export async function musicFile(mood: string, duration: number, swells: number[], seed = 0): Promise<{ path: string; source: "library" | "procedural" }> {
  const lib = libraryFile("music", mood, seed);
  if (lib) return { path: lib, source: "library" };
  const spec = MOODS[mood] ?? MOODS["dark-epic"];
  const d = Math.max(1, Math.round(duration * 10) / 10);
  const key = hashKey({ kind: "music", mood, d, swells: swells.map((s) => Math.round(s * 10) / 10), v: 2 });
  const res = await cachedGenerate({
    kind: "music",
    key,
    provider: "procedural",
    model: "lavfi-score-v2",
    generate: async () => {
      const out = tempFile("wav");
      await runFfmpeg([
        "-f",
        "lavfi",
        "-i",
        aeval(musicExpression(spec, d, swells), d),
        "-af",
        `lowpass=f=4200,aecho=0.8:0.6:260|520:0.3|0.2,afade=t=in:d=0.8,afade=t=out:st=${Math.max(0, d - 1.5).toFixed(2)}:d=1.5`,
        "-ac",
        "1",
        "-ar",
        String(SAMPLE_RATE),
        "-c:a",
        "pcm_s16le",
        out,
      ]);
      return { filePath: out, ext: "wav", cost: 0 };
    },
  });
  return { path: res.path, source: "procedural" };
}
