"use client";

import { useEffect, useRef, useState } from "react";
import { Layers, X } from "lucide-react";

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
  const [layersOpen, setLayersOpen] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function loadArcGIS() {
      try {
        // Dynamically import ArcGIS components (client-side only)
        await import("@arcgis/map-components/components/arcgis-map");
        await import("@arcgis/map-components/components/arcgis-zoom");
        await import("@arcgis/map-components/components/arcgis-legend");
        await import("@arcgis/map-components/components/arcgis-search");
        await import("@arcgis/map-components/components/arcgis-home");
        await import("@arcgis/map-components/components/arcgis-layer-list");

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
    // Layout matches Experience Builder: zoom, search, home stacked on left
    containerRef.current.innerHTML = `
      <arcgis-map item-id="${ARCGIS_ITEM_ID}" style="width: 100%; height: 100%; border-radius: 0.5rem;">
        <!-- Top-left stack: Zoom, Search, Home -->
        <arcgis-zoom slot="top-left" position="top-left"></arcgis-zoom>
        <arcgis-search slot="top-left" position="top-left"></arcgis-search>
        <arcgis-home slot="top-left" position="top-left"></arcgis-home>

        <!-- Bottom-left -->
        <arcgis-legend slot="bottom-left"></arcgis-legend>
      </arcgis-map>

      <!-- Layer list container (hidden by default, toggled via React state) -->
      <div id="layer-list-container" class="hidden absolute top-[180px] left-[15px] z-10 bg-white rounded-lg shadow-lg w-64 max-h-80 overflow-hidden">
        <arcgis-layer-list reference-element="arcgis-map"></arcgis-layer-list>
      </div>
    `;

    // Store reference to the map element
    mapRef.current = containerRef.current.querySelector("arcgis-map");

    // Enable popups on feature click
    const setupPopups = async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mapElement = mapRef.current as any;
      if (!mapElement) return;

      await mapElement.ready;
      const view = mapElement.view;
      if (!view) return;

      // Enable popup on click
      view.popupEnabled = true;
      view.popup.dockEnabled = true;
      view.popup.dockOptions = {
        buttonEnabled: true,
        breakpoint: false,
        position: "top-right"
      };

      // Configure popup to show all fields if no template defined
      view.popup.defaultPopupTemplateEnabled = true;

      // Enable popups on all layers in the map (wait for layers to load)
      await view.map.loadAll();

      // Make market circle layers have transparent fill
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      view.map.allLayers.forEach((layer: any) => {
        // Check if this is a feature layer with a renderer (likely the market circles)
        if (layer.renderer) {
          const renderer = layer.renderer;
          
          // Helper function to make a symbol's fill transparent
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const makeTransparent = (symbol: any) => {
            if (symbol && symbol.color) {
              // Set fill to transparent (RGBA with 0 alpha)
              symbol.color = [0, 0, 0, 0];
            }
          };
          
          // Handle simple renderer
          if (renderer.symbol) {
            makeTransparent(renderer.symbol);
          }
          
          // Handle unique value renderer
          if (renderer.uniqueValueInfos) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            renderer.uniqueValueInfos.forEach((info: any) => {
              makeTransparent(info.symbol);
            });
          }
          
          // Handle class breaks renderer
          if (renderer.classBreakInfos) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            renderer.classBreakInfos.forEach((info: any) => {
              makeTransparent(info.symbol);
            });
          }
        }
      });

      view.map.allLayers.forEach((layer: { popupEnabled?: boolean }) => {
        if (layer.popupEnabled !== undefined) {
          layer.popupEnabled = true;
        }
      });

      // Enable clicking on features to show popup
      view.on("click", async (event: { mapPoint: unknown }) => {
        const response = await view.hitTest(event);
        if (response.results.length > 0) {
          // Get all graphics from hit test results (not just "feature" type)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const graphics = response.results
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .filter((r: any) => r.graphic && r.graphic.layer)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .map((r: any) => r.graphic);

          if (graphics.length > 0) {
            view.popup.open({
              features: graphics,
              location: event.mapPoint
            });
          }
        }
      });
    };

    setupPopups();
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

  // Toggle layer list visibility
  useEffect(() => {
    if (!isLoaded || !containerRef.current) return;
    const layerListContainer = containerRef.current.querySelector("#layer-list-container");
    if (layerListContainer) {
      if (layersOpen) {
        layerListContainer.classList.remove("hidden");
      } else {
        layerListContainer.classList.add("hidden");
      }
    }
  }, [isLoaded, layersOpen]);

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

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />

      {/* Layers toggle button */}
      <button
        onClick={() => setLayersOpen(!layersOpen)}
        className={`absolute top-[180px] left-[15px] z-20 w-8 h-8 flex items-center justify-center rounded-full shadow-md transition-colors ${
          layersOpen
            ? "bg-blue-600 text-white"
            : "bg-white text-gray-700 hover:bg-gray-100"
        }`}
        title="Toggle Layers"
      >
        {layersOpen ? <X size={18} /> : <Layers size={18} />}
      </button>
    </div>
  );
}