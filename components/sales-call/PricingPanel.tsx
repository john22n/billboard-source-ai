"use client";

import { DollarSign } from 'lucide-react';

interface PricingPanelProps {
  isLoading: boolean;
  billboardContext: string;
  hasTranscripts: boolean;
}

export function PricingPanel({ isLoading, billboardContext, hasTranscripts }: PricingPanelProps) {
  return (
    <div className="lg:col-span-1 h-full flex flex-col">
      <div className="bg-gradient-to-br from-slate-50 to-slate-100 rounded-xl p-3 border border-slate-200 shadow-inner h-full flex flex-col">
        {/* Header - More Compact */}
        <div className="flex items-center gap-2 mb-2 pb-2 border-b border-slate-200 flex-shrink-0">
          <div className="w-6 h-6 bg-primary rounded-lg flex items-center justify-center">
            <DollarSign className="w-4 h-4 text-white" />
          </div>
          <div>
            <h3 className="font-bold text-slate-800 text-xs">Billboard Pricing</h3>
            <p className="text-[10px] text-slate-500">Real-time pricing data</p>
          </div>
        </div>

        {/* Scrollable Content Area */}
        <div className="flex-1 overflow-y-auto pr-1">
          {isLoading && (
            <div className="flex flex-col items-center justify-center py-8">
              <div className="relative">
                <div className="w-10 h-10 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin"></div>
              </div>
              <p className="text-slate-600 font-medium mt-3 text-[10px] text-center">Loading pricing data...</p>
            </div>
          )}

          {!isLoading && billboardContext && (
            <div className="bg-white rounded-lg p-2.5 shadow-sm border border-slate-200">
              <div className="prose prose-sm max-w-none">
                <pre className="whitespace-pre-wrap font-sans text-slate-700 leading-relaxed text-[11px]">
{billboardContext}
                </pre>
              </div>
            </div>
          )}

          {!isLoading && !billboardContext && hasTranscripts && (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <div className="text-3xl mb-2">🔍</div>
              <p className="text-slate-500 font-medium text-[10px]">No pricing data yet</p>
              <p className="text-slate-400 text-[10px] mt-1">
                Data will appear when locations are mentioned
              </p>
            </div>
          )}

          {!hasTranscripts && (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <div className="text-3xl mb-2">📊</div>
              <p className="text-slate-400 text-[10px] font-medium">Pricing data will appear here</p>
              <p className="text-slate-300 text-[10px] mt-1">Start a conversation</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}