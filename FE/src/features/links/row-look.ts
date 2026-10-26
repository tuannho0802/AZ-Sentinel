import type { Health } from './links-view'

/** Vạch màu bên trái dòng + nền nhẹ cho dòng cần chú ý: giúp quét mắt, chữ trong huy hiệu vẫn là nguồn chính. */
export const rowLook: Record<Health, { stripe: string; bg: string }> = {
  live: { stripe: 'border-l-live', bg: '' },
  waking: { stripe: 'border-l-line-strong', bg: '' },
  silent: { stripe: 'border-l-notice-ink', bg: 'bg-notice-bg/40' },
  online: { stripe: 'border-l-gain', bg: '' },
  offline: { stripe: 'border-l-loss', bg: 'bg-loss-bg/50' },
  awaiting: { stripe: 'border-l-transparent', bg: '' },
  disabled: { stripe: 'border-l-transparent', bg: 'opacity-65' },
}
