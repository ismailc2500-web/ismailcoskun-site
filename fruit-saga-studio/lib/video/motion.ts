import { runFfmpeg } from "@/lib/video/ffmpeg";

/**
 * Animates a still keyframe with a virtual camera move (FFmpeg zoompan) that
 * matches the shot's camera_movement. Used by the mock video provider and as
 * the zero-cost "animatic" preview.
 */

export interface MotionOptions {
  imagePath: string;
  outPath: string;
  width: number;
  height: number;
  duration: number;
  fps: number;
  movement: string;
  preview?: boolean;
}

interface MotionExpr {
  z: string;
  x: string;
  y: string;
}

export function motionExpressions(movement: string, frames: number): MotionExpr {
  const m = movement.toLowerCase();
  const P = `(on/${frames})`;
  const E = `(${P}*${P}*(3-2*${P}))`; // smoothstep easing
  const cx = "(iw-iw/zoom)/2";
  const cy = "(ih-ih/zoom)/2";
  const faceY = "(ih-ih/zoom)*0.38";
  if (/dramatic push|snap/.test(m)) return { z: `1+0.32*${E}`, x: cx, y: faceY };
  if (/push-?in|dolly-?in|creep/.test(m)) return { z: `1+0.16*${E}`, x: cx, y: faceY };
  if (/dolly-?out|pull/.test(m)) return { z: `1.2-0.18*${E}`, x: cx, y: cy };
  if (/crane|tilt up|rise/.test(m)) return { z: `1.18-0.05*${E}`, x: cx, y: `(ih-ih/zoom)*(1-${E})` };
  if (/tilt down|descend/.test(m)) return { z: "1.18", x: cx, y: `(ih-ih/zoom)*${E}` };
  if (/pan left/.test(m)) return { z: "1.16", x: `(iw-iw/zoom)*(1-${E})`, y: cy };
  if (/pan|tracking(?!.*back)/.test(m) && !/backward/.test(m)) return { z: "1.16", x: `(iw-iw/zoom)*${E}`, y: cy };
  if (/backward/.test(m)) return { z: `1.12+0.06*${E}`, x: `${cx}+iw*0.004*sin(on/6)`, y: `${faceY}+ih*0.003*sin(on/3.1)` };
  if (/orbit|arc/.test(m)) return { z: `1.12+0.04*sin(PI*${P})`, x: `(iw-iw/zoom)*(0.5+0.4*sin(PI*(${P}-0.5)))`, y: cy };
  if (/whip/.test(m)) return { z: "1.15", x: `(iw-iw/zoom)*(1-min(1,${P}*4))`, y: cy };
  if (/chase/.test(m)) return { z: `1.14+0.04*${E}`, x: `${cx}+iw*0.012*sin(on/2.3)+iw*0.006*sin(on/1.1)`, y: `${cy}+ih*0.008*cos(on/1.9)` };
  if (/handheld/.test(m)) return { z: "1.1", x: `${cx}+iw*0.006*sin(on/7)+iw*0.003*sin(on/2.9)`, y: `${cy}+ih*0.004*cos(on/5.3)` };
  // static / locked-off: a barely perceptible breathing drift
  return { z: `1.02+0.025*${P}`, x: cx, y: cy };
}

export async function renderMotionClip(o: MotionOptions): Promise<void> {
  const frames = Math.max(1, Math.round(o.duration * o.fps));
  const { z, x, y } = motionExpressions(o.movement, frames);
  // Upscale first so sub-pixel camera motion stays smooth after zoompan's integer crop.
  const up = o.preview ? 1.5 : 2;
  const W = Math.round((o.width * up) / 2) * 2;
  const H = Math.round((o.height * up) / 2) * 2;
  const filter = [
    `scale=${W}:${H}:force_original_aspect_ratio=increase:flags=lanczos`,
    `crop=${W}:${H}`,
    `zoompan=z='${z}':x='${x}':y='${y}':d=${frames}:s=${o.width}x${o.height}:fps=${o.fps}`,
    "setsar=1",
    "format=yuv420p",
  ].join(",");
  await runFfmpeg([
    "-loop",
    "1",
    "-framerate",
    String(o.fps),
    "-t",
    "1",
    "-i",
    o.imagePath,
    "-vf",
    filter,
    "-frames:v",
    String(frames),
    "-c:v",
    "libx264",
    "-preset",
    o.preview ? "ultrafast" : "veryfast",
    "-crf",
    o.preview ? "26" : "18",
    "-an",
    o.outPath,
  ]);
}
