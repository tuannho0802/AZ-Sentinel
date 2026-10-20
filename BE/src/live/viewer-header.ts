import { USER_ROLES } from '@az-sentinel/shared'
import { z } from 'zod'
import type { ViewerInfo } from './hub-types'

/** Header nội bộ Worker -> hub. Hub chỉ nhận được qua binding nên không ai ngoài Worker gửi được. */
export const VIEWER_HEADER = 'X-AZ-Viewer'

const scopeSchema = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('all') }),
    z.object({ kind: z.literal('owner'), ownerId: z.number().int() }),
    z.object({ kind: z.literal('link'), linkId: z.number().int().positive() }),
])

const viewerSchema = z.object({
    userId: z.number().int(),
    role: z.enum(USER_ROLES),
    scope: scopeSchema,
    expiresAt: z.number().int().nullable(),
    nowMs: z.number().int(),
})

export function encodeViewer(viewer: ViewerInfo): string {
    return JSON.stringify(viewer)
}

export function decodeViewer(raw: string | null): ViewerInfo | null {
    if (raw === null) return null
    try {
        const parsed = viewerSchema.safeParse(JSON.parse(raw))
        return parsed.success ? parsed.data : null
    } catch {
        return null
    }
}