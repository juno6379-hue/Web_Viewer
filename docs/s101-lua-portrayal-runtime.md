# S-101 Lua Portrayal Runtime Integration

Date: 2026-09-02

## Current Flow

The WebViewer now uses the parser database projection as the map source, enriches feature and attribute names from the S-101 Feature Catalogue, then executes S-101 Portrayal Catalogue Lua rules to create drawing instructions.

```text
projection.s101_feature_geojson
  -> API feature payload
  -> Feature Catalogue code/name lookup
  -> Lua Host API feature/spatial/attribute access
  -> main.lua / HostPortrayalEmit()
  -> DrawingInstruction parser
  -> MapLibre symbol, text, line, and area layers
```

## Runtime Requirements

The API requires these environment variables for full catalogue portrayal:

```text
LUA_RUNTIME_PATH=C:\Users\최준오\AppData\Local\Programs\LuaJIT\bin\luajit.exe
FEATURE_CATALOGUE_PATH=D:\dev\s100-parser\_2026-08-21 S100 문서 및 파서\101_Feature_Catalogue_2.0.0.xml.signature\S-101\CATALOGUES\101_Feature_Catalogue_2.0.0.xml
PORTRAYAL_CATALOGUE_PATH=D:\dev\s100-parser\_2026-08-21 S100 문서 및 파서\101_Portrayal_Catalogue_2.0.0.zip.signature\S-101\CATALOGUES\101_Portrayal_Catalogue_2.0.0\PortrayalCatalog
```

Verified status on 2026-09-02:

```text
GET /api/portrayal/status
mode=lua
luaRuntime=configured
symbolCount=718
ruleCount=215
paletteReady=true
```

## Host API Coverage Added

`apps/api/src/luaPortrayalRuntime.ts` now supplies the Lua rules with:

- feature IDs and feature type codes;
- simple attribute values through catalogue-resolved attribute paths;
- complex attribute counts from ATIX/PAIX-derived trees;
- point, multipoint, curve, and surface spatial associations;
- real GeoJSON coordinates instead of dummy `0,0` geometry;
- 3D point Z values when projection GeoJSON contains them;
- Feature Catalogue permitted primitives passed to the Lua Host API, so a `MultiPoint`
  projection can be normalized to `Point` when the S-101 feature type permits point
  portrayal;
- chunked Lua execution for large cells to avoid LuaJIT constant limits when a full
  cell contains thousands of features;
- per-feature Lua trace output instead of copying a global batch trace to every feature.

## Catalogue Lookup

`apps/api/src/routes.ts` resolves missing projection names at API time:

- `featureTypeCode -> featureName`;
- `attribute code -> attribute name`;
- simple and complex attribute record grouping for Lua input;
- search/detail payloads use the same Feature Catalogue lookup as map rendering.

Feature Catalogue attribute code lookup treats simple attributes first and complex attributes after the simple-attribute count. This prevents complex attribute sequence values such as `featureName` from overwriting simple attribute codes such as `beaconShape`.

## Map Rendering

`apps/web/src/ui/App.tsx` now renders:

- catalogue symbol SVGs through `s101-symbol`;
- Lua `AugmentedPoint` coordinates for point instructions;
- `TextInstruction` payloads through `s101-text`;
- line and area instructions through existing line/fill layer properties.

Sounding rendering depends on `Sounding` feature MultiPoint Z values. If the DB projection contains 2D points only, the Lua `Sounding` rule emits fallback question-mark symbols instead of numeric sounding symbols.

For the first 10 loaded cells verified on 2026-09-02, the API returns `portrayalSource=lua`
without full-batch fallback. Remaining question-mark symbols are produced by S-101 Lua
rules when the imported DB geometry does not match the Feature Catalogue primitive, for
example `Rapids`, `River`, `Runway`, `SpanOpening`, `Road`, and `Tunnel` records imported
as `MultiPoint` even though the catalogue permits `curve` and/or `surface`.

## DB Reload Requirement

Existing DB rows created before the 2026-09-02 parser projection fix may still have 2D sounding geometries and unresolved attribute catalogue names. Re-run parser loading/projection rebuild with the rebuilt `S101DashboardApp26.exe` to populate:

- 3D sounding coordinates in projection geometry/GeoJSON;
- corrected Feature Catalogue attribute names and value types;
- Lua-compatible feature name, FOID, attribute value, and rule matching across cells.
