// 動画の尺・トランジションに関する定数を Root.tsx (Studio / calculateMetadata) と
// ShortVideoMain.tsx (実レンダリング) の両方で共有するための単一ソース。
//
// 以前は両ファイルに別々の値が定義されていて、Studio プレビューと最終 MP4 で
// 尺・末尾フェード・タイトル有無が食い違っていた。ここに集約して一致させる。

export const FPS = 30;
export const WIDTH = 1080;
export const HEIGHT = 1920;

// 冒頭タイトルカードは廃止済み（SNS 短尺では黒画面1秒で離脱率が上がるため）。
// title 文字列自体は一覧やシェアで使うので props には残すが、動画には描画しない。
export const SHOW_TITLE_CARD = false;
export const TITLE_DURATION_SEC = 1.0;

// 末尾フェードアウトの長さ
export const TAIL_FADE_SEC = 0.3;

// シーン切り替えの重なりフレーム数（slide/zoom トランジションを見せるため）
export const TRANSITION_FRAMES = 8;

/**
 * props から動画の総尺（秒）を算出する。Root の calculateMetadata と
 * ShortVideoMain の内部計算の両方がこれを使うことで尺を一致させる。
 */
export function computeTotalDurationSec(
  scenes: { duration: number }[],
): number {
  const sceneSec = scenes.reduce((sum, s) => sum + s.duration, 0);
  const titleSec = SHOW_TITLE_CARD ? TITLE_DURATION_SEC : 0;
  return sceneSec + titleSec + TAIL_FADE_SEC;
}
