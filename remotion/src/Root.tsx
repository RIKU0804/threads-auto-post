import { Composition } from "remotion";
import type { CalculateMetadataFunction } from "remotion";
import { ShortVideoMain } from "./compositions/ShortVideoMain";
import { shortVideoPropsSchema, type ShortVideoProps } from "./schema";
import { SAMPLE_PROPS } from "./sample-props";
import { FPS, WIDTH, HEIGHT, computeTotalDurationSec } from "./timing";

// 総尺 = computeTotalDurationSec(props) を frames に変換。
// 尺の定義は timing.ts に集約し、ShortVideoMain の内部描画と一致させる。
const calculateMetadata: CalculateMetadataFunction<ShortVideoProps> = ({
  props,
}) => {
  const totalSec = computeTotalDurationSec(props.scenes);
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
