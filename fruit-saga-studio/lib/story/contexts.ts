import type { Beat, Character, Location, Series, SeriesState } from "@/lib/types";

/** Structured inputs of each LLM task (also consumed by the offline mock writer). */

export interface PreviousEpisode {
  episode_number: number;
  title: string;
  summary: string;
  cliffhanger: string;
  next_episode_tease: string;
}

export interface StoryContext {
  series: Series;
  episodeNumber: number;
  synopsis: string;
  tone: string;
  targetDuration: number;
  wordsPerMinute: number;
  minWords: number;
  maxWords: number;
  characters: Character[];
  locations: Location[];
  state: SeriesState;
  previous: PreviousEpisode[];
}

export interface ShotContext {
  series: Series;
  episodeNumber: number;
  targetDuration: number;
  minShots: number;
  maxShots: number;
  wordsPerMinute: number;
  beats: Beat[];
  characters: Character[];
  locations: Location[];
}

export interface ContinuityContext {
  series: Series;
  episodeNumber: number;
  episodeTitle: string;
  summary: string;
  cliffhanger: string;
  nextEpisodeTease: string;
  synopsis: string;
  beats: Beat[];
  previousState: SeriesState;
  characters: Character[];
  locations: Location[];
}

export interface MetadataContext {
  series: Series;
  episodeNumber: number;
  title: string;
  summary: string;
  hook: string;
  cliffhanger: string;
  nextEpisodeTease: string;
  characters: Character[];
}
