import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

interface TitleCardProps {
  title: string;
  fontFamily: string;
  accentColor: string;
  durationInFrames: number;
}

export function TitleCard({
  title,
  fontFamily,
  accentColor,
  durationInFrames,
}: TitleCardProps): JSX.Element {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const enter = spring({
    frame,
    fps,
    config: { damping: 18, stiffness: 130, mass: 0.7 },
  });
  const exit = interpolate(
    frame,
    [durationInFrames - 10, durationInFrames],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const opacity = Math.min(enter, exit);
  const translateY = interpolate(enter, [0, 1], [60, 0]);

  // アクセント線は遅れて伸びる
  const underlineProgress = spring({
    frame: frame - 8,
    fps,
    config: { damping: 14, stiffness: 110, mass: 0.5 },
  });
  const underlineWidth = interpolate(
    underlineProgress,
    [0, 1],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#0a0a0a",
        justifyContent: "center",
        alignItems: "center",
        padding: "0 8%",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 24,
          opacity,
          transform: `translateY(${translateY}px)`,
        }}
      >
        <div
          style={{
            fontFamily,
            fontWeight: 900,
            fontSize: 108,
            lineHeight: 1.15,
            color: "#fff",
            textAlign: "center",
            letterSpacing: "0.01em",
            textShadow: "0 6px 30px rgba(0,0,0,0.6)",
          }}
        >
          {title}
        </div>
        <div
          style={{
            height: 8,
            width: `${underlineWidth * 60}%`,
            background: accentColor,
            borderRadius: 4,
          }}
        />
      </div>
    </AbsoluteFill>
  );
}
