"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import type { BillboardFormData } from "@/hooks/useBillboardFormExtraction";
import type { MarketData } from "@/components/sales-call/LeadForm";

interface PricingPanelProps {
  isLoading: boolean;
  billboardContext: string;
  hasTranscripts: boolean;
  onNutshellSubmit: () => Promise<void>;
  isSubmittingNutshell: boolean;
  nutshellStatus: 'idle' | 'success' | 'error';
  nutshellMessage: string;
  activeMarketIndex: number;
  formData: BillboardFormData;
  additionalMarkets: MarketData[];
  fullTranscript: string;
  setIsLoadingBillboard: (loading: boolean) => void;
  setBillboardContext: (context: string) => void;
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
  nutshellMessage,
  activeMarketIndex,
  formData,
  additionalMarkets,
  fullTranscript,
  setIsLoadingBillboard,
  setBillboardContext
}: PricingPanelProps) {
  const [activeTab, setActiveTab] = useState<'estimate' | 'details'>('estimate');
  
  // ✅ Use our own loading state, independent of parent
  const [isLoadingMarket, setIsLoadingMarket] = useState(false);
  
  // ✅ Store pricing context PER MARKET - keyed by market index
  const [marketContexts, setMarketContexts] = useState<Record<number, string>>({});
  
  // ✅ Track what location we last fetched for each market
  const lastFetchedLocations = useRef<Record<number, string>>({});
  
  // ✅ Debounce timeout ref
  const fetchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Calculate current location from props
  const getCurrentLocation = (): string => {
    if (activeMarketIndex === 0) {
      const city = formData.targetCity?.trim() || "";
      const state = formData.state?.trim() || "";
      if (city && state) return `${city}, ${state}`;
      return formData.targetArea?.trim() || "";
    } else {
      const market = additionalMarkets[activeMarketIndex - 1];
      if (!market) return "";
      const city = market.targetCity?.trim() || "";
      const state = market.state?.trim() || "";
      if (city && state) return `${city}, ${state}`;
      return market.targetArea?.trim() || "";
    }
  };

  const currentLocation = getCurrentLocation();
  const currentMarketContext = marketContexts[activeMarketIndex] || "";

  // ✅ Fetch pricing - completely self-contained
  const fetchPricingForMarket = async (location: string, marketIdx: number) => {
    if (!location || location.length < 3) return;
    
    // Skip if already fetched this location for this market
    if (lastFetchedLocations.current[marketIdx] === location) {
      console.log(`✅ Already fetched for Market #${marketIdx + 1}: ${location}`);
      return;
    }

    console.log(`🌐 FETCHING for Market #${marketIdx + 1}: ${location}`);
    
    setIsLoadingMarket(true);
    // Only set parent loading for primary market
    if (marketIdx === 0) {
      setIsLoadingBillboard(true);
    }

    try {
      const transcript = `The customer is interested in billboard advertising in ${location}.`;
      
      const response = await fetch('/api/billboard-pricing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.context) {
          console.log(`✅ Got data for Market #${marketIdx + 1}: ${location}`);
          
          // Store the context for this market
          setMarketContexts(prev => ({ ...prev, [marketIdx]: data.context }));
          lastFetchedLocations.current[marketIdx] = location;
          
          // Update parent context only for primary market
          if (marketIdx === 0) {
            setBillboardContext(data.context);
          }
        } else {
          setMarketContexts(prev => ({ ...prev, [marketIdx]: "" }));
        }
      }
    } catch (error) {
      console.error("Fetch error:", error);
      setMarketContexts(prev => ({ ...prev, [marketIdx]: "" }));
    } finally {
      setIsLoadingMarket(false);
      if (marketIdx === 0) {
        setIsLoadingBillboard(false);
      }
    }
  };

  // ✅ Sync billboardContext from parent ONLY for primary market when we don't have our own
  useEffect(() => {
    if (activeMarketIndex === 0 && billboardContext && !marketContexts[0]) {
      console.log("📥 Syncing billboardContext from parent for MKT #1");
      setMarketContexts(prev => ({ ...prev, 0: billboardContext }));
      // Also mark as fetched based on formData location
      const loc = getCurrentLocation();
      if (loc) {
        lastFetchedLocations.current[0] = loc;
      }
    }
  }, [billboardContext, activeMarketIndex]);

  // ✅ MAIN EFFECT: Watch for location changes and fetch
  // Use JSON.stringify to detect deep changes in additionalMarkets
  const additionalMarketsJson = JSON.stringify(
    additionalMarkets.map(m => ({ city: m.targetCity, state: m.state, area: m.targetArea }))
  );

  useEffect(() => {
    const location = getCurrentLocation();
    
    console.log(`🔍 Effect check - Market #${activeMarketIndex + 1}, location: "${location}"`);

    // Clear any pending timeout
    if (fetchTimeoutRef.current) {
      clearTimeout(fetchTimeoutRef.current);
      fetchTimeoutRef.current = null;
    }

    // If no location, clear context for this market
    if (!location) {
      setMarketContexts(prev => ({ ...prev, [activeMarketIndex]: "" }));
      delete lastFetchedLocations.current[activeMarketIndex];
      return;
    }

    // Check if we need to fetch
    const alreadyFetched = lastFetchedLocations.current[activeMarketIndex] === location;
    const hasContext = !!marketContexts[activeMarketIndex];

    console.log(`   alreadyFetched: ${alreadyFetched}, hasContext: ${hasContext}`);

    if (!alreadyFetched) {
      // Debounce the fetch
      console.log(`⏱️ Scheduling fetch for Market #${activeMarketIndex + 1}: ${location}`);
      fetchTimeoutRef.current = setTimeout(() => {
        fetchPricingForMarket(location, activeMarketIndex);
      }, 800);
    }

    return () => {
      if (fetchTimeoutRef.current) {
        clearTimeout(fetchTimeoutRef.current);
      }
    };
  }, [
    activeMarketIndex,
    formData.targetCity,
    formData.state,
    formData.targetArea,
    additionalMarketsJson
  ]);

  // Parse functions
  const parseContextForDetails = (context: string) => {
    if (!context) return [];
    const results: { label: string; value: string }[] = [];
    const lines = context.split('\n');
    let currentLabel = '';
    let currentValue = '';
    
    for (const line of lines) {
      const colonIndex = line.indexOf(':');
      if (colonIndex > 0 && colonIndex < 30) {
        if (currentLabel) {
          results.push({ label: currentLabel, value: currentValue.trim() });
        }
        currentLabel = line.substring(0, colonIndex + 1);
        currentValue = line.substring(colonIndex + 1).trim();
      } else if (currentLabel && line.trim()) {
        currentValue += ' ' + line.trim();
      }
    }
    if (currentLabel) {
      results.push({ label: currentLabel, value: currentValue.trim() });
    }
    return results;
  };

  const parsePricingData = (): PricingCard[] => {
    const contextToUse = currentMarketContext;
    if (!contextToUse?.trim()) return [];
    
    const cards: PricingCard[] = [];
    
    const avgViewsMatch = contextToUse.match(/Average\s*Daily\s*Views:\s*([\d,]+)/i);
    const fourWeekMatch = contextToUse.match(/4-Week\s*Price\s*Range:\s*(\$[\d,]+\s*-\s*\$[\d,]+)/i);
    const marketRangeMatch = contextToUse.match(/Market\s*Range:\s*([^\n.]+)/i);
    const hasGeneralPricing = /General\s*Pricing:/i.test(contextToUse);
    
    // PRIORITY 1: BLUE - has Average Daily Views
    if (avgViewsMatch?.[1]) {
      cards.push({
        market: currentLocation || 'Market',
        type: 'avg-views',
        label: 'Avg Daily Views',
        data: [avgViewsMatch[1]],
        subtitle: '4-Wk Range',
        subtitleData: fourWeekMatch?.[1] || '$2,000-$6,000',
        note: '*Rates vary by location.'
      });
    }
    // PRIORITY 2: BLACK - has General Pricing
    else if (hasGeneralPricing) {
      const priceRangePattern = /\$[\d,]+\s*-\s*\$[\d,]+/g;
      const generalPricingIndex = contextToUse.toLowerCase().indexOf('general pricing:');
      const textAfterGeneral = contextToUse.substring(generalPricingIndex);
      const rangesAfterGeneral = textAfterGeneral.match(priceRangePattern);
      const generalRanges = rangesAfterGeneral ? [...new Set(rangesAfterGeneral)] : [];
      
      cards.push({
        market: currentLocation || 'Market',
        type: 'general-range',
        label: 'General Range',
        data: generalRanges.length > 0 ? generalRanges.slice(0, 5) : ['$750 - $6,000'],
        note: '*No specific data. Use general range.'
      });
    }
    // PRIORITY 3: PURPLE - has Market Range
    else if (marketRangeMatch?.[1]) {
      cards.push({
        market: currentLocation || 'Market',
        type: 'market-range',
        label: 'Market Range',
        data: [marketRangeMatch[1].trim()],
        note: '*No city boards, but in market.'
      });
    }
    
    return cards;
  };

  const pricingCards = parsePricingData();
  const parsedDetails = parseContextForDetails(currentMarketContext);
  
  const getCardColors = (type: PricingCard['type']) => {
    switch (type) {
      case 'market-range': return { primary: '#7c3aed', text: '#7c3aed' };
      case 'avg-views': return { primary: '#2563eb', text: '#2563eb' };
      default: return { primary: '#000000', text: '#000000' };
    }
  };

  // ✅ Use our own loading state, not parent's
  const isLoadingData = isLoadingMarket;

  return (
    <div 
      className="h-full flex flex-col transition-all duration-300"
      style={{ maxWidth: activeTab === 'estimate' ? '400px' : '450px', width: '100%' }}
    >
      <div className="bg-white rounded-xl p-4 h-full flex flex-col overflow-hidden">
        {/* Header Tabs */}
        <div className="flex mb-3 flex-shrink-0 justify-center">
          <button 
            onClick={() => setActiveTab('estimate')}
            className={`px-4 py-2 border-black font-bold text-sm shadow-sm transition-colors ${
              activeTab === 'estimate' ? 'bg-white text-black border-2' : 'bg-white text-black border-b-2 hover:bg-gray-100'
            }`}
          >
            ESTIMATE
          </button>
          <button 
            onClick={() => setActiveTab('details')}
            className={`px-4 py-2 border-black font-bold text-sm shadow-sm transition-colors ${
              activeTab === 'details' ? 'bg-white text-black border-2' : 'bg-white text-black border-b-2 hover:bg-gray-100'
            }`}
          >
            DETAILS
          </button>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto space-y-4 min-h-0">
          {activeTab === 'estimate' && (
            <>
              {isLoadingData && (
                <div className="flex flex-col items-center justify-center py-12">
                  <div className="w-12 h-12 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin"></div>
                  <p className="text-slate-600 font-medium mt-4 text-xs text-center">Loading pricing data...</p>
                </div>
              )}

              {!isLoadingData && pricingCards.map((card, index) => {
                const colors = getCardColors(card.type);
                return (
                  <div key={index}>
                    <div className="text-center py-3 border-b-2 border-black">
                      <h2 className="text-3xl font-bold" style={{ color: colors.text }}>{card.market}</h2>
                    </div>
                    <div className="text-center py-3 border-l-2 border-r-2 border-black text-white font-bold text-xl" style={{ backgroundColor: colors.primary }}>
                      {card.label}
                    </div>
                    {card.data.map((item, idx) => (
                      <div key={idx} className="text-center py-3 border-2 border-t-0 border-black font-bold text-2xl bg-white" style={{ color: colors.text }}>
                        {item}
                      </div>
                    ))}
                    {card.subtitle && (
                      <>
                        <div className="text-center text-xl py-2 border-l-2 border-r-2 border-black text-white font-bold mt-3" style={{ backgroundColor: colors.primary }}>
                          {card.subtitle}
                        </div>
                        <div className="text-center text-3xl py-5 border-2 border-t-0 border-black font-bold bg-white" style={{ color: colors.text }}>
                          {card.subtitleData}
                        </div>
                      </>
                    )}
                    {card.note && (
                      <div className="px-3 pt-2 pb-3 text-center">
                        <p className="text-xs italic font-medium" style={{ color: colors.text }}>{card.note}</p>
                      </div>
                    )}
                  </div>
                );
              })}

              {!isLoadingData && currentMarketContext && pricingCards.length === 0 && (
                <div className="bg-white rounded-lg p-4 shadow-sm border border-slate-200">
                  <pre className="whitespace-pre-wrap font-sans text-slate-700 leading-relaxed text-xs">{currentMarketContext}</pre>
                </div>
              )}

              {!isLoadingData && !currentMarketContext && currentLocation && (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <div className="text-4xl mb-2">🔍</div>
                  <p className="text-slate-500 font-medium text-xs">No pricing data found</p>
                  <p className="text-slate-400 text-xs mt-1">for {currentLocation}</p>
                </div>
              )}

              {!isLoadingData && !currentMarketContext && !currentLocation && (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <div className="text-4xl mb-2">📊</div>
                  <p className="text-slate-400 text-xs font-medium">Enter a city and state</p>
                  <p className="text-slate-300 text-xs mt-1">Pricing will auto-load as you type</p>
                </div>
              )}
            </>
          )}

          {activeTab === 'details' && (
            <div className="bg-white rounded-lg p-3">
              <h3 className="text-2xl font-black text-slate-800 mb-3 border-b-2 border-slate-200 pb-2">Pricing Details</h3>
              {parsedDetails.length > 0 ? (
                <div className="space-y-2">
                  {parsedDetails.map((field, idx) => (
                    <div key={idx} className="py-1.5 border-b border-slate-100 last:border-b-0">
                      <span className="font-bold text-slate-800 text-sm">{field.label}</span>
                      <span className="font-semibold text-blue-600 text-sm ml-1">{field.value}</span>
                    </div>
                  ))}
                </div>
              ) : currentMarketContext ? (
                <p className="font-medium text-slate-700 text-sm leading-relaxed">{currentMarketContext.replace(/\n+/g, ' ').trim()}</p>
              ) : (
                <div className="text-center py-8">
                  <div className="text-4xl mb-2">📋</div>
                  <p className="text-slate-500 text-sm font-medium">No details available yet</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Nutshell Button */}
        <div className="flex flex-col items-center gap-2 pt-3 border-t border-slate-200 mt-3 flex-shrink-0">
          {nutshellStatus !== 'idle' && (
            <span className={`text-xs font-medium ${nutshellStatus === 'success' ? 'text-green-600' : 'text-red-600'}`}>{nutshellMessage}</span>
          )}
          <Button onClick={onNutshellSubmit} disabled={isSubmittingNutshell} className="bg-orange-500 hover:bg-orange-600 text-white font-semibold shadow-lg hover:shadow-xl transition-all duration-200 h-9 px-6">
            {isSubmittingNutshell ? 'Submitting...' : 'Nutshell'}
          </Button>
        </div>
      </div>
    </div>
  );
}