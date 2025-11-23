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
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  async function handleUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setUploading(true);
    setStatus({ type: 'info', message: 'Starting upload...' });
    setProgress('');

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
      setStatus({ type: 'info', message: 'Uploading file to cloud storage...' });

      const blob = await upload(file.name, file, {
        access: 'public',
        handleUploadUrl: '/api/billboard-data/upload-blob',
      });

      console.log('✅ File uploaded to blob:', blob.url);

      // Step 2: Trigger background processing
      setProgress('Starting background processing...');
      setStatus({ type: 'info', message: 'Starting background processing...' });

      const response = await fetch('/api/billboard-data/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blobUrl: blob.url }),
      });

      const result = await response.json();

      if (response.ok && result.success) {
        setStatus({
          type: 'success',
          message: result.message,
        });
        setProgress('');
        setSelectedFile(null);
        (e.target as HTMLFormElement).reset();
      } else {
        setStatus({
          type: 'error',
          message: result.error || result.details || 'Failed to start processing',
        });
        setProgress('');
      }
    } catch (error) {
      console.error('Upload failed:', error);
      setStatus({
        type: 'error',
        message: error instanceof Error ? error.message : 'Upload failed. Please try again.',
      });
      setProgress('');
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
          Upload your billboard pricing CSV to enable location-based pricing intelligence
          during sales call transcription.
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
          <div className="flex items-center gap-2 text-sm text-blue-600 bg-blue-50 p-3 rounded-lg">
            <Loader2 className="h-4 w-4 animate-spin flex-shrink-0" />
            <span>{progress}</span>
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
              Upload & Process
            </>
          )}
        </button>
      </form>

      <div className="mt-8 p-4 bg-gray-50 rounded-lg border border-gray-200">
        <h3 className="text-sm font-semibold text-gray-900 mb-2">
          How it works:
        </h3>
        <ol className="text-sm text-gray-600 space-y-1 list-decimal list-inside">
          <li>Upload your billboard pricing CSV file (up to 500MB)</li>
          <li>File is securely stored in cloud storage</li>
          <li>Background job starts processing immediately</li>
          <li>System generates embeddings in batches</li>
          <li>Data is stored in database for instant RAG queries</li>
          <li>You can close this page - processing continues</li>
        </ol>

        <div className="mt-4 pt-4 border-t border-gray-200">
          <h4 className="text-xs font-semibold text-gray-900 mb-1">Note:</h4>
          <p className="text-xs text-gray-600">
            Large files (400,000+ rows) will take 15-30 minutes to process.
            Check your Vercel deployment logs to monitor progress.
          </p>
        </div>
      </div>
    </div>
  );
}