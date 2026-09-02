export type PortrayalInstructionType = "point" | "line" | "area" | "text" | "null" | "unknown";

export interface PortrayalFeature {
  featureInstanceId: string;
  featureTypeCode: number;
  featureCode?: string | null;
  featurePrimitive?: string | null;
  attributes: Record<string, unknown>;
  geometryType: string | null;
  geometry?: unknown;
}

export interface PortrayalContext {
  catalogueSnapshotId: string;
  scaleDenominator: number | null;
  displayMode: "day" | "dusk" | "night";
  viewingGroups: string[];
}

export interface DrawingInstruction {
  raw: string;
  tokens: Record<string, string>;
  instructionType: PortrayalInstructionType;
  priority: number | null;
  viewingGroup: string | null;
  symbolRef: string | null;
  lineStyleRef: string | null;
  areaFillRef: string | null;
  colorFill: string | null;
  text: string | null;
  displayPlane: string | null;
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

export function parseDrawingInstructionText(rawInstructions: string[]): DrawingInstruction[] {
  return rawInstructions.flatMap((raw) => {
    const commands = parseInstructionCommands(raw);
    if (commands.length === 0) {
      return [];
    }

    const instructions: DrawingInstruction[] = [];
    const state: Record<string, string> = {};
    for (const [key, value] of commands) {
      state[key] = value;
      if (isPrimaryInstructionKey(key)) {
        instructions.push(createDrawingInstruction(raw, { ...state, [key]: value }, key));
      }
    }

    return instructions.length > 0 ? instructions : [createDrawingInstruction(raw, { ...state }, null)];
  });
}

export function parseInstructionTokens(raw: string): Record<string, string> {
  const tokens: Record<string, string> = {};
  for (const [key, value] of parseInstructionCommands(raw)) {
    tokens[key] = value;
  }
  return tokens;
}

function parseInstructionCommands(raw: string): Array<[string, string]> {
  const commands: Array<[string, string]> = [];
  for (const part of raw.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const separatorIndex = trimmed.indexOf(":");
    if (separatorIndex === -1) {
      commands.push([trimmed, "true"]);
      continue;
    }
    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (key) {
      commands.push([key, value]);
    }
  }
  return commands;
}

function isPrimaryInstructionKey(key: string): boolean {
  return ["PointInstruction", "LineInstruction", "AreaFillReference", "ColorFill", "TextInstruction", "NullInstruction"].includes(key);
}

function createDrawingInstruction(raw: string, tokens: Record<string, string>, primaryKey: string | null): DrawingInstruction {
  const instructionType = resolveInstructionType(primaryKey);
  return {
    raw,
    tokens,
    instructionType,
    priority: numberOrNull(tokens.DrawingPriority),
    viewingGroup: tokens.ViewingGroup ?? null,
    symbolRef: primaryKey === "PointInstruction" ? valueOrNull(tokens.PointInstruction) : null,
    lineStyleRef: primaryKey === "LineInstruction" ? valueOrNull(tokens.LineInstruction) : null,
    areaFillRef: primaryKey === "AreaFillReference" ? valueOrNull(tokens.AreaFillReference) : null,
    colorFill: primaryKey === "ColorFill" ? valueOrNull(tokens.ColorFill) : null,
    text: primaryKey === "TextInstruction" ? valueOrNull(tokens.TextInstruction) : null,
    displayPlane: tokens.DisplayPlane ?? null,
    stroke: null,
    fill: primaryKey === "ColorFill" ? valueOrNull(tokens.ColorFill) : null,
    opacity: null
  };
}

function resolveInstructionType(primaryKey: string | null): PortrayalInstructionType {
  if (primaryKey === "PointInstruction") return "point";
  if (primaryKey === "LineInstruction") return "line";
  if (primaryKey === "AreaFillReference" || primaryKey === "ColorFill") return "area";
  if (primaryKey === "TextInstruction") return "text";
  if (primaryKey === "NullInstruction") return "null";
  return "unknown";
}

function numberOrNull(value: string | undefined): number | null {
  if (value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function valueOrNull(value: string | undefined): string | null {
  return value && value !== "true" ? value : null;
}
