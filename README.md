# Web_Viewer

S-101 V2.0 Web Viewer is the planned browser viewer for S-100/S-101 hydrographic datasets parsed by the S100 Parser project.

The viewer will use the existing local parser database:

```text
Host=127.0.0.1;Port=55432;Database=s100_dev;Username=s100_dev;Password=CHANGE_ME_LOCAL_ONLY
```

It reads canonical, validation, audit, and projection data created by `S101DashboardApp23.exe` and `Phase27BatchIngestRunner.exe`. The viewer does not replace the parser or write canonical data.

## Source Inputs

| Input | Path |
| --- | --- |
| S-100/S-101 documents and parser reference | `D:\dev\s100-parser\_2026-08-21 S100 문서 및 파서` |
| Feature Catalogue archive | `D:\dev\s100-parser\_2026-08-21 S100 문서 및 파서\101_Feature_Catalogue_2.0.0.xml.signature.zip` |
| Portrayal Catalogue archive | `D:\dev\s100-parser\_2026-08-21 S100 문서 및 파서\101_Portrayal_Catalogue_2.0.0.zip.signature.zip` |
| Parser DB | `s100_dev` Docker PostgreSQL/PostGIS on port `55432` |

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
s100_dev projection/canonical DB
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

This repository currently contains the agreed development documentation. Implementation will start after this baseline is committed.
