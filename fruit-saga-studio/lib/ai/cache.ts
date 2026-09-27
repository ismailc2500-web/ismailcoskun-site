import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { paths } from "@/lib/config";
import { getCached, putCached, touchCached, toAbsolute } from "@/lib/db/repos/assets";

/**
 * Content-addressed generation cache. The key is a SHA-256 of everything that
 * influences the output (provider, model, prompt, seed, size, quality, input
 * image hash…). An identical request is never paid for twice.
 */

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

export function hashKey(parts: unknown): string {
  return crypto.createHash("sha256").update(stableStringify(parts)).digest("hex");
}

const fileHashMemo = new Map<string, { sig: string; hash: string }>();

export function fileHash(file: string): string {
  const stat = fs.statSync(file);
  const sig = `${stat.size}:${stat.mtimeMs}`;
  const memo = fileHashMemo.get(file);
  if (memo && memo.sig === sig) return memo.hash;
  const hash = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  fileHashMemo.set(file, { sig, hash });
  return hash;
}

export function cachePathFor(kind: string, key: string, ext: string): string {
  return path.join(/*turbopackIgnore: true*/ paths.cache, kind, key.slice(0, 2), `${key}.${ext}`);
}

export interface CachedResult {
  path: string;
  cached: boolean;
  cost: number;
  meta: Record<string, unknown>;
}

export interface GenerateOutput {
  /** Either an in-memory buffer or a temporary file that will be moved into the cache. */
  buffer?: Buffer;
  filePath?: string;
  ext: string;
  cost: number;
  meta?: Record<string, unknown>;
}

export function lookupCache(key: string): CachedResult | null {
  const hit = getCached(key);
  if (!hit) return null;
  return { path: toAbsolute(hit.path), cached: true, cost: 0, meta: hit.meta };
}

export async function cachedGenerate(opts: {
  kind: string;
  key: string;
  provider: string;
  model: string;
  /** Skip the lookup (explicit "regenerate"); the result still refreshes the cache. */
  force?: boolean;
  generate: () => Promise<GenerateOutput>;
}): Promise<CachedResult> {
  if (!opts.force) {
    const hit = lookupCache(opts.key);
    if (hit) {
      touchCached(opts.key);
      return hit;
    }
  }
  const out = await opts.generate();
  const dest = cachePathFor(opts.kind, opts.key, out.ext);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (out.buffer) fs.writeFileSync(dest, out.buffer);
  else if (out.filePath) moveFile(out.filePath, dest);
  else throw new Error("cachedGenerate: generator returned neither buffer nor filePath");
  const meta = out.meta ?? {};
  putCached({ cache_key: opts.key, kind: opts.kind, path: dest, provider: opts.provider, model: opts.model, cost: out.cost, meta });
  return { path: dest, cached: false, cost: out.cost, meta };
}

export function moveFile(from: string, to: string) {
  try {
    fs.renameSync(from, to);
  } catch {
    fs.copyFileSync(from, to);
    fs.rmSync(from, { force: true });
  }
}

export function tempFile(ext: string): string {
  const dir = path.join(paths.cache, "tmp");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${Date.now()}-${crypto.randomBytes(6).toString("hex")}.${ext}`);
}
