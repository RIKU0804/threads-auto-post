import { AbsoluteFill, Audio } from "remotion";
import type { Scene } from "../schema";
import { CaptionOverlay } from "./CaptionOverlay";
import { KenBurnsImage } from "./KenBurnsImage";

interface SceneBlockProps {
  scene: Scene;
  durationInFrames: number;
  fontFamily: string;
  // シーン index。Ken-Burns の方向を交互に振るのに使う。
  index: number;
}

// シーン頭からテロップが出るまでのウェイト (frames)。
// 音声の発話が始まる直前にテロップが出ると自然 = ~6 frames (200ms @ 30fps)。
const CAPTION_LEAD_IN_FRAMES = 6;

export function SceneBlock({
  scene,
  durationInFrames,
  fontFamily,
  index,
}: SceneBlockProps): JSX.Element {
  const direction = index % 2 === 0 ? "in" : "out";

  return (
    <AbsoluteFill>
      <KenBurnsImage
        src={scene.image_url}
        durationInFrames={durationInFrames}
        direction={direction}
      />
      <CaptionOverlay
        text={scene.caption_text}
        fontFamily={fontFamily}
        startAt={CAPTION_LEAD_IN_FRAMES}
      />
      <Audio src={scene.audio_url} />
    </AbsoluteFill>
  );
}
