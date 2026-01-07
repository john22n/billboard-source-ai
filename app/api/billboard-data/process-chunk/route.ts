// app/api/billboard-data/process-chunk/route.ts
// UPDATED VERSION - 512 dimensions using OpenAI SDK directly

import { NextRequest, NextResponse } from 'next/server';
import { parse } from 'csv-parse/sync';
import OpenAI from 'openai';
import { db } from '@/db';
import { billboardLocations } from '@/db/schema';
import { getSession } from '@/lib/auth';
import { getCurrentUser } from '@/lib/dal';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

// ⭐ Use OpenAI SDK directly for 512-dimension embeddings
const openaiClient = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

interface CSVRow {
  City: string;
  State: string;
  County: string;
  'Avg Daily Views': string;
  '4-Wk Range': string;
  Market: string;
  'Market Range': string;
  'General Range': string;
  Details: string;
  'Avg Bull Price/Mo': string;
  'Avg Stat Bull Views/Wk': string;
  'Avg Poster Price/Mo': string;
  'Avg Poster Views/Wk': string;
  'Avg Digital Price/Mo': string;
  'Avg Digital Views/Wk': string;
  'Avg Views/Period': string;
}

// ⭐ FIXED: Filter function now includes General Range check
function hasUsefulData(record: CSVRow): boolean {
  // Keep if it has ANY of these:
  const hasViews = record['Avg Daily Views'] && record['Avg Daily Views'].trim() !== '';
  const hasFourWeekRange = record['4-Wk Range'] && record['4-Wk Range'].trim() !== '';
  const hasMarket = record.Market && record.Market.trim() !== '';
  const hasDetails = record.Details && record.Details.trim() !== '';
  const hasGeneralRange = record['General Range'] && record['General Range'].trim() !== ''; // ⭐ NEW
  const hasMarketRange = record['Market Range'] && record['Market Range'].trim() !== ''; // ⭐ NEW
  const hasPricing = 
    parseInt(record['Avg Bull Price/Mo'] || '0') > 0 ||
    parseInt(record['Avg Poster Price/Mo'] || '0') > 0 ||
    parseInt(record['Avg Digital Price/Mo'] || '0') > 0;
  
  return hasViews || hasFourWeekRange || hasMarket || hasDetails || hasGeneralRange || hasMarketRange || hasPricing;
}

function createEmbeddingText(record: CSVRow): string {
  const parts = [
    `City: ${record.City}`,
    `State: ${record.State}`,
    `County: ${record.County}`,
  ];

  if (record.Market && record.Market.trim() !== '') {
    parts.push(`Market: ${record.Market}`);
  }

  if (record['Avg Daily Views'] && record['Avg Daily Views'].trim() !== '') {
    parts.push(`Average Daily Views: ${record['Avg Daily Views']}`);
  }

  if (record['4-Wk Range'] && record['4-Wk Range'].trim() !== '') {
    parts.push(`4-Week Price Range: ${record['4-Wk Range']}`);
  }

  if (record['Market Range'] && record['Market Range'].trim() !== '') {
    parts.push(`Market Range: ${record['Market Range']}`);
  }

  if (record['General Range'] && record['General Range'].trim() !== '') {
    parts.push(`General Pricing: ${record['General Range']}`);
  }

  const bullPrice = parseInt(record['Avg Bull Price/Mo'] || '0');
  if (bullPrice > 0) {
    parts.push(`Static bulletin pricing: $${bullPrice}/month`);
  }

  const posterPrice = parseInt(record['Avg Poster Price/Mo'] || '0');
  if (posterPrice > 0) {
    parts.push(`Poster pricing: $${posterPrice}/month`);
  }

  const digitalPrice = parseInt(record['Avg Digital Price/Mo'] || '0');
  if (digitalPrice > 0) {
    parts.push(`Digital billboard pricing: $${digitalPrice}/month`);
  }

  if (record.Details && record.Details.trim() !== '') {
    parts.push(`Details: ${record.Details}`);
  }

  return parts.join('. ');
}

// ⭐ Helper function to generate embeddings in batches using OpenAI SDK
async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const response = await openaiClient.embeddings.create({
    model: 'text-embedding-3-small',
    input: texts,
    dimensions: 512,
  });
  
  // Sort by index to ensure order matches input
  return response.data
    .sort((a, b) => a.index - b.index)
    .map(item => item.embedding);
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

    // ⭐ FILTER OUT EMPTY ROWS (now properly checks General Range)
    const filteredChunk = chunk.filter(hasUsefulData);
    const skipped = chunk.length - filteredChunk.length;
    
    console.log(`📊 Chunk ${chunkIndex + 1}: ${chunk.length} rows → ${filteredChunk.length} useful (skipped ${skipped} empty rows)`);

    if (filteredChunk.length === 0) {
      console.log(`⏭️ Chunk ${chunkIndex + 1} has no useful data, skipping...`);
      return NextResponse.json({
        success: true,
        chunkIndex,
        recordsProcessed: 0,
        recordsSkipped: skipped,
      });
    }

    const processedData = [];
    const EMBEDDING_BATCH_SIZE = 100;

    for (let i = 0; i < filteredChunk.length; i += EMBEDDING_BATCH_SIZE) {
      const batch = filteredChunk.slice(i, i + EMBEDDING_BATCH_SIZE);
      const textsToEmbed = batch.map(r => createEmbeddingText(r));

      console.log(`🤖 Generating ${textsToEmbed.length} embeddings (512 dimensions)...`);
      
      // ⭐ Use our helper function for 512-dimension embeddings
      const embeddings = await generateEmbeddings(textsToEmbed);

      const dataWithEmbeddings = batch.map((record, idx) => ({
        city: record.City || '',
        state: record.State || '',
        county: record.County || '',
        
        avgDailyViews: record['Avg Daily Views'] || null,
        fourWeekRange: record['4-Wk Range'] || null,
        market: record.Market || null,
        marketRange: record['Market Range'] || null,
        generalRange: record['General Range'] || null,
        details: record.Details || null,
        
        avgBullPricePerMonth: parseInt(record['Avg Bull Price/Mo'] || '0'),
        avgStatBullViewsPerWeek: parseInt(record['Avg Stat Bull Views/Wk'] || '0'),
        avgPosterPricePerMonth: parseInt(record['Avg Poster Price/Mo'] || '0'),
        avgPosterViewsPerWeek: parseInt(record['Avg Poster Views/Wk'] || '0'),
        avgDigitalPricePerMonth: parseInt(record['Avg Digital Price/Mo'] || '0'),
        avgDigitalViewsPerWeek: parseInt(record['Avg Digital Views/Wk'] || '0'),
        avgViewsPerPeriod: record['Avg Views/Period'] || null,
        
        embedding: embeddings[idx],
      }));

      processedData.push(...dataWithEmbeddings);
    }

    // Insert in smaller batches
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
      recordsSkipped: skipped,
    });
  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json(
      { error: 'Failed to process chunk', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}