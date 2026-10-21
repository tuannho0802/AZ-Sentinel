/** Giao diện sáng/tối. Mặc định theo hệ điều hành; lựa chọn của người dùng nhớ ở localStorage (chỉ là sở thích, không nhạy cảm). */
export type ThemeChoice = 'system' | 'light' | 'dark'

export const THEME_STORAGE_KEY = 'az.theme'

function isChoice(v: unknown): v is ThemeChoice {
  return v === 'system' || v === 'light' || v === 'dark'
}

export function readTheme(): ThemeChoice {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY)
    return isChoice(v) ? v : 'system'
  } catch {
    return 'system' // localStorage hỏng thì theo hệ điều hành, không làm hỏng trang
  }
}

export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement
  if (choice === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', choice)
}

export function saveTheme(choice: ThemeChoice): void {
  try {
    if (choice === 'system') localStorage.removeItem(THEME_STORAGE_KEY)
    else localStorage.setItem(THEME_STORAGE_KEY, choice)
  } catch {
    // bỏ qua: chỉ mất khả năng nhớ lựa chọn
  }
}

/** Gọi một lần trước khi render để không nháy sáng/tối lúc tải trang. */
export function initTheme(): void {
  applyTheme(readTheme())
}
