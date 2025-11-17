// app/api/billboard-pricing/route.ts
import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { db } from '@/db';
import { billboardLocations } from '@/db/schema';
import { sql, and, ilike, or } from 'drizzle-orm';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface BillboardSearchResult {
  city: string;
  state: string;
  county: string;
  marketIntelligence: string;
  hasStaticBulletin: boolean | null;
  hasStaticPoster: boolean | null;
  hasDigital: boolean | null;
  pricing: {
    staticBulletin?: {
      week12: number | null;
      week24: number | null;
      week52: number | null;
      impressions: number | null;
    };
    staticPoster?: {
      week12: number | null;
      week24: number | null;
      week52: number | null;
      impressions: number | null;
    };
    digital?: {
      week12: number | null;
      week24: number | null;
      week52: number | null;
      impressions: number | null;
    };
  };
  vendors: {
    lamar: number | null;
    outfront: number | null;
    clearChannel: number | null;
    other: number | null;
  };
  similarity?: number;
  matchType?: 'exact' | 'semantic';
}

interface CampaignPreferences {
  desiredLength: '12-week' | '24-week' | '52-week' | 'all' | null;
  billboardTypes: ('static-bulletin' | 'static-poster' | 'digital' | 'all')[];
  confidence: 'high' | 'medium' | 'low';
}

interface ExtractedLocation {
  cities: string[];
  states: string[];
  counties: string[];
  confidence: 'high' | 'medium' | 'low';
}

// ============================================================================
// EXTRACTION FUNCTIONS
// ============================================================================

/**
 * Use GPT to extract structured location data from transcript
 */
async function extractLocationInfo(transcript: string): Promise<ExtractedLocation> {
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are a location extraction assistant. Extract cities, states, and counties mentioned in the conversation.
          
Return a JSON object with this exact structure:
{
  "cities": ["array of city names"],
  "states": ["array of state names or abbreviations"],
  "counties": ["array of county names"],
  "confidence": "high" | "medium" | "low"
}

Rules:
- Extract only explicitly mentioned locations
- Normalize state names to abbreviations (e.g., "Alabama" -> "AL", "Texas" -> "TX", "California" -> "CA")
- Remove "County" suffix from county names
- Set confidence to "high" if city AND state mentioned, "medium" if only state/county, "low" if ambiguous
- If no locations found, return empty arrays with "low" confidence

Examples:
- "Moundville, Alabama" → cities: ["Moundville"], states: ["AL"], confidence: "high"
- "Dallas Texas" → cities: ["Dallas"], states: ["TX"], confidence: "high"
- "somewhere in California" → cities: [], states: ["CA"], confidence: "medium"
- "Austin, TX" → cities: ["Austin"], states: ["TX"], confidence: "high"`
        },
        {
          role: 'user',
          content: transcript
        }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.3,
    });

    const extracted = JSON.parse(response.choices[0].message.content || '{}');
    return {
      cities: extracted.cities || [],
      states: extracted.states || [],
      counties: extracted.counties || [],
      confidence: extracted.confidence || 'low',
    };
  } catch (error) {
    console.error('Error extracting location info:', error);
    return { cities: [], states: [], counties: [], confidence: 'low' };
  }
}

/**
 * Extract campaign preferences from transcript using GPT
 * IMPORTANT: Prioritizes the MOST RECENT mentions of campaign length
 */
async function extractCampaignPreferences(transcript: string): Promise<CampaignPreferences> {
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are a campaign preference extraction assistant. Analyze the conversation to extract billboard campaign preferences.

CRITICAL: If the user changes their mind or mentions multiple campaign lengths, ALWAYS use the MOST RECENT mention. Pay special attention to the END of the conversation.

Return a JSON object with this exact structure:
{
  "desiredLength": "12-week" | "24-week" | "52-week" | "all" | null,
  "billboardTypes": ["static-bulletin" | "static-poster" | "digital" | "all"],
  "confidence": "high" | "medium" | "low"
}

Rules for desiredLength (USE ONLY THE MOST RECENT MENTION):
- "12-week" if user mentions: "1 month", "one month", "4 weeks", "short campaign", "12 weeks", "3 months", "quarterly"
- "24-week" if user mentions: "2 months", "two months", "6 months", "half year", "24 weeks"
- "52-week" if user mentions: "year", "12 months", "annual", "52 weeks", "long term", "full year"
- "all" if user is unsure, exploring options, or says "not sure yet", "depends on price", "show me options"
- null if no campaign length mentioned at all

Examples of handling changes:
- "I want 1 month... actually, make that 12 months" → "52-week" (most recent)
- "Show me 3 months... or maybe 6 months" → "24-week" (most recent)
- "I need a year-long campaign" → "52-week"

Rules for billboardTypes:
- Include "static-bulletin" if they mention: "bulletin", "large billboard", "big board", "traditional", "static"
- Include "static-poster" if they mention: "poster", "smaller billboard", "poster board"
- Include "digital" if they mention: "digital", "LED", "electronic", "rotating ads"
- Return ["all"] if no specific type mentioned or they want to see all options

Set confidence to "high" if explicit mentions, "medium" if implied, "low" if unclear.`
        },
        {
          role: 'user',
          content: transcript
        }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
    });

    const extracted = JSON.parse(response.choices[0].message.content || '{}');
    return {
      desiredLength: extracted.desiredLength || 'all',
      billboardTypes: extracted.billboardTypes || ['all'],
      confidence: extracted.confidence || 'low',
    };
  } catch (error) {
    console.error('Error extracting campaign preferences:', error);
    return { 
      desiredLength: 'all', 
      billboardTypes: ['all'], 
      confidence: 'low' 
    };
  }
}

