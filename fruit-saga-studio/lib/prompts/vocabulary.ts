import type { EnvironmentType } from "@/lib/types";

/** Cinematography vocabulary shared by the shot planner, prompt engine, mock renderer and UI. */

export const FRAMINGS = [
  "extreme wide establishing shot",
  "wide shot",
  "low-angle wide shot",
  "medium wide shot",
  "medium shot",
  "two-shot",
  "over-the-shoulder shot",
  "medium close-up",
  "close-up",
  "extreme close-up",
  "low-angle hero shot",
  "high-angle shot",
  "insert shot",
] as const;

export const MOVEMENTS = [
  "static locked-off",
  "slow dolly-in",
  "slow push-in",
  "dramatic push-in",
  "dolly-out",
  "backwards tracking",
  "medium tracking shot",
  "slow orbit",
  "handheld",
  "handheld chase",
  "crane reveal",
  "tilt up",
  "tilt down",
  "pan left",
  "pan right",
  "whip pan",
] as const;

export const TRANSITIONS = ["cut", "crossfade", "fade to black", "whip", "flash", "dissolve"] as const;

const CAMERA_MOTION: [RegExp, string][] = [
  [/static|locked/, "the camera stays locked off with only a barely perceptible breathing drift"],
  [/dramatic push|snap/, "the camera pushes in fast and dramatically toward the subject's face"],
  [/push-?in|creep/, "the camera creeps slowly forward toward the subject"],
  [/dolly-?in/, "the camera slowly dollies in toward the subject on a smooth track"],
  [/dolly-?out|pull/, "the camera slowly pulls back, revealing more of the surroundings"],
  [/backward/, "the camera tracks backwards in front of the subject, keeping pace with them"],
  [/tracking/, "the camera tracks sideways alongside the subject at walking pace"],
  [/orbit|arc/, "the camera slowly orbits around the subject in a smooth arc"],
  [/chase/, "an energetic handheld camera runs after the subject, shaky and urgent"],
  [/handheld/, "handheld camera with subtle organic shake and small reframes"],
  [/crane.*(down|descend)/, "the camera cranes down from high above toward the subject"],
  [/crane/, "the camera cranes upward from behind foreground foliage to reveal the full vista"],
  [/tilt up/, "the camera tilts slowly upward, revealing the subject from bottom to top"],
  [/tilt down/, "the camera tilts slowly downward from the sky to the subject"],
  [/whip/, "a fast whip pan with motion blur lands on the subject"],
  [/pan left/, "the camera pans slowly to the left across the scene"],
  [/pan right|pan/, "the camera pans slowly to the right across the scene"],
  [/rack/, "focus racks from the foreground to the subject"],
  [/aerial|fly/, "a sweeping aerial flyover glides over the landscape"],
];

export function describeCameraMotion(movement: string): string {
  const m = movement.toLowerCase();
  for (const [re, text] of CAMERA_MOTION) if (re.test(m)) return text;
  return movement ? `the camera moves smoothly: ${movement}` : "subtle slow camera drift";
}

const LENSES: [RegExp, string][] = [
  [/extreme close/, "100mm macro lens, razor-thin focus on the eyes"],
  [/close-?up/, "85mm portrait lens, very shallow depth of field, creamy bokeh"],
  [/insert/, "macro lens, detail insert with blurred background"],
  [/over-the-shoulder|ots/, "50mm lens, soft out-of-focus foreground shoulder"],
  [/extreme wide|establishing/, "18mm wide-angle lens, deep focus with strong atmospheric perspective"],
  [/low-angle/, "low camera near the ground looking up, 24mm lens, heroic scale"],
  [/high-angle/, "high camera looking down, 28mm lens, the subject small and vulnerable"],
  [/wide/, "24mm lens, layered foreground, midground and background"],
  [/two-shot/, "40mm lens, both characters sharp"],
  [/medium/, "35mm lens, shallow depth of field"],
];

export function lensFor(framing: string): string {
  const f = framing.toLowerCase();
  for (const [re, text] of LENSES) if (re.test(f)) return text;
  return "35mm lens, cinematic depth of field";
}

