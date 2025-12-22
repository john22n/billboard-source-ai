// app/api/billboard-pricing/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { billboardLocations } from '@/db/schema';
import { sql } from 'drizzle-orm';
import { embed, generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const embeddingModel = openai.embedding('text-embedding-3-small');

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
      prompt: `Extract ONLY the geographic location information from this conversation transcript. 
Focus on: city names, state names, counties, regions, highways, neighborhoods, or specific areas mentioned.
If multiple locations are mentioned, list all of them.
Return ONLY the location names, separated by commas. Nothing else.

Examples:
- "Dallas, Texas"
- "Houston, Austin, San Antonio"
- "Los Angeles County, California"

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

    // Generate embedding for the EXTRACTED LOCATION
    const { embedding } = await embed({
      model: embeddingModel,
      value: extractedLocation,
    });

    // ✅ HYBRID SEARCH: Combine exact text matching with vector similarity
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
        1 - (embedding <=> ${JSON.stringify(embedding)}::vector) as similarity,
        CASE 
          WHEN LOWER(city) = LOWER(${city}) AND LOWER(state) = LOWER(${state}) THEN 1.0
          WHEN LOWER(city) = LOWER(${city}) THEN 0.5
          WHEN LOWER(state) = LOWER(${state}) THEN 0.3
          ELSE 0.0
        END as text_match_boost
      FROM billboard_locations
      WHERE embedding IS NOT NULL
      ORDER BY 
        text_match_boost DESC,
        embedding <=> ${JSON.stringify(embedding)}::vector ASC
      LIMIT 5
    `);

    if (!results.rows || results.rows.length === 0) {
      console.log('❌ No matching billboard locations found');
      return NextResponse.json({ context: '' });
    }

    console.log(`✅ Found ${results.rows.length} matching locations`);
    console.log(`🎯 Top match: ${(results.rows[0] as any).city}, ${(results.rows[0] as any).state}`);
    console.log(`   - Similarity: ${((results.rows[0] as any).similarity * 100).toFixed(1)}%`);
    console.log(`   - Text boost: ${(results.rows[0] as any).text_match_boost}`);

    const formattedContext = formatResults(results.rows);

    return NextResponse.json({ 
      context: formattedContext,
      topResult: results.rows[0],
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

function formatResults(rows: any[]) {
  return rows
    .map((row: any) => {
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
