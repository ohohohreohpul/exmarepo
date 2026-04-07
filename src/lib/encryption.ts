import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto'

function getKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY
  if (raw) return Buffer.from(raw, 'base64').slice(0, 32)
  // fallback: derive from service role key
  return createHash('sha256')
    .update(process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'dev-fallback')
    .digest()
}

export function encrypt(text: string): string {
  const iv  = randomBytes(16)
  const key = getKey()
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`
}

export function decrypt(data: string): string {
  const [ivB64, tagB64, encB64] = data.split(':')
  const key = getKey()
  const iv        = Buffer.from(ivB64,  'base64')
  const tag       = Buffer.from(tagB64, 'base64')
  const encrypted = Buffer.from(encB64, 'base64')
  const decipher  = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return decipher.update(encrypted) + decipher.final('utf8')
}
