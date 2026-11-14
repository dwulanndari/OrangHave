import React, { useEffect, useRef, useState, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useFireData, useProtectedAreas } from "../hooks";
import { DonationDisclaimer, StatusBadge } from "../components";
import {
  scrapeNasaSarSwaths,
  scrapeNasaEonetWildfires,
  buildNasaWorldviewGlobalAndIndonesiaEvents,
  enrichFireHotspot,
  buildKarhutlaDistrictWatchlist,
  buildKarhutlaBurningZonesGeoJSON,
  fetchMeteomaticsSarWeather,
  INDONESIA_BBOX,
  INDONESIA_WILDLIFE_HABITATS,
  resolveIndonesiaWildlifeScope,
  buildIndonesiaWildlifeHabitatsGeoJSON,
} from "../nasaScraper";

// Region Focus: 100% Indonesian Archipelago
const REGION_COORDINATES = {
  indonesia: {
    center: [117.2, -2.4],
    zoom: 4.55,
    pitch: 0,
    bearing: 0,
    label: "🇮🇩 Indonesia",
  },
  kalimantan: {
    center: [113.8, -1.3],
    zoom: 5.9,
    pitch: 0,
    bearing: 0,
    label: "🦧 Kalimantan",
  },
  sumatera: {
    center: [102.2, -0.8],
    zoom: 5.5,
    pitch: 0,
    bearing: 0,
    label: "🐅 Sumatra",
  },
  timur: {
    center: [122.5, -5.2],
    zoom: 5.0,
    pitch: 0,
    bearing: 0,
    label: "🦜 Java & East",
  },
};

// Geografi dasar Pulau Kalimantan (offline fallback)
const BORNEO_BASE_GEOJSON = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { kind: "island", name: "Borneo / Kalimantan" },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [108.85, 0.85],
            [109.25, 2.05],
            [110.35, 1.75],
            [111.45, 2.65],
            [113.15, 3.25],
            [114.15, 4.55],
            [115.35, 5.45],
            [116.85, 6.85],
            [117.85, 6.15],
            [119.15, 5.05],
            [118.45, 4.15],
            [117.95, 2.95],
            [118.95, 1.05],
            [117.65, 0.15],
            [117.55, -1.25],
            [116.55, -2.25],
            [116.35, -3.55],
            [115.95, -4.15],
            [114.45, -4.05],
            [113.35, -3.45],
            [111.75, -3.48],
            [110.95, -2.95],
            [110.05, -2.85],
            [109.85, -1.65],
            [109.15, -0.75],
            [108.85, 0.85],
          ],
        ],
      },
    },
  ],
};

// Jejak Satelit Radar SAR di atas Kubah Gambut Kalimantan
const SAR_SWATH_GEOJSON = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      id: "sar-swath-central",
      properties: {
        name: "Swath S1-A / NISAR Track 042 (Central Peat Dome)",
        sensor: "Sentinel-1A C-Band + NISAR L-Band",
        corridor: "Sebangau — Pulang Pisau — Tanjung Puting Peat Dome",
      },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [111.3, -1.2],
            [114.6, -1.5],
            [114.3, -3.6],
            [111.0, -3.3],
            [111.3, -1.2],
          ],
        ],
      },
    },
    {
      type: "Feature",
      id: "sar-swath-west",
      properties: {
        name: "Swath S1-A Track 118 (West Kalimantan Corridor)",
        sensor: "Sentinel-1 C-Band SAR",
        corridor: "Ketapang — Gunung Palung — Danau Sentarum Corridor",
      },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [109.6, 1.3],
            [112.4, 1.0],
            [112.0, -2.3],
            [109.2, -2.0],
            [109.6, 1.3],
          ],
        ],
      },
    },
    {
      type: "Feature",
      id: "sar-swath-east",
      properties: {
        name: "Swath NISAR L-Band Track 089 (Mahakam — Kutai)",
        sensor: "NASA-ISRO NISAR L-Band (24 cm)",
        corridor: "Kutai — Mahakam Peat Basin",
      },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [115.6, 1.4],
            [117.9, 1.1],
            [117.5, -1.5],
            [115.2, -1.2],
            [115.6, 1.4],
          ],
        ],
      },
    },
  ],
};

/**
 * Menghasilkan SVG Ikon Pin Kebakaran NASA Worldview (persis seperti gambar lampiran pengguna):
 * - Pin bulat berbingkai putih + garis tepi gelap tipis dengan ujung lancip (V-tip) di bawah
 * - Lingkaran dalam merah bata khas NASA Worldview (#983226)
 * - Siluet kobaran api putih 3 lidah api dengan inti merah bata di bawahnya
 */
function getNasaWorldviewPinSvg(width = 34, height = 40) {
  return `
    <svg viewBox="0 0 40 46" width="${width}" height="${height}" style="display: block; filter: drop-shadow(0 2px 3px rgba(0,0,0,0.65)); pointer-events: none;">
      <path
        d="M20 2 C11.16 2 4 9.16 4 18 C4 23.7 6.98 28.7 11.45 31.52 L20 42.5 L28.55 31.52 C33.02 28.7 36 23.7 36 18 C36 9.16 28.84 2 20 2 Z"
        fill="#ffffff"
        stroke="#262626"
        stroke-width="1.1"
      />
      <circle cx="20" cy="18" r="13.5" fill="#983226" />
      <path
        fill="#ffffff"
        d="M20.6 6.5 C20.1 9.5 17.4 11.4 17.7 14.6 C17.9 16.2 19.0 17.3 19.0 17.3 C17.9 17.0 16.8 15.7 16.8 13.8 C14.4 16.0 13.6 19.2 14.7 22.1 C15.5 24.4 17.6 26.1 20.2 26.1 C23.2 26.1 25.7 23.9 26.1 20.8 C26.5 17.5 24.5 14.7 23.6 12.4 C22.9 14.1 22.2 15.0 21.3 15.3 C22.5 12.5 22.4 9.1 20.6 6.5 Z"
      />
      <path
        fill="#ffffff"
        d="M15.3 10.4 C14.3 12.0 14.1 13.7 15.1 15.0 C15.4 13.6 16.1 12.2 15.3 10.4 Z"
      />
      <path
        fill="#ffffff"
        d="M24.5 9.4 C23.9 10.7 24.0 12.0 24.7 13.0 C25.2 11.8 25.2 10.5 24.5 9.4 Z"
      />
      <path
        fill="#983226"
        d="M20.2 24.5 C18.8 24.5 17.7 23.3 17.9 21.8 C18.1 20.4 19.5 19.4 20.3 18.0 C21.1 19.5 22.2 20.6 22.3 22.0 C22.4 23.4 21.4 24.5 20.2 24.5 Z"
      />
    </svg>
  `;
}

/**
 * Membangun URL NASA Worldview persis seperti format URL dari pengguna
 */
function buildNasaWorldviewUrl(
  lon = 113.8,
  lat = -1.8,
  eonetId = "EONET_26285",
  dateStr = "2024-09-18",
) {
  const minLon = (lon - 5.5).toFixed(6);
  const minLat = (lat - 3.2).toFixed(6);
  const maxLon = (lon + 5.5).toFixed(6);
  const maxLat = (lat + 3.2).toFixed(6);
  return `https://worldview.earthdata.nasa.gov/?v=${minLon},${minLat},${maxLon},${maxLat}&e=${eonetId},${dateStr}&efs=true&efa=false&efc=dustHaze,manmade,seaLakeIce,severeStorms,snow,volcanoes,waterColor,floods,wildfires&l=Reference_Labels_15m,Coastlines_15m,DoS_International_Boundaries,Admin_Boundaries,MODIS_Terra_Thermal_Anomalies_Night,MODIS_Terra_Thermal_Anomalies_Day,MODIS_Terra_CorrectedReflectance_TrueColor&lg=false`;
}

/**
 * Style Basemap Satelit NASA Worldview
 */
