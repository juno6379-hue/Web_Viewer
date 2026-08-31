# S-101 V2.0 Web Viewer 개발 절차

작성일: 2026-08-31

## 목표

`D:\dev\WebViewer`에 S-101 V2.0 Web Viewer를 개발합니다. Viewer는 기존 parser가 만든 `s100_dev` DB와 S-100/S-101 문서, Feature Catalogue, Portrayal Catalogue를 사용합니다.

자료 위치:

```text
D:\dev\s100-parser\_2026-08-21 S100 문서 및 파서
```

## 개발 원칙

- 모든 주석과 관련 문서는 한글 작성을 원칙으로 합니다.
- WebViewer는 projection 소비자입니다.
- canonical은 정본이며 Viewer가 직접 조립하지 않습니다.
- 복잡한 DB 조합은 API 또는 projection view에 숨깁니다.
- Feature 상세정보가 필요할 때만 API 내부에서 canonical을 참조합니다.
- Fastify API는 `pg.Pool`을 사용하고 요청마다 새 DB connection을 만들지 않습니다.
- Viewer API는 운영에서 `s100_viewer_readonly` 조회 전용 계정을 사용합니다.

## 필수 DB 흐름

```text
canonical
  -> projection
  -> API
  -> WebViewer
```

## 개발 순서

1. source material path를 확인합니다.
2. `D:\dev\WebViewer` 기본 프로젝트 구조를 만듭니다.
3. Vite + React + TypeScript frontend를 구성합니다.
4. Fastify API 서버를 구성합니다.
5. `.env.example`과 DB 연결 설정을 정리합니다.
6. `/health`, `/health/db`, `/health/catalogue`로 API 운영 상태를 확인합니다.
7. `projection.s101_dataset_current` 기반 dataset 목록 API를 만듭니다.
8. `projection.s101_feature_geojson` 기반 feature GeoJSON API를 만듭니다.
9. MapLibre 지도에 feature를 표시합니다.
10. 화면 상단에 dataset, edition, update, product spec, FC/PC, status version bar를 표시합니다.
11. MapLibre layer를 Point, MultiPoint, Curve, Surface, Data Coverage, Validation Error, Selected Feature로 분리합니다.
12. Lua/SCAMIN 확인을 위한 0~6 zoom band UI를 만듭니다.
13. Feature Inspector Spatial 탭에서 선택 feature의 `SMIN/SMAX`를 표시합니다.
14. `GET /api/search/features?q=`와 검색 UI를 만듭니다.
15. Feature Catalogue parser를 초기화 단계에서만 실행하도록 만듭니다.
16. `catalogueSnapshotId`, catalogue version, SHA-256 hash를 포함한 normalized catalogue cache를 만듭니다.
17. parser DB가 사용한 catalogue와 Viewer catalogue cache의 version/hash mismatch warning을 표시합니다.
18. feature type과 attribute 이름을 `catalogueSnapshotId + code` 기준으로 표시합니다.
19. Portrayal MVP는 feature type과 geometry type 기반 fallback MapLibre style로 구현합니다.
20. 표준 Portrayal은 Lua runtime, drawing instruction, MapLibre adapter 구조를 먼저 고정한 뒤 단계적으로 구현합니다.
21. feature inspector를 만듭니다.
22. QA summary panel을 만듭니다.
23. validation issue panel을 만듭니다.
24. Playwright로 지도 nonblank, feature click, QA panel을 확인합니다.

## 1차 구현 완료 기준

| 항목 | 완료 기준 |
| --- | --- |
| DB 연결 | `/health/db`가 `s100_dev`와 readonly 계정 또는 개발용 임시 계정을 반환 |
| dataset 목록 | `projection.s101_dataset_current` 기반 목록 표시 |
| 지도 표시 | `projection.s101_feature_geojson` 기반 feature 렌더링 |
| feature 상세 | click 시 inspector 표시 |
| catalogue | feature/attribute 이름 표시 |
| QA | invalid/null geometry, missing GeoJSON, blocking issue 표시 |

## 2026-08-31 구현 결과

1차 skeleton 구현 결과:

| 항목 | 결과 |
| --- | --- |
| package 구성 | root, `apps/api`, `apps/web`, `packages/shared`, `packages/catalogue` 구성 |
| API 서버 | Fastify 기반 서버 구성 |
| Web 앱 | Vite + React + TypeScript 구성 |
| 지도 | MapLibre GL JS 기반 지도 구성 |
| Dataset API | `projection.s101_dataset_current` 중심 조회 |
| Feature API | `projection.s101_feature_geojson` 중심 조회 |
| Feature detail API | `projection.s101_feature_current` 중심 조회 |
| QA summary API | projection count와 canonical evidence count를 API 내부에서 계산 |
| Version bar | 현재 dataset/version/catalogue/status context 표시 |
| Layer 구조 | Point, MultiPoint, Curve, Surface, Data Coverage, Validation Error, Selected Feature 분리 |
| Search | feature code, FOID, attribute, dataset 검색 API/UI 추가 |
| Lua/SCAMIN | 0~6 zoom band와 선택 feature `SMIN/SMAX` 표시 |
| Health check | `/health`, `/health/db`, `/health/catalogue` 추가 |
| DB 계정 | `s100_viewer_readonly` 조회 전용 계정 원칙과 생성 SQL 추가 |
| Catalogue model | version/hash/snapshot 기반 정규화 type 추가 |
| Portrayal model | Lua portrayal engine과 MapLibre adapter 경계 type 추가 |
| 빌드 검증 | `npm run typecheck`, `npm run build` 통과 |
| 실행 검증 | API health/datasets/features/qa 응답 확인, Web HTTP 200 확인 |

현재 구현은 projection-first 원칙을 지킵니다. 지도와 목록은 projection을 사용하고, canonical은 QA summary 내부 근거 계산에만 제한적으로 사용합니다.

## 금지 사항

- Viewer에서 parser logic을 복제하지 않습니다.
- Viewer에서 canonical table에 write하지 않습니다.
- canonical join을 map/list primary path로 사용하지 않습니다.
- source 좌표가 부족한 null geometry를 임의로 생성하지 않습니다.
- 대용량 dataset/catalogue cache를 Git에 커밋하지 않습니다.
- Portrayal Catalogue를 최종 구조에서 단순 MapLibre Style JSON 변환기로 고정하지 않습니다.
