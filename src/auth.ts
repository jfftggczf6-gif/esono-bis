// Auth utilities for JWT
import { sign, verify } from 'hono/jwt'
import { getCookie } from 'hono/cookie'

const JWT_SECRET = 'your-super-secret-key-change-in-production-2024'

export interface JWTPayload {
  userId: number
  email: string
  userType: 'pre_entrepreneur' | 'entrepreneur'
}

// Get auth token from cookie, Authorization header, or query param
export function getAuthToken(c: any): string | undefined {
  // 1. Cookie
  const cookieToken = getCookie(c, 'auth_token')
  if (cookieToken) return cookieToken
  // 2. Authorization header
  const authHeader = c.req.header('Authorization') || ''
  if (authHeader.startsWith('Bearer ')) return authHeader.slice(7)
  // 3. Query param
  const qToken = c.req.query('token')
  if (qToken) return qToken
  return undefined
}

export async function generateToken(payload: JWTPayload): Promise<string> {
  return await sign(
    {
      ...payload,
      exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7, // 7 days
    },
    JWT_SECRET
  )
}

export async function verifyToken(token: string): Promise<JWTPayload | null> {
  try {
    const payload = await verify(token, JWT_SECRET, 'HS256')
    return payload as JWTPayload
  } catch (error) {
    return null
  }
}

export async function hashPassword(password: string): Promise<string> {
  // Simple hash for MVP (use bcrypt in production)
  const encoder = new TextEncoder()
  const data = encoder.encode(password + JWT_SECRET)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const passwordHash = await hashPassword(password)
  return passwordHash === hash
}
