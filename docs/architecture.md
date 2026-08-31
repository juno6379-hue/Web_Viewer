# S-101 V2.0 Web Viewer Architecture

Date: 2026-08-31

## Architecture Summary

```text
S101DashboardApp23 / Phase27BatchIngestRunner
  -> s100_dev PostgreSQL/PostGIS
     -> canonical source model
     -> validation results
     -> projection read models
        -> WebViewer API
           -> WebViewer React/MapLibre UI
```

The Web Viewer is a read-side application. It consumes parser output already stored in `s100_dev`; it does not replace parser, canonical persistence, validation, geometry repair, or projection building.

## Runtime Components

| Component | Responsibility |
| --- | --- |
| `apps/api` | Reads `s100_dev`, joins projection/canonical/catalogue data, returns JSON/GeoJSON. |
| `apps/web` | Browser UI, MapLibre map, filters, feature inspector, QA panels. |
| `packages/catalogue` | Parses and caches Feature Catalogue and Portrayal Catalogue metadata. |
| `packages/shared` | Shared TypeScript contracts for datasets, features, QA, and catalogue metadata. |

## Data Flow

1. Parser writes raw and canonical S-101 records into `s100_dev`.
2. Parser/dashboard performs safe `derived_geometry` repair.
3. Projection builder writes current read models.
4. API reads projection tables for map display.
5. API enriches feature output with Feature Catalogue names and attribute metadata.
6. UI renders features with Portrayal Catalogue-derived styling where available.
7. UI shows QA state from canonical/projection/validation checks.

## Frontend Views

| View | Content |
| --- | --- |
| Map canvas | MapLibre base map and S-101 feature layers. |
| Dataset panel | Dataset/version selection and run metadata. |
| Layer panel | Feature type toggles, geometry type filters, warning toggles. |
| Feature inspector | Feature identity, catalogue name, attributes, associations, geometry summary. |
| QA panel | Parser/projection/validation checks and issue counts. |
| Catalogue panel | Feature/attribute/portrayal lookup information. |

## Backend Responsibilities

- Enforce read-only DB behavior.
- Use bbox filters for map feature queries.
- Limit payload size.
- Provide dataset and feature metadata separately from large geometry payloads.
- Expose QA summaries using stable SQL.
- Load catalogue caches at startup or through an explicit build step.
- Return deterministic API shapes defined in `packages/shared`.

## Non-Goals

- Editing S-101 source data.
- Writing to canonical tables.
- Rebuilding projection from the viewer.
- Full S-101 portrayal engine parity in the first milestone.
- Replacing `S101DashboardApp23.exe`.
