import {
  FAILOVER,
  type ServerInfo,
  type ServerNode,
  type ServerSelf,
  serverNodeSchema,
  serverSelfSchema,
} from '@az-sentinel/shared'
import type { Context } from 'hono'
import { type FetchFn, realFetch, timedFetch } from '../edge/timed-fetch'
import { sharedOriginStore, type VpsOriginStore } from '../edge/vps-origin'
import type { ProbeRegistry } from '../edge/vps-probe'
import { probeFor } from '../edge/vps-probe'
import { cloudflareNode } from '../lib/node-info'
import { nowUnix } from '../lib/time'
import { HUB_NAME } from '../live/routes/live-ws'
import type { AppEnv } from '../types'

const PRIMARY_NODE_KEY = 'primary_node'

type HubCounts = { gateways: number; viewers: number }

async function hubCounts(c: Context<AppEnv>): Promise<HubCounts> {
  try {
    const stats = await c.env.LIVE_HUB.getByName(HUB_NAME).stats(Date.now())
    return { gateways: stats.gateways, viewers: stats.viewers }
  } catch {
    return { gateways: 0, viewers: 0 }
  }
}

function colo(c: Context<AppEnv>): string | undefined {
  const cf = c.req.raw.cf as { colo?: unknown } | undefined
  return typeof cf?.colo === 'string' ? cf.colo : undefined
}

/** Thông tin của chính node đang chạy mã này (VPS hoặc Cloudflare). */
export async function describeSelf(c: Context<AppEnv>): Promise<ServerSelf> {
  const host = c.env.HOST
  const node = host ? host.describe() : cloudflareNode(c.env, colo(c))
  return {
    node,
    standby: host?.standby() ?? null,
    fallbackUrl: host?.fallbackUrl ?? null,
    ...(await hubCounts(c)),
  }
}

/** Ghi nhịp sống của VPS (Worker gọi khi nhận `/api/sync/heartbeat`). */
export async function saveHeartbeat(db: D1Database, node: ServerNode, nowSec: number) {
  await db
    .prepare(
      `INSERT INTO server_meta (k, v, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated_at = excluded.updated_at`,
    )
    .bind(PRIMARY_NODE_KEY, JSON.stringify(node), nowSec)
    .run()
}

/** Nhịp sống gần nhất của VPS; null nếu chưa có hoặc dữ liệu hỏng. */
export async function readHeartbeat(
  db: D1Database,
): Promise<{ node: ServerNode; seenAt: number } | null> {
  const row = await db
    .prepare('SELECT v, updated_at FROM server_meta WHERE k = ?')
    .bind(PRIMARY_NODE_KEY)
    .first<{ v: string; updated_at: number }>()
  if (!row) return null
  try {
    const parsed = serverNodeSchema.safeParse(JSON.parse(row.v))
    return parsed.success ? { node: parsed.data, seenAt: row.updated_at } : null
  } catch {
    return null
  }
}

export type ServerInfoDeps = {
  fetchFn?: FetchFn
  registry?: ProbeRegistry
  origins?: VpsOriginStore
}

/**
 * Ghép `GET /api/server-info`:
 * - Chạy trên VPS: VPS là node đang phục vụ.
 * - Chạy trên Worker không có VPS: chế độ `standalone`.
 * - Chạy trên Worker có VPS: hỏi VPS (`/self`); VPS không đáp thì `fallback`, kèm nhịp sống VPS lần cuối.
 */
export async function buildServerInfo(
  c: Context<AppEnv>,
  deps: ServerInfoDeps = {},
): Promise<ServerInfo> {
  const checkedAt = nowUnix()
  if (c.env.HOST) {
    const self = await describeSelf(c)
    return {
      mode: 'primary',
      active: self.node,
      primary: { configured: true, status: 'up', lastSeenAt: checkedAt, info: self.node },
      standby: self.standby,
      gateways: self.gateways,
      viewers: self.viewers,
      checkedAt,
      fallbackUrl: self.fallbackUrl ?? null,
    }
  }

  const origin = await (deps.origins ?? sharedOriginStore).resolve(c.env)
  if (!origin) {
    const self = await describeSelf(c)
    return {
      mode: 'standalone',
      active: self.node,
      primary: { configured: false, status: 'unknown', lastSeenAt: null, info: null },
      standby: null,
      gateways: self.gateways,
      viewers: self.viewers,
      checkedAt,
      primaryUrl: normalizeUrl(c.env.PRIMARY_URL),
      fallbackUrl: normalizeUrl(c.env.FALLBACK_URL),
    }
  }

  const fetchFn = deps.fetchFn ?? realFetch
  const probe = probeFor(origin, deps.registry, fetchFn)
  if (await probe.isUp()) {
    const remote = await askVps(origin, c.env.SYNC_TOKEN, fetchFn)
    if (remote) {
      return {
        mode: 'primary',
        active: remote.node,
        primary: { configured: true, status: 'up', lastSeenAt: checkedAt, info: remote.node },
        standby: remote.standby,
        gateways: remote.gateways,
        viewers: remote.viewers,
        checkedAt,
        primaryUrl: normalizeUrl(c.env.PRIMARY_URL),
        fallbackUrl: remote.fallbackUrl ?? normalizeUrl(c.env.FALLBACK_URL),
      }
    }
    probe.markDown()
  }

  const [self, last] = await Promise.all([
    describeSelf(c),
    readHeartbeat(c.env.DB).catch(() => null),
  ])
  const snap = probe.snapshot()
  return {
    mode: 'fallback',
    active: self.node,
    primary: {
      configured: true,
      status: 'down',
      lastSeenAt: Math.max(last?.seenAt ?? 0, snap.lastUpAt ?? 0) || null,
      info: last && checkedAt - last.seenAt <= FAILOVER.heartbeatStaleSec * 6 ? last.node : null,
    },
    standby: null,
    gateways: self.gateways,
    viewers: self.viewers,
    checkedAt,
    primaryUrl: normalizeUrl(c.env.PRIMARY_URL),
    fallbackUrl: normalizeUrl(c.env.FALLBACK_URL),
  }
}

/** URL chỉ để hiển thị: bỏ giá trị rỗng, cắt độ dài. */
function normalizeUrl(raw: string | undefined): string | null {
  const text = (raw ?? '').trim()
  return text === '' ? null : text.slice(0, 256)
}

async function askVps(
  origin: string,
  token: string | undefined,
  fetchFn: FetchFn,
): Promise<ServerSelf | null> {
  try {
    const res = await timedFetch(
      fetchFn,
      `${origin}/api/server-info/self`,
      { headers: token ? { Authorization: `Bearer ${token}` } : {} },
      FAILOVER.probeTimeoutMs,
    )
    if (!res.ok) {
      await res.body?.cancel()
      return null
    }
    const parsed = serverSelfSchema.safeParse(await res.json())
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}
