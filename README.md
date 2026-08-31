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

## 사용 DB와 계정

기본 개발 DB는 다음과 같습니다. Parser는 write 계정을 사용하고, WebViewer API는 조회 전용 계정을 사용합니다.

```text
Parser
  -> s100_dev WRITE

Viewer API
  -> s100_viewer_readonly SELECT
```

DB는 `S101DashboardApp23.exe` 또는 `Phase27BatchIngestRunner.exe`가 생성한 결과를 사용합니다.

조회 전용 계정 생성 스크립트는 `db/create-viewer-readonly-role.sql`입니다.

## 환경변수

`.env.example` 기준 설정:

```text
DB_HOST=127.0.0.1
DB_PORT=55432
DB_NAME=s100_dev
DB_USER=s100_viewer_readonly
DB_PASSWORD=CHANGE_ME

WEB_PORT=5173
API_PORT=3000

FEATURE_CATALOGUE_PATH=
PORTRAYAL_CATALOGUE_PATH=
```

`.env`는 Git에 커밋하지 않습니다. `DATABASE_URL`을 별도로 지정하면 호환을 위해 우선 적용됩니다.

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
    catalogue\  Feature Catalogue parser 및 snapshot cache model
    portrayal\  S-101 portrayal engine, Lua runtime, MapLibre adapter 구조
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

## 현재 구현 상태

2026-08-31 기준 1차 skeleton 구현이 들어갔습니다.

| 항목 | 상태 |
| --- | --- |
| Monorepo 구조 | 완료 |
| Fastify API | 완료 |
| React/Vite Web 앱 | 완료 |
| MapLibre 지도 | 완료 |
| `s100_dev` DB 연결 | 완료 |
| dataset 목록 API | 완료 |
| projection GeoJSON API | 완료 |
| feature inspector API | 완료 |
| QA summary API | 완료 |
| Feature Inspector 탭 UI | 완료 |
| QA Dashboard 그룹 UI | 완료 |
| Dataset version bar | 완료 |
| 의미별 MapLibre layer 구조 | 완료 |
| Feature search API/UI | 완료 |
| Feature Catalogue snapshot/cache model | 진행 중 |
| Portrayal engine interface | 진행 중 |
| Portrayal Catalogue Lua engine | 다음 단계 |

## 운영형 Viewer UI

화면은 운영/QA 사용을 기준으로 다음 구조를 사용합니다.

```text
Header
  Dataset / Catalogue / Validation context

Main
  Dataset Explorer
  Map Viewer
  Feature Inspector

Bottom
  QA Dashboard

Footer
  Projection / Catalogue / Portrayal / SCAMIN 상태
```

화면 상단에는 현재 사용자가 보고 있는 dataset version context를 항상 표시합니다.

```text
S-101
Dataset
Edition
Update
Product
Product Spec
FC
PC
Status
```

Feature Catalogue와 Portrayal Catalogue가 아직 cache에 연결되지 않은 경우 `미연결` 또는 `MVP`로 표시합니다.

## 지도 Layer

MapLibre layer는 의미별로 분리합니다.

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

MVP에서는 geometry type 기준 style을 사용합니다. 이후 `packages/portrayal`의 Portrayal Engine과 MapLibre Adapter 결과로 교체합니다.

## Lua / SCAMIN 단계

표준 Portrayal Engine은 Lua rule과 SCAMIN/scale denominator를 기준으로 feature 표시 여부와 drawing instruction을 결정합니다. 현재 MVP UI는 Lua runtime 실행 전 단계이므로, SCAMIN 확인용 0~6 zoom band를 제공합니다.

| 단계 | 용도 |
| --- | --- |
| 0 | Overview |
| 1 | Regional |
| 2 | Approach |
| 3 | Coastal |
| 4 | Harbour |
| 5 | Berthing |
| 6 | Detail |

지도 우측 하단의 `- / +`와 0~6 버튼으로 zoom in/out을 수행합니다. Feature Inspector의 Spatial 탭은 선택 feature의 `SMIN/SMAX`를 표시합니다.

## Search

운영 Viewer 기본 기능으로 feature search를 제공합니다.

```text
GET /api/search/features?q=
```

현재 검색 대상은 feature code, FOID, attribute, dataset입니다. Feature name 검색은 Feature Catalogue cache가 연결된 뒤 같은 API에 추가합니다.

## Feature Inspector

