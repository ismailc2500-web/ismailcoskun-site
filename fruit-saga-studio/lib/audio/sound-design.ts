import type { Episode, Location, Scene, Series, SoundCue, SoundPlan, Timeline } from "@/lib/types";
import { transitionSpec } from "@/lib/prompts/vocabulary";

/**
 * STAGE 6 — sound design plan. Derived deterministically from the timeline,
 * each shot's `sound_design` notes, transitions and locations. No copyrighted
 * recordings: cues are rendered procedurally or from your licensed library.
 */

const AMBIENCE_BY_ENV: Record<string, string> = {
  village: "village_ambience",
  forest: "forest_ambience",
  mountain: "wind",
  volcanic: "fire_ambience",
  sanctuary: "water_ambience",
  river: "water_ambience",
  cave: "cave_ambience",
  castle: "wind",
  plains: "wind",
  other: "wind",
};

interface CueRule {
  re: RegExp;
  type: string;
  place: (start: number, dur: number) => { start: number; duration: number };
  volume: number;
}

const RULES: CueRule[] = [
  { re: /footstep|steps|walk|stomp/, type: "footsteps", place: (s, d) => ({ start: s + 0.3, duration: Math.min(4, d - 0.5) }), volume: -20 },
  { re: /sword|blade|steel|clash/, type: "sword", place: (s, d) => ({ start: s + d * 0.45, duration: 1.4 }), volume: -12 },
  { re: /magic|shimmer|glow|hum|whisper|spell/, type: "magic", place: (s) => ({ start: s + 0.35, duration: 2.8 }), volume: -17 },
  { re: /\bhit\b|impact|boom|slam|sting/, type: "hit", place: (s) => ({ start: s + 0.05, duration: 2.2 }), volume: -9 },
  { re: /whoosh|swoosh|swipe/, type: "whoosh", place: (s, d) => ({ start: s + d - 0.45, duration: 0.8 }), volume: -13 },
  { re: /creature|growl|roar|hiss|snarl/, type: "creature", place: (s, d) => ({ start: s + d * 0.3, duration: 2.6 }), volume: -13 },
  { re: /thunder|lightning/, type: "thunder", place: (s) => ({ start: s + 0.2, duration: 3.2 }), volume: -11 },
  { re: /heartbeat|heart beat/, type: "heartbeat", place: (s, d) => ({ start: s + Math.max(0, d - 3.4), duration: 3.4 }), volume: -12 },
  { re: /riser|swell|tension/, type: "riser", place: (s, d) => ({ start: s + Math.max(0, d - 2.8), duration: 2.8 }), volume: -13 },
  { re: /creak|door/, type: "creak", place: (s) => ({ start: s + 0.3, duration: 1.3 }), volume: -16 },
  { re: /clank|clang|pots|pans|metal/, type: "clank", place: (s) => ({ start: s + 0.5, duration: 1.2 }), volume: -16 },
  { re: /rustle|leaves|hedge|bush/, type: "rustle", place: (s) => ({ start: s + 0.2, duration: 1.4 }), volume: -18 },
];

const BED_RULES: { re: RegExp; type: string; volume: number }[] = [
  { re: /\brain\b|storm/, type: "rain", volume: -21 },
  { re: /\bwind\b|gust|blizzard/, type: "wind", volume: -23 },
  { re: /\bfire\b|crackl|hearth|lava/, type: "fire_ambience", volume: -22 },
  { re: /water|river|waterfall|stream/, type: "water_ambience", volume: -22 },
];

