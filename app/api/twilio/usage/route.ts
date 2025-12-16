// app/api/twilio/usage/route.ts
// Fetches Twilio usage/costs for current month and last month

import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { unstable_cache } from 'next/cache';

// Cache the Twilio usage fetch for 1 hour
const getCachedTwilioUsage = unstable_cache(
  async (accountSid: string, authToken: string) => {
    const now = new Date();

    // Current month: 1st of current month to today
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const currentMonthEnd = now;

    // Last month: 1st of last month to last day of last month
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);

    const formatDate = (date: Date) => date.toISOString().split('T')[0];
    const credentials = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

    // Fetch both months in parallel for better performance
    const [currentMonthResponse, lastMonthResponse] = await Promise.all([
      fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Usage/Records.json?StartDate=${formatDate(currentMonthStart)}&EndDate=${formatDate(currentMonthEnd)}`,
        {
          headers: { 'Authorization': `Basic ${credentials}` },
        }
      ),
      fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Usage/Records.json?StartDate=${formatDate(lastMonthStart)}&EndDate=${formatDate(lastMonthEnd)}`,
        {
          headers: { 'Authorization': `Basic ${credentials}` },
        }
      ),
    ]);

    if (!currentMonthResponse.ok || !lastMonthResponse.ok) {
      throw new Error('Failed to fetch Twilio usage data');
    }

    const [currentMonthData, lastMonthData] = await Promise.all([
      currentMonthResponse.json(),
      lastMonthResponse.json(),
    ]);

    // Calculate costs for each month
    const calculateTotal = (records: { price: string }[]) => {
      return records.reduce((sum, record) => sum + (parseFloat(record.price) || 0), 0);
    };

    const currentMonthCost = calculateTotal(currentMonthData.usage_records || []);
    const lastMonthCost = calculateTotal(lastMonthData.usage_records || []);

    // Get month names
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                        'July', 'August', 'September', 'October', 'November', 'December'];
    const currentMonthName = monthNames[now.getMonth()];
    const lastMonthName = monthNames[now.getMonth() === 0 ? 11 : now.getMonth() - 1];

    return {
      currentMonth: {
        name: currentMonthName,
        cost: currentMonthCost,
        costFormatted: `$${currentMonthCost.toFixed(2)}`,
      },
      lastMonth: {
        name: lastMonthName,
        cost: lastMonthCost,
        costFormatted: `$${lastMonthCost.toFixed(2)}`,
      },
      totalCost: currentMonthCost + lastMonthCost,
      totalCostFormatted: `$${(currentMonthCost + lastMonthCost).toFixed(2)}`,
    };
  },
  ['twilio-usage'],
  { revalidate: 3600, tags: ['twilio-usage'] } // Cache for 1 hour
);

export async function GET() {
  const session = await getSession();
  if (!session?.userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  if (!accountSid || !authToken) {
    return NextResponse.json(
      { error: 'TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN required' },
      { status: 500 }
    );
  }

  try {
    const usageData = await getCachedTwilioUsage(accountSid, authToken);

    const response = NextResponse.json(usageData);
    // Add cache headers for CDN/browser caching
    response.headers.set('Cache-Control', 'private, max-age=3600, stale-while-revalidate=7200');
    return response;
  } catch (error) {
    console.error('Error fetching Twilio usage:', error);
    return NextResponse.json(
      { error: 'Failed to fetch usage data' },
      { status: 500 }
    );
  }
}
