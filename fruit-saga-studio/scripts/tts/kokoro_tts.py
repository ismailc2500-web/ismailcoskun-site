#!/usr/bin/env python3
"""Free, offline neural narration with Kokoro-82M (Apache-2.0) for the `local` TTS provider.

Setup (once):
    python3 -m venv ~/.venvs/kokoro && ~/.venvs/kokoro/bin/pip install kokoro-onnx soundfile
    mkdir -p cache/tts-models && cd cache/tts-models
    curl -LO https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx
    curl -LO https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin

.env:
    TTS_PROVIDER=local
    LOCAL_TTS_COMMAND=~/.venvs/kokoro/bin/python scripts/tts/kokoro_tts.py --voice {voice} --text-file {text_file} --output {output}

Voices come from each character's (and the series narrator's) `local_voice` field:
    bm_george            a single Kokoro voice (a* = American, b* = British)
    bm_george+am_onyx    an equal blend of several voices
    bm_lewis@0.9         any of the above with a speed factor
An empty or unknown voice falls back to --default-voice.
"""

import argparse
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MODELS = os.path.join(ROOT, "cache", "tts-models")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--text-file")
    ap.add_argument("--text")
    ap.add_argument("--output", required=True)
    ap.add_argument("--voice", default="")
    ap.add_argument("--default-voice", default=os.environ.get("KOKORO_DEFAULT_VOICE", "bm_george"))
    ap.add_argument("--speed", type=float, default=float(os.environ.get("KOKORO_SPEED", "1.0")))
    ap.add_argument("--model", default=os.environ.get("KOKORO_MODEL", os.path.join(MODELS, "kokoro-v1.0.onnx")))
    ap.add_argument("--voices-file", default=os.environ.get("KOKORO_VOICES", os.path.join(MODELS, "voices-v1.0.bin")))
    args = ap.parse_args()

    text = open(args.text_file, encoding="utf-8").read() if args.text_file else (args.text or "")
    text = " ".join(text.split())
    if not text:
        print("kokoro_tts: empty text", file=sys.stderr)
        return 2
    for f in (args.model, args.voices_file):
        if not os.path.exists(f):
            print(f"kokoro_tts: missing model file {f} (see the setup notes at the top of this script)", file=sys.stderr)
            return 2

    import soundfile as sf
    from kokoro_onnx import Kokoro

    kokoro = Kokoro(args.model, args.voices_file)
    available = set(kokoro.get_voices())

    spec, speed = args.voice.strip(), args.speed
    if "@" in spec:
        spec, factor = spec.rsplit("@", 1)
        speed *= float(factor)
    names = [n.strip() for n in spec.split("+") if n.strip()]
    if not names or any(n not in available for n in names):
        if spec:
            print(f"kokoro_tts: unknown voice '{spec}', using {args.default_voice}", file=sys.stderr)
        names = [args.default_voice]

    style = sum(kokoro.get_voice_style(n) for n in names) / len(names) if len(names) > 1 else names[0]
    lang = "en-gb" if names[0].startswith("b") else "en-us"
    samples, rate = kokoro.create(text, voice=style, speed=speed, lang=lang)
    sf.write(args.output, samples, rate)
    return 0


if __name__ == "__main__":
    sys.exit(main())
