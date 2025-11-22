// app/api/billboard-data/process/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { inngest } from '@/lib/inngest/client';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const { blobUrl } = await req.json();

    if (!blobUrl) {
      return NextResponse.json({ error: 'No blob URL provided' }, { status: 400 });
    }

    // Trigger background job
    await inngest.send({
      name: 'billboard/process.csv',
      data: { blobUrl },
    });

    return NextResponse.json({
      success: true,
      message: 'Processing started in background. Check Inngest dashboard for progress.',
    });
  } catch (error) {
    console.error('Failed to trigger job:', error);
    return NextResponse.json(
      { error: 'Failed to start processing', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}