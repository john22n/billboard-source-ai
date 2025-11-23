import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { sql } from 'drizzle-orm';
import { parse } from 'csv-parse/sync';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const { blobUrl } = await req.json();

    if (!blobUrl) {
      return NextResponse.json({ error: 'No blob URL provided' }, { status: 400 });
    }

    console.log('📥 Fetching CSV to count records...');
    
    const response = await fetch(blobUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch CSV: ${response.statusText}`);
    }
    
    const csvContent = await response.text();
    
    // Quick parse to count
    const records = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });

    const totalRecords = records.length;
    const chunkSize = 5000;
    const totalChunks = Math.ceil(totalRecords / chunkSize);

    console.log(`📊 Total: ${totalRecords} records, ${totalChunks} chunks`);

    // Clear existing data
    console.log('🗑️ Clearing existing data...');
    await db.execute(sql`TRUNCATE TABLE billboard_locations RESTART IDENTITY CASCADE`);
    console.log('✅ Data cleared');

    return NextResponse.json({
      success: true,
      blobUrl,
      totalRecords,
      chunkSize,
      totalChunks,
    });
  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json(
      { 
        error: 'Failed to start', 
        details: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    );
  }
}