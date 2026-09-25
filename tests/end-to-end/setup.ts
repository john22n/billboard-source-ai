import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Pool } from 'pg'
import { databaseUrl, userId } from './environment'

export default async function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'billboard-playwright-'))
  let started = false
  const cleanup = () => {
    try {
      if (started)
        execFileSync('pg_ctl', ['-D', directory, '-m', 'fast', '-w', 'stop'], {
          stdio: 'pipe',
        })
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  }
  try {
    execFileSync(
      'initdb',
      ['-D', directory, '-U', 'postgres', '-A', 'trust', '--no-locale'],
      { stdio: 'pipe' },
    )
    execFileSync(
      'pg_ctl',
      [
        '-D',
        directory,
        '-l',
        join(directory, 'server.log'),
        '-o',
        `-h 127.0.0.1 -p 54329 -k ${directory}`,
        '-w',
        'start',
      ],
      { stdio: 'pipe' },
    )
    started = true
    const pool = new Pool({ connectionString: databaseUrl })
    try {
      // Local auth and admin reads; external AI/service APIs are mocked.
      await pool.query(`CREATE TABLE "User" (
        id varchar(21) PRIMARY KEY, email varchar(64) NOT NULL, role varchar(20),
        twilio_phone_number varchar(20), taskrouter_worker_sid varchar(34),
        password varchar(64), cell_phone_number varchar(16),
        worker_activity varchar(20) DEFAULT 'offline',
        calls_accepted integer DEFAULT 0, calls_rejected integer DEFAULT 0,
        calls_missed integer DEFAULT 0, last_attempt_sid varchar(48), last_reject_at timestamp
      )`)
      await pool.query(`CREATE TABLE openai_logs (
        user_id text, cost numeric(10,6), created_at timestamp
      )`)
      await pool.query(
        'INSERT INTO "User" (id, email, role) VALUES ($1, $2, $3)',
        [userId, 'creative-studio@example.test', 'user'],
      )
      await pool.query(
        'INSERT INTO "User" (id, email, role) VALUES ($1, $2, $3)',
        ['e2e-studio-admin', 'studio-admin@example.test', 'admin'],
      )
      await pool.query(`CREATE TABLE art_wizard_settings (
        id integer PRIMARY KEY DEFAULT 1,
        image_generation_prompt text NOT NULL
      )`)
    } finally {
      await pool.end()
    }
    // Playwright stops its web server before exiting. Stop Postgres afterward,
    // so the application's idle pool does not receive a forced disconnect.
    process.once('exit', cleanup)
  } catch (error) {
    cleanup()
    throw error
  }
}
