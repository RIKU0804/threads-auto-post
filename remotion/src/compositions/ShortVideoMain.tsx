import {
  AbsoluteFill,
  Audio,
  interpolate,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { loadFont } from "@remotion/google-fonts/NotoSansJP";
import { SceneBlock } from "../components/SceneBlock";
import { TitleCard } from "../components/TitleCard";
import type { ShortVideoProps } from "../schema";

// Noto Sans JP Black (weight 900) を Studio とレンダリング両方で同期ロード。
// Remotion の delayRender/continueRender は loadFont が内部で扱ってくれる。
const { fontFamily: NOTO_SANS_JP } = loadFont("normal", {
  weights: ["700", "900"],
});

const TITLE_DURATION_SEC = 1.5;
const TAIL_FADE_SEC = 0.5;
const CROSSFADE_FRAMES = 10;

export function ShortVideoMain(props: ShortVideoProps): JSX.Element {
  const { fps } = useVideoConfig();
  const frame = useCurrentFrame();

  const fontFamily = props.font_family ?? NOTO_SANS_JP;
  const accentColor = props.theme_color ?? "#ff2d55";
  const hasTitle = props.title.trim().length > 0;

  const titleFrames = hasTitle ? Math.round(TITLE_DURATION_SEC * fps) : 0;
  const tailFrames = Math.round(TAIL_FADE_SEC * fps);

  // シーンごとの開始フレームと長さを事前計算
  const sceneSchedule = props.scenes.reduce<
    { start: number; durationInFrames: number }[]
  >((acc, scene) => {
    const prev = acc[acc.length - 1];
    const start = prev ? prev.start + prev.durationInFrames : titleFrames;
    const durationInFrames = Math.max(1, Math.round(scene.duration * fps));
    acc.push({ start, durationInFrames });
    return acc;
  }, []);

  const lastScene = sceneSchedule[sceneSchedule.length - 1];
  const totalFrames = lastScene
    ? lastScene.start + lastScene.durationInFrames + tailFrames
    : titleFrames + tailFrames;

  // 末尾フェードアウト
  const tailOpacity = interpolate(
    frame,
    [totalFrames - tailFrames, totalFrames],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  return (
    <AbsoluteFill style={{ backgroundColor: "#000", opacity: tailOpacity }}>
      {hasTitle && (
        <Sequence durationInFrames={titleFrames} layout="none">
          <TitleCard
            title={props.title}
            fontFamily={fontFamily}
            accentColor={accentColor}
            durationInFrames={titleFrames}
          />
        </Sequence>
      )}

      {props.scenes.map((scene, i) => {
        const { start, durationInFrames } = sceneSchedule[i];
        // クロスフェードのため、各シーンを CROSSFADE_FRAMES だけ前倒しで開始。
        // 最初のシーンは Title が無ければ普通に start から。
        const overlapStart =
          i === 0 ? start : Math.max(titleFrames, start - CROSSFADE_FRAMES);
        const overlapDuration =
          durationInFrames + (i === 0 ? 0 : CROSSFADE_FRAMES);

        return (
          <Sequence
            key={`scene-${i}`}
            from={overlapStart}
            durationInFrames={overlapDuration}
            layout="none"
          >
            <SceneCrossfadeWrapper
              isFirst={i === 0}
              crossfadeFrames={CROSSFADE_FRAMES}
            >
              <SceneBlock
                scene={scene}
                durationInFrames={durationInFrames}
                fontFamily={fontFamily}
                index={i}
              />
            </SceneCrossfadeWrapper>
          </Sequence>
        );
      })}

      {props.bgm_url && (
        <Audio src={props.bgm_url} volume={0.18} loop />
      )}
    </AbsoluteFill>
  );
}

interface SceneCrossfadeWrapperProps {
  isFirst: boolean;
  crossfadeFrames: number;
  children: React.ReactNode;
}

function SceneCrossfadeWrapper({
  isFirst,
  crossfadeFrames,
  children,
}: SceneCrossfadeWrapperProps): JSX.Element {
  const frame = useCurrentFrame();
  const opacity = isFirst
    ? 1
    : interpolate(frame, [0, crossfadeFrames], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });

  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
}
