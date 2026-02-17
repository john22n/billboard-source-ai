// app/api/billboard-pricing/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { sql } from 'drizzle-orm';
import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { getSession } from '@/lib/auth';
import OpenAI from 'openai';

export const dynamic = 'force-dynamic';

// ⭐ Use OpenAI SDK directly for 512-dimension embeddings
const openaiClient = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session?.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { transcript } = await req.json();

    if (!transcript || transcript.trim().length === 0) {
      return NextResponse.json({ context: '' });
    }

    console.log('🔍 Extracting location from transcript...');

    // Extract location information from transcript using AI
    const { text: extractedLocation } = await generateText({
      model: openai('gpt-4o-mini'),
      prompt: `Extract the geographic location from this conversation transcript.

IMPORTANT formatting rules:
- For US states, use the TWO-LETTER abbreviation (TX, CA, NY, FL, etc.)
- Use the full city name as commonly written
- Format: "City, STATE" (e.g., "Dallas, TX" not "Dallas, Texas")
- If multiple locations mentioned, return the PRIMARY one being discussed

Examples:
- "Dallas, TX"
- "Los Angeles, CA"
- "Miami, FL"

Return ONLY the location in "City, ST" format. Nothing else.

Transcript: ${transcript}`,
    });

    console.log('📍 Extracted location:', extractedLocation);

    if (!extractedLocation || extractedLocation.trim().length === 0) {
      console.log('❌ No location found in transcript');
      return NextResponse.json({ context: '' });
    }

    // ✅ Parse city and state from extracted location
    const locationParts = extractedLocation.split(',').map(s => s.trim());
    const city = locationParts[0] || '';
    const state = locationParts[1] || '';

    console.log('🏙️ Parsed - City:', city, 'State:', state);
    console.log('🔍 Location parts array:', locationParts);

    // ⭐ Generate 512-dimension embedding using OpenAI SDK directly
    const embeddingResponse = await openaiClient.embeddings.create({
      model: 'text-embedding-3-small',
      input: extractedLocation,
      dimensions: 512,
    });
    const embedding = embeddingResponse.data[0].embedding;
    // ✅ STRICT HYBRID SEARCH: Require both city AND state to match
    const results = await db.execute(sql`
      SELECT 
        city,
        state,
        county,
        avg_daily_views,
        four_week_range,
        market,
        market_range,
        general_range,
        details,
        avg_bull_price_per_month,
        avg_stat_bull_views_per_week,
        avg_poster_price_per_month,
        avg_poster_views_per_week,
        avg_digital_price_per_month,
        avg_digital_views_per_week,
        1 - (embedding <=> ${JSON.stringify(embedding)}::vector) as similarity
      FROM billboard_locations
      WHERE embedding IS NOT NULL
        ${city && state ? sql`AND LOWER(city) = LOWER(${city}) AND LOWER(state) = LOWER(${state})` : sql``}
      ORDER BY 
        embedding <=> ${JSON.stringify(embedding)}::vector ASC
      LIMIT 5
    `);

    console.log('📊 Query returned:', results.rows.length, 'results');
    if (results.rows.length > 0) {
      console.log('🎯 First result:', results.rows[0]);
    }

    if (!results.rows || results.rows.length === 0) {
      console.log('❌ No matching billboard locations found');
      return NextResponse.json({ context: '' });
    }

    const topResult = results.rows[0] as unknown as BillboardRow;
    console.log(`✅ Found ${results.rows.length} matching locations`);
    console.log(`🎯 Top match: ${topResult.city}, ${topResult.state}`);
    console.log(`   - Similarity: ${(topResult.similarity * 100).toFixed(1)}%`);

    const formattedContext = formatResults(results.rows as unknown as BillboardRow[]);

    return NextResponse.json({
      context: formattedContext,
      topResult,
      extractedLocation
    });
  } catch (error) {
    console.error('❌ Billboard pricing error:', error);
    return NextResponse.json(
      { 
        error: 'Failed to fetch billboard pricing',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

interface BillboardRow {
  city: string;
  state: string;
  county: string | null;
  avg_daily_views: string | null;
  four_week_range: string | null;
  market: string | null;
  market_range: string | null;
  general_range: string | null;
  details: string | null;
  avg_bull_price_per_month: number;
  avg_stat_bull_views_per_week: number;
  avg_poster_price_per_month: number;
  avg_poster_views_per_week: number;
  avg_digital_price_per_month: number;
  avg_digital_views_per_week: number;
  similarity: number;
}

function formatResults(rows: BillboardRow[]) {
  return rows
    .map((row: BillboardRow) => {
      const parts: string[] = [];

      parts.push(`Location: ${row.city}, ${row.state}`);
      if (row.county) parts.push(`County: ${row.county}`);

      if (row.market) {
        parts.push(`Market: ${row.market}`);
      }

      if (row.avg_daily_views) {
        parts.push(`Average Daily Views: ${row.avg_daily_views}`);
      }

      if (row.four_week_range) {
        parts.push(`4-Week Price Range: ${row.four_week_range}`);
      }

      if (row.market_range) {
        parts.push(`Market Range: ${row.market_range}`);
      }

      if (row.general_range) {
        parts.push(`General Pricing: ${row.general_range}`);
      }

      if (row.avg_bull_price_per_month > 0) {
        parts.push(`Static Bulletin: $${row.avg_bull_price_per_month}/month`);
        if (row.avg_stat_bull_views_per_week > 0) {
          parts.push(`  Weekly Views: ${row.avg_stat_bull_views_per_week.toLocaleString()}`);
        }
      }

      if (row.avg_poster_price_per_month > 0) {
        parts.push(`Poster: $${row.avg_poster_price_per_month}/month`);
        if (row.avg_poster_views_per_week > 0) {
          parts.push(`  Weekly Views: ${row.avg_poster_views_per_week.toLocaleString()}`);
        }
      }

      if (row.avg_digital_price_per_month > 0) {
        parts.push(`Digital: $${row.avg_digital_price_per_month}/month`);
        if (row.avg_digital_views_per_week > 0) {
          parts.push(`  Weekly Views: ${row.avg_digital_views_per_week.toLocaleString()}`);
        }
      }

      if (row.details && row.details.trim() !== '') {
        parts.push(`\nDetails:\n${row.details}`);
      }

      parts.push(`Similarity: ${(row.similarity * 100).toFixed(1)}%`);

      return parts.join('\n');
    })
    .join('\n\n' + '='.repeat(50) + '\n\n');
}