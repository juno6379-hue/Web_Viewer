# S-101 V2.0 Web Viewer Development Procedure

Date: 2026-08-31

## Goal

Build an S-101 V2.0 Web Viewer in `D:\dev\WebViewer` using the existing `s100_dev` PostgreSQL/PostGIS database and the S-100/S-101 documentation, Feature Catalogue, and Portrayal Catalogue under:

```text
D:\dev\s100-parser\_2026-08-21 S100 문서 및 파서
```

The viewer must be catalogue-aware, projection-driven, and QA-visible. It must not bypass the canonical model created by the parser.

## Core DB Access Principle

The required data path is:

```text
canonical
  -> projection
  -> API
  -> WebViewer
```

This means:

- `canonical` is the source of truth;
- `projection` is the service read model;
- `WebViewer` consumes projection through API endpoints;
- the UI must not directly assemble features from canonical feature, attribute, spatial, or topology tables;
- the API may read canonical tables only for detail panels, QA evidence, and validation context.

## Development Order

1. Confirm source material paths.
2. Create `D:\dev\WebViewer`.
3. Scaffold a modern web stack.
4. Connect to `s100_dev`.
5. Expose dataset/version APIs.
6. Expose feature GeoJSON APIs from `projection.s101_feature_geojson`.
7. Parse/cache Feature Catalogue mappings.
8. Parse/cache Portrayal Catalogue rules and assets.
9. Render MapLibre layers.
10. Add feature inspect panel.
11. Add dataset/version/filter controls.
12. Add QA summary panel.
13. Add validation issue panel.
14. Add performance safeguards for large datasets.
15. Write smoke tests and local run instructions.

## Source Material

| Input | Expected path |
| --- | --- |
| S-100/S-101 documents | `D:\dev\s100-parser\_2026-08-21 S100 문서 및 파서\문서` |
| Existing parser reference | `D:\dev\s100-parser\_2026-08-21 S100 문서 및 파서\파서` |
| Feature Catalogue archive | `D:\dev\s100-parser\_2026-08-21 S100 문서 및 파서\101_Feature_Catalogue_2.0.0.xml.signature.zip` |
| Portrayal Catalogue archive | `D:\dev\s100-parser\_2026-08-21 S100 문서 및 파서\101_Portrayal_Catalogue_2.0.0.zip.signature.zip` |
| Parser DB | `s100_dev` on local port `55432` |

Do not commit extracted proprietary or large catalogue artifacts unless licensing and size are explicitly approved.

## First Implementation Milestone

| Requirement | Pass condition |
| --- | --- |
| App starts | API and web dev servers run locally. |
| DB connects | `/api/health/db` returns current database/user. |
| Dataset list works | Viewer can list parsed S-101 datasets. |
| Map renders | MapLibre shows features from `projection.s101_feature_geojson`. |
| Inspect works | Clicking a feature shows type, IDs, attributes, and raw properties. |
| QA visible | A selected dataset shows invalid/null geometry, missing GeoJSON, and blocking validation counts. |

## Guardrails

- Do not duplicate parser logic in the viewer.
- Do not write to `canonical.*` from the viewer.
- Do not use canonical joins as the primary map/list rendering path.
- Treat `projection.*` as rebuildable read models.
- Keep DB credentials in `.env`; commit only `.env.example`.
- Keep large S-101 datasets and generated catalogue caches out of Git unless explicitly approved.
- Show unresolved/null geometry as QA evidence; do not fabricate geometry in the viewer.
