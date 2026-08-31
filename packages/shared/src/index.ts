export interface DatasetItem {
  datasetId: string;
  datasetVersionId: string;
  dsnm: string;
  productId: string;
  editionNumber: number | null;
  updateNumber: number | null;
  purpose: string;
  conformanceStatus: string | null;
  bbox: unknown;
  featureCount: number;
}

export interface FeatureGeoJsonCollection {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    id: string;
    geometry: unknown;
    properties: Record<string, unknown>;
  }>;
}

export interface FeatureDetail {
  featureInstanceId: string;
  datasetId: string;
  datasetVersionId: string;
  featureRecordId: string;
  catalogueSnapshotId: string | null;
  featureTypeCode: number;
  foid: {
    agen: number | null;
    fidn: string | null;
    fids: number | null;
  };
  lifecycleStatus: string;
  attributes: Record<string, unknown>;
  geometryType: string | null;
}

export interface QaSummary {
  featureRecordWithoutInstance: number;
  informationRecordWithoutInstance: number;
  attributeOwnerMissing: number;
  complexAttributeOwnerMissing: number;
  associationSourceMissing: number;
  associationTargetMissing: number;
  spatialReferenceCrossVersion: number;
  curveEndpointCrossVersion: number;
  surfaceBoundaryCrossVersion: number;
  invalidGeometry: number;
  nullGeometry: number;
  nullNoSourceData: number;
  nullInvalidTopology: number;
  projectedFeatures: number;
  geoJsonRows: number;
  missingGeoJson: number;
  blockingValidationIssues: number;
}

export interface CatalogueRuntimeStatus {
  featureCatalogue: CatalogueSnapshotStatus | null;
  portrayalCatalogue: CatalogueSnapshotStatus | null;
  cacheReady: boolean;
  catalogueMismatch: boolean;
  warning: string | null;
}

export interface CatalogueSnapshotStatus {
  catalogueSnapshotId: string;
  productId: string;
  catalogueType: "feature" | "portrayal";
  version: string;
  hashAlgorithm: "SHA-256";
  hash: string;
  sourcePath: string;
  loadedAt: string;
}
