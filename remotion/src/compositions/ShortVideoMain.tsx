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
import {
  SHOW_TITLE_CARD,
  TITLE_DURATION_SEC,
  TAIL_FADE_SEC,
  TRANSITION_FRAMES,
} from "../timing";

// Noto Sans JP Black (weight 900) を Studio とレンダリング両方で同期ロード。
// Remotion の delayRender/continueRender は loadFont が内部で扱ってくれる。
const { fontFamily: NOTO_SANS_JP } = loadFont("normal", {
  weights: ["700", "900"],
});

// 尺・トランジションの定数は timing.ts に集約（Root.tsx と一致させる）。

// シーン切替の演出タイプ。index で循環させて単調さを消す。
type TransitionType = "fade" | "slide-left" | "slide-up" | "zoom";
const TRANSITION_CYCLE: TransitionType[] = [
  "fade",
  "slide-left",
  "zoom",
  "slide-up",
];

export function ShortVideoMain(props: ShortVideoProps): JSX.Element {
  const { fps } = useVideoConfig();
  const frame = useCurrentFrame();

  const fontFamily = props.font_family ?? NOTO_SANS_JP;
  const accentColor = props.theme_color ?? "#ff2d55";
  // 冒頭の黒画面タイトルカードは廃止（SNS 短尺動画では1秒の黒画面で離脱率が上がる）。
  // 動画一覧やシェア時のテキストとして title は引き続き利用するため props.title 自体は残す。
  // SHOW_TITLE_CARD と空文字でない両方を満たす時のみ表示（timing.ts と Root の尺計算に一致）。
  const hasTitle = SHOW_TITLE_CARD && props.title.trim().length > 0;

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
        // トランジションのため、各シーンを TRANSITION_FRAMES だけ前倒しで開始。
        // 最初のシーンは Title が無ければ普通に start から。
        const overlapStart =
          i === 0 ? start : Math.max(titleFrames, start - TRANSITION_FRAMES);
        const overlapDuration =
          durationInFrames + (i === 0 ? 0 : TRANSITION_FRAMES);
        // 2 番目のシーン (i=1) から循環。先頭シーンはトランジションなし。
        const transitionType = TRANSITION_CYCLE[(i - 1) % TRANSITION_CYCLE.length];

        return (
          <Sequence
            key={`scene-${i}`}
            from={overlapStart}
            durationInFrames={overlapDuration}
            layout="none"
          >
            <SceneTransitionWrapper
              isFirst={i === 0}
              transitionFrames={TRANSITION_FRAMES}
              type={transitionType}
            >
              <SceneBlock
                scene={scene}
                durationInFrames={durationInFrames}
                fontFamily={fontFamily}
                index={i}
                // 先頭以外は TRANSITION_FRAMES だけ前倒し開始しているので、
                // 音声はその分遅らせて本来のタイミングで鳴らす（二重再生防止）。
                audioDelayFrames={i === 0 ? 0 : TRANSITION_FRAMES}
              />
            </SceneTransitionWrapper>
          </Sequence>
        );
      })}

      {props.bgm_url && (
        <Audio src={props.bgm_url} volume={0.18} loop />
      )}
    </AbsoluteFill>
  );
}

interface SceneTransitionWrapperProps {
  isFirst: boolean;
  transitionFrames: number;
  type: TransitionType;
  children: React.ReactNode;
}

// slide の移動量 (%)。100% だと画面外から飛び込んで激しすぎるので控えめに。
const SLIDE_DISTANCE = 18;
// zoom の開始スケール。
const ZOOM_START = 0.88;

function SceneTransitionWrapper({
  isFirst,
  transitionFrames,
  type,
  children,
}: SceneTransitionWrapperProps): JSX.Element {
  const frame = useCurrentFrame();

  if (isFirst) {
    return <AbsoluteFill>{children}</AbsoluteFill>;
  }

  // p: 0→1 のトランジション進行度
  const p = interpolate(frame, [0, transitionFrames], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // どのタイプも opacity フェードは共通で掛けて「パッと切れる」のを防ぐ
  const opacity = p;
  let transform = "";

  switch (type) {
    case "slide-left":
      // 右からスライドイン
      transform = `translateX(${(1 - p) * SLIDE_DISTANCE}%)`;
      break;
    case "slide-up":
      // 下からスライドイン
      transform = `translateY(${(1 - p) * SLIDE_DISTANCE}%)`;
      break;
    case "zoom":
      // ズームイン (小→等倍)
      transform = `scale(${interpolate(p, [0, 1], [ZOOM_START, 1])})`;
      break;
    case "fade":
    default:
      // フェードのみ
      break;
  }

  return (
    <AbsoluteFill style={{ opacity, transform, transformOrigin: "center center" }}>
      {children}
    </AbsoluteFill>
  );
}
