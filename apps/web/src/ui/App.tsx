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
  datasetVersionId: null,
  productSpecification: "2.0",
  featureCatalogueVersion: null,
  portrayalCatalogueVersion: null,
  features: []
};

const portrayalStages = [
  { stage: 0, label: "0", zoom: 5.2, scale: "1:2,000,000", mode: "Overview" },
  { stage: 1, label: "1", zoom: 7, scale: "1:700,000", mode: "Regional" },
  { stage: 2, label: "2", zoom: 8.8, scale: "1:350,000", mode: "Approach" },
  { stage: 3, label: "3", zoom: 10.5, scale: "1:120,000", mode: "Coastal" },
  { stage: 4, label: "4", zoom: 12, scale: "1:50,000", mode: "Harbour" },
  { stage: 5, label: "5", zoom: 13.8, scale: "1:22,000", mode: "Berthing" },
  { stage: 6, label: "6", zoom: 15.4, scale: "1:8,000", mode: "Detail" }
];

const layerDefinitions = [
  { id: "s101-point", label: "Point" },
  { id: "s101-multipoint", label: "MultiPoint" },
  { id: "s101-curve", label: "Curve" },
  { id: "s101-surface", label: "Surface" },
  { id: "s101-data-coverage", label: "Data Coverage" },
  { id: "s101-validation-error", label: "Validation Error" },
  { id: "s101-selected-feature-fill", label: "Selected Feature" }
];

