// app/api/billboard-data/process-chunk/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { parse } from 'csv-parse/sync';
import { embedMany } from 'ai';
import { openai } from '@ai-sdk/openai';
import { db } from '@/db';
import { billboardLocations } from '@/db/schema';
import { getSession } from '@/lib/auth';
import { getCurrentUser } from '@/lib/dal';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const embeddingModel = openai.embedding('text-embedding-3-small');

interface CSVRow {
  CITY: string;
  STATE: string;
  COUNTY: string;
  'MARKET INTELLIGENCE (GENERAL PLANNING RATES, STREET SPECIFIC RATES, & MISC INFO)': string;
  'ARE THERE STATIC BULLETIN BILLBOARDS IN THIS CITY?': string;
  'ARE THERE STATIC POSTER BILLBOARDS IN THIS CITY?': string;
  'ARE THERE DIGITAL BILLBOARDS IN THIS CITY?': string;
  'PERCENTAGE OF INVENTORY IN THIS CITY OWNED BY LAMAR': string;
  'PERCENTAGE OF INVENTORY IN THIS CITY OWNED BY OUITFRONT': string;
  'PERCENTAGE OF INVENTORY IN THIS CITY OWNED BY CLEAR CHANNEL': string;
  'PERCENTAGE OF INVENTORY IN THIS CITY OWNED BY A VENDOR COMPANY THAT IS NOT LAMAR, OUTFRONT, OR CLEAR CHANNEL': string;
  'AVERAGE 4-WEEK PRICE OF A STATIC BULLETIN AT A 12-WEEK (3 PERIOD) CAMPAIGN': string;
  'AVERAGE 4-WEEK PRICE OF A STATIC BULLETIN AT A 24-WEEK (6 PERIOD) CAMPAIGN': string;
  'AVERAGE 4-WEEK PRICE OF A STATIC BULLETIN AT A 52-WEEK ANNUAL (13 PERIOD) CAMPAIGN': string;
  'AVERAGE WEEKLY IMPRESSIONS (VIEWS) OF A STATIC BULLETIN': string;
  'AVERAGE 4-WEEK PRICE OF A STATIC POSTER AT A 12-WEEK (3 PERIOD) CAMPAIGN': string;
  'AVERAGE 4-WEEK PRICE OF A STATIC POSTER AT A 24-WEEK (6 PERIOD) CAMPAIGN': string;
  'AVERAGE 4-WEEK PRICE OF A STATIC POSTER AT A 52-WEEK ANNUAL (13 PERIOD) CAMPAIGN': string;
  'AVERAGE WEEKLY IMPRESSIONS (VIEWS) OF A STATIC POSTER': string;
  'AVERAGE 4-WEEK PRICE OF A DIGITAL BILLBOARD AT A 12-WEEK (3 PERIOD) CAMPAIGN': string;
  'AVERAGE 4-WEEK PRICE OF A DIGITAL BILLBOARD AT A 24-WEEK (6 PERIOD) CAMPAIGN': string;
  'AVERAGE 4-WEEK PRICE OF A DIGITAL BILLBOARD AT A 52-WEEK ANNUAL (13 PERIOD) CAMPAIGN': string;
  'AVERAGE WEEKLY IMPRESSIONS (VIEWS) OF A DIGITAL BILLBOARD': string;
}

function createEmbeddingText(record: CSVRow): string {
  const parts = [
    `City: ${record.CITY}`,
    `State: ${record.STATE}`,
    `County: ${record.COUNTY}`,
  ];

  const available = [];
  if (record['ARE THERE STATIC BULLETIN BILLBOARDS IN THIS CITY?']?.toUpperCase() === 'Y') {
    available.push('static bulletin billboards');
  }
  if (record['ARE THERE STATIC POSTER BILLBOARDS IN THIS CITY?']?.toUpperCase() === 'Y') {
    available.push('static poster billboards');
  }
  if (record['ARE THERE DIGITAL BILLBOARDS IN THIS CITY?']?.toUpperCase() === 'Y') {
    available.push('digital billboards');
  }

  if (available.length > 0) {
    parts.push(`Available: ${available.join(', ')}`);
  }

  const marketInfo = record['MARKET INTELLIGENCE (GENERAL PLANNING RATES, STREET SPECIFIC RATES, & MISC INFO)'];
  if (marketInfo && marketInfo.trim() !== '') {
    parts.push(`Market Info: ${marketInfo}`);
  }

  const staticBulletin12 = parseInt(record['AVERAGE 4-WEEK PRICE OF A STATIC BULLETIN AT A 12-WEEK (3 PERIOD) CAMPAIGN'] || '0');
  if (staticBulletin12 > 0) {
    parts.push(`Static bulletin pricing starts at $${staticBulletin12} for 12-week campaign`);
  }

  const digital12 = parseInt(record['AVERAGE 4-WEEK PRICE OF A DIGITAL BILLBOARD AT A 12-WEEK (3 PERIOD) CAMPAIGN'] || '0');
  if (digital12 > 0) {
    parts.push(`Digital billboard pricing starts at $${digital12} for 12-week campaign`);
  }

  return parts.join('. ');
}

