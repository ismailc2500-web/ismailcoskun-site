import fs from "node:fs";
import sharp from "sharp";
import { ProviderError, sleep } from "@/lib/ai/retry";
import { fetchBuffer } from "@/lib/ai/http";
import { tempFile } from "@/lib/ai/cache";

/** Shared helpers for asynchronous (submit → poll → download) video APIs. */

export async function pollUntil<T>(
  provider: string,
  check: () => Promise<{ done: boolean; failed?: string; progress?: number; value?: T }>,
  opts: { intervalMs?: number; timeoutMs?: number; onProgress?: (p: number) => void } = {},
): Promise<T> {
  const interval = opts.intervalMs ?? 5000;
  const deadline = Date.now() + (opts.timeoutMs ?? 20 * 60_000);
  while (Date.now() < deadline) {
    const r = await check();
    if (r.failed) throw new ProviderError(`${provider}: generation failed — ${r.failed}`, { provider, retryable: true });
    if (r.progress !== undefined) opts.onProgress?.(r.progress);
    if (r.done && r.value !== undefined) return r.value;
    await sleep(interval);
  }
  throw new ProviderError(`${provider}: timed out waiting for the video`, { provider, retryable: true });
}

export async function downloadToTemp(provider: string, url: string, headers: Record<string, string> = {}): Promise<string> {
  const buf = await fetchBuffer(url, { provider, headers, timeoutMs: 300_000, redirect: "follow" });
  const out = tempFile("mp4");
  fs.writeFileSync(out, buf);
  return out;
}

/** JPEG data URI of a keyframe (smaller than PNG — most APIs cap inline image size). */
export async function imageDataUri(imagePath: string, maxSide = 1536): Promise<string> {
  const buf = await sharp(imagePath).resize({ width: maxSide, height: maxSide, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
  return `data:image/jpeg;base64,${buf.toString("base64")}`;
}

export async function imageBase64(imagePath: string, maxSide = 1536): Promise<string> {
  return (await imageDataUri(imagePath, maxSide)).split(",")[1];
}

/** Compacts a long structured video prompt for APIs with small prompt limits. */
export function compactPrompt(prompt: string, maxChars: number): string {
  if (prompt.length <= maxChars) return prompt;
  const lines = prompt.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const priority = [
    lines[0],
    ...lines.filter((l) => /^(SUBJECT MOTION|CAMERA MOTION|FACIAL EXPRESSION|ENVIRONMENT MOTION):/.test(l)).map((l) => l.replace(/^[A-Z ]+:\s*/, "")),
  ];
  let out = "";
  for (const part of priority) {
    if ((out + " " + part).length > maxChars) break;
    out = out ? `${out} ${part}` : part;
  }
  return out || prompt.slice(0, maxChars);
}

export function roundUpDuration(requested: number, supported: number[]): number {
  const sorted = [...supported].sort((a, b) => a - b);
  return sorted.find((d) => d >= requested - 0.25) ?? sorted[sorted.length - 1];
}
