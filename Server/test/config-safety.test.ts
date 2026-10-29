import { describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config'

const base = { AZ_DATA: '/tmp/az-config-safety', AZ_ENV_FILE: '/nonexistent/server.env' }
const LONG = 'a'.repeat(40)

describe('chốt chặn cấu hình nguy hiểm', () => {
  it('AZ_DEV_LINKS_API=1 chạy được khi chỉ nghe loopback (dev bình thường)', () => {
    const cfg = loadConfig({
      ...base,
      AZ_DEV_LINKS_API: '1',
      AZ_CLOUD_URL: 'http://127.0.0.1:8787',
      AZ_SYNC_TOKEN: 'dev-sync-token-0123456789abcdef',
    })
    expect(cfg.devLinksApi).toBe('1')
  })

  it.each([
    ['nghe 0.0.0.0', { AZ_HOST: '0.0.0.0' }, 'AZ_HOST'],
    ['bật Quick Tunnel', { AZ_QUICK_TUNNEL: '1' }, 'AZ_QUICK_TUNNEL'],
    ['nối Worker thật', { AZ_CLOUD_URL: 'https://az-sentinel-api.x.workers.dev' }, 'AZ_CLOUD_URL'],
  ])('AZ_DEV_LINKS_API=1 bị từ chối khi %s', (_n, extra, mention) => {
    expect(() => loadConfig({ ...base, AZ_DEV_LINKS_API: '1', ...extra })).toThrow(mention)
  })

  it('không có cờ dev: cấu hình production bình thường vẫn chạy', () => {
    const cfg = loadConfig({
      ...base,
      AZ_HOST: '0.0.0.0',
      AZ_QUICK_TUNNEL: '1',
      AZ_CLOUD_URL: 'https://az-sentinel-api.x.workers.dev',
      AZ_SYNC_TOKEN: LONG,
    })
    expect(cfg.devLinksApi).toBe('')
  })

  it('AZ_SYNC_TOKEN ngắn hơn 32 ký tự bị từ chối; để trống thì được', () => {
    expect(() => loadConfig({ ...base, AZ_SYNC_TOKEN: 'ngan' })).toThrow('AZ_SYNC_TOKEN')
    expect(() => loadConfig({ ...base })).not.toThrow()
  })
})
