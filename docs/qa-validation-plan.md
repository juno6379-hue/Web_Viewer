# S-101 Web Viewer QA and Validation Plan

Date: 2026-08-31

## Purpose

The Web Viewer must expose the same quality gates already used by `S101DashboardApp23.exe` so map rendering can be trusted against the parser database.

## Required QA Panels

| Panel | Required content |
| --- | --- |
| Dataset status | dataset id, latest version, edition, update number, profile, parser run status. |
| Projection status | projected feature count, GeoJSON count, missing GeoJSON count. |
| Geometry status | invalid geometry, null geometry, null-no-source, null-invalid-topology. |
| Relationship status | feature/information instance links, attribute owners, association source/target. |
| Topology status | spatial reference, curve endpoint, and surface boundary cross-version checks. |
| Validation issues | critical/error/fatal issues first, warnings separately. |

## Pass Gates

| Gate | Required value |
| --- | ---: |
| Feature record without instance | 0 |
| Information record without instance | 0 |
| Attribute owner missing | 0 |
| Complex attribute owner missing | 0 |
| Association source missing | 0 |
| Association target missing | 0 |
| Spatial reference cross-version | 0 |
| Curve endpoint cross-version | 0 |
| Surface boundary cross-version | 0 |
| Invalid derived geometry | 0 |
| Missing GeoJSON | 0 |
| Null projection geometry | 0 |
| Blocking validation issues | 0 |

Null derived geometry can remain non-zero only when it is classified and does not cause projected/GeoJSON loss.

## Smoke Dataset

Use the first five S-101 datasets for initial viewer smoke testing:

```text
101KR001A0000.000
101KR001B0000.000
101KR001C0000.000
101KR001D0000.000
101KR001E0000.000
```

Expected DB smoke result after the latest parser/dashboard flow:

| Dataset | Null geometry | Invalid geometry | Projected | GeoJSON | Missing GeoJSON |
| --- | ---: | ---: | ---: | ---: | ---: |
| `101KR001A0000.000` | 14 | 0 | 11 | 11 | 0 |
| `101KR001B0000.000` | 27 | 0 | 111 | 111 | 0 |
| `101KR001C0000.000` | 51 | 0 | 284 | 284 | 0 |
| `101KR001D0000.000` | 56 | 0 | 311 | 311 | 0 |
| `101KR001E0000.000` | 25 | 0 | 223 | 223 | 0 |

## Browser Verification

1. The app loads without console errors.
2. Dataset list is populated from `s100_dev`.
3. Selecting a dataset triggers feature loading.
4. MapLibre canvas is nonblank.
5. Feature layers are visible at the dataset extent.
6. Clicking a feature opens an inspector.
7. Inspector shows catalogue-resolved names when available.
8. QA panel counts match DB query results.
9. Missing GeoJSON and blocking validation counts are visible.
10. Mobile and desktop layouts do not overlap text or controls.
