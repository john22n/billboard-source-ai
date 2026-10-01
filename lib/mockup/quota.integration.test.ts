import { readFile } from 'node:fs/promises'
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest'
import { sql } from 'drizzle-orm'

const schema = vi.hoisted(() => `mockup_test_${Date.now()}`)
vi.mock('@/db', async () => {
  const { Pool } = await import('pg')
  const { drizzle } = await import('drizzle-orm/node-postgres')
  const url = process.env.MOCKUP_TEST_DATABASE_URL
  if (url && !['127.0.0.1', 'localhost'].includes(new URL(url).hostname))
    throw new Error('Quota tests require disposable local PostgreSQL.')
  return {
    db: drizzle(
      new Pool({ connectionString: url, options: `-c search_path=${schema}` }),
    ),
  }
})
import { db } from '@/db'
import { reserveImage, settleImage } from './quota'

describe.skipIf(!process.env.MOCKUP_TEST_DATABASE_URL)(
  'durable image quota (real disposable PostgreSQL)',
  () => {
    beforeAll(async () => {
      await db.execute(
        sql.raw(
          `CREATE SCHEMA "${schema}"; CREATE TABLE "${schema}"."User" (id varchar(21) PRIMARY KEY);`,
        ),
      )
      await db.execute(
        sql.raw(
          await readFile(
            new URL('../../drizzle/0006_mockup_quotas.sql', import.meta.url),
            'utf8',
          ),
        ),
      )
      await db.execute(
        sql`INSERT INTO "User" (id) VALUES ('concurrent'), ('limit'), ('midnight'), ('crash')`,
      )
    })
    afterAll(async () => {
      await db.execute(sql.raw(`DROP SCHEMA "${schema}" CASCADE`))
      // Both production drivers expose a client; this mock always uses node-postgres.
      await (db.$client as import('pg').Pool).end()
    })
    it('admits exactly one of twenty competing requests and restores a failed slot', async () => {
      const now = new Date('2026-07-01T20:00:00Z')
      const results = await Promise.allSettled(
        Array.from({ length: 20 }, () => reserveImage('concurrent', now)),
      )
      const winners = results.filter((result) => result.status === 'fulfilled')
      expect(winners).toHaveLength(1)
      await settleImage('concurrent', winners[0].value.token, false)
      expect((await reserveImage('concurrent', now)).remaining).toBe(9)
    })
    it('permits ten successes, not eleven; failures do not consume the tenth slot', async () => {
      const now = new Date('2026-01-02T02:00:00Z')
      for (let index = 0; index < 9; index++)
        await settleImage(
          'limit',
          (await reserveImage('limit', now)).token,
          true,
        )
      await settleImage(
        'limit',
        (await reserveImage('limit', now)).token,
        false,
      )
      const tenth = await reserveImage('limit', now)
      expect(tenth.remaining).toBe(0)
      await settleImage('limit', tenth.token, true)
      await expect(reserveImage('limit', now)).rejects.toThrow('10-image limit')
      expect(
        (await reserveImage('limit', new Date('2026-01-02T07:00:00Z')))
          .remaining,
      ).toBe(9)
    })
    it('does not permit overlapping work at Denver midnight', async () => {
      const pending = await reserveImage(
        'midnight',
        new Date('2026-07-02T05:59:59Z'),
      )
      await expect(
        reserveImage('midnight', new Date('2026-07-02T06:00:00Z')),
      ).rejects.toThrow('Another mockup')
      await settleImage('midnight', pending.token, true)
      expect(
        (await reserveImage('midnight', new Date('2026-07-02T06:00:01Z')))
          .remaining,
      ).toBe(9)
    })
    it('recovers a crashed function without letting its stale completion release new work', async () => {
      const old = await reserveImage('crash', new Date('2026-07-01T20:00:00Z'))
      const current = await reserveImage(
        'crash',
        new Date('2026-07-01T20:05:01Z'),
      )
      await expect(settleImage('crash', old.token, true)).rejects.toThrow(
        'expired',
      )
      await expect(
        reserveImage('crash', new Date('2026-07-01T20:05:02Z')),
      ).rejects.toThrow('Another mockup')
      await settleImage('crash', current.token, false)
    })
  },
)
