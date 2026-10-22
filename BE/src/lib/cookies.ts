/** Đọc một cookie theo tên; null nếu không có hoặc hỏng mã hóa. */
export function readCookie(header: string | undefined | null, name: string): string | null {
    if (!header) return null
    for (const part of header.split(';')) {
        const eq = part.indexOf('=')
        if (eq < 0) continue
        if (part.slice(0, eq).trim() !== name) continue
        try {
            return decodeURIComponent(part.slice(eq + 1).trim())
        } catch {
            return null
        }
    }
    return null
}