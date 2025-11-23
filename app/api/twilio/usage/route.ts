// app/api/twilio/usage/route.ts
// Fetches Twilio usage/costs for current month and last month

import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';

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
    const now = new Date();

    // Current month: 1st of current month to today
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const currentMonthEnd = now;

    // Last month: 1st of last month to last day of last month
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);

    const formatDate = (date: Date) => date.toISOString().split('T')[0];
    const credentials = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

    // Fetch current month usage
    const currentMonthResponse = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Usage/Records.json?StartDate=${formatDate(currentMonthStart)}&EndDate=${formatDate(currentMonthEnd)}`,
      {
        headers: {
          'Authorization': `Basic ${credentials}`,
        },
      }
    );

    // Fetch last month usage
    const lastMonthResponse = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Usage/Records.json?StartDate=${formatDate(lastMonthStart)}&EndDate=${formatDate(lastMonthEnd)}`,
      {
        headers: {
          'Authorization': `Basic ${credentials}`,
        },
      }
    );

    if (!currentMonthResponse.ok || !lastMonthResponse.ok) {
      const error = !currentMonthResponse.ok
        ? await currentMonthResponse.text()
        : await lastMonthResponse.text();
      console.error('Twilio Usage API error:', error);
      return NextResponse.json(
        { error: 'Failed to fetch Twilio usage data' },
        { status: 500 }
      );
    }

    const currentMonthData = await currentMonthResponse.json();
    const lastMonthData = await lastMonthResponse.json();

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

    return NextResponse.json({
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
    });
  } catch (error) {
    console.error('Error fetching Twilio usage:', error);
    return NextResponse.json(
      { error: 'Failed to fetch usage data' },
      { status: 500 }
    );
  }
}
