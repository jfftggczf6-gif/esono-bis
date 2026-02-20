// Cookie utilities for development vs production

export function getCookieOptions(c: any) {
  const host = c.req.header('host') || ''
  const isLocalhost = host.includes('localhost') || host.includes('127.0.0.1')
  const isSandbox = host.includes('.sandbox.') || host.includes('.e2b.')

  // Sandbox URLs are accessed via HTTPS externally, so cookies must be Secure + SameSite=None
  if (isSandbox) {
    return {
      httpOnly: false,
      secure: true,
      sameSite: 'None' as const,
      maxAge: 60 * 60 * 24 * 7,
      path: '/'
    }
  }

  // Localhost dev
  if (isLocalhost) {
    return {
      httpOnly: true,
      secure: false,
      sameSite: 'Lax' as const,
      maxAge: 60 * 60 * 24 * 7,
      path: '/'
    }
  }

  // Production (Cloudflare Pages — always HTTPS)
  return {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax' as const,
    maxAge: 60 * 60 * 24 * 7,
    path: '/'
  }
}
