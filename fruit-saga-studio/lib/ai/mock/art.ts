import sharp from "sharp";
import type { Character, EnvironmentType, Location, Scene } from "@/lib/types";
import { expressionFor, type ExpressionSpec } from "@/lib/prompts/vocabulary";
import { hashString, Rng } from "@/lib/ai/mock/rng";

/**
 * Procedural placeholder art for MOCK MODE.
 *
 * Draws readable stand-in keyframes — fruit-headed characters built from the
 * character bible (fruit, palette, props, expression) in a backdrop derived
 * from the location — so the whole pipeline (timing, camera moves, captions,
 * mix, export) can be reviewed before paying for real generations.
 */

// ---------------------------------------------------------------------------
// Colour helpers
// ---------------------------------------------------------------------------

type RGB = [number, number, number];

function hexToRgb(hex: string): RGB {
  let h = hex.replace("#", "").trim();
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  h = (h + "000000").slice(0, 6);
  return [parseInt(h.slice(0, 2), 16) || 0, parseInt(h.slice(2, 4), 16) || 0, parseInt(h.slice(4, 6), 16) || 0];
}

function rgbToHex([r, g, b]: RGB): string {
  return "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
}

export function mix(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  return rgbToHex([r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t]);
}
export const darken = (c: string, t: number) => mix(c, "#000000", t);
export const lighten = (c: string, t: number) => mix(c, "#ffffff", t);

const n1 = (v: number) => (Math.round(v * 10) / 10).toString();

// ---------------------------------------------------------------------------
// Fruit & character specs
// ---------------------------------------------------------------------------

type FruitShape =
  | "round"
  | "apple"
  | "pear"
  | "lemon"
  | "dragon"
  | "wrinkled"
  | "pomegranate"
  | "coconut"
  | "orange"
  | "strawberry"
  | "pineapple"
  | "melon";

interface FruitArt {
  shape: FruitShape;
  base: string;
  mid: string;
  light: string;
  detail: string;
}

const FRUIT_ART: [RegExp, FruitArt][] = [
  [/dragon ?fruit|pitaya|volcanic/, { shape: "dragon", base: "#140c0f", mid: "#2a171c", light: "#5a2a22", detail: "#ff5a1f" }],
  [/passion ?fruit/, { shape: "wrinkled", base: "#2e1532", mid: "#4f2a55", light: "#8c6a92", detail: "#9aa08f" }],
  [/pomegranate/, { shape: "pomegranate", base: "#62101d", mid: "#a01f33", light: "#f08a8a", detail: "#4a0913" }],
  [/coconut/, { shape: "coconut", base: "#3f2715", mid: "#6a4629", light: "#a6835c", detail: "#26170b" }],
  [/lemon/, { shape: "lemon", base: "#c9a814", mid: "#f0d840", light: "#fffbe0", detail: "#a88c0c" }],
  [/lime/, { shape: "lemon", base: "#4f8a1c", mid: "#7cc03a", light: "#e0ffc0", detail: "#3b6a12" }],
  [/orange|tangerine|mandarin|tangelo|clementine/, { shape: "orange", base: "#cf5c08", mid: "#f58d24", light: "#ffd9a0", detail: "#a84a06" }],
  [/pear/, { shape: "pear", base: "#6f8430", mid: "#a4b84e", light: "#eef0b0", detail: "#8a5a2c" }],
  [/apple/, { shape: "apple", base: "#9a1c18", mid: "#d8412f", light: "#ffc890", detail: "#f1c46b" }],
  [/strawberr/, { shape: "strawberry", base: "#a3121c", mid: "#e0303a", light: "#ffb0a8", detail: "#f7d84a" }],
  [/pineapple/, { shape: "pineapple", base: "#a8741c", mid: "#e0a838", light: "#ffe7a0", detail: "#6b4a10" }],
  [/watermelon|melon/, { shape: "melon", base: "#1f5a24", mid: "#3f8a3a", light: "#bfe8a0", detail: "#123a16" }],
  [/peach|apricot|nectarine/, { shape: "round", base: "#e0784a", mid: "#f7a870", light: "#ffe0c8", detail: "#c95a3a" }],
  [/plum|grape|blueberry|fig/, { shape: "round", base: "#3a1e4f", mid: "#5f3a80", light: "#b89ad8", detail: "#2a1238" }],
  [/kiwi|avocado/, { shape: "round", base: "#4a3a1a", mid: "#6e5a2e", light: "#a8946a", detail: "#2f2410" }],
  [/banana|mango/, { shape: "round", base: "#d8a818", mid: "#f5d040", light: "#fff4b0", detail: "#8a6a10" }],
  [/cherry|raspberr/, { shape: "round", base: "#7a0a18", mid: "#c0182c", light: "#ff8a9a", detail: "#50060f" }],
];

function fruitArt(fruit: string): FruitArt {
  const f = fruit.toLowerCase();
  for (const [re, art] of FRUIT_ART) if (re.test(f)) return art;
  const hue = hashString(f) % 360;
  const base = hslToHex(hue, 55, 32);
  return { shape: "round", base, mid: hslToHex(hue, 60, 48), light: hslToHex(hue, 70, 80), detail: hslToHex(hue, 50, 22) };
}

function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return rgbToHex([f(0) * 255, f(8) * 255, f(4) * 255]);
}

export interface ArtCharacter {
  id: string;
  fruit: string;
  archetype: string;
  palette: { primary: string; secondary: string; accent: string };
  features: string[];
  heightFactor: number;
  widthFactor: number;
  iris: string;
  browColor: string | null;
}

const FEATURE_PATTERNS: [string, RegExp][] = [
  ["white-beard", /white beard|flowing white beard/],
  ["beard", /beard/],
  ["hat", /\bhat\b/],
  ["hood", /hood/],
  ["staff", /staff/],
  ["bow", /\bbow\b|longbow/],
  ["axe", /\baxe\b/],
  ["sword", /sword/],
  ["mace", /\bmace\b/],
  ["shield", /shield/],
  ["backpack", /backpack/],
  ["satchel", /satchel/],
  ["pots", /\bpots?\b|pans?\b/],
  ["lantern", /lantern/],
  ["cape", /\bcape\b|\bcloak\b/],
  ["armour", /armou?r|chainmail|plate/],
  ["scarf", /scarf/],
  ["leaf-ears", /like elegant elf ears|leaf-ears|leaves sweeping/],
  ["crown-calyx", /crown-shaped calyx|natural crown/],
  ["hunched", /hunch|all fours|scuttl|crawl/],
  ["smoke", /smoke rising|smoke rises/],
  ["scar", /\bscar\b/],
  ["bruise", /bruise/],
  ["single-eye", /single [\w\s-]*eye/],
  ["white-brows", /white eyebrows|white brows/],
  ["spikes", /jagged|spik/],
];

export function artCharacter(c: Character): ArtCharacter {
  const text = [c.fruit, c.descriptor, c.costume, c.body_description, c.face_description, c.fruit_description, c.height, ...c.props, ...c.visual_traits]
    .join(" ")
    .toLowerCase();
  const features = FEATURE_PATTERNS.filter(([, re]) => re.test(text)).map(([f]) => f);
  const h = `${c.height} ${c.body_description} ${c.descriptor}`.toLowerCase();
  let heightFactor = 1;
  if (/towering|twice the height|colossal|giant/.test(h)) heightFactor = 1.55;
  else if (/tallest/.test(h)) heightFactor = 1.18;
  else if (/\btall\b/.test(h)) heightFactor = 1.1;
  else if (/shortest|tiny/.test(h)) heightFactor = 0.8;
  else if (/\bshort\b|small/.test(h)) heightFactor = 0.86;
  let widthFactor = 1;
  if (/barrel|extremely broad|widest|twice as wide/.test(h)) widthFactor = 1.4;
  else if (/stocky|broad|stout/.test(h)) widthFactor = 1.22;
  else if (/thin|slender|lean|gaunt|bony/.test(h)) widthFactor = 0.84;
  const face = c.face_description.toLowerCase();
  const iris = /hazel/.test(face)
    ? "#6b4a1f"
    : /grey|gray/.test(face)
      ? "#5f6a74"
      : /pale-green|pale green/.test(face)
        ? "#9be27a"
        : /green/.test(face)
          ? "#3f8a4a"
          : /amber|gold/.test(face)
            ? "#b8741a"
            : /blue/.test(face)
              ? "#3a6aa8"
              : "#3b2a1a";
  const browColor = features.includes("white-brows")
    ? "#ecebe6"
    : /coconut/.test(c.fruit)
      ? "#8a6a48"
      : null;
  return {
    id: c.id,
    fruit: c.fruit,
    archetype: c.archetype,
    palette: c.palette,
    features,
    heightFactor,
    widthFactor,
    iris,
    browColor,
  };
}

// ---------------------------------------------------------------------------
// Scene spec
// ---------------------------------------------------------------------------

export interface ArtSceneSpec {
  kind: "keyframe" | "thumbnail" | "portrait" | "card";
  width: number;
  height: number;
  seed: number;
  environment: EnvironmentType;
  interior: boolean;
  palette: { sky: string; ground: string; accent: string };
  framing: string;
  emotion: string;
  timeOfDay: "day" | "golden" | "dawn" | "night";
  weather: "none" | "rain" | "snow" | "embers" | "spores";
  magicGlow: boolean;
  characters: ArtCharacter[];
  speakerIds: string[];
  /** Per-character emotion overrides (antagonists stay sinister in a scared scene). */
  label?: string;
  title?: string;
  subtitle?: string;
}

const DEFAULT_PALETTE = { sky: "#2a3346", ground: "#1d2418", accent: "#f5b642" };

export function artSceneFromScene(
  scene: Scene,
  sceneChars: Character[],
  loc: Location | undefined,
  width: number,
  height: number,
  label?: string,
): ArtSceneSpec {
  const text = `${scene.environment} ${scene.lighting} ${scene.action} ${scene.description} ${scene.environment_motion}`.toLowerCase();
  const env = loc?.environment_type ?? "other";
  const timeOfDay = /night|moon|storm|dark|lightning|candle|hearth|throne room/.test(text)
    ? "night"
    : /dawn|sunrise|morning/.test(text)
      ? "dawn"
      : /golden|sunset|dusk|warm/.test(text)
        ? "golden"
        : "day";
  const weather =
    env === "volcanic" || /\b(embers?|lava)\b/.test(text)
      ? "embers"
      : /\b(rain|rainy|raining|storm|stormy|thunderstorm)\b/.test(text)
        ? "rain"
        : /\b(snow\w*|blizzard|frost\w*)\b/.test(text) || env === "mountain"
          ? "snow"
          : env === "forest"
            ? "spores"
            : "none";
  return {
    kind: "keyframe",
    width,
    height,
    seed: scene.seed || hashString(scene.scene_id + scene.action),
    environment: env,
    interior: /kitchen|inside|interior|indoors|\broom\b|hall|throne room|tavern|cellar/.test(scene.environment.toLowerCase()),
    palette: loc?.palette ?? DEFAULT_PALETTE,
    framing: scene.camera_framing || "medium shot",
    emotion: scene.emotion,
    timeOfDay,
    weather,
    magicGlow: /\b(ring|rings|seed|glow\w*|crystal|orb|amulet|magic\w*)\b/.test(text),
    characters: sceneChars.map(artCharacter),
    speakerIds: scene.dialogue.map((d) => d.character_id),
    label,
  };
}

export function artSceneForThumbnail(
  chars: Character[],
  loc: Location | undefined,
  width: number,
  height: number,
  seed: number,
  emotion = "dread",
): ArtSceneSpec {
  return {
    kind: "thumbnail",
    width,
    height,
    seed,
    environment: loc?.environment_type ?? "other",
    interior: false,
    palette: loc?.palette ?? DEFAULT_PALETTE,
    framing: "close-up",
    emotion,
    timeOfDay: "night",
    weather: "embers",
    magicGlow: true,
    characters: chars.map(artCharacter),
    speakerIds: [],
  };
}

export function artSceneForPortrait(c: Character, width: number, height: number): ArtSceneSpec {
  return {
    kind: "portrait",
    width,
    height,
    seed: hashString(c.id),
    environment: "other",
    interior: false,
    palette: { sky: "#3a3d44", ground: "#2a2c31", accent: c.palette.accent },
    framing: "full body",
    emotion: c.archetype === "antagonist" ? "menace" : "calm",
    timeOfDay: "day",
    weather: "none",
    magicGlow: false,
    characters: [artCharacter(c)],
    speakerIds: [],
  };
}

