import type {
  Beat,
  BeatId,
  Character,
  ContinuityUpdate,
  EpisodeMetadata,
  Location,
  Screenplay,
  Shot,
  ShotList,
} from "@/lib/types";
import { BEAT_STRUCTURE, BEATS } from "@/lib/types";
import type { ContinuityContext, MetadataContext, ShotContext, StoryContext } from "@/lib/story/contexts";
import { characterDescriptor } from "@/lib/prompts/engine";
import { countWords, spokenWords } from "@/lib/prompts/formatters";
import { estimateTimings } from "@/lib/audio/timing";
import { Rng } from "@/lib/ai/mock/rng";

/**
 * Offline "writer" used by the mock LLM provider. It is template-driven but
 * reads the synopsis, the character bible and the continuity state, so the
 * output follows the episode you asked for and stays consistent with earlier
 * episodes. Real LLM providers replace all of this with /prompts templates.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function shortName(c: Character): string {
  const nick = c.display_name.match(/["“](.+?)["”]/);
  if (nick) return nick[1];
  return c.display_name.split(/\s+/)[0];
}

function villainTitle(c: Character): string {
  const idx = c.display_name.indexOf(" the ");
  return idx > 0 ? c.display_name.slice(idx + 1) : `the ${c.role || "dark one"}`;
}

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const lc = (s: string) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);
const lcUnlessName = (s: string, chars: Character[]) =>
  chars.some((c) => s.startsWith(shortName(c))) ? s : lc(s);
const stripEnd = (s: string) => s.trim().replace(/[.!?…\s]+$/, "");

function fill(template: string, vars: Record<string, string>): string {
  return sentenceCase(template.replace(/\{(\w+)\}/g, (_m, k: string) => vars[k] ?? ""));
}

/** Capitalises the first letter of every sentence. */
function sentenceCase(text: string): string {
  return text.replace(/(^|[.!?…]\s+)([a-z])/g, (_m, pre: string, ch: string) => pre + ch.toUpperCase());
}

const placeName = (l?: Location) => (l ? l.name.replace(/^The /, "the ") : "");

