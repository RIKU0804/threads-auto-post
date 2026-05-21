import { z } from "zod";
import { zColor } from "@remotion/zod-types";

// One scene = one image + one narration audio + one caption line.
// caption_text と narration_text を分けるのは
// 「読みやすい短文テロップ」と「自然な読み上げ文」を別物として扱うため。
export const sceneSchema = z.object({
  caption_text: z.string().min(1).describe("画面に出すテロップ (短く・強く)"),
  narration_text: z
    .string()
    .describe("ナレーション原稿。表示には使わない (参照用)"),
  image_url: z.string().url().describe("AI 生成イラストの URL"),
  audio_url: z.string().url().describe("ElevenLabs などで生成した MP3 URL"),
  duration: z
    .number()
    .positive()
    .describe("このシーンの長さ (秒)。frame 数の計算に使う"),
});

export const shortVideoPropsSchema = z.object({
  title: z.string().describe("オープニングタイトル (空文字でスキップ)"),
  scenes: z.array(sceneSchema).min(1).max(20),
  bgm_url: z
    .string()
    .url()
    .optional()
    .describe("BGM URL (未指定なら BGM なし)"),
  font_family: z
    .string()
    .optional()
    .describe("テロップ用フォントファミリ。未指定なら Noto Sans JP"),
  theme_color: zColor()
    .optional()
    .describe("アクセントカラー。タイトル下線などに使う"),
});

export type Scene = z.infer<typeof sceneSchema>;
export type ShortVideoProps = z.infer<typeof shortVideoPropsSchema>;
