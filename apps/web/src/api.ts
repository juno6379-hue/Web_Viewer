import type {
  CatalogueRuntimeStatus,
  DatasetItem,
  FeatureDetail,
  FeatureGeoJsonCollection,
  FeatureSearchItem,
  QaSummary
} from "../../../packages/shared/src/index";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:5174";

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

export async function fetchDatasets() {
  return getJson<{ items: DatasetItem[] }>("/api/datasets");
}

export async function fetchFeatures(dataset: DatasetItem) {
  const params = new URLSearchParams({
    datasetId: dataset.datasetId,
    datasetVersionId: dataset.datasetVersionId,
    limit: "10000"
  });
  return getJson<FeatureGeoJsonCollection>(`/api/features?${params.toString()}`);
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
