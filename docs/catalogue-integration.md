# S-101 Web Viewer Catalogue Integration

Date: 2026-08-31

## Purpose

The Web Viewer must use S-101 V2.0 Feature Catalogue and Portrayal Catalogue data so the map and inspector show S-101-aware names, attributes, values, and styling.

## Source Files

Expected local source root:

```text
D:\dev\s100-parser\_2026-08-21 S100 문서 및 파서
```

Observed catalogue archives:

```text
101_Feature_Catalogue_2.0.0.xml.signature.zip
101_Portrayal_Catalogue_2.0.0.zip.signature.zip
```

The archives may contain signature wrappers. The setup process must extract and locate the actual XML/catalogue payloads before parsing.

## Feature Catalogue Use

| Catalogue data | Viewer use |
| --- | --- |
| Feature type code/name | Layer names, feature inspector title, filters. |
| Attribute code/name | Attribute labels in the inspector. |
| Attribute value type | Formatting and validation hints. |
| Enumerated values | Human-readable value display. |
| Complex attributes | Nested attribute tree rendering. |
| Feature-attribute bindings | Expected attribute visibility and grouping. |

## Portrayal Catalogue Use

| Catalogue data | Viewer use |
| --- | --- |
| Symbol definitions | Point feature symbols. |
| Line styles | Curve and boundary line rendering. |
| Area fill rules | Surface feature rendering. |
| Conditional portrayal rules | Feature/attribute-dependent style selection. |
| Display priorities | Layer ordering. |
| Viewing groups | Layer toggles and filtering. |

## Cache Strategy

Catalogue parsing should produce a local generated cache for fast viewer startup.

```text
D:\dev\WebViewer\.cache\catalogue\
  feature-catalogue.json
  portrayal-catalogue.json
  symbols\
  styles\
```

The cache is generated from local catalogue files and should not be committed unless explicitly approved.

## Initial Portrayal Fallback

Full S-101 portrayal parity may require several iterations. Milestone 1 should use deterministic fallback style when Portrayal Catalogue rules are not yet fully mapped:

| Geometry | Fallback |
| --- | --- |
| Point | Circle marker by feature type. |
| LineString/MultiLineString | Stroke color by feature type. |
| Polygon/MultiPolygon | Fill and outline by feature type. |

The UI must identify whether a layer is using catalogue portrayal or fallback portrayal.
