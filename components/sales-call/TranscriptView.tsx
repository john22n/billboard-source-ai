"use client";

import { forwardRef } from "react";
import type { TranscriptItem } from "@/types/sales-call";

interface TranscriptViewProps {
  transcripts: TranscriptItem[];
  interimTranscript: string;
  interimSpeaker?: 'agent' | 'caller' | null;
  twilioReady: boolean;
}

export const TranscriptView = forwardRef<HTMLDivElement, TranscriptViewProps>(
  ({ transcripts, interimTranscript, interimSpeaker, twilioReady }, ref) => {
    const getSpeakerStyles = (speaker?: 'agent' | 'caller') => {
      if (speaker === 'agent') {
        return {
          bubble: 'bg-blue-50 border-blue-200',
          badge: 'bg-blue-500',
          label: 'Sales Rep',
        };
      }
      return {
        bubble: 'bg-white border-slate-200',
        badge: 'bg-emerald-500',
        label: 'Caller',
      };
    };

    return (
      <div
        ref={ref}
        className="bg-gradient-to-br from-slate-50 to-slate-100 rounded-xl p-4 h-full overflow-y-auto border border-slate-200 shadow-inner"
      >
        {transcripts.map((t) => {
          const styles = getSpeakerStyles(t.speaker);
          const isAgent = t.speaker === 'agent';
          
          return (
            <div 
              key={t.id} 
              className={`mb-3 last:mb-0 flex ${isAgent ? 'justify-end' : 'justify-start'}`}
            >
              <div className={`max-w-[85%] ${isAgent ? 'order-2' : ''}`}>
                <div className={`flex items-center gap-1.5 mb-1 ${isAgent ? 'justify-end' : ''}`}>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full text-white ${styles.badge}`}>
                    {styles.label}
                  </span>
                  <span className="text-xs text-slate-400">
                    {new Date(t.timestamp).toLocaleTimeString()}
                  </span>
                </div>
                <div className={`rounded-lg p-3 shadow-sm border ${styles.bubble}`}>
                  <p className="text-slate-800 leading-relaxed text-sm">{t.text}</p>
                </div>
              </div>
            </div>
          );
        })}
        
        {interimTranscript && (
          <div className={`mb-3 flex ${interimSpeaker === 'agent' ? 'justify-end' : 'justify-start'}`}>
            <div className="max-w-[85%]">
              <div className={`flex items-center gap-1.5 mb-1 ${interimSpeaker === 'agent' ? 'justify-end' : ''}`}>
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full text-white ${interimSpeaker === 'agent' ? 'bg-blue-400' : 'bg-emerald-400'}`}>
                  {interimSpeaker === 'agent' ? 'Sales Rep' : 'Caller'}
                  <span className="ml-1 animate-pulse">•••</span>
                </span>
              </div>
              <div className="bg-slate-100 rounded-lg p-3 border border-dashed border-slate-300">
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
