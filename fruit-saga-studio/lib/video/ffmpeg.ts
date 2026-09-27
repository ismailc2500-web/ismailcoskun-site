import { spawn } from "node:child_process";
import fs from "node:fs";
import { config } from "@/lib/config";

export class FfmpegError extends Error {
  constructor(
    message: string,
    public stderr: string,
  ) {
    super(message);
    this.name = "FfmpegError";
  }
}

export interface FfmpegOptions {
  cwd?: string;
  /** Called with the current output position in seconds. */
  onProgress?: (seconds: number) => void;
  /** Appends the command and stderr to this file. */
  logFile?: string;
  signal?: AbortSignal;
}

/** Runs ffmpeg with the given arguments (no shell involved, so no quoting issues). */
export function runFfmpeg(args: string[], opts: FfmpegOptions = {}): Promise<{ stderr: string }> {
  const fullArgs = ["-hide_banner", "-nostdin", "-y", ...args];
  if (opts.onProgress) fullArgs.splice(3, 0, "-progress", "pipe:1", "-nostats");
  return new Promise((resolve, reject) => {
    const child = spawn(config.ffmpegPath, fullArgs, { cwd: opts.cwd, signal: opts.signal });
    let stderr = "";
    let stdoutBuf = "";
    child.stdout.on("data", (chunk: Buffer) => {
      if (!opts.onProgress) return;
      stdoutBuf += chunk.toString();
      const lines = stdoutBuf.split("\n");
      stdoutBuf = lines.pop() ?? "";
      for (const line of lines) {
        const m = line.match(/^out_time_(?:us|ms)=(\d+)/);
        if (m) opts.onProgress(Number(m[1]) / 1_000_000);
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 200_000) stderr = stderr.slice(-100_000);
    });
    child.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") {
        reject(
          new FfmpegError(
            `FFmpeg not found at "${config.ffmpegPath}". Install FFmpeg (see README) or set FFMPEG_PATH.`,
            "",
          ),
        );
      } else reject(err);
    });
    child.on("close", (code) => {
      if (opts.logFile) {
        try {
          fs.appendFileSync(opts.logFile, `\n$ ffmpeg ${fullArgs.map(quoteArg).join(" ")}\n${stderr.slice(-8000)}\n`);
        } catch {
          /* logging is best-effort */
        }
      }
      if (code === 0) resolve({ stderr });
      else {
        const tail = stderr.trim().split("\n").slice(-12).join("\n");
        reject(new FfmpegError(`ffmpeg exited with code ${code}:\n${tail}`, stderr));
      }
    });
  });
}

function quoteArg(a: string) {
  return /[\s"'()[\];,]/.test(a) ? `'${a.replace(/'/g, "'\\''")}'` : a;
}

export interface ProbeResult {
  duration: number;
  width: number | null;
  height: number | null;
  hasVideo: boolean;
  hasAudio: boolean;
  fps: number | null;
}

export function ffprobe(file: string): Promise<ProbeResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(config.ffprobePath, [
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      file,
    ]);
    let out = "";
    let err = "";
    child.stdout.on("data", (c: Buffer) => (out += c.toString()));
    child.stderr.on("data", (c: Buffer) => (err += c.toString()));
    child.on("error", (e: NodeJS.ErrnoException) =>
      reject(e.code === "ENOENT" ? new FfmpegError(`ffprobe not found at "${config.ffprobePath}"`, "") : e),
    );
    child.on("close", (code) => {
      if (code !== 0) return reject(new FfmpegError(`ffprobe failed for ${file}: ${err.trim()}`, err));
      try {
        const json = JSON.parse(out) as {
          format?: { duration?: string };
          streams?: { codec_type: string; width?: number; height?: number; duration?: string; r_frame_rate?: string }[];
        };
        const video = json.streams?.find((s) => s.codec_type === "video");
        const audio = json.streams?.find((s) => s.codec_type === "audio");
        const [n, d] = (video?.r_frame_rate ?? "0/1").split("/").map(Number);
        resolve({
          duration: Number(json.format?.duration ?? video?.duration ?? audio?.duration ?? 0),
          width: video?.width ?? null,
          height: video?.height ?? null,
          hasVideo: Boolean(video),
          hasAudio: Boolean(audio),
          fps: d ? n / d : null,
        });
      } catch (e) {
        reject(e);
      }
    });
  });
}

export async function checkFfmpeg(): Promise<{ ok: boolean; version?: string; error?: string; missingFilters: string[] }> {
  const required = ["zoompan", "xfade", "sidechaincompress", "loudnorm", "ass", "aevalsrc", "amix", "gblur"];
  return new Promise((resolve) => {
    const child = spawn(config.ffmpegPath, ["-hide_banner", "-filters"]);
    let out = "";
    child.stdout.on("data", (c: Buffer) => (out += c.toString()));
    child.on("error", (e) => resolve({ ok: false, error: e.message, missingFilters: required }));
    child.on("close", () => {
      const missing = required.filter((f) => !new RegExp(`\\s${f}\\s`).test(out));
      const v = spawn(config.ffmpegPath, ["-version"]);
      let vout = "";
      v.stdout.on("data", (c: Buffer) => (vout += c.toString()));
      v.on("error", (e) => resolve({ ok: false, error: e.message, missingFilters: missing }));
      v.on("close", () =>
        resolve({ ok: missing.length === 0, version: vout.split("\n")[0], missingFilters: missing }),
      );
    });
  });
}

/** Escapes a path for use inside a filtergraph option value (e.g. ass=filename=...). */
export function escapeFilterValue(value: string): string {
  return value.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'").replace(/,/g, "\\,");
}
