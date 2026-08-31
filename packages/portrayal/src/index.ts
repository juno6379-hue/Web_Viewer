export interface PortrayalFeature {
  featureInstanceId: string;
  featureTypeCode: number;
  attributes: Record<string, unknown>;
  geometryType: string | null;
}

export interface PortrayalContext {
  catalogueSnapshotId: string;
  scaleDenominator: number | null;
  displayMode: "day" | "dusk" | "night";
  viewingGroups: string[];
}

export interface DrawingInstruction {
  instructionType: "point" | "line" | "area" | "text";
  priority: number;
  viewingGroup: string | null;
  symbolRef: string | null;
  stroke: string | null;
  fill: string | null;
  opacity: number | null;
}

export interface LuaRuntime {
  execute(ruleName: string, feature: PortrayalFeature, context: PortrayalContext): Promise<DrawingInstruction[]>;
}

export interface CatalogueLoader {
  loadPortrayalCatalogue(catalogueSnapshotId: string): Promise<unknown>;
}

export interface SymbolResolver {
  resolve(symbolRef: string): Promise<string | null>;
}

export interface MapLibreLayerDefinition {
  id: string;
  type: "circle" | "line" | "fill" | "symbol";
  source: string;
  paint?: Record<string, unknown>;
  layout?: Record<string, unknown>;
  filter?: unknown[];
}

export interface MapLibreAdapter {
  toLayers(instructions: DrawingInstruction[]): MapLibreLayerDefinition[];
}

export interface PortrayalEngine {
  createDrawingInstructions(feature: PortrayalFeature, context: PortrayalContext): Promise<DrawingInstruction[]>;
}
