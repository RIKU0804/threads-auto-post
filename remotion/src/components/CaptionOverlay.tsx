import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

interface CaptionOverlayProps {
  text: string;
  fontFamily: string;
  // 行ごとの登場アニメーションを開始するフレーム (シーン頭からのオフセット)
  startAt?: number;
}

// 文字数に応じてフォントサイズを段階的に下げる。
// 8文字以下: 大きく、それ以上: 段階的に縮小。
function pickFontSize(longestLineLength: number): number {
  if (longestLineLength <= 8) return 116;
  if (longestLineLength <= 12) return 96;
  if (longestLineLength <= 16) return 80;
  return 68;
}

const STROKE_PX = 6;

export function CaptionOverlay({
  text,
  fontFamily,
  startAt = 0,
}: CaptionOverlayProps): JSX.Element {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const localFrame = frame - startAt;

  // 改行で分割して chunk-by-chunk reveal
  const lines = text.split("\n");
  const longest = lines.reduce((m, l) => Math.max(m, l.length), 0);
  const fontSize = pickFontSize(longest);

  return (
    <AbsoluteFill
      style={{
        // 下寄り (60-75%) に配置。TikTok 右側 UI を避けて 8% 内側に。
        justifyContent: "flex-end",
        alignItems: "center",
        paddingBottom: "28%",
        paddingLeft: "8%",
        paddingRight: "12%",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 12,
          textAlign: "center",
        }}
      >
        {lines.map((line, i) => {
          // 行ごとに ~5 frame ずらして登場
          const lineStart = i * 5;
          const reveal = spring({
            frame: localFrame - lineStart,
            fps,
            config: { damping: 16, stiffness: 140, mass: 0.6 },
          });
          const opacity = interpolate(reveal, [0, 1], [0, 1], {
            extrapolateRight: "clamp",
            extrapolateLeft: "clamp",
          });
          const translateY = interpolate(reveal, [0, 1], [40, 0]);
          const scale = interpolate(reveal, [0, 1], [0.92, 1]);

          return (
            <div
              key={`${i}-${line}`}
              style={{
                fontFamily,
                fontWeight: 900,
                fontSize,
                lineHeight: 1.15,
                color: "#fff",
                letterSpacing: "0.02em",
                // 太い縁取り = TikTok テロップの定番ルック
                WebkitTextStroke: `${STROKE_PX}px #000`,
                paintOrder: "stroke fill",
                textShadow:
                  "0 4px 0 rgba(0,0,0,0.55), 0 0 24px rgba(0,0,0,0.45)",
                opacity,
                transform: `translateY(${translateY}px) scale(${scale})`,
              }}
            >
              {line}
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
}
