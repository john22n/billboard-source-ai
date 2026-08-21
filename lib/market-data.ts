import 'server-only'

import { parse } from 'csv-parse/sync'
import { sql } from 'drizzle-orm'
import OpenAI from 'openai'
import { db } from '@/db'
import { billboardLocations, type NewBillboardLocation } from '@/db/schema'

const MARKET_DATA_URL = 'https://geopoepoe.com/api-get-market-data?format=csv'
const EMBEDDING_MODEL = 'text-embedding-3-small'
const EMBEDDING_DIMENSIONS = 512
const EMBEDDING_BATCH_SIZE = 500
const EMBEDDING_BATCH_CHARACTER_LIMIT = 500_000
const CENTRAL_TIME_ZONE = 'America/Chicago'
const SYNC_HOUR = 23

const MARKET_DATA_COLUMNS = [
  'City',
  'State',
  'County',
  'Avg Daily Views',
  '4-Wk Range',
  'Market',
  'Market Range',
  'General Range',
  'Details',
  'Avg Bull Price/Mo',
  'Avg Stat Bull Views/Wk',
  'Avg Poster Price/Mo',
  'Avg Poster Views/Wk',
  'Avg Digital Price/Mo',
  'Avg Digital Views/Wk',
  'Avg Views/Period',
] as const

type MarketDataColumn = (typeof MARKET_DATA_COLUMNS)[number]
type MarketDataCsvRow = Record<MarketDataColumn, string>
type EmbeddingGenerator = (texts: string[]) => Promise<number[][]>

export interface ParsedMarketData {
  records: NewBillboardLocation[]
  sourceRecordCount: number
  duplicateRecordCount: number
}

export function isMarketDataSyncTime(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CENTRAL_TIME_ZONE,
    weekday: 'short',
    hour: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(now)
  const weekday = parts.find((part) => part.type === 'weekday')?.value
  const hour = Number(parts.find((part) => part.type === 'hour')?.value)

  return weekday === 'Sun' && hour === SYNC_HOUR
}

function optionalValue(value: string): string | null {
  return value.trim() || null
}

function integerValue(value: string): number {
  const parsed = Number.parseInt(value || '0', 10)
  return Number.isFinite(parsed) ? parsed : 0
}

function optionalEmbeddingPart(
  label: string,
  value: string | null | undefined,
): string[] {
  return value ? [`${label}: ${value}`] : []
}

function optionalPriceEmbeddingPart(
  label: string,
  value: number | null | undefined,
): string[] {
  return Number(value) > 0 ? [`${label}: $${value}/month`] : []
}

function createEmbeddingText(record: NewBillboardLocation): string {
  const parts = [
    `City: ${record.city}`,
    `State: ${record.state}`,
    `County: ${record.county ?? ''}`,
    ...optionalEmbeddingPart('Market', record.market),
    ...optionalEmbeddingPart('Average Daily Views', record.avgDailyViews),
    ...optionalEmbeddingPart('4-Week Price Range', record.fourWeekRange),
    ...optionalEmbeddingPart('Market Range', record.marketRange),
    ...optionalEmbeddingPart('General Pricing', record.generalRange),
    ...optionalPriceEmbeddingPart(
      'Static bulletin pricing',
      record.avgBullPricePerMonth,
    ),
    ...optionalPriceEmbeddingPart(
      'Poster pricing',
      record.avgPosterPricePerMonth,
    ),
    ...optionalPriceEmbeddingPart(
      'Digital billboard pricing',
      record.avgDigitalPricePerMonth,
    ),
    ...optionalEmbeddingPart('Details', record.details),
  ]

  return parts.join('. ')
}

function createEmbeddingGenerator(apiKey: string): EmbeddingGenerator {
  const openai = new OpenAI({ apiKey })

  return async (texts) => {
    const response = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: texts,
      dimensions: EMBEDDING_DIMENSIONS,
    })

    return response.data
      .sort((left, right) => left.index - right.index)
      .map((item) => item.embedding)
  }
}

function toMarketDataRecord(row: MarketDataCsvRow): NewBillboardLocation {
  return {
    city: row.City.trim(),
    state: row.State.trim(),
    county: optionalValue(row.County),
    avgDailyViews: optionalValue(row['Avg Daily Views']),
    fourWeekRange: optionalValue(row['4-Wk Range']),
    market: optionalValue(row.Market),
    marketRange: optionalValue(row['Market Range']),
    generalRange: optionalValue(row['General Range']),
    details: optionalValue(row.Details),
    avgBullPricePerMonth: integerValue(row['Avg Bull Price/Mo']),
    avgStatBullViewsPerWeek: integerValue(row['Avg Stat Bull Views/Wk']),
    avgPosterPricePerMonth: integerValue(row['Avg Poster Price/Mo']),
    avgPosterViewsPerWeek: integerValue(row['Avg Poster Views/Wk']),
    avgDigitalPricePerMonth: integerValue(row['Avg Digital Price/Mo']),
    avgDigitalViewsPerWeek: integerValue(row['Avg Digital Views/Wk']),
    avgViewsPerPeriod: optionalValue(row['Avg Views/Period']),
  }
}

