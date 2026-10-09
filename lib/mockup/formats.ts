/** Pixel geometry is an application contract, not an editable prompt setting. */
export const artworkFormats = {
  bulletin: { width: 2304, height: 672, canvasHeight: 768 },
  poster: { width: 2496, height: 1152, canvasHeight: 1152 },
} as const

export type ArtworkFormat = keyof typeof artworkFormats
