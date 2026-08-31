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
6. `/api/health/db`로 `s100_dev` 연결을 확인합니다.
7. `projection.s101_dataset_current` 기반 dataset 목록 API를 만듭니다.
8. `projection.s101_feature_geojson` 기반 feature GeoJSON API를 만듭니다.
9. MapLibre 지도에 feature를 표시합니다.
10. Feature Catalogue parser/cache를 만듭니다.
11. feature type과 attribute 이름을 catalogue 기반으로 표시합니다.
12. Portrayal Catalogue parser/cache를 만듭니다.
13. portrayal rule이 준비되지 않은 feature에는 fallback style을 적용합니다.
14. feature inspector를 만듭니다.
15. QA summary panel을 만듭니다.
16. validation issue panel을 만듭니다.
17. Playwright로 지도 nonblank, feature click, QA panel을 확인합니다.

## 1차 구현 완료 기준

| 항목 | 완료 기준 |
| --- | --- |
| DB 연결 | `/api/health/db`가 `s100_dev/s100_dev`를 반환 |
| dataset 목록 | `projection.s101_dataset_current` 기반 목록 표시 |
| 지도 표시 | `projection.s101_feature_geojson` 기반 feature 렌더링 |
| feature 상세 | click 시 inspector 표시 |
| catalogue | feature/attribute 이름 표시 |
| QA | invalid/null geometry, missing GeoJSON, blocking issue 표시 |

## 금지 사항

- Viewer에서 parser logic을 복제하지 않습니다.
- Viewer에서 canonical table에 write하지 않습니다.
- canonical join을 map/list primary path로 사용하지 않습니다.
- source 좌표가 부족한 null geometry를 임의로 생성하지 않습니다.
- 대용량 dataset/catalogue cache를 Git에 커밋하지 않습니다.