export function artSceneForCard(
  title: string,
  subtitle: string,
  palette: { sky: string; ground: string; accent: string },
  width: number,
  height: number,
): ArtSceneSpec {
  return {
    kind: "card",
    width,
    height,
    seed: hashString(title + subtitle),
    environment: "other",
    interior: false,
    palette,
    framing: "",
    emotion: "",
    timeOfDay: "night",
    weather: "embers",
    magicGlow: true,
    characters: [],
    speakerIds: [],
    title,
    subtitle,
  };
}

// ---------------------------------------------------------------------------
// SVG canvas
// ---------------------------------------------------------------------------

class Canvas {
  defs: string[] = [];
  body: string[] = [];
  private counter = 0;
  private blurCache = new Map<number, string>();
  constructor(
    public W: number,
    public H: number,
  ) {}
  id(prefix: string) {
    return `${prefix}${++this.counter}`;
  }
  linear(stops: [number, string, number?][], x1 = 0, y1 = 0, x2 = 0, y2 = 1): string {
    const id = this.id("lg");
    this.defs.push(
      `<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${stops
        .map(([o, c, a]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a ?? 1}"/>`)
        .join("")}</linearGradient>`,
    );
    return `url(#${id})`;
  }
  radial(stops: [number, string, number?][], cx = 0.5, cy = 0.5, r = 0.5, fx = cx, fy = cy): string {
    const id = this.id("rg");
    this.defs.push(
      `<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="${r}" fx="${fx}" fy="${fy}">${stops
        .map(([o, c, a]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a ?? 1}"/>`)
        .join("")}</radialGradient>`,
    );
    return `url(#${id})`;
  }
  blur(std: number): string {
    const key = Math.round(std);
    const hit = this.blurCache.get(key);
    if (hit) return hit;
    const id = this.id("bl");
    this.defs.push(
      `<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${key}"/></filter>`,
    );
    const ref = `url(#${id})`;
    this.blurCache.set(key, ref);
    return ref;
  }
  add(el: string) {
    this.body.push(el);
  }
  toString() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${this.W}" height="${this.H}" viewBox="0 0 ${this.W} ${this.H}"><defs>${this.defs.join("")}</defs>${this.body.join("")}</svg>`;
  }
}

// ---------------------------------------------------------------------------
// Backgrounds
// ---------------------------------------------------------------------------

function drawSky(cv: Canvas, s: ArtSceneSpec, hy: number, rng: Rng): { lx: number; ly: number } {
  const { W, H } = cv;
  const night = s.timeOfDay === "night";
  const top = darken(s.palette.sky, night ? 0.82 : s.timeOfDay === "dawn" ? 0.35 : 0.5);
  const mid = night ? darken(s.palette.sky, 0.55) : s.palette.sky;
  const horizonMix = s.timeOfDay === "golden" ? 0.55 : s.timeOfDay === "dawn" ? 0.45 : 0.3;
  const hor = night
    ? darken(mix(s.palette.sky, s.palette.accent, 0.3), 0.45)
    : mix(s.palette.sky, s.palette.accent, horizonMix);
  const hr = Math.min(0.98, Math.max(0.1, hy / H));
  cv.add(`<rect width="${W}" height="${H}" fill="${cv.linear([[0, top], [hr * 0.55, mid], [hr, hor], [1, hor]])}"/>`);
  const lx = W * rng.float(0.25, 0.75);
  const ly = hy - H * rng.float(0.08, 0.2);
  const glow = cv.radial([
    [0, lighten(s.palette.accent, night ? 0.3 : 0.6), night ? 0.35 : 0.75],
    [0.4, s.palette.accent, night ? 0.12 : 0.3],
    [1, s.palette.accent, 0],
  ]);
  cv.add(`<circle cx="${n1(lx)}" cy="${n1(ly)}" r="${n1(Math.max(W, H) * 0.55)}" fill="${glow}"/>`);
  if (night) {
    for (let i = 0; i < 40; i++) {
      cv.add(
        `<circle cx="${n1(rng.float(0, W))}" cy="${n1(rng.float(0, hy * 0.7))}" r="${n1(rng.float(0.6, 2.2) * (W / 1080))}" fill="#ffffff" opacity="${n1(rng.float(0.2, 0.7))}"/>`,
      );
    }
    cv.add(`<circle cx="${n1(lx)}" cy="${n1(ly)}" r="${n1(W * 0.045)}" fill="${lighten(s.palette.accent, 0.75)}" opacity="0.85"/>`);
  }
  return { lx, ly };
}

function ridge(W: number, H: number, baseY: number, amp: number, count: number, jag: boolean, rng: Rng): { d: string; peaks: [number, number][] } {
  const step = (W + 80) / count;
  const peaks: [number, number][] = [];
  let d = `M -40 ${n1(H + 10)} L -40 ${n1(baseY)}`;
  for (let i = 0; i <= count; i++) {
    const x = -40 + i * step;
    const y = baseY - amp * (jag ? (i % 2 ? rng.float(0.1, 0.4) : rng.float(0.6, 1)) : rng.float(0.35, 1));
    if (jag) {
      d += ` L ${n1(x)} ${n1(y)}`;
      if (i % 2 === 0) peaks.push([x, y]);
    } else {
      d += ` Q ${n1(x - step / 2)} ${n1(y - amp * 0.35)} ${n1(x)} ${n1(y)}`;
    }
  }
  d += ` L ${n1(W + 40)} ${n1(H + 10)} Z`;
  return { d, peaks };
}

function drawGround(cv: Canvas, s: ArtSceneSpec, hy: number, rng: Rng) {
  const { W, H } = cv;
  const night = s.timeOfDay === "night";
  const g = s.palette.ground;
  const near = darken(g, night ? 0.7 : 0.35);
  const far = night ? darken(mix(g, s.palette.sky, 0.3), 0.5) : mix(g, s.palette.sky, 0.25);
  cv.add(`<rect x="0" y="${n1(hy)}" width="${W}" height="${n1(H - hy)}" fill="${cv.linear([[0, far], [1, near]])}"/>`);
  for (let i = 0; i < 14; i++) {
    const y = rng.float(hy + (H - hy) * 0.1, H);
    cv.add(
      `<ellipse cx="${n1(rng.float(0, W))}" cy="${n1(y)}" rx="${n1(rng.float(W * 0.05, W * 0.2))}" ry="${n1(rng.float(3, 14) * (H / 1920))}" fill="${darken(g, 0.5)}" opacity="${n1(rng.float(0.15, 0.35))}"/>`,
    );
  }
}

