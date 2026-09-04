# S-101 parser-viewer phase 45 catalogue and portrayal remediation

Date: 2026-09-04

## Purpose

This document defines the remediation work required to make the S-101 parser,
database projection, loader, API, Lua portrayal runtime, and WebViewer use one
consistent catalogue-aware model.

The target structure is:

```text
S-101 cell
  -> ISO/IEC 8211 decode
  -> DSID/local code table decode
  -> Feature Catalogue lookup
  -> canonical DB
  -> projection DB
  -> Lua portrayal feature object
  -> HostPortrayalEmit drawing instructions
  -> WebViewer rendering
```

The WebViewer API may keep runtime fallback lookups for diagnostics, but the
primary source of feature name, attribute name, value type, scale metadata, and
portrayal inputs must be the parser-loaded DB.

## Current verification snapshot

Database: `s100_dev`

Runtime health:

```text
database=ok
projection=ok
featureCatalogue=2.0.0
portrayalCatalogue=2.0.0
```

Current DB counts:

```text
canonical.dataset_version              808
projection.s101_dataset_current        808
canonical.feature_record            787197
projection.s101_feature_current     774485
projection.s101_feature_geojson     774485
canonical.feature_attribute_value    701370
canonical.spatial_record           2304273
canonical.spatial_reference          788261
```

Projection integrity:

```text
projection.s101_feature_current.feature_type_code
  equals canonical.feature_record.nftc for 774485/774485 projected rows

projection.s101_feature_geojson rows without feature_current: 0
projection.s101_feature_geojson null geometry_geojson: 0
projection.s101_feature_geojson null bbox: 0
projection.s101_dataset_current null bbox: 0
```

Catalogue resolution gap:

```text
canonical.feature_attribute_value total: 701370
catalogue_name missing: 696702
catalogue_name present: 4667
datasets with named attributes: 1
datasets without named attributes: 807
only named dataset observed: 101KR001G0000.000
```

Scale metadata gap:

```text
projection.s101_dataset_current min_scale null: 808
projection.s101_dataset_current max_scale null: 808
```

Confirmed S-101 Feature Catalogue 2.0 sequence mapping:

```text
42 -> Landmark
61 -> Bollard
97 -> SubmarinePipelineArea
```

Confirmed attribute sequence mapping used by Landmark portrayal:

```text
34  -> categoryOfLandmark
107 -> function
120 -> inTheWater
171 -> scaleMinimum
229 -> visualProminence
```

Confirmed lighthouse/tower sample:

```text
feature_instance_id: 5879
dataset: 101KR001G0000.000
feature_type_code: 42
feature_name: Landmark
rcid: 1725
position: 129.5666667,36.0780556
categoryOfLandmark: 17
Lua rule: Landmark.lua
drawing instruction: PointInstruction:TOWERS01
symbol endpoint: /api/portrayal/symbols/TOWERS01.svg
```

## Implemented on 2026-09-04

Parser ingest now preserves local-code and Feature Catalogue-code roles
separately:

```text
canonical.feature_record.raw_nftc            original FRID/local feature code
canonical.feature_record.nftc                resolved S-101 Feature Catalogue code
canonical.feature_record.feature_type_name   resolved S-101 Feature Catalogue name

canonical.feature_attribute_value.raw_natc   original ATTR/local attribute code
canonical.feature_attribute_value.natc       resolved S-101 Feature Catalogue code
canonical.feature_attribute_value.catalogue_name
                                             resolved S-101 Feature Catalogue name

canonical.complex_attribute_instance.raw_natc
                                             original complex ATTR/local code
canonical.complex_attribute_instance.natc    resolved S-101 Feature Catalogue code
```

Projection now carries the same resolved feature semantics to the API:

```text
projection.s101_feature_current.raw_feature_type_code
projection.s101_feature_current.feature_type_name
projection.s101_feature_current.min_scale
projection.s101_feature_current.max_scale
projection.s101_dataset_current.usage_band
```

