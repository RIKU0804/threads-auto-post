import { Composition } from "remotion";
import type { CalculateMetadataFunction } from "remotion";
import { ShortVideoMain } from "./compositions/ShortVideoMain";
import { shortVideoPropsSchema, type ShortVideoProps } from "./schema";
import { SAMPLE_PROPS } from "./sample-props";

const FPS = 30;
const WIDTH = 1080;
const HEIGHT = 1920;

const TITLE_DURATION_SEC = 1.5;
const TAIL_FADE_SEC = 0.5;

// scenes[].duration の合計 + (title? 1.5 : 0) + 0.5 (tail) を frames に変換。
const calculateMetadata: CalculateMetadataFunction<ShortVideoProps> = ({
  props,
}) => {
  const hasTitle = props.title.trim().length > 0;
  const sceneSec = props.scenes.reduce((sum, s) => sum + s.duration, 0);
  const totalSec =
    sceneSec + (hasTitle ? TITLE_DURATION_SEC : 0) + TAIL_FADE_SEC;
  const durationInFrames = Math.max(1, Math.round(totalSec * FPS));
  return { durationInFrames };
};

export function RemotionRoot(): JSX.Element {
  return (
    <Composition
      id="ShortVideoMain"
      component={ShortVideoMain}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
      // 初期値。実 duration は calculateMetadata が props から算出する。
      durationInFrames={300}
      schema={shortVideoPropsSchema}
      defaultProps={SAMPLE_PROPS}
      calculateMetadata={calculateMetadata}
    />
  );
}
