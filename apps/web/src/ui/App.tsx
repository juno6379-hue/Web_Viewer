import maplibregl from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  CatalogueRuntimeStatus,
  DatasetItem,
  FeatureDetail,
  FeatureGeoJsonCollection,
  QaSummary
} from "../../../../packages/shared/src/index";
import { fetchCatalogueStatus, fetchDatasets, fetchFeatureDetail, fetchFeatures, fetchQaSummary } from "../api";

const emptyCollection: FeatureGeoJsonCollection = {
  type: "FeatureCollection",
  features: []
};

export function App() {
  const mapRef = useRef<maplibregl.Map | null>(null);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const [datasets, setDatasets] = useState<DatasetItem[]>([]);
  const [selectedDatasetId, setSelectedDatasetId] = useState<string>("");
  const [features, setFeatures] = useState<FeatureGeoJsonCollection>(emptyCollection);
  const [qa, setQa] = useState<QaSummary | null>(null);
  const [detail, setDetail] = useState<FeatureDetail | null>(null);
  const [catalogueStatus, setCatalogueStatus] = useState<CatalogueRuntimeStatus | null>(null);
  const [message, setMessage] = useState("초기화 중");

  const selectedDataset = useMemo(
    () => datasets.find((dataset) => dataset.datasetId === selectedDatasetId) ?? null,
    [datasets, selectedDatasetId]
  );

  useEffect(() => {
    fetchDatasets()
      .then((result) => {
        setDatasets(result.items);
        setSelectedDatasetId(result.items[0]?.datasetId ?? "");
        setMessage(result.items.length > 0 ? "dataset 조회 완료" : "dataset 없음");
      })
      .catch((error: Error) => setMessage(`dataset 조회 실패: ${error.message}`));
    fetchCatalogueStatus()
      .then(setCatalogueStatus)
      .catch((error: Error) => setMessage(`catalogue 상태 조회 실패: ${error.message}`));
  }, []);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) {
      return;
    }

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: {
        version: 8,
        sources: {},
        layers: [
          {
            id: "background",
            type: "background",
            paint: { "background-color": "#edf2f7" }
          }
        ]
      },
      center: [126.5, 34.4],
      zoom: 7
    });

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
    map.on("load", () => {
      map.addSource("s101-features", {
        type: "geojson",
        data: emptyCollection as any
      });
      map.addLayer({
        id: "s101-polygon",
        type: "fill",
        source: "s101-features",
        filter: ["in", ["geometry-type"], ["literal", ["Polygon", "MultiPolygon"]]],
        paint: {
          "fill-color": ["match", ["get", "featureTypeCode"], 1, "#3b82f6", 2, "#14b8a6", "#7c3aed"],
          "fill-opacity": 0.32
        }
      });
      map.addLayer({
        id: "s101-line",
        type: "line",
        source: "s101-features",
        filter: ["in", ["geometry-type"], ["literal", ["LineString", "MultiLineString"]]],
        paint: {
          "line-color": "#0f766e",
          "line-width": 2
        }
      });
      map.addLayer({
        id: "s101-point",
        type: "circle",
        source: "s101-features",
        filter: ["==", ["geometry-type"], "Point"],
        paint: {
          "circle-radius": 5,
          "circle-color": "#dc2626",
          "circle-stroke-width": 1,
          "circle-stroke-color": "#ffffff"
        }
      });
      map.on("click", ["s101-polygon", "s101-line", "s101-point"], (event) => {
        const feature = event.features?.[0];
        const featureInstanceId = feature?.properties?.featureInstanceId;
        if (featureInstanceId) {
          fetchFeatureDetail(String(featureInstanceId))
            .then(setDetail)
            .catch((error: Error) => setMessage(`feature 상세 조회 실패: ${error.message}`));
        }
      });
    });

    mapRef.current = map;
  }, []);

  useEffect(() => {
    if (!selectedDataset) {
      return;
    }
    setMessage(`${selectedDataset.dsnm} 조회 중`);
    Promise.all([fetchFeatures(selectedDataset), fetchQaSummary(selectedDataset)])
      .then(([featureResult, qaResult]) => {
        setFeatures(featureResult);
        setQa(qaResult);
        setDetail(null);
        setMessage(`${selectedDataset.dsnm} feature ${featureResult.features.length}건`);
      })
      .catch((error: Error) => setMessage(`조회 실패: ${error.message}`));
  }, [selectedDataset]);

  useEffect(() => {
    const map = mapRef.current;
    const source = map?.getSource("s101-features") as maplibregl.GeoJSONSource | undefined;
    if (!map || !source) {
      return;
    }
    source.setData(features as any);
    const bounds = createBounds(features);
    if (bounds) {
      map.fitBounds(bounds, { padding: 60, maxZoom: 12, duration: 500 });
    }
  }, [features]);

  return (
    <main className="app-shell">
      <aside className="side-panel">
        <section>
          <h1>S-101 Web Viewer</h1>
          <p className="muted">projection 기반 S-101 조회</p>
        </section>

        <section className="panel-section">
          <label htmlFor="dataset">Dataset</label>
          <select id="dataset" value={selectedDatasetId} onChange={(event) => setSelectedDatasetId(event.target.value)}>
            {datasets.map((dataset) => (
              <option key={dataset.datasetId} value={dataset.datasetId}>
                {dataset.dsnm}
              </option>
            ))}
          </select>
          {selectedDataset ? (
            <dl className="meta-grid">
              <dt>Version</dt>
              <dd>{selectedDataset.datasetVersionId}</dd>
              <dt>Feature</dt>
              <dd>{selectedDataset.featureCount.toLocaleString()}</dd>
              <dt>Status</dt>
              <dd>{selectedDataset.conformanceStatus ?? "-"}</dd>
            </dl>
          ) : null}
        </section>

        <section className="panel-section">
          <h2>Catalogue</h2>
          {catalogueStatus ? <CataloguePanel status={catalogueStatus} /> : <p className="muted">catalogue 상태 확인 중</p>}
        </section>

        <section className="panel-section">
          <h2>QA Summary</h2>
          {qa ? <QaPanel qa={qa} /> : <p className="muted">QA 대기 중</p>}
        </section>

        <section className="panel-section">
          <h2>Feature Inspector</h2>
          {detail ? <FeaturePanel detail={detail} /> : <p className="muted">지도에서 feature를 선택하세요.</p>}
        </section>
      </aside>

      <section className="map-area">
        <div className="status-bar">{message}</div>
        <div ref={mapContainerRef} className="map" />
      </section>
    </main>
  );
}