// ============================================================================
// SEARCH FUNCTIONS
// ============================================================================

/**
 * Perform exact database match for specific locations
 */
async function exactLocationSearch(
  locationInfo: ExtractedLocation
): Promise<BillboardSearchResult[]> {
  try {
    const conditions = [];

    // Build query conditions based on extracted info
    if (locationInfo.cities.length > 0 && locationInfo.states.length > 0) {
      // Most specific: city + state combination
      for (const city of locationInfo.cities) {
        for (const state of locationInfo.states) {
          conditions.push(
            and(
              ilike(billboardLocations.city, city),
              or(
                ilike(billboardLocations.state, state),
                ilike(billboardLocations.state, `%${state}%`)
              )
            )
          );
        }
      }
    } else if (locationInfo.counties.length > 0 && locationInfo.states.length > 0) {
      // County + state combination
      for (const county of locationInfo.counties) {
        for (const state of locationInfo.states) {
          conditions.push(
            and(
              ilike(billboardLocations.county, `%${county}%`),
              or(
                ilike(billboardLocations.state, state),
                ilike(billboardLocations.state, `%${state}%`)
              )
            )
          );
        }
      }
    } else if (locationInfo.states.length > 0) {
      // State only
      conditions.push(
        or(...locationInfo.states.map(state => 
          or(
            ilike(billboardLocations.state, state),
            ilike(billboardLocations.state, `%${state}%`)
          )
        ))
      );
    } else if (locationInfo.counties.length > 0) {
      // County only
      conditions.push(
        or(...locationInfo.counties.map(county => 
          ilike(billboardLocations.county, `%${county}%`)
        ))
      );
    }

    if (conditions.length === 0) {
      return [];
    }

    const results = await db
      .select({
        city: billboardLocations.city,
        state: billboardLocations.state,
        county: billboardLocations.county,
        marketIntelligence: billboardLocations.marketIntelligence,
        hasStaticBulletin: billboardLocations.hasStaticBulletin,
        hasStaticPoster: billboardLocations.hasStaticPoster,
        hasDigital: billboardLocations.hasDigital,
        lamarPercentage: billboardLocations.lamarPercentage,
        outfrontPercentage: billboardLocations.outfrontPercentage,
        clearChannelPercentage: billboardLocations.clearChannelPercentage,
        otherVendorPercentage: billboardLocations.otherVendorPercentage,
        staticBulletin12Week: billboardLocations.staticBulletin12Week,
        staticBulletin24Week: billboardLocations.staticBulletin24Week,
        staticBulletin52Week: billboardLocations.staticBulletin52Week,
        staticBulletinImpressions: billboardLocations.staticBulletinImpressions,
        staticPoster12Week: billboardLocations.staticPoster12Week,
        staticPoster24Week: billboardLocations.staticPoster24Week,
        staticPoster52Week: billboardLocations.staticPoster52Week,
        staticPosterImpressions: billboardLocations.staticPosterImpressions,
        digital12Week: billboardLocations.digital12Week,
        digital24Week: billboardLocations.digital24Week,
        digital52Week: billboardLocations.digital52Week,
        digitalImpressions: billboardLocations.digitalImpressions,
      })
      .from(billboardLocations)
      .where(or(...conditions))
      .limit(10);

    return results.map(row => ({
      city: row.city,
      state: row.state,
      county: row.county,
      marketIntelligence: row.marketIntelligence || '',
      hasStaticBulletin: row.hasStaticBulletin,
      hasStaticPoster: row.hasStaticPoster,
      hasDigital: row.hasDigital,
      pricing: {
        ...(row.hasStaticBulletin && {
          staticBulletin: {
            week12: row.staticBulletin12Week,
            week24: row.staticBulletin24Week,
            week52: row.staticBulletin52Week,
            impressions: row.staticBulletinImpressions,
          }
        }),
        ...(row.hasStaticPoster && {
          staticPoster: {
            week12: row.staticPoster12Week,
            week24: row.staticPoster24Week,
            week52: row.staticPoster52Week,
            impressions: row.staticPosterImpressions,
          }
        }),
        ...(row.hasDigital && {
          digital: {
            week12: row.digital12Week,
            week24: row.digital24Week,
            week52: row.digital52Week,
            impressions: row.digitalImpressions,
          }
        }),
      },
      vendors: {
        lamar: row.lamarPercentage,
        outfront: row.outfrontPercentage,
        clearChannel: row.clearChannelPercentage,
        other: row.otherVendorPercentage,
      },
      matchType: 'exact' as const,
      similarity: 1.0,
    }));
  } catch (error) {
    console.error('Error in exact location search:', error);
    return [];
  }
}

