import { getSeries, listCharacters, listLocations } from "@/lib/db/repos/series";
import type { Aspect, PromptContext } from "@/lib/prompts/engine";
import type { Platform } from "@/lib/types";

export function aspectForPlatform(platform: Platform): Aspect {
  return platform === "youtube" ? "16:9" : "9:16";
}

export function promptContext(seriesId: string, aspect: Aspect): PromptContext {
  const series = getSeries(seriesId);
  if (!series) throw new Error(`Series "${seriesId}" not found`);
  return { series, characters: listCharacters(seriesId), locations: listLocations(seriesId), aspect };
}
