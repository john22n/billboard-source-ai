// app/api/openai/usage/route.ts
// Fetches OpenAI API usage for the last 30 days using Admin API

import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'

const COST_LOOKBACK_DAYS = 30
const COSTS_API_URL = 'https://api.openai.com/v1/organization/costs'

interface CostResult {
  amount?: { value?: number | string }
}

interface CostBucket {
  results?: CostResult[]
}

interface CostsResponse {
  data?: CostBucket[]
  has_more?: boolean
  next_page?: string
}

class UsageRequestError extends Error {
  constructor(
    readonly status: number,
    readonly publicMessage: string,
  ) {
    super(publicMessage)
  }
}

async function requireAdmin() {
  const session = await getSession()
  if (!session?.userId) throw new UsageRequestError(401, 'Unauthorized')
  if (session.role !== 'admin') throw new UsageRequestError(403, 'Forbidden')
}

function requireAdminKey() {
  const adminKey = process.env.OPENAI_ADMIN_KEY
  if (!adminKey) {
    throw new UsageRequestError(500, 'OPENAI_ADMIN_KEY not configured')
  }
  return adminKey
}

function getCostRange() {
  const endDate = new Date()
  const startDate = new Date(endDate)
  startDate.setDate(startDate.getDate() - COST_LOOKBACK_DAYS)
  return { startDate, endDate }
}

function buildCostsUrl(startDate: Date, endDate: Date, pageToken?: string) {
  const url = new URL(COSTS_API_URL)
  url.searchParams.set(
    'start_time',
    `${Math.floor(startDate.getTime() / 1000)}`,
  )
  url.searchParams.set('end_time', `${Math.floor(endDate.getTime() / 1000)}`)
  url.searchParams.set('bucket_width', '1d')
  url.searchParams.set('limit', `${COST_LOOKBACK_DAYS}`)
  if (pageToken) url.searchParams.set('page', pageToken)
  return url
}

function parseCostValue(value: number | string | undefined) {
  if (typeof value === 'number') return value
  const parsed = Number.parseFloat(value ?? '')
  return Number.isNaN(parsed) ? 0 : parsed
}

function sumCosts(data: CostsResponse) {
  return (data.data ?? [])
    .flatMap((bucket) => bucket.results ?? [])
    .reduce((total, result) => total + parseCostValue(result.amount?.value), 0)
}

async function fetchCostsPage(
  adminKey: string,
  startDate: Date,
  endDate: Date,
  pageToken?: string,
) {
  const response = await fetch(buildCostsUrl(startDate, endDate, pageToken), {
    headers: {
      Authorization: `Bearer ${adminKey}`,
      'Content-Type': 'application/json',
    },
  })

  if (!response.ok) {
    console.error(
      'OpenAI Admin API request failed with status:',
      response.status,
    )
    throw new UsageRequestError(
      response.status,
      'Failed to fetch OpenAI usage data. Ensure OPENAI_ADMIN_KEY has organization.costs.read permission.',
    )
  }

  return (await response.json()) as CostsResponse
}

function getNextPageToken(data: CostsResponse) {
  if (!data.has_more) return undefined
  if (!data.next_page) {
    throw new Error('OpenAI costs response is missing next_page cursor')
  }
  return data.next_page
}

async function fetchTotalCost(
  adminKey: string,
  startDate: Date,
  endDate: Date,
) {
  let totalCost = 0
  let pageToken: string | undefined

  do {
    const data = await fetchCostsPage(adminKey, startDate, endDate, pageToken)
    totalCost += sumCosts(data)
    pageToken = getNextPageToken(data)
  } while (pageToken)

  return totalCost
}

function formatDate(date: Date) {
  return date.toISOString().split('T')[0]
}

function usageErrorResponse(error: unknown) {
  console.error('Error fetching OpenAI usage:', error)
  if (error instanceof UsageRequestError) {
    return NextResponse.json(
      { error: error.publicMessage },
      { status: error.status },
    )
  }
  return NextResponse.json(
    { error: 'Failed to fetch usage data' },
    { status: 500 },
  )
}

export async function GET() {
  try {
    await requireAdmin()
    const adminKey = requireAdminKey()
    const { startDate, endDate } = getCostRange()
    const totalCostDollars = await fetchTotalCost(adminKey, startDate, endDate)

    return NextResponse.json({
      totalCost: totalCostDollars,
      totalCostFormatted: `$${totalCostDollars.toFixed(2)}`,
      startDate: formatDate(startDate),
      endDate: formatDate(endDate),
    })
  } catch (error) {
    return usageErrorResponse(error)
  }
}
