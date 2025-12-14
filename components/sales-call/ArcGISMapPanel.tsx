"use client";

import { useEffect, useRef, useState } from "react";

const ARCGIS_ITEM_ID = "56d2f53d6b5f4a648f5c90300ceb0ea7";

interface ArcGISMapPanelProps {
  initialLocation?: string;
}

export function ArcGISMapPanel({ initialLocation }: ArcGISMapPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<HTMLElement | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentLocation, setCurrentLocation] = useState<string>("");

  useEffect(() => {
    let mounted = true;

    async function loadArcGIS() {
      try {
        // Dynamically import ArcGIS components (client-side only)
        await import("@arcgis/map-components/components/arcgis-map");
        await import("@arcgis/map-components/components/arcgis-zoom");
        await import("@arcgis/map-components/components/arcgis-legend");
        await import("@arcgis/map-components/components/arcgis-search");

        if (mounted) {
          setIsLoaded(true);
        }
      } catch (err) {
        console.error("Failed to load ArcGIS components:", err);
        if (mounted) {
          setError("Failed to load map components");
        }
      }
    }

    loadArcGIS();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!isLoaded || !containerRef.current) return;

    // Create the map HTML after components are loaded
    containerRef.current.innerHTML = `
      <arcgis-map item-id="${ARCGIS_ITEM_ID}" style="width: 100%; height: 100%; border-radius: 0.5rem;">
        <arcgis-search slot="top-right"></arcgis-search>
        <arcgis-zoom slot="top-left"></arcgis-zoom>
        <arcgis-legend slot="bottom-left"></arcgis-legend>
      </arcgis-map>
    `;

    // Store reference to the map element
    mapRef.current = containerRef.current.querySelector("arcgis-map");
  }, [isLoaded]);

  // Effect to search and go to location when initialLocation changes
  useEffect(() => {
    if (!isLoaded || !initialLocation || !mapRef.current) return;
    if (initialLocation === currentLocation) return;

    setCurrentLocation(initialLocation);

    // Get the search widget and perform the search
    const searchWidget = mapRef.current.querySelector("arcgis-search");
    if (searchWidget) {
      // Use the search widget's search method to find and go to the location
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const performSearch = async () => {
        try {
          // Wait for map to be ready
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const mapElement = mapRef.current as any;
          if (mapElement?.ready) {
            await mapElement.ready;
          }

          // Access the search widget and perform search
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const search = searchWidget as any;
          if (search?.search) {
            await search.search(initialLocation);
          } else if (search?.searchTerm !== undefined) {
            // Alternative: set searchTerm property
            search.searchTerm = initialLocation;
          }
        } catch (err) {
          console.error("Failed to search location:", err);
        }
      };

      performSearch();
    }
  }, [isLoaded, initialLocation, currentLocation]);

  if (error) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-slate-100 rounded-lg border border-slate-200">
        <p className="text-sm text-red-600">{error}</p>
      </div>
    );
  }

  if (!isLoaded) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-slate-100 rounded-lg border border-slate-200">
        <div className="flex flex-col items-center gap-2">
          <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-slate-600">Loading ArcGIS Map...</p>
        </div>
      </div>
    );
  }

  return <div ref={containerRef} className="h-full w-full" />;
}