/**
 * Query billboard locations using semantic search
 */
async function semanticSearch(
  query: string,
  topK: number = 5
): Promise<BillboardSearchResult[]> {
  try {
    const queryEmbedding = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: query,
    });

    const embeddingVector = queryEmbedding.data[0].embedding;

    const results = await db.execute(sql`
      SELECT 
        city,
        state,
        county,
        market_intelligence,
        has_static_bulletin,
        has_static_poster,
        has_digital,
        lamar_percentage,
        outfront_percentage,
        clear_channel_percentage,
        other_vendor_percentage,
        static_bulletin_12_week,
        static_bulletin_24_week,
        static_bulletin_52_week,
        static_bulletin_impressions,
        static_poster_12_week,
        static_poster_24_week,
        static_poster_52_week,
        static_poster_impressions,
        digital_12_week,
        digital_24_week,
        digital_52_week,
        digital_impressions,
        1 - (embedding <=> ${JSON.stringify(embeddingVector)}::vector) as similarity
      FROM billboard_locations
      WHERE embedding IS NOT NULL
      ORDER BY embedding <=> ${JSON.stringify(embeddingVector)}::vector
      LIMIT ${topK}
    `);

    interface SemanticSearchRow {
      city: string;
      state: string;
      county: string;
      market_intelligence: string | null;
      has_static_bulletin: boolean | null;
      has_static_poster: boolean | null;
      has_digital: boolean | null;
      lamar_percentage: number | null;
      outfront_percentage: number | null;
      clear_channel_percentage: number | null;
      other_vendor_percentage: number | null;
      static_bulletin_12_week: number | null;
      static_bulletin_24_week: number | null;
      static_bulletin_52_week: number | null;
      static_bulletin_impressions: number | null;
      static_poster_12_week: number | null;
      static_poster_24_week: number | null;
      static_poster_52_week: number | null;
      static_poster_impressions: number | null;
      digital_12_week: number | null;
      digital_24_week: number | null;
      digital_52_week: number | null;
      digital_impressions: number | null;
      similarity: string;
    }

    const typedRows = results.rows as unknown as SemanticSearchRow[];

    return typedRows.map((row) => ({
      city: row.city,
      state: row.state,
      county: row.county,
      marketIntelligence: row.market_intelligence || '',
      hasStaticBulletin: row.has_static_bulletin,
      hasStaticPoster: row.has_static_poster,
      hasDigital: row.has_digital,
      pricing: {
        ...(row.has_static_bulletin && {
          staticBulletin: {
            week12: row.static_bulletin_12_week,
            week24: row.static_bulletin_24_week,
            week52: row.static_bulletin_52_week,
            impressions: row.static_bulletin_impressions,
          }
        }),
        ...(row.has_static_poster && {
          staticPoster: {
            week12: row.static_poster_12_week,
            week24: row.static_poster_24_week,
            week52: row.static_poster_52_week,
            impressions: row.static_poster_impressions,
          }
        }),
        ...(row.has_digital && {
          digital: {
            week12: row.digital_12_week,
            week24: row.digital_24_week,
            week52: row.digital_52_week,
            impressions: row.digital_impressions,
          }
        }),
      },
      vendors: {
        lamar: row.lamar_percentage || 0,
        outfront: row.outfront_percentage || 0,
        clearChannel: row.clear_channel_percentage || 0,
        other: row.other_vendor_percentage || 0,
      },
      similarity: parseFloat(row.similarity),
      matchType: 'semantic' as const,
    }));
  } catch (error) {
    console.error('Error in semantic search:', error);
    return [];
  }
}

