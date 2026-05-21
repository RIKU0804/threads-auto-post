import { AbsoluteFill, Img, interpolate, useCurrentFrame } from "remotion";

interface KenBurnsImageProps {
  src: string;
  // シーンの長さ (frames)。これを使って 0..1 の進行度を出す。
  durationInFrames: number;
  // 偶数シーンと奇数シーンでズーム方向を変えると単調さが消える。
  direction?: "in" | "out";
}

const SCALE_DELTA = 0.06; // 6% ズーム。やりすぎないのが TikTok 受けする。

export function KenBurnsImage({
  src,
  durationInFrames,
  direction = "in",
}: KenBurnsImageProps): JSX.Element {
  const frame = useCurrentFrame();
  const progress = interpolate(frame, [0, durationInFrames], [0, 1], {
    extrapolateRight: "clamp",
    extrapolateLeft: "clamp",
  });

  const startScale = direction === "in" ? 1.0 : 1.0 + SCALE_DELTA;
  const endScale = direction === "in" ? 1.0 + SCALE_DELTA : 1.0;
  const scale = interpolate(progress, [0, 1], [startScale, endScale]);

  // 横方向にもごく僅かに動かす (3% 程度) と「写真がただ拡大してるだけ」感が消える。
  const translateX = interpolate(
    progress,
    [0, 1],
    [direction === "in" ? -1 : 1, direction === "in" ? 1 : -1],
  );

  return (
    <AbsoluteFill style={{ overflow: "hidden", backgroundColor: "#000" }}>
      <Img
        src={src}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          transform: `scale(${scale}) translateX(${translateX}%)`,
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
