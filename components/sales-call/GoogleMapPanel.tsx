"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface GoogleMapPanelProps {
  initialLocation?: string;
}

declare global {
  interface Window {
    google: typeof google;
  }
}

export function GoogleMapPanel({ initialLocation }: GoogleMapPanelProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const streetViewRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const markerRef = useRef<google.maps.marker.AdvancedMarkerElement | null>(null);
  const streetViewPanoramaRef = useRef<google.maps.StreetViewPanorama | null>(null);
  const initCalledRef = useRef(false);

  const [isLoaded, setIsLoaded] = useState(false);
  const [showStreetView, setShowStreetView] = useState(false);
  const [streetViewAvailable, setStreetViewAvailable] = useState(false);
  const [currentAddress, setCurrentAddress] = useState(initialLocation || "");
  const [searchQuery, setSearchQuery] = useState(initialLocation || "");
  const [isSearching, setIsSearching] = useState(false);

  const handleSearch = useCallback(() => {
    if (!searchQuery.trim() || !window.google?.maps || !isLoaded) return;

    setIsSearching(true);
    const geocoder = new google.maps.Geocoder();
    geocoder.geocode({ address: searchQuery }, (results, status) => {
      setIsSearching(false);
      if (status === "OK" && results?.[0]?.geometry?.location) {
        const location = results[0].geometry.location;
        const address = results[0].formatted_address;

        // Update marker and map
        if (mapInstanceRef.current) {
          if (markerRef.current) {
            markerRef.current.position = location;
          } else {
            markerRef.current = new google.maps.marker.AdvancedMarkerElement({
              map: mapInstanceRef.current,
              position: location,
            });
          }
          mapInstanceRef.current.setCenter(location);
          mapInstanceRef.current.setZoom(17);
        }

        setCurrentAddress(address);

        // Check Street View availability
        const streetViewService = new google.maps.StreetViewService();
        streetViewService.getPanorama(
          { location, radius: 50 },
          (data, svStatus) => {
            const available = svStatus === google.maps.StreetViewStatus.OK;
            setStreetViewAvailable(available);

            if (available && streetViewPanoramaRef.current) {
              streetViewPanoramaRef.current.setPosition(location);
              streetViewPanoramaRef.current.setPov({ heading: 0, pitch: 0 });
            }
          }
        );
      }
    });
  }, [searchQuery, isLoaded]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSearch();
    }
  }, [handleSearch]);

  const updateMarkerAndStreetView = useCallback(
    (location: google.maps.LatLng, address?: string) => {
      if (!mapInstanceRef.current || !window.google?.maps) return;

      // Update or create marker
      if (markerRef.current) {
        markerRef.current.position = location;
      } else {
        markerRef.current = new google.maps.marker.AdvancedMarkerElement({
          map: mapInstanceRef.current,
          position: location,
        });
      }

      // Center map on location
      mapInstanceRef.current.setCenter(location);
      mapInstanceRef.current.setZoom(17);

      if (address) {
        setCurrentAddress(address);
      }

      // Check Street View availability
      const streetViewService = new google.maps.StreetViewService();
      streetViewService.getPanorama(
        { location, radius: 50 },
        (data, status) => {
          const available = status === google.maps.StreetViewStatus.OK;
          setStreetViewAvailable(available);

          if (available && streetViewPanoramaRef.current) {
            streetViewPanoramaRef.current.setPosition(location);
            streetViewPanoramaRef.current.setPov({
              heading: 0,
              pitch: 0,
            });
          }
        }
      );
    },
    []
  );

  const initializeMap = useCallback(() => {
    if (!mapRef.current || !window.google?.maps?.Map || initCalledRef.current) return;
    initCalledRef.current = true;

    // Default to US center
    const defaultCenter = { lat: 39.8283, lng: -98.5795 };
    const defaultZoom = 4;

    // Create map
    const map = new google.maps.Map(mapRef.current, {
      center: defaultCenter,
      zoom: defaultZoom,
      mapId: "billboard-source-map",
      gestureHandling: "greedy",
      streetViewControl: false,
      mapTypeControl: true,
    });
    mapInstanceRef.current = map;

    // Create Street View panorama
    if (streetViewRef.current) {
      streetViewPanoramaRef.current = new google.maps.StreetViewPanorama(
        streetViewRef.current,
        {
          pov: { heading: 0, pitch: 0 },
          zoom: 1,
          addressControl: true,
          linksControl: true,
          panControl: true,
          enableCloseButton: false,
        }
      );
    }


    // Allow clicking on map to place marker
    map.addListener("click", (event: google.maps.MapMouseEvent) => {
      if (event.latLng) {
        const geocoder = new google.maps.Geocoder();
        geocoder.geocode({ location: event.latLng }, (results, status) => {
          if (status === "OK" && results?.[0]) {
            updateMarkerAndStreetView(
              event.latLng!,
              results[0].formatted_address
            );
          } else {
            updateMarkerAndStreetView(event.latLng!);
          }
        });
      }
    });

    // If initial location provided, geocode and show it
    if (initialLocation) {
      const geocoder = new google.maps.Geocoder();
      geocoder.geocode({ address: initialLocation }, (results, status) => {
        if (status === "OK" && results?.[0]?.geometry?.location) {
          updateMarkerAndStreetView(
            results[0].geometry.location,
            results[0].formatted_address
          );
        }
      });
    }

    setIsLoaded(true);
  }, [initialLocation, updateMarkerAndStreetView]);

  useEffect(() => {
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAP_KEY;
    if (!apiKey) {
      console.error("Google Maps API key not found");
      return;
    }

    // Check if script is already being loaded or loaded
    const existingScript = document.querySelector(
      'script[src*="maps.googleapis.com"]'
    );

    if (existingScript) {
      // If google is already available, initialize
      if (window.google?.maps?.Map) {
        initializeMap();
      } else {
        // Wait for the script to load
        existingScript.addEventListener("load", () => {
          // Small delay to ensure all libraries are ready
          setTimeout(initializeMap, 100);
        });
      }
      return;
    }

    // Load the script with callback
    const callbackName = `initGoogleMaps_${Date.now()}`;
    (window as Record<string, unknown>)[callbackName] = () => {
      initializeMap();
      delete (window as Record<string, unknown>)[callbackName];
    };

    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=marker&v=weekly&loading=async&callback=${callbackName}`;
    script.async = true;
    document.head.appendChild(script);

    return () => {
      delete (window as Record<string, unknown>)[callbackName];
    };
  }, [initializeMap]);

  // Update map when initialLocation changes
  useEffect(() => {
    if (!isLoaded || !initialLocation || !window.google?.maps) return;

    setSearchQuery(initialLocation);
    const geocoder = new google.maps.Geocoder();
    geocoder.geocode({ address: initialLocation }, (results, status) => {
      if (status === "OK" && results?.[0]?.geometry?.location) {
        updateMarkerAndStreetView(
          results[0].geometry.location,
          results[0].formatted_address
        );
      }
    });
  }, [initialLocation, isLoaded, updateMarkerAndStreetView]);

  // Trigger resize when Street View visibility changes
  useEffect(() => {
    if (showStreetView && streetViewPanoramaRef.current && window.google?.maps) {
      google.maps.event.trigger(streetViewPanoramaRef.current, "resize");
    }
    if (mapInstanceRef.current && window.google?.maps) {
      google.maps.event.trigger(mapInstanceRef.current, "resize");
    }
  }, [showStreetView]);

  return (
    <div className="h-full w-full flex flex-col gap-3">
      {/* Search Bar */}
      <div className="flex gap-2 items-center">
        <Input
          ref={searchInputRef}
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search for a location..."
          className="flex-1"
        />
        <Button
          onClick={handleSearch}
          disabled={isSearching || !isLoaded}
          size="sm"
          className="whitespace-nowrap"
        >
          {isSearching ? "Searching..." : "Search"}
        </Button>
        <Button
          onClick={() => setShowStreetView(!showStreetView)}
          disabled={!streetViewAvailable}
          variant={showStreetView ? "default" : "outline"}
          size="sm"
          className="whitespace-nowrap"
        >
          {showStreetView ? "Hide Street View" : "Street View"}
        </Button>
      </div>

      {/* Current Address Display */}
      {currentAddress && (
        <div className="px-3 py-1.5 bg-slate-100 rounded text-xs text-slate-600 truncate">
          📍 {currentAddress}
        </div>
      )}

      {/* Map and Street View Container */}
      <div className="flex-1 flex gap-3 min-h-0">
        {/* Map */}
        <div
          className={`${showStreetView ? "w-1/2" : "w-full"} h-full transition-all duration-300`}
        >
          <div
            ref={mapRef}
            className="w-full h-full rounded-lg border border-slate-200"
            style={{ minHeight: "300px" }}
          />
        </div>

        {/* Street View - always rendered but hidden when not active */}
        <div
          className={`w-1/2 h-full transition-all duration-300 ${showStreetView ? "block" : "hidden"}`}
        >
          <div
            ref={streetViewRef}
            className="w-full h-full rounded-lg border border-slate-200"
            style={{ minHeight: "300px" }}
          />
        </div>
      </div>

      {/* Help Text */}
      <p className="text-xs text-slate-500 text-center">
        Click on the map to pin a location, or use the search bar above
      </p>
    </div>
  );
}
