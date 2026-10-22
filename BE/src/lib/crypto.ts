export type GeneratedGwToken = {
  /** Token đầy đủ: chỉ hiện một lần cho quản trị viên, không lưu. */
  token: string
  tokenHash: string
  tokenPrefix: string
}

/** Token Gateway: `azt_` + 24 byte ngẫu nhiên (base64url, 32 ký tự). */
export async function generateGwToken(): Promise<GeneratedGwToken> {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  const token = `${GW_TOKEN_PREFIX}${toBase64Url(bytes)}`
  return {
    token,
    tokenHash: await sha256Hex(token),
    tokenPrefix: token.slice(0, GW_TOKEN_SHOWN_PREFIX),
  }
}