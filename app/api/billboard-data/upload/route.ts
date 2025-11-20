// app/api/admin/billboard-data/upload/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { parse } from 'csv-parse/sync';
import { embedMany } from 'ai';
import { openai } from '@ai-sdk/openai';
import { db } from '@/db';
import { billboardLocations } from '@/db/schema';
import { sql } from 'drizzle-orm';

// AI SDK embedding model
const embeddingModel = openai.embedding('text-embedding-3-small');

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

interface ProcessedRecord {
  city: string;
  state: string;
  county: string;
  marketIntelligence: string;
  hasStaticBulletin: boolean;
  hasStaticPoster: boolean;
  hasDigital: boolean;
  lamarPercentage: number;
  outfrontPercentage: number;
  clearChannelPercentage: number;
  otherVendorPercentage: number;
  staticBulletin12Week: number;
  staticBulletin24Week: number;
  staticBulletin52Week: number;
  staticBulletinImpressions: number;
  staticPoster12Week: number;
  staticPoster24Week: number;
  staticPoster52Week: number;
  staticPosterImpressions: number;
  digital12Week: number;
  digital24Week: number;
  digital52Week: number;
  digitalImpressions: number;
  textToEmbed: string;
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
 * Parse CSV and prepare records (without embeddings yet)
 */
function parseAndPrepareRecords(csvContent: string): ProcessedRecord[] {
  console.log('📝 Parsing CSV...');
  
  const records: CSVRow[] = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  console.log(`✅ Found ${records.length} locations in CSV`);
  
  return records.map((record) => ({
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
    
    textToEmbed: createEmbeddingText(record),
  }));
}

/**
 * Process billboard CSV and generate embeddings using AI SDK
 */
async function processBillboardCSV(csvContent: string) {
  // Parse and prepare all records
  const records = parseAndPrepareRecords(csvContent);
  
  const processedData = [];
  const batchSize = 100; // Process in batches to avoid rate limits
  
  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    console.log(`🔄 Processing batch ${i / batchSize + 1}/${Math.ceil(records.length / batchSize)} (${batch.length} records)...`);
    
    try {
      // Extract all texts to embed for this batch
      const textsToEmbed = batch.map(record => record.textToEmbed);
      
      // Use AI SDK's embedMany to generate all embeddings at once
      console.log(`🤖 Generating ${textsToEmbed.length} embeddings with AI SDK...`);
      const { embeddings } = await embedMany({
        model: embeddingModel,
        values: textsToEmbed,
      });
      
      console.log(`✅ Generated ${embeddings.length} embeddings`);
      
      // Combine the embeddings with the records
      const batchWithEmbeddings = batch.map((record, index) => ({
        city: record.city,
        state: record.state,
        county: record.county,
        marketIntelligence: record.marketIntelligence,
        hasStaticBulletin: record.hasStaticBulletin,
        hasStaticPoster: record.hasStaticPoster,
        hasDigital: record.hasDigital,
        lamarPercentage: record.lamarPercentage,
        outfrontPercentage: record.outfrontPercentage,
        clearChannelPercentage: record.clearChannelPercentage,
        otherVendorPercentage: record.otherVendorPercentage,
        staticBulletin12Week: record.staticBulletin12Week,
        staticBulletin24Week: record.staticBulletin24Week,
        staticBulletin52Week: record.staticBulletin52Week,
        staticBulletinImpressions: record.staticBulletinImpressions,
        staticPoster12Week: record.staticPoster12Week,
        staticPoster24Week: record.staticPoster24Week,
        staticPoster52Week: record.staticPoster52Week,
        staticPosterImpressions: record.staticPosterImpressions,
        digital12Week: record.digital12Week,
        digital24Week: record.digital24Week,
        digital52Week: record.digital52Week,
        digitalImpressions: record.digitalImpressions,
        embedding: embeddings[index],
      }));
      
      processedData.push(...batchWithEmbeddings);
      
    } catch (error) {
      console.error(`❌ Error processing batch ${i / batchSize + 1}:`, error);
      // Continue with next batch instead of failing completely
    }
    
    // Rate limit protection: wait 1 second between batches
    if (i + batchSize < records.length) {
      console.log('⏳ Waiting 1 second before next batch...');
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  console.log(`🎉 Successfully processed ${processedData.length}/${records.length} locations`);
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
    console.log('📨 Billboard CSV upload request received');
    
    // TODO: Add authentication check here
    // For now, anyone can upload (add auth later)

    const formData = await req.formData();
    const file = formData.get('file') as File;

    if (!file) {
      console.error('❌ No file provided');
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      );
    }

    if (!file.name || !file.name.endsWith('.csv')) {
      console.error('❌ File is not a CSV');
      return NextResponse.json(
        { error: 'File must be a CSV' },
        { status: 400 }
      );
    }

    console.log(`📄 Processing CSV file: ${file.name}, size: ${file.size} bytes`);

    const csvContent = await file.text();

    if (!csvContent || csvContent.trim().length === 0) {
      console.error('❌ CSV file is empty');
      return NextResponse.json(
        { error: 'CSV file is empty' },
        { status: 400 }
      );
    }

    // Clear existing data before uploading new data
    console.log('🗑️  Clearing existing billboard data...');
    await db.execute(sql`TRUNCATE TABLE billboard_locations RESTART IDENTITY CASCADE`);
    console.log('✅ Existing data cleared');

    // Process CSV and generate embeddings with AI SDK
    const vectors = await processBillboardCSV(csvContent);

    if (vectors.length === 0) {
      console.error('❌ No valid records found in CSV');
      return NextResponse.json(
        { error: 'No valid records found in CSV' },
        { status: 400 }
      );
    }

    console.log(`💾 Inserting ${vectors.length} records into database...`);

    // Insert in batches to avoid overwhelming the database
    const batchSize = 500;
    let inserted = 0;

    for (let i = 0; i < vectors.length; i += batchSize) {
      const batch = vectors.slice(i, i + batchSize);
      await db.insert(billboardLocations).values(batch);
      inserted += batch.length;
      console.log(`✅ Inserted ${inserted}/${vectors.length} records`);
    }

    console.log(`🎉 Successfully completed upload!`);
    
    return NextResponse.json({
      success: true,
      message: `Successfully processed and stored ${vectors.length} billboard locations`,
      count: vectors.length,
    });
  } catch (error) {
    console.error('❌ Billboard CSV upload error:', error);
    if (error instanceof Error) {
      console.error('Error details:', error.message);
      console.error('Stack trace:', error.stack);
    }
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
    console.log('📊 Checking billboard data status...');
    
    // TODO: Add authentication check here

    // Count total locations in database
    const result = await db.execute(sql`
      SELECT COUNT(*) as count FROM billboard_locations
    `);

    const count = Number(result.rows[0]?.count) || 0;

    console.log(`✅ Found ${count} locations in database`);

    return NextResponse.json({
      totalLocations: count,
      status: count > 0 ? 'ready' : 'no data',
    });
  } catch (error) {
    console.error('❌ Error checking billboard data status:', error);
    return NextResponse.json(
      { error: 'Failed to check status' },
      { status: 500 }
    );
  }
}