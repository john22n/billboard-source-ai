"use client";

import { forwardRef } from "react";
import type { TranscriptItem } from "@/types/sales-call";

interface TranscriptViewProps {
  transcripts: TranscriptItem[];
  interimTranscript: string;
  twilioReady: boolean;
}

export const TranscriptView = forwardRef<HTMLDivElement, TranscriptViewProps>(
  ({ transcripts, interimTranscript, twilioReady }, ref) => {
    return (
      <div
        ref={ref}
        className="bg-gradient-to-br from-slate-50 to-slate-100 rounded-xl p-4 h-full overflow-y-auto border border-slate-200 shadow-inner"
      >
        {transcripts.map((t, index) => (
          <div key={t.id} className="mb-2 last:mb-0">
            <div className="flex items-start gap-2">
              <div className="flex-shrink-0 w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center text-white font-bold text-xs">
                {index + 1}
              </div>
              <div className="flex-1 bg-white rounded-lg p-3 shadow-sm border border-slate-200">
                <p className="text-slate-800 leading-relaxed text-sm">{t.text}</p>
                <p className="text-xs text-slate-400 mt-1">
                  {new Date(t.timestamp).toLocaleTimeString()}
                </p>
              </div>
            </div>
          </div>
        ))}
        {interimTranscript && (
          <div className="mb-2">
            <div className="flex items-start gap-2">
              <div className="flex-shrink-0 w-6 h-6 bg-slate-300 rounded-full flex items-center justify-center">
                <span className="animate-pulse text-white text-xs">•••</span>
              </div>
              <div className="flex-1 bg-slate-100 rounded-lg p-3 border border-dashed border-slate-300">
                <p className="text-slate-600 italic leading-relaxed text-sm">{interimTranscript}</p>
              </div>
            </div>
          </div>
        )}
        {transcripts.length === 0 && !interimTranscript && (
          <div className="flex flex-col items-center justify-center h-full text-center py-16">
            <div className="text-5xl mb-3">🎤</div>
            <p className="text-slate-400 text-base font-medium">
              {twilioReady ? "Waiting for incoming call..." : "Transcript will appear here..."}
            </p>
            <p className="text-slate-300 text-sm mt-1">
              {twilioReady ? "Accept a call to start transcribing" : "Upload an audio file to transcribe"}
            </p>
          </div>
        )}
      </div>
    );
  }
);

TranscriptView.displayName = "TranscriptView";
