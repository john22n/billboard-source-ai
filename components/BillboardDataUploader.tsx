// components/admin/BillboardDataUploader.tsx
'use client';

import { useState } from 'react';
import { Upload, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { upload } from '@vercel/blob/client';

export function BillboardDataUploader() {
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState<{
    type: 'success' | 'error' | 'info' | null;
    message: string;
  }>({ type: null, message: '' });
  const [progress, setProgress] = useState('');
  const [progressPercent, setProgressPercent] = useState(0);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  async function processChunks(blobUrl: string, totalChunks: number, chunkSize: number) {
    for (let i = 0; i < totalChunks; i++) {
      setProgress(`Processing chunk ${i + 1} of ${totalChunks}...`);
      setProgressPercent(Math.round(((i + 1) / totalChunks) * 100));

      const response = await fetch('/api/billboard-data/process-chunk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          blobUrl,
          chunkIndex: i,
          chunkSize,
        }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(`Failed to process chunk ${i + 1}: ${result.error || result.details || 'Unknown error'}`);
      }

      console.log(`✅ Chunk ${i + 1} completed: ${result.recordsProcessed} records`);
    }
  }

  async function handleUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setUploading(true);
    setStatus({ type: 'info', message: 'Starting upload...' });
    setProgress('');
    setProgressPercent(0);

    const formData = new FormData(e.currentTarget);
    const file = formData.get('file');

    if (!file || !(file instanceof File)) {
      setStatus({ type: 'error', message: 'Please select a file' });
      setUploading(false);
      return;
    }

    if (!file.name.toLowerCase().endsWith('.csv')) {
      setStatus({ type: 'error', message: 'Please select a CSV file' });
      setUploading(false);
      return;
    }

    if (file.size > 500 * 1024 * 1024) {
      setStatus({ type: 'error', message: 'File is too large (max 500MB)' });
      setUploading(false);
      return;
    }

    try {
      // Step 1: Upload to Blob
      setProgress('Uploading file to cloud storage...');
      setStatus({ type: 'info', message: 'Uploading file...' });

      const blob = await upload(file.name, file, {
        access: 'public',
        handleUploadUrl: '/api/billboard-data/upload-blob',
      });

      console.log('✅ File uploaded to blob:', blob.url);

      // Step 2: Start processing
      setProgress('Analyzing CSV file...');
      setStatus({ type: 'info', message: 'Analyzing file and preparing to process...' });

      const startResponse = await fetch('/api/billboard-data/start-process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blobUrl: blob.url }),
      });

      const startResult = await startResponse.json();

      if (!startResponse.ok || !startResult.success) {
        throw new Error(startResult.error || startResult.details || 'Failed to start processing');
      }

      console.log(`📊 Processing ${startResult.totalRecords} records in ${startResult.totalChunks} chunks`);

      // Step 3: Process chunks
      setStatus({ 
        type: 'info', 
        message: `Processing ${startResult.totalRecords.toLocaleString()} records. This will take about ${Math.round(startResult.totalChunks * 4)} minutes. Keep this page open.` 
      });

      await processChunks(startResult.blobUrl, startResult.totalChunks, startResult.chunkSize);

      // Success!
      setStatus({
        type: 'success',
        message: `Successfully processed all ${startResult.totalRecords.toLocaleString()} records!`,
      });
      setProgress('');
      setProgressPercent(0);
      setSelectedFile(null);
      (e.target as HTMLFormElement).reset();

    } catch (error) {
      console.error('Processing failed:', error);
      setStatus({
        type: 'error',
        message: error instanceof Error ? error.message : 'Processing failed. Please try again.',
      });
      setProgress('');
      setProgressPercent(0);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto p-6 bg-white rounded-lg shadow-md">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">
          Billboard Pricing Database
        </h2>
        <p className="text-gray-600">
          Upload your billboard pricing CSV to process all records with embeddings.
        </p>
      </div>

      <form onSubmit={handleUpload} className="space-y-6">
        <div>
          <label
            htmlFor="file-upload"
            className="block text-sm font-medium text-gray-700 mb-2"
          >
            Select Billboard Pricing CSV
          </label>
          <div className={`mt-1 flex justify-center px-6 pt-5 pb-6 border-2 border-dashed rounded-lg transition-colors ${
            selectedFile
              ? 'border-green-400 bg-green-50'
              : 'border-gray-300 hover:border-gray-400'
          }`}>
            <div className="space-y-1 text-center">
              {selectedFile ? (
                <>
                  <CheckCircle2 className="mx-auto h-12 w-12 text-green-500" />
                  <p className="text-sm font-medium text-green-700">{selectedFile.name}</p>
                  <p className="text-xs text-green-600">
                    {(selectedFile.size / (1024 * 1024)).toFixed(2)} MB
                  </p>
                </>
              ) : (
                <>
                  <Upload className="mx-auto h-12 w-12 text-gray-400" />
                  <div className="flex text-sm text-gray-600">
                    <label
                      htmlFor="file-upload"
                      className="relative cursor-pointer bg-white rounded-md font-medium text-blue-600 hover:text-blue-500 focus-within:outline-none"
                    >
                      <span>Upload a file</span>
                    </label>
                    <p className="pl-1">or drag and drop</p>
                  </div>
                  <p className="text-xs text-gray-500">CSV file up to 500MB</p>
                </>
              )}
              <input
                id="file-upload"
                name="file"
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                disabled={uploading}
                required
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file && !file.name.toLowerCase().endsWith('.csv')) {
                    e.target.value = '';
                    setSelectedFile(null);
                    setStatus({
                      type: 'error',
                      message: 'Please select a CSV file'
                    });
                  } else {
                    setSelectedFile(file || null);
                    setStatus({ type: null, message: '' });
                  }
                }}
              />
              <label
                htmlFor="file-upload"
                className={`inline-block mt-2 cursor-pointer text-xs font-medium ${
                  selectedFile ? 'text-green-600 hover:text-green-700' : 'text-blue-600 hover:text-blue-500'
                }`}
              >
                {selectedFile ? 'Change file' : ''}
              </label>
            </div>
          </div>
        </div>

        {progress && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-blue-600 bg-blue-50 p-3 rounded-lg">
              <Loader2 className="h-4 w-4 animate-spin flex-shrink-0" />
              <span>{progress}</span>
            </div>
            {progressPercent > 0 && (
              <div className="w-full bg-gray-200 rounded-full h-2.5">
                <div
                  className="bg-blue-600 h-2.5 rounded-full transition-all duration-300"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            )}
          </div>
        )}

        {status.type && (
          <div
            className={`p-4 rounded-lg flex items-start gap-3 ${
              status.type === 'success'
                ? 'bg-green-50 text-green-800 border border-green-200'
                : status.type === 'error'
                ? 'bg-red-50 text-red-800 border border-red-200'
                : 'bg-blue-50 text-blue-800 border border-blue-200'
            }`}
          >
            {status.type === 'success' && (
              <CheckCircle2 className="h-5 w-5 flex-shrink-0 mt-0.5" />
            )}
            {status.type === 'error' && (
              <XCircle className="h-5 w-5 flex-shrink-0 mt-0.5" />
            )}
            {status.type === 'info' && (
              <Loader2 className="h-5 w-5 flex-shrink-0 mt-0.5 animate-spin" />
            )}
            <p className="text-sm">{status.message}</p>
          </div>
        )}

        <button
          type="submit"
          disabled={uploading}
          className="w-full flex justify-center items-center gap-2 px-4 py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {uploading ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" />
              Processing...
            </>
          ) : (
            <>
              <Upload className="h-5 w-5" />
              Upload & Process All Records
            </>
          )}
        </button>
      </form>

      <div className="mt-8 p-4 bg-gray-50 rounded-lg border border-gray-200">
        <h3 className="text-sm font-semibold text-gray-900 mb-2">
          How it works:
        </h3>
        <ol className="text-sm text-gray-600 space-y-1 list-decimal list-inside">
          <li>Upload your CSV file (instant)</li>
          <li>System analyzes and counts all records</li>
          <li>Processes in chunks of 5,000 records</li>
          <li>Progress bar shows real-time status</li>
          <li>All records inserted with vector embeddings</li>
        </ol>

        <div className="mt-4 pt-4 border-t border-gray-200">
          <h4 className="text-xs font-semibold text-gray-900 mb-1">Important:</h4>
          <p className="text-xs text-gray-600">
            Keep this page open during processing. For 467,000 records, expect ~6 hours total.
            Each chunk takes about 4 minutes.
          </p>
        </div>
      </div>
    </div>
  );
}