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
  // 登場アニメーションを開始するフレーム (シーン頭からのオフセット)
  startAt?: number;
}

// 文字数に応じてフォントサイズを決める。
// AI が入れてくる改行は無視して 1 つの文字列として扱い、長い場合だけ
// CSS の自動折り返しに任せる (手動改行による不自然な 2 行を防ぐ)。
// 9:16 / 実効幅 ~80% を前提に、なるべく 1 行に収まるサイズを選ぶ。
function pickFontSize(length: number): number {
  if (length <= 8) return 104;
  if (length <= 12) return 84;
  if (length <= 16) return 66;
  if (length <= 22) return 54;
  return 46;
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

  // AI が返す改行・連続空白を 1 つの半角スペースに正規化。
  // → 「途中で変な位置に折り返された 2 行」を解消し、表示は自動折り返しに任せる。
  const normalized = text.replace(/\s+/g, " ").trim();
  const fontSize = pickFontSize(normalized.length);

  // 1 ブロックを spring でポップイン (弾んで出る)
  const reveal = spring({
    frame: localFrame,
    fps,
    config: { damping: 11, stiffness: 170, mass: 0.6 },
  });
  const opacity = interpolate(reveal, [0, 0.6], [0, 1], {
    extrapolateRight: "clamp",
    extrapolateLeft: "clamp",
  });
  const translateY = interpolate(reveal, [0, 1], [48, 0]);
  const scale = interpolate(reveal, [0, 1], [0.8, 1]);

  return (
    <AbsoluteFill
      style={{
        // 下寄り (60-75%) に配置。TikTok 右側 UI を避けて内側に。
        justifyContent: "flex-end",
        alignItems: "center",
        paddingBottom: "28%",
        paddingLeft: "8%",
        paddingRight: "12%",
      }}
    >
      <div
        style={{
          fontFamily,
          fontWeight: 900,
          fontSize,
          lineHeight: 1.15,
          color: "#fff",
          letterSpacing: "0.02em",
          textAlign: "center",
          // 長すぎる場合のみ折り返す。日本語は単語境界が無いので任意位置で改行可。
          overflowWrap: "anywhere",
          wordBreak: "normal",
          maxWidth: "100%",
          // 太い縁取り = TikTok テロップの定番ルック
          WebkitTextStroke: `${STROKE_PX}px #000`,
          paintOrder: "stroke fill",
          textShadow: "0 4px 0 rgba(0,0,0,0.55), 0 0 24px rgba(0,0,0,0.45)",
          opacity,
          transform: `translateY(${translateY}px) scale(${scale})`,
        }}
      >
        {normalized}
      </div>
    </AbsoluteFill>
  );
}
