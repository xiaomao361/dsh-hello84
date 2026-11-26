const SVG_NS = 'http://www.w3.org/2000/svg'

// Crisp 1-bit pixel-art SVG icons inspired by Susan Kare's 1984 Macintosh System 1-6.
const ICONS = {
  // Classic 1984 Happy Mac
  happyMac: `
    <path fill="currentColor" d="M2 1h12v1h1v12h-1v1H2v-1H1V2h1V1zm0 1v12h12V2H2z"/>
    <path fill="currentColor" d="M3 3h10v7H3V3zm1 1v5h8V4H4z"/>
    <rect x="6" y="5" width="1" height="2" fill="currentColor"/>
    <rect x="9" y="5" width="1" height="2" fill="currentColor"/>
    <path fill="currentColor" d="M6 7h1v1h2V7h1v1H9v1H7V8H6V7z"/>
    <rect x="9" y="12" width="4" height="1" fill="currentColor"/>
    <rect x="3" y="12" width="2" height="1" fill="currentColor"/>`,

  // Classic Sad Mac
  sadMac: `
    <path fill="currentColor" d="M2 1h12v1h1v12h-1v1H2v-1H1V2h1V1zm0 1v12h12V2H2z"/>
    <path fill="currentColor" d="M3 3h10v7H3V3zm1 1v5h8V4H4z"/>
    <path fill="currentColor" d="M5 5h1v1H5zm1 1h1v1H6zm1-1h1v1H7zM5 7h1v1H5zM9 5h1v1H9zm1 1h1v1h-1zm1-1h1v1h-1zM9 7h1v1H9z"/>
    <path fill="currentColor" d="M6 8h4v1H6z"/>
    <rect x="9" y="12" width="4" height="1" fill="currentColor"/>`,

  // System 6 Wristwatch busy cursor
  wristwatch: `
    <rect x="5" y="1" width="6" height="2" fill="currentColor"/>
    <rect x="5" y="13" width="6" height="2" fill="currentColor"/>
    <path fill="currentColor" d="M4 3h8v1h1v8h-1v1H4v-1H3V4h1V3zm0 1v8h8V4H4z"/>
    <rect x="13" y="7" width="1" height="2" fill="currentColor"/>
    <rect x="7" y="5" width="1" height="4" fill="currentColor"/>
    <rect x="8" y="8" width="3" height="1" fill="currentColor"/>`,

  // 3.5" Sony Floppy Disk
  floppy: `
    <path fill="currentColor" d="M1 1h12l2 2v12H1V1zm1 1v12h12V3.4L12.6 2H2z"/>
    <path fill="currentColor" d="M4 2h7v5H4V2zm1 1v3h5V3H5z"/>
    <rect x="8" y="3" width="1" height="3" fill="currentColor"/>
    <path fill="currentColor" d="M3 9h10v5H3V9zm1 1v3h8v-3H4z"/>
    <rect x="5" y="11" width="6" height="1" fill="currentColor"/>`,

  // Mini DSH Retro Terminal
  miniDsh: `
    <path fill="currentColor" d="M1 2h14v12H1V2zm1 1v2h12V3H2zm0 3v7h12V6H2z"/>
    <rect x="3" y="3" width="1" height="1" fill="var(--h84-surface, #fff)"/>
    <path fill="currentColor" d="M4 8h1v1H4zm1 1h1v1H5zm-1 1h1v1H4z"/>
    <rect x="7" y="10" width="4" height="1" fill="currentColor"/>`,

  // Classic Note Pad with dog-ear
  notepad: `
    <path fill="currentColor" d="M2 1h12v14H6l-4-4V1zm1 1v8h4v4h6V2H3zm0 9l3 3v-3H3z"/>
    <rect x="5" y="4" width="6" height="1" fill="currentColor"/>
    <rect x="5" y="6" width="6" height="1" fill="currentColor"/>
    <rect x="5" y="8" width="4" height="1" fill="currentColor"/>`,

  // Classic Alarm Clock
  alarm: `
    <path fill="currentColor" d="M2 2h3v1H4v1H2V2zm9 0h3v2h-2V3h-1V2z"/>
    <path fill="currentColor" d="M5 3h6v1h2v2h1v5h-1v2h-2v1H5v-1H3v-2H2V6h1V4h2V3zm0 1v1H4v1H3v5h1v1h1v1h6v-1h1v-1h1V6h-1V5h-1V4H5z"/>
    <rect x="7" y="6" width="1" height="3" fill="currentColor"/>
    <rect x="8" y="8" width="3" height="1" fill="currentColor"/>
    <rect x="3" y="14" width="2" height="1" fill="currentColor"/>
    <rect x="11" y="14" width="2" height="1" fill="currentColor"/>`,

  // MacPaint Brush & Canvas
  macpaint: `
    <path fill="currentColor" d="M1 2h14v12H1V2zm1 1v10h12V3H2z"/>
    <path fill="currentColor" d="M10 4h2v2h-1v1h-1v1H9v1H8v1H6v1H4v-2h1V8h1V7h1V6h1V5h2V4z"/>
    <rect x="3" y="11" width="3" height="1" fill="currentColor"/>`,

  // Classic Minesweeper Bomb
  minesweeper: `
    <rect x="7" y="1" width="2" height="2" fill="currentColor"/>
    <rect x="7" y="13" width="2" height="2" fill="currentColor"/>
    <rect x="1" y="7" width="2" height="2" fill="currentColor"/>
    <rect x="13" y="7" width="2" height="2" fill="currentColor"/>
    <rect x="3" y="3" width="2" height="2" fill="currentColor"/>
    <rect x="11" y="3" width="2" height="2" fill="currentColor"/>
    <rect x="3" y="11" width="2" height="2" fill="currentColor"/>
    <rect x="11" y="11" width="2" height="2" fill="currentColor"/>
    <path fill="currentColor" d="M5 4h6v1h1v6h-1v1H5v-1H4V5h1V4z"/>
    <rect x="6" y="6" width="2" height="2" fill="var(--h84-surface, #fff)"/>`,

  // Pixel Apple Menu Emblem
  apple: `
    <rect x="8" y="2" width="2" height="1" fill="currentColor"/>
    <rect x="7" y="3" width="2" height="1" fill="currentColor"/>
    <path fill="currentColor" d="M4 5h3v1h2V5h3v1h1v2h-1v2h1v2h-1v2H9v-1H7v1H4v-2H3V6h1V5z"/>`,

  soundOn: `
    <path fill="currentColor" d="M2 6h3l3-3v10l-3-3H2V6z"/>
    <rect x="10" y="6" width="1" height="4" fill="currentColor"/>
    <rect x="12" y="4" width="1" height="8" fill="currentColor"/>`,

  soundOff: `
    <path fill="currentColor" d="M2 6h3l3-3v10l-3-3H2V6z"/>
    <path fill="currentColor" d="M10 6h1v1h1v1h-1v1h-1V8h1V7h-1V6zm3 0h1v1h-1v1h1v1h-1V8h-1V7h1V6z"/>`,

  // InnerLife thought-cloud pixel icon
  innerlife: `
    <path fill="currentColor" d="M5 2h6v1h2v1h1v4h-1v1h-2v1H5V9H3V8H2V4h1V3h2V2zm0 1v1H3v4h2v1h6V8h2V4h-2V3H5z"/>
    <rect x="6" y="5" width="1" height="2" fill="currentColor"/>
    <rect x="9" y="5" width="1" height="2" fill="currentColor"/>
    <rect x="4" y="11" width="2" height="2" fill="currentColor"/>
    <rect x="2" y="13" width="2" height="2" fill="currentColor"/>`,

  // Classic 1984 Flying Toaster pixel icon
  toaster: `
    <path fill="currentColor" d="M1 4h4v1H3v1h2v1H2V6H1V4zm10 0h4v2h-1v1h-3V6h2V5h-2V4z"/>
    <path fill="currentColor" d="M5 5h6v1h1v6H4V6h1V5zm0 1v5h6V6H5z"/>
    <rect x="6" y="3" width="4" height="2" fill="currentColor"/>
    <rect x="6" y="8" width="1" height="2" fill="currentColor"/>
    <rect x="9" y="8" width="1" height="2" fill="currentColor"/>`,

  // Classic pixel starfield icon
  stars: `
    <rect x="3" y="2" width="1" height="3" fill="currentColor"/>
    <rect x="2" y="3" width="3" height="1" fill="currentColor"/>
    <rect x="11" y="4" width="1" height="5" fill="currentColor"/>
    <rect x="9" y="6" width="5" height="1" fill="currentColor"/>
    <rect x="6" y="10" width="1" height="3" fill="currentColor"/>
    <rect x="5" y="11" width="3" height="1" fill="currentColor"/>
    <rect x="12" y="12" width="1" height="1" fill="currentColor"/>`,

  // Retro 1-bit Terminal (solid screen with bright >_ prompt)
  terminal: `
    <path fill="currentColor" d="M1 2h14v12H1V2z"/>
    <path fill="var(--h84-surface, #fff)" d="M3 5h1v1H3zm1 1h1v1H4zm1 1h1v1H5zm-1 1h1v1H4zm-1 1h1v1H3z"/>
    <rect x="7" y="9" width="5" height="1" fill="var(--h84-surface, #fff)"/>`,
}

