import {
  AVATAR_EXPORT_QUALITY,
  AVATAR_OUTPUT_SIZE,
} from '@/lib/avatar/avatarConfig'

export type PixelCrop = { x: number; y: number; width: number; height: number }

const PRIMARY_EXPORT_TYPE = 'image/webp'
const FALLBACK_EXPORT_TYPE = 'image/jpeg'
const FULL_TURN_DEGREES = 180

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('IMAGE_LOAD_FAILED'))
    image.src = src
  })
}

export function rotatedBounds(
  width: number,
  height: number,
  rotation: number
): { width: number; height: number } {
  const radians = (rotation * Math.PI) / FULL_TURN_DEGREES
  return {
    width: Math.abs(Math.cos(radians) * width) + Math.abs(Math.sin(radians) * height),
    height: Math.abs(Math.sin(radians) * width) + Math.abs(Math.cos(radians) * height),
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, AVATAR_EXPORT_QUALITY))
}

export async function renderCroppedAvatar(
  src: string,
  crop: PixelCrop,
  rotation: number
): Promise<Blob> {
  const image = await loadImage(src)
  const radians = (rotation * Math.PI) / FULL_TURN_DEGREES
  const bounds = rotatedBounds(image.width, image.height, rotation)

  const stage = document.createElement('canvas')
  stage.width = bounds.width
  stage.height = bounds.height
  const stageCtx = stage.getContext('2d')
  if (!stageCtx) throw new Error('CANVAS_UNAVAILABLE')
  stageCtx.translate(bounds.width / 2, bounds.height / 2)
  stageCtx.rotate(radians)
  stageCtx.drawImage(image, -image.width / 2, -image.height / 2)

  const output = document.createElement('canvas')
  output.width = AVATAR_OUTPUT_SIZE
  output.height = AVATAR_OUTPUT_SIZE
  const outputCtx = output.getContext('2d')
  if (!outputCtx) throw new Error('CANVAS_UNAVAILABLE')
  outputCtx.imageSmoothingQuality = 'high'
  outputCtx.drawImage(
    stage,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    AVATAR_OUTPUT_SIZE,
    AVATAR_OUTPUT_SIZE
  )

  const webp = await canvasToBlob(output, PRIMARY_EXPORT_TYPE)
  if (webp && webp.type === PRIMARY_EXPORT_TYPE) return webp
  const jpeg = await canvasToBlob(output, FALLBACK_EXPORT_TYPE)
  if (!jpeg) throw new Error('EXPORT_FAILED')
  return jpeg
}
