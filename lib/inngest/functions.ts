// lib/inngest/functions.ts
import { inngest } from './client';
import { parse } from 'csv-parse/sync';
import { embedMany } from 'ai';
import { openai } from '@ai-sdk/openai';
import { db } from '@/db';
import { billboardLocations } from '@/db/schema';
import { sql } from 'drizzle-orm';

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

function parseAndPrepareRecords(csvContent: string): ProcessedRecord[] {
  const records: CSVRow[] = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

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

// Main background job function
export const processBillboardData = inngest.createFunction(
  { 
    id: 'process-billboard-data',
    name: 'Process Billboard CSV Data',
    // No timeout limits with Inngest!
  },
  { event: 'billboard/process.csv' },
  async ({ event, step }) => {
    const { blobUrl } = event.data;

    // Step 1: Fetch CSV from blob storage
    const csvContent = await step.run('fetch-csv-from-blob', async () => {
      console.log('📥 Fetching CSV from blob storage:', blobUrl);
      const response = await fetch(blobUrl);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch CSV: ${response.statusText}`);
      }
      
      const content = await response.text();
      console.log('📝 CSV fetched successfully, size:', content.length, 'bytes');
      return content;
    });

    // Step 2: Parse CSV
    const records = await step.run('parse-csv', async () => {
      console.log('📝 Parsing CSV...');
      const parsed = parseAndPrepareRecords(csvContent);
      console.log(`✅ Found ${parsed.length} locations in CSV`);
      return parsed;
    });

    // Step 3: Clear existing data
    await step.run('clear-database', async () => {
      console.log('🗑️  Clearing existing billboard data...');
      await db.execute(sql`TRUNCATE TABLE billboard_locations RESTART IDENTITY CASCADE`);
      console.log('✅ Existing data cleared');
    });

    // Step 4: Process in batches (Inngest handles retries automatically)
    const BATCH_SIZE = 100; // Process 100 records at a time
    const totalBatches = Math.ceil(records.length / BATCH_SIZE);

    for (let i = 0; i < records.length; i += BATCH_SIZE) {
      const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
      
      await step.run(`process-batch-${batchNumber}`, async () => {
        const batch = records.slice(i, i + BATCH_SIZE);
        console.log(`🔄 Processing batch ${batchNumber}/${totalBatches} (${batch.length} records)...`);

        const processedData = [];
        const embeddingBatchSize = 50;

        // Process embeddings in sub-batches
        for (let j = 0; j < batch.length; j += embeddingBatchSize) {
          const subBatch = batch.slice(j, j + embeddingBatchSize);
          const textsToEmbed = subBatch.map(record => record.textToEmbed);

          console.log(`🤖 Generating ${textsToEmbed.length} embeddings...`);
          const { embeddings } = await embedMany({
            model: embeddingModel,
            values: textsToEmbed,
          });

          const batchWithEmbeddings = subBatch.map((record, index) => ({
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

          // Rate limiting between embedding calls
          await new Promise(resolve => setTimeout(resolve, 1000));
        }

        // Insert into database
        console.log(`💾 Inserting ${processedData.length} records...`);
        const insertBatchSize = 500;
        for (let k = 0; k < processedData.length; k += insertBatchSize) {
          const insertBatch = processedData.slice(k, k + insertBatchSize);
          await db.insert(billboardLocations).values(insertBatch);
        }

        console.log(`✅ Batch ${batchNumber} complete`);
        return { processed: processedData.length };
      });
    }

    console.log(`🎉 Successfully processed all ${records.length} locations`);
    return { 
      success: true, 
      totalRecords: records.length,
      message: `Successfully processed ${records.length} billboard locations`
    };
  }
);