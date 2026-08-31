# S-101 Portrayal Engine 개발 계획

작성일: 2026-08-31

## 목적

S-101 Web Viewer의 Portrayal은 두 단계로 개발합니다. 1차 MVP에서는 지도 확인을 위해 임시 MapLibre style을 사용하고, 이후 S-100 Part 9a 구조에 맞는 Lua 기반 Portrayal Engine으로 확장합니다.

## 단계 구분

| 단계 | 목표 | 설명 |
| --- | --- | --- |
| Viewer MVP | feature type 기반 임시 표현 | Point, Line, Area geometry를 deterministic fallback style로 표시 |
| Standards Portrayal | Lua 기반 표준 표현 | Portrayal Catalogue와 Lua rule을 실행해 drawing instruction 생성 |

## 최종 흐름

```text
Feature
  -> Portrayal Engine
  -> Lua
  -> Drawing Instructions
  -> MapLibre Adapter
  -> Map
```

정확한 입력 흐름은 다음입니다.

```text
Feature + Attributes + Context Parameters + Portrayal Catalogue + Lua
  -> Portrayal Engine
  -> Drawing Instructions
  -> Map Rendering
```

## package 구조

```text
packages/portrayal
  src/index.ts
```

논리 모듈:

| 모듈 | 책임 |
| --- | --- |
| `CatalogueLoader` | Portrayal Catalogue snapshot과 rule loading |
| `LuaRuntime` | Lua rule 실행 경계 |
| `PortrayalContext` | scale denominator, display mode, viewing group 등 context parameter |
| `PortrayalEngine` | feature와 context를 drawing instruction으로 변환 |
| `DrawingInstruction` | point, line, area, text 표현 지시 |
| `SymbolResolver` | symbol reference와 symbol asset 연결 |
| `MapLibreAdapter` | drawing instruction을 MapLibre layer 정의로 변환 |

## MVP fallback style

표준 Lua rule이 구현되기 전까지는 다음 fallback을 사용합니다.

| Geometry | 표현 |
| --- | --- |
| Point/MultiPoint | feature type code 기반 circle marker |
| LineString/MultiLineString | feature type code 기반 stroke |
| Polygon/MultiPolygon | feature type code 기반 fill과 outline |

Fallback style은 표준 portrayal 결과가 아니므로 UI에서 구분 가능한 상태값을 둡니다.

## 구현 원칙

- Portrayal Catalogue를 최종 구조에서 단순 MapLibre Style JSON 변환기로 고정하지 않습니다.
- Lua runtime은 engine 내부 구현으로 숨기고, API/Web은 drawing instruction 또는 MapLibre adapter 결과만 소비합니다.
- catalogue version/hash는 Feature Catalogue와 동일하게 snapshot 기준으로 관리합니다.
- feature attribute와 context parameter가 rule 입력에 포함될 수 있도록 interface를 먼저 고정합니다.
