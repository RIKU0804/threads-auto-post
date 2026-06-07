'use client'

import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { PLATFORM_BRAND, type BrandPlatform } from '@/components/ui/BrandIcons'
import { cx } from '@/lib/utils'

interface PlatformCard {
  platform: BrandPlatform
  href: string
  title: string
  desc: string
  tags: string[]
}

const CARDS: readonly PlatformCard[] = [
  {
    platform: 'threads',
    href: '/dashboard/generate/threads',
    title: 'Threads',
    desc: 'テキスト投稿 + AI図解画像を生成してThreadsに投稿します',
    tags: ['テキスト', '図解画像'],
  },
  {
    platform: 'instagram',
    href: '/dashboard/generate/instagram',
    title: 'Instagram',
    desc: '画像 + AIキャプションを生成してInstagramに投稿します',
    tags: ['画像必須', 'キャプション'],
  },
  {
    platform: 'x',
    href: '/dashboard/generate/x',
    title: 'X（Twitter）',
    desc: '単発ツイートまたはスレッドを生成してXに直接投稿します',
    tags: ['単発', 'スレッド'],
  },
]

export default function GeneratePage() {
  return (
    <div className="p-6 lg:p-8 max-w-3xl">
      <div className="mb-8">
        <h1 className="text-xl font-semibold lg:text-2xl" style={{ color: '#061b31' }}>
          投稿生成
        </h1>
        <p className="mt-0.5 text-sm text-gray-500">投稿するプラットフォームを選択してください</p>
      </div>

      <div className="grid max-w-3xl gap-4 sm:grid-cols-3">
        {CARDS.map(({ platform, href, title, desc, tags }) => {
          const brand = PLATFORM_BRAND[platform]
          const Icon = brand.Icon
          return (
            <Link key={platform} href={href} className="group block">
              <div className="flex h-full flex-col rounded-xl border border-[#e5edf5] bg-white p-6 shadow-sm transition-all hover:border-[#00A3BF] hover:shadow-md">
                <div className={cx('mb-4 flex h-12 w-12 items-center justify-center rounded-xl', brand.tile)}>
                  <Icon className="h-6 w-6 text-white" aria-hidden />
                </div>
                <h2 className="text-base font-semibold text-gray-900">{title}</h2>
                <p className="mt-1 flex-1 text-sm text-gray-500">{desc}</p>
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {tags.map(tag => (
                    <span key={tag} className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                      {tag}
                    </span>
                  ))}
                </div>
                <div className="mt-4 flex items-center gap-1 text-sm font-medium text-[#006F83] transition-colors group-hover:text-[#005A6B]">
                  生成する
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </div>
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
