import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { API_CSP, applySecurityHeaders, HSTS_VALUE, UI_CSP } from '../src'

describe('applySecurityHeaders', () => {
  it('UI: có CSP giao diện, chống nhúng iframe, không có HSTS khi HTTP', () => {
    const h = new Headers()
    applySecurityHeaders(h, 'ui', false)
    expect(h.get('Content-Security-Policy')).toBe(UI_CSP)
    expect(h.get('Content-Security-Policy')).toContain("frame-ancestors 'none'")
    expect(h.get('X-Frame-Options')).toBe('DENY')
    expect(h.get('X-Content-Type-Options')).toBe('nosniff')
    expect(h.has('Strict-Transport-Security')).toBe(false)
  })

  it('API: CSP none, HSTS khi HTTPS', () => {
    const h = new Headers()
    applySecurityHeaders(h, 'api', true)
    expect(h.get('Content-Security-Policy')).toBe(API_CSP)
    expect(h.get('Strict-Transport-Security')).toBe(HSTS_VALUE)
  })

  it('không ghi đè header route đã đặt', () => {
    const h = new Headers({ 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'SAMEORIGIN' })
    applySecurityHeaders(h, 'ui', true)
    expect(h.get('Referrer-Policy')).toBe('same-origin')
    expect(h.get('X-Frame-Options')).toBe('SAMEORIGIN')
  })

  it('FE/public/_headers khớp UI_CSP (không lệch với Server/Worker)', () => {
    const file = readFileSync(new URL('../../FE/public/_headers', import.meta.url), 'utf8')
    expect(file).toContain(`Content-Security-Policy: ${UI_CSP}`)
    expect(file).toContain('X-Frame-Options: DENY')
  })
})
