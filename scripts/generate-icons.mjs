// Generates Carbon's brand icon (accent-green rounded square with a dark "C")
// as PNG + ICO assets, plus a base64 tray data URL. Pure Node (zlib only),
// so it runs without any native build tools. Run: node scripts/generate-icons.mjs
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const buildDir = join(root, 'build')

// Palette (matches tailwind.config.js).
const ACCENT = [0x3d, 0xdc, 0x97] // #3ddc97
const ACCENT_SOFT = [0x2f, 0xb8, 0x7e] // #2fb87e
const DARK = [0x07, 0x08, 0x09] // #070809

const lerp = (a, b, t) => a + (b - a) * t

function pointInRoundedRect(x, y, size, radius) {
  const r = radius
  const min = r
  const max = size - r
  const cx = Math.min(Math.max(x, min), max)
  const cy = Math.min(Math.max(y, min), max)
  // Inside the straight edges.
  if (x >= min && x <= max) return y >= 0 && y <= size
  if (y >= min && y <= max) return x >= 0 && x <= size
  // Corner regions: within the corner circle radius.
  const dx = x - cx
  const dy = y - cy
  return dx * dx + dy * dy <= r * r
}

// Colour (RGBA 0..255) for a subpixel sample at (px, py) in a size×size icon.
function sample(px, py, size) {
  const radius = size * 0.22
  if (!pointInRoundedRect(px, py, size, radius)) return [0, 0, 0, 0]

  // Diagonal accent gradient background.
  const t = (px + py) / (2 * size)
  const bg = [
    lerp(ACCENT[0], ACCENT_SOFT[0], t),
    lerp(ACCENT[1], ACCENT_SOFT[1], t),
    lerp(ACCENT[2], ACCENT_SOFT[2], t),
    255
  ]

  // Dark "C": an annulus with an opening on the right side.
  const cx = size / 2
  const cy = size / 2
  const dx = px - cx
  const dy = py - cy
  const dist = Math.hypot(dx, dy)
  const outer = size * 0.3
  const inner = size * 0.165
  const angle = Math.atan2(dy, dx) // -PI..PI, 0 = pointing right
  const gap = 0.72 // radians half-width of the opening on the right
  const inRing = dist >= inner && dist <= outer
  const inGap = Math.abs(angle) < gap
  if (inRing && !inGap) return [DARK[0], DARK[1], DARK[2], 255]

  return bg
}

// Render a size×size RGBA buffer with SSx supersampled antialiasing.
function render(size) {
  const SS = 4
  const buf = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const [sr, sg, sb, sa] = sample(
            x + (sx + 0.5) / SS,
            y + (sy + 0.5) / SS,
            size
          )
          // Premultiply by alpha for correct edge blending.
          const af = sa / 255
          r += sr * af
          g += sg * af
          b += sb * af
          a += sa
        }
      }
      const n = SS * SS
      const alpha = a / n
      const o = (y * size + x) * 4
      if (alpha <= 0) {
        buf[o] = buf[o + 1] = buf[o + 2] = buf[o + 3] = 0
      } else {
        // Un-premultiply.
        const af = a / 255
        buf[o] = Math.round(r / af)
        buf[o + 1] = Math.round(g / af)
        buf[o + 2] = Math.round(b / af)
        buf[o + 3] = Math.round(alpha)
      }
    }
  }
  return buf
}

// --- Minimal PNG encoder ---
const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crcBuf])
}

function encodePng(rgba, size) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  // Filtered scanlines (filter type 0 per row).
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  const idat = deflateSync(raw, { level: 9 })

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0))
  ])
}

// --- ICO container embedding PNG entries ---
function encodeIco(entries) {
  // entries: [{ size, png }]
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(entries.length, 4)

  const dir = Buffer.alloc(16 * entries.length)
  let offset = 6 + dir.length
  const images = []
  entries.forEach((e, i) => {
    const b = i * 16
    dir[b] = e.size >= 256 ? 0 : e.size // width (0 = 256)
    dir[b + 1] = e.size >= 256 ? 0 : e.size // height
    dir[b + 2] = 0 // colour count
    dir[b + 3] = 0 // reserved
    dir.writeUInt16LE(1, b + 4) // colour planes
    dir.writeUInt16LE(32, b + 6) // bits per pixel
    dir.writeUInt32LE(e.png.length, b + 8)
    dir.writeUInt32LE(offset, b + 12)
    offset += e.png.length
    images.push(e.png)
  })

  return Buffer.concat([header, dir, ...images])
}

mkdirSync(buildDir, { recursive: true })

const sizes = [16, 32, 48, 256]
const pngs = sizes.map((s) => ({ size: s, png: encodePng(render(s), s) }))

// App/window icon.
const png256 = pngs.find((p) => p.size === 256).png
writeFileSync(join(buildDir, 'icon.png'), png256)

// Installer/app icon (multi-resolution ICO).
writeFileSync(join(buildDir, 'icon.ico'), encodeIco(pngs))

// Tray icon data URL (32px, crisp on the taskbar, visible on light + dark).
const tray32 = pngs.find((p) => p.size === 32).png
const trayDataUrl = 'data:image/png;base64,' + tray32.toString('base64')
writeFileSync(join(buildDir, 'tray-icon.txt'), trayDataUrl)

console.log('Wrote build/icon.png, build/icon.ico, build/tray-icon.txt')
console.log('tray bytes:', tray32.length)
