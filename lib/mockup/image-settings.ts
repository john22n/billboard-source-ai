import { z } from 'zod'

const prompt = z.string().trim().min(1).max(8000)
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
    sharedPrompt: prompt,
    bulletinPrompt: prompt,
    revisionPrompt: prompt,
    posterPrompt: prompt,
    bulletin: dimensions,
    poster: dimensions,
  })
  .strict()

export type ImageSettings = z.infer<typeof imageSettingsSchema>

export const defaultImageSettings: ImageSettings = {
  sharedPrompt:
    'Create a professional realistic outdoor billboard concept mockup. Large bold legible lettering, strong contrast, prominent advertiser identity and instant comprehension at highway speed. Print only approved copy, spelled exactly. No placeholder text, paragraphs, clutter or invented logos. Preserve brand colors, original photography and recognizable people from supplied references. Static billboard unless the brief says digital.',
  bulletinPrompt:
    'Render one finished wide horizontal bulletin, nearly front-on, with the completed artwork printed on a realistic billboard structure. Include a clean blue sky with the target location’s skyline in the background, subtle and secondary to the billboard. If no location was provided, keep the clean blue sky without inventing a city. Respect user-supplied background overrides. The billboard should dominate the scene; no distracting scenery, unrelated signs or extra people.',
  revisionPrompt:
    'Edit the supplied CURRENT selected outdoor billboard concept. Preserve its copy, layout, brand identity, background and prior changes except where the requested changes explicitly alter them. Do not reintroduce removed elements.',
  posterPrompt:
    'Adapt the supplied BULLETIN into a taller POSTER face using the SAME design. Preserve the advertiser identity, exact approved copy, colors, typography style, photography and people. Rearrange and reflow the layout to fit the taller face; do not stretch or merely crop the bulletin. Keep every approved word unless the user explicitly requested a poster-specific copy change. Retain the outdoor setting and realistic support structure. This is a second format of the same concept, not a new creative direction.',
  bulletin: { width: 24, height: 7 },
  poster: { width: 13, height: 6 },
}
