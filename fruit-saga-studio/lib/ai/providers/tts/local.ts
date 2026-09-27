import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import { config } from "@/lib/config";
import type { TTSOptions, TTSProvider, TTSResult, TTSVoiceConfig } from "@/lib/ai/types";
import { ProviderError } from "@/lib/ai/retry";
import { tempFile } from "@/lib/ai/cache";
import { toWorkingWav } from "@/lib/audio/convert";

/**
 * Free local TTS through any command-line engine. Configure LOCAL_TTS_COMMAND
 * with the placeholders {text}, {text_file}, {output} and {voice}, e.g.
 *
 *   LOCAL_TTS_COMMAND=espeak-ng -v en-gb -s 150 -w {output} {text}
 *   LOCAL_TTS_COMMAND=say -v Daniel -o {output}.aiff {text}
 *   LOCAL_TTS_COMMAND=piper --model en_GB-alan-medium.onnx --output_file {output} --input_file {text_file}
 *
 * Without a command it auto-detects `say` (macOS) or `espeak-ng`/`espeak`.
 * No shell is involved: arguments are passed directly to the process.
 */
export class LocalTTSProvider implements TTSProvider {
  readonly name = "local";
  readonly model: string;
  private template: string;

  constructor() {
    this.template = config.localTts.command || detectDefault();
    this.model = this.template ? this.template.split(/\s+/)[0] : "none";
  }

  async generate(text: string, voice: TTSVoiceConfig, options: TTSOptions): Promise<TTSResult> {
    void options;
    if (!this.template) {
      throw new ProviderError("local TTS: no engine found. Install espeak-ng / piper or set LOCAL_TTS_COMMAND.", {
        provider: "local",
        retryable: false,
      });
    }
    const output = tempFile("wav");
    const textFile = tempFile("txt");
    fs.writeFileSync(textFile, text);
    const args = splitArgs(this.template).map((a) =>
      a
        .replace(/\{text\}/g, text)
        .replace(/\{text_file\}/g, textFile)
        .replace(/\{output\}/g, output)
        .replace(/\{voice\}/g, voice.local_voice || ""),
    );
    const [cmd, ...rest] = args;
    await new Promise<void>((resolve, reject) => {
      const child = spawn(cmd, rest.filter((a) => a !== ""));
      let err = "";
      child.stderr.on("data", (c: Buffer) => (err += c.toString()));
      child.on("error", (e) => reject(new ProviderError(`local TTS: ${e.message}`, { provider: "local", retryable: false })));
      child.on("close", (code) => (code === 0 ? resolve() : reject(new ProviderError(`local TTS exited ${code}: ${err.slice(-400)}`, { provider: "local" }))));
    });
    const produced = [output, `${output}.aiff`, `${output}.wav`].find((p) => fs.existsSync(p) && fs.statSync(p).size > 0);
    if (!produced) throw new ProviderError("local TTS produced no audio file", { provider: "local", retryable: false });
    const { wavPath, duration } = await toWorkingWav(produced);
    for (const f of [output, `${output}.aiff`, textFile]) fs.rmSync(f, { force: true });
    return { wavPath, duration, cost: 0, model: this.model };
  }

  estimateCost() {
    return 0;
  }

  cacheParts(text: string, voice: TTSVoiceConfig) {
    return { text, voice: voice.local_voice || "", command: this.template };
  }
}

function has(cmd: string): boolean {
  try {
    return spawnSync(process.platform === "win32" ? "where" : "which", [cmd]).status === 0;
  } catch {
    return false;
  }
}

function detectDefault(): string {
  if (process.platform === "darwin" && has("say")) return "say -o {output}.aiff {text}";
  if (has("espeak-ng")) return "espeak-ng -v en-gb -s 150 -w {output} {text}";
  if (has("espeak")) return "espeak -v en-gb -s 150 -w {output} {text}";
  return "";
}

function splitArgs(template: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(template))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}
