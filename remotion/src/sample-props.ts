import type { ShortVideoProps } from "./schema";

// Studio プレビュー用サンプル。
// 実運用では Next.js 側から JSON で渡される。
// audio_url はサンプル MP3 (1秒の無音) を使い、本番では ElevenLabs の生成結果に差し替える。
const SILENT_MP3 =
  "https://www.soundjay.com/buttons/sounds/button-09.mp3";

export const SAMPLE_PROPS: ShortVideoProps = {
  title: "知らないと損する3つのこと",
  theme_color: "#ff2d55",
  scenes: [
    {
      caption_text: "AIで動画は\n3分で作れる",
      narration_text:
        "AIを使えば、ショート動画はもう3分で作れる時代になりました。",
      image_url:
        "https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1080&q=80&auto=format&fit=crop",
      audio_url: SILENT_MP3,
      duration: 3.0,
    },
    {
      caption_text: "テロップで\n再生数は決まる",
      narration_text:
        "実は、再生数を決めるのは映像よりもテロップとフォントのインパクトです。",
      image_url:
        "https://images.unsplash.com/photo-1611162617213-7d7a39e9b1d7?w=1080&q=80&auto=format&fit=crop",
      audio_url: SILENT_MP3,
      duration: 3.5,
    },
    {
      caption_text: "今すぐ\n試してみよう",
      narration_text:
        "やり方は概要欄に貼ってあるので、気になる人は今すぐ試してみてください。",
      image_url:
        "https://images.unsplash.com/photo-1620712943543-bcc4688e7485?w=1080&q=80&auto=format&fit=crop",
      audio_url: SILENT_MP3,
      duration: 3.0,
    },
  ],
};
