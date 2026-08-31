export interface CatalogueStatus {
  featureCataloguePath: string | null;
  portrayalCataloguePath: string | null;
  cacheReady: boolean;
}

export function createEmptyCatalogueStatus(): CatalogueStatus {
  return {
    featureCataloguePath: null,
    portrayalCataloguePath: null,
    cacheReady: false
  };
}
