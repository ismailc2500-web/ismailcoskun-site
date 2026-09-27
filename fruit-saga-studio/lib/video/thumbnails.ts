import path from "node:path";
import sharp from "sharp";
import type { RenderMode } from "@/lib/config";
import type { Episode, Scene } from "@/lib/types";
import type { ImageProvider, ImageRequest } from "@/lib/ai/types";
import { getImageProvider, resolveProvider } from "@/lib/ai/registry";
import { cachedGenerate, hashKey } from "@/lib/ai/cache";
import { withRetry } from "@/lib/ai/retry";
import { artSceneForThumbnail, escapeXml } from "@/lib/ai/mock/art";
import { buildThumbnailPrompts, findLocation, thumbnailCharacters, type PromptContext } from "@/lib/prompts/engine";
import { loadGlobalNegatives } from "@/lib/prompts/template";
import { hashString } from "@/lib/ai/mock/rng";
import { ensureDir, type EpisodePaths } from "@/lib/pipeline/paths";
import { toAbsolute } from "@/lib/db/repos/assets";

/**
 * Thumbnails: the image model renders the art (1–3 big expressive faces, clear
 * conflict, empty space for text) and the app overlays the title text, so the
 * text is always crisp and correctly spelled.
 */

const SIZES = {
  vertical: { width: 1080, height: 1920, file: "thumbnail_vertical.png", aspect: "9:16" as const },
  landscape: { width: 1280, height: 720, file: "thumbnail_youtube.png", aspect: "16:9" as const },
};

function textOverlay(width: number, height: number, text: string, episodeNumber: number, layout: "vertical" | "landscape", accent: string): Buffer {
  const words = text.toUpperCase().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  const perLine = layout === "vertical" ? 2 : 2;
  for (let i = 0; i < words.length; i += perLine) lines.push(words.slice(i, i + perLine).join(" "));
  // Fit the font so the longest line uses at most ~88% (vertical) / 55% (landscape) of the width.
  const longest = Math.max(...lines.map((l) => l.length), 1);
  const maxWidth = layout === "vertical" ? width * 0.88 : width * 0.55;
  const fs = Math.min(layout === "vertical" ? width * 0.15 : height * 0.17, maxWidth / (longest * 0.66));
  const x = layout === "vertical" ? width / 2 : width * 0.05;
  const anchor = layout === "vertical" ? "middle" : "start";
  const y0 = layout === "vertical" ? height * 0.12 + fs : height * 0.18 + fs;
  const tspans = lines
    .map((l, i) => `<text x="${x}" y="${y0 + i * fs * 1.05}" text-anchor="${anchor}" font-family="DejaVu Sans, Arial Black, Impact, Helvetica, sans-serif" font-weight="900" font-size="${fs}" fill="#FFFFFF" stroke="#000000" stroke-width="${fs * 0.09}" paint-order="stroke" letter-spacing="${fs * 0.01}">${escapeXml(l)}</text>`)
    .join("");
  const badgeW = fs * 1.7;
  const badgeH = fs * 0.62;
  const bx = layout === "vertical" ? width / 2 - badgeW / 2 : x;
  const by = y0 + lines.length * fs * 1.05 - fs * 0.45;
  const badge = `<rect x="${bx}" y="${by}" width="${badgeW}" height="${badgeH}" rx="${badgeH * 0.2}" fill="${accent}"/><text x="${bx + badgeW / 2}" y="${by + badgeH * 0.74}" text-anchor="middle" font-family="DejaVu Sans, Arial Black, Helvetica, sans-serif" font-weight="900" font-size="${badgeH * 0.62}" fill="#111">EP.${String(episodeNumber).padStart(2, "0")}</text>`;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${tspans}${badge}</svg>`);
}

export interface ThumbnailPlan {
  layout: "vertical" | "landscape";
  provider: ImageProvider;
  req: ImageRequest;
  key: string;
  estimate: number;
}

/** Thumbnail requests (shared with the cost estimator so cache hits are known up front). */
export function planThumbnails(episode: Episode, scenes: Scene[], ctx: PromptContext, mode: RenderMode): ThumbnailPlan[] {
  const provider = getImageProvider(mode);
  const quality = resolveProvider("image", mode).quality;
  const chars = thumbnailCharacters(episode.metadata, scenes, ctx);
  const climax = scenes.find((s) => s.beat === "scene_5") ?? scenes[0];
  const loc = climax ? findLocation(climax.location, ctx) : undefined;
  const prompts =
    episode.metadata.thumbnail_prompt_vertical && episode.metadata.thumbnail_prompt_landscape
      ? { vertical: episode.metadata.thumbnail_prompt_vertical, landscape: episode.metadata.thumbnail_prompt_landscape }
      : buildThumbnailPrompts(episode.metadata, scenes, ctx);
  const negative = [...loadGlobalNegatives(), ...chars.flatMap((c) => c.negative_traits.map((t) => t.replace(/^no\s+/i, "")))].join(", ");
  return (["vertical", "landscape"] as const).map((layout) => {
    const size = SIZES[layout];
    const seed = hashString(`${episode.series_id}:${episode.episode_number}:thumb:${layout}`);
    const req: ImageRequest = {
      prompt: prompts[layout],
      negativePrompt: negative,
      width: size.width,
      height: size.height,
      seed,
      quality,
      referenceImages: provider.supportsReferences ? chars.flatMap((c) => c.reference_images.map(toAbsolute)) : undefined,
      mockScene: provider.name === "mock" ? artSceneForThumbnail(chars, loc, size.width, size.height, seed) : undefined,
    };
    const key = hashKey({ kind: "thumbnail", provider: provider.name, model: provider.model, parts: provider.cacheParts(req) });
    return { layout, provider, req, key, estimate: provider.estimateCost(req) };
  });
}

export async function renderThumbnails(
  episode: Episode,
  scenes: Scene[],
  ctx: PromptContext,
  mode: RenderMode,
  paths: EpisodePaths,
): Promise<{ vertical: string; landscape: string; cost: number; cached: boolean; provider: string; model: string }> {
  const plans = planThumbnails(episode, scenes, ctx, mode);
  const chars = thumbnailCharacters(episode.metadata, scenes, ctx);
  const accent = chars[0]?.palette.accent ?? "#f5b642";
  const text = episode.metadata.thumbnail_text || episode.title;
  ensureDir(paths.thumbnails);
  let cost = 0;
  let allCached = true;
  const out: Record<"vertical" | "landscape", string> = { vertical: "", landscape: "" };
  for (const plan of plans) {
    const size = SIZES[plan.layout];
    const res = await cachedGenerate({
      kind: "thumbnail",
      key: plan.key,
      provider: plan.provider.name,
      model: plan.provider.model,
      generate: async () => {
        const r = await withRetry(() => plan.provider.generate(plan.req));
        return { buffer: r.buffer, ext: r.ext, cost: r.cost };
      },
    });
    cost += res.cost;
    allCached &&= res.cached;
    const file = path.join(/*turbopackIgnore: true*/ paths.thumbnails, size.file);
    await sharp(res.path)
      .resize(size.width, size.height, { fit: "cover", position: sharp.strategy.attention })
      .composite([{ input: textOverlay(size.width, size.height, text, episode.episode_number, plan.layout, accent) }])
      .png()
      .toFile(file);
    out[plan.layout] = file;
  }
  return { ...out, cost, cached: allCached, provider: plans[0].provider.name, model: plans[0].provider.model };
}
