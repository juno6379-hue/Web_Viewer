# S-101 V2.0 Web Viewer 구조

작성일: 2026-08-31

## 목적

Web Viewer는 `s100_dev` DB에 저장된 S-101 parser 결과를 웹에서 조회하기 위한 read-side 애플리케이션입니다. 파서, canonical 저장, geometry 보정, projection 생성 기능을 대체하지 않습니다.

## 전체 흐름

```text
S101DashboardApp23 / Phase27BatchIngestRunner
  -> s100_dev PostgreSQL/PostGIS
     -> canonical 정본
     -> projection 서비스용 read model
     -> validation/audit 결과
        -> WebViewer API
           -> React + MapLibre WebViewer
```

## DB 접근 원칙

필수 접근 경로는 다음입니다.

```text
canonical
  -> projection
  -> API
  -> WebViewer
```

`canonical`은 정본이고, `projection`은 서비스용 조회 계층입니다. WebViewer는 API를 통해 projection을 소비합니다.

금지 사항:

- WebViewer가 `canonical.feature_instance`에서 직접 feature를 조립하지 않습니다.
- WebViewer가 canonical attribute table에서 직접 화면 속성을 조립하지 않습니다.
- WebViewer가 `canonical.spatial_record`, `canonical.spatial_reference`, `canonical.curve_segment`, `canonical.surface_boundary`를 조합해서 geometry를 만들지 않습니다.
- API가 범용 canonical join endpoint를 노출하지 않습니다.

허용 사항:

- API 내부에서 feature 상세정보를 만들 때 canonical을 참조할 수 있습니다.
- API 내부에서 QA 근거, validation context, 관계/topology proof count를 만들 때 canonical을 참조할 수 있습니다.
- 지도와 목록의 기본 조회는 projection table 또는 projection view를 사용합니다.

## 주요 구성요소

| 구성요소 | 책임 |
| --- | --- |
| `apps/api` | projection 우선 조회, catalogue/QA/detail 보강, JSON/GeoJSON 반환 |
| `apps/web` | 지도, dataset 선택, filter, feature inspector, QA panel |
| `packages/catalogue` | Feature Catalogue 정규화, snapshot/version/hash, cache model |
| `packages/portrayal` | Portrayal Catalogue loading, Lua runtime, drawing instruction, MapLibre adapter 경계 |
| `packages/shared` | API와 Frontend 공통 TypeScript type |

## 화면 구성

| 화면 | 내용 |
| --- | --- |
| Version bar | S-101, dataset, edition, update, product spec, FC/PC version, status |
| Header | dataset/catalogue/validation context 상시 표시 |
| Dataset Explorer | dataset/version 선택, 검색, layer toggle, QA 요약, Lua/SCAMIN 단계 |
| Map Viewer | MapLibre 기반 S-101 feature layer와 0~6 zoom band |
| Search | feature code, FOID, attribute, dataset 기준 feature 검색과 지도 이동 |
| Layer panel | feature type, geometry type, viewing group filter |
| Feature inspector | feature identity, catalogue name, attribute, association, geometry summary |
| QA Dashboard | projection, GeoJSON, geometry, validation 상태 |
| Catalogue panel | feature/attribute/portrayal lookup 상태 |

## 지도 Layer 구조

MapLibre layer는 S-101 의미 단위로 분리합니다.

```text
S101 Layers
  Point
  MultiPoint
  Curve
  Surface
  Data Coverage
  Validation Error
  Selected Feature
```

MVP에서는 geometry 기준 fallback style을 적용합니다.

| Layer | MVP 표현 |
| --- | --- |
| Point | circle |
| MultiPoint | circle |
| Curve | line |
| Surface | fill |
| Data Coverage | dataset bbox line |
| Validation Error | error marker source |
| Selected Feature | 선택 feature 강조 layer |

## Lua / SCAMIN 단계 UI

현재 MVP는 Lua portrayal rule을 실행하지 않습니다. 다만 표준 Portrayal Engine으로 전환할 때 필요한 scale context를 검증하기 위해 0~6 단계 zoom band를 UI에 둡니다.

```text
0 Overview
1 Regional
2 Approach
3 Coastal
4 Harbour
5 Berthing
6 Detail
```

Dataset Explorer는 현재 단계, scale label, Lua fallback 상태를 표시합니다. Map Viewer는 `- / +`와 0~6 버튼으로 같은 단계를 이동합니다. 선택 feature의 `canonical.spatial_reference.smin/smax`는 Inspector Spatial 탭에서 확인합니다.

## 성능 원칙

- 대용량 feature 조회는 bbox와 limit를 사용합니다.
- 지도용 GeoJSON은 `projection.s101_feature_geojson`에서 직접 조회합니다.
- 상세정보는 feature click 이후 lazy loading합니다.
- QA 쿼리는 반드시 `dataset_version_id`로 범위를 제한합니다.
- 전체 spatial table에 `ST_IsValid`를 직접 scan하지 않습니다.
- Feature Catalogue XML은 요청마다 parsing하지 않고 초기화 단계에서 snapshot cache로 올립니다.

## Catalogue 해석 경계

Feature Catalogue 해석 기준은 `catalogueSnapshotId + featureCode`입니다. 같은 feature code라도 catalogue version 또는 catalogue hash가 다르면 다른 해석 기준으로 봅니다.

```text
101_Feature_Catalogue_2.0.0.xml
  -> Catalogue Parser
  -> Normalized Catalogue Model
  -> Cache
```

API는 parser DB가 사용한 catalogue version/hash와 Viewer cache의 catalogue version/hash를 비교합니다. 값이 다르면 dataset panel 또는 catalogue panel에 mismatch warning을 표시합니다.

## Portrayal 구조

1차 Viewer MVP는 feature type, geometry type 기반 fallback MapLibre style을 사용합니다. 이 방식은 지도 확인용 임시 구현입니다.

표준 Portrayal 구현은 S-100 Part 9a의 Lua 기반 drawing instruction 흐름을 목표로 합니다.

```text
Feature
  -> Portrayal Engine
  -> Lua
  -> Drawing Instructions
  -> MapLibre Adapter
  -> Map
```

`packages/portrayal`은 다음 module boundary를 가집니다.

| 모듈 | 책임 |
| --- | --- |
| `CatalogueLoader` | Portrayal Catalogue snapshot loading |
| `LuaRuntime` | Lua portrayal rule 실행 |
| `PortrayalContext` | scale, display mode, viewing group 등 context parameter |
| `PortrayalEngine` | feature와 context를 drawing instruction으로 변환 |
| `DrawingInstruction` | point/line/area/text rendering 지시 모델 |
| `SymbolResolver` | symbol reference와 symbol asset 해석 |
| `MapLibreAdapter` | drawing instruction을 MapLibre layer/source 정의로 변환 |

## 초기 제외 범위

- S-101 원천 데이터 편집
- canonical table 쓰기
- Viewer에서 projection rebuild 실행
- 첫 단계에서 완전한 S-101 portrayal engine 구현
- `S101DashboardApp23.exe` 대체
