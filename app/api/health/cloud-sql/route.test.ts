import { afterEach, expect, it, vi } from 'vitest'

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }))
vi.mock('@/db', () => ({ db: { execute } }))

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  execute.mockReset()
})

// Dynamic loading lets the test-first commit typecheck before the route exists.
const routePath = './route'

it('only probes an explicitly enabled Cloud SQL Preview, never production', async () => {
  const { GET } = await import(routePath)
  vi.stubEnv('CLOUD_SQL_INSTANCE_CONNECTION_NAME', 'project:region:instance')
  vi.stubEnv('VERCEL_ENV', 'production')
  expect((await GET()).status).toBe(404)
  vi.stubEnv('VERCEL_ENV', 'preview')
  vi.stubEnv('CLOUD_SQL_INSTANCE_CONNECTION_NAME', '')
  expect((await GET()).status).toBe(404)
  expect(execute).not.toHaveBeenCalled()

  vi.stubEnv('CLOUD_SQL_INSTANCE_CONNECTION_NAME', 'project:region:instance')
  execute.mockResolvedValue({ rows: [{ connected: 1 }] })
  const response = await GET()
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ connected: true })
  expect(response.headers.get('Cache-Control')).toBe('no-store')

  execute.mockRejectedValue(new Error('sensitive connection details'))
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const failed = await GET()
  expect(failed.status).toBe(503)
  expect(await failed.json()).toEqual({ connected: false })
})
