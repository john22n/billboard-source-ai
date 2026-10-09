import { expect, it } from 'vitest'
import { billboardImagePrompt, toolInstructions } from './instructions'

it('keeps the target location as campaign context without changing the fixed presentation', () => {
  expect(toolInstructions).toContain('Target location is campaign context only')
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
