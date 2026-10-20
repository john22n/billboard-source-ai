import { expect, it } from 'vitest'
import {
  billboardImagePrompt,
  defaultImagePrompts,
  flatArtworkPrompt,
  toolInstructions,
} from './instructions'

it('keeps campaign location without requiring outdoor staging in any default prompt', () => {
  const prompt = billboardImagePrompt(
    'Alpine Dental in Denver. Headline "Smile Bigger".',
    {
      revision: false,
      logo: false,
      labels: [],
    },
  )
  expect(prompt).toContain('Alpine Dental in Denver')
  for (const frame of [
    ...Object.values(defaultImagePrompts),
    toolInstructions,
  ]) {
    expect(frame).not.toContain('clean blue sky')
    expect(frame).not.toContain('realistic structure')
    expect(frame).not.toContain('not flat artwork')
  }
  expect(toolInstructions).toContain('Mandatory application output contract')
})

it('preserves uploaded background overrides and does not restage unrelated revisions', () => {
  expect(
    billboardImagePrompt('Denver', {
      revision: false,
      logo: false,
      labels: ['mountains.jpg'],
    }),
  ).toContain('Use supplied imagery inside the advertisement')
  const revision = billboardImagePrompt('Make text larger', {
    revision: true,
    logo: false,
    labels: [],
  })
  expect(revision).toContain(
    'Preserve its copy, layout, brand identity, advertisement background',
  )
  expect(revision).not.toContain('skyline')
})

it.each(['bulletin', 'poster'] as const)(
  'keeps saved %s preferences verbatim but overrides conflicting staging at runtime',
  (format) => {
    const saved =
      'Use our purple logo, exact copy "Visit Alpine", and mountains. Show a realistic outdoor structure against a clean blue sky; not flat artwork.'
    const prompt = flatArtworkPrompt(saved, format)
    expect(prompt).toContain(saved)
    expect(
      prompt.indexOf('Mandatory application output contract'),
    ).toBeGreaterThan(prompt.indexOf(saved))
    expect(prompt).toContain(
      'override conflicting staging or output instructions in saved admin prompts',
    )
    expect(prompt).toContain(
      'Background imagery that belongs to the advertisement',
    )
    expect(prompt).toContain(
      format === 'bulletin' ? 'crop it to 2304×672' : 'directly at 2496×1152',
    )
  },
)