`projection.s101_feature_current.min_scale` is populated from S-101
`scaleMinimum` attributes when spatial reference `smin` is not present.
`projection.s101_dataset_current.min_scale` is derived from projected feature
scale values.

The API now exposes DB-sourced feature names and dataset identity in
`/api/features` properties:

```text
datasetId
datasetVersionId
dsnm
rawFeatureTypeCode
featureTypeName
```

Persistence commands used by parser ingest were normalized to a 600 second
command timeout. This prevents large S-101 cells from failing during long
canonical/projection writes with an Npgsql stream read timeout.

## Single-cell verification on 2026-09-04

Test cell:

```text
101KR001G0000.000
dataset_version_id: 10
```

Batch ingest result:

```text
1/1|COMMITTED|101KR001G0000.000
parse_ms=55810
persist_ms=192267
projection_ms=289094
feature=1883
attr=4668
spatial=3050
warning=502
error=0
```

Catalogue persistence checks:

```text
feature_records: 1883
unnamed_feature_records: 0
attributes: 4667
missing_attr_names: 0
```

Projection geometry checks for the main displayed classes:

```text
LandArea                   648  null_geom=0
Coastline                  422  null_geom=0
Landmark                   118  null_geom=0
LightAllAround              72  null_geom=0
ShorelineConstruction       71  null_geom=0
DepthArea                   46  null_geom=0
Sounding                     8  null_geom=0
```

Landmark tower trace:

```text
feature_instance_id: 5879
raw_feature_type_code: 37
feature_type_code: 42
feature_type_name: Landmark
categoryOfLandmark: 17
function: 32
scaleMinimum: 3499999
projection min_scale: 3499999
geometry: MultiPoint(129.5666667 36.0780556)
Lua drawing instruction: PointInstruction:TOWERS01
```

Remaining known gap:

```text
Only the reingested dataset has fully populated catalogue names.
The remaining 807 existing datasets still need reingest or controlled
projection rebuild from catalogue-aware canonical rows.
```

## Problem statement

The parser and DB are not yet the authoritative S-101 semantic model for all
loaded cells.

Feature code projection is internally consistent, but most attribute catalogue
names and value types are absent from the DB. The API currently compensates for
some feature and attribute names at runtime. That works for isolated checks, but
it is not sufficient for S-101 portrayal because Lua rules require feature
names, simple attributes, complex attributes, associations, scale context, and
metadata to be resolved before portrayal execution.

## Target DB responsibilities

### S101_meta equivalent

Canonical source:

```text
canonical.dataset
canonical.dataset_version
canonical.specification_bundle
audit.parser_run
validation.validation_run
validation.conformance_status
```

Required responsibilities:

- Store DSID metadata and edition/update information.
- Store product specification and catalogue snapshot identifiers.
- Store parser code revision and catalogue hash used at ingest time.
- Preserve source file identity and source record ordinal.
- Expose the active dataset version to projection.

Required additions or fixes:

- Add or populate feature catalogue version/hash on ingest.
- Add or populate portrayal catalogue version/hash when available.
- Make the API expose parser catalogue hash and viewer catalogue hash mismatch
  warnings.

### S101_feature equivalent

Canonical source:

```text
canonical.feature_instance
canonical.feature_record
```

Projection source:

```text
projection.s101_feature_current
projection.s101_feature_geojson
```

Required responsibilities:

- Preserve raw FRID feature type code.
- Preserve resolved Feature Catalogue feature type code.
- Preserve resolved Feature Catalogue feature type name.
- Preserve FOID, RCID, RVER, RUIN, and source record ordinal.
- Preserve lifecycle state.
- Join to spatial references and derived geometry.

Required additions or fixes:

- Store both raw local feature code and resolved S-101 FC code.
- Store resolved feature type name in canonical and projection tables, not only
  in the API response.
- Validate every active projected feature has a known Feature Catalogue entry,
  except records explicitly marked as unsupported.

