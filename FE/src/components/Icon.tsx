import type { SVGProps } from 'react'

/** Bộ biểu tượng nhỏ (16px, nét 1.75). Trang trí: luôn `aria-hidden`; ý nghĩa nằm ở chữ đi kèm. */
const paths = {
  up: 'M8 3.5 13 11H3z',
  down: 'M8 12.5 3 5h10z',
  refresh: 'M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5v3h-3',
  plus: 'M8 3v10M3 8h10',
  search: 'M7 12.5a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11zM11 11l3.5 3.5',
  sun: 'M8 11.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4zM8 1v1.6M8 13.4V15M1 8h1.6M13.4 8H15M3 3l1.1 1.1M11.9 11.9 13 13M3 13l1.1-1.1M11.9 4.1 13 3',
  moon: 'M13.5 9.6A5.8 5.8 0 0 1 6.4 2.5a5.8 5.8 0 1 0 7.1 7.1z',
  system: 'M2 3.5h12v7.5H2zM5.5 13.5h5M8 11v2.5',
  back: 'M9.5 3.5 5 8l4.5 4.5',
  pause: 'M5.5 3.5v9M10.5 3.5v9',
  play: 'M5 3.2v9.6L12.5 8z',
  alert: 'M8 2.2 14.5 13.5h-13zM8 6.5v3.2M8 11.6v.1',
  check: 'M3 8.5 6.5 12 13 4.5',
  close: 'M4 4l8 8M12 4l-8 8',
  copy: 'M5.5 5.5h7v8h-7zM3.5 10.5v-8h7',
} as const

export type IconName = keyof typeof paths

const filled: ReadonlySet<IconName> = new Set(['up', 'down', 'play'])

export function Icon({
  name,
  size = 14,
  ...rest
}: { name: IconName; size?: number } & Omit<SVGProps<SVGSVGElement>, 'name'>) {
  const solid = filled.has(name)
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill={solid ? 'currentColor' : 'none'}
      stroke={solid ? 'none' : 'currentColor'}
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      <path d={paths[name]} />
    </svg>
  )
}