function QaPanel({ qa }: { qa: QaSummary }) {
  const rows = [
    ["invalid geometry", qa.invalidGeometry],
    ["null geometry", qa.nullGeometry],
    ["null no source", qa.nullNoSourceData],
    ["null topology", qa.nullInvalidTopology],
    ["projected", qa.projectedFeatures],
    ["GeoJSON", qa.geoJsonRows],
    ["missing GeoJSON", qa.missingGeoJson],
    ["blocking issue", qa.blockingValidationIssues]
  ];

  return (
    <dl className="qa-grid">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd className={Number(value) === 0 ? "ok" : "warn"}>{Number(value).toLocaleString()}</dd>
        </div>
      ))}
    </dl>
  );
}

function CataloguePanel({ status }: { status: CatalogueRuntimeStatus }) {
  return (
    <div className={status.catalogueMismatch || !status.cacheReady ? "notice warn-box" : "notice ok-box"}>
      <dl className="meta-grid">
        <dt>Cache</dt>
        <dd>{status.cacheReady ? "준비됨" : "미준비"}</dd>
        <dt>Feature</dt>
        <dd>{status.featureCatalogue?.version ?? "-"}</dd>
        <dt>Portrayal</dt>
        <dd>{status.portrayalCatalogue?.version ?? "MVP fallback"}</dd>
      </dl>
      {status.warning ? <p>{status.warning}</p> : null}
    </div>
  );
}

function FeaturePanel({ detail }: { detail: FeatureDetail }) {
  return (
    <div className="feature-detail">
      <dl className="meta-grid">
        <dt>Instance</dt>
        <dd>{detail.featureInstanceId}</dd>
        <dt>Type</dt>
        <dd>{detail.featureTypeCode}</dd>
        <dt>Catalogue</dt>
        <dd>{detail.catalogueSnapshotId ?? "snapshot 미연결"}</dd>
        <dt>Geometry</dt>
        <dd>{detail.geometryType ?? "-"}</dd>
        <dt>FOID</dt>
        <dd>
          {detail.foid.agen ?? "-"} / {detail.foid.fidn ?? "-"} / {detail.foid.fids ?? "-"}
        </dd>
      </dl>
      <pre>{JSON.stringify(detail.attributes, null, 2)}</pre>
    </div>
  );
}

function createBounds(collection: FeatureGeoJsonCollection) {
  const coordinates: number[][] = [];
  for (const feature of collection.features) {
    collectCoordinates((feature.geometry as GeometryLike | null) ?? null, coordinates);
  }
  if (coordinates.length === 0) {
    return null;
  }
  const bounds = new maplibregl.LngLatBounds(coordinates[0] as [number, number], coordinates[0] as [number, number]);
  for (const coordinate of coordinates) {
    bounds.extend(coordinate as [number, number]);
  }
  return bounds;
}

type GeometryLike =
  | { type: "Point"; coordinates: number[] }
  | { type: "MultiPoint" | "LineString"; coordinates: number[][] }
  | { type: "MultiLineString" | "Polygon"; coordinates: number[][][] }
  | { type: "MultiPolygon"; coordinates: number[][][][] };

function collectCoordinates(geometry: GeometryLike | null, output: number[][]) {
  if (!geometry) {
    return;
  }
  if (geometry.type === "Point") {
    output.push(geometry.coordinates);
    return;
  }
  if (geometry.type === "MultiPoint" || geometry.type === "LineString") {
    output.push(...geometry.coordinates);
    return;
  }
  if (geometry.type === "MultiLineString" || geometry.type === "Polygon") {
    for (const line of geometry.coordinates) {
      output.push(...line);
    }
    return;
  }
  if (geometry.type === "MultiPolygon") {
    for (const polygon of geometry.coordinates) {
      for (const ring of polygon) {
        output.push(...ring);
      }
    }
  }
}
