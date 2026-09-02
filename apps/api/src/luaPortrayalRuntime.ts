import { execFile } from "node:child_process";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { PortrayalContext, PortrayalFeature } from "../../../packages/portrayal/src/index.js";

const execFileAsync = promisify(execFile);

export interface LuaPortrayalResult {
  featureReference: string;
  rawInstructions: string[];
  observedContextParameters: string | null;
  trace: string[];
}

export interface ExternalLuaRuntimeOptions {
  luaRuntimePath: string;
  catalogueRoot: string;
  timeoutMs?: number;
}

export class ExternalLuaPortrayalRuntime {
  private readonly timeoutMs: number;

  constructor(private readonly options: ExternalLuaRuntimeOptions) {
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  async executeBatch(features: PortrayalFeature[], context: PortrayalContext): Promise<LuaPortrayalResult[]> {
    const workDir = await mkdtemp(join(tmpdir(), "s101-lua-"));
    const scriptPath = join(workDir, "run-s101-portrayal.lua");
    const runtimeCatalogueRoot = join(workDir, "catalogue");
    try {
      await cp(join(this.options.catalogueRoot, "Rules"), join(runtimeCatalogueRoot, "Rules"), { recursive: true });
      await writeFile(scriptPath, createLuaHostScript(runtimeCatalogueRoot, features, context), "utf8");
      const { stdout } = await execFileAsync(this.options.luaRuntimePath, [scriptPath], {
        cwd: workDir,
        timeout: this.timeoutMs,
        maxBuffer: 20 * 1024 * 1024,
        windowsHide: true
      });
      return parseLuaHostOutput(stdout);
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }
}

function createLuaHostScript(catalogueRoot: string, features: PortrayalFeature[], context: PortrayalContext): string {
  const rulesRoot = join(catalogueRoot, "Rules").replace(/\\/g, "/");
  const attributeValueTypes = inferAttributeValueTypes(features);
  return `
local features = ${toLuaValue(features.map((feature) => normalizeLuaFeature(feature)))}
local attributeValueTypes = ${toLuaValue(attributeValueTypes)}
local featureTypeCodes = ${toLuaValue([...new Set(features.map((feature) => feature.featureCode).filter(Boolean))])}
local simpleAttributeTypeCodes = ${toLuaValue(Object.keys(attributeValueTypes))}
local informationTypeCodes = { "NauticalInformation", "NonStandardWorkingDay", "ServiceHours", "SpatialQuality" }
local featureAssociationTypeCodes = { "TextAssociation", "StructureEquipment" }
local informationAssociationTypeCodes = { "AdditionalInformation", "SpatialAssociation" }
local roleTypeCodes = { "theInformation", "theQualityInformation", "theEquipment" }
local repeatingAttributes = {
  featureName = true,
  fixedDateRange = true,
  information = true,
  periodicDateRange = true,
  pictorialRepresentation = true,
  restriction = true,
  shapeInformation = true,
  textType = true,
  topmark = true
}
local context = ${toLuaValue({
    SafetyContour: String(context.scaleDenominator ?? 30),
    SafetyDepth: "30",
    ShallowContour: "2",
    DeepContour: "30",
    TwoShades: "false",
    FourShades: "true",
    FullSectors: "true",
    FullLightLines: "true",
    RadarOverlay: "false",
    ShallowWaterDangers: "true",
    SimplifiedSymbols: "false",
    PlainBoundaries: "false",
    SymbolizedBoundaries: "true",
    IgnoreScaleMinimum: "false",
    NationalLanguage: "",
    Date: "",
    _Testing_SoundingsAsText_SizeSafe: "10",
    _Testing_SoundingsAsText_SizeUnsafe: "10"
  })}
local emitted = {}
local trace = {}
local lastTraceIndex = 0

package.path = ${toLuaValue(`${rulesRoot}/?.lua;${rulesRoot}/?/init.lua;`)} .. package.path

Debug = {
  StartPerformance = function(_) end,
  StopPerformance = function(_) end,
  Trace = function(message) table.insert(trace, tostring(message)) end,
  Break = function() end,
  FirstChanceError = function(message, _)
    table.insert(trace, tostring(message))
    if debug and debug.traceback then
      io.stderr:write(debug.traceback(tostring(message)) .. "\\n")
    else
      io.stderr:write(tostring(message) .. "\\n")
    end
  end,
  HostDebuggerEntry = function() end
}

local function findFeature(featureID)
  for _, feature in ipairs(features) do
    if feature.featureInstanceId == tostring(featureID) then
      return feature
    end
  end
  return nil
end

local function valuesForAttribute(feature, attributeCode)
  if not feature or not feature.attributes then
    return {}
  end
  local value = feature.attributes[attributeCode]
  if value == nil then
    return {}
  end
  if type(value) == "table" then
    local values = {}
    for _, item in ipairs(value) do
      values[#values + 1] = tostring(item)
    end
    return values
  end
  return { tostring(value) }
end

local function parseAttributePath(attributePath)
  local path = {}
  for attributeCode, index in tostring(attributePath or ""):gmatch("([^:;]+):([^:;]+)") do
    path[#path + 1] = { code = attributeCode, index = tonumber(index) or 1 }
  end
  return path
end

local function complexContainer(feature, attributePath)
  if not feature or not feature.complexAttributes then
    return nil
  end
  local path = parseAttributePath(attributePath)
  if #path == 0 then
    return nil
  end
  local current = feature.complexAttributes
  for _, step in ipairs(path) do
    local values = current[step.code]
    if not values then
      return nil
    end
    current = values[step.index]
    if not current then
      return nil
    end
  end
  return current
end

local function valuesForPathAttribute(feature, attributePath, attributeCode)
  local container = complexContainer(feature, attributePath)
  if not container then
    return valuesForAttribute(feature, attributeCode)
  end
  local value = container.simpleAttributes and container.simpleAttributes[attributeCode]
  if value == nil then
    return {}
  end
  if type(value) == "table" then
    local values = {}
    for _, item in ipairs(value) do
      values[#values + 1] = tostring(item)
    end
    return values
  end
  return { tostring(value) }
end

local function complexAttributeCount(feature, attributePath, attributeCode)
  if not feature or not feature.complexAttributes then
    return 0
  end
  local container = complexContainer(feature, attributePath)
  local values
  if container then
    values = container.complexAttributes and container.complexAttributes[attributeCode]
  else
    values = feature.complexAttributes[attributeCode]
  end
  return values and #values or 0
end

local function createPointFromCoordinate(coordinate)
  if type(coordinate) ~= "table" then
    return CreatePoint("0", "0")
  end
  local x = tostring(coordinate[1] or 0)
  local y = tostring(coordinate[2] or 0)
  if coordinate[3] ~= nil then
    return CreatePoint(x, y, tostring(coordinate[3]))
  end
  return CreatePoint(x, y)
end

local function firstCoordinate(coordinates)
  if type(coordinates) ~= "table" then
    return nil
  end
  local current = coordinates
  while type(current) == "table" and type(current[1]) == "table" and type(current[1][1]) == "table" do
    current = current[1]
  end
  return current and current[1] or nil
end

local function lastCoordinate(coordinates)
  if type(coordinates) ~= "table" then
    return nil
  end
  local current = coordinates
  while type(current) == "table" and #current > 0 and type(current[#current]) == "table" and type(current[#current][1]) == "table" do
    current = current[#current]
  end
  return current and current[#current] or nil
end

local function firstLine(coordinates)
  if type(coordinates) ~= "table" then
    return nil
  end
  if type(coordinates[1]) == "table" and type(coordinates[1][1]) == "number" then
    return coordinates
  end
  local current = coordinates
  while type(current) == "table" and #current > 0 do
    if type(current[1]) == "table" and type(current[1][1]) == "number" then
      return current
    end
    current = current[1]
  end
  return nil
end

local function createCurveForFeature(feature, spatialSuffix)
  local startPoint = CreateSpatialAssociation("Point", feature.featureInstanceId .. ":start", "Forward")
  local endPoint = CreateSpatialAssociation("Point", feature.featureInstanceId .. ":end", "Forward")
  local line = firstLine(feature.coordinates) or { { 0, 0 }, { 1, 1 } }
  if #line < 2 then
    line = { firstCoordinate(feature.coordinates) or { 0, 0 }, lastCoordinate(feature.coordinates) or { 1, 1 } }
  end
  local controlPoints = {}
  for _, coordinate in ipairs(line) do
    controlPoints[#controlPoints + 1] = createPointFromCoordinate(coordinate)
  end
  if #controlPoints < 2 then
    controlPoints = { CreatePoint("0", "0"), CreatePoint("1", "1") }
  end
  local segment = CreateCurveSegment(controlPoints, "Loxodromic")
  return CreateCurve(startPoint, endPoint, { segment })
end

local function featureTypeInfo()
  return { Type = "FeatureType", AttributeBindings = setmetatable({}, { __index = function(t, k)
    local binding = {
      Type = "AttributeBinding",
      AttributeCode = k,
      LowerMultiplicity = 0,
      UpperMultiplicity = repeatingAttributes[k] and 2147483647 or 1
    }
    rawset(t, k, binding)
    return binding
  end }) }
end

local function simpleAttributeInfo(code)
  return { Type = "SimpleAttribute", Code = code, ValueType = attributeValueTypes[code] or "text" }
end

function HostGetFeatureIDs()
  local ids = {}
  for _, feature in ipairs(features) do
    ids[#ids + 1] = feature.featureInstanceId
  end
  return ids
end

function HostFeatureGetCode(featureID)
  local feature = findFeature(featureID)
  return feature and feature.featureCode or ""
end

function HostFeatureGetSimpleAttribute(featureID, attributePath, attributeCode)
  return valuesForPathAttribute(findFeature(featureID), attributePath, attributeCode)
end

function HostFeatureGetComplexAttributeCount(featureID, attributePath, attributeCode)
  return complexAttributeCount(findFeature(featureID), attributePath, attributeCode)
end

function HostFeatureGetSpatialAssociations(featureID)
  local feature = findFeature(featureID)
  if not feature then return {} end
  if not feature.spatialType or feature.spatialType == "None" then return {} end
  return { CreateSpatialAssociation(feature.spatialType, feature.featureInstanceId .. ":spatial", "Forward") }
end

function HostGetSpatial(spatialID)
  local id = tostring(spatialID)
  local featureID = id:match("^([^:]+)")
  local feature = findFeature(featureID)
  if not feature then return nil end
  if id:match(":curve$") then
    return createCurveForFeature(feature, ":curve")
  end
  if id:match(":start$") then
    return createPointFromCoordinate(firstCoordinate(feature.coordinates))
  end
  if id:match(":end$") then
    return createPointFromCoordinate(lastCoordinate(feature.coordinates))
  end
  if feature.spatialType == "Point" then
    return createPointFromCoordinate(feature.coordinates)
  end
  if feature.spatialType == "MultiPoint" then
    local points = {}
    for _, coordinate in ipairs(feature.coordinates or {}) do
      points[#points + 1] = createPointFromCoordinate(coordinate)
    end
    if #points == 0 then
      points[#points + 1] = CreatePoint("0", "0")
    end
    return CreateMultiPoint(points)
  end
  if feature.spatialType == "Curve" then
    return createCurveForFeature(feature, ":spatial")
  end
  if feature.spatialType == "Surface" then
    local exteriorRing = CreateSpatialAssociation("Curve", featureID .. ":curve", "Forward")
    return CreateSurface(exteriorRing, {})
  end
  return nil
end
function HostFeatureGetAssociatedFeatureIDs(featureID, associationCode, roleCode) return {} end
function HostFeatureGetAssociatedInformationIDs(featureID, associationCode, roleCode) return {} end
function HostSpatialGetAssociatedFeatureIDs(spatialID)
  local featureID = tostring(spatialID):match("^([^:]+)")
  return featureID and { featureID } or {}
end
function HostSpatialGetAssociatedInformationIDs(spatialID, associationCode, roleCode) return {} end
function HostInformationTypeGetCode(informationID) return "" end
function HostInformationTypeGetSimpleAttribute(informationID, attributePath, attributeCode) return {} end
function HostInformationTypeGetComplexAttributeCount(informationID, attributePath, attributeCode) return 0 end

function HostGetFeatureTypeCodes() return featureTypeCodes end
function HostGetInformationTypeCodes() return informationTypeCodes end
function HostGetSimpleAttributeTypeCodes() return simpleAttributeTypeCodes end
function HostGetComplexAttributeTypeCodes() return {} end
function HostGetFeatureAssociationTypeCodes() return featureAssociationTypeCodes end
function HostGetInformationAssociationTypeCodes() return informationAssociationTypeCodes end
function HostGetRoleTypeCodes() return roleTypeCodes end
function HostGetFeatureTypeInfo(code) return featureTypeInfo() end
function HostGetInformationTypeInfo(code) return featureTypeInfo() end
function HostGetSimpleAttributeTypeInfo(code) return simpleAttributeInfo(code) end
function HostGetComplexAttributeTypeInfo(code) return { Type = "ComplexAttribute", AttributeBindings = {} } end
function HostGetFeatureAssociationTypeInfo(code) return {} end
function HostGetInformationAssociationTypeInfo(code) return {} end
function HostGetRoleTypeInfo(code) return {} end

local function encodeJsonString(value)
  value = tostring(value or "")
  value = value:gsub('\\\\', '\\\\\\\\'):gsub('"', '\\\\"')
  value = value:gsub('[%z\\1-\\31]', function(character)
    if character == '\\n' then return '\\\\n' end
    if character == '\\r' then return '\\\\r' end
    if character == '\\t' then return '\\\\t' end
    return string.format('\\\\u%04x', string.byte(character))
  end)
  return '"' .. value .. '"'
end

function HostPortrayalEmit(featureReference, drawingInstructions, observedContextParameters)
  local itemTrace = {}
  for traceIndex = lastTraceIndex + 1, #trace do
    itemTrace[#itemTrace + 1] = trace[traceIndex]
  end
  lastTraceIndex = #trace
  emitted[#emitted + 1] = {
    featureReference = tostring(featureReference),
    drawingInstructions = tostring(drawingInstructions or ""),
    observedContextParameters = observedContextParameters and tostring(observedContextParameters) or "",
    trace = itemTrace
  }
  return true
end

require "main"
local originalGetTypeInfo = GetTypeInfo
GetTypeInfo = function()
  local ti = originalGetTypeInfo()
  local function ensureInfoTable(tableName, typeName)
    local infoTable = ti[tableName]
    if infoTable and not getmetatable(infoTable) then
      setmetatable(infoTable, { __index = function(t, k)
        local value = { Type = typeName, Code = k }
        rawset(t, k, value)
        return value
      end })
    end
  end
  ensureInfoTable("FeatureTypeInfos", "FeatureTypeInfo")
  ensureInfoTable("InformationTypeInfos", "InformationTypeInfo")
  ensureInfoTable("SimpleAttributeInfos", "SimpleAttributeInfo")
  ensureInfoTable("ComplexAttributeInfos", "ComplexAttributeInfo")
  ensureInfoTable("RoleInfos", "RoleInfo")
  ensureInfoTable("InformationAssociationInfos", "InformationAssociationInfo")
  ensureInfoTable("FeatureAssociationInfos", "FeatureAssociationInfo")
  return ti
end
local originalDefault = Default
Default = function(feature, featurePortrayal, contextParameters)
  table.insert(trace, "Default invoked for " .. tostring(feature and feature.Code or "unknown") .. " ID=" .. tostring(feature and feature.ID or "unknown"))
  return originalDefault(feature, featurePortrayal, contextParameters)
end
local originalPcall = pcall
pcall = function(fn, ...)
  local results = { originalPcall(fn, ...) }
  if not results[1] then
    table.insert(trace, "pcall error: " .. tostring(results[2]))
  end
  return unpack(results)
end

local contextParameters = {
  PortrayalCreateContextParameter("SafetyContour", "real", context.SafetyContour),
  PortrayalCreateContextParameter("SafetyDepth", "real", context.SafetyDepth),
  PortrayalCreateContextParameter("ShallowContour", "real", context.ShallowContour),
  PortrayalCreateContextParameter("DeepContour", "real", context.DeepContour),
  PortrayalCreateContextParameter("TwoShades", "boolean", context.TwoShades),
  PortrayalCreateContextParameter("FourShades", "boolean", context.FourShades),
  PortrayalCreateContextParameter("FullSectors", "boolean", context.FullSectors),
  PortrayalCreateContextParameter("FullLightLines", "boolean", context.FullLightLines),
  PortrayalCreateContextParameter("RadarOverlay", "boolean", context.RadarOverlay),
  PortrayalCreateContextParameter("ShallowWaterDangers", "boolean", context.ShallowWaterDangers),
  PortrayalCreateContextParameter("SimplifiedSymbols", "boolean", context.SimplifiedSymbols),
  PortrayalCreateContextParameter("PlainBoundaries", "boolean", context.PlainBoundaries),
  PortrayalCreateContextParameter("SymbolizedBoundaries", "boolean", context.SymbolizedBoundaries),
  PortrayalCreateContextParameter("IgnoreScaleMinimum", "boolean", context.IgnoreScaleMinimum),
  PortrayalCreateContextParameter("NationalLanguage", "text", context.NationalLanguage),
  PortrayalCreateContextParameter("Date", "date", context.Date),
  PortrayalCreateContextParameter("_Testing_SoundingsAsText_SizeSafe", "real", context._Testing_SoundingsAsText_SizeSafe),
  PortrayalCreateContextParameter("_Testing_SoundingsAsText_SizeUnsafe", "real", context._Testing_SoundingsAsText_SizeUnsafe)
}
PortrayalInitializeContextParameters(contextParameters)
local ok, err = pcall(function() PortrayalMain() end)
if not ok then
  io.stderr:write(tostring(err))
  os.exit(1)
end

io.write("[")
for index, item in ipairs(emitted) do
  if index > 1 then io.write(",") end
  io.write("{")
  io.write('"featureReference":' .. encodeJsonString(item.featureReference) .. ",")
  io.write('"drawingInstructions":' .. encodeJsonString(item.drawingInstructions) .. ",")
  io.write('"observedContextParameters":' .. encodeJsonString(item.observedContextParameters) .. ",")
  io.write('"trace":[')
  local featureTrace = item.trace or {}
  local traceLimit = #featureTrace
  if traceLimit > 5 then traceLimit = 5 end
  for traceIndex = 1, traceLimit do
    local traceItem = tostring(featureTrace[traceIndex] or "")
    if #traceItem > 500 then
      traceItem = traceItem:sub(1, 500) .. "..."
    end
    if traceIndex > 1 then io.write(",") end
    io.write(encodeJsonString(traceItem))
  end
  io.write("]")
  io.write("}")
end
io.write("]")
`;
}

function normalizeLuaFeature(feature: PortrayalFeature): Record<string, unknown> {
  const attributes = normalizeLuaAttributes(feature.attributes);
  return {
    featureInstanceId: feature.featureInstanceId,
    featureCode: feature.featureCode,
    spatialType: geometryTypeToSpatialType(feature.geometryType, feature.geometry),
    coordinates: normalizeGeoJsonCoordinates(feature.geometry),
    attributes: attributes.simpleAttributes,
    complexAttributes: attributes.complexAttributes
  };
}

function normalizeLuaAttributes(attributes: Record<string, unknown>): {
  simpleAttributes: Record<string, unknown>;
  complexAttributes: Record<string, unknown>;
} {
  const normalized: Record<string, unknown> = {};
  const complexAttributes: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (value === null || value === undefined) continue;
    if (key === "__complexAttributes" && typeof value === "object" && !Array.isArray(value)) {
      Object.assign(complexAttributes, value as Record<string, unknown>);
      continue;
    }
    if (Array.isArray(value)) {
      normalized[key] = value.map((item) => scalarLuaAttributeValue(item)).filter((item) => item !== null);
    } else {
      normalized[key] = scalarLuaAttributeValue(value);
    }
  }
  return { simpleAttributes: normalized, complexAttributes };
}

function inferAttributeValueTypes(features: PortrayalFeature[]): Record<string, string> {
  const types: Record<string, string> = {
    beaconShape: "integer",
    buoyShape: "integer",
    categoryOfCardinalMark: "integer",
    categoryOfLight: "integer",
    colour: "integer",
    condition: "integer",
    depthRangeMinimumValue: "real",
    depthRangeMaximumValue: "real",
    dredgedDate: "date",
    featureName: "text",
    fixedDateRange: "text",
    periodicDateRange: "text",
    pictorialRepresentation: "text",
    restriction: "integer",
    scaleMinimum: "integer",
    scaleMaximum: "integer",
    shapeInformation: "text",
    text: "text",
    textOffsetBearing: "real",
    textOffsetDistance: "real",
    textRotation: "integer",
    textType: "integer",
    valueOfDepthContour: "real",
    verticalLength: "real"
  };
  for (const feature of features) {
    for (const [name, value] of Object.entries(feature.attributes)) {
      const scalar = Array.isArray(value) ? value.find((item) => item !== null && item !== undefined) : value;
      if (scalar === null || scalar === undefined) continue;
      if (/date/i.test(name)) {
        types[name] = "date";
      } else if (/depth|valueOf|height|length|width|radius|distance|bearing/i.test(name)) {
        types[name] = "real";
      } else if (typeof scalar === "number") {
        types[name] = Number.isInteger(scalar) ? "integer" : "real";
      } else if (typeof scalar === "boolean") {
        types[name] = "boolean";
      } else {
        types[name] = "text";
      }
    }
  }
  return types;
}

function scalarLuaAttributeValue(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value !== "object") return String(value);
  const record = value as Record<string, unknown>;
  const candidate = record.valueInteger ?? record.valueNumeric ?? record.valueText ?? record.valueDate ?? record.rawValue;
  if (typeof candidate === "string" || typeof candidate === "number" || typeof candidate === "boolean") return candidate;
  return null;
}

