# S-101 Web Viewer Catalogue 연동

작성일: 2026-08-31

## 목적

Web Viewer는 S-101 V2.0 Feature Catalogue와 Portrayal Catalogue를 사용해 feature 이름, attribute 이름, value label, 지도 style을 표시합니다.

## 원천 자료

```text
D:\dev\s100-parser\_2026-08-21 S100 문서 및 파서
```

확인된 archive:

```text
101_Feature_Catalogue_2.0.0.xml.signature.zip
101_Portrayal_Catalogue_2.0.0.zip.signature.zip
```

archive 내부에 signature wrapper가 있을 수 있으므로 setup 단계에서 실제 XML/catalogue payload를 찾아 cache로 변환합니다.

## Feature Catalogue 사용

| Catalogue 정보 | Viewer 사용처 |
| --- | --- |
| feature type code/name | layer 이름, inspector 제목, filter |
| attribute code/name | inspector attribute label |
| attribute value type | 값 formatting |
| enumerated value | 사람이 읽을 수 있는 value label |
| complex attribute | nested attribute tree 표시 |
| feature-attribute binding | inspector grouping과 예상 attribute 표시 |

## Portrayal Catalogue 사용

| Catalogue 정보 | Viewer 사용처 |
| --- | --- |
| symbol definition | point feature symbol |
| line style | curve/line feature stroke |
| area fill rule | surface feature fill |
| conditional portrayal rule | feature/attribute 조건별 style |
| display priority | layer ordering |
| viewing group | layer toggle/filter |

## cache 전략

catalogue parsing 결과는 startup 속도를 위해 local cache로 만듭니다.

```text
D:\dev\WebViewer\.cache\catalogue\
  feature-catalogue.json
  portrayal-catalogue.json
  symbols\
  styles\
```

cache는 생성물이며 기본적으로 Git에 커밋하지 않습니다.

## projection 연동

지도와 목록은 projection을 기준으로 합니다.

```text
projection.s101_feature_current.feature_type_code
  -> Feature Catalogue feature type
  -> display name, category, expected attributes

projection.s101_feature_geojson.geometry_geojson
  -> MapLibre source/layer
  -> Portrayal Catalogue style rule
```

attribute 상세가 필요할 때만 API 내부에서 canonical attribute 구조를 조회하고, Feature Catalogue로 이름과 value label을 보강합니다.

## fallback portrayal

Portrayal Catalogue rule 전체 구현 전에는 deterministic fallback style을 사용합니다.

| Geometry | fallback |
| --- | --- |
| Point | feature type 기준 circle marker |
| LineString/MultiLineString | feature type 기준 stroke |
| Polygon/MultiPolygon | feature type 기준 fill/outline |

UI는 catalogue portrayal인지 fallback portrayal인지 구분해서 표시합니다.
