import { useState } from 'react'
import { strings } from '../lib/strings'
import { applyTheme, readTheme, saveTheme, type ThemeChoice } from '../lib/theme'
import { Icon } from './Icon'

const order: ThemeChoice[] = ['system', 'light', 'dark']
const icon = { system: 'system', light: 'sun', dark: 'moon' } as const

/** Đổi vòng tròn: theo máy, sáng, tối. Nhãn nêu rõ lựa chọn hiện tại cho trình đọc màn hình. */
export function ThemeToggle() {
    const [choice, setChoice] = useState<ThemeChoice>(readTheme)
    function next() {
        const n = order[(order.indexOf(choice) + 1) % order.length] ?? 'system'
        setChoice(n)
        applyTheme(n)
        saveTheme(n)
    }
    const label = `${strings.themeLabel}: ${strings.themeNames[choice]}`
    return (
        <button
            type="button"
            onClick={next}
            aria-label={label}
            title={label}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted transition-colors hover:bg-raised hover:text-ink"
        >
            <Icon name={icon[choice]} size={16} />
        </button>
    )
}