function geometryTypeToSpatialType(geometryType: string | null, geometry?: unknown): string {
  if (geometryType === "Point") return "Point";
  if (geometryType === "MultiPoint") return "MultiPoint";
  if (geometryType === "LineString" || geometryType === "MultiLineString") return "Curve";
  if (geometryType === "Polygon" || geometryType === "MultiPolygon") return "Surface";
  if (geometryType === "GeometryCollection") {
    const children = Array.isArray((geometry as Record<string, unknown> | null)?.geometries)
      ? ((geometry as Record<string, unknown>).geometries as Array<Record<string, unknown>>)
      : [];
    if (children.length > 0 && children.every((child) => child.type === "Point" || child.type === "MultiPoint")) {
      return "MultiPoint";
    }
  }
  return "None";
}

function normalizeGeoJsonCoordinates(geometry: unknown): unknown {
  if (!geometry || typeof geometry !== "object") return [];
  const record = geometry as Record<string, unknown>;
  if (Array.isArray(record.coordinates)) return record.coordinates;
  if (record.type === "GeometryCollection" && Array.isArray(record.geometries)) {
    const points: unknown[] = [];
    for (const child of record.geometries as Array<Record<string, unknown>>) {
      if (child.type === "Point" && Array.isArray(child.coordinates)) {
        points.push(child.coordinates);
      } else if (child.type === "MultiPoint" && Array.isArray(child.coordinates)) {
        points.push(...child.coordinates);
      }
    }
    return points;
  }
  return [];
}

