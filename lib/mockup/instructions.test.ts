import { expect, it } from 'vitest'
import { billboardImagePrompt, toolInstructions } from './instructions'

it('carries the target location into the brief and requests its skyline behind the billboard', () => {
  expect(toolInstructions).toContain(
    'Include the target city or location from intake in the creative brief',
  )
  const prompt = billboardImagePrompt(
    'Alpine Dental in Denver. Headline "Smile Bigger".',
    {
      revision: false,
      logo: false,
      labels: [],
    },
  )
  expect(prompt).toContain('the target location’s skyline in the background')
  expect(prompt).toContain('Alpine Dental in Denver')
  expect(prompt).toContain(
    'If no location was provided, keep the clean blue sky without inventing a city',
  )
})

it('preserves uploaded background overrides and does not restage unrelated revisions', () => {
  expect(
    billboardImagePrompt('Denver', {
      revision: false,
      logo: false,
      labels: ['mountains.jpg'],
    }),
  ).toContain('User-supplied backgrounds override the default sky/scene')
  const revision = billboardImagePrompt('Make text larger', {
    revision: true,
    logo: false,
    labels: [],
  })
  expect(revision).toContain(
    'Preserve its copy, layout, brand identity, background',
  )
  expect(revision).not.toContain('skyline')
})
