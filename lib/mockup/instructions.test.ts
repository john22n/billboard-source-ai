import { expect, it } from 'vitest'
import { billboardImagePrompt, toolInstructions } from './instructions'

it('carries the target city into one shared backdrop for both formats', () => {
  expect(toolInstructions).toContain(
    'Include the target city or location from intake in the creative brief',
  )
  expect(toolInstructions).toContain(
    'reuses the exact same city/sky pixels for BOTH bulletin and poster',
  )
  const prompt = billboardImagePrompt(
    'Alpine Dental in Denver. Headline "Smile Bigger".',
    {
      revision: false,
      logo: false,
      labels: [],
    },
  )
  expect(prompt).toContain('consistent sky and single-pole presentation')
  expect(prompt).toContain('Alpine Dental in Denver')
  expect(prompt).not.toContain('target location’s skyline')
})

it('uses uploaded backgrounds inside the advertisement, not as presentation overrides', () => {
  expect(
    billboardImagePrompt('Denver', {
      revision: false,
      logo: false,
      labels: ['mountains.jpg'],
    }),
  ).toContain(
    'Uploaded backgrounds never replace the fixed presentation sky or structure',
  )
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
