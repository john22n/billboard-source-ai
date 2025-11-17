// app/api/admin/billboard-data/upload/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { parse } from 'csv-parse/sync';
import OpenAI from 'openai';
import { db } from '@/db';
import { billboardLocations } from '@/db/schema';
import { sql } from 'drizzle-orm';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

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

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Create rich text representation for embedding
 */
function createEmbeddingText(record: CSVRow): string {
  const parts = [
    `City: ${record.CITY}`,
    `State: ${record.STATE}`,
    `County: ${record.COUNTY}`,
  ];

  // Add billboard availability
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

  // Add market intelligence
  const marketInfo = record['MARKET INTELLIGENCE (GENERAL PLANNING RATES, STREET SPECIFIC RATES, & MISC INFO)'];
  if (marketInfo && marketInfo.trim() !== '') {
    parts.push(`Market Info: ${marketInfo}`);
  }

  // Add pricing information if available
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

/**
 * Process billboard CSV and generate embeddings
 */
async function processBillboardCSV(csvContent: string) {
  console.log('Parsing CSV...');
  
  const records: CSVRow[] = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  console.log(`Found ${records.length} locations`);
  
  const processedData = [];
  const batchSize = 100; // Process in batches to avoid rate limits
  
  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    console.log(`Processing batch ${i / batchSize + 1} (${batch.length} records)...`);
    
    const batchPromises = batch.map(async (record) => {
      try {
        // Create a rich text representation for embedding
        const textToEmbed = createEmbeddingText(record);
        
        // Generate embedding
        const embeddingResponse = await openai.embeddings.create({
          model: 'text-embedding-3-small',
          input: textToEmbed,
        });

        return {
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
          
          embedding: embeddingResponse.data[0].embedding,
        };
      } catch (error) {
        console.error(`Error processing ${record.CITY}, ${record.STATE}:`, error);
        return null;
      }
    });

    const batchResults = await Promise.all(batchPromises);
    processedData.push(...batchResults.filter(item => item !== null));
    
    // Rate limit protection: wait 1 second between batches
    if (i + batchSize < records.length) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  console.log(`Successfully processed ${processedData.length} locations`);
  return processedData;
}

// ============================================================================
// API ROUTE HANDLERS
// ============================================================================

/**
 * POST - Upload and process billboard CSV data
 */
export async function POST(req: NextRequest) {
  try {
    // TODO: Add authentication check here
    // For now, anyone can upload (add auth later)

    const formData = await req.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      );
    }

    if (!file.name || !file.name.endsWith('.csv')) {
      return NextResponse.json(
        { error: 'File must be a CSV' },
        { status: 400 }
      );
    }

    console.log(`Processing CSV file: ${file.name}, size: ${file.size} bytes`);

    const csvContent = await file.text();

    if (!csvContent || csvContent.trim().length === 0) {
      return NextResponse.json(
        { error: 'CSV file is empty' },
        { status: 400 }
      );
    }

    // Clear existing data before uploading new data
    console.log('Clearing existing billboard data...');
    await db.execute(sql`TRUNCATE TABLE billboard_locations RESTART IDENTITY CASCADE`);
    console.log('Existing data cleared.');

    // Process CSV and generate embeddings
    const vectors = await processBillboardCSV(csvContent);

    if (vectors.length === 0) {
      return NextResponse.json(
        { error: 'No valid records found in CSV' },
        { status: 400 }
      );
    }

    console.log(`Inserting ${vectors.length} records into database...`);

    // Insert in batches to avoid overwhelming the database
    const batchSize = 500;
    let inserted = 0;

    for (let i = 0; i < vectors.length; i += batchSize) {
      const batch = vectors.slice(i, i + batchSize);
      await db.insert(billboardLocations).values(batch);
      inserted += batch.length;
      console.log(`Inserted ${inserted}/${vectors.length} records`);
    }

    return NextResponse.json({
      success: true,
      message: `Successfully processed and stored ${vectors.length} billboard locations`,
      count: vectors.length,
    });
  } catch (error) {
    console.error('Billboard CSV upload error:', error);
    return NextResponse.json(
      { 
        error: 'Failed to process CSV',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

/**
 * GET - Check billboard data status
 */
export async function GET() {
  try {
    // TODO: Add authentication check here

    // Count total locations in database
    const result = await db.execute(sql`
      SELECT COUNT(*) as count FROM billboard_locations
    `);

    const count = Number(result.rows[0]?.count) || 0;

    return NextResponse.json({
      totalLocations: count,
      status: count > 0 ? 'ready' : 'no data',
    });
  } catch (error) {
    console.error('Error checking billboard data status:', error);
    return NextResponse.json(
      { error: 'Failed to check status' },
      { status: 500 }
    );
  }
}