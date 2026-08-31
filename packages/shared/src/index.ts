export interface DatasetItem {
  datasetId: string;
  datasetVersionId: string;
  dsnm: string;
  productId: string;
  productSpecification: string;
  editionNumber: number | null;
  updateNumber: number | null;
  purpose: string;
  minScale: number | null;
  maxScale: number | null;
  conformanceStatus: string | null;
  bbox: unknown;
  featureCount: number;
}

export interface FeatureGeoJsonCollection {
  type: "FeatureCollection";
  datasetVersionId: string | null;
  productSpecification: string;
  featureCatalogueVersion: string | null;
  portrayalCatalogueVersion: string | null;
  features: Array<{
    type: "Feature";
    id: string;
    geometry: unknown;
    properties: Record<string, unknown>;
  }>;
}

export interface FeatureSearchItem {
  featureInstanceId: string;
  datasetId: string;
  datasetVersionId: string;
  dsnm: string;
  featureTypeCode: number;
  featureName: string | null;
  foid: {
    agen: number | null;
    fidn: string | null;
    fids: number | null;
  };
  geometryType: string | null;
  bbox: unknown;
  matchReason: string;
}

export interface FeatureDetail {
  featureInstanceId: string;
  datasetId: string;
  datasetVersionId: string;
  featureRecordId: string;
  catalogueSnapshotId: string | null;
  featureName: string | null;
  featureTypeCode: number;
  foid: {
    agen: number | null;
    fidn: string | null;
    fids: number | null;
  };
  rcid: number | null;
  rver: number | null;
  ruin: number | null;
  dataset: {
    dsnm: string | null;
    editionNumber: number | null;
    updateNumber: number | null;
  };
  lifecycleStatus: string;
  attributes: unknown;
  simpleAttributes: FeatureAttributeItem[];
  complexAttributes: ComplexAttributeItem[];
  associations: AssociationItem[];
  spatial: SpatialItem[];
  rawRecord: RawRecordLocator | null;
  validationIssues: ValidationIssueItem[];
  geometryType: string | null;
}

export interface FeatureAttributeItem {
  id: string;
  code: number;
  name: string | null;
  atix: number;
  paix: number | null;
  atin: number;
  valueType: string | null;
  value: unknown;
  rawValue: string | null;
}

export interface ComplexAttributeItem {
  id: string;
  code: number;
  name: string | null;
  atix: number;
  paix: number | null;
  occurrenceOrdinal: number;
}

export interface AssociationItem {
  associationId: string;
  associationType: string;
  sourceField: string;
  role: string | null;
  targetType: "feature" | "information" | null;
  targetId: string | null;
  targetRecordId: string | null;
}

export interface SpatialItem {
  spatialReferenceId: string;
  spatialRecordId: string;
  spatialType: string;
  rcnm: number;
  rcid: number;
  rver: number;
  ruin: number;
  rrnm: number;
  rrid: number;
  orientation: number | null;
  minScale: number | null;
  maxScale: number | null;
  geometryType: string | null;
  srid: number | null;
  bbox: unknown;
  topology: string;
}

export interface RawRecordLocator {
  rawRecordId: string;
  exchangeResourceId: string;
  recordOrdinal: number;
  byteOffset: string;
  recordLength: number;
  fieldTag: string | null;
  rawPayloadHash: string | null;
  decodeStatus: string;
}

export interface ValidationIssueItem {
  validationIssueId: string;
  ruleId: string;
  severity: "info" | "warning" | "error" | "fatal" | string;
  targetSchema: string | null;
  targetTable: string | null;
  targetId: string | null;
  fieldLocator: string | null;
  message: string;
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
  canonicalFeatureCount: number;
  projectedFeatures: number;
  geoJsonRows: number;
  missingGeoJson: number;
  validationCritical: number;
  validationError: number;
  validationWarning: number;
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

export interface HealthStatus {
  database: "ok" | "error";
  projection: "ok" | "error";
  featureCatalogue: string | "not_loaded";
  portrayalCatalogue: string | "not_loaded";
}
