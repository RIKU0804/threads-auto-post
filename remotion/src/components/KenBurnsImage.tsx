import { AbsoluteFill, Img, interpolate, useCurrentFrame } from "remotion";

// Ken Burns の動きパターン。シーンごとに循環させて単調さを消す。
export type KenBurnsMotion = "zoom-in" | "zoom-out" | "pan-left" | "pan-right";

interface KenBurnsImageProps {
  src: string;
  // シーンの長さ (frames)。これを使って 0..1 の進行度を出す。
  durationInFrames: number;
  // 動きパターン。SceneBlock が index から循環で渡す。
  motion?: KenBurnsMotion;
}

// 12% ズーム。6% だとほぼ動いて見えなかったので強めに。
// それでも TikTok 受けする「酔わない」範囲に収める。
const SCALE_DELTA = 0.12;
// パン量 (%)。ズームと合わせて「写真がただ拡大してるだけ」感を消す。
const PAN_DELTA = 5;

export function KenBurnsImage({
  src,
  durationInFrames,
  motion = "zoom-in",
}: KenBurnsImageProps): JSX.Element {
  const frame = useCurrentFrame();
  const progress = interpolate(frame, [0, durationInFrames], [0, 1], {
    extrapolateRight: "clamp",
    extrapolateLeft: "clamp",
  });

  // パターンごとに scale と translate の開始/終了を決める。
  // どのパターンも常に最低 SCALE_DELTA ぶんはズームして "動いてる感" を担保。
  let startScale: number;
  let endScale: number;
  let startX = 0;
  let endX = 0;
  let startY = 0;
  let endY = 0;

  switch (motion) {
    case "zoom-out":
      startScale = 1.0 + SCALE_DELTA;
      endScale = 1.0;
      break;
    case "pan-left":
      // 少し寄った状態を保ちつつ左へ流す
      startScale = 1.0 + SCALE_DELTA;
      endScale = 1.0 + SCALE_DELTA * 0.5;
      startX = PAN_DELTA;
      endX = -PAN_DELTA;
      break;
    case "pan-right":
      startScale = 1.0 + SCALE_DELTA;
      endScale = 1.0 + SCALE_DELTA * 0.5;
      startX = -PAN_DELTA;
      endX = PAN_DELTA;
      break;
    case "zoom-in":
    default:
      startScale = 1.0;
      endScale = 1.0 + SCALE_DELTA;
      // ズームインは縦にもごくわずか動かす
      startY = 2;
      endY = -2;
      break;
  }

  const scale = interpolate(progress, [0, 1], [startScale, endScale]);
  const translateX = interpolate(progress, [0, 1], [startX, endX]);
  const translateY = interpolate(progress, [0, 1], [startY, endY]);

  return (
    <AbsoluteFill style={{ overflow: "hidden", backgroundColor: "#000" }}>
      <Img
        src={src}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          transform: `scale(${scale}) translate(${translateX}%, ${translateY}%)`,
          transformOrigin: "center center",
        }}
      />
      {/* 上下に暗いグラデーション = 安全領域 (テロップを読みやすくする) */}
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(to bottom, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0) 25%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.75) 100%)",
          pointerEvents: "none",
        }}
      />
    </AbsoluteFill>
  );
}
