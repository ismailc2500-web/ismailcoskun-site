import fs from "node:fs";
import { ffprobe, runFfmpeg } from "@/lib/video/ffmpeg";
import { tempFile } from "@/lib/ai/cache";

export const SAMPLE_RATE = 48000;

/** Converts any audio file/buffer to 48 kHz mono 16-bit WAV (the pipeline's working format). */
export async function toWorkingWav(input: string | Buffer, inputExt = "bin"): Promise<{ wavPath: string; duration: number }> {
  let src = typeof input === "string" ? input : "";
  if (typeof input !== "string") {
    src = tempFile(inputExt);
    fs.writeFileSync(src, input);
  }
  const out = tempFile("wav");
  await runFfmpeg(["-i", src, "-ac", "1", "-ar", String(SAMPLE_RATE), "-c:a", "pcm_s16le", out]);
  if (typeof input !== "string") fs.rmSync(src, { force: true });
  const { duration } = await ffprobe(out);
  return { wavPath: out, duration };
}