// ============================================================================
// FORMATTING FUNCTION
// ============================================================================

/**
 * Format billboard data for LLM context with smart filtering based on preferences
 */
function formatBillboardContext(
  locations: BillboardSearchResult[], 
  preferences?: CampaignPreferences
): string {
  if (locations.length === 0) {
    return 'No billboard pricing data available for the mentioned locations.';
  }

  const formatted = locations.map((loc, index) => {
    const matchIndicator = loc.matchType === 'exact' ? '✓ Exact Match' : 
                          loc.similarity && loc.similarity > 0.7 ? '~ High Confidence' : 
                          '~ Possible Match';
    
    const parts = [
      `\n**Location ${index + 1}: ${loc.city}, ${loc.state}** [${matchIndicator}]`,
      `County: ${loc.county}`,
    ];

    // Determine which billboard types to show
    const showStaticBulletin = 
      !preferences || 
      preferences.billboardTypes.includes('all') || 
      preferences.billboardTypes.includes('static-bulletin');
    
    const showStaticPoster = 
      !preferences || 
      preferences.billboardTypes.includes('all') || 
      preferences.billboardTypes.includes('static-poster');
    
    const showDigital = 
      !preferences || 
      preferences.billboardTypes.includes('all') || 
      preferences.billboardTypes.includes('digital');

    // Add availability based on preferences
    const available = [];
    if (loc.hasStaticBulletin && showStaticBulletin) available.push('Static Bulletin');
    if (loc.hasStaticPoster && showStaticPoster) available.push('Static Poster');
    if (loc.hasDigital && showDigital) available.push('Digital');
    
    if (available.length > 0) {
      parts.push(`Available Billboard Types: ${available.join(', ')}`);
    } else {
      parts.push('No matching billboards available in this city');
      return parts.join('\n');
    }

    // Add market intelligence
    if (loc.marketIntelligence) {
      parts.push(`Market Info: ${loc.marketIntelligence.substring(0, 200)}${loc.marketIntelligence.length > 200 ? '...' : ''}`);
    }

    // Helper function to format pricing based on desired length
    const formatPricing = (type: 'staticBulletin' | 'staticPoster' | 'digital', label: string) => {
      const pricing = loc.pricing[type];
      if (!pricing) return;

      const desiredLength = preferences?.desiredLength;
      
      parts.push(`\n${label} Pricing:`);

      // Show specific length or all lengths
      if (desiredLength === '12-week') {
        parts.push(`  - 12-week campaign (3 months): $${(pricing.week12 || 0).toLocaleString()}`);
        if (pricing.impressions) {
          parts.push(`  - Avg weekly impressions: ${pricing.impressions.toLocaleString()}`);
        }
      } else if (desiredLength === '24-week') {
        parts.push(`  - 24-week campaign (6 months): $${(pricing.week24 || 0).toLocaleString()}`);
        if (pricing.impressions) {
          parts.push(`  - Avg weekly impressions: ${pricing.impressions.toLocaleString()}`);
        }
      } else if (desiredLength === '52-week') {
        parts.push(`  - 52-week campaign (1 year): $${(pricing.week52 || 0).toLocaleString()}`);
        if (pricing.impressions) {
          parts.push(`  - Avg weekly impressions: ${pricing.impressions.toLocaleString()}`);
        }
      } else {
        // Show all options
        parts.push(`  - 12-week campaign (3 months): $${(pricing.week12 || 0).toLocaleString()}`);
        parts.push(`  - 24-week campaign (6 months): $${(pricing.week24 || 0).toLocaleString()}`);
        parts.push(`  - 52-week campaign (1 year): $${(pricing.week52 || 0).toLocaleString()}`);
        if (pricing.impressions) {
          parts.push(`  - Avg weekly impressions: ${pricing.impressions.toLocaleString()}`);
        }
      }
    };

    // Add pricing for each type based on preferences
    if (loc.pricing.staticBulletin && showStaticBulletin) {
      formatPricing('staticBulletin', 'Static Bulletin');
    }

    if (loc.pricing.digital && showDigital) {
      formatPricing('digital', 'Digital Billboard');
    }

    if (loc.pricing.staticPoster && showStaticPoster) {
      formatPricing('staticPoster', 'Static Poster');
    }

    // Add vendor info
    const vendors = [];
    if (loc.vendors.lamar !== null && loc.vendors.lamar > 0) vendors.push(`Lamar (${loc.vendors.lamar}%)`);
    if (loc.vendors.outfront !== null && loc.vendors.outfront > 0) vendors.push(`Outfront (${loc.vendors.outfront}%)`);
    if (loc.vendors.clearChannel !== null && loc.vendors.clearChannel > 0) vendors.push(`Clear Channel (${loc.vendors.clearChannel}%)`);
    if (loc.vendors.other !== null && loc.vendors.other > 0) vendors.push(`Other (${loc.vendors.other}%)`);
    
    if (vendors.length > 0) {
      parts.push(`\nVendor Distribution: ${vendors.join(', ')}`);
    }

    return parts.join('\n');
  });

  // Add preference summary if provided
  let contextHeader = '';
  if (preferences && preferences.confidence !== 'low') {
    const lengthText = preferences.desiredLength === 'all' 
      ? 'showing all campaign lengths' 
      : `focused on ${preferences.desiredLength} campaigns`;
    
    const typeText = preferences.billboardTypes.includes('all')
      ? 'all billboard types'
      : preferences.billboardTypes.join(', ');
    
    contextHeader = `[Pricing filtered: ${lengthText}, ${typeText}]\n\n`;
  }

  return contextHeader + formatted.join('\n\n---\n');
}

