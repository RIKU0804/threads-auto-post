import { AbsoluteFill, Audio, Sequence } from "remotion";
import type { Scene } from "../schema";
import { CaptionOverlay } from "./CaptionOverlay";
import { KenBurnsImage, type KenBurnsMotion } from "./KenBurnsImage";

interface SceneBlockProps {
  scene: Scene;
  durationInFrames: number;
  fontFamily: string;
  // シーン index。Ken-Burns の動きパターンを循環させるのに使う。
  index: number;
  // 音声の再生開始を遅らせるフレーム数。
  // 親 (ShortVideoMain) はシーンをトランジション分だけ前倒しで開始するため、
  // その前倒し量ぶん Audio を遅らせないと前シーンの音声末尾と重なって二重再生になる。
  // 映像 (KenBurns / Caption) は前倒しのまま、音声だけ本来のタイミングで鳴らす。
  audioDelayFrames?: number;
}

// シーン頭からテロップが出るまでのウェイト (frames)。
// 短尺 SNS 動画ではテロップは即出しの方がテンポが良い (= 2 frames ≈ 66ms @ 30fps)。
const CAPTION_LEAD_IN_FRAMES = 2;

// index ごとに動きパターンを循環。隣り合うシーンで方向が変わるようにする。
const MOTION_CYCLE: KenBurnsMotion[] = [
  "zoom-in",
  "pan-right",
  "zoom-out",
  "pan-left",
];

export function SceneBlock({
  scene,
  durationInFrames,
  fontFamily,
  index,
  audioDelayFrames = 0,
}: SceneBlockProps): JSX.Element {
  const motion = MOTION_CYCLE[index % MOTION_CYCLE.length];

  return (
    <AbsoluteFill>
      <KenBurnsImage
        src={scene.image_url}
        durationInFrames={durationInFrames}
        motion={motion}
      />
      <CaptionOverlay
        text={scene.caption_text}
        fontFamily={fontFamily}
        startAt={CAPTION_LEAD_IN_FRAMES + audioDelayFrames}
      />
      {/* 音声はトランジションの前倒し量ぶん遅らせて本来のタイミングで鳴らす。
          これで前シーン音声末尾との二重再生を防ぐ。 */}
      {audioDelayFrames > 0 ? (
        <Sequence from={audioDelayFrames} layout="none">
          <Audio src={scene.audio_url} />
        </Sequence>
      ) : (
        <Audio src={scene.audio_url} />
      )}
    </AbsoluteFill>
  );
}
