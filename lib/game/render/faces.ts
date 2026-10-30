import * as THREE from 'three'
import type { Face } from '@/lib/shared/game'

/** Decoys deliberately share their lookalike's color so only the features differ. */
export const FACE_COLOR: Record<Face, string> = {
  smile: '#ffd23f',
  smirk: '#ffd23f',
  frown: '#4fa3ff',
  worried: '#4fa3ff',
  flat: '#e9edf2',
  meh: '#e9edf2',
  angry: '#ff4040',
  grumpy: '#ff4040',
}

/** Draws a neon line-art face, like an LED matrix sign. */
export function drawFace(ctx: CanvasRenderingContext2D, face: Face, cx: number, cy: number, r: number, glow = true) {
  const color = FACE_COLOR[face]
  ctx.save()
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = r * 0.11
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  if (glow) {
    ctx.shadowColor = color
    ctx.shadowBlur = r * 0.35
  }

  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.stroke()

  const ex = r * 0.36
  const ey = cy - r * 0.2
  const dot = (x: number) => {
    ctx.beginPath()
    ctx.arc(x, ey, r * 0.1, 0, Math.PI * 2)
    ctx.fill()
  }
  const line = (x1: number, y1: number, x2: number, y2: number) => {
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.stroke()
  }
  const arcMouth = (y: number, w: number, curve: number) => {
    ctx.beginPath()
    ctx.moveTo(cx - w, y)
    ctx.quadraticCurveTo(cx, y + curve, cx + w, y)
    ctx.stroke()
  }

  switch (face) {
    case 'smile': {
      // Closed happy eyes and a wide open grin.
      for (const s of [-1, 1]) {
        ctx.beginPath()
        ctx.arc(cx + s * ex, ey + r * 0.06, r * 0.14, Math.PI * 1.1, Math.PI * 1.9)
        ctx.stroke()
      }
      ctx.beginPath()
      ctx.moveTo(cx - r * 0.55, cy + r * 0.12)
      ctx.lineTo(cx + r * 0.55, cy + r * 0.12)
      ctx.quadraticCurveTo(cx, cy + r * 0.95, cx - r * 0.55, cy + r * 0.12)
      ctx.stroke()
      line(cx - r * 0.42, cy + r * 0.3, cx + r * 0.42, cy + r * 0.3)
      break
    }
    case 'smirk': {
      dot(cx - ex)
      dot(cx + ex)
      arcMouth(cy + r * 0.25, r * 0.45, r * 0.45)
      break
    }
    case 'frown': {
      dot(cx - ex)
      dot(cx + ex)
      arcMouth(cy + r * 0.52, r * 0.42, -r * 0.5)
      break
    }
    case 'worried': {
      dot(cx - ex)
      dot(cx + ex)
      line(cx - ex - r * 0.16, ey - r * 0.2, cx - ex + r * 0.14, ey - r * 0.32)
      line(cx + ex + r * 0.16, ey - r * 0.2, cx + ex - r * 0.14, ey - r * 0.32)
      arcMouth(cy + r * 0.5, r * 0.3, -r * 0.3)
      break
    }
    case 'flat': {
      dot(cx - ex)
      dot(cx + ex)
      line(cx - r * 0.4, cy + r * 0.38, cx + r * 0.4, cy + r * 0.38)
      break
    }
    case 'meh': {
      line(cx - ex - r * 0.14, ey, cx - ex + r * 0.14, ey)
      line(cx + ex - r * 0.14, ey, cx + ex + r * 0.14, ey)
      line(cx - r * 0.4, cy + r * 0.38, cx + r * 0.4, cy + r * 0.38)
      break
    }
    case 'angry': {
      dot(cx - ex)
      dot(cx + ex)
      line(cx - ex - r * 0.2, ey - r * 0.3, cx - ex + r * 0.16, ey - r * 0.12)
      line(cx + ex + r * 0.2, ey - r * 0.3, cx + ex - r * 0.16, ey - r * 0.12)
      arcMouth(cy + r * 0.48, r * 0.38, -r * 0.3)
      break
    }
    case 'grumpy': {
      dot(cx - ex)
      dot(cx + ex)
      line(cx - ex - r * 0.2, ey - r * 0.3, cx - ex + r * 0.16, ey - r * 0.12)
      line(cx + ex + r * 0.2, ey - r * 0.3, cx + ex - r * 0.16, ey - r * 0.12)
      ctx.beginPath()
      ctx.moveTo(cx - r * 0.38, cy + r * 0.42)
      for (let i = 1; i <= 4; i++) ctx.lineTo(cx - r * 0.38 + i * r * 0.19, cy + r * (i % 2 ? 0.32 : 0.42))
      ctx.stroke()
      break
    }
  }
  ctx.restore()
}

const faceTextureCache = new Map<Face, THREE.CanvasTexture>()

export function faceTexture(face: Face) {
  const cached = faceTextureCache.get(face)
  if (cached) return cached
  const size = 256
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, size, size)
  drawFace(ctx, face, size / 2, size / 2, size * 0.36)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  faceTextureCache.set(face, tex)
  return tex
}
