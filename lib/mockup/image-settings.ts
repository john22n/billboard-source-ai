import { z } from 'zod'

const dimensions = z
  .object({
    width: z.number().int().min(1).max(100),
    height: z.number().int().min(1).max(100),
  })
  .strict()
  .refine(({ width, height }) => width > height && width <= height * 6, {
    message:
      'Use a landscape face ratio greater than 1:1 and no wider than 6:1.',
  })

export const imageSettingsSchema = z
  .object({
    bulletin: dimensions,
    poster: dimensions,
  })
  .strict()

export type ImageSettings = z.infer<typeof imageSettingsSchema>

export const defaultImageSettings: ImageSettings = {
  bulletin: { width: 24, height: 7 },
  poster: { width: 13, height: 6 },
}
