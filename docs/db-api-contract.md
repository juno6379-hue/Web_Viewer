# S-101 Web Viewer DB/API 계약

작성일: 2026-08-31

## DB

개발 DB는 다음을 사용합니다.

```text
Host=127.0.0.1;Port=55432;Database=s100_dev;Username=s100_dev;Password=CHANGE_ME_LOCAL_ONLY
```

DB container는 `s100_dev_postgis`이고, 데이터는 Docker volume `s100_dev_pgdata`에 저장됩니다.

## DB 조회 계층

Viewer 주요 조회는 projection schema를 중심으로 합니다.

| 우선순위 | 테이블/View | 용도 |
| ---: | --- | --- |
| 1 | `projection.s101_dataset_current` | dataset 목록, 최신 version, bbox, dataset 상태 |
| 2 | `projection.s101_feature_current` | current feature 목록, feature type, 속성 요약, geometry 존재 여부 |
| 3 | `projection.s101_feature_geojson` | 지도 렌더링용 GeoJSON |
| 4 | `projection.s101_feature_detail` | feature inspector용 상세 view 후보 |
| 5 | `projection.s101_dataset_summary` | dataset summary view 후보 |
| 6 | `projection.s101_qa_summary` | QA summary view 후보 |

Frontend는 canonical 구조를 알 필요가 없어야 합니다. 복잡한 join이 필요하면 API 내부에 숨기거나 projection schema에 view를 추가합니다.

## 접근 경계

필수 구조:

```text
canonical
  -> projection
  -> API
  -> WebViewer
```

`canonical.*`은 viewer service model이 아닙니다. 정본은 canonical이고, 서비스 조회는 projection입니다.

금지되는 기본 동작:

- `canonical.feature_instance`와 `canonical.spatial_record`를 join해서 지도 feature를 만드는 것
- browser에서 canonical attribute table을 직접 조립하는 것
- `canonical.spatial_reference`, `canonical.curve_segment`, `canonical.surface_boundary`를 primary rendering source로 쓰는 것
- broad canonical join endpoint를 일반 viewer API로 노출하는 것

허용되는 API 내부 canonical read:

- 선택된 feature 1건의 상세 근거 조회
- QA summary와 validation diagnostics
- feature/information/attribute/association 관계 검증
- spatial/topology cross-version proof count
- catalogue-enriched inspector 응답

## API endpoint 초안

| Endpoint | 용도 | 기본 조회 계층 |
| --- | --- | --- |
| `GET /api/health/db` | DB 연결 확인 | DB metadata |
| `GET /api/datasets` | dataset 목록 | `projection.s101_dataset_current` |
| `GET /api/datasets/:datasetId/versions` | dataset version 목록 | projection view 우선, 필요 시 `canonical.dataset_version` |
| `GET /api/features` | 지도용 GeoJSON FeatureCollection | `projection.s101_feature_geojson` |
| `GET /api/features/:featureInstanceId` | feature 상세정보 | `projection.s101_feature_detail` 또는 API 내부 canonical detail read |
| `GET /api/catalogue/features` | Feature Catalogue feature type metadata | catalogue cache |
| `GET /api/catalogue/attributes` | Feature Catalogue attribute metadata | catalogue cache |
| `GET /api/catalogue/status` | loaded catalogue snapshot/version/hash와 DB catalogue mismatch 상태 | catalogue cache + DB metadata |
| `GET /api/qa/summary` | Dashboard와 동일한 QA count | `projection.s101_qa_summary` 또는 API 내부 QA query |
| `GET /api/qa/issues` | validation issue 조회 | `validation.validation_issue` |

## 현재 구현된 endpoint

| Endpoint | 구현 상태 | 비고 |
| --- | --- | --- |
| `GET /api/health/db` | 구현 | `s100_dev/s100_dev` 연결 확인 |
| `GET /api/datasets` | 구현 | `projection.s101_dataset_current`와 `projection.s101_feature_current` 사용 |
| `GET /api/features` | 구현 | `projection.s101_feature_geojson` 중심, bbox/filter/limit 지원 |
| `GET /api/features/:featureInstanceId` | 구현 | `projection.s101_feature_current` 중심 상세 |
| `GET /api/qa/summary` | 구현 | API 내부에서 dataset version 범위로 QA count 계산 |
| `GET /api/datasets/:datasetId/versions` | 예정 | projection view 또는 제한된 canonical read 필요 |
| `GET /api/catalogue/features` | 예정 | catalogue cache 구현 후 연결 |
| `GET /api/catalogue/attributes` | 예정 | catalogue cache 구현 후 연결 |
| `GET /api/catalogue/status` | 예정 | parser DB catalogue와 Viewer catalogue version/hash 비교 |
| `GET /api/qa/issues` | 예정 | validation issue filter 구현 필요 |

## Catalogue API 원칙

Feature Catalogue 응답은 항상 snapshot 식별자를 포함합니다.

```json
{
  "catalogueSnapshotId": "s101-feature-2.0.0-sha256-...",
  "version": "2.0.0",
  "hashAlgorithm": "SHA-256",
  "hash": "...",
  "features": []
}
```

feature/attribute 해석 key는 `catalogueSnapshotId + code`입니다. API는 parser DB의 catalogue metadata와 Viewer cache metadata를 비교하고, version 또는 hash가 다르면 다음 형태의 경고를 반환합니다.

```json
{
  "catalogueMismatch": true,
  "dbCatalogueVersion": "2.0.0",
  "viewerCatalogueVersion": "2.0.0",
  "dbCatalogueHash": "...",
  "viewerCatalogueHash": "..."
}
```

## feature 조회 parameter

| Parameter | 필수 | 의미 |
| --- | --- | --- |
| `datasetId` | 예 | canonical dataset id |
| `datasetVersionId` | 권장 | dataset version id |
| `bbox` | 아니오 | EPSG:4326 기준 `minX,minY,maxX,maxY` |
| `featureTypeCode` | 아니오 | S-101 feature type code |
| `limit` | 아니오 | 최대 row 수 |

## QA summary 응답 예시

```json
{
  "featureRecordWithoutInstance": 0,
  "informationRecordWithoutInstance": 0,
  "attributeOwnerMissing": 0,
  "complexAttributeOwnerMissing": 0,
  "associationSourceMissing": 0,
  "associationTargetMissing": 0,
  "spatialReferenceCrossVersion": 0,
  "curveEndpointCrossVersion": 0,
  "surfaceBoundaryCrossVersion": 0,
  "invalidGeometry": 0,
  "nullGeometry": 14,
  "nullNoSourceData": 14,
  "nullInvalidTopology": 0,
  "projectedFeatures": 11,
  "geoJsonRows": 11,
  "missingGeoJson": 0,
  "blockingValidationIssues": 0
}
```

## SQL 원칙

- spatial/QA 쿼리는 반드시 `dataset_version_id`로 제한합니다.
- 지도 조회는 bbox를 지원합니다.
- `projection.s101_feature_geojson.geometry_geojson`을 가능한 그대로 반환합니다.
- user input은 반드시 parameter binding으로 처리합니다.
- canonical join은 API service 내부에 숨깁니다.
- WebViewer UI가 canonical topology를 이해해야 하는 구조를 만들지 않습니다.
