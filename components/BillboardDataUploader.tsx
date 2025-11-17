'use client';

// components/admin/BillboardDataUploader.tsx
import { useState } from 'react';
import { Upload, CheckCircle2, XCircle, Loader2 } from 'lucide-react';

export function BillboardDataUploader() {
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState<{
    type: 'success' | 'error' | 'info' | null;
    message: string;
  }>({ type: null, message: '' });
  const [progress, setProgress] = useState('');

  async function handleUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setUploading(true);
    setStatus({ type: 'info', message: 'Processing CSV file...' });
    setProgress('');

    const formData = new FormData(e.currentTarget);
    const file = formData.get('file');

    // Check if file exists
    if (!file || !(file instanceof File)) {
      setStatus({ type: 'error', message: 'Please select a file' });
      setUploading(false);
      return;
    }

    // Check if it's a CSV
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setStatus({ type: 'error', message: 'Please select a CSV file' });
      setUploading(false);
      return;
    }

    // Check file size (optional - max 100MB)
    if (file.size > 100 * 1024 * 1024) {
      setStatus({ type: 'error', message: 'File is too large (max 100MB)' });
      setUploading(false);
      return;
    }

    try {
      setProgress('Uploading and processing (this may take several minutes)...');
      
      const uploadFormData = new FormData();
      uploadFormData.append('file', file);
      
      const response = await fetch('/api/billboard-data/upload', {
        method: 'POST',
        body: uploadFormData,
      });

      const result = await response.json();

      if (response.ok && result.success) {
        setStatus({
          type: 'success',
          message: `Success! ${result.count} locations processed and vectorized.`,
        });
        // Reset form
        (e.target as HTMLFormElement).reset();
      } else {
        setStatus({
          type: 'error',
          message: result.error || 'Failed to process CSV',
        });
      }
    } catch (error) {
      console.error('Upload failed:', error);
      setStatus({
        type: 'error',
        message: 'Upload failed. Please try again.',
      });
    } finally {
      setUploading(false);
      setProgress('');
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
          <div className="mt-1 flex justify-center px-6 pt-5 pb-6 border-2 border-gray-300 border-dashed rounded-lg hover:border-gray-400 transition-colors">
            <div className="space-y-1 text-center">
              <Upload className="mx-auto h-12 w-12 text-gray-400" />
              <div className="flex text-sm text-gray-600">
                <label
                  htmlFor="file-upload"
                  className="relative cursor-pointer bg-white rounded-md font-medium text-blue-600 hover:text-blue-500 focus-within:outline-none"
                >
                  <span>Upload a file</span>
                  <input
                    id="file-upload"
                    name="file"
                    type="file"
                    accept=".csv,text/csv"
                    className="sr-only"
                    disabled={uploading}
                    required
                    onChange={(e) => {
                      // Validate file on change
                      const file = e.target.files?.[0];
                      if (file && !file.name.endsWith('.csv')) {
                        e.target.value = '';
                        setStatus({
                          type: 'error',
                          message: 'Please select a CSV file'
                        });
                      }
                    }}
                  />
                </label>
                <p className="pl-1">or drag and drop</p>
              </div>
              <p className="text-xs text-gray-500">CSV file only</p>
            </div>
          </div>
        </div>

        {progress && (
          <div className="flex items-center gap-2 text-sm text-blue-600">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>{progress}</span>
          </div>
        )}

        {status.type && (
          <div
            className={`p-4 rounded-lg flex items-start gap-3 ${
              status.type === 'success'
                ? 'bg-green-50 text-green-800'
                : status.type === 'error'
                ? 'bg-red-50 text-red-800'
                : 'bg-blue-50 text-blue-800'
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
              Upload & Vectorize
            </>
          )}
        </button>
      </form>

      <div className="mt-8 p-4 bg-gray-50 rounded-lg">
        <h3 className="text-sm font-semibold text-gray-900 mb-2">
          How it works:
        </h3>
        <ol className="text-sm text-gray-600 space-y-1 list-decimal list-inside">
          <li>Upload your billboard pricing CSV file</li>
          <li>System extracts location and pricing data</li>
          <li>Creates vector embeddings for semantic search</li>
          <li>Stores in database for instant RAG queries</li>
          <li>AI automatically retrieves pricing during transcriptions</li>
        </ol>
      </div>
    </div>
  );
}