export interface CatalogueStatus {
  featureCataloguePath: string | null;
  portrayalCataloguePath: string | null;
  cacheReady: boolean;
}

export interface CatalogueSnapshot {
  catalogueSnapshotId: string;
  productId: string;
  catalogueType: "feature" | "portrayal";
  version: string;
  hashAlgorithm: "SHA-256";
  hash: string;
  sourcePath: string;
  loadedAt: string;
}

export interface FeatureDefinition {
  catalogueSnapshotId: string;
  code: number;
  name: string;
  definition: string | null;
  attributeBindings: AttributeBinding[];
  associations: AssociationBinding[];
}

export interface AttributeDefinition {
  catalogueSnapshotId: string;
  code: number;
  name: string;
  valueType: string;
  multiplicity: string | null;
  allowedValues: AllowedValue[];
}

export interface AttributeBinding {
  attributeCode: number;
  multiplicity: string | null;
  role: string | null;
}

export interface AssociationBinding {
  associationCode: number;
  role: string | null;
  targetType: string | null;
  multiplicity: string | null;
}

export interface AllowedValue {
  code: string;
  label: string;
  definition: string | null;
}

export interface NormalizedCatalogueModel {
  snapshot: CatalogueSnapshot;
  features: FeatureDefinition[];
  attributes: AttributeDefinition[];
}

export function createEmptyCatalogueStatus(): CatalogueStatus {
  return {
    featureCataloguePath: null,
    portrayalCataloguePath: null,
    cacheReady: false
  };
}
