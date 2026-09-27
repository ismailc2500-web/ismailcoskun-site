import type { Beat, Character, EpisodeData, Location, Scene, SeriesState } from "@/lib/types";
import { BEAT_LABELS, BEAT_STRUCTURE, BEATS } from "@/lib/types";
import { renderPrompt } from "@/lib/prompts/template";
import { characterDescriptor } from "@/lib/prompts/engine";

/** Text formatting of world/state data for LLM prompts. */

export function formatCharacterList(chars: Character[]): string {
  return chars
    .map(
      (c) =>
        `- ${c.id} — ${c.display_name} — ${characterDescriptor(c)}; ${c.role}. Personality: ${c.personality}. Voice: ${c.voice_profile}.`,
    )
    .join("\n");
}

export function formatLocationList(locations: Location[]): string {
  return locations
    .map((l) => `- ${l.id} — ${l.name} — ${l.environment_type}: ${l.description}. Mood: ${l.atmosphere}.`)
    .join("\n");
}

export function formatContinuity(state: SeriesState, chars: Character[], locations: Location[]): string {
  const locName = (id: string) => locations.find((l) => l.id === id)?.name ?? id;
  const charName = (id: string) => chars.find((c) => c.id === id)?.display_name ?? id;
  const characterStates = Object.entries(state.character_states)
    .map(([id, s]) => {
      const parts = [
        `at ${locName(s.location) || "unknown"}`,
        `status ${s.status}`,
        s.possessions.length ? `carrying ${s.possessions.join(", ")}` : "",
        s.injuries.length ? `injuries: ${s.injuries.join(", ")}` : "",
        s.emotional_state ? `feeling ${s.emotional_state}` : "",
        s.notes,
      ].filter(Boolean);
      return `- ${id} (${charName(id)}): ${parts.join("; ")}`;
    })
    .join("\n");
  return renderPrompt("continuity_context", {
    as_of_episode: state.as_of_episode,
    current_objective: state.current_objective || "not established yet",
    character_states: characterStates || "- (no recorded states)",
    relationships: state.relationships.map((r) => `${r.a} & ${r.b}: ${r.status}`).join("; ") || "none recorded",
    villain_state: state.villain_state || "unknown",
    unresolved: state.unresolved_plot_points.map((p) => `- ${p}`).join("\n") || "- none",
    world_notes: state.world_notes.map((n) => `- ${n}`).join("\n") || "- none",
    major_events: state.major_events.map((e) => `- (ep ${e.episode}) ${e.event}`).join("\n") || "- none",
  });
}

export function formatStructure(targetDuration: number): string {
  const scale = targetDuration / 60;
  return BEATS.map((b) => {
    const [s, e] = BEAT_STRUCTURE[b];
    return `${(s * scale).toFixed(0)}–${(e * scale).toFixed(0)}s  ${BEAT_LABELS[b].toUpperCase()}`;
  }).join("\n");
}

export function formatBeatsAsScreenplay(beats: Beat[], chars: Character[]): string {
  const name = (id: string) => chars.find((c) => c.id === id)?.display_name.toUpperCase() ?? id.toUpperCase();
  return beats
    .map((b) => {
      const lines = [
        `[${BEAT_LABELS[b.beat] ?? b.beat}] location: ${b.location}; characters: ${b.characters.join(", ") || "none"}; emotion: ${b.emotion}`,
        `  ${b.summary}`,
      ];
      if (b.narration) lines.push(`  NARRATOR: ${b.narration}`);
      for (const d of b.dialogue) lines.push(`  ${name(d.character_id)}: ${d.line}`);
      return lines.join("\n");
    })
    .join("\n\n");
}

export function formatScenesAsScript(episode: Pick<EpisodeData, "title" | "hook" | "cliffhanger">, scenes: Scene[], chars: Character[]): string {
  const name = (id: string) => chars.find((c) => c.id === id)?.display_name.toUpperCase() ?? id.toUpperCase();
  return scenes
    .map((s) => {
      const lines = [`${s.scene_id} (${BEAT_LABELS[s.beat]}, ${s.duration}s) @${s.location}: ${s.description || s.action}`];
      if (s.narration) lines.push(`  NARRATOR: ${s.narration}`);
      for (const d of s.dialogue) lines.push(`  ${name(d.character_id)}: ${d.line}`);
      return lines.join("\n");
    })
    .join("\n");
}

export function countWords(text: string): number {
  return (text.match(/[\p{L}\p{N}'’-]+/gu) ?? []).length;
}

export function spokenWords(beatsOrScenes: { narration: string; dialogue: { line: string }[] }[]): number {
  return beatsOrScenes.reduce(
    (sum, b) => sum + countWords(b.narration) + b.dialogue.reduce((s, d) => s + countWords(d.line), 0),
    0,
  );
}