### feature_attr equivalent

Canonical source:

```text
canonical.feature_attribute_value
canonical.complex_attribute_instance
canonical.complex_attribute_member
```

Required responsibilities:

- Preserve raw ATTR/NATC code.
- Preserve resolved Feature Catalogue attribute code.
- Preserve resolved attribute name.
- Preserve value type.
- Preserve raw value, typed value, enumeration code, and enumeration label.
- Preserve ATIX/PAIX/ATIN and source attribute ordinal.
- Rebuild nested complex attribute trees deterministically for Lua input.

Required additions or fixes:

- Store both raw local attribute code and resolved S-101 FC attribute code.
- Backfill or reingest all 808 cells so `catalogue_name` is populated.
- Treat missing catalogue names as a blocking validation error for production
  ingest.
- Keep API fallback `attributeNameByCode()` only for diagnostics, not as the
  main portrayal path.
- Ensure Lua input contains both direct simple attributes and
  `__complexAttributes` where the S-101 portrayal rule expects nested
  structures.

### S101_datacoverage equivalent

Current projection:

```text
projection.s101_dataset_current
```

Required responsibilities:

- Store dataset coverage geometry.
- Store S-101 DataCoverage feature records separately from dataset extent.
- Store usage band and scale metadata.
- Support viewport rendering across multiple cells by bbox and usage band.

Required additions or fixes:

- Do not rely only on feature geometry extent for coverage semantics.
- Materialize DataCoverage feature type and its attributes.
- Populate `min_scale` and `max_scale` or add explicit usage-band columns.
- Preserve DSNM-derived usage band as a fallback field, not the primary scale
  model.

### Association and information objects

Canonical source:

```text
canonical.information_instance
canonical.information_record
canonical.association
canonical.association_member
canonical.spatial_reference
```

Required responsibilities:

- Resolve association type and role names through the Feature Catalogue.
- Preserve feature-to-feature and feature-to-information references.
- Preserve spatial reference order, orientation, SMIN, SMAX, and SAUI.
- Feed associated information objects into Lua where required.

Required additions or fixes:

- Include referenced information object attributes in the Lua feature object.
- Add validation for unresolved association targets and unresolved roles.
- Confirm light sectors, names, text groups, quality information, and
  restriction/caution rules use associated records correctly.

### Spatial and topology

Canonical source:

```text
canonical.spatial_record
canonical.spatial_reference
canonical.coordinate
canonical.curve_segment
canonical.surface_boundary
```

Projection source:

```text
projection.s101_feature_current.geometry
projection.s101_feature_geojson.geometry_geojson
```

Required responsibilities:

- Decode point, multipoint, curve, composite curve, and surface topology.
- Preserve source topology components and source record ordinal for audit.
- Build valid PostGIS geometries for projection.
- Keep validation evidence for incomplete RIAS/CUCO/curve chains.

Required additions or fixes:

- Continue treating null geometry as a blocking projection error.
- Classify `GeometryCollection` rows by cause:
  mixed primitive references, valid multi-primitive feature, or topology
  fallback.
- Store topology grouping evidence for exterior/interior ring decisions.
- Keep source record pointers for invalid topology warnings.

## Parser ingest remediation plan

### Step 1: Catalogue snapshot binding

Implement an ingest-time catalogue snapshot object:

```text
catalogue_snapshot_id
catalogue_version
catalogue_hash
feature_catalogue_path
portrayal_catalogue_path
loaded_at
```

Acceptance criteria:

- Every parser run records the Feature Catalogue path and hash.
- Every dataset_version can be traced to the catalogue snapshot used to resolve
  its feature and attribute codes.

### Step 2: Raw and resolved code columns

Add or populate paired code fields:

```text
feature_record.raw_feature_type_code
feature_record.feature_type_code
feature_record.feature_type_name

feature_attribute_value.raw_attribute_code
feature_attribute_value.attribute_code
feature_attribute_value.catalogue_name
```

