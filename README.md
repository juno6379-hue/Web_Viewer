# Web_Viewer

S-101 V2.0 Web Viewer is the planned browser viewer for S-100/S-101 hydrographic datasets parsed by the S100 Parser project.

The viewer uses the existing local parser database:

```text
Host=127.0.0.1;Port=55432;Database=s100_dev;Username=s100_dev;Password=CHANGE_ME_LOCAL_ONLY
```

It reads canonical, validation, audit, and projection data created by `S101DashboardApp23.exe` and `Phase27BatchIngestRunner.exe`. The viewer does not replace the parser and does not write canonical data.

## Source Inputs

| Input | Path |
| --- | --- |
| S-100/S-101 documents and parser reference | `D:\dev\s100-parser\_2026-08-21 S100 문서 및 파서` |
| Feature Catalogue archive | `D:\dev\s100-parser\_2026-08-21 S100 문서 및 파서\101_Feature_Catalogue_2.0.0.xml.signature.zip` |
| Portrayal Catalogue archive | `D:\dev\s100-parser\_2026-08-21 S100 문서 및 파서\101_Portrayal_Catalogue_2.0.0.zip.signature.zip` |
| Parser DB | `s100_dev` Docker PostgreSQL/PostGIS on port `55432` |

## DB Access Principle

The most important rule is that the Web Viewer consumes service-ready projection data. It must not directly assemble features from canonical tables in the browser.

```text
canonical
  -> projection
  -> API
  -> WebViewer
```

Roles:

- `canonical` is the parser source of truth.
- `projection` is the service read model.
- `API` is the only layer that may combine projection, catalogue, validation, and selected canonical evidence.
- `WebViewer` is a projection consumer.

Forbidden default behavior:

- building map features directly from `canonical.feature_instance`;
- building display attributes directly from canonical attribute tables in the browser;
- rendering geometry by joining `canonical.spatial_record`, `canonical.spatial_reference`, `canonical.curve_segment`, or `canonical.surface_boundary`;
- exposing broad canonical joins as generic viewer endpoints.

Allowed API-internal canonical reads:

- one-feature detail inspector;
- QA summary and validation diagnostics;
- relationship and topology proof counts;
- catalogue-enriched detail responses.

Map rendering must start from `projection.s101_feature_geojson` or `projection.s101_feature_current`.

## Target Stack

| Area | Technology |
| --- | --- |
| Frontend | Vite + React + TypeScript |
| Map | MapLibre GL JS |
| API | Node.js + Fastify |
| DB driver | `pg` |
| UI | Tailwind CSS or shadcn/ui |
| Tests | Vitest + Playwright |

## Planned Layout

```text
D:\dev\WebViewer
  apps\
    api\        Fastify API server
    web\        Vite React TypeScript viewer
  packages\
    catalogue\  Feature/Portrayal catalogue parsers and cache builders
    shared\     Shared TypeScript contracts
  docs\
    development-procedure.md
    architecture.md
    db-api-contract.md
    catalogue-integration.md
    qa-validation-plan.md
  .env.example
  README.md
```

## Viewer Flow

```text
s100_dev projection read models
  -> WebViewer API
  -> Feature Catalogue name/value mapping
  -> Portrayal Catalogue style mapping
  -> React + MapLibre map
  -> feature inspector
  -> QA and validation panels
```

## First Milestone

The first useful version is complete when:

- the API connects to `s100_dev`;
- datasets can be listed;
- `projection.s101_feature_geojson` can be loaded by dataset and bbox;
- features render on a MapLibre map;
- feature click opens an inspector;
- Feature Catalogue names are shown where available;
- QA summary shows invalid/null geometry, missing GeoJSON, and blocking validation counts.

## Documents

- `docs/development-procedure.md`: full development procedure.
- `docs/architecture.md`: runtime architecture and responsibilities.
- `docs/db-api-contract.md`: DB tables and API endpoint contract.
- `docs/catalogue-integration.md`: Feature Catalogue and Portrayal Catalogue plan.
- `docs/qa-validation-plan.md`: viewer QA and smoke validation plan.

## Current Status

This repository currently contains the agreed development documentation. Implementation starts from this projection-first API boundary.