export function parseMarketDataCsv(csv: string): ParsedMarketData {
  const rows = parse(csv, {
    bom: true,
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as MarketDataCsvRow[]

  if (rows.length === 0) {
    throw new Error('Market data CSV contains no records')
  }

  const columns = new Set(Object.keys(rows[0]))
  const missingColumns = MARKET_DATA_COLUMNS.filter(
    (column) => !columns.has(column),
  )
  if (missingColumns.length > 0) {
    throw new Error(
      `Market data CSV is missing columns: ${missingColumns.join(', ')}`,
    )
  }

  const recordsByLocation = new Map<string, NewBillboardLocation>()
  for (const row of rows) {
    const record = toMarketDataRecord(row)
    if (!record.city || !record.state) {
      throw new Error('Market data CSV contains a record without city or state')
    }

    // The database contract is one record per city/state. The source currently
    // contains a small number of duplicates, so preserve its last value just as
    // the previous sequential upsert flow did.
    recordsByLocation.set(`${record.city}\0${record.state}`, record)
  }

  const records = [...recordsByLocation.values()]
  return {
    records,
    sourceRecordCount: rows.length,
    duplicateRecordCount: rows.length - records.length,
  }
}

export async function fetchLatestMarketData(
  apiKey: string,
  fetchData: typeof fetch = fetch,
): Promise<ParsedMarketData> {
  const response = await fetchData(MARKET_DATA_URL, {
    headers: {
      Accept: 'text/csv',
      Authorization: `Bearer ${apiKey}`,
    },
    cache: 'no-store',
    redirect: 'error',
  })

  if (!response.ok) {
    throw new Error(`Market data API returned HTTP ${response.status}`)
  }

  return parseMarketDataCsv(await response.text())
}

export async function syncLatestMarketData(
  marketDataApiKey: string,
  openaiApiKey: string,
  generateEmbeddings: EmbeddingGenerator = createEmbeddingGenerator(
    openaiApiKey,
  ),
) {
  const parsed = await fetchLatestMarketData(marketDataApiKey)

  let recordIndex = 0
  while (recordIndex < parsed.records.length) {
    const batch: NewBillboardLocation[] = []
    const texts: string[] = []
    let characterCount = 0

    while (recordIndex + batch.length < parsed.records.length) {
      const record = parsed.records[recordIndex + batch.length]
      const text = createEmbeddingText(record)
      if (
        batch.length > 0 &&
        (batch.length >= EMBEDDING_BATCH_SIZE ||
          characterCount + text.length > EMBEDDING_BATCH_CHARACTER_LIMIT)
      ) {
        break
      }

      batch.push(record)
      texts.push(text)
      characterCount += text.length
    }

    const embeddings = await generateEmbeddings(texts)
    if (embeddings.length !== batch.length) {
      throw new Error('OpenAI returned an unexpected number of embeddings')
    }

    const recordsWithEmbeddings = batch.map((record, index) => ({
      ...record,
      embedding: embeddings[index],
    }))

    await db
      .insert(billboardLocations)
      .values(recordsWithEmbeddings)
      .onConflictDoUpdate({
        target: [billboardLocations.city, billboardLocations.state],
        set: {
          county: sql`EXCLUDED.county`,
          avgDailyViews: sql`EXCLUDED.avg_daily_views`,
          fourWeekRange: sql`EXCLUDED.four_week_range`,
          market: sql`EXCLUDED.market`,
          marketRange: sql`EXCLUDED.market_range`,
          generalRange: sql`EXCLUDED.general_range`,
          details: sql`EXCLUDED.details`,
          avgBullPricePerMonth: sql`EXCLUDED.avg_bull_price_per_month`,
          avgStatBullViewsPerWeek: sql`EXCLUDED.avg_stat_bull_views_per_week`,
          avgPosterPricePerMonth: sql`EXCLUDED.avg_poster_price_per_month`,
          avgPosterViewsPerWeek: sql`EXCLUDED.avg_poster_views_per_week`,
          avgDigitalPricePerMonth: sql`EXCLUDED.avg_digital_price_per_month`,
          avgDigitalViewsPerWeek: sql`EXCLUDED.avg_digital_views_per_week`,
          avgViewsPerPeriod: sql`EXCLUDED.avg_views_per_period`,
          embedding: sql`EXCLUDED.embedding`,
        },
      })

    recordIndex += batch.length
  }

  return {
    sourceRecordCount: parsed.sourceRecordCount,
    syncedRecordCount: parsed.records.length,
    duplicateRecordCount: parsed.duplicateRecordCount,
  }
}