Acceptance criteria:

- `raw_*` values preserve source/local codes.
- resolved values match S-101 Feature Catalogue 2.0 definitions.
- API no longer needs to infer feature names for normal rows.

### Step 3: Attribute semantic persistence

Fix attribute persistence so the output of `S101AttributeSemanticBinder` is
always written.

Acceptance criteria:

```sql
SELECT
  COUNT(*) AS total,
  COUNT(*) FILTER (
    WHERE catalogue_name IS NULL OR catalogue_name = ''
  ) AS missing_name
FROM canonical.feature_attribute_value;
```

Expected:

```text
missing_name = 0
```

Known exception handling must be explicit and counted separately.

### Step 4: Dataset coverage and scale materialization

Populate coverage and scale fields from S-101 metadata and DataCoverage feature
attributes.

Acceptance criteria:

```sql
SELECT
  COUNT(*) AS datasets,
  COUNT(*) FILTER (WHERE bbox IS NULL) AS null_bbox,
  COUNT(*) FILTER (WHERE min_scale IS NULL) AS null_min_scale,
  COUNT(*) FILTER (WHERE max_scale IS NULL) AS null_max_scale
FROM projection.s101_dataset_current;
```

Expected:

```text
null_bbox = 0
null_min_scale = 0 or documented exception count
null_max_scale = 0 or documented exception count
```

### Step 5: Lua portrayal materialization

Decide whether to materialize Lua drawing instructions in DB or compute them in
the API cache. For production verification, materializing is preferred:

```text
projection.s101_feature_portrayal
  feature_instance_id
  catalogue_snapshot_id
  portrayal_catalogue_hash
  display_mode
  scale_denominator
  raw_instructions
  parsed_instruction_json
  primary_symbol_ref
  line_style_ref
  area_fill_ref
  text
  trace
  generated_at
```

Acceptance criteria:

- Landmark category 17 produces `TOWERS01`.
- Sounding produces sounding text/symbol instructions.
- LandArea, DepthArea, Coastline, DepthContour, LightAllAround, LightSectored,
  Wreck, Obstruction, buoy, beacon, and restricted-area features produce
  feature-specific instructions, not a generic default symbol.

### Step 6: Full 808-cell reingest

After parser fixes, reingest the complete 808-cell set.

Acceptance criteria:

- 808 dataset versions loaded.
- All active projected features have geometry and GeoJSON.
- Attribute catalogue names are populated for all supported attributes.
- Projection validation completes without blocking errors.
- WebViewer renders viewport cells by scale/usage band.

## API and WebViewer remediation plan

### API

Required changes:

- Read resolved feature name and attribute name from DB first.
- Return catalogue snapshot metadata with datasets and features.
- Expose feature dataset fields in `/api/features`, including:

```text
datasetId
datasetVersionId
dsnm
featureTypeName
catalogueSnapshotId
```

- Keep runtime catalogue fallback fields clearly marked as fallback.
- Add diagnostic endpoints for catalogue health:

```text
/api/catalogue/coverage
/api/catalogue/feature-code/:code
/api/catalogue/attribute-code/:code
/api/portrayal/trace/:featureInstanceId
```

### WebViewer

Required changes:

- Render merged viewport features by bbox and scale/usage band.
- Display selected feature DB-resolved names and fallback names separately.
- Show Lua rule name, raw instructions, parsed instructions, symbol refs, and
  trace in Feature Inspector.
- Warn when a feature uses fallback portrayal.
- Provide a trace action for one feature, such as `feature_instance_id=5879`.

## Required validation queries

Feature code consistency:

```sql
SELECT
  COUNT(*) AS total,
  COUNT(*) FILTER (
    WHERE fc.feature_type_code IS DISTINCT FROM fr.nftc
  ) AS feature_code_mismatch
FROM projection.s101_feature_current fc
JOIN canonical.feature_record fr
  ON fr.feature_record_id = fc.feature_record_id;
```

