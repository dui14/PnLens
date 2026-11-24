import {
  AVATAR_FILE_EXT,
  AVATAR_FILE_PREFIX,
  type AvatarMime,
} from '@/lib/avatar/avatarConfig'

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff]
const RIFF_SIGNATURE = [0x52, 0x49, 0x46, 0x46]
const WEBP_SIGNATURE = [0x57, 0x45, 0x42, 0x50]
const WEBP_TAG_OFFSET = 8

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false
  return signature.every((value, index) => bytes[offset + index] === value)
}

export function detectImageType(bytes: Uint8Array): AvatarMime | null {
  if (startsWith(bytes, PNG_SIGNATURE)) return 'image/png'
  if (startsWith(bytes, JPEG_SIGNATURE)) return 'image/jpeg'
  if (startsWith(bytes, RIFF_SIGNATURE) && startsWith(bytes, WEBP_SIGNATURE, WEBP_TAG_OFFSET)) {
    return 'image/webp'
  }
  return null
}

export function buildAvatarPath(userId: string, timestamp: number): string {
  return `${userId}/${AVATAR_FILE_PREFIX}${timestamp}.${AVATAR_FILE_EXT}`
}

export function selectStaleAvatarPaths(
  userId: string,
  existingNames: string[],
  keepPath: string | null
): string[] {
  return existingNames
    .map((name) => `${userId}/${name}`)
    .filter((path) => path !== keepPath)
}