const ENV_MOTION: Record<EnvironmentType, string> = {
  village: "chimney smoke curls upward, leaves and dandelion seeds drift on a warm breeze, grass sways",
  forest: "fog drifts slowly between the trunks, branches sway, glowing spores float in the air",
  mountain: "snow blows sideways in gusts, clouds race past the peaks",
  volcanic: "embers rise and swirl, lava churns, smoke rolls, heat haze ripples the air",
  sanctuary: "waterfalls pour, lanterns sway gently, mist drifts across the bridges",
  river: "water ripples and glints, reeds sway, mist hangs over the surface",
  cave: "water drips from stalactites, faint mist curls, reflected light shimmers on wet stone",
  castle: "banners flap in the wind, torches flicker, dust drifts through light shafts",
  plains: "tall grass waves in the wind, cloud shadows slide across the land",
  other: "subtle atmospheric particles drift through the light",
};

export function defaultEnvironmentMotion(env: EnvironmentType): string {
  return ENV_MOTION[env] ?? ENV_MOTION.other;
}

export interface ExpressionSpec {
  text: string;
  brows: "worried" | "angry" | "raised" | "relaxed" | "flat";
  eyes: number; // openness multiplier
  closed?: boolean;
  mouth: "smile" | "grin" | "o" | "frown" | "flat" | "smirk" | "scream";
}

const EXPRESSIONS: [RegExp, ExpressionSpec][] = [
  [/asleep|sleep|doz|nap/, { text: "eyes peacefully closed, content little smile", brows: "relaxed", eyes: 1, closed: true, mouth: "smile" }],
  [/terror|horror|scream/, { text: "eyes huge with terror, brows pinched upward, mouth stretched open", brows: "worried", eyes: 1.45, mouth: "scream" }],
  [/dread|fear|scared|afraid|nervous|anxious|panic/, { text: "eyes wide, brows pinched upward, mouth slightly open, fruit skin tense", brows: "worried", eyes: 1.3, mouth: "o" }],
  [/menace|sinister|evil|cruel|hungry/, { text: "eyes narrowed to slits, a slow cruel smile", brows: "angry", eyes: 0.65, mouth: "smirk" }],
  [/anger|angry|rage|fury/, { text: "brows slammed down, eyes narrowed, mouth pulled tight", brows: "angry", eyes: 0.8, mouth: "frown" }],
  [/surprise|shock|wonder|awe/, { text: "eyes huge, brows shooting up, mouth a small round O", brows: "raised", eyes: 1.4, mouth: "o" }],
  [/sad|grief|loss|melanch/, { text: "glassy eyes, brows tilted up in the middle, trembling mouth", brows: "worried", eyes: 0.9, mouth: "frown" }],
  [/resolve|determin|brave|heroic|courage/, { text: "jaw set, eyes focused, brows lowered with determination", brows: "angry", eyes: 1, mouth: "flat" }],
  [/solemn|serious|grave|ominous/, { text: "grave steady eyes, brows level, mouth a firm line", brows: "flat", eyes: 0.95, mouth: "flat" }],
  [/comed|absurd|awkward|embarrass/, { text: "exaggerated double-take, eyes darting, sheepish grin", brows: "raised", eyes: 1.2, mouth: "grin" }],
  [/joy|happy|warm|laugh|triumph|grateful/, { text: "eyes crinkling, broad smile dimpling the fruit skin", brows: "relaxed", eyes: 0.95, mouth: "grin" }],
  [/cosy|cozy|calm|content|peace|smug|comfort/, { text: "relaxed half-lidded eyes, soft satisfied smile", brows: "relaxed", eyes: 0.8, mouth: "smile" }],
];

export function expressionFor(emotion: string): ExpressionSpec {
  const e = emotion.toLowerCase();
  for (const [re, spec] of EXPRESSIONS) if (re.test(e)) return spec;
  return { text: "a subtle, readable expression that matches the moment", brows: "flat", eyes: 1, mouth: "flat" };
}

/** xfade transition + duration for each editorial transition. */
export function transitionSpec(transition: string): { xfade: string | null; duration: number; whoosh: boolean } {
  const t = transition.toLowerCase();
  if (/fade to black|black/.test(t)) return { xfade: "fadeblack", duration: 0.6, whoosh: false };
  if (/flash|white/.test(t)) return { xfade: "fadewhite", duration: 0.3, whoosh: false };
  if (/whip|swipe/.test(t)) return { xfade: "smoothleft", duration: 0.3, whoosh: true };
  if (/dissolve/.test(t)) return { xfade: "dissolve", duration: 0.6, whoosh: false };
  if (/cross|fade/.test(t)) return { xfade: "fade", duration: 0.5, whoosh: false };
  return { xfade: null, duration: 0, whoosh: false };
}