function drawEnvironment(cv: Canvas, s: ArtSceneSpec, hy: number, rng: Rng) {
  const { W, H } = cv;
  const night = s.timeOfDay === "night";
  const sky = s.palette.sky;
  const g = s.palette.ground;
  const acc = s.palette.accent;
  const scale = Math.min(W, H) / 1080;
  const farFill = night ? darken(mix(sky, g, 0.4), 0.55) : mix(mix(sky, g, 0.35), "#ffffff", 0.08);
  const midFill = night ? darken(mix(sky, g, 0.7), 0.6) : mix(sky, g, 0.62);
  const env = s.environment;
  const jag = env === "mountain" || env === "volcanic" || env === "cave";

  const far = ridge(W, H, hy - H * 0.05, H * (jag ? 0.22 : 0.08), jag ? 9 : 5, jag, rng);
  cv.add(`<path d="${far.d}" fill="${env === "volcanic" ? darken(sky, 0.6) : farFill}" opacity="0.95"/>`);
  if (env === "mountain") {
    for (const [px, py] of far.peaks) {
      const w = H * 0.05;
      cv.add(
        `<path d="M ${n1(px)} ${n1(py)} L ${n1(px - w)} ${n1(py + w * 1.2)} L ${n1(px - w * 0.3)} ${n1(py + w * 0.9)} L ${n1(px + w * 0.2)} ${n1(py + w * 1.3)} L ${n1(px + w)} ${n1(py + w * 1.1)} Z" fill="#f4f8ff" opacity="${night ? 0.5 : 0.9}"/>`,
      );
    }
  }
  const nearR = ridge(W, H, hy + H * 0.01, H * (jag ? 0.12 : 0.05), jag ? 7 : 4, jag, rng);
  cv.add(`<path d="${nearR.d}" fill="${env === "volcanic" ? "#0d0707" : midFill}"/>`);

  switch (env) {
    case "village": {
      for (let i = 0; i < 5; i++) {
        const depth = rng.float(0.35, 1);
        const x = rng.float(W * 0.05, W * 0.95);
        const y = hy + H * 0.02 * depth + rng.float(-H * 0.01, H * 0.02);
        const rx = W * 0.085 * depth + 20 * scale;
        const ry = rx * 0.78;
        const pumpkin = rng.pick(["#d9822b", "#c96f1f", "#e0a040", "#b8742a"]);
        const fill = cv.radial([[0, lighten(pumpkin, 0.25)], [1, darken(pumpkin, night ? 0.55 : 0.2)]], 0.4, 0.35, 0.7);
        cv.add(`<rect x="${n1(x + rx * 0.35)}" y="${n1(y - ry * 1.35)}" width="${n1(rx * 0.16)}" height="${n1(ry * 0.5)}" fill="#6b625a"/>`);
        cv.add(`<ellipse cx="${n1(x)}" cy="${n1(y - ry * 0.7)}" rx="${n1(rx)}" ry="${n1(ry)}" fill="${fill}"/>`);
        for (let k = -1; k <= 1; k++)
          cv.add(`<ellipse cx="${n1(x + k * rx * 0.45)}" cy="${n1(y - ry * 0.7)}" rx="${n1(rx * 0.32)}" ry="${n1(ry * 0.98)}" fill="none" stroke="${darken(pumpkin, 0.35)}" stroke-width="${n1(2 * scale + 1)}" opacity="0.5"/>`);
        cv.add(`<circle cx="${n1(x)}" cy="${n1(y - ry * 0.35)}" r="${n1(ry * 0.32)}" fill="#4a2e16" stroke="#7a5230" stroke-width="${n1(3 * scale)}"/>`);
        const lit = night || s.timeOfDay === "golden" || s.timeOfDay === "dawn";
        cv.add(`<circle cx="${n1(x - rx * 0.5)}" cy="${n1(y - ry * 0.85)}" r="${n1(ry * 0.14)}" fill="${lit ? "#ffd27a" : "#3a2a1a"}"/>`);
        if (lit) cv.add(`<circle cx="${n1(x - rx * 0.5)}" cy="${n1(y - ry * 0.85)}" r="${n1(ry * 0.4)}" fill="#ffc860" opacity="0.25" filter="${cv.blur(8 * scale)}"/>`);
      }
      for (let i = 0; i < 4; i++) {
        const x = rng.float(0, W);
        const y = hy + rng.float(0, H * 0.04);
        const r = rng.float(40, 80) * scale;
        cv.add(`<rect x="${n1(x - r * 0.08)}" y="${n1(y - r * 1.4)}" width="${n1(r * 0.16)}" height="${n1(r * 1.4)}" fill="#4a3322"/>`);
        const leaf = night ? "#1d3a22" : "#3f7a34";
        for (let k = 0; k < 3; k++)
          cv.add(`<circle cx="${n1(x + (k - 1) * r * 0.5)}" cy="${n1(y - r * 1.6 + (k % 2) * r * 0.2)}" r="${n1(r * 0.7)}" fill="${leaf}"/>`);
        for (let k = 0; k < 5; k++)
          cv.add(`<circle cx="${n1(x + rng.float(-r, r))}" cy="${n1(y - r * rng.float(1.2, 2))}" r="${n1(r * 0.08)}" fill="#d8412f"/>`);
      }
      break;
    }
    case "forest": {
      for (let i = 0; i < 11; i++) {
        const depth = rng.float(0.3, 1);
        const x = rng.float(-W * 0.05, W * 1.05);
        const w = W * 0.05 * depth + 8 * scale;
        const baseY = hy + H * 0.08 * depth;
        const col = darken(mix(g, sky, 0.3 * (1 - depth)), 0.45 + 0.3 * depth);
        const bend = rng.float(-w, w);
        cv.add(
          `<path d="M ${n1(x - w)} ${n1(baseY)} C ${n1(x - w + bend)} ${n1(baseY - H * 0.4)} ${n1(x - w * 0.6 - bend)} ${n1(H * 0.2)} ${n1(x - w * 0.5)} -10 L ${n1(x + w * 0.5)} -10 C ${n1(x + w * 0.6 - bend)} ${n1(H * 0.2)} ${n1(x + w + bend)} ${n1(baseY - H * 0.4)} ${n1(x + w * 1.4)} ${n1(baseY + 6)} Z" fill="${col}"/>`,
        );
        cv.add(`<path d="M ${n1(x - w * 0.8)} ${n1(baseY - H * 0.25)} Q ${n1(x + w)} ${n1(baseY - H * 0.3)} ${n1(x + w * 0.2)} ${n1(baseY - H * 0.42)}" stroke="${darken(col, 0.3)}" stroke-width="${n1(4 * scale)}" fill="none"/>`);
        if (rng.chance(0.7)) {
          const mx = x + rng.float(-w * 2, w * 2);
          const my = baseY + rng.float(0, H * 0.02);
          const mr = rng.float(8, 18) * scale;
          cv.add(`<ellipse cx="${n1(mx)}" cy="${n1(my - mr)}" rx="${n1(mr * 2.5)}" ry="${n1(mr * 1.6)}" fill="${acc}" opacity="0.35" filter="${cv.blur(10 * scale)}"/>`);
          cv.add(`<rect x="${n1(mx - mr * 0.2)}" y="${n1(my - mr)}" width="${n1(mr * 0.4)}" height="${n1(mr)}" fill="${lighten(acc, 0.5)}" opacity="0.8"/>`);
          cv.add(`<ellipse cx="${n1(mx)}" cy="${n1(my - mr)}" rx="${n1(mr)}" ry="${n1(mr * 0.55)}" fill="${lighten(acc, 0.2)}"/>`);
        }
      }
      cv.add(`<rect x="0" y="0" width="${W}" height="${n1(H * 0.12)}" fill="${darken(g, 0.7)}" opacity="0.8" filter="${cv.blur(20 * scale)}"/>`);
      break;
    }
    case "volcanic": {
      const tx = W * rng.float(0.55, 0.75);
      const base = hy + H * 0.01;
      const top = H * 0.1;
      let d = `M ${n1(tx - W * 0.09)} ${n1(base)}`;
      const steps = 10;
      for (let i = 0; i <= steps; i++) {
        const y = base - ((base - top) * i) / steps;
        const w = W * 0.09 * (1 - i / (steps + 2));
        d += ` L ${n1(tx - w - rng.float(0, W * 0.03))} ${n1(y)} L ${n1(tx - w)} ${n1(y - 8 * scale)}`;
      }
      d += ` L ${n1(tx)} ${n1(top - H * 0.04)}`;
      for (let i = steps; i >= 0; i--) {
        const y = base - ((base - top) * i) / steps;
        const w = W * 0.09 * (1 - i / (steps + 2));
        d += ` L ${n1(tx + w)} ${n1(y - 8 * scale)} L ${n1(tx + w + rng.float(0, W * 0.03))} ${n1(y)}`;
      }
      cv.add(`<path d="${d} Z" fill="#070404"/>`);
      cv.add(`<circle cx="${n1(tx)}" cy="${n1(top + H * 0.02)}" r="${n1(W * 0.03)}" fill="${acc}" opacity="0.9" filter="${cv.blur(6 * scale)}"/>`);
      for (let i = 0; i < 3; i++) {
        const y = hy + (H - hy) * rng.float(0.1, 0.6);
        const lava = `M -20 ${n1(y)} Q ${n1(W * 0.3)} ${n1(y - H * 0.03)} ${n1(W * 0.55)} ${n1(y + H * 0.02)} T ${n1(W + 20)} ${n1(y - H * 0.01)}`;
        cv.add(`<path d="${lava}" stroke="${acc}" stroke-width="${n1(28 * scale)}" fill="none" opacity="0.55" filter="${cv.blur(14 * scale)}"/>`);
        cv.add(`<path d="${lava}" stroke="#ffb347" stroke-width="${n1(6 * scale)}" fill="none" opacity="0.9"/>`);
      }
      break;
    }
    case "sanctuary": {
      for (let i = 0; i < 8; i++) {
        const x = rng.float(0, W);
        const w = rng.float(6, 14) * scale;
        cv.add(`<rect x="${n1(x)}" y="${n1(H * 0.02)}" width="${n1(w)}" height="${n1(hy + H * 0.05)}" fill="${lighten(sky, 0.55)}" opacity="${n1(rng.float(0.35, 0.7))}"/>`);
      }
      const wx = W * rng.float(0.15, 0.35);
      cv.add(`<rect x="${n1(wx)}" y="${n1(hy - H * 0.3)}" width="${n1(W * 0.09)}" height="${n1(H * 0.33)}" fill="${cv.linear([[0, "#dfefff", 0.2], [1, "#ffffff", 0.75]])}" filter="${cv.blur(4 * scale)}"/>`);
      cv.add(`<path d="M ${n1(W * 0.45)} ${n1(hy)} Q ${n1(W * 0.7)} ${n1(hy - H * 0.08)} ${n1(W * 0.95)} ${n1(hy)}" stroke="#6b4a2b" stroke-width="${n1(10 * scale)}" fill="none"/>`);
      for (let i = 0; i < 6; i++)
        cv.add(`<circle cx="${n1(rng.float(0, W))}" cy="${n1(rng.float(hy - H * 0.25, hy))}" r="${n1(12 * scale)}" fill="#ffc860" opacity="0.8" filter="${cv.blur(6 * scale)}"/>`);
      break;
    }
    case "cave": {
      const wall = darken(g, 0.6);
      cv.add(`<path d="M 0 0 L ${n1(W * 0.22)} 0 Q ${n1(W * 0.12)} ${n1(H * 0.4)} ${n1(W * 0.2)} ${n1(H)} L 0 ${H} Z" fill="${wall}"/>`);
      cv.add(`<path d="M ${W} 0 L ${n1(W * 0.78)} 0 Q ${n1(W * 0.9)} ${n1(H * 0.45)} ${n1(W * 0.8)} ${n1(H)} L ${W} ${H} Z" fill="${wall}"/>`);
      for (let i = 0; i < 9; i++) {
        const x = rng.float(0, W);
        const len = rng.float(H * 0.05, H * 0.18);
        cv.add(`<path d="M ${n1(x - 18 * scale)} 0 L ${n1(x)} ${n1(len)} L ${n1(x + 18 * scale)} 0 Z" fill="${darken(g, 0.4)}"/>`);
      }
      cv.add(`<path d="M ${n1(W * 0.4)} 0 L ${n1(W * 0.6)} 0 L ${n1(W * 0.72)} ${n1(H)} L ${n1(W * 0.3)} ${n1(H)} Z" fill="#ffffff" opacity="0.07" filter="${cv.blur(18 * scale)}"/>`);
      cv.add(`<ellipse cx="${n1(W * 0.5)}" cy="${n1(hy + (H - hy) * 0.45)}" rx="${n1(W * 0.35)}" ry="${n1(H * 0.04)}" fill="#050807" stroke="${acc}" stroke-opacity="0.3"/>`);
      break;
    }
    default: {
      if (env === "river" || env === "plains" || env === "other") {
        cv.add(`<path d="M -20 ${n1(hy + H * 0.06)} Q ${n1(W * 0.4)} ${n1(hy + H * 0.02)} ${n1(W + 20)} ${n1(hy + H * 0.08)} L ${n1(W + 20)} ${n1(hy + H * 0.11)} Q ${n1(W * 0.4)} ${n1(hy + H * 0.06)} -20 ${n1(hy + H * 0.1)} Z" fill="${lighten(sky, 0.2)}" opacity="${env === "river" ? 0.7 : 0.25}"/>`);
      }
      if (env === "castle") {
        for (let i = 0; i < 3; i++) {
          const x = W * (0.3 + i * 0.2);
          const h = H * rng.float(0.15, 0.3);
          cv.add(`<rect x="${n1(x)}" y="${n1(hy - h)}" width="${n1(W * 0.07)}" height="${n1(h)}" fill="${darken(midFill, 0.3)}"/>`);
        }
      }
    }
  }
}

function drawInterior(cv: Canvas, s: ArtSceneSpec, rng: Rng) {
  const { W, H } = cv;
  const scale = Math.min(W, H) / 1080;
  const volcanic = s.environment === "volcanic";
  const wallBase = volcanic ? "#1a0b09" : s.environment === "cave" ? "#1c201c" : "#5a3b24";
  cv.add(`<rect width="${W}" height="${H}" fill="${cv.linear([[0, darken(wallBase, 0.5)], [0.7, wallBase], [1, darken(wallBase, 0.3)]])}"/>`);
  const floorY = H * 0.74;
  cv.add(`<rect x="0" y="${n1(floorY)}" width="${W}" height="${n1(H - floorY)}" fill="${darken(wallBase, 0.45)}"/>`);
  for (let i = 0; i < 6; i++)
    cv.add(`<line x1="0" y1="${n1(floorY + (H - floorY) * (i / 6))}" x2="${W}" y2="${n1(floorY + (H - floorY) * (i / 6))}" stroke="${darken(wallBase, 0.65)}" stroke-width="${n1(2 * scale)}"/>`);
  if (volcanic) {
    for (let i = 0; i < 6; i++) {
      const x = rng.float(0, W);
      cv.add(`<path d="M ${n1(x)} ${n1(rng.float(0, floorY))} l ${n1(rng.float(-60, 60) * scale)} ${n1(90 * scale)} l ${n1(rng.float(-40, 40) * scale)} ${n1(80 * scale)}" stroke="${s.palette.accent}" stroke-width="${n1(4 * scale)}" fill="none" opacity="0.7" filter="${cv.blur(3 * scale)}"/>`);
    }
    cv.add(`<ellipse cx="${n1(W / 2)}" cy="${n1(H)}" rx="${n1(W * 0.8)}" ry="${n1(H * 0.25)}" fill="${s.palette.accent}" opacity="0.35" filter="${cv.blur(40 * scale)}"/>`);
    return;
  }
  const wx = W * rng.float(0.2, 0.35);
  const wy = H * 0.3;
  const wr = Math.min(W, H) * 0.13;
  cv.add(`<circle cx="${n1(wx)}" cy="${n1(wy)}" r="${n1(wr * 1.15)}" fill="#3a2414"/>`);
  cv.add(`<circle cx="${n1(wx)}" cy="${n1(wy)}" r="${n1(wr)}" fill="${s.timeOfDay === "night" ? "#18223a" : lighten(s.palette.sky, 0.2)}"/>`);
  cv.add(`<line x1="${n1(wx - wr)}" y1="${n1(wy)}" x2="${n1(wx + wr)}" y2="${n1(wy)}" stroke="#3a2414" stroke-width="${n1(8 * scale)}"/><line x1="${n1(wx)}" y1="${n1(wy - wr)}" x2="${n1(wx)}" y2="${n1(wy + wr)}" stroke="#3a2414" stroke-width="${n1(8 * scale)}"/>`);
  const hx = W * 0.78;
  const hw = W * 0.2;
  cv.add(`<path d="M ${n1(hx - hw / 2)} ${n1(floorY)} L ${n1(hx - hw / 2)} ${n1(floorY - H * 0.14)} Q ${n1(hx)} ${n1(floorY - H * 0.22)} ${n1(hx + hw / 2)} ${n1(floorY - H * 0.14)} L ${n1(hx + hw / 2)} ${n1(floorY)} Z" fill="#1a0f08" stroke="#6b625a" stroke-width="${n1(10 * scale)}"/>`);
  cv.add(`<ellipse cx="${n1(hx)}" cy="${n1(floorY - H * 0.03)}" rx="${n1(hw * 0.35)}" ry="${n1(H * 0.04)}" fill="#ff9a3a" opacity="0.95" filter="${cv.blur(6 * scale)}"/>`);
  cv.add(`<circle cx="${n1(hx)}" cy="${n1(floorY - H * 0.05)}" r="${n1(W * 0.45)}" fill="#ff8a2a" opacity="0.18" filter="${cv.blur(40 * scale)}"/>`);
  for (let row = 0; row < 2; row++) {
    const y = H * (0.18 + row * 0.12);
    const x0 = W * 0.48;
    cv.add(`<rect x="${n1(x0)}" y="${n1(y)}" width="${n1(W * 0.22)}" height="${n1(8 * scale)}" fill="#3a2414"/>`);
    for (let j = 0; j < 4; j++) {
      const jc = rng.pick(["#b8342a", "#e0a040", "#6b8a3a", "#8a3a6b"]);
      cv.add(`<rect x="${n1(x0 + j * W * 0.05 + 6 * scale)}" y="${n1(y - 40 * scale)}" width="${n1(28 * scale)}" height="${n1(40 * scale)}" rx="${n1(6 * scale)}" fill="${jc}" opacity="0.85"/>`);
    }
  }
}

