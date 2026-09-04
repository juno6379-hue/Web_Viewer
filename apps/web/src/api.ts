import type {
  CatalogueRuntimeStatus,
  DatasetItem,
  FeatureDetail,
  FeatureGeoJsonCollection,
  FeatureSearchItem,
  PortrayalPaletteResponse,
  PortrayalRuntimeStatus,
  PortrayalSymbolManifest,
  QaSummary
} from "../../../packages/shared/src/index";

const defaultApiBaseUrl = "http://localhost:3000";
const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? defaultApiBaseUrl;
let activeApiBaseUrl = configuredApiBaseUrl;

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  let lastError: Error | null = null;
  for (const baseUrl of getApiBaseUrlCandidates()) {
    try {
      const response = await fetch(`${baseUrl}${path}`, { signal });
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }
      activeApiBaseUrl = baseUrl;
      return response.json() as Promise<T>;
    } catch (error) {
      if (signal?.aborted) {
        throw error;
      }
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }
  throw lastError ?? new Error("API request failed");
}

function getApiBaseUrlCandidates() {
  return Array.from(new Set([activeApiBaseUrl, configuredApiBaseUrl, defaultApiBaseUrl]));
}

export async function fetchDatasets() {
  return getJson<{ items: DatasetItem[] }>("/api/datasets");
}

export async function fetchFeatures(
  dataset?: DatasetItem | null,
  options: { bbox?: string; limit?: number; usageBands?: string[]; signal?: AbortSignal } = {}
) {
  const params = new URLSearchParams({
    limit: String(options.limit ?? 10000)
  });
  if (dataset) {
    params.set("datasetId", dataset.datasetId);
    params.set("datasetVersionId", dataset.datasetVersionId);
  }
  if (options.bbox) {
    params.set("bbox", options.bbox);
  }
  if (options.usageBands && options.usageBands.length > 0) {
    params.set("usageBands", options.usageBands.join(","));
  }
  return getJson<FeatureGeoJsonCollection>(`/api/features?${params.toString()}`, options.signal);
}

export async function fetchFeatureDetail(featureInstanceId: string) {
  return getJson<FeatureDetail>(`/api/features/${featureInstanceId}`);
}

export async function fetchQaSummary(dataset: DatasetItem) {
  const params = new URLSearchParams({
    datasetId: dataset.datasetId,
    datasetVersionId: dataset.datasetVersionId
  });
  return getJson<QaSummary>(`/api/qa/summary?${params.toString()}`);
}

export async function fetchCatalogueStatus() {
  return getJson<CatalogueRuntimeStatus>("/api/catalogue/status");
}

export async function fetchPortrayalStatus() {
  return getJson<PortrayalRuntimeStatus>("/api/portrayal/status");
}

export async function fetchPortrayalPalette(mode: "day" | "dusk" | "night" = "day") {
  return getJson<PortrayalPaletteResponse>(`/api/portrayal/palette/${mode}`);
}

export async function fetchPortrayalSymbols() {
  return getJson<PortrayalSymbolManifest>("/api/portrayal/symbols");
}

export function buildPortrayalSymbolUrl(endpoint: string) {
  return `${activeApiBaseUrl}${endpoint}`;
}

export async function searchFeatures(query: string, datasetId?: string) {
  const params = new URLSearchParams({
    q: query,
    limit: "25"
  });
  if (datasetId) {
    params.set("datasetId", datasetId);
  }
  return getJson<{ items: FeatureSearchItem[] }>(`/api/search/features?${params.toString()}`);
}
