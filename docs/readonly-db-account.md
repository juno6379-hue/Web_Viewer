# Viewer 조회 전용 DB 계정

작성일: 2026-08-31

## 목적

Parser와 WebViewer API의 DB 권한을 분리합니다.

```text
Parser
  -> s100_dev WRITE

Viewer API
  -> s100_viewer_readonly SELECT
```

Viewer는 projection을 중심으로 조회하고, feature 상세/QA 근거가 필요할 때만 API 내부에서 canonical, validation, raw schema를 제한 조회합니다. 따라서 Viewer 계정은 쓰기 권한을 가지면 안 됩니다.

## 계정 생성

관리자 또는 DB owner 계정으로 다음 SQL을 실행합니다.

```text
db/create-viewer-readonly-role.sql
```

초기 password는 반드시 로컬 환경에 맞게 변경합니다.

## 환경변수

Viewer API의 `.env`는 다음 계정을 사용합니다.

```text
DB_USER=s100_viewer_readonly
DB_PASSWORD=CHANGE_ME
```

개발 중 readonly 계정이 아직 만들어지지 않은 경우에만 임시로 `s100_dev` 계정을 사용할 수 있습니다. 운영 Viewer에서는 write 계정을 사용하지 않습니다.
