"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

interface PricingPanelProps {
  isLoading: boolean;
  billboardContext: string;
  hasTranscripts: boolean;
  onNutshellSubmit: () => Promise<void>;
  isSubmittingNutshell: boolean;
  nutshellStatus: 'idle' | 'success' | 'error';
  nutshellMessage: string;
}

interface PricingCard {
  market: string;
  type: 'market-range' | 'general-range' | 'avg-views';
  label: string;
  data: string[];
  note?: string;
  subtitle?: string;
  subtitleData?: string;
}

export function PricingPanel({ 
  isLoading, 
  billboardContext, 
  hasTranscripts,
  onNutshellSubmit,
  isSubmittingNutshell,
  nutshellStatus,
  nutshellMessage
}: PricingPanelProps) {
  const [activeTab, setActiveTab] = useState<'estimate' | 'details'>('estimate');

  // Parse pricing data from billboardContext
  const parsePricingData = (): PricingCard[] => {
    if (!billboardContext || billboardContext.trim() === '') return [];
    
    const cards: PricingCard[] = [];
    
    // Extract market name
    const marketMatch = billboardContext.match(/(?:Market|City|Location):\s*([A-Za-z\s]+)/i);
    const market = marketMatch ? marketMatch[1].trim() : 'Market';
    
    // Extract average daily views
    const avgViewsMatch = billboardContext.match(/Average\s*Daily\s*Views:\s*([\d,]+)/i);
    
    // Extract 4-week range
    const fourWeekMatch = billboardContext.match(/4-Week\s*Price\s*Range:\s*(\$[\d,]+\s*-\s*\$[\d,]+)/i);
    
    // Extract market range
    const marketRangeMatch = billboardContext.match(/Market\s*Range:\s*([^\n.]+)/i);
    
    // Extract general pricing
    const generalPricingMatch = billboardContext.match(/General\s*Pricing:\s*([^\n.]+)/i);
    
    // Create Avg Daily Views card if data exists
    if (avgViewsMatch && avgViewsMatch[1]) {
      const viewCount: string = avgViewsMatch[1];
      const priceRange: string = fourWeekMatch ? fourWeekMatch[1] : '$2,000-$6,000';
      
      cards.push({
        market,
        type: 'avg-views',
        label: 'Avg Daily Views',
        data: [viewCount],
        subtitle: '4-Wk Range',
        subtitleData: priceRange,
        note: '*Rates vary by location.'
      });
    }
    
    // Create Market Range card if data exists
    if (marketRangeMatch && marketRangeMatch[1]) {
      const marketData = marketRangeMatch[1].trim();
      cards.push({
        market,
        type: 'market-range',
        label: 'Market Range',
        data: [market, marketData],
        note: '*No city boards, but in market.'
      });
    }
    
    // Create General Range card if data exists
    if (generalPricingMatch && generalPricingMatch[1]) {
      // Try to split by commas or other delimiters
      const ranges = generalPricingMatch[1]
        .split(/[,|;]/)
        .map(r => r.trim())
        .filter(r => r.length > 0)
        .slice(0, 3); // Take up to 3 ranges
      
      if (ranges.length > 0) {
        cards.push({
          market,
          type: 'general-range',
          label: 'General Range',
          data: ranges,
          note: '*No data avail. Use range.'
        });
      }
    }
    
    return cards;
  };

  const pricingCards = parsePricingData();
  
  // Helper function to get card color scheme
  const getCardColors = (type: PricingCard['type']) => {
    switch (type) {
      case 'market-range':
        return { primary: '#7c3aed', text: '#7c3aed' }; // Purple
      case 'avg-views':
        return { primary: '#2563eb', text: '#2563eb' }; // Blue
      case 'general-range':
      default:
        return { primary: '#000000', text: '#000000' }; // Black
    }
  };

  return (
    <div 
      className="h-full flex flex-col transition-all duration-300"
      style={{ 
        maxWidth: activeTab === 'estimate' ? '400px' : '450px',
        width: '100%'
      }}
    >
      <div className="bg-white rounded-xl p-4 h-full flex flex-col overflow-hidden">
        {/* Header Tabs */}
        <div className="flex mb-1 flex-shrink-0 justify-center">
          <button 
            onClick={() => setActiveTab('estimate')}
            className={`px-4 py-2 border-black font-bold text-sm shadow-sm transition-colors ${
              activeTab === 'estimate' 
                ? 'bg-white text-black border-2' 
                : 'bg-white text-black border-b-2 hover:bg-gray-100'
            }`}
          >
            ESTIMATE
          </button>
          <button 
            onClick={() => setActiveTab('details')}
            className={`px-4 py-2 border-black font-bold text-sm shadow-sm transition-colors ${
              activeTab === 'details' 
                ? 'bg-white text-black border-2' 
                : 'bg-white text-black border-b-2 hover:bg-gray-100'
            }`}
          >
            DETAILS
          </button>
        </div>

        {/* Content Area - flex-1 makes it take remaining space and scroll */}
        <div className="flex-1 overflow-y-auto space-y-4 min-h-0">
          {/* ESTIMATE TAB CONTENT */}
          {activeTab === 'estimate' && (
            <>
              {isLoading && (
                <div className="flex flex-col items-center justify-center py-12">
                  <div className="relative">
                    <div className="w-12 h-12 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin"></div>
                  </div>
                  <p className="text-slate-600 font-medium mt-4 text-xs text-center">Loading pricing data...</p>
                </div>
              )}

              {!isLoading && pricingCards.length > 0 && pricingCards.map((card, index) => {
                const colors = getCardColors(card.type);
                
                return (
                  <div key={index} className="">
                    {/* Market Name Header */}
                    <div className="text-center py-3 border-b-2 border-black">
                      <h2 className="text-3xl font-bold" style={{ color: colors.text }}>
                        {card.market}
                      </h2>
                    </div>

                    {/* Label Header */}
                    <div 
                      className="text-center py-3 border-2 border-b-0 border-t-0 border-black  text-white font-bold text-xl"
                      style={{ backgroundColor: colors.primary }}
                    >
                      {card.label}
                    </div>

                    {/* Data Ranges */}
                    <div className="space-y-0">
                      {card.data.map((item, idx) => (
                        <div 
                          key={idx} 
                          className="text-center py-2 border-2 border-black font-bold text-3xl bg-white"
                          style={{ 
                            color: item.includes('$') ? colors.text : '#2563eb'
                          }}
                        >
                          {item}
                        </div>
                      ))}
                      
                      {/* Subtitle section for cards with additional range info */}
                      {card.subtitle && (
                        <>
                          <div 
                            className="text-center text-xl py-2 border-2 border-b-0 border-black text-white font-bold mt-3"
                            style={{ backgroundColor: colors.primary }}
                          >
                            {card.subtitle}
                          </div>
                          <div 
                            className="text-center text-3xl py-5 border-2 border-black font-bold bg-white"
                            style={{ color: colors.text }}
                          >
                            {card.subtitleData}
                          </div>
                        </>
                      )}
                    </div>

                    {/* Note */}
                    {card.note && (
                      <div className="px-3 pt-2 pb-3 text-center">
                        <p className="text-xs italic font-medium" style={{ color: colors.text }}>
                          {card.note}
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}

              {!isLoading && billboardContext && pricingCards.length === 0 && (
                <div className="bg-white rounded-lg p-4 shadow-sm border border-slate-200">
                  <div className="prose prose-sm max-w-none">
                    <pre className="whitespace-pre-wrap font-sans text-slate-700 leading-relaxed text-xs">
                      {billboardContext}
                    </pre>
                  </div>
                </div>
              )}

              {!isLoading && !billboardContext && hasTranscripts && (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <div className="text-4xl mb-2">🔍</div>
                  <p className="text-slate-500 font-medium text-xs">No pricing data yet</p>
                  <p className="text-slate-400 text-xs mt-1">
                    Data will appear when locations are mentioned
                  </p>
                </div>
              )}

              {!hasTranscripts && (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <div className="text-4xl mb-2">📊</div>
                  <p className="text-slate-400 text-xs font-medium">Pricing data will appear here</p>
                  <p className="text-slate-300 text-xs mt-1">Start a conversation</p>
                </div>
              )}
            </>
          )}

          {/* DETAILS TAB CONTENT */}
          {activeTab === 'details' && (
            <div className="bg-white rounded-lg p-1">
              <h3 className="text-lg font-bold mb-2">Pricing Details</h3>
              {billboardContext ? (
                <div className="prose prose-sm max-w-none">
                  <pre className="whitespace-pre-wrap font-sans text-slate-700 leading-relaxed text-xs">
                    {billboardContext}
                  </pre>
                </div>
              ) : (
                <div className="text-center py-8">
                  <div className="text-4xl mb-2">📋</div>
                  <p className="text-slate-500 text-sm">No details available yet</p>
                  <p className="text-slate-400 text-xs mt-1">
                    Detailed information will appear when pricing data is loaded
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Nutshell Button at Bottom */}
        <div className="flex flex-col items-center gap-2 pt-3 border-t border-slate-200 mt-3 flex-shrink-0">
          {nutshellStatus !== 'idle' && (
            <span className={`text-xs font-medium ${nutshellStatus === 'success' ? 'text-green-600' : 'text-red-600'}`}>
              {nutshellMessage}
            </span>
          )}
          <Button
            onClick={onNutshellSubmit}
            disabled={isSubmittingNutshell}
            className="bg-orange-500 hover:bg-orange-600 text-white font-semibold shadow-lg hover:shadow-xl transition-all duration-200 h-9 px-6"
          >
            {isSubmittingNutshell ? 'Submitting...' : 'Nutshell'}
          </Button>
        </div>
      </div>
    </div>
  );
}