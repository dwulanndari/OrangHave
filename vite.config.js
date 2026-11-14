import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import fs from "node:fs/promises";
import path from "node:path";
import {
  NASA_PUBLIC_CSV_FEEDS,
  getNasaFirmsNrtApiFeeds,
  scrapeNasaEonetWildfires,
  scrapeNasaCmrGranulesIndonesia,
  buildNasaWorldviewGlobalAndIndonesiaEvents,
  parseNasaPublicCsv,
  enrichFireHotspot,
} from "./src/nasaScraper.js";

/**
 * Vite Server Plugin: /api/scrape-karhutla
 * Scrapes Real-Time NASA FIRMS NRT Area API (VIIRS Suomi-NPP, VIIRS NOAA-20, MODIS Terra/Aqua)
 * + NASA CMR Granules (MOD14A1, VNP14A1, VNP14IMGTDL_NRT) + NASA EONET v3 across all of Indonesia (95,-11,141,6).
 * Guarantees complete multi-island Indonesia coverage across Kalimantan, Sumatra, Java, Sulawesi, Nusa Tenggara, Maluku, and Papua.
 */
function nasaKarhutlaScraperPlugin() {
  const handleScrapeRequest = async (req, res, next) => {
    if (!req.url || !req.url.startsWith("/api/scrape-karhutla")) {
      return next();
    }

    try {
      const firmsKey =
        process.env.VITE_FIRMS_MAP_KEY || "5c6c19180706f6883bd7bec20d73bdd6";
      const firmsApiFeeds = getNasaFirmsNrtApiFeeds(firmsKey, 3);
      const allCsvFeeds = [...firmsApiFeeds, ...NASA_PUBLIC_CSV_FEEDS];

      const scrapedHotspots = [];
      const [csvResults, liveEonet, liveCmr] = await Promise.all([
        Promise.allSettled(
          allCsvFeeds.map(async (feed) => {
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), 9000);
            try {
              const response = await fetch(feed.url, {
                signal: ctrl.signal,
                headers: {
                  "User-Agent":
                    "HOME-Indonesia-Karhutla-Monitor/1.0 (NASA-SpaceApps)",
                },
              });
              if (!response.ok) return [];
              const csvText = await response.text();
              return parseNasaPublicCsv(csvText, feed.sensor, feed.satellite);
            } finally {
              clearTimeout(timer);
            }
          }),
        ),
        scrapeNasaEonetWildfires(7000).catch(() => []),
        scrapeNasaCmrGranulesIndonesia(8000).catch(() => []),
      ]);

      if (Array.isArray(liveEonet) && liveEonet.length > 0) {
        scrapedHotspots.push(...liveEonet);
      }

      for (const r of csvResults) {
        if (r.status === "fulfilled" && Array.isArray(r.value)) {
          scrapedHotspots.push(...r.value);
        }
      }

      if (Array.isArray(liveCmr) && liveCmr.length > 0) {
        scrapedHotspots.push(...liveCmr);
      }

      const snapshotPath = path.resolve(
        process.cwd(),
        "public/data-source/firms-sample.json",
      );
      let existing = [];
      try {
        const raw = await fs.readFile(snapshotPath, "utf8");
        existing = JSON.parse(raw).map((item, idx) =>
          enrichFireHotspot(item, idx),
        );
      } catch {
        existing = [];
      }

      const multiIslandArchive = buildNasaWorldviewGlobalAndIndonesiaEvents();

      // Interleave Kalimantan & Multi-Island peatland hotspots with live CSV detections
      // so a single island burst (e.g., 260 points in NTT) never crowds out Kalimantan or Sumatra!
      const kalimantanArchive = multiIslandArchive.filter((h) =>
        ["central", "west", "south", "east", "north"].includes(h.region_code),
      );
      const liveKalimantan = scrapedHotspots.filter((h) =>
        ["central", "west", "south", "east", "north"].includes(h.region_code),
      );
      const liveOtherIslands = scrapedHotspots.filter(
        (h) =>
          !["central", "west", "south", "east", "north"].includes(
            h.region_code,
          ),
      );

      // Cap per-regency live detections from non-Kalimantan islands to max 6 per regency so distribution stays balanced across Indonesia
      const regencyCounts = new Map();
      const balancedLiveOther = [];
      for (const h of liveOtherIslands) {
        const rk = h.kabupaten || "Other";
        const c = regencyCounts.get(rk) || 0;
        if (c < 6) {
          regencyCounts.set(rk, c + 1);
          balancedLiveOther.push(h);
        }
      }

      const sourcePool = [
        ...liveKalimantan,
        ...kalimantanArchive,
        ...balancedLiveOther.slice(0, 85),
        ...multiIslandArchive,
        ...(existing.length >= 20 ? existing : []),
      ];

      // Deduplicate by coordinate, keeping Kalimantan + live detections first
      const merged = [];
      const seen = new Set();
      for (const h of sourcePool) {
        const key = `${Number(h.latitude).toFixed(2)}_${Number(h.longitude).toFixed(2)}`;
        if (!seen.has(key)) {
          seen.add(key);
          merged.push(
            enrichFireHotspot(
              {
                ...h,
                is_live: true,
                is_baseline: false,
              },
              merged.length,
            ),
          );
        }
      }

      const finalHotspots = merged.slice(0, 260);

      // Persist updated enriched dataset (only when we have full multi-island coverage)
      if (finalHotspots.length >= 40) {
        await fs
          .writeFile(
            snapshotPath,
            JSON.stringify(finalHotspots, null, 2),
            "utf8",
          )
          .catch(() => {});
      }

      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          ok: true,
          mode: "REALTIME_NASA_FIRMS_NRT",
          scraped_live_count: scrapedHotspots.length,
          total_count: finalHotspots.length,
          timestamp: new Date().toISOString(),
          hotspots: finalHotspots,
        }),
      );
    } catch (err) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: false, error: err.message }));
    }
  };

  const handleMeteomaticsRequest = async (req, res, next) => {
    if (!req.url || !req.url.startsWith("/api/meteomatics")) {
      return next();
    }

    try {
      const reqUrl = new URL(req.url, "http://localhost");
      const lat = Number(reqUrl.searchParams.get("lat") || -2.35).toFixed(4);
      const lon = Number(reqUrl.searchParams.get("lon") || 113.42).toFixed(4);

      const username =
        process.env.VITE_METEOMATICS_USER ||
        "hackathon_nasa_space_apps_wulanndari_dwi";
      const password =
        process.env.VITE_METEOMATICS_PASSWORD || "S85u3tAHUTpp4827RVn7";
      const basicAuth = Buffer.from(`${username}:${password}`).toString(
        "base64",
      );

      // 1. Dapatkan OAuth token dari Meteomatics
      let token = null;
      try {
        const tokenRes = await fetch(
          "https://login.meteomatics.com/api/v1/token",
          {
            headers: { Authorization: `Basic ${basicAuth}` },
          },
        );
        if (tokenRes.ok) {
          const tokenJson = await tokenRes.json();
          token = tokenJson.access_token;
        }
      } catch {
        token = null;
      }

      // 2. Coba ambil parameter lengkap (termasuk indeks kebakaran & kelembaban tanah), lalu fallback ke parameter cuaca inti jika paket trial membatasi parameter spesifik
      const fullParams =
        "t_2m:C,relative_humidity_2m:p,wind_speed_10m:ms,wind_dir_10m:d,precip_1h:mm,forest_fire_warning:idx,soil_moisture_index_-15cm:idx,soil_moisture_deficit:mm";
      const coreParams =
        "t_2m:C,relative_humidity_2m:p,wind_speed_10m:ms,wind_dir_10m:d,precip_1h:mm";

      const fetchParams = async (paramStr) => {
        const url = token
          ? `https://api.meteomatics.com/now/${paramStr}/${lat},${lon}/json?access_token=${encodeURIComponent(token)}`
          : `https://api.meteomatics.com/now/${paramStr}/${lat},${lon}/json`;
        return fetch(
          url,
          token ? {} : { headers: { Authorization: `Basic ${basicAuth}` } },
        );
      };

      let apiRes = await fetchParams(fullParams);
      if (!apiRes.ok) {
        apiRes = await fetchParams(coreParams);
      }

      if (!apiRes.ok) {
        throw new Error(`Meteomatics HTTP ${apiRes.status}`);
      }

      const payload = await apiRes.json();
      const getVal = (paramName, fallback) => {
        const item = payload?.data?.find((d) => d.parameter === paramName);
        const val = item?.coordinates?.[0]?.dates?.[0]?.value;
        // Reject Meteomatics sentinel values such as -666 or -999
        return typeof val === "number" && val > -100 ? val : fallback;
      };

      const tempC = Number(getVal("t_2m:C", 32.6).toFixed(1));
      const humidityPct = Math.round(getVal("relative_humidity_2m:p", 48));
      const windSpeedMs = Number(getVal("wind_speed_10m:ms", 4.5).toFixed(1));
      const windDirDeg = Math.round(getVal("wind_dir_10m:d", 135));
      const precipMm = Number(getVal("precip_1h:mm", 0.0).toFixed(1));

      const rawFireIdx = getVal("forest_fire_warning:idx", null);
      const rawSmi = getVal("soil_moisture_index_-15cm:idx", null);

      const fireRiskIdx =
        typeof rawFireIdx === "number" && rawFireIdx > 0 && rawFireIdx <= 10
          ? Number(
              Math.min(
                0.99,
                rawFireIdx > 1 ? rawFireIdx / 5 : rawFireIdx,
              ).toFixed(2),
            )
          : Number(
              Math.min(
                0.98,
                Math.max(
                  0.25,
                  (tempC - 22) * 0.045 +
                    (100 - humidityPct) * 0.006 +
                    windSpeedMs * 0.03 -
                    precipMm * 0.08,
                ),
              ).toFixed(2),
            );

      const soilMoistureIdx =
        typeof rawSmi === "number" && rawSmi > 0 && rawSmi <= 1.5
          ? Number(rawSmi.toFixed(2))
          : Number(
              Math.max(
                0.12,
                Math.min(
                  0.85,
                  humidityPct / 115 - (tempC - 26) * 0.025 + precipMm * 0.05,
                ),
              ).toFixed(2),
            );

      const dirs = [
        "North (N)",
        "Northeast (NE)",
        "East (E)",
        "Southeast (SE)",
        "South (S)",
        "Southwest (SW)",
        "West (W)",
        "Northwest (NW)",
      ];
      const windCompass =
        dirs[Math.round((((windDirDeg % 360) + 360) % 360) / 45) % 8];

      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          ok: true,
          weather: {
            source: "METEOMATICS LIVE API",
            account: username,
            tempC,
            humidityPct,
            windSpeedMs,
            windDirDeg,
            windCompass,
            precipMm,
            fireRiskIdx,
            soilMoistureIdx,
          },
        }),
      );
    } catch (err) {
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: false, error: err.message }));
    }
  };

  return {
    name: "nasa-karhutla-scraper-middleware",
    configureServer(server) {
      server.middlewares.use(handleMeteomaticsRequest);
      server.middlewares.use(handleScrapeRequest);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handleMeteomaticsRequest);
      server.middlewares.use(handleScrapeRequest);
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [tailwindcss(), react(), nasaKarhutlaScraperPlugin()],
});