feature click panel은 개발/QA 도구로 사용할 수 있도록 탭 구조로 구성합니다.

| 탭 | 내용 |
| --- | --- |
| Overview | Feature Name, Feature Code, FOID, RCID, RVER, RUIN, Dataset, Edition, Update |
| Attributes | Simple Attribute, Complex Attribute |
| Associations | Feature Association, Information Association, Role, Target |
| Spatial | Spatial Type, Spatial Record, Geometry Type, SRID, BBOX, Topology |
| Raw Record | 원본 record locator, raw hash, byte offset, decode status |
| Validation | 해당 feature 관련 validation issue |

지도와 목록은 projection을 사용하고, Inspector에서 선택한 feature 1건의 상세 근거만 API 내부에서 canonical과 validation schema를 제한 조회합니다.

## QA Dashboard

QA Dashboard는 다음 그룹으로 표시합니다.

| 그룹 | 항목 |
| --- | --- |
| Integrity | feature instance link, information instance link, attribute owner, complex attribute owner, association source/target |
| Spatial | spatial reference cross-version, curve endpoint, surface boundary, topology |
| Geometry | invalid geometry, null geometry, null no source data, null invalid topology |
| Projection | canonical feature count, projected feature count, GeoJSON count, missing GeoJSON |
| Validation | critical, error, warning, blocking |

## Feature Catalogue 처리 원칙

Feature Catalogue는 API 요청마다 XML을 parsing하지 않습니다. 서버 초기화 단계에서 다음 흐름으로 1회 처리하고 cache를 사용합니다.

```text
101_Feature_Catalogue_2.0.0.xml
  -> Catalogue Parser
  -> Normalized Catalogue Model
  -> Cache
```

정규화 모델은 `catalogueSnapshotId`, catalogue version, catalogue hash를 포함합니다. feature/attribute 해석 기준은 단순 `featureCode`가 아니라 `catalogueSnapshotId + featureCode`입니다.

Parser DB 생성에 사용한 catalogue와 Viewer가 loading한 catalogue의 version/hash가 다르면 API와 화면에 경고를 표시해야 합니다.

## Portrayal 처리 원칙

MVP에서는 feature type과 geometry type을 기준으로 임시 MapLibre style을 적용합니다. 이는 1차 지도 확인용이며 완전한 S-101 Portrayal 구현이 아닙니다.

표준 구현 목표는 S-100 Part 9a 흐름을 따릅니다.

```text
Feature + Attributes + Context Parameters + Portrayal Catalogue + Lua
  -> Portrayal Engine
  -> Drawing Instructions
  -> MapLibre Rendering Adapter
  -> Map
```

`packages/portrayal`은 이 목표 구조를 유지하기 위한 module boundary입니다. 주요 구성은 `CatalogueLoader`, `LuaRuntime`, `PortrayalContext`, `PortrayalEngine`, `DrawingInstruction`, `SymbolResolver`, `MapLibreAdapter`입니다.

## 실행 방법

의존성 설치:

```powershell
npm install
npm --prefix apps/api install
npm --prefix apps/web install
```

DB 실행:

```powershell
cd D:\dev\s100-parser
docker compose up -d s100-db
```

API 실행:

```powershell
cd D:\dev\WebViewer
npm --prefix apps/api run start
```

Web 실행:

```powershell
cd D:\dev\WebViewer
npm run dev:web
```

접속 URL:

```text
http://localhost:5173/
```

API 확인:

```text
http://localhost:3000/health
http://localhost:3000/health/db
http://localhost:3000/health/catalogue
http://localhost:3000/api/datasets
```

검증된 현재 서버:

| 서버 | URL | 상태 |
| --- | --- | --- |
| API | `http://127.0.0.1:3000` | 기본 포트 |
| Web | `http://localhost:5173` | HTTP 200 확인 |

## 관련 문서

- `docs/development-procedure.md`: 개발 절차
- `docs/architecture.md`: 전체 구조
- `docs/db-api-contract.md`: DB/API 계약
- `docs/catalogue-integration.md`: Feature Catalogue와 Portrayal Catalogue 연동
- `docs/portrayal-engine-plan.md`: S-100 Part 9a 기반 Portrayal Engine 단계별 계획
- `docs/qa-validation-plan.md`: QA 및 검증 계획
- `docs/readonly-db-account.md`: Viewer 조회 전용 DB 계정 설정
