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

        <!-- Right side -->
        <arcgis-legend slot="bottom-right"></arcgis-legend>
      </arcgis-map>

      <!-- Layer list container (hidden by default, toggled via React state) -->
      <div id="layer-list-container" class="hidden absolute bottom-[70px] left-[15px] z-[1] bg-white rounded-lg shadow-lg w-64 max-h-60 overflow-auto pb-2">
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

      // Make selection/highlight transparent
      view.highlightOptions = {
        color: [0, 0, 0, 0],        // Transparent fill
        haloColor: [0, 0, 0, 0],    // Transparent halo
        haloOpacity: 0,
        fillOpacity: 0
      };

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

      // Debug: Log all layer names to help identify correct layer titles
      console.log("=== ArcGIS Layer Debug ===");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      view.map.allLayers.forEach((layer: any, index: number) => {
        console.log(`Layer ${index}: "${layer.title}" | Type: ${layer.type} | Visible: ${layer.visible} | Loaded: ${layer.loaded}`);
        if (layer.source) {
          console.log(`  - Source items: ${layer.source?.length ?? 'N/A'}`);
        }
        if (layer.url) {
          console.log(`  - URL: ${layer.url}`);
        }
      });
      console.log("=========================");

      // Style layers based on their name
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      view.map.allLayers.forEach((layer: any) => {
        const layerTitle = (layer.title || "").toLowerCase();
        
        // Helper function to set symbol color
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const setSymbolColor = (symbol: any, color: number[]) => {
          if (symbol) {
            symbol.color = color;
            // If it's a simple marker symbol, also set the color
            if (symbol.type === "simple-marker" || symbol.type === "simple-fill") {
              symbol.color = color;
            }
          }
        };

        // Helper function to apply color to all renderer types
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const applyColorToRenderer = (renderer: any, color: number[]) => {
          if (!renderer) return;
          
          // Handle simple renderer
          if (renderer.symbol) {
            setSymbolColor(renderer.symbol, color);
          }
          
          // Handle unique value renderer
          if (renderer.uniqueValueInfos) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            renderer.uniqueValueInfos.forEach((info: any) => {
              setSymbolColor(info.symbol, color);
            });
          }
          
          // Handle class breaks renderer
          if (renderer.classBreakInfos) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            renderer.classBreakInfos.forEach((info: any) => {
              setSymbolColor(info.symbol, color);
            });
          }
        };

        // Check if this is a feature layer with a renderer
        if (layer.renderer) {
          // "digitals" layer → orange dots [255, 165, 0, 255] (RGBA)
          if (layerTitle.includes("digital")) {
            console.log(`🟠 Styling "${layer.title}" as ORANGE`);
            applyColorToRenderer(layer.renderer, [255, 165, 0, 255]);
          }
          // "All boards no vendor icons" layer → black [0, 0, 0, 255]
          else if (layerTitle.includes("all boards") && layerTitle.includes("no vendor")) {
            console.log(`⚫ Styling "${layer.title}" as BLACK`);
            applyColorToRenderer(layer.renderer, [0, 0, 0, 255]);
            
            // Debug: Check if this layer has data issues
            if (layer.queryFeatureCount) {
              layer.queryFeatureCount().then((count: number) => {
                console.log(`  - Feature count for "${layer.title}": ${count}`);
              }).catch((err: Error) => {
                console.error(`  - Error querying feature count: ${err}`);
              });
            }
          }
          // All other layers → transparent (existing behavior)
          else {
            applyColorToRenderer(layer.renderer, [0, 0, 0, 0]);
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

    const goToLocation = async () => {
      try {
        // Wait for map to be ready
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const mapElement = mapRef.current as any;
        if (!mapElement) return;
        
        await mapElement.ready;
        const view = mapElement.view;
        if (!view) return;

        // Wait for the view to be fully ready
        if (view.when) {
          await view.when();
        }

        // Use ArcGIS World Geocoding Service to find the location
        const geocodeUrl = `https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates?f=json&singleLine=${encodeURIComponent(initialLocation)}&outFields=Match_addr,Addr_type`;
        
        const response = await fetch(geocodeUrl);
        const data = await response.json();
        
        if (data.candidates && data.candidates.length > 0) {
          const topResult = data.candidates[0];
          const { x, y } = topResult.location;
          
          // Navigate to the location using simple center/zoom
          view.center = [x, y];
          view.zoom = 10;

          // Update the search widget text to show the location
          const searchWidget = mapRef.current?.querySelector("arcgis-search");
          if (searchWidget) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (searchWidget as any).searchTerm = initialLocation;
          }
        }
      } catch (err) {
        console.error("Failed to go to location:", err);
      }
    };

    goToLocation();
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
        className={`absolute bottom-[30px] left-[15px] z-[2] w-8 h-8 flex items-center justify-center rounded-full shadow-md transition-colors ${
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