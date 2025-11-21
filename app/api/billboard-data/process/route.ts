// app/api/billboard-data/process/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { inngest } from '@/lib/inngest/client';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    console.log('📨 Billboard CSV processing request received');

    const { blobUrl } = await req.json();

    if (!blobUrl) {
      return NextResponse.json({ error: 'No blob URL provided' }, { status: 400 });
    }

    console.log('🚀 Triggering background job for CSV processing...');
    const event = await inngest.send({
      name: 'billboard/process.csv', // Add .csv back
      data: { blobUrl },
    });

    console.log('✅ Background job triggered:', event.ids);

    return NextResponse.json({
      success: true,
      message: 'Processing started in background. This will take 30-60 minutes for large files.',
      jobId: event.ids[0],
    });
  } catch (error) {
    console.error('❌ Failed to trigger background job:', error);
    return NextResponse.json(
      {
        error: 'Failed to start processing',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}