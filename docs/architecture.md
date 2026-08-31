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
| `packages/catalogue` | Feature Catalogue와 Portrayal Catalogue parsing/cache |
| `packages/shared` | API와 Frontend 공통 TypeScript type |

## 화면 구성

| 화면 | 내용 |
| --- | --- |
| 지도 | MapLibre 기반 S-101 feature layer |
| Dataset panel | dataset/version 선택, parser/projection 상태 |
| Layer panel | feature type, geometry type, viewing group filter |
| Feature inspector | feature identity, catalogue name, attribute, association, geometry summary |
| QA panel | projection, GeoJSON, geometry, validation 상태 |
| Catalogue panel | feature/attribute/portrayal lookup 상태 |

## 성능 원칙

- 대용량 feature 조회는 bbox와 limit를 사용합니다.
- 지도용 GeoJSON은 `projection.s101_feature_geojson`에서 직접 조회합니다.
- 상세정보는 feature click 이후 lazy loading합니다.
- QA 쿼리는 반드시 `dataset_version_id`로 범위를 제한합니다.
- 전체 spatial table에 `ST_IsValid`를 직접 scan하지 않습니다.

## 초기 제외 범위

- S-101 원천 데이터 편집
- canonical table 쓰기
- Viewer에서 projection rebuild 실행
- 첫 단계에서 완전한 S-101 portrayal engine 구현
- `S101DashboardApp23.exe` 대체
