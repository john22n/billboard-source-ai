import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { artWizardSettings } from '@/db/schema'

const defaultPrompt =
  'Create ONE finished professional realistic wide horizontal OUTDOOR BILLBOARD CONCEPT MOCKUP. Show finished artwork on a realistic billboard structure against a clean blue sky. Billboard face dominates, with approximately 3:1 proportions. No distracting scenery, unrelated signs, or flat-art export. Static billboard unless digital is explicitly requested. One main idea, large bold legible lettering, strong contrast, prominent advertiser identity, instant comprehension. No placeholder text, misspellings, paragraphs, clutter, or invented logos. No QR unless requested. No tiny copy except legally required disclaimers. Choose layout and visual styling internally. Render exact approved copy, do not invent extra copy.'

export async function getImageGenerationPrompt(): Promise<string> {
  const [settings] = await db
    .select({ prompt: artWizardSettings.imageGenerationPrompt })
    .from(artWizardSettings)
    .where(eq(artWizardSettings.id, 1))
    .limit(1)
  return settings?.prompt ?? defaultPrompt
}

export async function saveImageGenerationPrompt(prompt: string) {
  await db
    .insert(artWizardSettings)
    .values({ id: 1, imageGenerationPrompt: prompt })
    .onConflictDoUpdate({
      target: artWizardSettings.id,
      set: { imageGenerationPrompt: prompt },
    })
}
