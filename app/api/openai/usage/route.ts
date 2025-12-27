// app/api/openai/usage/route.ts
// Fetches OpenAI API usage for the last 30 days using Admin API

import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';

export async function GET() {
  const session = await getSession();
  if (!session?.userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const adminKey = process.env.OPENAI_ADMIN_KEY;
  if (!adminKey) {
    return NextResponse.json(
      { error: 'OPENAI_ADMIN_KEY not configured' },
      { status: 500 }
    );
  }

  try {
    // Calculate date range (last 30 days) as Unix timestamps
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 30);

    const startTime = Math.floor(startDate.getTime() / 1000);
    const endTime = Math.floor(endDate.getTime() / 1000);

    const formatDate = (date: Date) => date.toISOString().split('T')[0];

    // Fetch all pages of costs from OpenAI's Admin API
    let totalCostDollars = 0;
    let hasMore = true;
    let pageToken: string | undefined;

    while (hasMore) {
      const url = new URL('https://api.openai.com/v1/organization/costs');
      url.searchParams.set('start_time', startTime.toString());
      url.searchParams.set('end_time', endTime.toString());
      if (pageToken) {
        url.searchParams.set('page', pageToken);
      }

      const response = await fetch(url.toString(), {
        headers: {
          'Authorization': `Bearer ${adminKey}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const error = await response.text();
        console.error('OpenAI Admin API error:', error);
        return NextResponse.json(
          { error: 'Failed to fetch OpenAI usage data. Ensure OPENAI_ADMIN_KEY has organization.costs.read permission.' },
          { status: response.status }
        );
      }

      const data = await response.json();

      // Sum up costs from this page
      if (data.data && Array.isArray(data.data)) {
        for (const bucket of data.data) {
          if (bucket.results && Array.isArray(bucket.results)) {
            for (const result of bucket.results) {
              // Amount value is in dollars - ensure it's a number
              const value = result.amount?.value;
              if (typeof value === 'number') {
                totalCostDollars += value;
              } else if (typeof value === 'string') {
                const parsed = parseFloat(value);
                if (!isNaN(parsed)) {
                  totalCostDollars += parsed;
                }
              }
            }
          }
        }
      }

      // Check for more pages
      hasMore = data.has_more === true;
      pageToken = data.next_page;
    }

    return NextResponse.json({
      totalCost: totalCostDollars,
      totalCostFormatted: `$${totalCostDollars.toFixed(2)}`,
      startDate: formatDate(startDate),
      endDate: formatDate(endDate),
    });
  } catch (error) {
    console.error('Error fetching OpenAI usage:', error);
    return NextResponse.json(
      { error: 'Failed to fetch usage data' },
      { status: 500 }
    );
  }
}
