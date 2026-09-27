import type { VideoProvider, VideoRequest, VideoResult } from "@/lib/ai/types";
import { renderMotionClip } from "@/lib/video/motion";
import { tempFile } from "@/lib/ai/cache";

/** Zero-cost "animatic": animates the keyframe with the shot's camera move. */
export class MockVideoProvider implements VideoProvider {
  readonly name = "mock";
  readonly model = "ken-burns-v2";
  readonly durations = [];
  constructor(private preview = true) {}

  async generate(req: VideoRequest, onProgress?: (p: number) => void): Promise<VideoResult> {
    const out = tempFile("mp4");
    onProgress?.(0.1);
    await renderMotionClip({
      imagePath: req.imagePath,
      outPath: out,
      width: req.width,
      height: req.height,
      duration: req.duration,
      fps: req.fps,
      movement: req.cameraMovement,
      preview: this.preview,
    });
    onProgress?.(1);
    return { filePath: out, duration: req.duration, cost: 0, model: this.model };
  }

  estimateCost() {
    return 0;
  }

  cacheParts(req: VideoRequest, imageHash: string) {
    return { v: 2, image: imageHash, move: req.cameraMovement, d: req.duration, w: req.width, h: req.height, fps: req.fps, preview: this.preview };
  }
}
