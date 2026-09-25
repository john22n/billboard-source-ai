import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'

vi.mock('@/stores/mockupStore', () => ({
  useMockupStore: () => ({
    state: {
      intake: { advertiser: 'Alpine' },
      summary: {
        headline: 'Explore the mountains',
        supporting: 'Trips from Denver',
        contact: 'alpine.example',
        direction: 'Long internal creative direction',
        caution: '',
      },
    },
  }),
}))

import { ApprovalSummary } from './ApprovalSummary'

it('keeps a brief copy summary and generation without the detailed overview', () => {
  const html = renderToStaticMarkup(
    <ApprovalSummary busy={false} onGenerate={() => {}} />,
  )
  expect(html).toContain('Explore the mountains')
  expect(html).toContain('Trips from Denver')
  expect(html).toContain('alpine.example')
  expect(html).toContain('Generate mockup')
  expect(html).not.toContain('Long internal creative direction')
  expect(html).not.toContain('textarea')
})
