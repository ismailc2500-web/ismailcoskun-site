import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { paths } from "@/lib/config";

/**
 * Serves generated media (output/, cache/) and uploaded references
 * (data/series/<id>/references/) with HTTP Range support for video seeking.
 * Only those roots are reachable — no path traversal outside them.
 */

export const dynamic = "force-dynamic";

const ALLOWED_ROOTS = [paths.output, paths.cache, paths.series];

const TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".srt": "text/plain; charset=utf-8",
  ".ass": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".log": "text/plain; charset=utf-8",
};

export async function GET(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const parts = (await params).path.map((p) => decodeURIComponent(p));
  const abs = path.resolve(paths.root, ...parts);
  const allowed = ALLOWED_ROOTS.some((root) => abs === root || abs.startsWith(root + path.sep));
  if (!allowed || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    return new Response("Not found", { status: 404 });
  }
  const stat = fs.statSync(abs);
  const type = TYPES[path.extname(abs).toLowerCase()] ?? "application/octet-stream";
  const url = new URL(req.url);
  const headers: Record<string, string> = {
    "Content-Type": type,
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-cache",
    "Last-Modified": stat.mtime.toUTCString(),
  };
  if (url.searchParams.has("download")) headers["Content-Disposition"] = `attachment; filename="${path.basename(abs)}"`;

  const range = req.headers.get("range");
  if (range) {
    const m = range.match(/bytes=(\d*)-(\d*)/);
    let start = m?.[1] ? Number(m[1]) : 0;
    let end = m?.[2] ? Number(m[2]) : stat.size - 1;
    if (!m?.[1] && m?.[2]) {
      start = Math.max(0, stat.size - Number(m[2]));
      end = stat.size - 1;
    }
    if (start >= stat.size || end >= stat.size || start > end) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${stat.size}` } });
    }
    const stream = Readable.toWeb(fs.createReadStream(abs, { start, end })) as ReadableStream;
    return new Response(stream, {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${stat.size}`, "Content-Length": String(end - start + 1) },
    });
  }
  const stream = Readable.toWeb(fs.createReadStream(abs)) as ReadableStream;
  return new Response(stream, { headers: { ...headers, "Content-Length": String(stat.size) } });
}
