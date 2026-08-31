# S-101 Web Viewer QA 및 검증 계획

작성일: 2026-08-31

## 목적

Web Viewer는 `S101DashboardApp23.exe`에서 확인하던 품질 기준을 웹 화면에서도 보여야 합니다. 단, Viewer는 검사 결과를 소비하고 표시하는 역할이며 canonical 정본을 수정하지 않습니다.

## Feature Inspector panel 구성

Feature click panel은 단순 attribute 목록이 아니라 다음 탭 구조로 구성합니다.

| 탭 | 표시 내용 |
| --- | --- |
| Overview | Feature Name, Feature Code, FOID, RCID, RVER, RUIN, Dataset, Edition, Update |
| Attributes | Simple Attribute, Complex Attribute |
| Associations | Feature Association, Information Association, Role, Target |
| Spatial | Spatial Type, Spatial Record, Geometry Type, SRID, BBOX, Topology |
| Raw Record | 원본 record locator, raw record id, ordinal, byte offset, length, payload hash |
| Validation | 해당 feature와 연결된 validation issue |

지도/목록의 primary path는 projection을 유지합니다. Inspector 상세만 선택 feature 1건에 대해 API 내부에서 canonical과 validation schema를 제한적으로 참조합니다.

## QA Dashboard 구성

QA Dashboard는 다음 그룹으로 나누어 표시합니다.

| 그룹 | 표시 내용 |
| --- | --- |
| Integrity | feature instance link, information instance link, attribute owner, complex attribute owner, association source/target |
| Spatial | spatial reference cross-version, curve endpoint, surface boundary, topology |
| Geometry | invalid geometry, null geometry, null-no-source, null-invalid-topology |
| Projection | canonical feature count, projected feature count, GeoJSON count, missing GeoJSON count |
| Validation | critical, error, warning, blocking |

## 통과 기준

| 기준 | 요구값 |
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
| Critical validation issues | 0 |
| Error validation issues | 0 |
| Blocking validation issues | 0 |

Null derived geometry는 원인 분류가 있고 projection/GeoJSON 누락을 만들지 않는 경우에만 허용 가능한 상태로 표시합니다.

## smoke dataset

초기 검증은 1~5번 dataset으로 수행합니다.

```text
101KR001A0000.000
101KR001B0000.000
101KR001C0000.000
101KR001D0000.000
101KR001E0000.000
```

예상 DB 결과:

| Dataset | Null geometry | Invalid geometry | Projected | GeoJSON | Missing GeoJSON |
| --- | ---: | ---: | ---: | ---: | ---: |
| `101KR001A0000.000` | 14 | 0 | 11 | 11 | 0 |
| `101KR001B0000.000` | 27 | 0 | 111 | 111 | 0 |
| `101KR001C0000.000` | 51 | 0 | 284 | 284 | 0 |
| `101KR001D0000.000` | 56 | 0 | 311 | 311 | 0 |
| `101KR001E0000.000` | 25 | 0 | 223 | 223 | 0 |

## browser 검증

1. app이 console error 없이 로드됩니다.
2. dataset list가 `s100_dev`에서 조회됩니다.
3. dataset 선택 시 feature loading이 발생합니다.
4. MapLibre canvas가 nonblank입니다.
5. dataset extent에서 feature layer가 보입니다.
6. feature click 시 inspector가 열립니다.
7. inspector에 catalogue 기반 이름이 표시됩니다.
8. QA panel count가 DB query 결과와 일치합니다.
9. missing GeoJSON과 blocking validation count가 보입니다.
10. desktop/mobile에서 control과 text가 겹치지 않습니다.