export async function POST(req: NextRequest) {
  try {
    // Verify user is authenticated and has admin role
    const session = await getSession();
    if (!session?.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const currentUser = await getCurrentUser();
    if (!currentUser || currentUser.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const { blobUrl, chunkIndex, chunkSize } = await req.json();

    console.log(`📥 Processing chunk ${chunkIndex + 1}...`);

    const response = await fetch(blobUrl);
    if (!response.ok) throw new Error('Failed to fetch CSV');
    
    const csvContent = await response.text();
    const allRecords: CSVRow[] = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });

    const startIndex = chunkIndex * chunkSize;
    const endIndex = Math.min(startIndex + chunkSize, allRecords.length);
    const chunk = allRecords.slice(startIndex, endIndex);

    console.log(`Processing ${startIndex + 1} to ${endIndex} (${chunk.length} records)`);

    const processedData = [];
    const EMBEDDING_BATCH_SIZE = 100;

    for (let i = 0; i < chunk.length; i += EMBEDDING_BATCH_SIZE) {
      const batch = chunk.slice(i, i + EMBEDDING_BATCH_SIZE);
      const textsToEmbed = batch.map(r => createEmbeddingText(r));

      console.log(`🤖 Generating ${textsToEmbed.length} embeddings...`);
      const { embeddings } = await embedMany({
        model: embeddingModel,
        values: textsToEmbed,
      });

      const dataWithEmbeddings = batch.map((record, idx) => ({
        city: record.CITY || '',
        state: record.STATE || '',
        county: record.COUNTY || '',
        marketIntelligence: record['MARKET INTELLIGENCE (GENERAL PLANNING RATES, STREET SPECIFIC RATES, & MISC INFO)'] || '',
        hasStaticBulletin: record['ARE THERE STATIC BULLETIN BILLBOARDS IN THIS CITY?']?.toUpperCase() === 'Y',
        hasStaticPoster: record['ARE THERE STATIC POSTER BILLBOARDS IN THIS CITY?']?.toUpperCase() === 'Y',
        hasDigital: record['ARE THERE DIGITAL BILLBOARDS IN THIS CITY?']?.toUpperCase() === 'Y',
        lamarPercentage: parseInt(record['PERCENTAGE OF INVENTORY IN THIS CITY OWNED BY LAMAR'] || '0'),
        outfrontPercentage: parseInt(record['PERCENTAGE OF INVENTORY IN THIS CITY OWNED BY OUITFRONT'] || '0'),
        clearChannelPercentage: parseInt(record['PERCENTAGE OF INVENTORY IN THIS CITY OWNED BY CLEAR CHANNEL'] || '0'),
        otherVendorPercentage: parseInt(record['PERCENTAGE OF INVENTORY IN THIS CITY OWNED BY A VENDOR COMPANY THAT IS NOT LAMAR, OUTFRONT, OR CLEAR CHANNEL'] || '0'),
        staticBulletin12Week: parseInt(record['AVERAGE 4-WEEK PRICE OF A STATIC BULLETIN AT A 12-WEEK (3 PERIOD) CAMPAIGN'] || '0'),
        staticBulletin24Week: parseInt(record['AVERAGE 4-WEEK PRICE OF A STATIC BULLETIN AT A 24-WEEK (6 PERIOD) CAMPAIGN'] || '0'),
        staticBulletin52Week: parseInt(record['AVERAGE 4-WEEK PRICE OF A STATIC BULLETIN AT A 52-WEEK ANNUAL (13 PERIOD) CAMPAIGN'] || '0'),
        staticBulletinImpressions: parseInt(record['AVERAGE WEEKLY IMPRESSIONS (VIEWS) OF A STATIC BULLETIN'] || '0'),
        staticPoster12Week: parseInt(record['AVERAGE 4-WEEK PRICE OF A STATIC POSTER AT A 12-WEEK (3 PERIOD) CAMPAIGN'] || '0'),
        staticPoster24Week: parseInt(record['AVERAGE 4-WEEK PRICE OF A STATIC POSTER AT A 24-WEEK (6 PERIOD) CAMPAIGN'] || '0'),
        staticPoster52Week: parseInt(record['AVERAGE 4-WEEK PRICE OF A STATIC POSTER AT A 52-WEEK ANNUAL (13 PERIOD) CAMPAIGN'] || '0'),
        staticPosterImpressions: parseInt(record['AVERAGE WEEKLY IMPRESSIONS (VIEWS) OF A STATIC POSTER'] || '0'),
        digital12Week: parseInt(record['AVERAGE 4-WEEK PRICE OF A DIGITAL BILLBOARD AT A 12-WEEK (3 PERIOD) CAMPAIGN'] || '0'),
        digital24Week: parseInt(record['AVERAGE 4-WEEK PRICE OF A DIGITAL BILLBOARD AT A 24-WEEK (6 PERIOD) CAMPAIGN'] || '0'),
        digital52Week: parseInt(record['AVERAGE 4-WEEK PRICE OF A DIGITAL BILLBOARD AT A 52-WEEK ANNUAL (13 PERIOD) CAMPAIGN'] || '0'),
        digitalImpressions: parseInt(record['AVERAGE WEEKLY IMPRESSIONS (VIEWS) OF A DIGITAL BILLBOARD'] || '0'),
        embedding: embeddings[idx],
      }));

      processedData.push(...dataWithEmbeddings);
    }

    // ⭐ FIX: Insert in smaller batches to avoid parameter limit
    console.log(`💾 Inserting ${processedData.length} records in batches...`);
    const INSERT_BATCH_SIZE = 100;
    
    for (let k = 0; k < processedData.length; k += INSERT_BATCH_SIZE) {
      const insertBatch = processedData.slice(k, k + INSERT_BATCH_SIZE);
      await db.insert(billboardLocations).values(insertBatch);
      console.log(`  ✓ Inserted ${k + insertBatch.length}/${processedData.length}`);
    }

    console.log(`✅ Chunk ${chunkIndex + 1} complete`);

    return NextResponse.json({
      success: true,
      chunkIndex,
      recordsProcessed: processedData.length,
    });
  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json(
      { error: 'Failed to process chunk', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}