export function App() {
  const mapRef = useRef<maplibregl.Map | null>(null);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const selectedDatasetRef = useRef<DatasetItem | null>(null);
  const catalogueStatusRef = useRef<CatalogueRuntimeStatus | null>(null);
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
  const [portrayalStage, setPortrayalStage] = useState(2);
  const [visibleLayers, setVisibleLayers] = useState<Record<string, boolean>>(
    Object.fromEntries(layerDefinitions.map((layer) => [layer.id, true]))
  );

  const selectedDataset = useMemo(
    () => datasets.find((dataset) => dataset.datasetId === selectedDatasetId) ?? null,
    [datasets, selectedDatasetId]
  );
  const activeStage = portrayalStages.find((stage) => stage.stage === portrayalStage) ?? portrayalStages[2];

  useEffect(() => {
    selectedDatasetRef.current = selectedDataset;
  }, [selectedDataset]);

  useEffect(() => {
    catalogueStatusRef.current = catalogueStatus;
  }, [catalogueStatus]);

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
            paint: { "background-color": "#dceef7" }
          }
        ]
      },
      center: [126.5, 34.4],
      zoom: activeStage.zoom
    });

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-left");
    map.on("load", () => {
      addSources(map);
      addLayers(map);
      map.on("click", ["s101-surface", "s101-curve", "s101-multipoint", "s101-point"], (event) => {
        const feature = event.features?.[0];
        const featureInstanceId = feature?.properties?.featureInstanceId;
        if (!featureInstanceId) {
          return;
        }
        setSelectedFeature(createSelectedCollection(String(featureInstanceId), feature.geometry, feature.properties ?? {}));
        fetchFeatureDetail(String(featureInstanceId))
          .then(setDetail)
          .catch((error: Error) => setMessage(`feature 상세 조회 실패: ${error.message}`));
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
        setSearchResults([]);
        setMessage(`${selectedDataset.dsnm} feature ${featureResult.features.length}건`);
      })
      .catch((error: Error) => setMessage(`조회 실패: ${error.message}`));
  }, [selectedDataset]);

  useEffect(() => {
    updateGeoJsonSource("s101-features", features);
    const bounds = createBounds(features);
    if (bounds) {
      mapRef.current?.fitBounds(bounds, { padding: 60, maxZoom: activeStage.zoom, duration: 500 });
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

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }
    for (const layer of layerDefinitions) {
      const layerIds =
        layer.id === "s101-selected-feature-fill"
          ? ["s101-selected-feature-fill", "s101-selected-feature-line", "s101-selected-feature-point"]
          : [layer.id];
      for (const layerId of layerIds) {
        if (map.getLayer(layerId)) {
          map.setLayoutProperty(layerId, "visibility", visibleLayers[layer.id] ? "visible" : "none");
        }
      }
    }
  }, [visibleLayers]);

  function updateGeoJsonSource(sourceName: string, collection: FeatureGeoJsonCollection) {
    const source = mapRef.current?.getSource(sourceName) as maplibregl.GeoJSONSource | undefined;
    source?.setData(collection as any);
  }

  function changePortrayalStage(nextStage: number) {
    const boundedStage = Math.max(0, Math.min(6, nextStage));
    const stage = portrayalStages[boundedStage];
    setPortrayalStage(boundedStage);
    mapRef.current?.easeTo({ zoom: stage.zoom, duration: 450 });
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
      setSelectedFeature(createSelectedCollection(item.featureInstanceId, feature.geometry, feature.properties));
      const bounds = createBounds({
        ...emptyCollection,
        datasetVersionId: selectedDataset?.datasetVersionId ?? null,
        productSpecification: selectedDataset?.productSpecification ?? "2.0",
        features: [feature]
      });
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

  function createSelectedCollection(id: string, geometry: unknown, properties: Record<string, unknown>) {
    const dataset = selectedDatasetRef.current;
    const catalogue = catalogueStatusRef.current;
    return {
      type: "FeatureCollection",
      datasetVersionId: dataset?.datasetVersionId ?? null,
      productSpecification: dataset?.productSpecification ?? "2.0",
      featureCatalogueVersion: catalogue?.featureCatalogue?.version ?? null,
      portrayalCatalogueVersion: catalogue?.portrayalCatalogue?.version ?? null,
      features: [
        {
          type: "Feature",
          id,
          geometry,
          properties
        }
      ]
    } satisfies FeatureGeoJsonCollection;
  }

  return (
    <main className="viewer-shell">
      <Header dataset={selectedDataset} catalogueStatus={catalogueStatus} message={message} />
      <section className="viewer-grid">
        <DatasetExplorer
          datasets={datasets}
          layerState={visibleLayers}
          onLayerChange={setVisibleLayers}
          onSearch={handleSearchSubmit}
          onSearchQueryChange={setSearchQuery}
          onSearchResultSelect={selectSearchResult}
          onSelectDataset={setSelectedDatasetId}
          portrayalStage={portrayalStage}
          qa={qa}
          searchQuery={searchQuery}
          searchResults={searchResults}
          selectedDataset={selectedDataset}
          selectedDatasetId={selectedDatasetId}
          stage={activeStage}
        />
        <MapPanel mapContainerRef={mapContainerRef} onStageChange={changePortrayalStage} stage={activeStage} />
        <aside className="inspector-panel">
          <PanelHeader title="Feature Inspector" />
          {detail ? <FeaturePanel detail={detail} /> : <p className="muted">지도 또는 검색 결과에서 feature를 선택하세요.</p>}
        </aside>
      </section>
      <QaDashboard qa={qa} />
      <footer className="viewer-footer">
        <span>projection.s101_feature_geojson</span>
        <span>Feature Catalogue: {catalogueStatus?.featureCatalogue?.version ?? "미연결"}</span>
        <span>Portrayal: Lua 준비 / MVP fallback 사용 중</span>
        <span>SCAMIN 단계 {activeStage.stage}</span>
      </footer>
    </main>
  );
}

function Header({
  dataset,
  catalogueStatus,
  message
}: {
  dataset: DatasetItem | null;
  catalogueStatus: CatalogueRuntimeStatus | null;
  message: string;
}) {
  return (
    <header className="app-header">
      <div className="brand-block">
        <div className="brand-mark">S</div>
        <div>
          <h1>S-101 V2.0 Web Viewer</h1>
          <p>{message}</p>
        </div>
      </div>
      <div className="version-strip">
        <InfoPill label="Dataset" value={dataset?.dsnm ?? "-"} />
        <InfoPill label="Edition" value={dataset?.editionNumber ?? "-"} />
        <InfoPill label="Update" value={dataset?.updateNumber ?? "-"} />
        <InfoPill label="Product Spec" value="2.0" />
        <InfoPill label="FC" value={catalogueStatus?.featureCatalogue?.version ?? "미연결"} />
        <InfoPill label="PC" value={catalogueStatus?.portrayalCatalogue?.version ?? "MVP"} />
        <InfoPill label="Status" value={dataset?.conformanceStatus ?? "-"} tone="ok" />
      </div>
    </header>
  );
}