// ============================================================================
// MAIN HYBRID SEARCH FUNCTION
// ============================================================================

/**
 * Intelligent hybrid search that prioritizes exact matches
 */
async function getBillboardContextFromTranscript(transcript: string): Promise<string> {
  try {
    // Extract both location info and campaign preferences in parallel
    const [locationInfo, preferences] = await Promise.all([
      extractLocationInfo(transcript),
      extractCampaignPreferences(transcript)
    ]);

    console.log('Location info:', locationInfo);
    console.log('Campaign preferences:', preferences);

    let results: BillboardSearchResult[] = [];

    // Strategy: Prioritize exact matches, supplement with semantic search
    if (locationInfo.confidence === 'high' || locationInfo.confidence === 'medium') {
      // Try exact match first
      console.log('Using exact match search');
      const exactResults = await exactLocationSearch(locationInfo);
      
      if (exactResults.length > 0) {
        // Found exact matches - use them first
        results = exactResults.slice(0, 5);
        
        // If we have fewer than 5 results, supplement with semantic search
        if (results.length < 5) {
          console.log('Supplementing with semantic search');
          const semanticResults = await semanticSearch(transcript, 5 - results.length);
          
          // Add semantic results that aren't duplicates
          const existingKeys = new Set(results.map(r => `${r.city}-${r.state}`));
          const uniqueSemanticResults = semanticResults.filter(r => 
            !existingKeys.has(`${r.city}-${r.state}`) && r.similarity && r.similarity > 0.6
          );
          
          results = [...results, ...uniqueSemanticResults];
        }
      } else {
        // No exact matches, fall back to semantic search
        console.log('No exact matches, using semantic search');
        results = await semanticSearch(transcript, 5);
        results = results.filter(r => r.similarity && r.similarity > 0.5);
      }
    } else {
      // Low confidence - use semantic search only
      console.log('Using semantic search only (low confidence)');
      results = await semanticSearch(transcript, 5);
      results = results.filter(r => r.similarity && r.similarity > 0.5);
    }

    if (results.length === 0) {
      return '';
    }

    return formatBillboardContext(results, preferences);
  } catch (error) {
    console.error('Error getting billboard context:', error);
    return '';
  }
}

// ============================================================================
// API ROUTE HANDLER
// ============================================================================

export async function POST(req: NextRequest) {
  try {
    const { transcript } = await req.json();

    if (!transcript || typeof transcript !== 'string') {
      return NextResponse.json(
        { error: 'Invalid transcript provided' },
        { status: 400 }
      );
    }

    // Only process if transcript is long enough
    if (transcript.length < 100) {
      return NextResponse.json({ context: '' });
    }

    const context = await getBillboardContextFromTranscript(transcript);

    return NextResponse.json({ context });
  } catch (error) {
    console.error('Error fetching billboard context:', error);
    return NextResponse.json(
      { error: 'Failed to fetch billboard pricing data' },
      { status: 500 }
    );
  }
}