function drawAtmosphere(cv: Canvas, s: ArtSceneSpec, hy: number, light: { lx: number; ly: number }, rng: Rng) {
  const { W, H } = cv;
  const scale = Math.min(W, H) / 1080;
  if (!s.interior) {
    for (let i = 0; i < 4; i++) {
      const spread = rng.float(0.08, 0.2) * W;
      const ex = light.lx + rng.float(-W * 0.6, W * 0.6);
      cv.add(
        `<path d="M ${n1(light.lx - 10)} ${n1(light.ly)} L ${n1(light.lx + 10)} ${n1(light.ly)} L ${n1(ex + spread)} ${n1(H)} L ${n1(ex - spread)} ${n1(H)} Z" fill="${lighten(s.palette.accent, 0.6)}" opacity="${n1(rng.float(0.03, 0.07))}" filter="${cv.blur(16 * scale)}"/>`,
      );
    }
  }
  const fogCol = s.timeOfDay === "night" ? lighten(s.palette.sky, 0.25) : lighten(s.palette.sky, 0.55);
  for (let i = 0; i < 3; i++) {
    cv.add(
      `<ellipse cx="${n1(rng.float(0, W))}" cy="${n1(hy + rng.float(-H * 0.03, H * 0.05))}" rx="${n1(W * rng.float(0.4, 0.7))}" ry="${n1(H * rng.float(0.03, 0.06))}" fill="${fogCol}" opacity="${n1(rng.float(0.12, 0.25))}" filter="${cv.blur(24 * scale)}"/>`,
    );
  }
}

function drawWeather(cv: Canvas, s: ArtSceneSpec, rng: Rng) {
  const { W, H } = cv;
  const scale = Math.min(W, H) / 1080;
  if (s.weather === "rain") {
    for (let i = 0; i < 140; i++) {
      const x = rng.float(-W * 0.1, W * 1.1);
      const y = rng.float(0, H);
      const len = rng.float(30, 70) * scale;
      cv.add(`<line x1="${n1(x)}" y1="${n1(y)}" x2="${n1(x - len * 0.25)}" y2="${n1(y + len)}" stroke="#cfe2ff" stroke-width="${n1(1.6 * scale)}" opacity="${n1(rng.float(0.15, 0.4))}"/>`);
    }
  } else if (s.weather === "snow") {
    for (let i = 0; i < 120; i++)
      cv.add(`<circle cx="${n1(rng.float(0, W))}" cy="${n1(rng.float(0, H))}" r="${n1(rng.float(1.5, 5) * scale)}" fill="#ffffff" opacity="${n1(rng.float(0.4, 0.9))}"/>`);
  } else if (s.weather === "embers") {
    for (let i = 0; i < 50; i++)
      cv.add(`<circle cx="${n1(rng.float(0, W))}" cy="${n1(rng.float(0, H))}" r="${n1(rng.float(2, 5) * scale)}" fill="${rng.pick(["#ff7a2a", "#ffb347", s.palette.accent])}" opacity="${n1(rng.float(0.5, 0.95))}"/>`);
  } else if (s.weather === "spores") {
    for (let i = 0; i < 40; i++)
      cv.add(`<circle cx="${n1(rng.float(0, W))}" cy="${n1(rng.float(H * 0.2, H))}" r="${n1(rng.float(2, 4) * scale)}" fill="${lighten(s.palette.accent, 0.3)}" opacity="${n1(rng.float(0.3, 0.8))}"/>`);
  }
}

function drawFinishing(cv: Canvas, s: ArtSceneSpec) {
  const { W, H } = cv;
  cv.add(`<rect width="${W}" height="${H}" fill="${cv.radial([[0.55, "#000000", 0], [1, "#000000", 0.72]], 0.5, 0.48, 0.75)}"/>`);
  const grain = cv.id("grain");
  cv.defs.push(
    `<filter id="${grain}" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="1" seed="${s.seed % 997}"/><feColorMatrix type="saturate" values="0"/></filter>`,
  );
  cv.add(`<rect width="${W}" height="${H}" filter="url(#${grain})" opacity="0.07"/>`);
}

// ---------------------------------------------------------------------------
// Characters
// ---------------------------------------------------------------------------

interface Placement {
  c: ArtCharacter;
  x: number;
  groundY: number;
  h: number;
  facing: number;
  back?: boolean;
  blur?: number;
  dim?: number;
}

function framingClass(framing: string): string {
  const f = framing.toLowerCase();
  if (/extreme close/.test(f)) return "ecu";
  if (/medium close/.test(f)) return "mcu";
  if (/close-?up|close up/.test(f)) return "cu";
  if (/over-the-shoulder|over the shoulder|\bots\b/.test(f)) return "ots";
  if (/insert/.test(f)) return "insert";
  if (/extreme wide|establishing/.test(f)) return "ewide";
  if (/medium wide|full shot|full body/.test(f)) return "mwide";
  if (/high-angle|high angle|bird/.test(f)) return "high";
  if (/wide/.test(f)) return "wide";
  if (/hero|low-angle|low angle/.test(f)) return "hero";
  return "medium";
}

function horizonFor(fc: string, H: number): number {
  const table: Record<string, number> = {
    ecu: 0.6, cu: 0.6, mcu: 0.62, ots: 0.64, insert: 0.62, ewide: 0.6, mwide: 0.68, high: 0.4, wide: 0.66, hero: 0.8, medium: 0.68,
  };
  return H * (table[fc] ?? 0.66);
}

const HEAD_RATIO = 0.19;

function layoutCharacters(s: ArtSceneSpec): Placement[] {
  const { width: W, height: H } = s;
  const vertical = H >= W;
  const chars = s.characters;
  if (!chars.length) return [];
  const U = Math.min(W, H);
  const fc = s.kind === "portrait" ? "portrait" : s.kind === "thumbnail" ? "thumb" : framingClass(s.framing);
  const byHead = (c: ArtCharacter, x: number, r: number, headCy: number, extra: Partial<Placement> = {}): Placement => {
    const h = r / HEAD_RATIO;
    return { c, x, h, groundY: headCy + h - r, facing: 0, ...extra };
  };
  const spread = (n: number, span: number) => Array.from({ length: n }, (_, i) => W / 2 + (i - (n - 1) / 2) * span);

  if (fc === "portrait") return [{ c: chars[0], x: W / 2, groundY: H * 0.92, h: H * 0.8 * Math.min(1, 1 / chars[0].heightFactor), facing: 0 }];
  if (fc === "thumb") {
    if (chars.length === 1) return [byHead(chars[0], W / 2, U * 0.36, vertical ? H * 0.6 : H * 0.55)];
    const villain = chars.find((c) => c.archetype === "antagonist" || c.archetype === "creature");
    const others = chars.filter((c) => c !== villain);
    const list: Placement[] = [];
    if (villain) list.push(byHead(villain, vertical ? W * 0.62 : W * 0.72, U * 0.42, vertical ? H * 0.5 : H * 0.4, { dim: 0.15 }));
    others.slice(0, villain ? 2 : 3).forEach((c, i, arr) => {
      const x = vertical ? W * (0.32 + i * 0.36) : W * (0.45 + i * 0.22);
      list.push(byHead(c, arr.length === 1 && !villain ? W / 2 : x, U * (villain ? 0.26 : 0.3), vertical ? H * 0.74 : H * 0.62, { facing: 1 }));
    });
    return list;
  }
  if (fc === "insert") return [];
  if (fc === "ecu") return [byHead(chars[0], W / 2, U * 0.62, H * 0.5)];
  if (fc === "cu") {
    const cs = chars.slice(0, vertical ? 1 : 2);
    return cs.map((c, i) => byHead(c, cs.length === 1 ? W / 2 : W * (0.33 + i * 0.34), U * (cs.length === 1 ? 0.36 : 0.3), H * 0.44, { facing: cs.length === 1 ? 0 : i === 0 ? 1 : -1 }));
  }
  if (fc === "mcu") {
    const cs = chars.slice(0, 2);
    const xs = cs.length === 1 ? [W / 2] : [W * 0.3, W * 0.72];
    return cs.map((c, i) => byHead(c, xs[i], U * (vertical ? 0.26 : 0.22) * Math.min(1.15, c.heightFactor), H * 0.38, { facing: cs.length === 1 ? 0 : i === 0 ? 1 : -1 }));
  }
  if (fc === "ots") {
    const fg = chars.length > 1 ? chars[chars.length - 1] : null;
    const bg = chars.length > 1 ? chars.slice(0, -1) : chars;
    const list: Placement[] = bg.slice(0, 2).map((c, i) => ({
      c,
      x: W * (0.6 + i * 0.18),
      groundY: H * 1.0,
      h: H * (vertical ? 0.55 : 0.75) * Math.min(1.25, c.heightFactor),
      facing: -1,
    }));
    if (fg) list.push({ c: fg, x: W * 0.14, groundY: H * 1.4, h: H * 1.05, facing: 1, back: true, blur: 6 * (U / 1080), dim: 0.45 });
    return list;
  }
  const table: Record<string, { h: number; g: number; span: number }> = {
    ewide: { h: vertical ? 0.1 : 0.16, g: 0.8, span: 0.1 },
    wide: { h: vertical ? 0.26 : 0.36, g: 0.87, span: 0.24 },
    mwide: { h: vertical ? 0.42 : 0.58, g: 0.93, span: 0.3 },
    high: { h: vertical ? 0.2 : 0.3, g: 0.74, span: 0.2 },
    hero: { h: vertical ? 0.66 : 0.85, g: 1.06, span: 0.4 },
    medium: { h: vertical ? 0.6 : 0.8, g: 1.02, span: 0.36 },
  };
  const t = table[fc] ?? table.medium;
  const cs = chars.slice(0, fc === "ewide" || fc === "wide" ? 6 : 3);
  const span = W * (vertical ? t.span * 1.25 : t.span * 0.7);
  const xs = spread(cs.length, Math.min(span, (W * 0.9) / Math.max(1, cs.length - 1 || 1)));
  return cs.map((c, i) => {
    let h = H * t.h * c.heightFactor;
    const groundY = H * t.g;
    const maxH = groundY - H * 0.03;
    if (h > maxH && (fc === "medium" || fc === "hero")) h = Math.max(H * t.h, maxH);
    const facing = cs.length === 1 ? 0 : xs[i] < W / 2 - 1 ? 1 : xs[i] > W / 2 + 1 ? -1 : 0;
    return { c, x: xs[i], groundY, h, facing };
  });
}

