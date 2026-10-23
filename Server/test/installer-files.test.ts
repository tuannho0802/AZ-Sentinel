import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Kiểm tĩnh các tệp bộ cài (Inno Setup, PowerShell, workflow). Không chạy được Inno/PowerShell trên Linux,
// nên test này chỉ bắt lỗi "quên cập nhật cho khớp" (đổi tên tệp, thêm biến cấu hình, bỏ sót script).
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (p: string) => readFileSync(path.join(root, p), 'utf8')

const serverIss = read('Installer/az-server.iss')
const gatewayIss = read('Installer/az-gateway.iss')
const packSrc = read('Server/scripts/pack.mjs')
const configSrc = read('Server/src/config.ts')

describe('bộ cài Server (az-server.iss)', () => {
  it('mọi script .iss gọi tới đều có trong Server/scripts và được pack.mjs chép', () => {
    const used = new Set(
      [...serverIss.matchAll(/\{app\}\\([\w-]+\.(?:ps1|cmd))/g)].map((m) => m[1] as string),
    )
    const extra = [...serverIss.matchAll(/\{#Src\}\\([\w-]+\.ps1)/g)].map((m) => m[1] as string)
    for (const f of [...used, ...extra]) {
      expect(existsSync(path.join(root, 'Server/scripts', f)), `thiếu Server/scripts/${f}`).toBe(
        true,
      )
      expect(packSrc, `pack.mjs chưa chép ${f}`).toContain(`'${f}'`)
    }
    expect(used.size).toBeGreaterThan(3)
  })

  it('pack.mjs chép đủ các script mà install-task.ps1 và run-server.cmd cần', () => {
    for (const f of [
      'run-server.cmd',
      'install-task.ps1',
      'uninstall-task.ps1',
      'server.env.example',
      'token.cmd',
      'user.cmd',
    ]) {
      expect(packSrc).toContain(`'${f}'`)
    }
  })

  it('server.env do bộ cài ghi chỉ dùng biến mà config.ts đọc', () => {
    const written = [...serverIss.matchAll(/'(AZ_[A-Z_]+)='/g)].map((m) => m[1] as string)
    expect(written).toEqual(
      expect.arrayContaining([
        'AZ_PORT',
        'AZ_HOST',
        'AZ_SRV_NAME',
        'AZ_SYNC_TOKEN',
        'AZ_CLOUD_URL',
        'AZ_FALLBACK_URL',
      ]),
    )
    for (const k of written) expect(configSrc, `${k} không có trong config.ts`).toContain(k)
  })

  it('không hỏi hay ghi token Gateway chung (token là của từng người, do quản trị viên cấp)', () => {
    expect(serverIss).not.toContain('GW_CONNECT_TOKEN')
    expect(serverIss).not.toMatch(/AZ_DEV_GW_TOKEN|AZ_DEV_LINKS_API/)
  })

  it('đóng gói cùng giao diện web và node.exe, có tác vụ tự khởi động và quy tắc khóa quyền server.env', () => {
    expect(serverIss).toContain('recursesubdirs')
    expect(serverIss).toContain('install-task.ps1')
    expect(serverIss).toMatch(/icacls[^\n]*server\.env|EnvPath[^\n]*\/inheritance:r/)
    expect(read('.github/workflows/release-server.yml')).toContain('node.exe')
    expect(read('Server/scripts/install-task.ps1')).toContain("'node.exe'")
  })

  it('mặc định chỉ nghe loopback, chỉ mở LAN khi người dùng chọn', () => {
    expect(serverIss).toContain("'127.0.0.1'")
    expect(serverIss).toMatch(/if WantLan then Host := '0\.0\.0\.0'/)
  })

  it('AppId khác bộ cài Gateway (hai sản phẩm cài song song được)', () => {
    const id = (s: string) => /AppId=\{\{([0-9A-F-]+)\}/i.exec(s)?.[1]
    expect(id(serverIss)).toBeTruthy()
    expect(id(serverIss)).not.toBe(id(gatewayIss))
  })
})

describe('bộ cài Gateway (az-gateway.iss) theo token cá nhân', () => {
  it('không còn khóa chung GW_CONNECT_TOKEN, hỏi token cá nhân azt_...', () => {
    expect(gatewayIss).not.toContain('GW_CONNECT_TOKEN')
    expect(gatewayIss).toContain('azt_')
  })

  it('kiểm hình dạng token khớp looksLikeGwToken (azt_, 20..128 ký tự, A-Za-z0-9_-)', () => {
    const schema = read('Shared/src/token-schema.ts')
    expect(schema).toContain("GW_TOKEN_PREFIX = 'azt_'")
    expect(schema).toMatch(/GW_TOKEN_PREFIX\.length \+ 16/)
    expect(schema).toContain('value.length <= 128')
    expect(gatewayIss).toContain('(Length(T) < 20) or (Length(T) > 128)')
  })

  it('kiểm token với cloud qua check-token và dựa đúng mã thoát của Gateway', () => {
    expect(gatewayIss).toContain('check-token')
    expect(gatewayIss).toContain('Flags: dontcopy')
    const checkSrc = read('Gateway/src/check-token.ts')
    expect(checkSrc).toContain('CHECK_INVALID = 1')
    expect(checkSrc).toContain('CHECK_UNREACHABLE = 2')
    expect(gatewayIss).toMatch(/Code = 1/)
    expect(gatewayIss).toMatch(/Code = 2/)
  })

  it('cài im lặng cũng kiểm token và có lối thoát /SKIPTOKENCHECK', () => {
    expect(gatewayIss).toMatch(/WizardSilent[^\n]*SkipTokenCheck/)
    expect(gatewayIss).toContain('SKIPTOKENCHECK')
  })

  it('nâng cấp từ khóa chung cũ: bắt nhập token mới, chỉ đổi cloudToken trong config.json', () => {
    expect(gatewayIss).toContain('NeedsTokenMigration')
    expect(gatewayIss).toContain('procedure MigrateToken')
  })

  it('config.json bộ cài ghi dùng đúng khóa mà Gateway/src/config.ts đọc', () => {
    const cfg = read('Gateway/src/config.ts')
    for (const k of ['vps', 'cloudUrl', 'cloudFallbackUrl', 'cloudToken']) {
      expect(cfg).toContain(`${k}:`)
      expect(gatewayIss).toContain(`"${k}"`)
    }
  })
})

describe('Quick Tunnel (Plan 3G)', () => {
  it('biến cấu hình có trong config.ts và server.env.example; script bật/tắt được pack.mjs chép', () => {
    const example = read('Server/scripts/server.env.example')
    for (const k of ['AZ_QUICK_TUNNEL', 'AZ_CLOUDFLARED']) {
      expect(configSrc, `${k} không có trong config.ts`).toContain(k)
      expect(example, `${k} không có trong server.env.example`).toContain(k)
    }
    expect(existsSync(path.join(root, 'Server/scripts/quick-tunnel.ps1'))).toBe(true)
    expect(packSrc).toContain("'quick-tunnel.ps1'")
  })

  it('stop-server.ps1 tắt cả cloudflared của Quick Tunnel (tiến trình con không tự chết theo node)', () => {
    expect(read('Server/scripts/stop-server.ps1')).toContain('cloudflared.exe')
  })
})

describe('bộ cài Server: hằng số {app} chỉ dùng sau khi đã chốt thư mục cài', () => {
  // InitializeWizard và ShouldSkipPage chạy TRƯỚC trang chọn thư mục; lúc đó expand {app} làm Inno báo
  // "An attempt was made to expand the app constant before it was initialized" và bộ cài dừng ngay.
  const body = (name: string) => {
    const m = serverIss.match(new RegExp(`function ${name}[^\\n]*\\n([\\s\\S]*?)\\nend;`))
    return m?.[1] ?? ''
  }

  it('EnvPath (được InitializeWizard/ShouldSkipPage gọi sớm) dùng WizardDirValue, không dùng {app}', () => {
    const env = body('EnvPath')
    expect(env).toContain('WizardDirValue')
    expect(env).not.toContain('{app}')
  })

  it('các hàm chạy trước khi chốt thư mục không expand {app} (trực tiếp)', () => {
    for (const fn of ['WillWriteEnv', 'WantAdvanced', 'PortValue', 'ShouldSkipPage']) {
      expect(body(fn), `${fn} không được dùng {app}`).not.toContain('{app}')
    }
    const init = serverIss.match(/procedure InitializeWizard;[\s\S]*?\nend;/)?.[0] ?? ''
    expect(init.length).toBeGreaterThan(100)
    expect(init).not.toContain('{app}')
  })

  it('đổi thư mục cài thì tính lại FreshInstall (trang cuối nói đúng)', () => {
    expect(serverIss).toMatch(/CurPageID = wpSelectDir then FreshInstall := WillWriteEnv/)
  })
})

/**
 * Không có Inno Setup trên máy dev/CI Linux nên không biên dịch thử được; quét thô phần [Code] theo luật Pascal Script
 * để bắt lỗi cú pháp hay gặp ngay trong test (ISCC "String error" làm hỏng cả bản phát hành mới phát hiện).
 */
function scanPascal(src: string): string[] {
  const start = src.indexOf('[Code]')
  const code = src.slice(start)
  const base = src.slice(0, start).split('\n').length - 1
  const problems: string[] = []
  const lineAt = (i: number) => base + code.slice(0, i).split('\n').length
  let i = 0
  while (i < code.length) {
    const c = code[i]
    if (c === "'") {
      const from = i
      i++
      for (;;) {
        if (i >= code.length || code[i] === '\n') {
          problems.push(`chuỗi chưa đóng ở dòng ${lineAt(from)}`)
          break
        }
        if (code[i] === "'") {
          if (code[i + 1] === "'") i += 2
          else {
            i++
            break
          }
        } else i++
      }
    } else if (c === '/' && code[i + 1] === '/') {
      while (i < code.length && code[i] !== '\n') i++
    } else if (c === '{') {
      const from = i
      i++
      while (i < code.length && code[i] !== '}') {
        if (code[i] === '{') problems.push(`dấu { nằm trong chú thích { } ở dòng ${lineAt(from)}`)
        i++
      }
      i++
    } else i++
  }
  return problems
}

describe('bộ cài Server: cú pháp [Code] (Pascal Script)', () => {
  it('không có chuỗi chưa đóng và không có chú thích { } chứa dấu { (ví dụ ghi hằng số trong chú thích)', () => {
    expect(scanPascal(serverIss)).toEqual([])
    expect(scanPascal(gatewayIss)).toEqual([])
  })

  it('bộ quét thật sự bắt được đúng lỗi từng làm hỏng bản build', () => {
    const bad = "[Code]\n{ khong dung ExpandConstant('{app}') o day }\nfunction F: String;\nbegin\nend;\n"
    expect(scanPascal(bad).length).toBeGreaterThan(0)
    expect(scanPascal("[Code]\n// ExpandConstant('{app}') chi la chu thich\nvar A: Integer;\n")).toEqual([])
    expect(scanPascal("[Code]\nvar S: String;\nbegin\n  S := 'it''s {app}';\nend;\n")).toEqual([])
  })
})