export function pixelIcon(doc, name, size = 16) {
  const svg = doc.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', '0 0 16 16')
  svg.setAttribute('width', String(size))
  svg.setAttribute('height', String(size))
  svg.setAttribute('shape-rendering', 'crispEdges')
  svg.setAttribute('aria-hidden', 'true')
  svg.classList.add('h84-icon')
  svg.innerHTML = ICONS[name] || ICONS.happyMac
  return svg
}

export function helloBootSvg(doc) {
  const svg = doc.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', '0 0 260 96')
  svg.setAttribute('class', 'h84-hello-svg')
  svg.setAttribute('aria-label', 'hello.')
  svg.innerHTML = `
    <path class="h84-hello-path" d="M22 68 C 30 48, 42 18, 46 14 C 49 11, 44 38, 36 68 M 39 50 C 48 38, 60 36, 60 48 C 60 58, 56 68, 64 68 C 72 68, 82 58, 88 48 C 94 38, 82 36, 76 46 C 70 56, 76 69, 90 68 C 102 67, 114 48, 122 20 C 125 10, 116 18, 110 46 C 106 64, 112 70, 122 68 C 132 66, 146 48, 154 20 C 157 10, 148 18, 142 46 C 138 64, 144 70, 154 68 C 164 66, 174 56, 180 46 C 186 38, 198 38, 200 50 C 202 62, 190 70, 180 66 C 172 62, 174 44, 188 42 C 200 40, 208 48, 214 48" fill="none" stroke="currentColor" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/>
    <circle class="h84-hello-dot" cx="228" cy="64" r="4" fill="currentColor"/>
  `
  return svg
}