function fruitHeadPath(shape: FruitShape, cx: number, cy: number, r: number, rng: Rng): string {
  const P = (x: number, y: number) => `${n1(cx + x * r)} ${n1(cy + y * r)}`;
  switch (shape) {
    case "apple":
      return `M ${P(0, -0.78)} C ${P(0.35, -1.05)} ${P(1.05, -0.95)} ${P(1.0, -0.1)} C ${P(0.98, 0.75)} ${P(0.45, 1.0)} ${P(0, 0.92)} C ${P(-0.45, 1.0)} ${P(-0.98, 0.75)} ${P(-1.0, -0.1)} C ${P(-1.05, -0.95)} ${P(-0.35, -1.05)} ${P(0, -0.78)} Z`;
    case "pear":
      return `M ${P(0, -1.18)} C ${P(0.32, -1.18)} ${P(0.42, -0.6)} ${P(0.55, -0.3)} C ${P(1.02, 0.1)} ${P(0.96, 0.98)} ${P(0, 0.98)} C ${P(-0.96, 0.98)} ${P(-1.02, 0.1)} ${P(-0.55, -0.3)} C ${P(-0.42, -0.6)} ${P(-0.32, -1.18)} ${P(0, -1.18)} Z`;
    case "lemon":
      return `M ${P(0, -1.22)} C ${P(0.3, -1.05)} ${P(0.92, -0.75)} ${P(0.9, 0)} C ${P(0.92, 0.75)} ${P(0.3, 1.05)} ${P(0, 1.22)} C ${P(-0.3, 1.05)} ${P(-0.92, 0.75)} ${P(-0.9, 0)} C ${P(-0.92, -0.75)} ${P(-0.3, -1.05)} ${P(0, -1.22)} Z`;
    case "strawberry":
      return `M ${P(0, -0.8)} C ${P(0.6, -0.95)} ${P(1.05, -0.6)} ${P(0.95, 0)} C ${P(0.8, 0.6)} ${P(0.3, 1.1)} ${P(0, 1.15)} C ${P(-0.3, 1.1)} ${P(-0.8, 0.6)} ${P(-0.95, 0)} C ${P(-1.05, -0.6)} ${P(-0.6, -0.95)} ${P(0, -0.8)} Z`;
    case "pineapple":
      return `M ${P(0, -1.2)} C ${P(0.7, -1.2)} ${P(0.9, -0.5)} ${P(0.88, 0.1)} C ${P(0.86, 0.8)} ${P(0.5, 1.15)} ${P(0, 1.15)} C ${P(-0.5, 1.15)} ${P(-0.86, 0.8)} ${P(-0.88, 0.1)} C ${P(-0.9, -0.5)} ${P(-0.7, -1.2)} ${P(0, -1.2)} Z`;
    case "dragon":
      return `M ${P(0, -1.05)} C ${P(0.62, -1.05)} ${P(0.95, -0.55)} ${P(0.92, 0.05)} C ${P(0.9, 0.7)} ${P(0.5, 1.05)} ${P(0, 1.05)} C ${P(-0.5, 1.05)} ${P(-0.9, 0.7)} ${P(-0.92, 0.05)} C ${P(-0.95, -0.55)} ${P(-0.62, -1.05)} ${P(0, -1.05)} Z`;
    case "wrinkled": {
      const pts: string[] = [];
      const phase = rng.float(0, Math.PI * 2);
      for (let i = 0; i <= 40; i++) {
        const a = (i / 40) * Math.PI * 2;
        const rr = 1 + 0.06 * Math.sin(a * 7 + phase) + 0.035 * Math.sin(a * 13 + phase * 2);
        pts.push(`${i === 0 ? "M" : "L"} ${P(Math.cos(a) * rr, Math.sin(a) * rr * 0.96)}`);
      }
      return pts.join(" ") + " Z";
    }
    case "coconut":
      return `M ${P(0, -1)} C ${P(0.6, -1.02)} ${P(1.02, -0.55)} ${P(1.0, 0.05)} C ${P(0.98, 0.65)} ${P(0.55, 1.0)} ${P(0, 1.0)} C ${P(-0.55, 1.0)} ${P(-0.98, 0.65)} ${P(-1.0, 0.05)} C ${P(-1.02, -0.55)} ${P(-0.6, -1.02)} ${P(0, -1)} Z`;
    default:
      return `M ${P(-1, 0)} A ${n1(r)} ${n1(r)} 0 1 0 ${P(1, 0)} A ${n1(r)} ${n1(r)} 0 1 0 ${P(-1, 0)} Z`;
  }
}

