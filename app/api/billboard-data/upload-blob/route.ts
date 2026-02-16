// app/api/billboard-data/upload-blob/route.ts
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';

export async function POST(request: Request): Promise<NextResponse> {
  console.log('📤 Upload-blob route hit');

  // Verify user is authenticated and has admin role
  const session = await getSession();
  if (!session?.userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (session.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.error('❌ BLOB_READ_WRITE_TOKEN is not set');
    return NextResponse.json(
      { error: 'Blob storage not configured' },
      { status: 500 }
    );
  }

  try {
    const body = (await request.json()) as HandleUploadBody;
    
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        console.log('📤 Generating upload token for:', pathname);
        
        return {
          allowedContentTypes: ['text/csv', 'application/vnd.ms-excel', 'text/plain'],
          allowOverwrite: true,
          tokenPayload: JSON.stringify({
            uploadedAt: new Date().toISOString(),
          }),
        };
      },
      // REMOVED onUploadCompleted - this was causing the 401
    });

    console.log('✅ Upload successful:', jsonResponse);
    return NextResponse.json(jsonResponse);
  } catch (error) {
    console.error('❌ Blob upload error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error details:', errorMessage);
    
    return NextResponse.json(
      { error: errorMessage },
      { status: 400 }
    );
  }
}