function parseLuaHostOutput(stdout: string): LuaPortrayalResult[] {
  const jsonStart = stdout.indexOf("[");
  const jsonEnd = stdout.lastIndexOf("]");
  if (jsonStart === -1 || jsonEnd === -1 || jsonEnd < jsonStart) {
    throw new Error(`Lua portrayal runtime did not return JSON output: ${stdout.slice(0, 500)}`);
  }

  const payload = JSON.parse(stdout.slice(jsonStart, jsonEnd + 1)) as Array<{
    featureReference: string;
    drawingInstructions: string;
    observedContextParameters: string;
    trace?: string[];
  }>;

  return payload.map((item) => ({
    featureReference: item.featureReference,
    rawInstructions: item.drawingInstructions ? [item.drawingInstructions] : [],
    observedContextParameters: item.observedContextParameters || null,
    trace: item.trace ?? []
  }));
}

function toLuaValue(value: unknown): string {
  if (value === null || value === undefined) return "nil";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "nil";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return toLuaString(value);
  if (Array.isArray(value)) {
    return `{${value.map((item) => toLuaValue(item)).join(",")}}`;
  }
  if (typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined && item !== null)
      .map(([key, item]) => `[${toLuaValue(key)}]=${toLuaValue(item)}`)
      .join(",")}}`;
  }
  return toLuaValue(String(value));
}

function toLuaString(value: string): string {
  return `"${value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t")}"`;
}