export function cleanSynopsis(synopsis: string): string {
  return synopsis
    .replace(/^\s*(episode|ep\.?)\s*\d+\s*[:\-–—]\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function firstSentence(text: string): string {
  const m = text.match(/^(.+?[.!?])(\s|$)/);
  return stripEnd(m ? m[1] : text);
}

function truncateWords(text: string, max: number): string {
  const words = text.split(/\s+/);
  if (words.length <= max) return text;
  const cut = words.slice(0, max).join(" ");
  const comma = cut.lastIndexOf(",");
  return stripEnd(comma > cut.length * 0.5 ? cut.slice(0, comma) : cut);
}

const FRUIT_EMOJI: [RegExp, string][] = [
  [/apple/, "🍎"],
  [/pear/, "🍐"],
  [/orange|tangerine|tangelo/, "🍊"],
  [/lemon|lime/, "🍋"],
  [/coconut/, "🥥"],
  [/strawberr/, "🍓"],
  [/pineapple/, "🍍"],
  [/watermelon/, "🍉"],
  [/melon/, "🍈"],
  [/peach/, "🍑"],
  [/cherr/, "🍒"],
  [/grape/, "🍇"],
  [/banana/, "🍌"],
  [/mango/, "🥭"],
  [/kiwi/, "🥝"],
  [/avocado/, "🥑"],
];

export function fruitEmoji(fruit: string): string {
  const f = fruit.toLowerCase();
  for (const [re, e] of FRUIT_EMOJI) if (re.test(f)) return e;
  return "🍎";
}

// ---------------------------------------------------------------------------
// Cast, places and the story object
// ---------------------------------------------------------------------------

interface Cast {
  hero: Character;
  mentor?: Character;
  companion?: Character;
  ally?: Character;
  villain?: Character;
  creature?: Character;
}

function keywordsFor(c: Character): string[] {
  const words = [shortName(c), c.display_name, c.fruit, ...c.descriptor.split(/\s+/).slice(-1), c.role.split(/\s+/)[0]];
  if (c.archetype === "antagonist") words.push("dark lord", "villain", "enemy");
  if (c.archetype === "creature") words.push("creature", "monster");
  if (c.archetype === "mentor") words.push("wizard", "mentor");
  if (c.archetype === "hero") words.push("traveller", "traveler", "hero");
  return words.filter((w) => w && w.length > 2).map((w) => w.toLowerCase());
}

function mentionScore(c: Character, text: string): number {
  return keywordsFor(c).reduce((s, k) => s + (text.includes(k) ? (k === c.fruit.toLowerCase() ? 1 : 2) : 0), 0);
}

function pickCast(ctx: StoryContext, synopsis: string): Cast {
  const text = synopsis.toLowerCase();
  const active = ctx.characters.filter((c) => !/dead/.test(ctx.state.character_states[c.id]?.status ?? ""));
  const byArch = (a: string) => active.filter((c) => c.archetype === a);
  const ranked = [...active].sort((a, b) => mentionScore(b, text) - mentionScore(a, text));
  const mentionedHero = ranked.find((c) => mentionScore(c, text) > 0 && ["hero", "companion", "ally"].includes(c.archetype));
  const hero = byArch("hero").find((c) => mentionScore(c, text) > 0) ?? mentionedHero ?? byArch("hero")[0] ?? active[0];
  const others = active.filter((c) => c !== hero);
  const prefer = (list: Character[]) => list.find((c) => mentionScore(c, text) > 0) ?? list[0];
  return {
    hero,
    mentor: prefer(others.filter((c) => c.archetype === "mentor")),
    companion: prefer(others.filter((c) => c.archetype === "companion")),
    ally: prefer(others.filter((c) => c.archetype === "ally")),
    villain: prefer(others.filter((c) => c.archetype === "antagonist")),
    creature: prefer(others.filter((c) => c.archetype === "creature")),
  };
}

const LOCATION_KEYWORDS: [RegExp, string][] = [
  [/forest|wood|trees|grove/, "forest"],
  [/mountain|pass|peak|snow|cliff/, "mountain"],
  [/cave|cavern|tunnel|underground|mine/, "cave"],
  [/haven|elves|elven|refuge|sanctuary/, "sanctuary"],
  [/volcano|fire|dark land|tower|throne|ash/, "volcanic"],
  [/village|home|house|farm|orchard/, "village"],
  [/river|lake|sea|boat|water/, "river"],
  [/castle|fortress|city|keep/, "castle"],
];

function pickPlaces(ctx: StoryContext, cast: Cast, synopsis: string) {
  const text = synopsis.toLowerCase();
  const locs = ctx.locations;
  const byId = (id?: string) => locs.find((l) => l.id === id);
  const named = locs.filter((l) => text.includes(l.name.toLowerCase().replace(/^the /, "")) || text.includes(l.id));
  const typed = LOCATION_KEYWORDS.filter(([re]) => re.test(text)).map(([, t]) => locs.find((l) => l.environment_type === t)).filter(Boolean) as Location[];
  const heroLoc = byId(ctx.state.character_states[cast.hero.id]?.location);
  const start = heroLoc ?? named[0] ?? locs.find((l) => l.environment_type === "village") ?? locs[0];
  const villainLoc =
    byId(cast.villain ? ctx.state.character_states[cast.villain.id]?.location : undefined) ??
    locs.find((l) => l.environment_type === "volcanic") ??
    locs[locs.length - 1];
  const candidates = [...named, ...typed].filter((l) => l !== start && l !== villainLoc);
  const startIdx = locs.indexOf(start);
  const nextInList = locs.slice(startIdx + 1).concat(locs.slice(0, startIdx)).find((l) => l !== villainLoc && l !== start);
  const destination = candidates[0] ?? nextInList ?? start;
  const travels = /journey|travel|leave|leaves|road|flee|escape|far from|set out|sets out|cross|reach|arrive/.test(text) || named.length > 0 || typed.length > 0;
  return { start, destination, villainLoc, travels, named: named.length > 0 || typed.length > 0 };
}

const OBJECT_WORDS = ["ring", "amulet", "sword", "crown", "map", "stone", "seed", "key", "orb", "book", "staff", "egg", "chalice", "gem", "jewel", "relic", "scroll", "lantern", "mirror", "shard", "horn", "object", "artifact", "artefact"];

function pickObject(ctx: StoryContext, synopsis: string): { phrase: string; short: string } {
  const text = synopsis.toLowerCase();
  const word = OBJECT_WORDS.find((w) => new RegExp(`\\b${w}\\b|${w}-`).test(text));
  const notes = [...ctx.state.world_notes, ...ctx.state.major_events.map((e) => e.event)].join(" ");
  const named = notes.match(/\b[Tt]he ([A-Z][a-z]+)\b[^.]*?\b(ring|sword|stone|seed|crown|amulet|orb|key|gem)\b/);
  if (named && (!word || ["ring", "seed", "object", "artifact", "artefact", "relic", named[2]].includes(word))) {
    return { phrase: `the ${named[1]}`, short: named[2] };
  }
  const possession = Object.values(ctx.state.character_states)
    .flatMap((s) => s.possessions)
    .find((p) => /ring|seed|sword|stone|crown|amulet|orb/.test(p.toLowerCase()));
  if (!word && possession) return { phrase: `the ${possession.replace(/^the /i, "")}`, short: possession.split(/\s+/).pop() ?? "relic" };
  const w = word && !["object", "artifact", "artefact", "relic"].includes(word) ? word : /ring/.test(text) ? "ring" : "relic";
  return { phrase: `the mysterious ${w}`, short: w };
}

// ---------------------------------------------------------------------------
// Screenplay
// ---------------------------------------------------------------------------

const HOOKS_FIRST = [
  "This {HF} is about to have the worst week in history.",
  "Nobody warned {H} that destiny bruises.",
  "One small {HF}. One terrible {OS}. Zero plan.",
  "Some fruit ripen. {H} was about to get picked.",
];
const HOOKS_LATER = [
  "{H} survived. Barely. Now comes the hard part.",
  "The {OS} is getting heavier. So is the danger.",
  "Every step from {L1} costs {H} something.",
  "Something is following them. It is not friendly.",
];
const SETUPS_FIRST = [
  "In {L1}, {H} wanted exactly three things: a warm nap, a quiet life, and absolutely no destiny.",
  "{L1} was peaceful, and {H} the {HD} planned to keep it that way. Forever. Ideally horizontally.",
];
const SETUPS_LATER = [
  "The plan was simple: {OBJ}. But plans, like fruit, never stay fresh for long.",
  "After last time, {H} had one rule: keep moving. Stopping is how fruit gets eaten.",
];
const INCITING = [
  "Then everything changed. {EV}.",
  "It started quietly. {EV}.",
];
const INCITING_MENTOR = ["Then {M} arrived, with bad news, as usual. {EV}."];
const MENTOR_LINES = [
  "Some burdens choose their bearer. This one chose badly.",
  "Do not panic. Panic later, when there is time.",
  "Keep it close. And whatever happens, do not ripen.",
];
const COMEDY: Record<string, string[]> = {
  apple: [
    "{H} tried to stay calm, but apples bruise easily, and this news was very, very bruising.",
    "{H} weighed the options: hide, cry, or become a pie. None of them felt heroic.",
  ],
  pear: ["{H} felt suddenly very ripe, and not in a good way."],
  orange: ["{H} kept it together. Thick skin helps. Mostly."],
  default: ["{H} did what any sensible fruit would do. Panicked. Quietly. Then loudly."],
};
const COMPANION_LINES = [
  "Wherever you're going, I'm coming. I packed snacks.",
  "If you're rolling into danger, I'm rolling with you.",
  "I'm not scared. My peel is just... nervous.",
];
const DANGER_VILLAIN = [
  "But {O} was never quiet. It whispered. And far away in {L3}, {V} heard every word.",
  "Because {O} belonged to {V}, {VT}. And {VT} does not forgive thieves.",
];
const DANGER_CREATURE = [
  "Behind them, something twitched in the dark. {CR} had caught the scent of {O}.",
];
const CLIMAX_TRAVEL = [
  "So {H} made a choice no {HF} had ever made: leave {L1} behind, and walk toward {L2}.",
  "They ran through roots, rain and rotten luck, all the way to the edge of {L2}.",
];
const CLIMAX_STAY = [
  "{H} held {O} tight. For once, running away was not an option.",
  "And so {H} stood up, shaking, and faced the one thing no {HF} should ever face.",
];
const HERO_LINES = ["I'm just a {HF}!", "Why is it always me?", "Fine. But I'm bringing a blanket."];
const ALLY_LINES = ["Then be a brave one.", "Stay behind me. And try not to roll away."];
const CLIFFHANGERS_VILLAIN = [
  "But in {L3}, {V} opened one burning eye, and whispered a single name: {H}.",
  "In {L3}, {V} smiled for the first time in a thousand years. The hunt had begun.",
];
const CLIFFHANGERS_CREATURE = [
  "And beneath {L2}, a shrivelled shape began to follow. Hungry. Patient. Close.",
  "{L2} looked safe. That was their first mistake. {CR} was already waiting.",
];
const TEASES = [
  "Next time: the road to {L2} has teeth.",
  "Next time: {V} sends the first hunters.",
  "Next time: an ally with a very sharp secret.",
  "Next time: {CR} makes an offer {H} cannot refuse.",
];
const TITLES = [
  "The {OSC} That Whispered",
  "{H} and the {OSC}",
  "Leaving {L1}",
  "Shadows over {L2}",
  "The Weight of the {OSC}",
  "Bruised but Unbroken",
  "Into {L2}",
  "Something in the Fog",
  "A Very Ripe Danger",
];

function fruitKey(fruit: string) {
  const f = fruit.toLowerCase();
  return Object.keys(COMEDY).find((k) => f.includes(k)) ?? "default";
}

export function mockScreenplay(ctx: StoryContext): Screenplay {
  const rng = new Rng(`${ctx.series.id}:${ctx.episodeNumber}:${ctx.synopsis}`);
  const synopsis = cleanSynopsis(ctx.synopsis) || "The journey continues and the danger grows.";
  const cast = pickCast(ctx, synopsis);
  const places = pickPlaces(ctx, cast, synopsis);
  const object = pickObject(ctx, synopsis);
  const first = ctx.episodeNumber === 1 || ctx.previous.length === 0;
  const H = shortName(cast.hero);
  const vars: Record<string, string> = {
    H,
    HD: characterDescriptor(cast.hero),
    HF: cast.hero.fruit.toLowerCase(),
    M: cast.mentor ? shortName(cast.mentor) : "a stranger",
    C: cast.companion ? shortName(cast.companion) : "a friend",
    V: cast.villain ? shortName(cast.villain) : "the enemy",
    VT: cast.villain ? villainTitle(cast.villain) : "the enemy",
    CR: cast.creature ? shortName(cast.creature) : "something",
    L1: placeName(places.start) || "home",
    L2: placeName(places.destination) || "the wild",
    L3: placeName(places.villainLoc) || "the dark",
    O: object.phrase,
    OS: object.short,
    OSC: cap(object.short),
    OBJ: lcUnlessName(stripEnd(ctx.state.current_objective || `keep ${object.phrase} safe`), ctx.characters),
    EV: cap(truncateWords(firstSentence(synopsis), 24)),
  };
  const f = (t: string) => fill(t, vars);
  const pick = (list: string[]) => f(rng.pick(list));

  const hook = pick(first ? HOOKS_FIRST : HOOKS_LATER);
  const setup = first || !ctx.state.current_objective ? pick(SETUPS_FIRST) : pick(SETUPS_LATER);
  const inciting = cast.mentor && first ? pick(INCITING_MENTOR) : pick(INCITING);
  const comedy = pick(COMEDY[fruitKey(cast.hero.fruit)] ?? COMEDY.default);
  const danger = cast.villain && (rng.chance(0.65) || !cast.creature) ? pick(DANGER_VILLAIN) : cast.creature ? pick(DANGER_CREATURE) : pick(DANGER_VILLAIN);
  const climax = places.travels ? pick(CLIMAX_TRAVEL) : pick(CLIMAX_STAY);
  const cliffhanger =
    cast.villain && (rng.chance(0.6) || !cast.creature) ? pick(CLIFFHANGERS_VILLAIN) : cast.creature ? pick(CLIFFHANGERS_CREATURE) : pick(CLIFFHANGERS_VILLAIN);
  const tease = pick(TEASES.filter((t) => (cast.creature ? true : !t.includes("{CR}"))));

  const heroId = cast.hero.id;
  const loc = (l?: Location) => l?.id ?? "";
  // In later episodes the place named in the synopsis is where the inciting beats happen.
  const eventPlace = !first && places.named ? places.destination : places.start;
  const beats: Beat[] = [
    { beat: "hook", summary: `${H} trembles, holding ${object.phrase} as it glows`, location: loc(eventPlace), characters: [heroId], narration: hook, dialogue: [], emotion: "dread" },
    {
      beat: "scene_1",
      summary: first ? `${vars.L1} in warm light; ${H} naps without a care` : `${H} presses on, weary, ${object.phrase} hidden close`,
      location: loc(places.start),
      characters: [heroId, ...(cast.companion && !first ? [cast.companion.id] : [])],
      narration: setup,
      dialogue: [],
      emotion: first ? "cosy contentment" : "weary resolve",
    },
    {
      beat: "scene_2",
      summary: cast.mentor && first ? `${vars.M} arrives and hands ${H} ${object.phrase}` : `The inciting moment: ${lc(vars.EV)}`,
      location: loc(eventPlace),
      characters: [heroId, ...(cast.mentor && first ? [cast.mentor.id] : [])],
      narration: inciting,
      dialogue: cast.mentor && first ? [{ character_id: cast.mentor.id, line: rng.pick(MENTOR_LINES) }] : [],
      emotion: "ominous wonder",
    },
    {
      beat: "scene_3",
      summary: `${H} panics in the most fruit-like way possible`,
      location: loc(eventPlace),
      characters: [heroId, ...(cast.companion ? [cast.companion.id] : [])],
      narration: comedy,
      dialogue: cast.companion ? [{ character_id: cast.companion.id, line: rng.pick(COMPANION_LINES) }] : [],
      emotion: "absurd panic",
    },
    {
      beat: "scene_4",
      summary: danger.includes(vars.CR) && cast.creature ? `${vars.CR} lurks in the shadows, sniffing` : `A vision of ${vars.V} stirring in ${vars.L3}`,
      location: danger.includes(vars.CR) && cast.creature ? loc(places.destination) : loc(places.villainLoc),
      characters: danger.includes(vars.CR) && cast.creature ? [cast.creature.id] : cast.villain ? [cast.villain.id] : [heroId],
      narration: danger,
      dialogue: [],
      emotion: "terror",
    },
    {
      beat: "scene_5",
      summary: places.travels ? `${H} sets out toward ${vars.L2}` : `${H} stands firm`,
      location: places.travels ? loc(places.destination) : loc(places.start),
      characters: [heroId, ...(cast.companion ? [cast.companion.id] : []), ...(cast.ally && !first ? [cast.ally.id] : [])],
      narration: climax,
      dialogue: [
        { character_id: heroId, line: f(rng.pick(HERO_LINES)) },
        ...(cast.ally && !first ? [{ character_id: cast.ally.id, line: rng.pick(ALLY_LINES) }] : []),
      ],
      emotion: "resolve",
    },
    {
      beat: "cliffhanger",
      summary: cliffhanger.includes(vars.CR) && cast.creature ? `${vars.CR} follows in the dark` : `${vars.V} awakens in ${vars.L3}`,
      location: cliffhanger.includes(vars.CR) && cast.creature ? loc(places.destination) : loc(places.villainLoc),
      characters: cliffhanger.includes(vars.CR) && cast.creature ? [cast.creature.id] : cast.villain ? [cast.villain.id] : [heroId],
      narration: cliffhanger,
      dialogue: [],
      emotion: "menace",
    },
  ];

  fitWordBudget(beats, ctx, vars, rng);
  const usedEndings = ctx.previous.map((p) => p.title.toLowerCase().split(/\s+/).slice(-2).join(" "));
  const freshTitles = TITLES.map((t) => fill(t, vars)).filter((t) => !usedEndings.includes(t.toLowerCase().split(/\s+/).slice(-2).join(" ")));
  const title = rng.pick(freshTitles.length ? freshTitles : TITLES.map((t) => fill(t, vars)));
  return {
    title,
    summary: `${vars.EV}. ${stripEnd(climax)}. ${stripEnd(cliffhanger)}.`,
    hook: beats[0].narration,
    beats,
    cliffhanger: beats[beats.length - 1].narration,
    next_episode_tease: tease,
  };
}

const FILLERS = [
  "Nobody in {L1} had ever seen {HF} skin turn quite that pale.",
  "It was, by fruit standards, a catastrophe.",
  "Even the wind seemed to hold its breath.",
];

function fitWordBudget(beats: Beat[], ctx: StoryContext, vars: Record<string, string>, rng: Rng) {
  let total = spokenWords(beats);
  const fillers = rng.shuffle(FILLERS).map((t) => fill(t, vars));
  const growable = ["scene_1", "scene_3", "scene_5"];
  let i = 0;
  while (total < ctx.minWords && i < fillers.length) {
    const b = beats.find((x) => x.beat === growable[i % growable.length])!;
    b.narration = `${b.narration} ${fillers[i]}`;
    total = spokenWords(beats);
    i++;
  }
  // Too long: drop secondary dialogue first, then trim the longest narration.
  for (const b of [...beats].reverse()) {
    if (total <= ctx.maxWords) break;
    if (b.dialogue.length > 1) {
      b.dialogue = b.dialogue.slice(0, 1);
      total = spokenWords(beats);
    }
  }
  while (total > ctx.maxWords) {
    const longest = beats.filter((b) => b.beat !== "hook" && b.beat !== "cliffhanger").sort((a, b) => countWords(b.narration) - countWords(a.narration))[0];
    const sentences = longest.narration.match(/[^.!?]+[.!?]+/g) ?? [longest.narration];
    if (sentences.length <= 1) break;
    longest.narration = sentences.slice(0, -1).join("").trim();
    total = spokenWords(beats);
  }
}

// ---------------------------------------------------------------------------
// Shot list
// ---------------------------------------------------------------------------

const CAMERA_PLAN: Record<BeatId, [string, string][]> = {
  hook: [["extreme close-up", "dramatic push-in"]],
  scene_1: [
    ["extreme wide establishing shot", "crane reveal"],
    ["medium shot", "static locked-off"],
  ],
  scene_2: [
    ["low-angle wide shot", "slow dolly-in"],
    ["over-the-shoulder shot", "slow push-in"],
  ],
  scene_3: [
    ["medium close-up", "slow orbit"],
    ["two-shot", "handheld"],
  ],
  scene_4: [
    ["wide shot", "tilt up"],
    ["close-up", "dramatic push-in"],
  ],
  scene_5: [
    ["medium wide shot", "backwards tracking"],
    ["low-angle hero shot", "handheld chase"],
  ],
  cliffhanger: [["extreme close-up", "slow dolly-in"]],
};

const EMOTION_MOTION: [RegExp, string, string][] = [
  [/dread|fear|terror|panic/, "trembles, glances around nervously, then freezes", "tremble, glance around nervously, then freeze"],
  [/cosy|content|calm/, "shifts comfortably, breathing slowly, a lazy stretch", "shift comfortably, breathing slowly"],
  [/wonder|ominous/, "leans in slowly, eyes fixed on the glowing light", "lean in slowly, eyes fixed on the glowing light"],
  [/absurd|comedy/, "does a frantic double-take, hands flapping", "do a frantic double-take, hands flapping"],
  [/resolve|determin/, "takes a deep breath and steps forward with purpose", "take a deep breath and step forward together"],
  [/menace/, "turns slowly toward camera, smoke curling", "turn slowly toward camera"],
];

function motionFor(emotion: string, plural = false): string {
  for (const [re, one, many] of EMOTION_MOTION) if (re.test(emotion)) return plural ? many : one;
  return plural ? "move naturally, reacting to the moment" : "moves naturally, reacting to the moment";
}

const SOUND_BY_ENV: Record<string, string> = {
  village: "village ambience, birds",
  forest: "forest ambience, wind",
  mountain: "wind",
  volcanic: "fire, deep rumble",
  sanctuary: "water, soft wind",
  cave: "cave drips, echo",
  river: "water",
  castle: "wind, distant crowd",
};

function splitSentences(text: string): string[] {
  return (text.match(/[^.!?…]+(?:[.!?…]+["”’]?|$)/g) ?? [text]).map((s) => s.trim()).filter(Boolean);
}

export function mockShotList(ctx: ShotContext): ShotList {
  const rng = new Rng(`${ctx.series.id}:shots:${ctx.episodeNumber}:${ctx.beats.map((b) => b.narration).join("|")}`);
  const scale = ctx.targetDuration / 60;
  const byId = (id: string) => ctx.characters.find((c) => c.id === id);
  const locOf = (id: string) => ctx.locations.find((l) => l.id === id);
  const desc = (id: string) => {
    const c = byId(id);
    return c ? `the ${characterDescriptor(c)}` : id;
  };

  // Decide which beats get two shots (longest spoken beats first) to reach ~8–9 shots.
  const targetShots = Math.min(ctx.maxShots, Math.max(ctx.minShots, 9));
  const splittable = ctx.beats
    .filter((b) => b.beat !== "hook" && b.beat !== "cliffhanger")
    .map((b) => ({ b, words: spokenWords([b]), parts: splitSentences(b.narration).length + b.dialogue.length }))
    .filter((x) => x.parts >= 2)
    .sort((a, b) => b.words - a.words);
  const splitSet = new Set(splittable.slice(0, Math.max(0, targetShots - ctx.beats.length)).map((x) => x.b.beat));

  const shots: Shot[] = [];
  for (const beat of ctx.beats) {
    const [s, e] = BEAT_STRUCTURE[beat.beat] ?? [0, 8];
    const spoken = estimateTimings(
      [beat.narration, ...beat.dialogue.map((d) => d.line)].join(" "),
      ctx.wordsPerMinute,
    ).duration;
    const beatDuration = Math.max((e - s) * scale, spoken + 0.8 + beat.dialogue.length * 0.3);
    const loc = locOf(beat.location);
    const plan = CAMERA_PLAN[beat.beat] ?? [["medium shot", "slow push-in"]];
    const cast = beat.characters.map(desc);
    const who = cast.length ? cast.join(" and ") : "the scene";
    const envText = loc ? loc.description.split(",")[0] : beat.location;
    const sound = SOUND_BY_ENV[loc?.environment_type ?? ""] ?? "ambience";

    if (splitSet.has(beat.beat)) {
      const sentences = splitSentences(beat.narration);
      const half = Math.ceil(sentences.length / 2);
      const narrA = beat.dialogue.length && sentences.length === 1 ? beat.narration : sentences.slice(0, half).join(" ");
      const narrB = beat.dialogue.length && sentences.length === 1 ? "" : sentences.slice(half).join(" ");
      const wa = countWords(narrA) + 1;
      const wb = countWords(narrB) + beat.dialogue.reduce((n, d) => n + countWords(d.line), 0) + 1;
      const da = Math.max(2.5, (beatDuration * wa) / (wa + wb));
      const [fa, ma] = plan[0];
      const [fb, mb] = plan[1] ?? plan[0];
      shots.push(makeShot(beat, da, fa, ma, narrA, [], `${beat.summary}`, who, envText, loc?.lighting ?? "", sound, "cut"));
      shots.push(
        makeShot(beat, Math.max(2.5, beatDuration - da), fb, mb, narrB, beat.dialogue, `${cap(who)} ${motionFor(beat.emotion, cast.length > 1)}`, who, envText, loc?.lighting ?? "", sound, "cut"),
      );
    } else {
      const [fr, mv] = plan[0];
      shots.push(makeShot(beat, beatDuration, fr, mv, beat.narration, beat.dialogue, beat.summary, who, envText, loc?.lighting ?? "", sound, "cut"));
    }
  }

  // Transitions between beats.
  for (let i = 0; i < shots.length; i++) {
    const next = shots[i + 1];
    if (!next) shots[i].transition = "fade to black";
    else if (shots[i].beat === "hook") shots[i].transition = "flash";
    else if (next.beat === "cliffhanger") shots[i].transition = "fade to black";
    else if (next.beat !== shots[i].beat) shots[i].transition = rng.pick(["crossfade", "whip", "cut"]);
  }
  // Normalise the total duration to the target.
  const total = shots.reduce((s, x) => s + x.duration, 0);
  const k = ctx.targetDuration / total;
  for (const s of shots) s.duration = Math.max(2, Math.round(s.duration * k * 10) / 10);
  return { shots };

  function makeShot(
    beat: Beat,
    duration: number,
    framing: string,
    movement: string,
    narration: string,
    dialogue: Beat["dialogue"],
    action: string,
    who: string,
    env: string,
    lighting: string,
    sound: string,
    transition: string,
  ): Shot {
    const actionText = cap(action.replace(new RegExp(`\\b(${ctx.characters.map((c) => shortName(c)).join("|")})\\b`, "g"), (m) => {
      const c = ctx.characters.find((x) => shortName(x) === m);
      return c ? `the ${characterDescriptor(c)}` : m;
    }));
    const extra = beat.beat === "cliffhanger" || beat.beat === "hook" ? "riser, hit" : beat.beat === "scene_4" ? "creature, hit" : beat.beat === "scene_5" ? "footsteps, whoosh" : "";
    return {
      beat: beat.beat,
      duration: Math.round(duration * 10) / 10,
      description: beat.summary,
      characters: beat.characters,
      location: beat.location,
      action: actionText,
      subject_motion: `${cap(who)} ${motionFor(beat.emotion, beat.characters.length > 1)}`,
      camera_framing: framing,
      camera_movement: movement,
      environment: env,
      environment_motion: "",
      lighting: lighting || "dramatic cinematic key light with strong rim light",
      emotion: beat.emotion,
      facial_expression: "",
      transition,
      narration,
      dialogue,
      sound_design: [sound, extra, dialogue.length ? "" : ""].filter(Boolean).join(", "),
    };
  }
}

// ---------------------------------------------------------------------------
// Continuity
// ---------------------------------------------------------------------------

export function mockContinuity(ctx: ContinuityContext): ContinuityUpdate {
  const prev = ctx.previousState;
  const n = ctx.episodeNumber;
  const states = structuredClone(prev.character_states);
  const lastLocation = new Map<string, string>();
  const antagonists = new Set(ctx.characters.filter((c) => c.archetype === "antagonist").map((c) => c.id));
  for (const b of ctx.beats) {
    // A cutaway/vision of the villain's lair does not move the heroes there.
    const villainBeat = b.characters.some((id) => antagonists.has(id));
    for (const id of b.characters) if (b.location && (!villainBeat || antagonists.has(id))) lastLocation.set(id, b.location);
  }
  const hero = ctx.characters.find((c) => c.archetype === "hero");
  const synopsis = cleanSynopsis(ctx.synopsis).toLowerCase();
  const receives = /receiv|given|gets|takes|finds|steals|inherits|handed/.test(synopsis);
  const objectWord = OBJECT_WORDS.find((w) => synopsis.includes(w));
  for (const c of ctx.characters) {
    const s = states[c.id] ?? { location: "", status: "active", possessions: [], injuries: [], emotional_state: "", notes: "" };
    const where = lastLocation.get(c.id);
    if (where) s.location = where;
    const lastBeat = [...ctx.beats].reverse().find((b) => b.characters.includes(c.id));
    if (lastBeat?.emotion) s.emotional_state = lastBeat.emotion;
    states[c.id] = s;
  }
  const namedObject = prev.world_notes.join(" ").match(/\b[Tt]he ([A-Z][a-z]+)\b/)?.[1];
  if (hero && receives && objectWord) {
    const item = namedObject && ["ring", "seed", "object"].includes(objectWord) ? `the ${namedObject}` : `the ${objectWord}`;
    const s = states[hero.id];
    if (!s.possessions.includes(item)) s.possessions.push(item);
  }
  const villain = ctx.characters.find((c) => c.archetype === "antagonist");
  const villainInCliff = villain && ctx.beats.some((b) => b.beat === "cliffhanger" && b.characters.includes(villain.id));
  const dest = ctx.locations.find((l) => l.id === ctx.beats.find((b) => b.beat === "scene_5")?.location);
  const heroWasThere = hero && prev.character_states[hero.id]?.location === dest?.id;
  const tease = lc(stripEnd(ctx.nextEpisodeTease.replace(/^next time:\s*/i, "")));
  const carried = hero ? states[hero.id]?.possessions.find((p) => /^the [A-Z]/.test(p)) : undefined;
  const objective =
    dest && hero
      ? heroWasThere
        ? `${shortName(hero)} must carry ${carried ?? "the burden"} far from ${placeName(dest)}; ${tease}`
        : `${shortName(hero)} must press on through ${placeName(dest)}; ${tease}`
      : ctx.nextEpisodeTease || prev.current_objective;
  return {
    as_of_episode: n,
    current_objective: stripEnd(objective),
    major_events: [...prev.major_events, { episode: n, event: ctx.summary || ctx.episodeTitle }],
    character_states: states,
    relationships: prev.relationships,
    villain_state:
      villainInCliff && hero && villain
        ? `${shortName(villain)} is awake and aware of ${shortName(hero)}; the hunt has begun.`
        : prev.villain_state,
    unresolved_plot_points: [...prev.unresolved_plot_points, stripEnd(ctx.cliffhanger)].slice(-8),
    world_notes: prev.world_notes,
    episode_summaries: [
      ...prev.episode_summaries.filter((e) => e.episode !== n),
      { episode: n, title: ctx.episodeTitle, summary: ctx.summary, cliffhanger: ctx.cliffhanger },
    ],
  };
}

// ---------------------------------------------------------------------------
// Social metadata
// ---------------------------------------------------------------------------

export function mockMetadata(ctx: MetadataContext): Partial<EpisodeMetadata> {
  const rng = new Rng(`${ctx.series.id}:meta:${ctx.episodeNumber}:${ctx.title}`);
  const code = String(ctx.episodeNumber).padStart(2, "0");
  const hero = ctx.characters.find((c) => c.archetype === "hero") ?? ctx.characters[0];
  const villain = ctx.characters.find((c) => c.archetype === "antagonist") ?? ctx.characters.find((c) => c.archetype === "creature");
  const emoji = hero ? fruitEmoji(hero.fruit) : "🍎";
  const objectEmoji = /ring/i.test(ctx.summary + ctx.hook) ? "💍" : /sword/i.test(ctx.summary) ? "⚔️" : "✨";
  const suffix = ` | ${ctx.series.title} EP.${code}`;
  const hookTitle = truncateWords(stripEnd(ctx.hook), 9);
  const base = rng.pick([
    `${hookTitle} ${emoji}`,
    `${ctx.title} ${emoji}${objectEmoji}`,
    hero ? `${shortName(hero)} Was Not Ready for This ${emoji}` : `${ctx.title} ${emoji}`,
  ]);
  const room = 100 - suffix.length;
  const title = (base.length > room ? base.slice(0, room - 1) + "…" : base) + suffix;
  const hashtags = [...new Set(["#Shorts", ...ctx.series.settings.hashtags, "#FantasyAnimation", "#3DAnimation", "#EpicFantasy", "#Parody"])].slice(0, 10);
  const thumbText = rng.pick(
    villain
      ? [`${shortName(villain).toUpperCase()} IS AWAKE`, "IT WHISPERS", "DON'T LOOK BACK", "RUN."]
      : ["IT WHISPERS", "DON'T LOOK BACK", "NO GOING BACK"],
  );
  return {
    youtube_title: title,
    tiktok_caption: `${stripEnd(ctx.hook)}. ${emoji}${objectEmoji} Part ${ctx.episodeNumber} of ${ctx.series.title} — follow so you don't miss Part ${ctx.episodeNumber + 1}.`,
    instagram_caption: `EP.${code} — ${ctx.title} ${emoji} ${firstSentence(ctx.summary)}. Follow for Episode ${ctx.episodeNumber + 1}.`,
    youtube_description: [
      `Episode ${ctx.episodeNumber} of ${ctx.series.title} — an original, fruit-headed epic fantasy parody.`,
      firstSentence(ctx.summary) + ".",
      ctx.nextEpisodeTease,
    ].join("\n\n"),
    hashtags,
    thumbnail_text: thumbText,
    thumbnail_concept: hero
      ? `the ${characterDescriptor(hero)} frozen in fear${villain ? ` while the ${characterDescriptor(villain)} looms in the darkness behind` : ""}`
      : ctx.title,
    thumbnail_characters: [hero?.id, villain?.id].filter((x): x is string => Boolean(x)),
    next_episode_teaser: stripEnd(ctx.nextEpisodeTease.replace(/^next time:\s*/i, "")) + ".",
  };
}

export { BEATS };