Attribute catalogue coverage:

```sql
SELECT
  COUNT(*) AS total,
  COUNT(*) FILTER (
    WHERE catalogue_name IS NULL OR catalogue_name = ''
  ) AS missing_catalogue_name
FROM canonical.feature_attribute_value;
```

Dataset-level attribute coverage:

```sql
SELECT
  dc.dsnm,
  COUNT(*) AS attrs,
  COUNT(*) FILTER (
    WHERE fav.catalogue_name IS NULL OR fav.catalogue_name = ''
  ) AS missing_names,
  COUNT(*) FILTER (
    WHERE fav.catalogue_name IS NOT NULL AND fav.catalogue_name <> ''
  ) AS named
FROM projection.s101_dataset_current dc
JOIN projection.s101_feature_current fc
  ON fc.dataset_version_id = dc.dataset_version_id
JOIN canonical.feature_attribute_value fav
  ON fav.feature_record_id = fc.feature_record_id
GROUP BY dc.dsnm
ORDER BY dc.dsnm;
```

GeoJSON projection integrity:

```sql
SELECT
  COUNT(*) AS geojson_total,
  COUNT(*) FILTER (WHERE fc.feature_instance_id IS NULL) AS without_feature,
  COUNT(*) FILTER (WHERE gj.geometry_geojson IS NULL) AS null_geojson,
  COUNT(*) FILTER (WHERE gj.bbox IS NULL) AS null_bbox
FROM projection.s101_feature_geojson gj
LEFT JOIN projection.s101_feature_current fc
  ON fc.feature_instance_id = gj.feature_instance_id;
```

Scale coverage:

```sql
SELECT
  COUNT(*) AS datasets,
  COUNT(*) FILTER (WHERE bbox IS NULL) AS null_bbox,
  COUNT(*) FILTER (WHERE min_scale IS NULL) AS null_min_scale,
  COUNT(*) FILTER (WHERE max_scale IS NULL) AS null_max_scale
FROM projection.s101_dataset_current;
```

Landmark tower portrayal check:

```sql
SELECT
  fc.feature_instance_id,
  dc.dsnm,
  fc.feature_type_code,
  fav.catalogue_name,
  fav.value_integer,
  fav.value_text,
  fav.raw_value
FROM projection.s101_feature_current fc
JOIN projection.s101_dataset_current dc
  ON dc.dataset_version_id = fc.dataset_version_id
JOIN canonical.feature_attribute_value fav
  ON fav.feature_record_id = fc.feature_record_id
WHERE fc.feature_type_code = 42
  AND fav.catalogue_name = 'categoryOfLandmark'
  AND COALESCE(fav.value_integer::text, fav.value_text, fav.raw_value) = '17'
ORDER BY fc.feature_instance_id
LIMIT 20;
```

API portrayal check:

```text
GET /api/features/5879
GET /api/features?bbox=129.55,36.07,129.58,36.09&usageBands=G&limit=200
GET /api/portrayal/symbols/TOWERS01.svg
```

Expected:

```text
featureName=Landmark
categoryOfLandmark=17
portrayalInstructionSource=lua
portrayalSymbolRef=TOWERS01
geometry=MultiPoint
```

## Definition of done

The remediation is complete only when all of the following are true:

- All 808 cells are loaded by the fixed parser.
- Feature Catalogue code lookup is recorded in DB, not only inferred by API.
- Attribute Catalogue code lookup is recorded in DB for all supported
  attributes.
- DataCoverage and scale/usage-band metadata are available to projection.
- Lua portrayal receives feature names, attribute values, complex attributes,
  associations, and context parameters from DB-resolved data.
- WebViewer renders mixed point, line, surface, text, and symbol portrayal from
  Lua drawing instructions across multiple cells in the viewport.
- Feature Inspector can trace a selected feature from DB source record through
  catalogue lookup, Lua rule, drawing instruction, symbol asset, and map layer.