export function planSound(series: Series, episode: Episode, scenes: Scene[], timeline: Timeline, locations: Location[]): SoundPlan {
  const byScene = new Map(timeline.scenes.map((s) => [s.scene_id, s]));
  const ambience: SoundCue[] = [];
  const sfx: SoundCue[] = [];
  let n = 0;
  const id = () => `cue${String(++n).padStart(3, "0")}`;

  // Ambience beds: one per run of consecutive shots in the same location.
  let run: { type: string; start: number; end: number; scene: string } | null = null;
  const flush = () => {
    if (run && run.end - run.start > 0.5) {
      ambience.push({ id: id(), type: run.type, start: round(run.start), duration: round(run.end - run.start), volume_db: -24, scene_id: run.scene, note: "location bed" });
    }
  };
  for (const scene of scenes) {
    const t = byScene.get(scene.scene_id);
    if (!t) continue;
    const loc = locations.find((l) => l.id === scene.location);
    const type = loc?.ambience || AMBIENCE_BY_ENV[loc?.environment_type ?? "other"] || "wind";
    if (run && run.type === type) run.end = t.start + t.duration;
    else {
      flush();
      run = { type, start: t.start, end: t.start + t.duration, scene: scene.scene_id };
    }
  }
  flush();

  for (const scene of scenes) {
    const t = byScene.get(scene.scene_id);
    if (!t) continue;
    const notes = `${scene.sound_design} ${scene.environment_motion}`.toLowerCase();
    for (const rule of RULES) {
      if (!rule.re.test(scene.sound_design.toLowerCase())) continue;
      const p = rule.place(t.start, t.duration);
      if (p.duration > 0.1) sfx.push({ id: id(), type: rule.type, start: round(Math.max(0, p.start)), duration: round(p.duration), volume_db: rule.volume, scene_id: scene.scene_id, note: `from "${scene.sound_design}"` });
    }
    for (const bed of BED_RULES) {
      if (!bed.re.test(notes)) continue;
      if (ambience.some((a) => a.type === bed.type && a.start <= t.start && a.start + a.duration >= t.start + t.duration)) continue;
      ambience.push({ id: id(), type: bed.type, start: round(t.start), duration: round(t.duration), volume_db: bed.volume, scene_id: scene.scene_id, note: "weather/elements bed" });
    }
    const trans = transitionSpec(scene.transition);
    const boundary = t.start + t.duration;
    if (trans.whoosh) sfx.push({ id: id(), type: "whoosh", start: round(boundary - 0.4), duration: 0.8, volume_db: -12, scene_id: scene.scene_id, note: "whip transition" });
    if (trans.xfade === "fadewhite") sfx.push({ id: id(), type: "hit", start: round(boundary - 0.05), duration: 2, volume_db: -11, scene_id: scene.scene_id, note: "flash transition" });
  }

  // Structural accents: a hit on the hook, a riser into the cliffhanger.
  const hook = scenes.find((s) => s.beat === "hook");
  const hookT = hook && byScene.get(hook.scene_id);
  if (hookT && !sfx.some((c) => c.type === "hit" && c.start < hookT.start + 0.5)) {
    sfx.push({ id: id(), type: "hit", start: round(hookT.start + 0.02), duration: 2.2, volume_db: -9, scene_id: hook!.scene_id, note: "hook accent" });
  }
  const cliff = scenes.find((s) => s.beat === "cliffhanger");
  const cliffT = cliff && byScene.get(cliff.scene_id);
  if (cliffT && !sfx.some((c) => c.type === "riser" && c.scene_id === cliff!.scene_id)) {
    sfx.push({ id: id(), type: "riser", start: round(Math.max(0, cliffT.start - 2.2)), duration: 2.4, volume_db: -13, scene_id: cliff!.scene_id, note: "into cliffhanger" });
  }
  if (cliffT) {
    const lastWord = timeline.voice.filter((v) => v.scene_id === cliff!.scene_id).flatMap((v) => v.words).pop();
    const at = lastWord ? lastWord.end + 0.05 : cliffT.start + cliffT.duration - 1.2;
    sfx.push({ id: id(), type: "hit", start: round(at), duration: 2.5, volume_db: -8, scene_id: cliff!.scene_id, note: "cliffhanger sting" });
  }

  // Keep cues inside the episode and drop near-duplicates of the same type.
  const total = timeline.total_duration;
  const clean = dedupe(sfx.filter((c) => c.start < total - 0.1).map((c) => ({ ...c, duration: round(Math.min(c.duration, total - c.start)) })));
  const swells = [scenes.find((s) => s.beat === "scene_5"), cliff].map((s) => (s ? byScene.get(s.scene_id)?.start : undefined)).filter((x): x is number => x !== undefined);
  const mood = /dark|menace|tense|horror/.test(episode.tone) ? "tense" : /whims|light|comed/.test(episode.tone) && !/epic/.test(episode.tone) ? "whimsical" : series.settings.music.mood;
  return {
    music: {
      mood,
      source: "procedural",
      file: "",
      volume_db: series.settings.music.volume_db,
      duck_db: series.settings.music.duck_db,
      fade_in: 0.8,
      fade_out: 1.5,
      swells,
    },
    ambience,
    sfx: clean.sort((a, b) => a.start - b.start),
  };
}

function dedupe(cues: SoundCue[]): SoundCue[] {
  const out: SoundCue[] = [];
  for (const c of cues.sort((a, b) => a.start - b.start)) {
    if (out.some((o) => o.type === c.type && Math.abs(o.start - c.start) < 0.8)) continue;
    out.push(c);
  }
  return out;
}

const round = (n: number) => Math.round(n * 1000) / 1000;
