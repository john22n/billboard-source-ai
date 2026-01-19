"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { useFormStore } from "@/stores/formStore";
import { ChevronDown, ChevronUp } from "lucide-react";

interface PricingPanelProps {
  isLoading: boolean;
  billboardContext: string;
  hasTranscripts: boolean;
  onNutshellSubmit: () => Promise<void>;
  isSubmittingNutshell: boolean;
  nutshellStatus: 'idle' | 'success' | 'error';
  nutshellMessage: string;
  fullTranscript: string;
  setIsLoadingBillboard: (loading: boolean) => void;
  setBillboardContext: (context: string) => void;
}

interface PricingCard {
  market: string;
  type: 'market-range' | 'general-range' | 'avg-views' | 'four-week-only';
  label: string;
  data: string[];
  note?: string;
  subtitle?: string;
  subtitleData?: string;
  tiers?: { label: string; range: string }[];
}

export function PricingPanel({
  isLoading,
  billboardContext,
  hasTranscripts,
  onNutshellSubmit,
  isSubmittingNutshell,
  nutshellStatus,
  nutshellMessage,
  fullTranscript,
  setIsLoadingBillboard,
  setBillboardContext
}: PricingPanelProps) {
  // ✅ Subscribe directly to only the fields we need from the store
  const activeMarketIndex = useFormStore((s) => s.activeMarketIndex);
  const additionalMarkets = useFormStore((s) => s.additionalMarkets);
  const targetCity = useFormStore((s) => s.fields.targetCity);
  const state = useFormStore((s) => s.fields.state);
  const targetArea = useFormStore((s) => s.fields.targetArea);

  const [activeTab, setActiveTab] = useState<'estimate' | 'details'>('estimate');
  
  // ✅ Collapsible state for mobile - starts collapsed
  const [isCollapsed, setIsCollapsed] = useState(true);

  // ✅ Use our own loading state, independent of parent
  const [isLoadingMarket, setIsLoadingMarket] = useState(false);

  // ✅ Store pricing context PER MARKET - keyed by market index
  const [marketContexts, setMarketContexts] = useState<Record<number, string>>({});

  // ✅ Track what location we last fetched for each market
  const lastFetchedLocations = useRef<Record<number, string>>({});

  // ✅ Debounce timeout ref
  const fetchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Calculate current location from store state
  const getCurrentLocation = (): string => {
    if (activeMarketIndex === 0) {
      const city = targetCity?.trim() || "";
      const stateVal = state?.trim() || "";
      if (city && stateVal) return `${city}, ${stateVal}`;
      return targetArea?.trim() || "";
    } else {
      const market = additionalMarkets[activeMarketIndex - 1];
      if (!market) return "";
      const city = market.targetCity?.trim() || "";
      const stateVal = market.state?.trim() || "";
      if (city && stateVal) return `${city}, ${stateVal}`;
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
    targetCity,
    state,
    targetArea,
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
    
    const marketNameMatch = contextToUse.match(/Market(?:\s*Name)?:\s*([^,\n]+)/i);
    const dbMarketName = marketNameMatch?.[1]?.trim() || '';
    
    // PRIORITY 1: BLUE - has BOTH Average Daily Views AND 4-Week Range
    if (avgViewsMatch?.[1] && fourWeekMatch?.[1]) {
      cards.push({
        market: currentLocation || 'Market',
        type: 'avg-views',
        label: 'Avg Daily Views',
        data: [avgViewsMatch[1]],
        subtitle: '4-Wk Range',
        subtitleData: fourWeekMatch[1],
        note: '*Rates vary by location.'
      });
    }
    // PRIORITY 2: GREEN - has 4-Week Range only (no avg views)
    else if (fourWeekMatch?.[1]) {
      cards.push({
        market: currentLocation || 'Market',
        type: 'four-week-only',
        label: '4-Week Range',
        data: [fourWeekMatch[1]],
        note: '*Rates vary by location.'
      });
    }
    // PRIORITY 3: PURPLE - has Market Range
    else if (marketRangeMatch?.[1]) {
      cards.push({
        market: currentLocation || 'Market',
        type: 'market-range',
        label: 'Market Range',
        data: [marketRangeMatch[1].trim()],
        subtitle: dbMarketName || undefined,
        note: '*No city boards, but in market.'
      });
    }
    // PRIORITY 4: BLACK - has General Pricing with market size tiers
    else if (hasGeneralPricing) {
      const priceRangePattern = /\$[\d,]+\s*-\s*\$[\d,]+/g;
      const generalPricingIndex = contextToUse.toLowerCase().indexOf('general pricing:');
      const textAfterGeneral = contextToUse.substring(generalPricingIndex);
      const rangesAfterGeneral = textAfterGeneral.match(priceRangePattern);
      const generalRanges = rangesAfterGeneral ? [...new Set(rangesAfterGeneral)] : [];
      
      const tierLabels = ['Small Market', 'Medium Market', 'Large Market'];
      const tiers: { label: string; range: string }[] = [];
      
      if (generalRanges.length >= 3) {
        tiers.push({ label: tierLabels[0], range: generalRanges[0] });
        tiers.push({ label: tierLabels[1], range: generalRanges[1] });
        tiers.push({ label: tierLabels[2], range: generalRanges[2] });
      } else if (generalRanges.length === 2) {
        tiers.push({ label: tierLabels[0], range: generalRanges[0] });
        tiers.push({ label: tierLabels[2], range: generalRanges[1] });
      } else if (generalRanges.length === 1) {
        tiers.push({ label: 'Price Range', range: generalRanges[0] });
      }
      
      cards.push({
        market: currentLocation || 'Market',
        type: 'general-range',
        label: 'General Range',
        data: generalRanges.length === 0 ? ['$750 - $6,000'] : [],
        tiers: tiers.length > 0 ? tiers : undefined,
        note: '*No specific data. Use general range.'
      });
    }
    
    return cards;
  };

  const pricingCards = parsePricingData();
  const parsedDetails = parseContextForDetails(currentMarketContext);
  
  const getCardColors = (type: PricingCard['type']) => {
    switch (type) {
      case 'avg-views': return { primary: '#2563eb', text: '#2563eb' };
      case 'four-week-only': return { primary: '#16a34a', text: '#16a34a' };
      case 'market-range': return { primary: '#7c3aed', text: '#7c3aed' };
      case 'general-range': return { primary: '#000000', text: '#000000' };
      default: return { primary: '#000000', text: '#000000' };
    }
  };

  const isLoadingData = isLoadingMarket;

  // Get a preview of the pricing for collapsed state
  const getPricingPreview = () => {
    if (isLoadingData) return "Loading...";
    if (pricingCards.length > 0) {
      const card = pricingCards[0];
      if (card.subtitleData) return card.subtitleData;
      if (card.data.length > 0) return card.data[0];
      if (card.tiers && card.tiers.length > 0) return card.tiers[0].range;
    }
    if (currentLocation) return "No data";
    return "Enter location";
  };

  return (
    <div className={`
      flex flex-col transition-all duration-300 w-full 
      xl:w-[400px] xl:flex-shrink-0 xl:h-full
      ${isCollapsed ? 'flex-shrink-0' : 'min-h-[350px] sm:min-h-[400px]'}
      xl:min-h-0 overflow-visible xl:overflow-hidden
    `}>
      {/* Mobile Collapsible Header - Only shows on mobile/tablet */}
      <button
        onClick={() => setIsCollapsed(!isCollapsed)}
        className="xl:hidden flex items-center justify-between w-full py-3 px-4 bg-gradient-to-r from-orange-500 to-indigo-600 text-white rounded-lg shadow-md active:scale-[0.98] transition-transform"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-lg flex-shrink-0">💰</span>
          <span className="font-bold text-sm flex-shrink-0">Pricing</span>
          {currentLocation && (
            <span className="text-xs opacity-80 truncate">
              • {currentLocation}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-xs font-bold bg-white/20 px-2 py-0.5 rounded whitespace-nowrap">
            {getPricingPreview()}
          </span>
          {isCollapsed ? (
            <ChevronDown className="w-5 h-5" />
          ) : (
            <ChevronUp className="w-5 h-5" />
          )}
        </div>
      </button>

      {/* Content Container - Hidden when collapsed on mobile, always visible on xl+ */}
      <div className={`
        bg-white rounded-xl p-3 sm:p-4 flex flex-col min-h-0 overflow-hidden
        ${isCollapsed ? 'hidden xl:flex xl:h-full' : 'flex flex-1 mt-2 xl:mt-0 max-h-[60vh] xl:max-h-none'}
        xl:rounded-xl
      `}>
        {/* Header Tabs */}
        <div className="flex mb-3 flex-shrink-0 justify-center">
          <button 
            onClick={() => setActiveTab('estimate')}
            className={`px-3 sm:px-4 py-1.5 sm:py-2 border-black font-bold text-xs sm:text-sm shadow-sm transition-colors ${
              activeTab === 'estimate' ? 'bg-white text-black border-2' : 'bg-white text-black border-b-2 hover:bg-gray-100'
            }`}
          >
            ESTIMATE
          </button>
          <button 
            onClick={() => setActiveTab('details')}
            className={`px-3 sm:px-4 py-1.5 sm:py-2 border-black font-bold text-xs sm:text-sm shadow-sm transition-colors ${
              activeTab === 'details' ? 'bg-white text-black border-2' : 'bg-white text-black border-b-2 hover:bg-gray-100'
            }`}
          >
            DETAILS
          </button>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto min-h-0 space-y-3 sm:space-y-4">
          {activeTab === 'estimate' && (
            <>
              {isLoadingData && (
                <div className="flex flex-col items-center justify-center py-6 sm:py-12">
                  <div className="w-8 h-8 sm:w-12 sm:h-12 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin"></div>
                  <p className="text-slate-600 font-medium mt-2 sm:mt-4 text-xs text-center">Loading pricing data...</p>
                </div>
              )}

              {!isLoadingData && pricingCards.map((card, index) => {
                const colors = getCardColors(card.type);
                return (
                  <div key={index}>
                    <div className="text-center py-2 sm:py-3 border-b-2 border-black">
                      <h2 className="text-lg sm:text-2xl xl:text-3xl font-bold" style={{ color: colors.text }}>{card.market}</h2>
                    </div>
                    <div className="text-center py-1.5 sm:py-3 border-l-2 border-r-2 border-black text-white font-bold text-sm sm:text-lg xl:text-xl" style={{ backgroundColor: colors.primary }}>
                      {card.label}
                    </div>
                    
                    {card.type === 'market-range' && card.subtitle && (
                      <div 
                        className="text-center py-1 sm:py-2 border-l-2 border-r-2 border-b-2 border-black font-bold text-sm sm:text-lg xl:text-xl bg-white"
                        style={{ color: colors.text }}
                      >
                        {card.subtitle}
                      </div>
                    )}
                    
                    {card.tiers && card.tiers.map((tier, tierIdx) => (
                      <div key={tierIdx}>
                        <div 
                          className="text-center py-1 sm:py-2 border-l-2 border-r-2 border-black font-semibold text-xs sm:text-sm"
                          style={{ backgroundColor: '#f3f4f6', color: colors.text }}
                        >
                          {tier.label}
                        </div>
                        <div 
                          className="text-center py-1.5 sm:py-3 border-2 border-t-0 border-black font-bold text-base sm:text-xl xl:text-2xl bg-white"
                          style={{ color: colors.text }}
                        >
                          {tier.range}
                        </div>
                      </div>
                    ))}
                    
                    {!card.tiers && card.data.map((item, idx) => (
                      <div key={idx} className="text-center py-1.5 sm:py-3 border-2 border-t-0 border-black font-bold text-base sm:text-xl xl:text-2xl bg-white" style={{ color: colors.text }}>
                        {item}
                      </div>
                    ))}
                    
                    {card.type === 'avg-views' && card.subtitle && (
                      <>
                        <div className="text-center text-sm sm:text-lg xl:text-xl py-1 sm:py-2 border-l-2 border-r-2 border-black text-white font-bold mt-1.5 sm:mt-3" style={{ backgroundColor: colors.primary }}>
                          {card.subtitle}
                        </div>
                        <div className="text-center text-lg sm:text-2xl xl:text-3xl py-2 sm:py-5 border-2 border-t-0 border-black font-bold bg-white" style={{ color: colors.text }}>
                          {card.subtitleData}
                        </div>
                      </>
                    )}
                    {card.note && (
                      <div className="px-2 sm:px-3 pt-1 sm:pt-2 pb-1.5 sm:pb-3 text-center">
                        <p className="text-[9px] sm:text-xs italic font-medium" style={{ color: colors.text }}>{card.note}</p>
                      </div>
                    )}
                  </div>
                );
              })}

              {!isLoadingData && currentMarketContext && pricingCards.length === 0 && (
                <div className="bg-white rounded-lg p-3 sm:p-4 shadow-sm border border-slate-200">
                  <pre className="whitespace-pre-wrap font-sans text-slate-700 leading-relaxed text-[10px] sm:text-xs">{currentMarketContext}</pre>
                </div>
              )}

              {!isLoadingData && !currentMarketContext && currentLocation && (
                <div className="flex flex-col items-center justify-center py-6 sm:py-12 text-center">
                  <div className="text-2xl sm:text-4xl mb-2">🔍</div>
                  <p className="text-slate-500 font-medium text-xs">No pricing data found</p>
                  <p className="text-slate-400 text-[10px] sm:text-xs mt-1">for {currentLocation}</p>
                </div>
              )}

              {!isLoadingData && !currentMarketContext && !currentLocation && (
                <div className="flex flex-col items-center justify-center py-6 sm:py-12 text-center">
                  <div className="text-2xl sm:text-4xl mb-2">📊</div>
                  <p className="text-slate-400 text-xs font-medium">Enter a city and state</p>
                  <p className="text-slate-300 text-[10px] sm:text-xs mt-1">Pricing will auto-load</p>
                </div>
              )}
            </>
          )}

          {activeTab === 'details' && (
            <>
              <h3 className="text-lg sm:text-2xl font-black text-slate-800 mb-2 sm:mb-3 border-b-2 border-slate-200 pb-1 sticky top-0 bg-white">Pricing Details</h3>
              {parsedDetails.length > 0 ? (
                <div className="space-y-1 sm:space-y-2">
                  {parsedDetails.map((field, idx) => (
                    <div key={idx} className="py-0.5 sm:py-1.5 border-b border-slate-100 last:border-b-0">
                      <span className="font-bold text-slate-800 text-[10px] sm:text-sm">{field.label}</span>
                      <span className="font-semibold text-blue-600 text-[10px] sm:text-sm ml-1">{field.value}</span>
                    </div>
                  ))}
                </div>
              ) : currentMarketContext ? (
                <p className="font-medium text-slate-700 text-xs sm:text-sm leading-relaxed">{currentMarketContext.replace(/\n+/g, ' ').trim()}</p>
              ) : (
                <div className="text-center py-4 sm:py-8">
                  <div className="text-2xl sm:text-4xl mb-2">📋</div>
                  <p className="text-slate-500 text-xs sm:text-sm font-medium">No details available yet</p>
                </div>
              )}
            </>
          )}
        </div>

        {/* Nutshell Button */}
        <div className="flex flex-col items-center gap-1 sm:gap-2 pt-2 sm:pt-3 border-t border-slate-200 bg-white rounded-b-xl flex-shrink-0">
          {nutshellStatus !== 'idle' && (
            <span className={`text-[10px] sm:text-xs font-medium ${nutshellStatus === 'success' ? 'text-green-600' : 'text-red-600'}`}>{nutshellMessage}</span>
          )}
          <Button onClick={onNutshellSubmit} disabled={isSubmittingNutshell} className="bg-orange-500 hover:bg-orange-600 text-white font-semibold shadow-lg hover:shadow-xl transition-all duration-200 h-7 sm:h-9 px-3 sm:px-6 text-xs sm:text-sm">
            {isSubmittingNutshell ? 'Submitting...' : 'Nutshell'}
          </Button>
        </div>
      </div>
    </div>
  );
}