function drawHead(cv: Canvas, p: Placement, cx: number, cy: number, r: number, expr: ExpressionSpec, speaking: boolean, rng: Rng) {
  const art = fruitArt(p.c.fruit);
  const C = (col: string) => (p.dim ? darken(col, p.dim) : col);
  const f = p.c.features;
  const g: string[] = [];

  // Head silhouette & shading
  const d = fruitHeadPath(art.shape, cx, cy, r, rng);
  const fill = cv.radial([[0, C(art.light)], [0.38, C(art.mid)], [1, C(art.base)]], 0.4, 0.38, 0.72, 0.33, 0.28);
  g.push(`<path d="${d}" fill="${fill}"/>`);
  g.push(`<path d="${d}" fill="none" stroke="${C(lighten(p.c.palette.accent, 0.4))}" stroke-width="${n1(r * 0.04)}" opacity="0.35" transform="translate(${n1(r * 0.025)} 0)"/>`);

  // Surface texture
  const inside = (count: number, cb: (x: number, y: number) => string) => {
    for (let i = 0; i < count; i++) {
      const a = rng.float(0, Math.PI * 2);
      const rr = Math.sqrt(rng.float(0, 1)) * 0.85;
      g.push(cb(cx + Math.cos(a) * rr * r, cy + Math.sin(a) * rr * r));
    }
  };
  switch (art.shape) {
    case "apple":
      inside(16, (x, y) => `<circle cx="${n1(x)}" cy="${n1(y)}" r="${n1(r * 0.018)}" fill="${C(art.detail)}" opacity="0.5"/>`);
      if (f.includes("bruise"))
        g.push(`<ellipse cx="${n1(cx - r * 0.55)}" cy="${n1(cy + r * 0.25)}" rx="${n1(r * 0.16)}" ry="${n1(r * 0.12)}" fill="${C("#5a2a14")}" opacity="0.35" filter="${cv.blur(r * 0.04)}"/>`);
      break;
    case "orange":
    case "lemon":
      inside(70, (x, y) => `<circle cx="${n1(x)}" cy="${n1(y)}" r="${n1(r * 0.012)}" fill="${C(art.detail)}" opacity="0.35"/>`);
      break;
    case "pear":
      for (let i = 0; i < 3; i++)
        g.push(`<ellipse cx="${n1(cx + rng.float(-0.5, 0.5) * r)}" cy="${n1(cy + rng.float(0, 0.6) * r)}" rx="${n1(r * rng.float(0.12, 0.22))}" ry="${n1(r * rng.float(0.08, 0.15))}" fill="${C(art.detail)}" opacity="0.3" filter="${cv.blur(r * 0.05)}"/>`);
      break;
    case "coconut":
      for (let i = 0; i < 70; i++) {
        const a = rng.float(0, Math.PI * 2);
        const rr = rng.float(0.2, 0.98);
        const x = cx + Math.cos(a) * rr * r;
        const y = cy + Math.sin(a) * rr * r;
        const len = rng.float(0.06, 0.16) * r;
        const ang = a + rng.float(-0.6, 0.6);
        g.push(`<line x1="${n1(x)}" y1="${n1(y)}" x2="${n1(x + Math.cos(ang) * len)}" y2="${n1(y + Math.sin(ang) * len)}" stroke="${C(rng.chance(0.5) ? art.light : art.detail)}" stroke-width="${n1(r * 0.012)}" opacity="0.6"/>`);
      }
      for (let i = -1; i <= 1; i++) g.push(`<ellipse cx="${n1(cx + i * r * 0.14)}" cy="${n1(cy - r * 0.72 + Math.abs(i) * r * 0.05)}" rx="${n1(r * 0.05)}" ry="${n1(r * 0.06)}" fill="${C("#1a0f06")}"/>`);
      g.push(`<path d="M ${n1(cx - r * 0.45)} ${n1(cy - r * 0.8)} l ${n1(r * 0.15)} ${n1(r * 0.08)} l ${n1(r * 0.1)} ${n1(-r * 0.1)} l ${n1(r * 0.14)} ${n1(r * 0.07)}" stroke="${C("#140a04")}" stroke-width="${n1(r * 0.025)}" fill="none"/>`);
      break;
    case "pomegranate":
      inside(20, (x, y) => `<circle cx="${n1(x)}" cy="${n1(y)}" r="${n1(r * 0.02)}" fill="${C(art.light)}" opacity="0.25"/>`);
      break;
    case "wrinkled":
      for (let i = 0; i < 10; i++) {
        const x = cx + rng.float(-0.7, 0.7) * r;
        const y = cy + rng.float(-0.7, 0.7) * r;
        g.push(`<path d="M ${n1(x)} ${n1(y)} q ${n1(r * 0.12)} ${n1(-r * 0.08)} ${n1(r * 0.25)} ${n1(r * 0.02)}" stroke="${C(darken(art.base, 0.4))}" stroke-width="${n1(r * 0.02)}" fill="none" opacity="0.7"/>`);
      }
      for (let i = 0; i < 4; i++)
        g.push(`<ellipse cx="${n1(cx + rng.float(-0.6, 0.6) * r)}" cy="${n1(cy + rng.float(-0.6, 0.6) * r)}" rx="${n1(r * 0.14)}" ry="${n1(r * 0.1)}" fill="${C(art.detail)}" opacity="0.35" filter="${cv.blur(r * 0.05)}"/>`);
      break;
    case "dragon":
      for (let i = 0; i < 6; i++) {
        const x = cx + rng.float(-0.6, 0.6) * r;
        const y = cy + rng.float(-0.5, 0.7) * r;
        const crack = `M ${n1(x)} ${n1(y)} l ${n1(r * 0.08)} ${n1(r * 0.1)} l ${n1(-r * 0.04)} ${n1(r * 0.12)} l ${n1(r * 0.07)} ${n1(r * 0.1)}`;
        g.push(`<path d="${crack}" stroke="${art.detail}" stroke-width="${n1(r * 0.05)}" fill="none" opacity="0.6" filter="${cv.blur(r * 0.03)}"/>`);
        g.push(`<path d="${crack}" stroke="#ffcf6a" stroke-width="${n1(r * 0.015)}" fill="none"/>`);
      }
      break;
    case "strawberry":
      inside(30, (x, y) => `<ellipse cx="${n1(x)}" cy="${n1(y)}" rx="${n1(r * 0.02)}" ry="${n1(r * 0.03)}" fill="${C(art.detail)}"/>`);
      break;
    case "pineapple":
      for (let i = -3; i <= 3; i++) {
        g.push(`<line x1="${n1(cx + i * r * 0.28 - r * 0.5)}" y1="${n1(cy - r)}" x2="${n1(cx + i * r * 0.28 + r * 0.5)}" y2="${n1(cy + r)}" stroke="${C(art.detail)}" stroke-width="${n1(r * 0.02)}" opacity="0.5"/>`);
        g.push(`<line x1="${n1(cx + i * r * 0.28 + r * 0.5)}" y1="${n1(cy - r)}" x2="${n1(cx + i * r * 0.28 - r * 0.5)}" y2="${n1(cy + r)}" stroke="${C(art.detail)}" stroke-width="${n1(r * 0.02)}" opacity="0.5"/>`);
      }
      break;
    case "melon":
      for (let i = -2; i <= 2; i++)
        g.push(`<path d="M ${n1(cx + i * r * 0.35)} ${n1(cy - r * 0.95)} Q ${n1(cx + i * r * 0.5)} ${n1(cy)} ${n1(cx + i * r * 0.35)} ${n1(cy + r * 0.95)}" stroke="${C(art.detail)}" stroke-width="${n1(r * 0.1)}" fill="none" opacity="0.7"/>`);
      break;
  }

  // Tops: stems, leaves, calyx, crowns, flame scales
  const leafAngle = expr.brows === "worried" ? 40 : expr.mouth === "grin" || expr.mouth === "smile" ? -30 : 0;
  const leaf = (x: number, y: number, rot: number, len = 0.24) =>
    `<ellipse cx="${n1(x)}" cy="${n1(y)}" rx="${n1(r * len)}" ry="${n1(r * len * 0.42)}" fill="${C("#4f8a2a")}" transform="rotate(${rot} ${n1(x)} ${n1(y)})"/>`;
  const top: string[] = [];
  const behind: string[] = [];
  if (art.shape === "apple") {
    top.push(`<path d="M ${n1(cx)} ${n1(cy - r * 0.78)} q ${n1(r * 0.02)} ${n1(-r * 0.2)} ${n1(r * 0.1)} ${n1(-r * 0.32)}" stroke="${C("#5a3a1a")}" stroke-width="${n1(r * 0.07)}" fill="none" stroke-linecap="round"/>`);
    top.push(leaf(cx + r * 0.3, cy - r * 1.02, -20 + leafAngle));
  } else if (art.shape === "pear") {
    top.push(`<path d="M ${n1(cx)} ${n1(cy - r * 1.16)} q ${n1(-r * 0.05)} ${n1(-r * 0.18)} ${n1(r * 0.08)} ${n1(-r * 0.28)}" stroke="${C("#3a2410")}" stroke-width="${n1(r * 0.06)}" fill="none" stroke-linecap="round"/>`);
  } else if (art.shape === "orange") {
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      top.push(`<line x1="${n1(cx)}" y1="${n1(cy - r * 0.97)}" x2="${n1(cx + Math.cos(a) * r * 0.09)}" y2="${n1(cy - r * 0.97 + Math.sin(a) * r * 0.05)}" stroke="${C("#3f6a22")}" stroke-width="${n1(r * 0.04)}"/>`);
    }
    top.push(leaf(cx + r * 0.22, cy - r * 1.05, -25 + leafAngle, 0.22));
  } else if (art.shape === "pomegranate" || p.c.features.includes("crown-calyx")) {
    let dd = `M ${n1(cx - r * 0.28)} ${n1(cy - r * 0.9)}`;
    for (let k = 0; k < 6; k++) {
      const x0 = cx - r * 0.28 + (k * r * 0.56) / 6;
      dd += ` L ${n1(x0 + r * 0.047)} ${n1(cy - r * 1.18)} L ${n1(x0 + r * 0.093)} ${n1(cy - r * 0.95)}`;
    }
    top.push(`<path d="${dd} L ${n1(cx + r * 0.28)} ${n1(cy - r * 0.86)} Z" fill="${C(art.detail)}"/>`);
  } else if (art.shape === "strawberry" || art.shape === "pineapple") {
    for (let k = -3; k <= 3; k++)
      top.push(`<path d="M ${n1(cx)} ${n1(cy - r * 0.95)} L ${n1(cx + k * r * 0.12)} ${n1(cy - r * (art.shape === "pineapple" ? 1.6 : 1.15) + Math.abs(k) * r * 0.1)} L ${n1(cx + k * r * 0.12 + r * 0.06)} ${n1(cy - r * 0.95)} Z" fill="${C("#3f7a2a")}"/>`);
  } else if (art.shape === "dragon") {
    for (let k = 0; k < 9; k++) {
      const a = Math.PI + (k / 8) * Math.PI;
      const bx = cx + Math.cos(a) * r * 0.88;
      const by = cy + Math.sin(a) * r * 0.95;
      const tx = cx + Math.cos(a) * r * 1.35;
      const ty = cy + Math.sin(a) * r * 1.4 - r * 0.15;
      behind.push(`<path d="M ${n1(bx - r * 0.12)} ${n1(by)} Q ${n1((bx + tx) / 2)} ${n1(by - r * 0.1)} ${n1(tx)} ${n1(ty)} Q ${n1((bx + tx) / 2 + r * 0.1)} ${n1(by)} ${n1(bx + r * 0.12)} ${n1(by)} Z" fill="${cv.linear([[0, C("#2a171c")], [1, "#ff5a1f"]], 0, 1, 0, 0)}"/>`);
    }
  }
  if (p.c.features.includes("leaf-ears")) {
    behind.push(leaf(cx - r * 0.95, cy - r * 0.15, 200 + (leafAngle > 0 ? 15 : -10), 0.42));
    behind.push(leaf(cx + r * 0.95, cy - r * 0.15, -20 - (leafAngle > 0 ? 15 : -10), 0.42));
  }
  cv.add(`<g>${behind.join("")}${g.join("")}${top.join("")}</g>`);

  if (p.back) return;

  // Face
  const fy = cy + (art.shape === "pear" ? r * 0.3 : r * 0.06);
  const fx = cx + p.facing * r * 0.08;
  const creature = p.c.archetype === "creature" || p.c.features.includes("hunched");
  const face: string[] = [];
  if (p.c.features.includes("single-eye")) {
    const ry = r * 0.34 * Math.max(0.45, expr.eyes);
    face.push(`<ellipse cx="${n1(fx)}" cy="${n1(fy - r * 0.05)}" rx="${n1(r * 0.3)}" ry="${n1(ry * 1.4)}" fill="#ff7a1a" opacity="0.55" filter="${cv.blur(r * 0.08)}"/>`);
    face.push(`<ellipse cx="${n1(fx)}" cy="${n1(fy - r * 0.05)}" rx="${n1(r * 0.15)}" ry="${n1(ry)}" fill="${cv.radial([[0, "#fff4b0"], [0.6, "#ffb000"], [1, "#ff5a00"]])}"/>`);
    face.push(`<ellipse cx="${n1(fx)}" cy="${n1(fy - r * 0.05)}" rx="${n1(r * 0.03)}" ry="${n1(ry * 0.85)}" fill="#120404"/>`);
    if (speaking) face.push(`<path d="M ${n1(fx - r * 0.3)} ${n1(fy + r * 0.45)} l ${n1(r * 0.12)} ${n1(-r * 0.05)} l ${n1(r * 0.12)} ${n1(r * 0.06)} l ${n1(r * 0.12)} ${n1(-r * 0.06)} l ${n1(r * 0.12)} ${n1(r * 0.05)}" stroke="#ff8a2a" stroke-width="${n1(r * 0.05)}" fill="none" filter="${cv.blur(r * 0.02)}"/>`);
  } else {
    const es = r * (creature ? 0.42 : 0.36);
    const erx = r * (creature ? 0.27 : 0.17);
    for (const side of [-1, 1]) {
      const ex = fx + side * es;
      const ey = fy - r * 0.08;
      const ery = erx * 1.12 * Math.max(0.35, expr.eyes);
      if (expr.closed) {
        face.push(`<path d="M ${n1(ex - erx)} ${n1(ey)} Q ${n1(ex)} ${n1(ey + erx * 0.6)} ${n1(ex + erx)} ${n1(ey)}" stroke="${C(darken(art.base, 0.6))}" stroke-width="${n1(r * 0.04)}" fill="none" stroke-linecap="round"/>`);
      } else {
        const clip = cv.id("eye");
        cv.defs.push(`<clipPath id="${clip}"><ellipse cx="${n1(ex)}" cy="${n1(ey)}" rx="${n1(erx)}" ry="${n1(ery)}"/></clipPath>`);
        face.push(`<ellipse cx="${n1(ex)}" cy="${n1(ey)}" rx="${n1(erx)}" ry="${n1(ery)}" fill="${creature ? "#e8f2d8" : "#f7f3ea"}" stroke="${C(darken(art.base, 0.5))}" stroke-width="${n1(r * 0.02)}"/>`);
        const ix = ex + p.facing * erx * 0.28;
        face.push(`<g clip-path="url(#${clip})"><circle cx="${n1(ix)}" cy="${n1(ey)}" r="${n1(erx * 0.62)}" fill="${p.c.iris}"/><circle cx="${n1(ix)}" cy="${n1(ey)}" r="${n1(erx * (expr.eyes > 1.2 ? 0.22 : 0.32))}" fill="#0a0806"/><circle cx="${n1(ix - erx * 0.22)}" cy="${n1(ey - erx * 0.25)}" r="${n1(erx * 0.14)}" fill="#ffffff"/></g>`);
      }
      // Brows
      if (!p.c.features.includes("single-eye")) {
        const by = ey - erx * 1.12 * Math.max(0.6, expr.eyes) - r * 0.08 - (expr.brows === "raised" ? r * 0.08 : 0);
        const inner = ex - side * erx * 1.0;
        const outer = ex + side * erx * 1.1;
        const innerDy = expr.brows === "worried" ? -r * 0.09 : expr.brows === "angry" ? r * 0.1 : 0;
        const outerDy = expr.brows === "worried" ? r * 0.03 : expr.brows === "angry" ? -r * 0.04 : 0;
        const col = p.c.browColor ?? C(darken(art.base, 0.55));
        const width = r * (p.c.browColor === "#ecebe6" ? 0.11 : 0.06);
        face.push(`<path d="M ${n1(inner)} ${n1(by + innerDy)} Q ${n1((inner + outer) / 2)} ${n1(by - r * (expr.brows === "relaxed" ? 0.06 : 0.02))} ${n1(outer)} ${n1(by + outerDy)}" stroke="${col}" stroke-width="${n1(width)}" fill="none" stroke-linecap="round"/>`);
      }
    }
    if (p.c.features.includes("scar"))
      face.push(`<path d="M ${n1(fx + es - r * 0.12)} ${n1(fy - r * 0.45)} L ${n1(fx + es + r * 0.14)} ${n1(fy + r * 0.12)}" stroke="${C(lighten(art.base, 0.35))}" stroke-width="${n1(r * 0.03)}" opacity="0.8"/>`);
    // Mouth
    const my = fy + r * 0.4;
    const mw = r * (creature ? 0.5 : 0.42);
    const mc = C(darken(art.base, 0.7));
    const mouth = speaking && (expr.mouth === "flat" || expr.mouth === "smile") ? "o" : expr.mouth;
    const sw = n1(r * 0.05);
    switch (mouth) {
      case "smile":
        face.push(`<path d="M ${n1(fx - mw / 2)} ${n1(my)} Q ${n1(fx)} ${n1(my + r * 0.2)} ${n1(fx + mw / 2)} ${n1(my)}" stroke="${mc}" stroke-width="${sw}" fill="none" stroke-linecap="round"/>`);
        break;
      case "grin":
        face.push(`<path d="M ${n1(fx - mw / 2)} ${n1(my - r * 0.02)} Q ${n1(fx)} ${n1(my + r * 0.3)} ${n1(fx + mw / 2)} ${n1(my - r * 0.02)} Z" fill="#3a0f0c"/>`);
        face.push(`<path d="M ${n1(fx - mw * 0.36)} ${n1(my + r * 0.005)} Q ${n1(fx)} ${n1(my + r * 0.08)} ${n1(fx + mw * 0.36)} ${n1(my + r * 0.005)} Z" fill="#f4efe4"/>`);
        break;
      case "o":
        face.push(`<ellipse cx="${n1(fx)}" cy="${n1(my + r * 0.04)}" rx="${n1(r * 0.08)}" ry="${n1(r * 0.1)}" fill="#3a0f0c"/>`);
        break;
      case "scream":
        face.push(`<ellipse cx="${n1(fx)}" cy="${n1(my + r * 0.06)}" rx="${n1(r * 0.15)}" ry="${n1(r * 0.2)}" fill="#2a0a08"/>`);
        break;
      case "frown":
        face.push(`<path d="M ${n1(fx - mw / 2)} ${n1(my + r * 0.1)} Q ${n1(fx)} ${n1(my - r * 0.08)} ${n1(fx + mw / 2)} ${n1(my + r * 0.1)}" stroke="${mc}" stroke-width="${sw}" fill="none" stroke-linecap="round"/>`);
        break;
      case "smirk":
        face.push(`<path d="M ${n1(fx - mw / 2)} ${n1(my + r * 0.03)} Q ${n1(fx + mw * 0.1)} ${n1(my + r * 0.06)} ${n1(fx + mw / 2)} ${n1(my - r * 0.09)}" stroke="${mc}" stroke-width="${sw}" fill="none" stroke-linecap="round"/>`);
        break;
      default:
        face.push(`<path d="M ${n1(fx - mw * 0.4)} ${n1(my + r * 0.03)} L ${n1(fx + mw * 0.4)} ${n1(my + r * 0.03)}" stroke="${mc}" stroke-width="${sw}" stroke-linecap="round"/>`);
    }
    if (creature) {
      for (const tx of [-0.1, 0.06]) face.push(`<rect x="${n1(fx + tx * r)}" y="${n1(my)}" width="${n1(r * 0.05)}" height="${n1(r * 0.07)}" fill="#e8dcb0"/>`);
    }
  }
  cv.add(`<g>${face.join("")}</g>`);
}

