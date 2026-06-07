// 各SNSの「本物」ブランドロゴ。プロジェクト同梱の @remixicon/react を単一情報源にする。
// （以前は MessageCircle=Threads / Camera=Instagram / lucide X=X という汎用アイコンで代用していた）
import { RiThreadsFill, RiInstagramFill, RiTwitterXFill, type RemixiconComponentType } from '@remixicon/react'

export type BrandPlatform = 'threads' | 'instagram' | 'x'

export interface BrandConfig {
  label: string
  /** SVG ブランドロゴ。className でサイズ・色（currentColor）を制御できる */
  Icon: RemixiconComponentType
  /**
   * ロゴタイルの背景。UI のアクセントはティールに統一しているが、
   * ロゴタイルだけは各SNS本来の色味にして識別性（ブランド感）を担保する。
   */
  tile: string
}

// Instagram 公式グラデーション（黄→橙→マゼンタ→紫→青）
const INSTAGRAM_GRADIENT =
  'bg-[linear-gradient(45deg,#feda75_0%,#fa7e1e_25%,#d62976_50%,#962fbf_75%,#4f5bd5_100%)]'

export const PLATFORM_BRAND: Record<BrandPlatform, BrandConfig> = {
  threads:   { label: 'Threads',   Icon: RiThreadsFill,   tile: 'bg-black' },
  instagram: { label: 'Instagram', Icon: RiInstagramFill, tile: INSTAGRAM_GRADIENT },
  x:         { label: 'X',         Icon: RiTwitterXFill,  tile: 'bg-black' },
}

// 個別 import 用エイリアス
export {
  RiThreadsFill as ThreadsIcon,
  RiInstagramFill as InstagramIcon,
  RiTwitterXFill as XBrandIcon,
}