function InfoPill({ label, value, tone }: { label: string; value: string | number; tone?: "ok" | "warn" }) {
  return (
    <div className={`info-pill ${tone ?? ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function DatasetExplorer({
  datasets,
  selectedDataset,
  selectedDatasetId,
  onSelectDataset,
  searchQuery,
  onSearchQueryChange,
  onSearch,
  searchResults,
  onSearchResultSelect,
  layerState,
  onLayerChange,
  portrayalStage,
  stage,
  qa
}: {
  datasets: DatasetItem[];
  selectedDataset: DatasetItem | null;
  selectedDatasetId: string;
  onSelectDataset: (datasetId: string) => void;
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  onSearch: (event: FormEvent<HTMLFormElement>) => void;
  searchResults: FeatureSearchItem[];
  onSearchResultSelect: (item: FeatureSearchItem) => void;
  layerState: Record<string, boolean>;
  onLayerChange: (state: Record<string, boolean>) => void;
  portrayalStage: number;
  stage: (typeof portrayalStages)[number];
  qa: QaSummary | null;
}) {
  return (
    <aside className="explorer-panel">
      <PanelHeader title="Dataset Explorer" />
      <section className="panel-section">
        <label htmlFor="dataset">데이터셋 목록</label>
        <select id="dataset" value={selectedDatasetId} onChange={(event) => onSelectDataset(event.target.value)}>
          {datasets.map((dataset) => (
            <option key={dataset.datasetId} value={dataset.datasetId}>
              {dataset.dsnm}
            </option>
          ))}
        </select>
        <dl className="meta-grid">
          <dt>Version</dt>
          <dd>{selectedDataset?.datasetVersionId ?? "-"}</dd>
          <dt>Feature</dt>
          <dd>{selectedDataset?.featureCount.toLocaleString() ?? "-"}</dd>
          <dt>Scale</dt>
          <dd>
            {selectedDataset?.minScale ?? "-"} / {selectedDataset?.maxScale ?? "-"}
          </dd>
        </dl>
      </section>
      <section className="panel-section">
        <h2>검색</h2>
        <form className="search-box" onSubmit={onSearch}>
          <input
            onChange={(event) => onSearchQueryChange(event.target.value)}
            placeholder="Feature code, FOID, Attribute, Dataset"
            value={searchQuery}
          />
          <button type="submit">검색</button>
        </form>
        {searchResults.length > 0 ? (
          <div className="search-results">
            {searchResults.map((item) => (
              <button key={item.featureInstanceId} onClick={() => onSearchResultSelect(item)} type="button">
                <strong>{item.featureName ?? `Feature ${item.featureTypeCode}`}</strong>
                <span>
                  {item.dsnm} / {item.geometryType ?? "-"} / {item.matchReason}
                </span>
              </button>
            ))}
          </div>
        ) : null}
      </section>
      <section className="panel-section">
        <h2>S101 Layers</h2>
        <div className="layer-list">
          {layerDefinitions.map((layer) => (
            <label key={layer.id}>
              <input
                checked={layerState[layer.id] ?? true}
                onChange={(event) => onLayerChange({ ...layerState, [layer.id]: event.target.checked })}
                type="checkbox"
              />
              <span>{layer.label}</span>
            </label>
          ))}
        </div>
      </section>
      <section className="panel-section">
        <h2>Lua / SCAMIN</h2>
        <div className="scale-card">
          <strong>단계 {portrayalStage}</strong>
          <span>{stage.mode}</span>
          <span>{stage.scale}</span>
          <small>현재는 Lua rule 실행 전 단계이며, SCAMIN/SMIN/SMAX 확인용 zoom band입니다.</small>
        </div>
      </section>
      <section className="panel-section">
        <h2>QA 요약</h2>
        <div className="summary-tiles">
          <Metric label="Missing GeoJSON" value={qa?.missingGeoJson ?? 0} />
          <Metric label="Invalid Geometry" value={qa?.invalidGeometry ?? 0} />
          <Metric label="Blocking Issue" value={qa?.blockingValidationIssues ?? 0} />
          <Metric label="Warning" value={qa?.validationWarning ?? 0} />
        </div>
      </section>
    </aside>
  );
}

function MapPanel({
  mapContainerRef,
  stage,
  onStageChange
}: {
  mapContainerRef: React.RefObject<HTMLDivElement>;
  stage: (typeof portrayalStages)[number];
  onStageChange: (stage: number) => void;
}) {
  return (
    <section className="map-panel">
      <PanelHeader title="Map Viewer" />
      <div className="map-frame">
        <div className="map-legend">
          <span>
            <i className="dot point" /> Point
          </span>
          <span>
            <i className="line" /> Curve
          </span>
          <span>
            <i className="box" /> Surface
          </span>
        </div>
        <div className="scale-control">
          <button onClick={() => onStageChange(stage.stage - 1)} type="button">
            -
          </button>
          <div>
            <strong>SCAMIN {stage.label}</strong>
            <span>{stage.scale}</span>
          </div>
          <button onClick={() => onStageChange(stage.stage + 1)} type="button">
            +
          </button>
        </div>
        <div className="stage-rail">
          {portrayalStages.map((item) => (
            <button
              className={item.stage === stage.stage ? "active" : ""}
              key={item.stage}
              onClick={() => onStageChange(item.stage)}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </div>
        <div ref={mapContainerRef} className="map" />
      </div>
    </section>
  );
}

function PanelHeader({ title }: { title: string }) {
  return (
    <div className="panel-header">
      <h2>{title}</h2>
      <span>⌃</span>
    </div>
  );
}

function QaDashboard({ qa }: { qa: QaSummary | null }) {
  const groups = [
    { title: "Invalid Geometry", value: qa?.invalidGeometry ?? 0, warn: qa?.invalidGeometry ?? 0 },
    { title: "Null Geometry", value: qa?.nullGeometry ?? 0, warn: qa?.nullInvalidTopology ?? 0 },
    { title: "Missing GeoJSON", value: qa?.missingGeoJson ?? 0, warn: qa?.missingGeoJson ?? 0 },
    { title: "Feature Link", value: qa?.featureRecordWithoutInstance ?? 0, warn: qa?.featureRecordWithoutInstance ?? 0 },
    {
      title: "Association Source/Target",
      value: (qa?.associationSourceMissing ?? 0) + (qa?.associationTargetMissing ?? 0),
      warn: (qa?.associationSourceMissing ?? 0) + (qa?.associationTargetMissing ?? 0)
    },
    { title: "Blocking Validation Issue", value: qa?.blockingValidationIssues ?? 0, warn: qa?.blockingValidationIssues ?? 0 },
    { title: "Canonical ↔ Projection", value: qa?.projectedFeatures ?? 0, warn: qa?.missingGeoJson ?? 0 },
    { title: "Health Check", value: qa ? "OK" : "-", warn: 0 }
  ];

  return (
    <section className="qa-dashboard">
      <PanelHeader title="QA Dashboard" />
      <div className="qa-cards">
        {groups.map((group) => (
          <article className="qa-card" key={group.title}>
            <span>{group.title}</span>
            <strong className={Number(group.warn) > 0 ? "warn" : "ok"}>{group.value}</strong>
            <small>심각 {group.warn} / 정상 {group.warn === 0 ? "OK" : "확인 필요"}</small>
          </article>
        ))}
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong className={value > 0 ? "warn" : "ok"}>{value.toLocaleString()}</strong>
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
        <DataTable
          headers={["Code", "Name", "ATIX", "PAIX", "Value"]}
          rows={detail.simpleAttributes.map((attribute) => [
            attribute.code,
            attribute.name ?? "-",
            attribute.atix,
            attribute.paix ?? "-",
            formatValue(attribute.value ?? attribute.rawValue)
          ])}
        />
      ) : (
        <p className="muted">simple attribute 없음</p>
      )}
      <h3>Complex Attribute</h3>
      {detail.complexAttributes.length > 0 ? (
        <DataTable
          headers={["Code", "Name", "ATIX", "PAIX", "Occurrence"]}
          rows={detail.complexAttributes.map((attribute) => [
            attribute.code,
            attribute.name ?? "-",
            attribute.atix,
            attribute.paix ?? "-",
            attribute.occurrenceOrdinal
          ])}
        />
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
    <DataTable
      headers={["Type", "Role", "Target", "Record"]}
      rows={detail.associations.map((association) => [
        association.associationType,
        association.role ?? association.sourceField,
        association.targetType ? `${association.targetType}:${association.targetId ?? "-"}` : "-",
        association.targetRecordId ?? "-"
      ])}
    />
  );
}

function FeatureSpatial({ detail }: { detail: FeatureDetail }) {
  if (detail.spatial.length === 0) {
    return <p className="muted">spatial reference 없음</p>;
  }
  return (
    <DataTable
      headers={["Spatial Type", "Spatial Record", "Geometry", "SRID", "SMIN/SMAX", "Topology"]}
      rows={detail.spatial.map((spatial) => [
        spatial.spatialType,
        `${spatial.rcnm}:${spatial.rcid} / RVER ${spatial.rver} / RUIN ${spatial.ruin}`,
        spatial.geometryType ?? "-",
        spatial.srid ?? "-",
        `${spatial.minScale ?? "-"} / ${spatial.maxScale ?? "-"}`,
        spatial.topology
      ])}
    />
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

function DataTable({ headers, rows }: { headers: string[]; rows: Array<Array<string | number>> }) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            {headers.map((header) => (
              <th key={header}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td key={`${rowIndex}-${cellIndex}`}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function addSources(map: maplibregl.Map) {
  map.addSource("s101-features", { type: "geojson", data: emptyCollection as any });
  map.addSource("s101-data-coverage", { type: "geojson", data: emptyCollection as any });
  map.addSource("s101-validation-errors", { type: "geojson", data: emptyCollection as any });
  map.addSource("s101-selected-feature", { type: "geojson", data: emptyCollection as any });
}

function addLayers(map: maplibregl.Map) {
  map.addLayer({
    id: "s101-surface",
    type: "fill",
    source: "s101-features",
    filter: ["in", ["geometry-type"], ["literal", ["Polygon", "MultiPolygon"]]],
    paint: { "fill-color": ["match", ["get", "featureTypeCode"], 1, "#60a5fa", 2, "#2dd4bf", "#a78bfa"], "fill-opacity": 0.36 }
  });
  map.addLayer({
    id: "s101-curve",
    type: "line",
    source: "s101-features",
    filter: ["in", ["geometry-type"], ["literal", ["LineString", "MultiLineString"]]],
    paint: { "line-color": "#1d4ed8", "line-width": 2 }
  });
  map.addLayer({
    id: "s101-multipoint",
    type: "circle",
    source: "s101-features",
    filter: ["==", ["geometry-type"], "MultiPoint"],
    paint: { "circle-radius": 4, "circle-color": "#7c3aed", "circle-stroke-width": 1, "circle-stroke-color": "#ffffff" }
  });
  map.addLayer({
    id: "s101-point",
    type: "circle",
    source: "s101-features",
    filter: ["==", ["geometry-type"], "Point"],
    paint: { "circle-radius": 5, "circle-color": "#15803d", "circle-stroke-width": 1, "circle-stroke-color": "#ffffff" }
  });
  map.addLayer({
    id: "s101-data-coverage",
    type: "line",
    source: "s101-data-coverage",
    paint: { "line-color": "#2563eb", "line-dasharray": [2, 2], "line-width": 2 }
  });
  map.addLayer({
    id: "s101-validation-error",
    type: "circle",
    source: "s101-validation-errors",
    paint: { "circle-radius": 7, "circle-color": "#dc2626", "circle-stroke-width": 2, "circle-stroke-color": "#ffffff" }
  });
  map.addLayer({
    id: "s101-selected-feature-fill",
    type: "fill",
    source: "s101-selected-feature",
    filter: ["in", ["geometry-type"], ["literal", ["Polygon", "MultiPolygon"]]],
    paint: { "fill-color": "#f59e0b", "fill-opacity": 0.28 }
  });
  map.addLayer({
    id: "s101-selected-feature-line",
    type: "line",
    source: "s101-selected-feature",
    paint: { "line-color": "#f59e0b", "line-width": 4 }
  });
  map.addLayer({
    id: "s101-selected-feature-point",
    type: "circle",
    source: "s101-selected-feature",
    filter: ["in", ["geometry-type"], ["literal", ["Point", "MultiPoint"]]],
    paint: { "circle-radius": 8, "circle-color": "#f59e0b", "circle-stroke-width": 2, "circle-stroke-color": "#ffffff" }
  });
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
    ...emptyCollection,
    datasetVersionId: dataset.datasetVersionId,
    productSpecification: dataset.productSpecification,
    features: [
      {
        type: "Feature",
        id: `dataset-${dataset.datasetId}-coverage`,
        geometry: dataset.bbox,
        properties: { datasetId: dataset.datasetId, datasetVersionId: dataset.datasetVersionId, dsnm: dataset.dsnm }
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
