// app/api/billboard-data/start/route.ts
// UPDATED: No longer truncates - uses UPSERT mode for updates

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/db'
import { sql } from 'drizzle-orm'
import { parse } from 'csv-parse/sync'
import { getSession } from '@/lib/auth'
import { fetchVercelBlob } from '@/lib/vercel-blob'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  try {
    // Verify user is authenticated and has admin role
    const session = await getSession()
    if (!session?.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (session.role !== 'admin') {
      return NextResponse.json(
        { error: 'Forbidden: Admin access required' },
        { status: 403 },
      )
    }

    const { blobUrl } = await req.json()

    if (typeof blobUrl !== 'string') {
      return NextResponse.json({ error: 'Invalid blob URL' }, { status: 400 })
    }

    console.log('📥 Fetching CSV to count records...')

    const response = await fetchVercelBlob(blobUrl)
    if (!response.ok) {
      throw new Error(`Failed to fetch CSV: ${response.statusText}`)
    }

    const csvContent = await response.text()

    // Quick parse to count
    const records = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    })

    const totalRecords = records.length
    const chunkSize = 5000
    const totalChunks = Math.ceil(totalRecords / chunkSize)

    console.log(`📊 Total: ${totalRecords} records, ${totalChunks} chunks`)

    // ⭐ REMOVED: No longer truncating - using UPSERT mode instead
    // This means:
    // - Existing locations (same city+state) will be UPDATED
    // - New locations will be INSERTED
    console.log(
      '📝 UPSERT mode: existing locations will be updated, new locations will be added',
    )

    // Get current count for logging
    const currentCount = await db.execute(
      sql`SELECT COUNT(*) as count FROM billboard_locations`,
    )
    const existingRecords = Number(currentCount.rows[0]?.count || 0)
    console.log(`📊 Current database has ${existingRecords} locations`)

    return NextResponse.json({
      success: true,
      blobUrl,
      totalRecords,
      chunkSize,
      totalChunks,
      existingRecords,
      mode: 'upsert', // ⭐ Indicate we're in upsert mode
    })
  } catch (error) {
    console.error('Error:', error)
    return NextResponse.json(
      {
        error: 'Failed to start',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    )
  }
}