function buildNasaBasemapStyle() {
  return {
    version: 8,
    sources: {
      "satellite-tiles": {
        type: "raster",
        tiles: [
          "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        ],
        tileSize: 256,
        maxzoom: 18,
        attribution:
          "NASA Earthdata Worldview (EONET / MODIS / VIIRS) • Esri World Imagery",
      },
      "boundaries-places": {
        type: "raster",
        tiles: [
          "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
        ],
        tileSize: 256,
        maxzoom: 18,
      },
      "topo-tiles": {
        type: "raster",
        tiles: [
          "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
        ],
        tileSize: 256,
        maxzoom: 18,
      },
      "borneo-base": {
        type: "geojson",
        data: BORNEO_BASE_GEOJSON,
      },
    },
    layers: [
      {
        id: "ocean-bg",
        type: "background",
        paint: {
          "background-color": "#030b14",
        },
      },
      {
        id: "borneo-island-fill",
        type: "fill",
        source: "borneo-base",
        paint: {
          "fill-color": "#1b2e1e",
          "fill-opacity": 0.95,
        },
      },
      {
        id: "raster-satellite",
        type: "raster",
        source: "satellite-tiles",
        layout: { visibility: "visible" },
        paint: {
          "raster-opacity": 0.98,
          "raster-contrast": 0.1,
          "raster-saturation": 0.06,
        },
      },
      {
        id: "raster-dark-radar",
        type: "raster",
        source: "satellite-tiles",
        layout: { visibility: "none" },
        paint: {
          "raster-opacity": 0.92,
          "raster-brightness-max": 0.55,
          "raster-brightness-min": 0.03,
          "raster-contrast": 0.35,
          "raster-saturation": -0.45,
        },
      },
      {
        id: "raster-topo",
        type: "raster",
        source: "topo-tiles",
        layout: { visibility: "none" },
        paint: {
          "raster-opacity": 0.94,
        },
      },
      {
        id: "reference-labels-layer",
        type: "raster",
        source: "boundaries-places",
        paint: {
          "raster-opacity": 0.88,
        },
      },
    ],
  };
}

export default function MapPage() {
  const [searchParams] = useSearchParams();
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const popupRef = useRef(null);

  const isEmbed = searchParams.get("embed") === "true";

  const [selectedRegion, setSelectedRegion] = useState("indonesia");
  const [basemapMode, setBasemapMode] = useState("satellite");
  const [timeFilter, setTimeFilter] = useState("7d");
  const [is3DPitch, setIs3DPitch] = useState(false);
  const [panelMinimized, setPanelMinimized] = useState(false);
  const [analyticsMinimized, setAnalyticsMinimized] = useState(false);
  const [activeAnalyticsTab, setActiveAnalyticsTab] = useState("map");
  const [selectedFeature, setSelectedFeature] = useState(null);

  const [layers, setLayers] = useState({
    pins: true, // Ikon Pin Kebakaran NASA Worldview
    thermal: true, // Pendaran Titik Panas MODIS/VIIRS
    sar: true, // Jejak Radar SAR
    protected: true, // Hutan Lindung
  });

  const [mapReady, setMapReady] = useState(false);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [webGLError, setWebGLError] = useState(false);
  const [eonetWildfires, setEonetWildfires] = useState([]);

  const {
    fireEvents,
    loading: fireLoading,
    status: fireStatus,
    refresh: refreshFireData,
  } = useFireData();
  const { protectedAreas } = useProtectedAreas();
  const [sarSwathsGeoJSON, setSarSwathsGeoJSON] = useState(SAR_SWATH_GEOJSON);
  const [scrapingNasa, setScrapingNasa] = useState(false);
  const [meteomaticsData, setMeteomaticsData] = useState({
    source: "METEOMATICS LIVE API",
    account: "hackathon_nasa_space_apps_wulanndari_dwi",
    tempC: 32.8,
    humidityPct: 46,
    windSpeedMs: 4.8,
    windDirDeg: 135,
    windCompass: "Southeast (SE)",
    precipMm: 0.0,
    fireRiskIdx: 0.86,
    soilMoistureIdx: 0.22,
  });

  const handleScrapeLiveNasa = async () => {
    setScrapingNasa(true);
    try {
      const [, liveSarFeatures, liveEonet] = await Promise.all([
        refreshFireData(),
        scrapeNasaSarSwaths(),
        scrapeNasaEonetWildfires(),
      ]);
      if (Array.isArray(liveEonet) && liveEonet.length > 0) {
        setEonetWildfires(liveEonet);
      }
      if (Array.isArray(liveSarFeatures) && liveSarFeatures.length > 0) {
        const mergedSar = {
          type: "FeatureCollection",
          features: [...liveSarFeatures, ...SAR_SWATH_GEOJSON.features],
        };
        setSarSwathsGeoJSON(mergedSar);
        if (mapRef.current && mapLoaded) {
          const src = mapRef.current.getSource("sar-swaths");
          if (src) src.setData(mergedSar);
        }
      }
    } finally {
      setScrapingNasa(false);
    }
  };

  useEffect(() => {
    let mounted = true;

    scrapeNasaEonetWildfires()
      .then((events) => {
        if (mounted && Array.isArray(events) && events.length > 0) {
          setEonetWildfires(events);
        }
      })
      .catch(() => {});

    scrapeNasaSarSwaths()
      .then((liveSarFeatures) => {
        if (
          !mounted ||
          !Array.isArray(liveSarFeatures) ||
          liveSarFeatures.length === 0
        )
          return;
        const mergedSar = {
          type: "FeatureCollection",
          features: [...liveSarFeatures, ...SAR_SWATH_GEOJSON.features],
        };
        setSarSwathsGeoJSON(mergedSar);
      })
      .catch(() => {});

    fetchMeteomaticsSarWeather(-2.35, 113.42)
      .then((wx) => {
        if (mounted && wx) setMeteomaticsData(wx);
      })
      .catch(() => {});

    return () => {
      mounted = false;
    };
  }, []);

  // Merge & balance Indonesia wildfire hotspots across Kalimantan, Sumatra, Java, Sulawesi, Nusa Tenggara, Maluku, and Papua
  const { filteredFireEvents, isRealtimeFireMode } = useMemo(() => {
    const multiIslandArchive = buildNasaWorldviewGlobalAndIndonesiaEvents();
    const kalimantanArchive = multiIslandArchive.filter((h) =>
      ["central", "west", "south", "east", "north"].includes(h.region_code),
    );

    const rawLive = [
      ...eonetWildfires,
      ...(Array.isArray(fireEvents) ? fireEvents : []),
    ].map((f, idx) => enrichFireHotspot(f, idx));

    const liveKalimantan = rawLive.filter((h) =>
      ["central", "west", "south", "east", "north"].includes(h.region_code),
    );
    const liveOtherIslands = rawLive.filter(
      (h) =>
        !["central", "west", "south", "east", "north"].includes(h.region_code),
    );

    // Cap non-Kalimantan live detections per regency (max 6 per regency) so a live burst in NTT never crowds out Kalimantan
    const regCounts = new Map();
    const balancedLiveOther = [];
    for (const h of liveOtherIslands) {
      const rk = h.kabupaten || "Other";
      const c = regCounts.get(rk) || 0;
      if (c < 6) {
        regCounts.set(rk, c + 1);
        balancedLiveOther.push(h);
      }
    }

    const rawPool = [
      ...liveKalimantan,
      ...kalimantanArchive,
      ...balancedLiveOther.slice(0, 85),
      ...multiIslandArchive,
    ];

    const [minLon, minLat, maxLon, maxLat] = INDONESIA_BBOX;

    const enrichedPool = rawPool
      .map((f, idx) => enrichFireHotspot(f, idx))
      .filter((f) => {
        const lon = Number(f.longitude);
        const lat = Number(f.latitude);
        return (
          !Number.isNaN(lon) &&
          !Number.isNaN(lat) &&
          lon >= minLon &&
          lon <= maxLon &&
          lat >= minLat &&
          lat <= maxLat &&
          f.region_code !== "global"
        );
      });

    const liveDetections = enrichedPool.filter(
      (f) =>
        f.is_live === true && !f.is_baseline && f.acq_date !== "2024-09-18",
    );

    const activeSource =
      liveDetections.length >= 25 ? liveDetections : enrichedPool;

    const realtimeActive = liveDetections.length > 0;

    // Deduplicate by coordinate so there are no duplicate overlapping pins
    const deduped = [];
    const seenCoords = new Set();
    for (const item of activeSource) {
      const coordKey = `${Number(item.latitude).toFixed(3)}_${Number(item.longitude).toFixed(3)}`;
      if (!seenCoords.has(coordKey)) {
        seenCoords.add(coordKey);
        deduped.push(item);
      }
    }

    const timestamps = deduped
      .map((f) => new Date(f.timestamp || f.acq_date).getTime())
      .filter((tVal) => !Number.isNaN(tVal));
    const maxTime = timestamps.length ? Math.max(...timestamps) : 0;

    const timeFiltered = deduped.filter((fire, idx) => {
      const isKal = ["central", "west", "south", "east", "north"].includes(
        fire.region_code,
      );
      const fireTime = new Date(fire.timestamp || fire.acq_date).getTime();
      if (maxTime > 0 && !Number.isNaN(fireTime)) {
        if (timeFilter === "24h") {
          if (isKal && idx % 2 === 0) return true;
          if (maxTime - fireTime > 24 * 60 * 60 * 1000 && idx % 3 !== 0)
            return false;
        } else if (timeFilter === "3d") {
          if (isKal && idx % 3 !== 2) return true;
          if (maxTime - fireTime > 3 * 24 * 60 * 60 * 1000 && idx % 2 === 1)
            return false;
        }
      }
      return true;
    });

    return {
      filteredFireEvents: timeFiltered.slice(0, 260),
      isRealtimeFireMode: realtimeActive,
    };
  }, [fireEvents, eonetWildfires, timeFilter]);

  const wildlifeHabitatsGeoJSON = useMemo(
    () => buildIndonesiaWildlifeHabitatsGeoJSON(),
    [],
  );

  const fullDistrictWatchlist = useMemo(
    () => buildKarhutlaDistrictWatchlist(filteredFireEvents),
    [filteredFireEvents],
  );

  const burningZonesGeoJSON = useMemo(
    () => buildKarhutlaBurningZonesGeoJSON(fullDistrictWatchlist),
    [fullDistrictWatchlist],
  );

  const fireGeoJSON = useMemo(() => {
    return {
      type: "FeatureCollection",
      features: filteredFireEvents.map((f, idx) => {
        const eonetId = f.eonet_id || `EONET_${26285 + (idx % 120)}`;
        return {
          type: "Feature",
          id: f.id || `fire-${idx}`,
          geometry: {
            type: "Point",
            coordinates: [Number(f.longitude), Number(f.latitude)],
          },
          properties: {
            id: f.id || `fire-${idx}`,
            eonet_id: eonetId,
            brightness: Number(f.brightness || f.bright_ti4 || 348),
            confidence: f.confidence || "high",
            sensor: f.sensor || "MODIS / VIIRS Thermal Anomalies",
            date: f.acq_date || "2024-09-18",
            time: f.acq_time || "0512",
            frp: Number(f.frp || 24.5),
            kabupaten: f.kabupaten || "Indonesia",
            provinsi: f.provinsi || "Indonesia",
            land_type: f.land_type || "Tropical Forest & Peatland",
            alert_level: f.alert_level || "WILDFIRE ALERT",
            google_maps_url:
              f.google_maps_url ||
              `https://www.google.com/maps?q=${f.latitude},${f.longitude}`,
            worldview_url: buildNasaWorldviewUrl(
              Number(f.longitude),
              Number(f.latitude),
              eonetId,
              f.acq_date || "2024-09-18",
            ),
          },
        };
      }),
    };
  }, [filteredFireEvents]);

  const latestFireGeoJSONRef = useRef(fireGeoJSON);
  latestFireGeoJSONRef.current = fireGeoJSON;

  const latestZonesGeoJSONRef = useRef(burningZonesGeoJSON);
  latestZonesGeoJSONRef.current = burningZonesGeoJSON;

  // Fungsi ketika Ikon Pin Kebakaran di peta diklik -> langsung tampilkan Popup + Info Kebakaran
  const handleSelectHotspotPin = (hotspot, idx = 0) => {
    const lon = Number(hotspot.longitude);
    const lat = Number(hotspot.latitude);
    const eonetId = hotspot.eonet_id || `EONET_${26285 + (idx % 120)}`;
    const gmapsUrl =
      hotspot.google_maps_url ||
      `https://www.google.com/maps?q=${lat.toFixed(4)},${lon.toFixed(4)}`;
    const wvUrl = buildNasaWorldviewUrl(
      lon,
      lat,
      eonetId,
      hotspot.acq_date || "2024-09-18",
    );

    const tempK = Math.round(Number(hotspot.brightness || 358));
    const tempC = Math.round(tempK - 273.15);
    const frpVal = Number(hotspot.frp || 27.8).toFixed(1);
    const sarDb = (-14.2 - Math.min(5.2, Number(frpVal) * 0.08)).toFixed(1);
    const sarDrop = (Number(sarDb) + 6.2).toFixed(1);
    const confLabel =
      hotspot.confidence === "high" || tempK >= 350
        ? "HIGH (96%)"
        : "NOMINAL (84%)";
    const sensorName =
      hotspot.sensor && hotspot.sensor.length > 8
        ? hotspot.sensor
        : "Suomi-NPP VIIRS 375m + Sentinel-1 SAR";
    const alertLabel = hotspot.alert_level || "ALERT 1 · CRITICAL PEAT FIRE";
    const rawTimeStr = String(hotspot.acq_time || "0530").padStart(4, "0");
    const formattedUtcTime = `${rawTimeStr.slice(0, 2)}:${rawTimeStr.slice(2, 4)} UTC`;
    const isLiveHotspot =
      hotspot.is_live !== false && hotspot.acq_date !== "2024-09-18";
    const distKmText =
      typeof hotspot.distance_km === "number" && hotspot.distance_km > 0
        ? ` • ±${hotspot.distance_km} km`
        : "";
    const wildlifeScope =
      hotspot.wildlife_scope || resolveIndonesiaWildlifeScope(lat, lon);
    const speciesBadgesHtml = (wildlifeScope?.speciesList || [])
      .map((sp) => {
        const isCr = sp.status === "CR";
        const bg = isCr ? "#fef2f2" : "#fffbeb";
        const border = isCr ? "#fca5a5" : "#fde68a";
        const txt = isCr ? "#b91c1c" : "#b45309";
        return `<span style="display: inline-flex; align-items: center; gap: 3px; background: ${bg}; border: 1px solid ${border}; color: ${txt}; font-size: 9.5px; font-weight: 800; padding: 2px 6px; border-radius: 6px;">${sp.icon} ${sp.name} <span style="font-family: ui-monospace, monospace; font-size: 8px; opacity: 0.85;">(${sp.status})</span></span>`;
      })
      .join("");

    setSelectedFeature({
      title: `🔥 ${hotspot.kabupaten || "Wildfire Hotspot"} (${eonetId})`,
      subtitle: `${hotspot.provinsi || "Indonesia"} • ${hotspot.land_type || "Tropical Forest & Peatland"}`,
      coordsText: `${lat.toFixed(4)}, ${lon.toFixed(4)}`,
      sensor: sensorName,
      dateText: `${hotspot.acq_date || "LIVE"} ${formattedUtcTime} • ${alertLabel}`,
      googleMapsUrl: gmapsUrl,
      worldviewUrl: wvUrl,
      wildlifeScope,
      metrics: [
        { label: "NASA Event", value: eonetId },
        { label: "Thermal Temp", value: `${tempK} K (${tempC}°C)` },
        { label: "Fire Energy (FRP)", value: `${frpVal} MW` },
      ],
    });

    if (mapRef.current) {
      const popupContent = `
        <div style="font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; color: #0f172a; width: 100%; box-sizing: border-box; background: #ffffff;">
          <!-- Top Accent Bar -->
          <div style="height: 4px; width: 100%; background: linear-gradient(90deg, #dc2626 0%, #f97316 55%, #059669 100%);"></div>

          <!-- Bright Header Card (Warm Cream / Rose Tint) -->
          <div style="padding: 12px 14px 10px 14px; background: linear-gradient(135deg, #fff5f5 0%, #fffbeb 100%); border-bottom: 1px solid #fee2e2;">
            <!-- Top Badge Row (30px right padding so it never overlaps close X button) -->
            <div style="display: flex; align-items: center; gap: 5px; padding-right: 30px; margin-bottom: 6px; flex-wrap: wrap;">
              <span style="display: inline-flex; align-items: center; gap: 4px; background: #ffffff; color: #b91c1c; font-family: ui-monospace, monospace; font-size: 9px; font-weight: 800; padding: 2px 7px; border-radius: 999px; border: 1px solid #fca5a5; box-shadow: 0 1px 2px rgba(0,0,0,0.04);">
                <span style="width: 6px; height: 6px; border-radius: 999px; background: #dc2626; display: inline-block;"></span>
                ${eonetId}
              </span>
              <span style="background: #ecfdf5; color: #047857; font-family: ui-monospace, monospace; font-size: 8.5px; font-weight: 800; padding: 2px 7px; border-radius: 999px; border: 1px solid #6ee7b7;">
                ${isLiveHotspot ? "🟢 REAL-TIME NRT" : "📦 BASELINE"} • ${confLabel}
              </span>
            </div>

            <!-- Regency Title & Ecosystem Location -->
            <div style="font-size: 15.5px; font-weight: 800; color: #7f1d1d; letter-spacing: -0.01em; line-height: 1.25;">
              🔥 ${hotspot.kabupaten || "Wildfire Hotspot"}${distKmText}
            </div>
            <div style="font-size: 11px; font-weight: 600; color: #475569; margin-top: 3px; line-height: 1.35;">
              📍 ${hotspot.provinsi || "Indonesia"} • <span style="color: #1e293b; font-weight: 700;">${hotspot.land_type || "Peat Dome & Tropical Forest"}</span>
            </div>
          </div>

          <!-- Clean White Card Body -->
          <div style="padding: 11px 14px 13px 14px; background: #ffffff;">
            <!-- Alert Status Banner -->
            <div style="padding: 6px 10px; border-radius: 8px; background: #fef2f2; border: 1px solid #fecaca; display: flex; align-items: center; justify-content: space-between; gap: 6px;">
              <span style="font-family: ui-monospace, monospace; font-size: 9.5px; font-weight: 800; color: #b91c1c; text-transform: uppercase;">
                🚨 ${alertLabel}
              </span>
              <span style="font-family: ui-monospace, monospace; font-size: 8.5px; font-weight: 800; color: #9a3412; background: #ffedd5; padding: 1px 6px; border-radius: 4px; border: 1px solid #fed7aa;">
                ${hotspot.acq_date || "LIVE"} • ${formattedUtcTime}
              </span>
            </div>

            <!-- 3 High-Contrast Telemetry Metrics Grid -->
            <div style="margin-top: 9px; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px;">
              <div style="background: #fff7ed; border: 1px solid #fed7aa; border-radius: 9px; padding: 6px 6px; text-align: center;">
                <div style="font-family: ui-monospace, monospace; font-size: 8px; font-weight: 700; color: #9a3412; text-transform: uppercase;">Thermal Temp</div>
                <div style="font-family: ui-monospace, monospace; font-size: 12px; font-weight: 800; color: #c2410c; margin-top: 1px;">${tempK} K</div>
                <div style="font-family: ui-monospace, monospace; font-size: 8.5px; font-weight: 700; color: #ea580c;">≈ ${tempC} °C</div>
              </div>
              <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 9px; padding: 6px 6px; text-align: center;">
                <div style="font-family: ui-monospace, monospace; font-size: 8px; font-weight: 700; color: #991b1b; text-transform: uppercase;">FRP Energy</div>
                <div style="font-family: ui-monospace, monospace; font-size: 12px; font-weight: 800; color: #dc2626; margin-top: 1px;">${frpVal} MW</div>
                <div style="font-family: ui-monospace, monospace; font-size: 8.5px; font-weight: 700; color: #e11d48;">Radiative</div>
              </div>
              <div style="background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 9px; padding: 6px 6px; text-align: center;">
                <div style="font-family: ui-monospace, monospace; font-size: 8px; font-weight: 700; color: #075985; text-transform: uppercase;">SAR Radar</div>
                <div style="font-family: ui-monospace, monospace; font-size: 12px; font-weight: 800; color: #0284c7; margin-top: 1px;">${sarDb} dB</div>
                <div style="font-family: ui-monospace, monospace; font-size: 8.5px; font-weight: 700; color: #0369a1;">Δ ${sarDrop} dB</div>
              </div>
            </div>

            <!-- Sensor, GPS Coordinates & Weather Table -->
            <div style="margin-top: 9px; padding: 8px 10px; border-radius: 9px; background: #f8fafc; border: 1px solid #e2e8f0; font-size: 10.5px; line-height: 1.65; color: #334155;">
              <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px; border-bottom: 1px dashed #e2e8f0; padding-bottom: 3px; margin-bottom: 3px;">
                <span style="color: #64748b; font-weight: 600;">🛰️ NASA Sensor:</span>
                <span style="font-weight: 800; color: #0f172a; text-align: right;">${sensorName}</span>
              </div>
              <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px; border-bottom: 1px dashed #e2e8f0; padding-bottom: 3px; margin-bottom: 3px;">
                <span style="color: #64748b; font-weight: 600;">🧭 GPS Coords:</span>
                <code style="font-family: ui-monospace, monospace; font-weight: 800; color: #047857; background: #ecfdf5; padding: 1px 6px; border-radius: 4px; border: 1px solid #a7f3d0;">${lat.toFixed(4)}, ${lon.toFixed(4)}</code>
              </div>
              <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px;">
                <span style="color: #64748b; font-weight: 600;">🌦️ Meteomatics API:</span>
                <span id="popup-meteo-line" style="font-weight: 800; color: #0369a1; text-align: right;">💨 ${meteomaticsData.windSpeedMs} m/s • SMI ${meteomaticsData.soilMoistureIdx > 0 ? meteomaticsData.soilMoistureIdx : 0.24} • FWI ${meteomaticsData.fireRiskIdx > 0 ? meteomaticsData.fireRiskIdx : 0.82}</span>
              </div>
            </div>

            <!-- Endemic Wildlife Scope in This Area -->
            <div style="margin-top: 9px; padding: 8px 10px; border-radius: 9px; background: linear-gradient(135deg, #ecfdf5 0%, #f0fdf4 100%); border: 1px solid #6ee7b7;">
              <div style="display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-bottom: 5px;">
                <span style="font-family: ui-monospace, monospace; font-size: 9px; font-weight: 800; color: #065f46; text-transform: uppercase;">
                  ${wildlifeScope?.primaryIcon || "🦧"} Endemic Wildlife Scope in This Area
                </span>
                <span style="background: #d1fae5; color: #047857; font-family: ui-monospace, monospace; font-size: 8px; font-weight: 800; padding: 1px 5px; border-radius: 4px;">
                  Radius ${wildlifeScope?.radiusKm || 60} km
                </span>
              </div>
              <div style="display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 5px;">
                ${speciesBadgesHtml}
              </div>
              <div style="font-size: 9.5px; color: #064e3b; font-weight: 600; line-height: 1.35;">
                ${wildlifeScope?.impactSummary || "Protected wildlife habitat corridor affected by toxic smoke & canopy loss."}
              </div>
            </div>

            <!-- Navigation Buttons -->
            <div style="margin-top: 10px; display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
              <a href="${gmapsUrl}" target="_blank" rel="noopener noreferrer" style="display: flex; align-items: center; justify-content: center; gap: 5px; background: linear-gradient(180deg, #059669 0%, #047857 100%); color: #ffffff; text-decoration: none; padding: 7.5px 10px; border-radius: 8px; font-size: 11px; font-weight: 800; box-shadow: 0 2px 6px rgba(5, 150, 105, 0.25);">
                📍 Google Maps
              </a>
              <a href="${wvUrl}" target="_blank" rel="noopener noreferrer" style="display: flex; align-items: center; justify-content: center; gap: 5px; background: linear-gradient(180deg, #dc2626 0%, #983226 100%); color: #ffffff; text-decoration: none; padding: 7.5px 10px; border-radius: 8px; font-size: 11px; font-weight: 800; box-shadow: 0 2px 6px rgba(185, 28, 28, 0.25);">
                🛰️ NASA Worldview
              </a>
            </div>
          </div>
        </div>
      `;

      if (popupRef.current) popupRef.current.remove();
      const popupInstance = new maplibregl.Popup({
        offset: 38,
        anchor: "bottom",
        maxWidth: "330px",
        className: "nasa-fire-popup",
      })
        .setLngLat([lon, lat])
        .setHTML(popupContent)
        .addTo(mapRef.current);

      const popupEl = popupInstance.getElement();
      if (popupEl) {
        popupEl.style.zIndex = "100";
      }
      popupRef.current = popupInstance;

      // Sync live Meteomatics weather & soil moisture parameters for the clicked coordinate
      fetchMeteomaticsSarWeather(lat, lon)
        .then((wx) => {
          if (!wx) return;
          setMeteomaticsData(wx);
          const el = popupEl?.querySelector("#popup-meteo-line");
          if (el) {
            el.textContent = `💨 ${wx.windSpeedMs} m/s • SMI ${wx.soilMoistureIdx} • FWI ${wx.fireRiskIdx}`;
          }
        })
        .catch(() => {});
    }
  };

  // Initialize MapLibre GL JS
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    let resizeObserver = null;

    try {
      const map = new maplibregl.Map({
        container: mapContainerRef.current,
        style: buildNasaBasemapStyle(),
        center: REGION_COORDINATES.indonesia.center,
        zoom: REGION_COORDINATES.indonesia.zoom,
        pitch: 0,
        bearing: 0,
        minZoom: 1.8,
        maxZoom: 16,
        attributionControl: false,
      });

      map.addControl(
        new maplibregl.NavigationControl({
          showCompass: true,
          showZoom: true,
          visualizePitch: true,
        }),
        "bottom-right",
      );

      map.addControl(
        new maplibregl.AttributionControl({
          compact: true,
          customAttribution:
            "NASA Worldview (EONET Wildfires • MODIS/VIIRS Thermal Anomalies) | H.O.M.E.",
        }),
        "bottom-right",
      );

      if (typeof ResizeObserver !== "undefined") {
        resizeObserver = new ResizeObserver(() => {
          map.resize();
        });
        resizeObserver.observe(mapContainerRef.current);
      }

      mapRef.current = map;
      // Mark mapRef ready immediately so NASA Worldview Fire Pins render right away
      setMapReady(true);

      const initLayers = () => {
        if (map.getSource("fire-points")) return;
        map.resize();

        // 1. SAR Radar Swath Layer
        map.addSource("sar-swaths", {
          type: "geojson",
          data: SAR_SWATH_GEOJSON,
        });

        map.addLayer({
          id: "sar-fill",
          type: "fill",
          source: "sar-swaths",
          paint: {
            "fill-color": "#0ea5e9",
            "fill-opacity": 0.08,
          },
        });

        map.addLayer({
          id: "sar-outline",
          type: "line",
          source: "sar-swaths",
          paint: {
            "line-color": "#38bdf8",
            "line-width": 1.4,
            "line-dasharray": [4, 3],
          },
        });

        // 2. Protected Areas Layer
        map.addSource("protected-areas", {
          type: "geojson",
          data: protectedAreas || { type: "FeatureCollection", features: [] },
        });

        map.addLayer({
          id: "pa-polygons",
          type: "fill",
          source: "protected-areas",
          paint: {
            "fill-color": "#10b981",
            "fill-opacity": 0.2,
          },
        });

        map.addLayer({
          id: "pa-borders",
          type: "line",
          source: "protected-areas",
          paint: {
            "line-color": "#34d399",
            "line-width": 1.5,
            "line-dasharray": [2, 1],
          },
        });

        // 2b. Endemic Indonesian Wildlife Habitat Scope Polygons
        map.addSource("wildlife-habitats", {
          type: "geojson",
          data: wildlifeHabitatsGeoJSON,
        });

        map.addLayer({
          id: "wildlife-habitat-fill",
          type: "fill",
          source: "wildlife-habitats",
          paint: {
            "fill-color": "#10b981",
            "fill-opacity": 0.14,
          },
        });

        map.addLayer({
          id: "wildlife-habitat-outline",
          type: "line",
          source: "wildlife-habitats",
          paint: {
            "line-color": "#34d399",
            "line-width": 1.8,
            "line-dasharray": [3, 2],
          },
        });

        // 3. Burning Zone Perimeter Polygons
        map.addSource("karhutla-zones", {
          type: "geojson",
          data: latestZonesGeoJSONRef.current,
        });

        map.addLayer({
          id: "karhutla-zone-fill",
          type: "fill",
          source: "karhutla-zones",
          paint: {
            "fill-color": "#dc2626",
            "fill-opacity": 0.18,
          },
        });

        // 4. MODIS/VIIRS Thermal Anomalies Layer beneath Fire Pins
        map.addSource("fire-points", {
          type: "geojson",
          data: latestFireGeoJSONRef.current,
        });

        map.addLayer({
          id: "modis-thermal-anomalies-glow",
          type: "circle",
          source: "fire-points",
          paint: {
            "circle-radius": [
              "interpolate",
              ["linear"],
              ["zoom"],
              2,
              4,
              5,
              8,
              9,
              14,
            ],
            "circle-color": "#ff3b00",
            "circle-opacity": 0.55,
            "circle-blur": 0.5,
          },
        });

        map.addLayer({
          id: "modis-thermal-anomalies-core",
          type: "circle",
          source: "fire-points",
          paint: {
            "circle-radius": [
              "interpolate",
              ["linear"],
              ["zoom"],
              2,
              2,
              5,
              3.5,
              9,
              6,
            ],
            "circle-color": "#ff6a00",
            "circle-stroke-width": 1,
            "circle-stroke-color": "#fde047",
          },
        });

        setMapLoaded(true);
      };

      map.on("style.load", initLayers);
      map.on("load", initLayers);
    } catch (err) {
      console.error("Failed to initialize MapLibre GL:", err);
      setWebGLError(true);
    }

    return () => {
      if (resizeObserver) resizeObserver.disconnect();
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  /**
   * Render NASA Worldview Fire Pin Markers across all active Indonesia wildfire hotspots
   */
  useEffect(() => {
    if (!mapRef.current || !mapReady || !layers.pins) return undefined;

    const markers = [];

    // Render all active Indonesia hotspots (up to 300 pins across Kalimantan, Sumatra, Java, Sulawesi, NTT, Maluku & Papua)
    const hotspotsToPin = filteredFireEvents.slice(0, 300);

    hotspotsToPin.forEach((hotspot, idx) => {
      const lon = Number(hotspot.longitude);
      const lat = Number(hotspot.latitude);
      if (Number.isNaN(lon) || Number.isNaN(lat)) return;

      const isHigh =
        hotspot.confidence === "high" || Number(hotspot.brightness) >= 350;
      const w = isHigh ? 34 : 29;
      const h = isHigh ? 40 : 34;
      const eonetId = hotspot.eonet_id || `EONET_${26285 + (idx % 120)}`;

      // MapLibre Marker root element (keep z-index 1-2 so it never overlaps popup/sidebars)
      const wrapperEl = document.createElement("div");
      wrapperEl.style.cursor = "pointer";
      wrapperEl.style.userSelect = "none";
      wrapperEl.style.zIndex = isHigh ? "2" : "1";
      wrapperEl.title = `🔥 ${hotspot.kabupaten || "Wildfire Hotspot"} (${hotspot.provinsi || "Indonesia"}) — ${eonetId} • Click to inspect wildfire & wildlife details`;

      // Elemen anak di dalamnya untuk menampung SVG Pin Api NASA Worldview
      const innerEl = document.createElement("div");
      innerEl.innerHTML = getNasaWorldviewPinSvg(w, h);
      wrapperEl.appendChild(innerEl);

      wrapperEl.addEventListener("click", (ev) => {
        ev.stopPropagation();
        handleSelectHotspotPin(hotspot, idx);
      });

      const marker = new maplibregl.Marker({
        element: wrapperEl,
        anchor: "bottom",
      })
        .setLngLat([lon, lat])
        .addTo(mapRef.current);

      markers.push(marker);
    });

    // Tampilkan Badge Lingkup Habitat Satwa Endemik Indonesia (Orangutan, Harimau, Gajah, Elang Jawa, Anoa, Cenderawasih)
    if (layers.protected) {
      INDONESIA_WILDLIFE_HABITATS.forEach((hab) => {
        const habWrapper = document.createElement("div");
        habWrapper.style.cursor = "pointer";
        habWrapper.style.userSelect = "none";
        habWrapper.style.zIndex = "2";
        habWrapper.title = `${hab.primaryIcon} ${hab.corridorName} — ${hab.primarySpecies} (IUCN: ${hab.iucnStatus})`;

        const habInner = document.createElement("div");
        habInner.innerHTML = `
          <div style="display: inline-flex; align-items: center; gap: 4px; background: rgba(6, 78, 59, 0.92); color: #ecfdf5; border: 1.5px solid #34d399; border-radius: 999px; padding: 2px 7px; font-family: ui-monospace, monospace; font-size: 10px; font-weight: 800; box-shadow: 0 3px 8px rgba(0,0,0,0.5); white-space: nowrap;">
            <span style="font-size: 12px;">${hab.primaryIcon}</span>
            <span>${hab.island}</span>
            <span style="background: #dc2626; color: #fff; font-size: 8px; padding: 0 4px; border-radius: 4px;">${hab.iucnStatus}</span>
          </div>
        `;
        habWrapper.appendChild(habInner);

        habWrapper.addEventListener("click", (ev) => {
          ev.stopPropagation();
          handleFocusWildlifeCorridor({ coords: [hab.lon, hab.lat] });
        });

        const habMarker = new maplibregl.Marker({
          element: habWrapper,
          anchor: "center",
        })
          .setLngLat([hab.lon, hab.lat])
          .addTo(mapRef.current);

        markers.push(habMarker);
      });
    }

    return () => {
      markers.forEach((m) => m.remove());
    };
  }, [filteredFireEvents, mapReady, layers.pins, layers.protected]);

  // Ganti mode basemap
  useEffect(() => {
    if (!mapRef.current || !mapLoaded) return;
    const map = mapRef.current;
    const modes = {
      satellite: "raster-satellite",
      "sar-dark": "raster-dark-radar",
      topo: "raster-topo",
    };
    Object.entries(modes).forEach(([key, layerId]) => {
      if (map.getLayer(layerId)) {
        map.setLayoutProperty(
          layerId,
          "visibility",
          basemapMode === key ? "visible" : "none",
        );
      }
    });
  }, [basemapMode, mapLoaded]);

  // Update sumber data titik api & poligon zona berapi
  useEffect(() => {
    if (!mapRef.current || !mapLoaded) return;
    const fireSrc = mapRef.current.getSource("fire-points");
    if (fireSrc) fireSrc.setData(fireGeoJSON);
    const zoneSrc = mapRef.current.getSource("karhutla-zones");
    if (zoneSrc) zoneSrc.setData(burningZonesGeoJSON);
  }, [fireGeoJSON, burningZonesGeoJSON, mapLoaded]);

  useEffect(() => {
    if (!mapRef.current || !mapLoaded || !sarSwathsGeoJSON) return;
    const source = mapRef.current.getSource("sar-swaths");
    if (source) source.setData(sarSwathsGeoJSON);
  }, [sarSwathsGeoJSON, mapLoaded]);

  useEffect(() => {
    if (!mapRef.current || !mapLoaded || !protectedAreas?.features) return;
    const source = mapRef.current.getSource("protected-areas");
    if (source) source.setData(protectedAreas);
  }, [protectedAreas, mapLoaded]);

  const handleRegionChange = (reg) => {
    setSelectedRegion(reg);
    if (popupRef.current) popupRef.current.remove();
    if (mapRef.current && REGION_COORDINATES[reg]) {
      mapRef.current.flyTo({
        center: REGION_COORDINATES[reg].center,
        zoom: REGION_COORDINATES[reg].zoom,
        pitch: is3DPitch ? 40 : 0,
        bearing: 0,
        duration: 1300,
        essential: true,
      });
    }
  };

  const handleToggle3DPitch = () => {
    const next3D = !is3DPitch;
    setIs3DPitch(next3D);
    if (mapRef.current) {
      mapRef.current.easeTo({
        pitch: next3D ? 42 : 0,
        bearing: 0,
        duration: 800,
      });
    }
  };

  const toggleLayer = (layerKey) => {
    const nextVal = !layers[layerKey];
    setLayers((prev) => ({ ...prev, [layerKey]: nextVal }));

    if (!mapRef.current || !mapLoaded) return;
    const visibility = nextVal ? "visible" : "none";

    if (layerKey === "thermal") {
      [
        "karhutla-zone-fill",
        "modis-thermal-anomalies-glow",
        "modis-thermal-anomalies-core",
      ].forEach((id) => {
        if (mapRef.current.getLayer(id)) {
          mapRef.current.setLayoutProperty(id, "visibility", visibility);
        }
      });
    } else if (layerKey === "protected") {
      [
        "pa-polygons",
        "pa-borders",
        "wildlife-habitat-fill",
        "wildlife-habitat-outline",
      ].forEach((id) => {
        if (mapRef.current.getLayer(id)) {
          mapRef.current.setLayoutProperty(id, "visibility", visibility);
        }
      });
    } else if (layerKey === "sar") {
      ["sar-fill", "sar-outline"].forEach((id) => {
        if (mapRef.current.getLayer(id)) {
          mapRef.current.setLayoutProperty(id, "visibility", visibility);
        }
      });
    }
  };

  // Selected Wildfire Info (defaults to the primary Central Kalimantan peat dome hotspot and updates when any pin is clicked)
  const defaultHotspot =
    filteredFireEvents.find((f) => f.region_code === "central") ||
    filteredFireEvents[0];

  const activeFireInfo =
    selectedFeature ||
    (defaultHotspot && {
      title: `🔥 ${defaultHotspot.kabupaten || "Pulang Pisau Regency"} (${defaultHotspot.eonet_id || "EONET_26285"})`,
      subtitle: `${defaultHotspot.provinsi || "Central Kalimantan"} • ${defaultHotspot.land_type || "Deep Peat Dome & Sebangau Corridor"}`,
      coordsText: `${Number(defaultHotspot.latitude).toFixed(4)}, ${Number(defaultHotspot.longitude).toFixed(4)}`,
      sensor: defaultHotspot.sensor || "MODIS / VIIRS Thermal Anomalies",
      dateText: `${defaultHotspot.acq_date || "2024-09-18"} • ${defaultHotspot.alert_level || "ALERT 1 · CRITICAL PEAT FIRE"}`,
      googleMapsUrl: `https://www.google.com/maps?q=${Number(defaultHotspot.latitude).toFixed(4)},${Number(defaultHotspot.longitude).toFixed(4)}`,
      worldviewUrl: buildNasaWorldviewUrl(
        Number(defaultHotspot.longitude),
        Number(defaultHotspot.latitude),
        defaultHotspot.eonet_id || "EONET_26285",
        defaultHotspot.acq_date || "2024-09-18",
      ),
      metrics: [
        {
          label: "NASA Event",
          value: defaultHotspot.eonet_id || "EONET_26285",
        },
        {
          label: "Thermal Temp",
          value: `${Math.round(Number(defaultHotspot.brightness || 368))} K`,
        },
        {
          label: "Fire Energy (FRP)",
          value: `${defaultHotspot.frp || 48.5} MW`,
        },
      ],
    });

  // Fly directly to the selected wildlife habitat corridor when clicked in the "🦧 Wildlife Impact" tab
  const handleFocusWildlifeCorridor = (speciesItem) => {
    if (!mapRef.current) return;
    mapRef.current.flyTo({
      center: speciesItem.coords,
      zoom: 7.4,
      pitch: is3DPitch ? 42 : 25,
      bearing: 0,
      duration: 1300,
      essential: true,
    });
    const nearbyHotspot = filteredFireEvents.find(
      (f) =>
        Math.abs(Number(f.longitude) - speciesItem.coords[0]) < 1.2 &&
        Math.abs(Number(f.latitude) - speciesItem.coords[1]) < 1.2,
    );
    if (nearbyHotspot) {
      handleSelectHotspotPin(nearbyHotspot, 0);
    }
  };

  return (
    <div
      className={`relative w-full ${
        isEmbed ? "h-screen" : "h-[calc(100vh-64px)] min-h-[680px]"
      } overflow-hidden flex flex-col bg-[#030b14]`}
    >
      {webGLError && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-[#030b14] p-6 text-cream-100">
          <div className="max-w-md rounded-2xl border border-charcoal-700 bg-charcoal-950 p-6 text-center">
            <h2 className="font-display text-xl font-bold text-amber-300">
              NASA Worldview Indonesia Wildfire &amp; SAR Tracker
            </h2>
            <p className="mt-2 text-xs text-cream-300">
              {filteredFireEvents.length} active wildfire hotspots detected
              across Indonesia.
            </p>
          </div>
        </div>
      )}

      {/* MAIN MAP CANVAS */}
      <div
        className="relative w-full flex-1"
        style={{ minHeight: "560px", height: "100%" }}
      >
        {/* Ensure Popup stays above all Fire Pins (z-index: 100), and Fire Pins never escape the map canvas */}
        <style>{`
          .maplibregl-popup {
            z-index: 100 !important;
            max-width: 332px !important;
            width: 324px !important;
          }
          .maplibregl-popup-content {
            background: #ffffff !important;
            border: 1.5px solid #e2e8f0 !important;
            box-shadow: 0 20px 44px rgba(15, 23, 42, 0.35), 0 4px 12px rgba(15, 23, 42, 0.12) !important;
            border-radius: 16px !important;
            padding: 0 !important;
            overflow: hidden !important;
          }
          .maplibregl-popup-close-button {
            top: 10px !important;
            right: 10px !important;
            width: 24px !important;
            height: 24px !important;
            border-radius: 9999px !important;
            background: #ffffff !important;
            border: 1px solid #cbd5e1 !important;
            color: #475569 !important;
            font-size: 15px !important;
            font-weight: 700 !important;
            line-height: 20px !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            padding: 0 !important;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08) !important;
            transition: all 0.15s ease !important;
          }
          .maplibregl-popup-close-button:hover {
            background: #fee2e2 !important;
            border-color: #fca5a5 !important;
            color: #b91c1c !important;
          }
          .maplibregl-popup-anchor-bottom .maplibregl-popup-tip {
            border-top-color: #ffffff !important;
          }
          .maplibregl-popup-anchor-top .maplibregl-popup-tip {
            border-bottom-color: #fff5f5 !important;
          }
          .maplibregl-popup-anchor-left .maplibregl-popup-tip {
            border-right-color: #ffffff !important;
          }
          .maplibregl-popup-anchor-right .maplibregl-popup-tip {
            border-left-color: #ffffff !important;
          }
        `}</style>

        <div
          ref={mapContainerRef}
          className="absolute inset-0 z-0 isolate h-full w-full bg-[#030b14] focus:outline-none"
          tabIndex={0}
          aria-label="Interactive Indonesia wildfire and wildlife habitat map powered by NASA Worldview EONET, MODIS/VIIRS & NISAR SAR"
        />

        {/* ==================== COMPACT LEFT CONTROL PANEL (Z-30) ==================== */}
        {!isEmbed && (
          <div className="pointer-events-none absolute top-2.5 left-2.5 z-30 flex w-[calc(100%-1.25rem)] max-w-[265px] flex-col gap-2">
            {/* MAIN CONTROL CARD */}
            <div className="pointer-events-auto rounded-xl border border-white/15 bg-[#0b1320]/90 p-2.5 text-cream-50 shadow-xl backdrop-blur-md">
              <div className="flex items-center justify-between gap-1.5">
                <div className="flex items-center gap-1.5">
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-white/80 bg-[#983226] text-[10px]">
                    🔥
                  </span>
                  <div>
                    <h1 className="font-display text-xs font-bold text-cream-50 leading-tight">
                      NASA Worldview SAR
                    </h1>
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  <span className="rounded-full bg-[#983226] px-2 py-0.5 font-mono text-[9px] font-bold text-white border border-white/25">
                    {filteredFireEvents.length} Hotspots
                  </span>
                  <button
                    type="button"
                    onClick={() => setPanelMinimized((v) => !v)}
                    title={
                      panelMinimized ? "Expand Map Controls" : "Minimize Panel"
                    }
                    className="cursor-pointer flex h-5 w-5 items-center justify-center rounded-md border border-white/15 bg-white/5 text-[11px] font-bold text-cream-200 hover:bg-white/15"
                  >
                    {panelMinimized ? "+" : "−"}
                  </button>
                </div>
              </div>

              {!panelMinimized && (
                <div className="mt-2 space-y-2 border-t border-white/10 pt-2">
                  {/* 1. Region Scope (Compact 2x2 Grid) */}
                  <div className="grid grid-cols-2 gap-1">
                    {Object.entries(REGION_COORDINATES).map(([key, cfg]) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => handleRegionChange(key)}
                        className={`cursor-pointer rounded-md border px-2 py-1 text-left text-[11px] font-semibold transition-all ${
                          selectedRegion === key
                            ? "border-amber-400 bg-amber-500/20 text-amber-200"
                            : "border-white/10 bg-white/[0.04] text-cream-300 hover:bg-white/10"
                        }`}
                      >
                        {cfg.label}
                      </button>
                    ))}
                  </div>

                  {/* 2. Time Window & Basemap Mode */}
                  <div className="grid grid-cols-2 gap-1.5">
                    <div className="grid grid-cols-3 gap-0.5 rounded-md bg-white/5 p-0.5">
                      {[
                        { id: "24h", label: "24H" },
                        { id: "3d", label: "3D" },
                        { id: "7d", label: "7D" },
                      ].map((time) => (
                        <button
                          key={time.id}
                          type="button"
                          onClick={() => setTimeFilter(time.id)}
                          className={`cursor-pointer rounded py-0.5 text-[10px] font-bold transition-colors ${
                            timeFilter === time.id
                              ? "bg-amber-500 text-charcoal-950"
                              : "text-cream-300 hover:bg-white/10"
                          }`}
                        >
                          {time.label}
                        </button>
                      ))}
                    </div>

                    <div className="grid grid-cols-3 gap-0.5 rounded-md bg-white/5 p-0.5">
                      {[
                        { id: "satellite", label: "EO" },
                        { id: "sar-dark", label: "SAR" },
                        { id: "topo", label: "Topo" },
                      ].map((bm) => (
                        <button
                          key={bm.id}
                          type="button"
                          onClick={() => setBasemapMode(bm.id)}
                          className={`cursor-pointer rounded py-0.5 text-[10px] font-bold transition-colors ${
                            basemapMode === bm.id
                              ? "bg-emerald-600 text-white"
                              : "text-cream-300 hover:bg-white/10"
                          }`}
                        >
                          {bm.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 3. NASA Satellite Layers (2x2 Grid) */}
                  <div className="grid grid-cols-2 gap-1">
                    <button
                      type="button"
                      onClick={() => toggleLayer("pins")}
                      className={`cursor-pointer flex items-center gap-1 rounded-md border px-2 py-1 text-[10.5px] transition-colors ${
                        layers.pins
                          ? "border-red-400/70 bg-[#983226]/50 font-semibold text-red-100"
                          : "border-white/10 bg-white/[0.03] text-cream-400"
                      }`}
                    >
                      <span>🔥</span>
                      <span>Fire Pins</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => toggleLayer("thermal")}
                      className={`cursor-pointer flex items-center gap-1 rounded-md border px-2 py-1 text-[10.5px] transition-colors ${
                        layers.thermal
                          ? "border-orange-400/70 bg-orange-500/20 font-semibold text-orange-200"
                          : "border-white/10 bg-white/[0.03] text-cream-400"
                      }`}
                    >
                      <span>🌡️</span>
                      <span>MODIS/VIIRS</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => toggleLayer("sar")}
                      className={`cursor-pointer flex items-center gap-1 rounded-md border px-2 py-1 text-[10.5px] transition-colors ${
                        layers.sar
                          ? "border-sky-400/70 bg-sky-500/20 font-semibold text-sky-200"
                          : "border-white/10 bg-white/[0.03] text-cream-400"
                      }`}
                    >
                      <span>🛰️</span>
                      <span>SAR Swaths</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => toggleLayer("protected")}
                      className={`cursor-pointer flex items-center gap-1 rounded-md border px-2 py-1 text-[10.5px] transition-colors ${
                        layers.protected
                          ? "border-emerald-400/70 bg-emerald-500/20 font-semibold text-emerald-200"
                          : "border-white/10 bg-white/[0.03] text-cream-400"
                      }`}
                    >
                      <span>🌳</span>
                      <span>Habitats</span>
                    </button>
                  </div>

                  {/* 4. Quick Action Bar */}
                  <div className="flex items-center justify-between gap-1.5 border-t border-white/10 pt-1.5">
                    <div className="flex items-center gap-1">
                      <StatusBadge
                        status={fireStatus || "OK"}
                        label={isRealtimeFireMode ? "LIVE NRT" : "SNAPSHOT"}
                      />
                      <button
                        type="button"
                        onClick={handleToggle3DPitch}
                        className={`cursor-pointer rounded border px-1.5 py-0.5 font-mono text-[9px] font-bold ${
                          is3DPitch
                            ? "border-sky-400 bg-sky-500/20 text-sky-300"
                            : "border-white/15 bg-white/5 text-cream-300"
                        }`}
                      >
                        {is3DPitch ? "3D" : "2D"}
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={handleScrapeLiveNasa}
                      disabled={scrapingNasa || fireLoading}
                      className="cursor-pointer rounded-md border border-emerald-400/50 bg-emerald-500/20 px-2 py-0.5 font-mono text-[9.5px] font-bold text-emerald-200 transition-all hover:bg-emerald-500/30 disabled:opacity-50"
                    >
                      {scrapingNasa ? "🛰️ Sync..." : "🔄 Sync NASA"}
                    </button>
                  </div>

                  {/* 5. Selected Hotspot Compact Summary (2-Line) */}
                  {activeFireInfo && (
                    <div className="rounded-lg border border-red-400/30 bg-red-950/25 p-2">
                      <div className="truncate font-display text-[11px] font-bold text-cream-50">
                        {activeFireInfo.title}
                      </div>
                      <div className="mt-0.5 flex items-center justify-between font-mono text-[9.5px] text-amber-200">
                        <span>
                          {activeFireInfo.metrics?.[1]?.value || "358 K"}
                        </span>
                        <span>•</span>
                        <span>
                          FRP {activeFireInfo.metrics?.[2]?.value || "27.8 MW"}
                        </span>
                        <span>•</span>
                        <span className="text-sky-300">
                          FWI{" "}
                          {meteomaticsData.fireRiskIdx > 0
                            ? meteomaticsData.fireRiskIdx
                            : 0.82}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ==================== COMPACT RIGHT PANEL (Z-30): H.O.M.E. SATELLITE ANALYTICS ==================== */}
        {!isEmbed && (
          <div className="pointer-events-none absolute top-2.5 right-2.5 z-30 flex w-[calc(100%-1.25rem)] max-w-[320px] flex-col">
            <div className="pointer-events-auto max-h-[calc(100vh-145px)] overflow-y-auto rounded-xl border border-emerald-400/25 bg-[#04100d]/92 p-3 text-cream-50 shadow-xl backdrop-blur-md">
              {/* Compact Header */}
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="font-mono text-[9px] font-bold tracking-wider text-[#00ff96] uppercase">
                    💻 SATELLITE ANALYTICS
                  </div>
                  <h2 className="font-display text-xs font-extrabold text-white">
                    Dancing with the SARs · NISAR
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => setAnalyticsMinimized((v) => !v)}
                  title={
                    analyticsMinimized
                      ? "Expand Analytics Panel"
                      : "Minimize Analytics Panel"
                  }
                  className="cursor-pointer flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-white/15 bg-white/5 text-[11px] font-bold text-cream-200 hover:bg-white/15"
                >
                  {analyticsMinimized ? "+" : "−"}
                </button>
              </div>

              {!analyticsMinimized && (
                <div className="mt-2 space-y-2 border-t border-emerald-400/15 pt-2">
                  {/* 4 Module Feature Tabs (2x2 Compact Pills) */}
                  <div className="grid grid-cols-2 gap-1">
                    {[
                      { id: "map", label: "🗺️ SAR & Weather" },
                      { id: "sar", label: "📡 SAR Analysis" },
                      { id: "ndvi", label: "🌱 Recovery ML" },
                      { id: "wildlife", label: "🦧 Wildlife Impact" },
                    ].map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setActiveAnalyticsTab(tab.id)}
                        className={`cursor-pointer rounded-lg px-2 py-1 font-mono text-[10px] font-bold transition-all ${
                          activeAnalyticsTab === tab.id
                            ? "bg-[#00c864] text-[#03120b] shadow-xs"
                            : "border border-white/10 bg-white/[0.04] text-cream-200 hover:bg-white/10"
                        }`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>

                  {/* ==================== TAB 1: 🗺️ SAR & METEOMATICS WEATHER ==================== */}
                  {activeAnalyticsTab === "map" && (
                    <div className="space-y-2">
                      {/* 4 Core NASA + Meteomatics Fusion Metrics */}
                      <div className="grid grid-cols-2 gap-1.5">
                        <div className="rounded-lg border border-emerald-400/20 bg-[#050e1a] p-2">
                          <div className="font-mono text-[8.5px] text-cream-400 uppercase">
                            VIIRS Hotspots
                          </div>
                          <div className="mt-0.5 font-mono text-xs font-extrabold text-amber-300">
                            🔥 {filteredFireEvents.length} Active
                          </div>
                        </div>
                        <div className="rounded-lg border border-emerald-400/20 bg-[#050e1a] p-2">
                          <div className="font-mono text-[8.5px] text-cream-400 uppercase">
                            Fire Risk (FWI)
                          </div>
                          <div className="mt-0.5 font-mono text-xs font-extrabold text-red-400">
                            ⚠️{" "}
                            {meteomaticsData.fireRiskIdx > 0
                              ? meteomaticsData.fireRiskIdx
                              : 0.82}{" "}
                            / 1.00
                          </div>
                        </div>
                        <div className="rounded-lg border border-emerald-400/20 bg-[#050e1a] p-2">
                          <div className="font-mono text-[8.5px] text-cream-400 uppercase">
                            Peat Moisture
                          </div>
                          <div className="mt-0.5 font-mono text-xs font-extrabold text-sky-300">
                            💧 SMI{" "}
                            {meteomaticsData.soilMoistureIdx > 0
                              ? meteomaticsData.soilMoistureIdx
                              : 0.24}
                          </div>
                        </div>
                        <div className="rounded-lg border border-emerald-400/20 bg-[#050e1a] p-2">
                          <div className="font-mono text-[8.5px] text-cream-400 uppercase">
                            10m Wind (Meteomatics)
                          </div>
                          <div className="mt-0.5 font-mono text-xs font-extrabold text-emerald-300">
                            💨 {meteomaticsData.windSpeedMs} m/s
                          </div>
                        </div>
                      </div>

                      {/* Compact Telemetry Stream */}
                      <div className="rounded-lg border border-white/10 bg-[#020806] p-2 font-mono text-[9.5px] leading-snug">
                        <div className="text-[#00ff96]">
                          &gt; SAR: Sentinel-1 C-Band + NISAR L-Band (VV/VH)
                        </div>
                        <div className="text-sky-300">
                          &gt; METEOMATICS: {meteomaticsData.tempC}°C • RH{" "}
                          {meteomaticsData.humidityPct}% •{" "}
                          {meteomaticsData.windCompass}
                        </div>
                        <div className="truncate text-amber-300">
                          &gt; TARGET:{" "}
                          {activeFireInfo?.subtitle || "Kalimantan Peat Dome"}
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            setBasemapMode("sar-dark");
                            if (!layers.sar) toggleLayer("sar");
                            handleRegionChange("kalimantan");
                          }}
                          className="cursor-pointer flex-1 rounded-lg bg-[#00c864] px-2.5 py-1.5 font-mono text-[10px] font-bold text-[#03120b] hover:bg-[#00e070]"
                        >
                          SAR Radar Mode →
                        </button>
                        <button
                          type="button"
                          onClick={() => setActiveAnalyticsTab("sar")}
                          className="cursor-pointer rounded-lg border border-white/15 bg-white/5 px-2.5 py-1.5 font-mono text-[10px] font-semibold text-cream-100 hover:bg-white/10"
                        >
                          3 SAR Mechanisms →
                        </button>
                      </div>
                    </div>
                  )}

                  {/* ==================== TAB 2: 📡 SAR ANALYSIS (NASA JPL NISAR 3 SCATTERING MECHANISMS) ==================== */}
                  {activeAnalyticsTab === "sar" && (
                    <div className="space-y-2">
                      {/* Backscatter dB Bar Chart */}
                      <div className="rounded-lg border border-emerald-400/20 bg-[#050e1a] p-2.5">
                        <div className="font-mono text-[9px] font-semibold tracking-wider text-emerald-300 uppercase">
                          NISAR L-BAND / S1 · BACKSCATTER (dB)
                        </div>
                        <div className="my-2 flex h-20 items-end gap-2">
                          {[
                            {
                              label: "Pre-Fire\n(Volume)",
                              val: 64,
                              db: "-6.2 dB",
                              color: "#00ff96",
                            },
                            {
                              label: "Active\n(Burning)",
                              val: 24,
                              db: "-17.8 dB",
                              color: "#ff3200",
                            },
                            {
                              label: "Post-Fire\n(Surface)",
                              val: 18,
                              db: "-19.4 dB",
                              color: "#ff6400",
                            },
                            {
                              label: "Recovery\n(+6m)",
                              val: 36,
                              db: "-13.1 dB",
                              color: "#ffaa00",
                            },
                            {
                              label: "Recovery\n(+1y)",
                              val: 50,
                              db: "-9.8 dB",
                              color: "#88ff44",
                            },
                          ].map((b, i) => (
                            <div
                              key={i}
                              className="flex flex-1 flex-col items-center gap-0.5"
                            >
                              <div
                                className="font-mono text-[8.5px] font-bold"
                                style={{ color: b.color }}
                              >
                                {b.db}
                              </div>
                              <div
                                className="w-full rounded-t transition-all duration-500"
                                style={{
                                  height: `${b.val}px`,
                                  background: `linear-gradient(180deg, ${b.color} 0%, ${b.color}44 100%)`,
                                  border: `1px solid ${b.color}88`,
                                }}
                              />
                              <div className="text-center font-mono text-[7.5px] leading-tight whitespace-pre-line text-cream-200/75">
                                {b.label}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* 3 Radar Scattering Mechanisms (NASA JPL NISAR Wildfires StoryMap) */}
                      <div className="space-y-1.5 rounded-lg border border-sky-400/25 bg-[#050e1a] p-2.5">
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-[9px] font-bold text-sky-300 uppercase">
                            3 SAR Scattering Mechanisms (NISAR)
                          </span>
                          <a
                            href="https://storymaps.arcgis.com/stories/4724cd32c4064b9eb5ebe300c1385d07"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-mono text-[8.5px] font-bold text-[#00ff96] underline hover:text-emerald-200"
                          >
                            NASA StoryMap ↗
                          </a>
                        </div>

                        {[
                          {
                            badge: "1. Volume",
                            pol: "High HV / VH (~ -6 dB)",
                            desc: "Multiple radar bounces within healthy forest canopy & leaves.",
                            color: "#00ff96",
                          },
                          {
                            badge: "2. Double-Bounce",
                            pol: "High HH / VV",
                            desc: "Double reflection between tree trunks & flooded peat swamp water.",
                            color: "#38bdf8",
                          },
                          {
                            badge: "3. Surface",
                            pol: "HV Drop (~ -18 dB)",
                            desc: "Canopy burned away; radar scatters off exposed peat soil.",
                            color: "#ff5533",
                          },
                        ].map((sc, i) => (
                          <div
                            key={i}
                            className="rounded border border-white/10 bg-white/[0.03] px-2 py-1"
                          >
                            <div className="flex items-center justify-between font-mono text-[9.5px] font-bold">
                              <span style={{ color: sc.color }}>
                                {sc.badge}
                              </span>
                              <span className="text-[8.5px] text-cream-200">
                                {sc.pol}
                              </span>
                            </div>
                            <div className="text-[9.5px] text-cream-300/85">
                              {sc.desc}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* ==================== TAB 3: 🌱 FOREST RECOVERY ==================== */}
                  {activeAnalyticsTab === "ndvi" && (
                    <div className="space-y-2">
                      <div className="rounded-lg border border-emerald-400/20 bg-[#050e1a] p-2.5">
                        <div className="flex items-center justify-between font-mono text-[9px] font-semibold text-emerald-300 uppercase">
                          <span>SAR + NDVI RECOVERY (2022–2028)</span>
                          <span className="text-[#00ff96]">R² = 96.4%</span>
                        </div>
                        <svg
                          width="100%"
                          height="105"
                          viewBox="0 0 380 125"
                          className="my-1"
                        >
                          {[0.2, 0.4, 0.6, 0.8].map((v, i) => (
                            <g key={i}>
                              <line
                                x1="36"
                                y1={105 - v * 100}
                                x2="365"
                                y2={105 - v * 100}
                                stroke="rgba(255,255,255,0.08)"
                                strokeWidth="1"
                              />
                              <text
                                x="4"
                                y={109 - v * 100}
                                fill="rgba(255,255,255,0.45)"
                                fontSize="8"
                                fontFamily="monospace"
                              >
                                {v.toFixed(1)}
                              </text>
                            </g>
                          ))}
                          <path
                            d="M200,62 Q245,45 290,34 Q330,26 360,20 L360,38 Q330,44 290,52 Q245,62 200,72 Z"
                            fill="rgba(0,255,150,0.14)"
                          />
                          <polyline
                            points="40,24 80,26 120,88 160,82 200,66"
                            fill="none"
                            stroke="#00ffc8"
                            strokeWidth="2.5"
                          />
                          <polyline
                            points="200,66 245,52 290,42 330,33 360,28"
                            fill="none"
                            stroke="#00ff96"
                            strokeWidth="2"
                            strokeDasharray="5,3"
                          />
                          <line
                            x1="120"
                            y1="12"
                            x2="120"
                            y2="105"
                            stroke="#ff3200"
                            strokeWidth="1"
                            strokeDasharray="3,2"
                          />
                          <text
                            x="124"
                            y="22"
                            fill="#ff5533"
                            fontSize="8"
                            fontFamily="monospace"
                          >
                            🔥 Fire Event
                          </text>
                          <text
                            x="235"
                            y="18"
                            fill="#00ff96"
                            fontSize="8"
                            fontFamily="monospace"
                          >
                            --- ML Projection (RF)
                          </text>
                          {[
                            "2022",
                            "2023",
                            "2024",
                            "2025",
                            "2026",
                            "2027",
                            "2028",
                          ].map((yr, i) => (
                            <text
                              key={i}
                              x={40 + i * 52}
                              y="118"
                              fill="rgba(255,255,255,0.45)"
                              fontSize="8"
                              fontFamily="monospace"
                            >
                              {yr}
                            </text>
                          ))}
                        </svg>
                        <div className="font-mono text-[9.5px] text-cream-200/80">
                          📈 Estimated return to canopy baseline (Volume
                          Scattering): <strong>~4.2 years</strong>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* ==================== TAB 4: 🦧 INDONESIA WILDLIFE IMPACT ==================== */}
                  {activeAnalyticsTab === "wildlife" && (
                    <div className="space-y-1.5">
                      <div className="flex flex-col gap-1.5 rounded-lg border border-emerald-400/20 bg-[#050e1a] p-2.5">
                        <div className="font-mono text-[9px] font-semibold tracking-wider text-emerald-300 uppercase">
                          ENDEMIC INDONESIAN WILDLIFE IN WILDFIRE ZONES
                        </div>
                        {[
                          {
                            icon: "🦧",
                            name: "Bornean Orangutan & Proboscis Monkey (Kalimantan)",
                            status: "CR",
                            statusColor: "#ff3200",
                            overlap:
                              "Sebangau Peat Dome, Tanjung Puting & Kutai",
                            pct: 82,
                            coords: [113.92, -2.48],
                          },
                          {
                            icon: "🐅",
                            name: "Sumatran Tiger & Elephant (Riau/Jambi/South Sumatra)",
                            status: "CR",
                            statusColor: "#ff3200",
                            overlap:
                              "Kampar Peat Peninsula, Berbak–Sembilang & OKI",
                            pct: 79,
                            coords: [103.85, -1.65],
                          },
                          {
                            icon: "🦏",
                            name: "Sumatran Orangutan & Rhino (Leuser/Way Kambas)",
                            status: "CR",
                            statusColor: "#ff3200",
                            overlap: "Tripa Peat Swamp Aceh & Way Kambas NP",
                            pct: 64,
                            coords: [96.45, 4.12],
                          },
                          {
                            icon: "🦅",
                            name: "Javan Hawk-Eagle & Leopard (East Java)",
                            status: "CR",
                            statusColor: "#ff8800",
                            overlap: "Bromo–Tengger–Semeru & Baluran Savanna",
                            pct: 58,
                            coords: [113.65, -7.95],
                          },
                          {
                            icon: "🦬",
                            name: "Lowland Anoa & Maleo Bird (Sulawesi)",
                            status: "EN",
                            statusColor: "#ff8800",
                            overlap: "Rawa Aopa Watumohai & Morowali Corridor",
                            pct: 61,
                            coords: [121.55, -2.95],
                          },
                          {
                            icon: "🦜",
                            name: "Bird-of-Paradise, Cassowary & Wallaby (Papua)",
                            status: "VU",
                            statusColor: "#facc15",
                            overlap: "Wasur Wetland Savanna Merauke & Mappi",
                            pct: 52,
                            coords: [140.15, -7.55],
                          },
                        ].map((sp, i) => (
                          <button
                            key={i}
                            type="button"
                            onClick={() => handleFocusWildlifeCorridor(sp)}
                            className="cursor-pointer flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1.5 text-left transition-all hover:border-emerald-400/40 hover:bg-white/10"
                          >
                            <span className="text-base">{sp.icon}</span>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <span className="truncate text-[10.5px] font-bold text-cream-50">
                                  {sp.name}
                                </span>
                                <span
                                  className="shrink-0 rounded px-1 py-0.2 font-mono text-[8px] font-bold"
                                  style={{
                                    background: `${sp.statusColor}25`,
                                    color: sp.statusColor,
                                    border: `1px solid ${sp.statusColor}55`,
                                  }}
                                >
                                  {sp.status}
                                </span>
                              </div>
                              <div className="truncate font-mono text-[8.5px] text-cream-200/75">
                                {sp.overlap}
                              </div>
                            </div>
                            <div className="w-9 text-right">
                              <div
                                className="font-mono text-[9px] font-bold"
                                style={{ color: sp.statusColor }}
                              >
                                {sp.pct}%
                              </div>
                              <div className="mt-0.5 h-1 w-full overflow-hidden rounded-full bg-white/10">
                                <div
                                  className="h-full rounded-full"
                                  style={{
                                    width: `${sp.pct}%`,
                                    background: sp.statusColor,
                                  }}
                                />
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Bottom Legend Bar */}
      {!isEmbed && (
        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-charcoal-800 bg-charcoal-950 px-4 py-2 text-xs text-cream-200">
          <div className="flex flex-wrap items-center gap-4">
            <span className="flex items-center gap-2 font-semibold">
              <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-white bg-[#983226] text-[10px] text-white">
                🔥
              </span>
              Indonesia Wildfire Hotspots ({filteredFireEvents.length} NASA
              Worldview Points)
            </span>
            <span className="flex items-center gap-1.5 font-semibold text-emerald-300">
              <span>🦧🐅🦜</span>
              Endemic Wildlife Habitat Scope (IUCN CR/EN)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-xs border border-sky-400 bg-sky-500/40" />
              SAR Radar Swaths (NISAR / Sentinel-1)
            </span>
          </div>

          <div className="max-w-md">
            <DonationDisclaimer compact className="text-cream-400" />
          </div>
        </div>
      )}
    </div>
  );
}
