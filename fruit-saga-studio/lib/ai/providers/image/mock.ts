import type { ImageProvider, ImageRequest, ImageResult } from "@/lib/ai/types";
import { renderArtPng, type ArtSceneSpec } from "@/lib/ai/mock/art";
import { hashString } from "@/lib/ai/mock/rng";
import { ProviderError } from "@/lib/ai/retry";

/** Bump when the procedural renderer changes so cached mock frames are re-drawn. */
const RENDERER_VERSION = 4;

export class MockImageProvider implements ImageProvider {
  readonly name = "mock";
  readonly model = `procedural-svg-v${RENDERER_VERSION}`;
  readonly supportsNegativePrompt = false;
  readonly supportsSeed = true;
  readonly supportsReferences = false;

  async generate(req: ImageRequest): Promise<ImageResult> {
    // Testing aid: MOCK_FAIL_PATTERN=<regex> makes matching prompts fail, to exercise retries.
    const failPattern = process.env.MOCK_FAIL_PATTERN;
    if (failPattern && new RegExp(failPattern, "i").test(`${req.prompt} ${req.mockScene?.label ?? ""}`)) {
      throw new ProviderError(`mock: simulated failure (MOCK_FAIL_PATTERN=${failPattern})`, { provider: "mock", retryable: false });
    }
    const spec: ArtSceneSpec = req.mockScene
      ? { ...req.mockScene, width: req.width, height: req.height }
      : {
          kind: "keyframe",
          width: req.width,
          height: req.height,
          seed: req.seed || hashString(req.prompt),
          environment: "other",
          interior: false,
          palette: { sky: "#2a3346", ground: "#1d2418", accent: "#f5b642" },
          framing: "wide shot",
          emotion: "",
          timeOfDay: "golden",
          weather: "none",
          magicGlow: false,
          characters: [],
          speakerIds: [],
          label: "MOCK",
        };
    return { buffer: await renderArtPng(spec), ext: "png", cost: 0, model: this.model };
  }

  estimateCost() {
    return 0;
  }

  cacheParts(req: ImageRequest) {
    return { v: RENDERER_VERSION, prompt: req.prompt, w: req.width, h: req.height, seed: req.seed, scene: req.mockScene };
  }
}
