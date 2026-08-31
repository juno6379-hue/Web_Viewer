import maplibregl from "maplibre-gl";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type {
  CatalogueRuntimeStatus,
  DatasetItem,
  FeatureDetail,
  FeatureGeoJsonCollection,
  FeatureSearchItem,
  QaSummary
} from "../../../../packages/shared/src/index";
import {
  fetchCatalogueStatus,
  fetchDatasets,
  fetchFeatureDetail,
  fetchFeatures,
  fetchQaSummary,
  searchFeatures
} from "../api";

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
  const [selectedFeature, setSelectedFeature] = useState<FeatureGeoJsonCollection>(emptyCollection);
  const [dataCoverage, setDataCoverage] = useState<FeatureGeoJsonCollection>(emptyCollection);
  const [validationErrors] = useState<FeatureGeoJsonCollection>(emptyCollection);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<FeatureSearchItem[]>([]);
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
      map.addSource("s101-data-coverage", {
        type: "geojson",
        data: emptyCollection as any
      });
      map.addSource("s101-validation-errors", {
        type: "geojson",
        data: emptyCollection as any
      });
      map.addSource("s101-selected-feature", {
        type: "geojson",
        data: emptyCollection as any
      });
      map.addLayer({
        id: "s101-surface",
        type: "fill",
        source: "s101-features",
        filter: ["in", ["geometry-type"], ["literal", ["Polygon", "MultiPolygon"]]],
        paint: {
          "fill-color": ["match", ["get", "featureTypeCode"], 1, "#3b82f6", 2, "#14b8a6", "#7c3aed"],
          "fill-opacity": 0.32
        }
      });
      map.addLayer({
        id: "s101-curve",
        type: "line",
        source: "s101-features",
        filter: ["in", ["geometry-type"], ["literal", ["LineString", "MultiLineString"]]],
        paint: {
          "line-color": "#0f766e",
          "line-width": 2
        }
      });
      map.addLayer({
        id: "s101-multipoint",
        type: "circle",
        source: "s101-features",
        filter: ["==", ["geometry-type"], "MultiPoint"],
        paint: {
          "circle-radius": 4,
          "circle-color": "#9333ea",
          "circle-stroke-width": 1,
          "circle-stroke-color": "#ffffff"
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
      map.addLayer({
        id: "s101-data-coverage",
        type: "line",
        source: "s101-data-coverage",
        paint: {
          "line-color": "#2563eb",
          "line-dasharray": [2, 2],
          "line-width": 2
        }
      });
      map.addLayer({
        id: "s101-validation-error",
        type: "circle",
        source: "s101-validation-errors",
        paint: {
          "circle-radius": 7,
          "circle-color": "#ef4444",
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ffffff"
        }
      });
      map.addLayer({
        id: "s101-selected-feature-fill",
        type: "fill",
        source: "s101-selected-feature",
        filter: ["in", ["geometry-type"], ["literal", ["Polygon", "MultiPolygon"]]],
        paint: {
          "fill-color": "#f59e0b",
          "fill-opacity": 0.26
        }
      });
      map.addLayer({
        id: "s101-selected-feature-line",
        type: "line",
        source: "s101-selected-feature",
        paint: {
          "line-color": "#f59e0b",
          "line-width": 4
        }
      });
      map.addLayer({
        id: "s101-selected-feature-point",
        type: "circle",
        source: "s101-selected-feature",
        filter: ["in", ["geometry-type"], ["literal", ["Point", "MultiPoint"]]],
        paint: {
          "circle-radius": 8,
          "circle-color": "#f59e0b",
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ffffff"
        }
      });
      map.on("click", ["s101-surface", "s101-curve", "s101-multipoint", "s101-point"], (event) => {
        const feature = event.features?.[0];
        const featureInstanceId = feature?.properties?.featureInstanceId;
        if (featureInstanceId) {
          setSelectedFeature({
            type: "FeatureCollection",
            features: [
              {
                type: "Feature",
                id: String(featureInstanceId),
                geometry: feature.geometry,
                properties: feature.properties ?? {}
              }
            ]
          });
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
        setSelectedFeature(emptyCollection);
        setDataCoverage(createDataCoverage(selectedDataset));
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

  useEffect(() => {
    updateGeoJsonSource("s101-selected-feature", selectedFeature);
  }, [selectedFeature]);

  useEffect(() => {
    updateGeoJsonSource("s101-data-coverage", dataCoverage);
  }, [dataCoverage]);

  useEffect(() => {
    updateGeoJsonSource("s101-validation-errors", validationErrors);
  }, [validationErrors]);

  function updateGeoJsonSource(sourceName: string, collection: FeatureGeoJsonCollection) {
    const map = mapRef.current;
    const source = map?.getSource(sourceName) as maplibregl.GeoJSONSource | undefined;
    if (!map || !source) {
      return;
    }
    source.setData(collection as any);
  }

  function handleSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = searchQuery.trim();
    if (!query) {
      setSearchResults([]);
      return;
    }
    searchFeatures(query, selectedDataset?.datasetId)
      .then((result) => {
        setSearchResults(result.items);
        setMessage(`검색 결과 ${result.items.length}건`);
      })
      .catch((error: Error) => setMessage(`검색 실패: ${error.message}`));
  }

  function selectSearchResult(item: FeatureSearchItem) {
    const feature = features.features.find((candidate) => candidate.id === item.featureInstanceId);
    if (feature) {
      setSelectedFeature({
        type: "FeatureCollection",
        features: [feature]
      });
      const bounds = createBounds({ type: "FeatureCollection", features: [feature] });
      if (bounds) {
        mapRef.current?.fitBounds(bounds, { padding: 80, maxZoom: 15, duration: 500 });
      }
    } else {
      const bounds = createBoundsFromGeometry(item.bbox as GeometryLike | null);
      if (bounds) {
        mapRef.current?.fitBounds(bounds, { padding: 80, maxZoom: 15, duration: 500 });
      }
    }
    fetchFeatureDetail(item.featureInstanceId)
      .then(setDetail)
      .catch((error: Error) => setMessage(`feature 상세 조회 실패: ${error.message}`));
  }

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
        <DatasetVersionBar dataset={selectedDataset} catalogueStatus={catalogueStatus} />
        <div className="status-bar">{message}</div>
        <form className="search-panel" onSubmit={handleSearchSubmit}>
          <label htmlFor="feature-search">Search</label>
          <div className="search-row">
            <input
              id="feature-search"
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Feature code, FOID, Attribute, Dataset"
              value={searchQuery}
            />
            <button type="submit">검색</button>
          </div>
          {searchResults.length > 0 ? (
            <div className="search-results">
              {searchResults.map((item) => (
                <button key={item.featureInstanceId} onClick={() => selectSearchResult(item)} type="button">
                  <strong>{item.featureName ?? `Feature ${item.featureTypeCode}`}</strong>
                  <span>
                    {item.dsnm} / {item.geometryType ?? "-"} / {item.matchReason}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </form>
        <div ref={mapContainerRef} className="map" />
      </section>
    </main>
  );
}

function DatasetVersionBar({
  dataset,
  catalogueStatus
}: {
  dataset: DatasetItem | null;
  catalogueStatus: CatalogueRuntimeStatus | null;
}) {
  return (
    <div className="version-bar">
      <strong>S-101</strong>
      <span>Dataset: {dataset?.dsnm ?? "-"}</span>
      <span>Edition: {dataset?.editionNumber ?? "-"}</span>
      <span>Update: {dataset?.updateNumber ?? "-"}</span>
      <span>Product: {dataset?.productId ?? "-"}</span>
      <span>Product Spec: 2.0</span>
      <span>FC: {catalogueStatus?.featureCatalogue?.version ?? "미연결"}</span>
      <span>PC: {catalogueStatus?.portrayalCatalogue?.version ?? "MVP"}</span>
      <span>Status: {dataset?.conformanceStatus ?? "-"}</span>
    </div>
  );
}

function QaPanel({ qa }: { qa: QaSummary }) {
  const groups = [
    {
      title: "Integrity",
      rows: [
        ["feature instance link", qa.featureRecordWithoutInstance],
        ["information instance link", qa.informationRecordWithoutInstance],
        ["attribute owner", qa.attributeOwnerMissing],
        ["complex attribute owner", qa.complexAttributeOwnerMissing],
        ["association source", qa.associationSourceMissing],
        ["association target", qa.associationTargetMissing]
      ]
    },
    {
      title: "Spatial",
      rows: [
        ["spatial reference cross-version", qa.spatialReferenceCrossVersion],
        ["curve endpoint", qa.curveEndpointCrossVersion],
        ["surface boundary", qa.surfaceBoundaryCrossVersion]
      ]
    },
    {
      title: "Geometry",
      rows: [
        ["invalid geometry", qa.invalidGeometry],
        ["null geometry", qa.nullGeometry],
        ["null no source data", qa.nullNoSourceData],
        ["null invalid topology", qa.nullInvalidTopology]
      ]
    },
    {
      title: "Projection",
      rows: [
        ["canonical feature count", qa.canonicalFeatureCount],
        ["projected feature count", qa.projectedFeatures],
        ["GeoJSON count", qa.geoJsonRows],
        ["missing GeoJSON", qa.missingGeoJson]
      ]
    },
    {
      title: "Validation",
      rows: [
        ["critical", qa.validationCritical],
        ["error", qa.validationError],
        ["warning", qa.validationWarning],
        ["blocking", qa.blockingValidationIssues]
      ]
    }
  ];

  return (
    <div className="qa-groups">
      {groups.map((group) => (
        <section className="qa-group" key={group.title}>
          <h3>{group.title}</h3>
          <dl className="qa-grid">
            {group.rows.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd className={Number(value) === 0 ? "ok" : "warn"}>{Number(value).toLocaleString()}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
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
  const [activeTab, setActiveTab] = useState("overview");
  const tabs = [
    ["overview", "Overview"],
    ["attributes", "Attributes"],
    ["associations", "Associations"],
    ["spatial", "Spatial"],
    ["raw", "Raw Record"],
    ["validation", "Validation"]
  ];

  return (
    <div className="feature-detail">
      <div className="tabs" role="tablist" aria-label="Feature Inspector">
        {tabs.map(([id, label]) => (
          <button
            aria-selected={activeTab === id}
            className={activeTab === id ? "tab active" : "tab"}
            key={id}
            onClick={() => setActiveTab(id)}
            role="tab"
            type="button"
          >
            {label}
          </button>
        ))}
      </div>
      <div className="tab-panel">
        {activeTab === "overview" ? <FeatureOverview detail={detail} /> : null}
        {activeTab === "attributes" ? <FeatureAttributes detail={detail} /> : null}
        {activeTab === "associations" ? <FeatureAssociations detail={detail} /> : null}
        {activeTab === "spatial" ? <FeatureSpatial detail={detail} /> : null}
        {activeTab === "raw" ? <FeatureRawRecord detail={detail} /> : null}
        {activeTab === "validation" ? <FeatureValidation detail={detail} /> : null}
      </div>
    </div>
  );
}

function FeatureOverview({ detail }: { detail: FeatureDetail }) {
  return (
    <dl className="meta-grid inspector-grid">
      <dt>Feature Name</dt>
      <dd>{detail.featureName ?? "catalogue 미연결"}</dd>
      <dt>Feature Code</dt>
      <dd>{detail.featureTypeCode}</dd>
      <dt>FOID</dt>
      <dd>
        {detail.foid.agen ?? "-"} / {detail.foid.fidn ?? "-"} / {detail.foid.fids ?? "-"}
      </dd>
      <dt>RCID</dt>
      <dd>{detail.rcid ?? "-"}</dd>
      <dt>RVER</dt>
      <dd>{detail.rver ?? "-"}</dd>
      <dt>RUIN</dt>
      <dd>{detail.ruin ?? "-"}</dd>
      <dt>Dataset</dt>
      <dd>{detail.dataset.dsnm ?? detail.datasetId}</dd>
      <dt>Edition</dt>
      <dd>{detail.dataset.editionNumber ?? "-"}</dd>
      <dt>Update</dt>
      <dd>{detail.dataset.updateNumber ?? "-"}</dd>
      <dt>Catalogue</dt>
      <dd>{detail.catalogueSnapshotId ?? "snapshot 미연결"}</dd>
    </dl>
  );
}

function FeatureAttributes({ detail }: { detail: FeatureDetail }) {
  return (
    <div className="stack">
      <h3>Simple Attribute</h3>
      {detail.simpleAttributes.length > 0 ? (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>ATIX</th>
                <th>PAIX</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {detail.simpleAttributes.map((attribute) => (
                <tr key={attribute.id}>
                  <td>{attribute.code}</td>
                  <td>{attribute.name ?? "-"}</td>
                  <td>{attribute.atix}</td>
                  <td>{attribute.paix ?? "-"}</td>
                  <td>{formatValue(attribute.value ?? attribute.rawValue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted">simple attribute 없음</p>
      )}
      <h3>Complex Attribute</h3>
      {detail.complexAttributes.length > 0 ? (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>ATIX</th>
                <th>PAIX</th>
                <th>Occurrence</th>
              </tr>
            </thead>
            <tbody>
              {detail.complexAttributes.map((attribute) => (
                <tr key={attribute.id}>
                  <td>{attribute.code}</td>
                  <td>{attribute.name ?? "-"}</td>
                  <td>{attribute.atix}</td>
                  <td>{attribute.paix ?? "-"}</td>
                  <td>{attribute.occurrenceOrdinal}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted">complex attribute 없음</p>
      )}
    </div>
  );
}

function FeatureAssociations({ detail }: { detail: FeatureDetail }) {
  if (detail.associations.length === 0) {
    return <p className="muted">association 없음</p>;
  }
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Type</th>
            <th>Role</th>
            <th>Target</th>
            <th>Record</th>
          </tr>
        </thead>
        <tbody>
          {detail.associations.map((association) => (
            <tr key={`${association.associationId}-${association.targetRecordId ?? "source"}`}>
              <td>{association.associationType}</td>
              <td>{association.role ?? association.sourceField}</td>
              <td>{association.targetType ? `${association.targetType}:${association.targetId ?? "-"}` : "-"}</td>
              <td>{association.targetRecordId ?? "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FeatureSpatial({ detail }: { detail: FeatureDetail }) {
  if (detail.spatial.length === 0) {
    return <p className="muted">spatial reference 없음</p>;
  }
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Spatial Type</th>
            <th>Spatial Record</th>
            <th>Geometry</th>
            <th>SRID</th>
            <th>BBOX</th>
            <th>Topology</th>
          </tr>
        </thead>
        <tbody>
          {detail.spatial.map((spatial) => (
            <tr key={spatial.spatialReferenceId}>
              <td>{spatial.spatialType}</td>
              <td>
                {spatial.rcnm}:{spatial.rcid} / RVER {spatial.rver} / RUIN {spatial.ruin}
              </td>
              <td>{spatial.geometryType ?? "-"}</td>
              <td>{spatial.srid ?? "-"}</td>
              <td>{formatValue(spatial.bbox)}</td>
              <td className={spatial.topology === "ok" ? "ok" : "warn"}>{spatial.topology}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FeatureRawRecord({ detail }: { detail: FeatureDetail }) {
  return (
    <div className="stack">
      {detail.rawRecord ? (
        <dl className="meta-grid inspector-grid">
          <dt>Raw Record</dt>
          <dd>{detail.rawRecord.rawRecordId}</dd>
          <dt>Resource</dt>
          <dd>{detail.rawRecord.exchangeResourceId}</dd>
          <dt>Ordinal</dt>
          <dd>{detail.rawRecord.recordOrdinal}</dd>
          <dt>Byte Offset</dt>
          <dd>{detail.rawRecord.byteOffset}</dd>
          <dt>Length</dt>
          <dd>{detail.rawRecord.recordLength}</dd>
          <dt>Field Tag</dt>
          <dd>{detail.rawRecord.fieldTag ?? "-"}</dd>
          <dt>Payload Hash</dt>
          <dd>{detail.rawRecord.rawPayloadHash ?? "-"}</dd>
          <dt>Decode</dt>
          <dd>{detail.rawRecord.decodeStatus}</dd>
        </dl>
      ) : (
        <p className="muted">raw record locator 없음</p>
      )}
      <h3>Projection Attributes</h3>
      <pre>{JSON.stringify(detail.attributes, null, 2)}</pre>
    </div>
  );
}

function FeatureValidation({ detail }: { detail: FeatureDetail }) {
  if (detail.validationIssues.length === 0) {
    return <p className="muted">해당 feature validation issue 없음</p>;
  }
  return (
    <div className="stack">
      {detail.validationIssues.map((issue) => (
        <article className="issue" key={issue.validationIssueId}>
          <strong className={issue.severity === "fatal" || issue.severity === "error" ? "warn" : ""}>
            {issue.severity} / {issue.ruleId}
          </strong>
          <p>{issue.message}</p>
          <span>
            {issue.targetSchema ?? "-"} / {issue.targetTable ?? "-"} / {issue.targetId ?? "-"} / {issue.fieldLocator ?? "-"}
          </span>
        </article>
      ))}
    </div>
  );
}

function formatValue(value: unknown) {
  if (value === null || value === undefined) {
    return "-";
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
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

function createBoundsFromGeometry(geometry: GeometryLike | null) {
  const coordinates: number[][] = [];
  collectCoordinates(geometry, coordinates);
  if (coordinates.length === 0) {
    return null;
  }
  const bounds = new maplibregl.LngLatBounds(coordinates[0] as [number, number], coordinates[0] as [number, number]);
  for (const coordinate of coordinates) {
    bounds.extend(coordinate as [number, number]);
  }
  return bounds;
}

function createDataCoverage(dataset: DatasetItem | null): FeatureGeoJsonCollection {
  if (!dataset?.bbox) {
    return emptyCollection;
  }
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        id: `dataset-${dataset.datasetId}-coverage`,
        geometry: dataset.bbox,
        properties: {
          datasetId: dataset.datasetId,
          datasetVersionId: dataset.datasetVersionId,
          dsnm: dataset.dsnm
        }
      }
    ]
  };
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
