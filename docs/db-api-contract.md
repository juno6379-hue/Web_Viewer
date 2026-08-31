# S-101 Web Viewer DB and API Contract

Date: 2026-08-31

## Database

```text
Host=127.0.0.1;Port=55432;Database=s100_dev;Username=s100_dev;Password=CHANGE_ME_LOCAL_ONLY
```

The DB runs in Docker container `s100_dev_postgis` and stores data in Docker volume `s100_dev_pgdata`.

## Read Model Priority

| Priority | Source | Use |
| ---: | --- | --- |
| 1 | `projection.s101_feature_geojson` | Map feature geometry and GeoJSON payloads. |
| 2 | `projection.s101_feature_current` | Current feature rows, geometry presence, feature filters. |
| 3 | `projection.s101_dataset_current` | Dataset current metadata and extents. |
| 4 | `canonical.*` | Source-model evidence for detail panels and QA checks. |
| 5 | `validation.*` | Validation status and issue display. |
| 6 | `audit.*` | Parser/projection run history. |

## Mandatory Access Boundary

The viewer access path is:

```text
canonical
  -> projection
  -> API
  -> WebViewer
```

`canonical.*` is not the viewer service model. It is the parser source of truth. `projection.*` is the service read model.

Forbidden default behavior:

- building map features by joining `canonical.feature_instance` to `canonical.spatial_record`;
- building display attributes directly from canonical attribute tables in the browser;
- using `canonical.spatial_reference`, `canonical.curve_segment`, or `canonical.surface_boundary` as the primary rendering source;
- exposing broad canonical table joins as generic viewer endpoints.

Allowed API-internal canonical reads:

- feature inspector evidence for one selected feature;
- QA summary and validation diagnostics;
- relationship and topology proof counts;
- catalogue-enriched detail responses.

Map and list endpoints must prefer `projection.s101_feature_geojson`, `projection.s101_feature_current`, and `projection.s101_dataset_current`.

## API Endpoints

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health/db` | DB connectivity and current database/user. |
| `GET /api/datasets` | Parsed dataset list. |
| `GET /api/datasets/:datasetId/versions` | Dataset versions from `canonical.dataset_version`. |
| `GET /api/features` | GeoJSON FeatureCollection from `projection.s101_feature_geojson`. |
| `GET /api/features/:featureInstanceId` | Feature detail, attributes, associations, and geometry summary. The API may use canonical tables internally for this detail view. |
| `GET /api/catalogue/features` | Feature Catalogue feature type metadata. |
| `GET /api/catalogue/attributes` | Feature Catalogue attribute metadata. |
| `GET /api/qa/summary` | Dashboard-equivalent QA counts. |
| `GET /api/qa/issues` | Validation issues by dataset/version and severity. |

## Feature Query Parameters

| Parameter | Required | Meaning |
| --- | --- | --- |
| `datasetId` | yes | Canonical dataset id. |
| `datasetVersionId` | recommended | Current dataset version id. |
| `bbox` | no | `minX,minY,maxX,maxY` in EPSG:4326. |
| `featureTypeCode` | no | Numeric S-101 feature type code. |
| `limit` | no | Maximum rows to return. |

## QA Summary Shape

```json
{
  "featureRecordWithoutInstance": 0,
  "informationRecordWithoutInstance": 0,
  "attributeOwnerMissing": 0,
  "complexAttributeOwnerMissing": 0,
  "associationSourceMissing": 0,
  "associationTargetMissing": 0,
  "spatialReferenceCrossVersion": 0,
  "curveEndpointCrossVersion": 0,
  "surfaceBoundaryCrossVersion": 0,
  "invalidGeometry": 0,
  "nullGeometry": 14,
  "nullNoSourceData": 14,
  "nullInvalidTopology": 0,
  "projectedFeatures": 11,
  "geoJsonRows": 11,
  "missingGeoJson": 0,
  "blockingValidationIssues": 0
}
```

## SQL Guardrails

- Always scope spatial and QA queries by `dataset_version_id`.
- Avoid full-table `ST_IsValid` scans.
- Use bbox filtering for map queries.
- Return `projection.s101_feature_geojson.geometry_geojson` directly when possible.
- Use prepared parameters; do not interpolate user input into SQL.
- Keep canonical joins inside API services; never require the WebViewer UI to understand canonical table topology.
