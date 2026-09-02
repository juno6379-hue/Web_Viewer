# S-101 Portrayal Symbol MVP 구현 정리

작성일: 2026-08-31

## 목적

`http://green-blue.iptime.org:19080/` 기준 뷰어처럼 S-101 객체를 단순 원, 선, 면이 아니라 Portrayal symbol 기반으로 표시하기 위한 1차 구현입니다.

이번 단계는 완전한 S-100 Part 9a Lua Portrayal Engine이 아니라, API와 MapLibre 사이에 symbol, palette, SCAMIN 흐름을 먼저 연결하는 MVP입니다.

## 구현된 API

| API | 역할 |
| --- | --- |
| `GET /api/portrayal/status` | Portrayal runtime 상태, Lua 연결 여부, 지원 feature 범위 반환 |
| `GET /api/portrayal/palette/day` | S-101 day palette 색상 토큰 반환 |
| `GET /api/portrayal/symbols` | MVP symbol manifest 반환 |
| `GET /api/portrayal/symbols/{symbolRef}.svg` | MapLibre `icon-image` 등록용 SVG 반환 |

현재 API는 `PORTRAYAL_CATALOGUE_PATH` 또는 기본 S-101 문서 폴더에서 실제 Portrayal Catalogue `Symbols` 디렉터리를 찾으면 원본 SVG를 우선 반환합니다. 해당 symbol 파일이 없을 때만 fallback SVG를 반환합니다.

## 구현된 Web Viewer 흐름

```text
projection.s101_feature_geojson
  -> API feature properties 보강
  -> portrayalSymbolRef / portrayalDisplayClass / portrayalMinStage
  -> WebViewer symbol manifest 로딩
  -> MapLibre addImage
  -> s101-symbol layer icon-image
```

## MVP symbol mapping 범위

| Feature | Symbol 예시 |
| --- | --- |
| `BuoyCardinal` | `BOYCAR01` ~ `BOYCAR04` |
| `BuoyLateral` | `BOYLAT13`, `BOYLAT14`, `BOYLAT23`, `BOYLAT24` |
| `BeaconCardinal` | `BCNCAR01` ~ `BCNCAR04` |
| `BeaconLateral` | `BCNLAT15`, `BCNLAT16`, `BCNLAT21`, `BCNLAT22` |
| `LightAllAround`, `LightSectored` | `LIGHTS11`, `LIGHTS12`, `LIGHTS13`, `LIGHTS81`, `LIGHTS82` |
| `Wreck` | `WRECKS01` |
| `Obstruction` | `OBSTRN01` |
| `DepthArea`, `DredgedArea` | `DEPARE01` |

## SCAMIN 0~6 적용

현재는 표준 catalogue rule 전체가 아니라 `portrayalMinStage`를 feature property로 내려보내고, WebViewer가 MapLibre filter로 표시 여부를 제어합니다.

| Stage | 표시 기준 |
| --- | --- |
| 0 | 수심 구역, 육지, 해안선 등 기본 영역 |
| 1 | 수심선 등 넓은 축척에서도 필요한 선형 객체 |
| 2 | 침선, 장애물, 수중암 등 위험 객체 |
| 3 | 부표, 입표 |
| 4 | 등화 |
| 5 | 접안/항만 상세 객체 확장 예정 |
| 6 | 최상세 객체 확장 예정 |

## 남은 표준 Portrayal 전환 작업

1. Portrayal Catalogue XML에서 palette, display plane, viewing group, rule binding을 정규화합니다.
2. Lua rule 실행을 위한 `LuaRuntime.execute()` 구현체를 붙입니다.
3. feature attribute를 Lua 입력 모델로 정규화합니다.
4. Lua 결과 `DrawingInstruction`을 `MapLibreAdapter`가 symbol, line, fill, text layer로 변환합니다.
5. MVP `portrayalMinStage`는 catalogue SCAMIN/scale rule 기반 필터로 교체합니다.
