-- S-101 WebViewer 조회 전용 DB 계정 생성 스크립트입니다.
-- Parser는 s100_dev WRITE 계정을 사용하고, Viewer API는 이 계정으로 SELECT만 수행합니다.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 's100_viewer_readonly') THEN
    CREATE ROLE s100_viewer_readonly LOGIN PASSWORD 'CHANGE_ME';
  END IF;
END
$$;

GRANT CONNECT ON DATABASE s100_dev TO s100_viewer_readonly;
GRANT USAGE ON SCHEMA projection TO s100_viewer_readonly;
GRANT USAGE ON SCHEMA canonical TO s100_viewer_readonly;
GRANT USAGE ON SCHEMA validation TO s100_viewer_readonly;
GRANT USAGE ON SCHEMA raw TO s100_viewer_readonly;

GRANT SELECT ON ALL TABLES IN SCHEMA projection TO s100_viewer_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA canonical TO s100_viewer_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA validation TO s100_viewer_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA raw TO s100_viewer_readonly;

ALTER DEFAULT PRIVILEGES IN SCHEMA projection GRANT SELECT ON TABLES TO s100_viewer_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA canonical GRANT SELECT ON TABLES TO s100_viewer_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA validation GRANT SELECT ON TABLES TO s100_viewer_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA raw GRANT SELECT ON TABLES TO s100_viewer_readonly;