function drawCharacter(cv: Canvas, s: ArtSceneSpec, p: Placement, rng: Rng, holdsGlow: boolean) {
  const { c } = p;
  const C = (col: string) => (p.dim ? darken(col, p.dim) : col);
  const f = new Set(c.features);
  const hunched = f.has("hunched");
  const h = p.h;
  const r = h * HEAD_RATIO * (hunched ? 1.1 : 1);
  const x = p.x + (hunched ? p.facing * r * 0.4 : 0);
  const groundY = p.groundY;
  const headCy = hunched ? groundY - h * 0.62 + r : groundY - h + r;
  const neckY = headCy + r * 0.9;
  const shoulderY = neckY + r * 0.12;
  const hipY = groundY - h * (hunched ? 0.22 : 0.3);
  const wf = c.widthFactor;
  const sw = r * 0.95 * wf;
  const hw = r * 0.78 * wf;
  const primary = C(c.palette.primary);
  const secondary = C(c.palette.secondary);
  const accent = C(c.palette.accent);
  const glove = C("#b98a66");
  const villain = c.archetype === "antagonist";
  const expr = expressionFor(villain ? (s.emotion.match(/menace|anger|rage/) ? s.emotion : "menace") : s.emotion);
  const speaking = s.speakerIds.includes(c.id);
  const els: string[] = [];
  const wrapStart = p.blur ? `<g filter="${cv.blur(p.blur)}">` : "<g>";

  // Smoke behind villains
  if (f.has("smoke")) {
    for (let i = 0; i < 6; i++)
      els.push(`<circle cx="${n1(x + rng.float(-sw * 1.4, sw * 1.4))}" cy="${n1(shoulderY - rng.float(0, r * 2.2))}" r="${n1(r * rng.float(0.25, 0.55))}" fill="#3a3436" opacity="0.35" filter="${cv.blur(r * 0.15)}"/>`);
  }
  // Backpack
  if (f.has("backpack")) {
    els.push(`<rect x="${n1(x - sw * 1.18)}" y="${n1(shoulderY - r * 0.55)}" width="${n1(sw * 2.36)}" height="${n1(hipY - shoulderY + r * 0.4)}" rx="${n1(r * 0.25)}" fill="${C("#6b4a2b")}"/>`);
    if (f.has("pots")) {
      els.push(`<circle cx="${n1(x - sw * 1.25)}" cy="${n1(shoulderY + r * 0.3)}" r="${n1(r * 0.26)}" fill="${C("#8a8f96")}" stroke="${C("#4a4d52")}" stroke-width="${n1(r * 0.04)}"/>`);
      els.push(`<circle cx="${n1(x + sw * 1.25)}" cy="${n1(shoulderY + r * 0.55)}" r="${n1(r * 0.22)}" fill="${C("#b87333")}"/>`);
    }
  }
  // Cloak / cape
  if (f.has("cape") || f.has("hood")) {
    const bottom = groundY - h * 0.06;
    let hem = `L ${n1(x + sw * 1.45)} ${n1(bottom)}`;
    if (villain) {
      hem = "";
      for (let k = 0; k <= 8; k++) hem += ` L ${n1(x + sw * 1.45 - (k * sw * 2.9) / 8)} ${n1(bottom - (k % 2 ? r * 0.35 : 0))}`;
    } else hem += ` L ${n1(x - sw * 1.45)} ${n1(bottom)}`;
    els.push(`<path d="M ${n1(x - sw * 1.05)} ${n1(shoulderY)} Q ${n1(x - sw * 1.3)} ${n1((shoulderY + bottom) / 2)} ${n1(x - sw * 1.45)} ${n1(bottom)} L ${n1(x + sw * 1.45)} ${n1(bottom)}${villain ? hem : ""} Q ${n1(x + sw * 1.3)} ${n1((shoulderY + bottom) / 2)} ${n1(x + sw * 1.05)} ${n1(shoulderY)} Z" fill="${darken(primary, 0.2)}"/>`);
  }
  // Bow on the back
  if (f.has("bow")) {
    els.push(`<path d="M ${n1(x - sw * 0.9)} ${n1(shoulderY - r * 0.9)} Q ${n1(x + sw * 1.4)} ${n1((shoulderY + hipY) / 2)} ${n1(x - sw * 0.2)} ${n1(hipY + r * 0.4)}" stroke="${C("#e8e0cc")}" stroke-width="${n1(r * 0.09)}" fill="none"/>`);
    els.push(`<line x1="${n1(x - sw * 0.9)}" y1="${n1(shoulderY - r * 0.9)}" x2="${n1(x - sw * 0.2)}" y2="${n1(hipY + r * 0.4)}" stroke="${C("#d8d0b8")}" stroke-width="${n1(r * 0.02)}"/>`);
  }
  // Legs & boots
  if (hunched) {
    for (const side of [-1, 1]) {
      els.push(`<path d="M ${n1(x + side * hw * 0.4)} ${n1(hipY)} L ${n1(x + side * hw * 1.2)} ${n1(groundY - h * 0.12)} L ${n1(x + side * hw * 0.8)} ${n1(groundY)}" stroke="${C("#6a5a4a")}" stroke-width="${n1(r * 0.16)}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`);
    }
  } else {
    for (const side of [-1, 1]) {
      const lx = x + side * hw * 0.45;
      els.push(`<rect x="${n1(lx - r * 0.17 * wf)}" y="${n1(hipY - r * 0.1)}" width="${n1(r * 0.34 * wf)}" height="${n1(groundY - hipY - r * 0.1)}" rx="${n1(r * 0.1)}" fill="${darken(secondary, 0.25)}"/>`);
      els.push(`<ellipse cx="${n1(lx + side * r * 0.06)}" cy="${n1(groundY - r * 0.12)}" rx="${n1(r * 0.3 * wf)}" ry="${n1(r * 0.17)}" fill="${C("#2a1d14")}"/>`);
    }
  }
  // Torso
  const torsoTop = hunched ? shoulderY + r * 0.1 : shoulderY;
  els.push(`<path d="M ${n1(x - sw)} ${n1(torsoTop)} Q ${n1(x - sw * 1.08)} ${n1((torsoTop + hipY) / 2)} ${n1(x - hw)} ${n1(hipY)} L ${n1(x + hw)} ${n1(hipY)} Q ${n1(x + sw * 1.08)} ${n1((torsoTop + hipY) / 2)} ${n1(x + sw)} ${n1(torsoTop)} Q ${n1(x)} ${n1(torsoTop - r * 0.18)} ${n1(x - sw)} ${n1(torsoTop)} Z" fill="${hunched ? C("#6a5a4a") : primary}"/>`);
  if (hunched) {
    for (let k = 0; k < 4; k++) els.push(`<path d="M ${n1(x - sw * 0.6)} ${n1(torsoTop + r * (0.3 + k * 0.2))} q ${n1(sw * 0.6)} ${n1(r * 0.1)} ${n1(sw * 1.2)} 0" stroke="${C("#4a3d30")}" stroke-width="${n1(r * 0.03)}" fill="none"/>`);
    els.push(`<rect x="${n1(x - hw)}" y="${n1(hipY - r * 0.25)}" width="${n1(hw * 2)}" height="${n1(r * 0.35)}" fill="${C("#4f5a2a")}"/>`);
  } else {
    els.push(`<path d="M ${n1(x - sw * 0.35)} ${n1(torsoTop - r * 0.05)} L ${n1(x)} ${n1(torsoTop + r * 0.5)} L ${n1(x + sw * 0.35)} ${n1(torsoTop - r * 0.05)} Z" fill="${lighten(secondary, 0.15)}"/>`);
    if (f.has("armour")) {
      for (let k = 1; k <= 3; k++) {
        const yy = torsoTop + ((hipY - torsoTop) * k) / 4;
        els.push(`<line x1="${n1(x - sw * 0.95)}" y1="${n1(yy)}" x2="${n1(x + sw * 0.95)}" y2="${n1(yy)}" stroke="${villain ? accent : C("#9aa3ab")}" stroke-width="${n1(r * (villain ? 0.035 : 0.05))}" opacity="${villain ? 0.9 : 0.7}"${villain ? ` filter="${cv.blur(r * 0.02)}"` : ""}/>`);
      }
    }
    if (villain || f.has("spikes")) {
      for (const side of [-1, 1])
        for (let k = 0; k < 3; k++)
          els.push(`<path d="M ${n1(x + side * (sw * 0.6 + k * sw * 0.18))} ${n1(torsoTop)} L ${n1(x + side * (sw * 0.75 + k * sw * 0.2))} ${n1(torsoTop - r * (0.45 - k * 0.1))} L ${n1(x + side * (sw * 0.85 + k * sw * 0.18))} ${n1(torsoTop + r * 0.05)} Z" fill="${C("#0d0909")}"/>`);
    }
    els.push(`<rect x="${n1(x - hw * 1.02)}" y="${n1(hipY - r * 0.2)}" width="${n1(hw * 2.04)}" height="${n1(r * 0.16)}" fill="${darken(secondary, 0.35)}"/>`);
    els.push(`<rect x="${n1(x - r * 0.08)}" y="${n1(hipY - r * 0.22)}" width="${n1(r * 0.16)}" height="${n1(r * 0.2)}" fill="${accent}"/>`);
  }
  // Satchel
  if (f.has("satchel")) {
    els.push(`<line x1="${n1(x - sw * 0.8)}" y1="${n1(torsoTop)}" x2="${n1(x + hw * 0.9)}" y2="${n1(hipY - r * 0.1)}" stroke="${C("#5a3a1a")}" stroke-width="${n1(r * 0.08)}"/>`);
    els.push(`<rect x="${n1(x + hw * 0.6)}" y="${n1(hipY - r * 0.35)}" width="${n1(r * 0.55)}" height="${n1(r * 0.45)}" rx="${n1(r * 0.08)}" fill="${C("#7a5230")}"/>`);
  }
  // Scarf
  if (f.has("scarf")) {
    els.push(`<ellipse cx="${n1(x)}" cy="${n1(torsoTop + r * 0.05)}" rx="${n1(sw * 0.75)}" ry="${n1(r * 0.2)}" fill="${secondary}"/>`);
    els.push(`<rect x="${n1(x + sw * 0.2)}" y="${n1(torsoTop + r * 0.05)}" width="${n1(r * 0.22)}" height="${n1(r * 0.8)}" rx="${n1(r * 0.06)}" fill="${darken(secondary, 0.1)}"/>`);
  }
  // Arms
  const armLen = hunched ? h * 0.5 : h * 0.33;
  for (const side of [-1, 1]) {
    const ax = x + side * sw * 0.92;
    const ay = torsoTop + r * 0.08;
    const angle = side * (hunched ? 12 : 8);
    els.push(`<g transform="rotate(${angle} ${n1(ax)} ${n1(ay)})"><rect x="${n1(ax - r * 0.14 * wf)}" y="${n1(ay)}" width="${n1(r * 0.28 * wf)}" height="${n1(armLen)}" rx="${n1(r * 0.13)}" fill="${hunched ? C("#6a5a4a") : f.has("cape") ? darken(primary, 0.1) : primary}"/><circle cx="${n1(ax)}" cy="${n1(ay + armLen)}" r="${n1(r * 0.14)}" fill="${villain ? C("#141012") : glove}"/></g>`);
  }
  const handY = torsoTop + r * 0.08 + armLen;
  const rightHandX = x + sw * 0.92 + Math.sin((8 * Math.PI) / 180) * -armLen;
  // Props held
  if (f.has("staff")) {
    const sx = x + sw * 1.35;
    els.push(`<line x1="${n1(sx)}" y1="${n1(groundY)}" x2="${n1(sx - r * 0.1)}" y2="${n1(headCy - r * 1.4)}" stroke="${C("#5a3d22")}" stroke-width="${n1(r * 0.13)}" stroke-linecap="round"/>`);
    els.push(`<circle cx="${n1(sx - r * 0.1)}" cy="${n1(headCy - r * 1.5)}" r="${n1(r * 0.5)}" fill="#ffb347" opacity="0.45" filter="${cv.blur(r * 0.2)}"/>`);
    els.push(`<circle cx="${n1(sx - r * 0.1)}" cy="${n1(headCy - r * 1.5)}" r="${n1(r * 0.17)}" fill="#ffd27a"/>`);
  }
  if (f.has("axe")) {
    const axx = x - sw * 1.35;
    els.push(`<line x1="${n1(axx)}" y1="${n1(hipY + r * 0.6)}" x2="${n1(axx)}" y2="${n1(shoulderY - r * 1.1)}" stroke="${C("#4a3020")}" stroke-width="${n1(r * 0.11)}"/>`);
    for (const side of [-1, 1])
      els.push(`<path d="M ${n1(axx)} ${n1(shoulderY - r * 1.05)} Q ${n1(axx + side * r * 0.6)} ${n1(shoulderY - r * 1.35)} ${n1(axx + side * r * 0.55)} ${n1(shoulderY - r * 0.55)} Q ${n1(axx + side * r * 0.3)} ${n1(shoulderY - r * 0.75)} ${n1(axx)} ${n1(shoulderY - r * 0.7)} Z" fill="${C("#a8b0b8")}"/>`);
  }
  if (f.has("sword")) {
    els.push(`<line x1="${n1(x - hw * 0.9)}" y1="${n1(hipY - r * 0.1)}" x2="${n1(x - hw * 1.6)}" y2="${n1(groundY - r * 0.4)}" stroke="${C("#2a2420")}" stroke-width="${n1(r * 0.12)}" stroke-linecap="round"/>`);
    els.push(`<line x1="${n1(x - hw * 0.75)}" y1="${n1(hipY - r * 0.35)}" x2="${n1(x - hw * 1.05)}" y2="${n1(hipY + r * 0.1)}" stroke="${C("#c0a060")}" stroke-width="${n1(r * 0.08)}"/>`);
  }
  if (f.has("mace")) {
    els.push(`<line x1="${n1(rightHandX)}" y1="${n1(handY)}" x2="${n1(rightHandX + r * 0.3)}" y2="${n1(handY + r * 1.1)}" stroke="#1a1414" stroke-width="${n1(r * 0.1)}"/>`);
    els.push(`<circle cx="${n1(rightHandX + r * 0.35)}" cy="${n1(handY + r * 1.2)}" r="${n1(r * 0.3)}" fill="#141012" stroke="${accent}" stroke-width="${n1(r * 0.04)}"/>`);
  }
  if (f.has("shield")) {
    els.push(`<circle cx="${n1(x - sw * 1.1)}" cy="${n1((torsoTop + hipY) / 2 + r * 0.2)}" r="${n1(r * 0.55)}" fill="${C("#6b4a2b")}" stroke="${C("#8a9096")}" stroke-width="${n1(r * 0.1)}"/>`);
  }
  if (f.has("lantern") && !f.has("staff")) {
    els.push(`<circle cx="${n1(rightHandX)}" cy="${n1(handY + r * 0.35)}" r="${n1(r * 0.4)}" fill="#ffc860" opacity="0.35" filter="${cv.blur(r * 0.15)}"/>`);
    els.push(`<rect x="${n1(rightHandX - r * 0.1)}" y="${n1(handY + r * 0.15)}" width="${n1(r * 0.2)}" height="${n1(r * 0.3)}" fill="#e0a040" stroke="#6b4a2b" stroke-width="${n1(r * 0.03)}"/>`);
  }
  // Beard (drawn over the torso, under the head)
  if (f.has("beard")) {
    const white = f.has("white-beard");
    const col = white ? C("#ecebe6") : C(fruitArt(c.fruit).mid);
    const bottom = white ? hipY + r * 0.1 : hipY - r * 0.1;
    els.push(`<path d="M ${n1(x - r * 0.6)} ${n1(headCy + r * 0.45)} Q ${n1(x - r * 0.55)} ${n1(bottom - r * 0.3)} ${n1(x)} ${n1(bottom)} Q ${n1(x + r * 0.55)} ${n1(bottom - r * 0.3)} ${n1(x + r * 0.6)} ${n1(headCy + r * 0.45)} Z" fill="${col}"/>`);
    if (!white) {
      for (let k = 1; k <= 3; k++) els.push(`<ellipse cx="${n1(x)}" cy="${n1(headCy + r * 0.45 + ((bottom - headCy - r * 0.45) * k) / 4)}" rx="${n1(r * 0.22)}" ry="${n1(r * 0.07)}" fill="none" stroke="${C("#8a9096")}" stroke-width="${n1(r * 0.05)}"/>`);
    } else {
      for (let k = 0; k < 5; k++) els.push(`<path d="M ${n1(x - r * 0.3 + k * r * 0.15)} ${n1(headCy + r * 0.8)} q ${n1(r * 0.05)} ${n1(r * 0.4)} 0 ${n1((bottom - headCy) * 0.6)}" stroke="${C("#c8c6c0")}" stroke-width="${n1(r * 0.025)}" fill="none"/>`);
    }
  }
  // Hood collar behind the head
  if (f.has("hood") && !f.has("hat")) {
    els.push(`<ellipse cx="${n1(x)}" cy="${n1(headCy + r * 0.72)}" rx="${n1(r * 0.98)}" ry="${n1(r * 0.42)}" fill="${darken(primary, 0.3)}"/>`);
  }
  cv.add(`${wrapStart}${els.join("")}`);
  // Head
  drawHead(cv, p, x, headCy, r, expr, speaking, rng);
  // Hat on top
  if (f.has("hat")) {
    const hc = C("#6f7378");
    cv.add(`<path d="M ${n1(x - r * 0.7)} ${n1(headCy - r * 0.62)} Q ${n1(x - r * 0.6)} ${n1(headCy - r * 1.35)} ${n1(x + r * 0.05)} ${n1(headCy - r * 1.42)} Q ${n1(x + r * 0.65)} ${n1(headCy - r * 1.3)} ${n1(x + r * 0.7)} ${n1(headCy - r * 0.62)} Z" fill="${hc}"/>`);
    cv.add(`<ellipse cx="${n1(x)}" cy="${n1(headCy - r * 0.6)}" rx="${n1(r * 1.55)}" ry="${n1(r * 0.26)}" fill="${darken(hc, 0.15)}" transform="rotate(-4 ${n1(x)} ${n1(headCy - r * 0.6)})"/>`);
    cv.add(`<rect x="${n1(x - r * 0.7)}" y="${n1(headCy - r * 0.8)}" width="${n1(r * 1.4)}" height="${n1(r * 0.12)}" fill="${darken(hc, 0.45)}"/>`);
  }
  // Magic object glowing in the hero's hands
  if (s.magicGlow && holdsGlow && !p.back) {
    const gx = x + (p.facing || 1) * sw * 0.2;
    const gy = Math.min(handY - r * 0.2, cv.H * 0.95);
    cv.add(`<circle cx="${n1(gx)}" cy="${n1(gy)}" r="${n1(r * 0.9)}" fill="#ffcf4a" opacity="0.35" filter="${cv.blur(r * 0.3)}"/>`);
    cv.add(`<circle cx="${n1(gx)}" cy="${n1(gy)}" r="${n1(r * 0.16)}" fill="none" stroke="#ffe08a" stroke-width="${n1(r * 0.06)}"/>`);
  }
  cv.add("</g>");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function renderArtSvg(s: ArtSceneSpec): string {
  const cv = new Canvas(s.width, s.height);
  const rng = new Rng(s.seed || 1);
  const { width: W, height: H } = s;

  if (s.kind === "card") {
    cv.add(`<rect width="${W}" height="${H}" fill="${cv.linear([[0, darken(s.palette.sky, 0.85)], [0.6, darken(s.palette.sky, 0.6)], [1, darken(s.palette.accent, 0.7)]])}"/>`);
    cv.add(`<circle cx="${W / 2}" cy="${n1(H * 0.45)}" r="${n1(Math.min(W, H) * 0.32)}" fill="${s.palette.accent}" opacity="0.25" filter="${cv.blur(Math.min(W, H) * 0.06)}"/>`);
    cv.add(`<circle cx="${W / 2}" cy="${n1(H * 0.45)}" r="${n1(Math.min(W, H) * 0.16)}" fill="none" stroke="${lighten(s.palette.accent, 0.4)}" stroke-width="${n1(Math.min(W, H) * 0.022)}" opacity="0.9"/>`);
    drawWeather(cv, s, rng);
    // Wrap and size the title so it always fits inside 86% of the frame width.
    let fs = Math.min(W, H) * 0.085;
    let titleLines = wrapText(s.title ?? "", Math.max(6, Math.floor((W * 0.86) / (fs * 0.72))));
    while (titleLines.length > 3 && fs > 12) {
      fs *= 0.85;
      titleLines = wrapText(s.title ?? "", Math.max(6, Math.floor((W * 0.86) / (fs * 0.72))));
    }
    const titleY = H * 0.68;
    titleLines.forEach((line, i) =>
      cv.add(`<text x="${W / 2}" y="${n1(titleY + i * fs * 1.15)}" text-anchor="middle" font-family="DejaVu Serif, Georgia, 'Times New Roman', serif" font-weight="bold" font-size="${n1(fs)}" fill="#f4ead6" stroke="#000" stroke-width="${n1(fs * 0.04)}" letter-spacing="${n1(fs * 0.04)}">${escapeXml(line)}</text>`),
    );
    if (s.subtitle) {
      const sfs = fs * 0.42;
      const subLines = wrapText(s.subtitle, Math.max(10, Math.floor((W * 0.86) / (sfs * 0.62))));
      const subY = titleY + (titleLines.length - 1) * fs * 1.15 + fs * 1.05;
      subLines.slice(0, 3).forEach((line, i) =>
        cv.add(`<text x="${W / 2}" y="${n1(subY + i * sfs * 1.35)}" text-anchor="middle" font-family="DejaVu Sans, Arial, Helvetica, sans-serif" font-size="${n1(sfs)}" fill="${lighten(s.palette.accent, 0.3)}" letter-spacing="${n1(sfs * 0.08)}">${escapeXml(line)}</text>`),
      );
    }
    drawFinishing(cv, s);
    return cv.toString();
  }

  if (s.kind === "portrait") {
    cv.add(`<rect width="${W}" height="${H}" fill="${cv.radial([[0, "#5a5e66"], [1, "#24262b"]], 0.5, 0.4, 0.8)}"/>`);
    cv.add(`<ellipse cx="${W / 2}" cy="${n1(H * 0.92)}" rx="${n1(W * 0.3)}" ry="${n1(H * 0.025)}" fill="#000" opacity="0.4" filter="${cv.blur(12)}"/>`);
  } else {
    const fc = framingClass(s.framing);
    const hy = horizonFor(s.kind === "thumbnail" ? "cu" : fc, H);
    if (s.interior) {
      drawInterior(cv, s, rng);
    } else {
      const light = drawSky(cv, s, hy, rng);
      drawEnvironment(cv, s, hy, rng);
      drawGround(cv, s, hy, rng);
      drawAtmosphere(cv, s, hy, light, rng);
    }
    if (fc === "insert" || (s.magicGlow && !s.characters.length)) {
      const r = Math.min(W, H) * 0.14;
      cv.add(`<circle cx="${W / 2}" cy="${n1(H * 0.55)}" r="${n1(r * 2.4)}" fill="#ffcf4a" opacity="0.3" filter="${cv.blur(r * 0.4)}"/>`);
      cv.add(`<circle cx="${W / 2}" cy="${n1(H * 0.55)}" r="${n1(r)}" fill="none" stroke="${cv.linear([[0, "#fff1b0"], [1, "#c88a1a"]])}" stroke-width="${n1(r * 0.28)}"/>`);
    }
  }

  const laid = layoutCharacters(s);
  // Thumbnails are layered as laid out (villain behind); otherwise far-to-near.
  const placements =
    s.kind === "thumbnail" ? laid : laid.sort((a, b) => (a.back ? 1 : 0) - (b.back ? 1 : 0) || a.groundY - b.groundY);
  const glowHolder =
    placements.find((p) => p.c.archetype === "hero" && !p.back) ?? placements.find((p) => p.c.archetype === "mentor" && !p.back);
  for (const p of placements) drawCharacter(cv, s, p, rng, p === glowHolder);
  if (s.kind !== "portrait") {
    drawWeather(cv, s, rng);
    drawFinishing(cv, s);
  }
  if (s.label) {
    const fs = Math.max(12, Math.min(W, H) * 0.022);
    cv.add(`<text x="${n1(fs)}" y="${n1(fs * 1.8)}" font-family="DejaVu Sans Mono, Menlo, monospace" font-size="${n1(fs)}" fill="#ffffff" opacity="0.55">${escapeXml(s.label)}</text>`);
  }
  return cv.toString();
}

export async function renderArtPng(s: ArtSceneSpec): Promise<Buffer> {
  return sharp(Buffer.from(renderArtSvg(s))).png({ compressionLevel: 6 }).toBuffer();
}

function wrapText(text: string, maxChars: number): string[] {
  const lines: string[] = [];
  let current = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (current && (current + " " + word).length > maxChars) {
      lines.push(current);
      current = word;
    } else current = current ? `${current} ${word}` : word;
  }
  if (current) lines.push(current);
  return lines;
}

export function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
