import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  update: vi.fn(),
  revalidate: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ getSession: mocks.session }))
vi.mock('@/lib/dal', () => ({ updateUserCellPhone: mocks.update }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }))
vi.mock('@/lib/cell-phone', () => import('../lib/cell-phone'))
import { updateCellPhone } from './user-actions'

describe('admin cell phone action', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.session.mockResolvedValue({ userId: 'admin', role: 'admin' })
    mocks.update.mockResolvedValue({ id: 'rep' })
  })

  it.each([null, { userId: 'rep', role: 'user' }])(
    'denies unauthorized writes',
    async (session) => {
      mocks.session.mockResolvedValue(session)
      expect((await updateCellPhone('rep', '3035550123')).success).toBe(false)
      expect(mocks.update).not.toHaveBeenCalled()
    },
  )

  it('rejects invalid input on the server without writing', async () => {
    expect((await updateCellPhone('rep', '123')).success).toBe(false)
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })

  it.each([
    ['(303) 555-0123', '+13035550123'],
    ['', null],
  ])('persists normalized input or clears it', async (input, phone) => {
    expect(await updateCellPhone('rep', input!)).toEqual({
      success: true,
      phone,
    })
    expect(mocks.update).toHaveBeenCalledWith('rep', phone)
    expect(mocks.revalidate).toHaveBeenCalledWith('/admin')
  })

  it('reports missing users and database failures without claiming success', async () => {
    mocks.update
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error('offline'))
    expect((await updateCellPhone('rep', '3035550123')).success).toBe(false)
    expect((await updateCellPhone('rep', '3035550123')).success).toBe(false)
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })
})
