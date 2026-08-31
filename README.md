# Web_Viewer

S-101 V2.0 Web Viewer는 `S100_Parser`가 생성한 `s100_dev` PostgreSQL/PostGIS DB를 사용하는 웹 기반 S-101 조회기입니다.

이 저장소의 모든 주석과 관련 문서는 한글 작성을 원칙으로 합니다. 외부 라이브러리명, API 경로, DB 테이블명, 코드 식별자는 원문을 유지합니다.

## 핵심 원칙

가장 중요한 구조는 다음입니다.

```text
canonical
  -> projection
  -> API
  -> WebViewer
```

역할은 명확히 분리합니다.

| 계층 | 역할 |
| --- | --- |
| `canonical` | 파서가 만든 정본 데이터입니다. |
| `projection` | 서비스와 화면 조회를 위한 read model입니다. |
| `API` | projection을 조회하고, 필요한 경우에만 canonical 상세 근거를 결합합니다. |
| `WebViewer` | projection/API 결과를 소비하는 화면입니다. |

WebViewer는 `canonical.feature_instance`, `canonical.feature_attribute_value`, `canonical.spatial_record` 등을 직접 조립해서 feature, attribute, geometry를 만들면 안 됩니다.

단, feature 상세정보나 QA 근거가 필요할 때 API 내부에서 canonical을 참조하는 것은 허용합니다.

## DB 조회 계층

Viewer 주요 조회는 다음 projection 테이블을 중심으로 합니다.

| 테이블 | 용도 |
| --- | --- |
| `projection.s101_dataset_current` | dataset 목록, 최신 version, bbox, 상태 조회 |
| `projection.s101_feature_current` | feature 목록, feature type, 속성 요약, geometry 존재 여부 조회 |
| `projection.s101_feature_geojson` | 지도 렌더링용 GeoJSON 조회 |

Frontend가 복잡한 canonical 구조를 몰라도 되도록, 필요하면 projection schema에 별도 view를 추가합니다.

예상 view:

| View | 목적 |
| --- | --- |
| `projection.s101_feature_detail` | feature inspector용 상세 조회 |
| `projection.s101_dataset_summary` | dataset 목록/상태 요약 |
| `projection.s101_qa_summary` | Dashboard와 동일한 QA 요약 |

## 사용 DB

기본 개발 DB는 다음과 같습니다.

```text
Host=127.0.0.1;Port=55432;Database=s100_dev;Username=s100_dev;Password=CHANGE_ME_LOCAL_ONLY
```

DB는 `S101DashboardApp23.exe` 또는 `Phase27BatchIngestRunner.exe`가 생성한 결과를 사용합니다.

## 입력 자료

| 입력 | 경로 |
| --- | --- |
| S-100/S-101 문서 및 기존 파서 자료 | `D:\dev\s100-parser\_2026-08-21 S100 문서 및 파서` |
| Feature Catalogue archive | `D:\dev\s100-parser\_2026-08-21 S100 문서 및 파서\101_Feature_Catalogue_2.0.0.xml.signature.zip` |
| Portrayal Catalogue archive | `D:\dev\s100-parser\_2026-08-21 S100 문서 및 파서\101_Portrayal_Catalogue_2.0.0.zip.signature.zip` |

## 기술 스택

| 영역 | 기술 |
| --- | --- |
| Frontend | Vite + React + TypeScript |
| 지도 | MapLibre GL JS |
| API | Node.js + Fastify |
| DB driver | `pg` |
| UI | Tailwind CSS 또는 shadcn/ui |
| 테스트 | Vitest + Playwright |

## 예정 구조

```text
D:\dev\WebViewer
  apps\
    api\        Fastify API 서버
    web\        Vite React TypeScript Viewer
  packages\
    catalogue\  Feature/Portrayal Catalogue parser 및 cache builder
    shared\     공통 TypeScript type
  docs\
    development-procedure.md
    architecture.md
    db-api-contract.md
    catalogue-integration.md
    qa-validation-plan.md
  .env.example
  README.md
```

## 1차 완료 기준

- API가 `s100_dev`에 연결됩니다.
- dataset 목록을 조회할 수 있습니다.
- `projection.s101_feature_geojson`을 dataset/bbox 기준으로 조회합니다.
- MapLibre 지도에 feature가 표시됩니다.
- feature 클릭 시 inspector가 열립니다.
- Feature Catalogue 기반 이름과 attribute label을 표시합니다.
- QA summary에서 invalid/null geometry, missing GeoJSON, blocking validation issue를 확인합니다.

## 관련 문서

- `docs/development-procedure.md`: 개발 절차
- `docs/architecture.md`: 전체 구조
- `docs/db-api-contract.md`: DB/API 계약
- `docs/catalogue-integration.md`: Feature Catalogue와 Portrayal Catalogue 연동
- `docs/qa-validation-plan.md`: QA 및 검증 계획
