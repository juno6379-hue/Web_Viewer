import type { FastifyInstance } from "fastify";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { z } from "zod";
import type {
  CatalogueRuntimeStatus,
  DatasetItem,
  FeatureDetail,
  FeatureGeoJsonCollection,
  FeatureSearchItem,
  HealthStatus,
  PortrayalDrawingInstruction,
  PortrayalPaletteResponse,
  PortrayalRuntimeStatus,
  PortrayalSymbolManifest,
  QaSummary
} from "../../../packages/shared/src/index.js";
import { parseDrawingInstructionText } from "../../../packages/portrayal/src/index.js";
import { ExternalLuaPortrayalRuntime } from "./luaPortrayalRuntime.js";
import { query } from "./db.js";

const productSpecification = "2.0";
const featureCatalogueVersion: string | null = process.env.FEATURE_CATALOGUE_VERSION ?? "2.0.0";
const portrayalCatalogueVersion: string | null = process.env.PORTRAYAL_CATALOGUE_VERSION ?? "2.0.0";
const s101PaletteDay: Record<string, string> = {
  CHWHT: "#C9EDFF",
  DEPVS: "#61B7FF",
  DEPIT: "#58AF9C",
  UIAFD: "#61B7FF",
  UIAFF: "#BFBE8F",
  NODTA: "#93AEBB",
  LITGN: "#52E83B",
  DNGHL: "#EA5471",
  APLRT: "#E38039",
  RESBL: "#2E7BFF",
  TRFCD: "#C045D1",
  CHBLK: "#25313A",
  CHGRD: "#768C97",
  CHYLW: "#E1E139",
  CHRED: "#E84545",
  CHGRN: "#34A853",
  CHMGD: "#C045D1",
  CHBRN: "#9B7653"
};

const fallbackPortrayalSymbols = [
  "BOYCAR01",
  "BOYCAR02",
  "BOYCAR03",
  "BOYCAR04",
  "BOYDEF03",
  "BOYLAT13",
  "BOYLAT14",
  "BOYLAT23",
  "BOYLAT24",
  "BOYSAW12",
  "BOYSPP15",
  "BCNCAR01",
  "BCNCAR02",
  "BCNCAR03",
  "BCNCAR04",
  "BCNDEF13",
  "BCNLAT15",
  "BCNLAT16",
  "BCNLAT21",
  "BCNLAT22",
  "BCNSAW21",
  "BCNSPP13",
  "LIGHTS11",
  "LIGHTS12",
  "LIGHTS13",
  "LIGHTS81",
  "LIGHTS82",
  "ACHARE02",
  "DANGER01",
  "DANGER02",
  "DANGER03",
  "FOULGND1",
  "OBSTRN01",
  "OBSTRN03",
  "OBSTRN11",
  "UWTROC03",
  "UWTROC04",
  "WRECKS01",
  "WRECKS04",
  "WRECKS05",
  "DEPARE01"
] as const;

type PortrayalSymbolCatalogItem = {
  symbolRef: string;
  description: string;
  endpoint: string;
  fileName: string;
};

let portrayalSymbolCache: { catalogueRoot: string | null; items: PortrayalSymbolCatalogItem[] } | null = null;
let portrayalRuleCache: { catalogueRoot: string | null; files: string[] } | null = null;
let featureNameByCodeCache: { cataloguePath: string | null; names: Map<number, string> } | null = null;
let featurePrimitiveByCodeCache: { cataloguePath: string | null; primitives: Map<number, string> } | null = null;
let attributeNameByCodeCache: { cataloguePath: string | null; names: Map<number, string> } | null = null;
const luaInstructionCache = new Map<string, LuaInstructionPayload | null>();

const numberText = z.string().trim().regex(/^\d+$/).transform((value) => Number(value));
const featureQuerySchema = z.object({
  datasetId: numberText.optional(),
  datasetVersionId: numberText.optional(),
  bbox: z.string().optional(),
  usageBands: z.string().optional(),
  featureTypeCode: numberText.optional(),
  limit: numberText.optional()
});
const qaQuerySchema = z.object({
  datasetId: numberText,
  datasetVersionId: numberText
});
const searchQuerySchema = z.object({
  q: z.string().trim().min(1),
  datasetId: numberText.optional(),
  limit: numberText.optional()
});

export function registerRoutes(app: FastifyInstance) {
  app.get("/health", async (): Promise<HealthStatus> => {
    const [database, projection, catalogue] = await Promise.all([
      checkDatabaseHealth(),
      checkProjectionHealth(),
      getCatalogueStatus()
    ]);
    return {
      database,
      projection,
      featureCatalogue: catalogue.featureCatalogue?.version ?? "not_loaded",
      portrayalCatalogue: catalogue.portrayalCatalogue?.version ?? "not_loaded"
    };
  });

  app.get("/health/db", async () => {
    const result = await query<{ database: string; user_name: string }>(
      "SELECT current_database() AS database, current_user AS user_name"
    );
    const row = result.rows[0];
    return { database: "ok", name: row.database, user: row.user_name };
  });

  app.get("/health/catalogue", async (): Promise<CatalogueRuntimeStatus> => getCatalogueStatus());

  app.get("/api/health/db", async () => {
    const result = await query<{ database: string; user_name: string }>(
      "SELECT current_database() AS database, current_user AS user_name"
    );
    const row = result.rows[0];
    return { ok: true, database: row.database, user: row.user_name };
  });

  app.get("/api/datasets", async () => {
    const result = await query<{
      dataset_id: string;
      dataset_version_id: string;
      dsnm: string;
      product_id: string;
      edition_number: number | null;
      update_number: number | null;
      purpose: string;
      min_scale: number | null;
      max_scale: number | null;
      conformance_status: string | null;
      bbox: unknown;
      feature_count: string;
    }>(`
      SELECT
        dc.dataset_id::text,
        dc.dataset_version_id::text,
        dc.dsnm,
        dc.product_id,
        dc.edition_number,
        dc.update_number,
        dc.purpose,
        dc.min_scale,
        dc.max_scale,
        dc.conformance_status,
        CASE WHEN dc.bbox IS NULL THEN NULL ELSE ST_AsGeoJSON(dc.bbox)::jsonb END AS bbox,
        COUNT(fc.feature_instance_id)::text AS feature_count
      FROM projection.s101_dataset_current dc
      LEFT JOIN projection.s101_feature_current fc
        ON fc.dataset_id = dc.dataset_id
       AND fc.dataset_version_id = dc.dataset_version_id
      GROUP BY dc.dataset_id, dc.dataset_version_id, dc.dsnm, dc.product_id,
               dc.edition_number, dc.update_number, dc.purpose, dc.min_scale, dc.max_scale,
               dc.conformance_status, dc.bbox
      ORDER BY dc.dsnm
    `);

    const items: DatasetItem[] = result.rows.map((row) => ({
      datasetId: row.dataset_id,
      datasetVersionId: row.dataset_version_id,
      dsnm: row.dsnm,
      productId: row.product_id,
      productSpecification,
      editionNumber: row.edition_number,
      updateNumber: row.update_number,
      purpose: row.purpose,
      minScale: row.min_scale,
      maxScale: row.max_scale,
      conformanceStatus: row.conformance_status,
      bbox: row.bbox,
      featureCount: Number(row.feature_count)
    }));
    return {
      source: {
        productSpecification,
        featureCatalogueVersion,
        portrayalCatalogueVersion
      },
      items
    };
  });

  app.get("/api/catalogue/status", async (): Promise<CatalogueRuntimeStatus> => getCatalogueStatus());

  app.get("/api/portrayal/status", async (): Promise<PortrayalRuntimeStatus> => ({
    mode: getPortrayalMode(),
    luaRuntime: getLuaRuntimePath() ? "configured" : "not_configured",
    symbolCount: getPortrayalSymbolItems().length,
    ruleCount: getPortrayalRuleFiles().length,
    paletteReady: true,
    supportedFeatureNames: [
      "BuoyLateral",
      "BuoyCardinal",
      "BeaconLateral",
      "BeaconCardinal",
      "LightAllAround",
      "LightSectored",
      "Wreck",
      "Obstruction",
      "DepthArea"
    ],
    warning: getLuaRuntimePath()
      ? null
      : "LUA_RUNTIME_PATH媛 ?놁뼱 S-101 Lua rule ?ㅽ뻾? 鍮꾪솢?깆엯?덈떎. feature ?묐떟? DrawingInstruction 援ъ“濡??대젮媛硫? Lua媛 ?꾩슂??rule? ?꾩떆 fallback instruction???ъ슜?⑸땲??"
  }));

  app.get("/api/portrayal/palette/:mode", async (request): Promise<PortrayalPaletteResponse> => {
    const params = z.object({ mode: z.enum(["day", "dusk", "night"]) }).parse(request.params);
    return {
      version: portrayalCatalogueVersion ?? "2.0.0",
      mode: params.mode,
      source: getPortrayalCatalogueRoot() ? "catalogue" : "fallback",
      colors: s101PaletteDay
    };
  });

  app.get("/api/portrayal/symbols", async (): Promise<PortrayalSymbolManifest> => ({
    version: portrayalCatalogueVersion ?? "2.0.0",
    source: getPortrayalCatalogueRoot() ? "catalogue" : "fallback",
    symbols: getPortrayalSymbolItems().map(({ symbolRef, description, endpoint }) => ({
      symbolRef,
      description,
      endpoint
    }))
  }));

  app.get("/api/portrayal/symbols/:symbolRef.svg", async (request, reply) => {
    const params = z.object({ symbolRef: z.string().trim().min(1) }).parse(request.params);
    const symbolRef = params.symbolRef.toUpperCase();
    if (!/^[A-Z0-9_-]+$/.test(symbolRef) || !getPortrayalSymbolItems().some((symbol) => symbol.symbolRef === symbolRef)) {
      reply.code(404);
      return { error: "吏?먰븯吏 ?딅뒗 Portrayal symbol?낅땲??", symbolRef };
    }
    reply.type("image/svg+xml; charset=utf-8");
    const catalogueSymbolPath = findCatalogueSymbolPath(symbolRef);
    if (catalogueSymbolPath) {
      return inlineSvgStyle(readFileSync(catalogueSymbolPath, "utf8"), "day");
    }
    return createFallbackSymbolSvg(symbolRef);
  });

  app.get("/api/features", async (request) => {
    const parsed = featureQuerySchema.parse(request.query);
    const limit = Math.min(parsed.limit ?? 5000, 20000);
    const values: unknown[] = [];
    const conditions: string[] = [];

    if (parsed.datasetId !== undefined) {
      values.push(parsed.datasetId);
      conditions.push(`gj.dataset_id = $${values.length}`);
    }

    if (parsed.datasetVersionId !== undefined) {
      values.push(parsed.datasetVersionId);
      conditions.push(`fc.dataset_version_id = $${values.length}`);
    }
    if (parsed.featureTypeCode !== undefined) {
      values.push(parsed.featureTypeCode);
      conditions.push(`gj.feature_type_code = $${values.length}`);
    }
    if (parsed.bbox) {
      const parts = parsed.bbox.split(",").map((part) => Number(part.trim()));
      if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) {
        const error = new Error("bbox??minX,minY,maxX,maxY ?뺤떇?댁뼱???⑸땲??");
        Object.assign(error, { statusCode: 400 });
        throw error;
      }
      values.push(parts[0], parts[1], parts[2], parts[3]);
      const index = values.length - 3;
      conditions.push(`gj.bbox && ST_MakeEnvelope($${index}, $${index + 1}, $${index + 2}, $${index + 3}, 4326)`);
    }
    const usageBands = parsed.usageBands
      ?.split(",")
      .map((part) => part.trim().toUpperCase())
      .filter((part) => /^[A-Z]$/.test(part));
    if (usageBands && usageBands.length > 0) {
      values.push(Array.from(new Set(usageBands)));
      conditions.push(`SUBSTRING(dc.dsnm FROM '^101[A-Z]{2}[0-9]+([A-Z])') = ANY($${values.length}::text[])`);
    }
    values.push(limit);
    const limitIndex = values.length;

    const result = await query<{
      feature_instance_id: string;
      feature_type_code: number;
      raw_feature_type_code: number | null;
      feature_type_name: string | null;
      dataset_id: string;
      dataset_version_id: string;
      dsnm: string;
      properties: Record<string, unknown>;
      geometry_geojson: unknown;
    }>(
      `
      SELECT
        gj.feature_instance_id::text,
        gj.feature_type_code,
        fc.raw_feature_type_code,
        fc.feature_type_name,
        fc.dataset_id::text,
        fc.dataset_version_id::text,
        dc.dsnm,
        gj.properties,
        COALESCE(z_geometry.geometry_geojson, gj.geometry_geojson) AS geometry_geojson
      FROM projection.s101_feature_geojson gj
      JOIN projection.s101_feature_current fc
        ON fc.feature_instance_id = gj.feature_instance_id
      JOIN projection.s101_dataset_current dc
        ON dc.dataset_id = fc.dataset_id
       AND dc.dataset_version_id = fc.dataset_version_id
      LEFT JOIN LATERAL (
        SELECT jsonb_build_object('type', 'MultiPoint', 'coordinates', z_coordinates.coordinates) AS geometry_geojson
        FROM (
          SELECT jsonb_agg(jsonb_build_array(c.x::double precision, c.y::double precision, c.z::double precision) ORDER BY sr.ordinal, c.coordinate_ordinal) AS coordinates
          FROM canonical.spatial_reference sr
          JOIN canonical.spatial_record spatial
            ON spatial.spatial_record_id = sr.spatial_record_id
          JOIN canonical.coordinate c
            ON c.spatial_record_id = spatial.spatial_record_id
          WHERE sr.feature_record_id = fc.feature_record_id
            AND c.z IS NOT NULL
            AND spatial.spatial_type IN ('point', 'point_set', 'pointset', 'multi_point', 'multipoint')
        ) z_coordinates
        WHERE z_coordinates.coordinates IS NOT NULL
      ) z_geometry ON true
      ${conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""}
      ORDER BY gj.feature_instance_id
      LIMIT $${limitIndex}
      `,
      values
    );

    const featurePrimitiveByCode = getFeaturePrimitiveByCode();
    const baseFeatures = result.rows.map((row) => {
      const featureName = row.feature_type_name || resolveFeatureName({ featureTypeCode: row.feature_type_code });
      const properties = {
        ...(row.properties ?? {}),
        featureName,
        featurePrimitive: featurePrimitiveByCode.get(Number(row.feature_type_code)) ?? null,
        datasetId: row.dataset_id,
        datasetVersionId: row.dataset_version_id,
        dsnm: row.dsnm,
        featureInstanceId: row.feature_instance_id,
        featureTypeCode: row.feature_type_code,
        rawFeatureTypeCode: row.raw_feature_type_code ?? row.feature_type_code
      };
      return {
        type: "Feature" as const,
        id: row.feature_instance_id,
        geometry: row.geometry_geojson,
        properties
      };
    });
    const luaInstructionsByFeature = await createLuaDrawingInstructions(baseFeatures);

    const collection: FeatureGeoJsonCollection = {
      type: "FeatureCollection",
      datasetVersionId: parsed.datasetVersionId === undefined ? null : String(parsed.datasetVersionId),
      productSpecification,
      featureCatalogueVersion,
      portrayalCatalogueVersion,
      portrayalMode: getPortrayalMode(),
      portrayalRuleCount: getPortrayalRuleFiles().length,
      features: baseFeatures.map((feature) => {
        const portrayalProperties = createFeaturePortrayalProperties(
          feature.properties,
          luaInstructionsByFeature.get(feature.id) ?? null
        );
        return {
          type: "Feature",
          id: feature.id,
          geometry: feature.geometry,
          properties: {
            ...feature.properties,
            ...portrayalProperties
          }
        };
      })
    };
    return collection;
  });

  app.get("/api/search/features", async (request) => {
    const parsed = searchQuerySchema.parse(request.query);
    const limit = Math.min(parsed.limit ?? 50, 200);
    const values: unknown[] = [`%${parsed.q}%`, parsed.q, limit];
    const conditions = [`
      (
        fc.feature_type_code::text ILIKE $1
        OR dc.dsnm ILIKE $1
        OR fc.foid_fidn::text ILIKE $1
        OR CONCAT_WS(':', fc.foid_agen::text, fc.foid_fidn::text, fc.foid_fids::text) ILIKE $1
        OR EXISTS (
          SELECT 1
          FROM canonical.feature_attribute_value fav
          WHERE fav.feature_record_id = fc.feature_record_id
            AND (
              fav.catalogue_name ILIKE $1
              OR fav.raw_value ILIKE $1
              OR fav.value_text ILIKE $1
              OR fav.value_integer::text ILIKE $1
              OR fav.value_numeric::text ILIKE $1
            )
        )
      )
    `];

    if (parsed.datasetId !== undefined) {
      values.push(parsed.datasetId);
      conditions.push(`fc.dataset_id = $${values.length}`);
    }

    const result = await query<{
      feature_instance_id: string;
      dataset_id: string;
      dataset_version_id: string;
      dsnm: string;
      feature_type_code: number;
      foid_agen: number | null;
      foid_fidn: string | null;
      foid_fids: number | null;
      geometry_type: string | null;
      bbox: unknown;
      match_reason: string;
    }>(
      `
      SELECT
        fc.feature_instance_id::text,
        fc.dataset_id::text,
        fc.dataset_version_id::text,
        dc.dsnm,
        fc.feature_type_code,
        fc.foid_agen,
        fc.foid_fidn::text,
        fc.foid_fids,
        CASE WHEN fc.geometry IS NULL THEN NULL ELSE GeometryType(fc.geometry) END AS geometry_type,
        CASE WHEN fc.geometry IS NULL THEN NULL ELSE ST_AsGeoJSON(ST_Envelope(fc.geometry))::jsonb END AS bbox,
        CASE
          WHEN fc.feature_type_code::text ILIKE $1 THEN 'feature code'
          WHEN dc.dsnm ILIKE $1 THEN 'dataset'
          WHEN fc.foid_fidn::text ILIKE $1 OR CONCAT_WS(':', fc.foid_agen::text, fc.foid_fidn::text, fc.foid_fids::text) ILIKE $1 THEN 'FOID'
          ELSE 'attribute'
        END AS match_reason
      FROM projection.s101_feature_current fc
      JOIN projection.s101_dataset_current dc
        ON dc.dataset_id = fc.dataset_id
       AND dc.dataset_version_id = fc.dataset_version_id
      WHERE ${conditions.join(" AND ")}
      ORDER BY
        CASE WHEN fc.feature_type_code::text = $2 THEN 0 ELSE 1 END,
        dc.dsnm,
        fc.feature_instance_id
      LIMIT $3
      `,
      values
    );

    const items: FeatureSearchItem[] = result.rows.map((row) => ({
      featureInstanceId: row.feature_instance_id,
      datasetId: row.dataset_id,
      datasetVersionId: row.dataset_version_id,
      dsnm: row.dsnm,
      featureTypeCode: row.feature_type_code,
      featureName: resolveFeatureName({ featureTypeCode: row.feature_type_code }),
      foid: { agen: row.foid_agen, fidn: row.foid_fidn, fids: row.foid_fids },
      geometryType: row.geometry_type,
      bbox: row.bbox,
      matchReason: row.match_reason
    }));
    return {
      datasetVersionId: result.rows[0]?.dataset_version_id ?? null,
      productSpecification,
      featureCatalogueVersion,
      portrayalCatalogueVersion,
      items
    };
  });

  app.get("/api/features/:featureInstanceId", async (request) => {
    const params = z.object({ featureInstanceId: numberText }).parse(request.params);
    const result = await query<{
      feature_instance_id: string;
      dataset_id: string;
      dataset_version_id: string;
      feature_record_id: string;
      feature_type_code: number;
      foid_agen: number | null;
      foid_fidn: string | null;
      foid_fids: number | null;
      rcid: number | null;
      rver: number | null;
      ruin: number | null;
      dsnm: string | null;
      edition_number: number | null;
      update_number: number | null;
      lifecycle_status: string;
      attributes: unknown;
      geometry_type: string | null;
    }>(
      `
      SELECT
        fc.feature_instance_id::text,
        fc.dataset_id::text,
        fc.dataset_version_id::text,
        fc.feature_record_id::text,
        fc.feature_type_code,
        fc.foid_agen,
        fc.foid_fidn::text,
        fc.foid_fids,
        fr.rcid,
        fr.rver,
        fr.ruin,
        dc.dsnm,
        dc.edition_number,
        dc.update_number,
        fc.lifecycle_status,
        fc.attributes,
        CASE WHEN fc.geometry IS NULL THEN NULL ELSE GeometryType(fc.geometry) END AS geometry_type
      FROM projection.s101_feature_current fc
      JOIN canonical.feature_record fr ON fr.feature_record_id = fc.feature_record_id
      LEFT JOIN projection.s101_dataset_current dc
        ON dc.dataset_id = fc.dataset_id
       AND dc.dataset_version_id = fc.dataset_version_id
      WHERE fc.feature_instance_id = $1
      `,
      [params.featureInstanceId]
    );
    const row = result.rows[0];
    if (!row) {
      const error = new Error("feature瑜?李얠쓣 ???놁뒿?덈떎.");
      Object.assign(error, { statusCode: 404 });
      throw error;
    }
    const [simpleAttributes, complexAttributes, associations, spatial, rawRecord, validationIssues] = await Promise.all([
      query<{
        id: string;
        code: number;
        name: string | null;
        atix: number;
        paix: number | null;
        atin: number;
        value_type: string | null;
        value: unknown;
        raw_value: string | null;
      }>(
        `
        SELECT
          fav.feature_attribute_value_id::text AS id,
          fav.natc AS code,
          fav.catalogue_name AS name,
          fav.atix,
          fav.paix,
          fav.atin,
          fav.value_type,
          COALESCE(
            to_jsonb(fav.value_text),
            to_jsonb(fav.value_integer),
            to_jsonb(fav.value_numeric),
            to_jsonb(fav.value_boolean),
            to_jsonb(fav.value_date),
            to_jsonb(fav.raw_value)
          ) AS value,
          fav.raw_value
        FROM canonical.feature_attribute_value fav
        WHERE fav.feature_record_id = $1
        ORDER BY fav.atix
        `,
        [row.feature_record_id]
      ),
      query<{
        id: string;
        code: number;
        name: string | null;
        atix: number;
        paix: number | null;
        occurrence_ordinal: number;
      }>(
        `
        SELECT
          cai.complex_attribute_instance_id::text AS id,
          cai.natc AS code,
          cai.catalogue_name AS name,
          cai.atix,
          cai.paix,
          cai.occurrence_ordinal
        FROM canonical.complex_attribute_instance cai
        WHERE cai.feature_record_id = $1
        ORDER BY cai.atix, cai.occurrence_ordinal
        `,
        [row.feature_record_id]
      ),
      query<{
        association_id: string;
        association_type: string;
        source_field: string;
        role: string | null;
        target_type: "feature" | "information" | null;
        target_id: string | null;
        target_record_id: string | null;
      }>(
        `
        SELECT
          a.association_id::text,
          a.association_type,
          a.source_field,
          am.member_role AS role,
          CASE
            WHEN am.target_feature_record_id IS NOT NULL THEN 'feature'
            WHEN am.target_information_record_id IS NOT NULL THEN 'information'
            ELSE NULL
          END AS target_type,
          COALESCE(tf.feature_instance_id::text, ti.information_instance_id::text) AS target_id,
          COALESCE(am.target_feature_record_id::text, am.target_information_record_id::text) AS target_record_id
        FROM canonical.association a
        LEFT JOIN canonical.association_member am ON am.association_id = a.association_id
        LEFT JOIN canonical.feature_record tf ON tf.feature_record_id = am.target_feature_record_id
        LEFT JOIN canonical.information_record ti ON ti.information_record_id = am.target_information_record_id
        WHERE a.source_feature_record_id = $1
        ORDER BY a.association_id, am.member_ordinal
        `,
        [row.feature_record_id]
      ),
      query<{
        spatial_reference_id: string;
        spatial_record_id: string;
        spatial_type: string;
        rcnm: number;
        rcid: number;
        rver: number;
        ruin: number;
        rrnm: number;
        rrid: number;
        orientation: number | null;
        smin: number | null;
        smax: number | null;
        geometry_type: string | null;
        srid: number | null;
        bbox: unknown;
        topology: string;
      }>(
        `
        SELECT
          sref.spatial_reference_id::text,
          sr.spatial_record_id::text,
          sr.spatial_type,
          sr.rcnm,
          sr.rcid,
          sr.rver,
          sr.ruin,
          sref.rrnm,
          sref.rrid,
          sref.ornt AS orientation,
          sref.smin,
          sref.smax,
          CASE WHEN sr.derived_geometry IS NULL THEN NULL ELSE GeometryType(sr.derived_geometry) END AS geometry_type,
          CASE WHEN sr.derived_geometry IS NULL THEN NULL ELSE ST_SRID(sr.derived_geometry) END AS srid,
          CASE WHEN sr.derived_geometry IS NULL THEN NULL ELSE ST_AsGeoJSON(ST_Envelope(sr.derived_geometry))::jsonb END AS bbox,
          CASE
            WHEN sr.dataset_version_id <> $2 THEN 'cross-version'
            WHEN sr.derived_geometry IS NULL THEN 'null geometry'
            WHEN NOT ST_IsValid(sr.derived_geometry) THEN 'invalid geometry'
            ELSE 'ok'
          END AS topology
        FROM canonical.spatial_reference sref
        JOIN canonical.spatial_record sr ON sr.spatial_record_id = sref.spatial_record_id
        WHERE sref.feature_record_id = $1
        ORDER BY sref.ordinal
        `,
        [row.feature_record_id, row.dataset_version_id]
      ),
      query<{
        raw_record_id: string;
        exchange_resource_id: string;
        record_ordinal: number;
        byte_offset: string;
        record_length: number;
        field_tag: string | null;
        raw_payload_hash: string | null;
        decode_status: string;
      }>(
        `
        SELECT
          rr.raw_record_id::text,
          rr.exchange_resource_id::text,
          rr.record_ordinal,
          rr.byte_offset::text,
          rr.record_length,
          rr.field_tag,
          rr.raw_payload_hash,
          rr.decode_status
        FROM canonical.feature_record fr
        JOIN raw.raw_record rr ON rr.raw_record_id = fr.raw_record_id
        WHERE fr.feature_record_id = $1
        `,
        [row.feature_record_id]
      ),
      query<{
        validation_issue_id: string;
        rule_id: string;
        severity: string;
        target_schema: string | null;
        target_table: string | null;
        target_id: string | null;
        field_locator: string | null;
        message: string;
      }>(
        `
        SELECT
          vi.validation_issue_id::text,
          vi.rule_id,
          vi.severity,
          vi.target_schema,
          vi.target_table,
          vi.target_id::text,
          vi.field_locator,
          vi.message
        FROM canonical.feature_record fr
        JOIN validation.conformance_status cs ON cs.dataset_version_id = fr.dataset_version_id
        JOIN validation.validation_issue vi ON vi.validation_run_id = cs.validation_run_id
        WHERE fr.feature_record_id = $1
          AND (
            vi.raw_record_id = fr.raw_record_id
            OR (vi.target_schema = 'canonical' AND vi.target_table = 'feature_record' AND vi.target_id = fr.feature_record_id)
            OR (vi.target_schema = 'canonical' AND vi.target_table = 'feature_instance' AND vi.target_id = fr.feature_instance_id)
          )
        ORDER BY
          CASE vi.severity WHEN 'fatal' THEN 1 WHEN 'error' THEN 2 WHEN 'warning' THEN 3 ELSE 4 END,
          vi.validation_issue_id
        LIMIT 100
        `,
        [row.feature_record_id]
      )
    ]);
    const detail: FeatureDetail = {
      featureInstanceId: row.feature_instance_id,
      datasetId: row.dataset_id,
      datasetVersionId: row.dataset_version_id,
      featureRecordId: row.feature_record_id,
      catalogueSnapshotId: getFeatureCatalogueSnapshotId(),
      featureName: resolveFeatureName({ featureTypeCode: row.feature_type_code }),
      featureTypeCode: row.feature_type_code,
      foid: { agen: row.foid_agen, fidn: row.foid_fidn, fids: row.foid_fids },
      rcid: row.rcid,
      rver: row.rver,
      ruin: row.ruin,
      dataset: {
        dsnm: row.dsnm,
        editionNumber: row.edition_number,
        updateNumber: row.update_number
      },
      lifecycleStatus: row.lifecycle_status,
      attributes: row.attributes,
      simpleAttributes: simpleAttributes.rows.map((attribute) => ({
        id: attribute.id,
        code: attribute.code,
        name: attribute.name ?? attributeNameByCode(attribute.code),
        atix: attribute.atix,
        paix: attribute.paix,
        atin: attribute.atin,
        valueType: attribute.value_type === "Unknown" ? null : attribute.value_type,
        value: attribute.value,
        rawValue: attribute.raw_value
      })),
      complexAttributes: complexAttributes.rows.map((attribute) => ({
        id: attribute.id,
        code: attribute.code,
        name: attribute.name ?? attributeNameByCode(attribute.code),
        atix: attribute.atix,
        paix: attribute.paix,
        occurrenceOrdinal: attribute.occurrence_ordinal
      })),
      associations: associations.rows.map((association) => ({
        associationId: association.association_id,
        associationType: association.association_type,
        sourceField: association.source_field,
        role: association.role,
        targetType: association.target_type,
        targetId: association.target_id,
        targetRecordId: association.target_record_id
      })),
      spatial: spatial.rows.map((item) => ({
        spatialReferenceId: item.spatial_reference_id,
        spatialRecordId: item.spatial_record_id,
        spatialType: item.spatial_type,
        rcnm: item.rcnm,
        rcid: item.rcid,
        rver: item.rver,
        ruin: item.ruin,
        rrnm: item.rrnm,
        rrid: item.rrid,
        orientation: item.orientation,
        minScale: item.smin,
        maxScale: item.smax,
        geometryType: item.geometry_type,
        srid: item.srid,
        bbox: item.bbox,
        topology: item.topology
      })),
      rawRecord: rawRecord.rows[0]
        ? {
            rawRecordId: rawRecord.rows[0].raw_record_id,
            exchangeResourceId: rawRecord.rows[0].exchange_resource_id,
            recordOrdinal: rawRecord.rows[0].record_ordinal,
            byteOffset: rawRecord.rows[0].byte_offset,
            recordLength: rawRecord.rows[0].record_length,
            fieldTag: rawRecord.rows[0].field_tag,
            rawPayloadHash: rawRecord.rows[0].raw_payload_hash,
            decodeStatus: rawRecord.rows[0].decode_status
          }
        : null,
      validationIssues: validationIssues.rows.map((issue) => ({
        validationIssueId: issue.validation_issue_id,
        ruleId: issue.rule_id,
        severity: issue.severity,
        targetSchema: issue.target_schema,
        targetTable: issue.target_table,
        targetId: issue.target_id,
        fieldLocator: issue.field_locator,
        message: issue.message
      })),
      geometryType: row.geometry_type
    };
    return detail;
  });

  app.get("/api/qa/summary", async (request) => {
    const parsed = qaQuerySchema.parse(request.query);
    const result = await query<QaSummary>(
      `
      WITH sr AS MATERIALIZED (
        SELECT spatial_record_id, spatial_type, derived_geometry
        FROM canonical.spatial_record
        WHERE dataset_version_id = $2
      ),
      null_classified AS (
        SELECT sr.spatial_record_id,
          CASE WHEN (
            sr.spatial_type IN ('point', 'multi_point')
            AND NOT EXISTS (SELECT 1 FROM canonical.coordinate c WHERE c.spatial_record_id = sr.spatial_record_id)
          ) OR (
            sr.spatial_type = 'curve'
            AND NOT EXISTS (SELECT 1 FROM canonical.coordinate c WHERE c.spatial_record_id = sr.spatial_record_id HAVING COUNT(*) >= 2)
            AND NOT EXISTS (
              SELECT 1
              FROM canonical.curve_segment cs
              JOIN canonical.spatial_record start_sr ON start_sr.spatial_record_id = cs.start_point_record_id
              JOIN canonical.spatial_record end_sr ON end_sr.spatial_record_id = cs.end_point_record_id
              WHERE cs.spatial_record_id = sr.spatial_record_id
                AND start_sr.derived_geometry IS NOT NULL
                AND end_sr.derived_geometry IS NOT NULL
                AND NOT ST_Equals(start_sr.derived_geometry, end_sr.derived_geometry)
            )
          ) OR (
            sr.spatial_type IN ('surface', 'composite_curve')
            AND NOT EXISTS (
              SELECT 1
              FROM canonical.surface_boundary sb
              JOIN canonical.spatial_record boundary ON boundary.spatial_record_id = sb.referenced_spatial_record_id
              WHERE sb.surface_record_id = sr.spatial_record_id
                AND boundary.derived_geometry IS NOT NULL
            )
          ) OR (
            sr.spatial_type = 'surface'
            AND (
              SELECT COUNT(*)::int
              FROM canonical.surface_boundary sb
              JOIN canonical.spatial_record boundary ON boundary.spatial_record_id = sb.referenced_spatial_record_id
              WHERE sb.surface_record_id = sr.spatial_record_id
                AND boundary.derived_geometry IS NOT NULL
            ) <= 1
            AND NOT EXISTS (
              SELECT 1
              FROM canonical.surface_boundary sb
              JOIN canonical.spatial_record boundary ON boundary.spatial_record_id = sb.referenced_spatial_record_id
              WHERE sb.surface_record_id = sr.spatial_record_id
                AND boundary.derived_geometry IS NOT NULL
                AND ST_IsClosed(boundary.derived_geometry)
            )
          ) THEN 1 ELSE 0 END AS no_source
        FROM sr
        WHERE sr.derived_geometry IS NULL
      )
      SELECT
        (SELECT COUNT(*)::int FROM canonical.feature_record WHERE dataset_version_id = $2 AND feature_instance_id IS NULL) AS "featureRecordWithoutInstance",
        (SELECT COUNT(*)::int FROM canonical.information_record WHERE dataset_version_id = $2 AND information_instance_id IS NULL) AS "informationRecordWithoutInstance",
        (SELECT COUNT(*)::int
         FROM canonical.feature_attribute_value av
         LEFT JOIN canonical.feature_record fr ON fr.feature_record_id = av.feature_record_id
         LEFT JOIN canonical.information_record ir ON ir.information_record_id = av.information_record_id
         WHERE (fr.dataset_version_id = $2 OR ir.dataset_version_id = $2)
           AND ((av.feature_record_id IS NOT NULL AND fr.feature_record_id IS NULL)
             OR (av.information_record_id IS NOT NULL AND ir.information_record_id IS NULL))) AS "attributeOwnerMissing",
        (SELECT COUNT(*)::int
         FROM canonical.complex_attribute_instance ca
         LEFT JOIN canonical.feature_record fr ON fr.feature_record_id = ca.feature_record_id
         LEFT JOIN canonical.information_record ir ON ir.information_record_id = ca.information_record_id
         WHERE (fr.dataset_version_id = $2 OR ir.dataset_version_id = $2)
           AND ((ca.feature_record_id IS NOT NULL AND fr.feature_record_id IS NULL)
             OR (ca.information_record_id IS NOT NULL AND ir.information_record_id IS NULL))) AS "complexAttributeOwnerMissing",
        (SELECT COUNT(*)::int
         FROM canonical.association a
         LEFT JOIN canonical.feature_record fr ON fr.feature_record_id = a.source_feature_record_id
         LEFT JOIN canonical.information_record ir ON ir.information_record_id = a.source_information_record_id
         WHERE a.dataset_version_id = $2
           AND ((a.source_feature_record_id IS NOT NULL AND fr.feature_record_id IS NULL)
             OR (a.source_information_record_id IS NOT NULL AND ir.information_record_id IS NULL))) AS "associationSourceMissing",
        (SELECT COUNT(*)::int
         FROM canonical.association_member am
         JOIN canonical.association a ON a.association_id = am.association_id
         LEFT JOIN canonical.feature_record fr ON fr.feature_record_id = am.target_feature_record_id
         LEFT JOIN canonical.information_record ir ON ir.information_record_id = am.target_information_record_id
         WHERE a.dataset_version_id = $2
           AND ((am.target_feature_record_id IS NOT NULL AND fr.feature_record_id IS NULL)
             OR (am.target_information_record_id IS NOT NULL AND ir.information_record_id IS NULL))) AS "associationTargetMissing",
        (SELECT COUNT(*)::int FROM canonical.spatial_reference sref JOIN canonical.feature_record fr ON fr.feature_record_id = sref.feature_record_id JOIN canonical.spatial_record srt ON srt.spatial_record_id = sref.spatial_record_id WHERE fr.dataset_version_id = $2 AND srt.dataset_version_id <> fr.dataset_version_id) AS "spatialReferenceCrossVersion",
        (SELECT COUNT(*)::int FROM canonical.curve_segment cs JOIN canonical.spatial_record curve ON curve.spatial_record_id = cs.spatial_record_id LEFT JOIN canonical.spatial_record start_sr ON start_sr.spatial_record_id = cs.start_point_record_id LEFT JOIN canonical.spatial_record end_sr ON end_sr.spatial_record_id = cs.end_point_record_id WHERE curve.dataset_version_id = $2 AND ((start_sr.spatial_record_id IS NOT NULL AND start_sr.dataset_version_id <> curve.dataset_version_id) OR (end_sr.spatial_record_id IS NOT NULL AND end_sr.dataset_version_id <> curve.dataset_version_id))) AS "curveEndpointCrossVersion",
        (SELECT COUNT(*)::int FROM canonical.surface_boundary sb JOIN canonical.spatial_record surface ON surface.spatial_record_id = sb.surface_record_id JOIN canonical.spatial_record boundary ON boundary.spatial_record_id = sb.referenced_spatial_record_id WHERE surface.dataset_version_id = $2 AND boundary.dataset_version_id <> surface.dataset_version_id) AS "surfaceBoundaryCrossVersion",
        (SELECT COUNT(*)::int FROM sr WHERE derived_geometry IS NOT NULL AND NOT ST_IsValid(derived_geometry)) AS "invalidGeometry",
        (SELECT COUNT(*)::int FROM sr WHERE derived_geometry IS NULL) AS "nullGeometry",
        (SELECT COALESCE(SUM(no_source), 0)::int FROM null_classified) AS "nullNoSourceData",
        (SELECT COUNT(*)::int - COALESCE(SUM(no_source), 0)::int FROM null_classified) AS "nullInvalidTopology",
        (SELECT COUNT(*)::int FROM canonical.feature_record WHERE dataset_version_id = $2) AS "canonicalFeatureCount",
        (SELECT COUNT(*)::int FROM projection.s101_feature_current WHERE dataset_id = $1 AND dataset_version_id = $2) AS "projectedFeatures",
        (SELECT COUNT(*)::int FROM projection.s101_feature_geojson WHERE dataset_id = $1) AS "geoJsonRows",
        (SELECT COUNT(*)::int FROM projection.s101_feature_current fc LEFT JOIN projection.s101_feature_geojson gj ON gj.feature_instance_id = fc.feature_instance_id WHERE fc.dataset_id = $1 AND fc.dataset_version_id = $2 AND gj.feature_instance_id IS NULL) AS "missingGeoJson",
        (SELECT COUNT(*)::int
         FROM validation.conformance_status cs
         JOIN validation.validation_issue vi ON vi.validation_run_id = cs.validation_run_id
         WHERE cs.dataset_version_id = $2
           AND lower(vi.severity) = 'fatal') AS "validationCritical",
        (SELECT COUNT(*)::int
         FROM validation.conformance_status cs
         JOIN validation.validation_issue vi ON vi.validation_run_id = cs.validation_run_id
         WHERE cs.dataset_version_id = $2
           AND lower(vi.severity) = 'error') AS "validationError",
        (SELECT COUNT(*)::int
         FROM validation.conformance_status cs
         JOIN validation.validation_issue vi ON vi.validation_run_id = cs.validation_run_id
         WHERE cs.dataset_version_id = $2
           AND lower(vi.severity) = 'warning') AS "validationWarning",
        (SELECT COUNT(*)::int
         FROM validation.conformance_status cs
         JOIN validation.validation_issue vi ON vi.validation_run_id = cs.validation_run_id
         WHERE cs.dataset_version_id = $2
           AND lower(vi.severity) IN ('critical', 'error', 'fatal')) AS "blockingValidationIssues"
      `,
      [parsed.datasetId, parsed.datasetVersionId]
    );
    return result.rows[0];
  });
}

async function getCatalogueStatus(): Promise<CatalogueRuntimeStatus> {
  const featurePath = getFeatureCataloguePath();
  const featureStat = featurePath && existsSync(featurePath) ? statSync(featurePath) : null;
  const featureSnapshot =
    featurePath && featureStat
      ? {
          catalogueSnapshotId: `fc-${createHash("sha256").update(featurePath).digest("hex").slice(0, 12)}`,
          productId: "S-101",
          catalogueType: "feature" as const,
          version: featureCatalogueVersion ?? "2.0.0",
          hashAlgorithm: "SHA-256" as const,
          hash: createHash("sha256").update(readFileSync(featurePath)).digest("hex"),
          sourcePath: basename(featurePath),
          loadedAt: new Date(featureStat.mtimeMs).toISOString()
        }
      : null;

  const portrayalPath = getPortrayalCatalogueRoot();
  const portrayalStat = portrayalPath && existsSync(portrayalPath) ? statSync(portrayalPath) : null;
  const portrayalSnapshot =
    portrayalPath && portrayalStat
      ? {
          catalogueSnapshotId: `pc-${createHash("sha256").update(portrayalPath).digest("hex").slice(0, 12)}`,
          productId: "S-101",
          catalogueType: "portrayal" as const,
          version: portrayalCatalogueVersion ?? "2.0.0",
          hashAlgorithm: "SHA-256" as const,
          hash: createHash("sha256").update(`${portrayalPath}:${portrayalStat.mtimeMs}:${portrayalStat.size}`).digest("hex"),
          sourcePath: basename(portrayalPath),
          loadedAt: new Date(portrayalStat.mtimeMs).toISOString()
        }
      : null;
  return {
    featureCatalogue: featureSnapshot,
    portrayalCatalogue: portrayalSnapshot,
    cacheReady: true,
    catalogueMismatch: false,
    portrayalMode: getPortrayalMode(),
    warning:
      featureSnapshot && portrayalSnapshot && getLuaRuntimePath()
        ? null
        : "Feature/Portrayal Catalogue 또는 LUA_RUNTIME_PATH 설정이 완전하지 않아 fallback 정보가 섞일 수 있습니다."
  };
}

function getLuaRuntimePath(): string | null {
  const configuredPath = process.env.LUA_RUNTIME_PATH ? resolve(process.env.LUA_RUNTIME_PATH) : null;
  return configuredPath && existsSync(configuredPath) ? configuredPath : null;
}

function getPortrayalMode(): "fallback" | "mvp-symbol" | "lua" {
  if (getLuaRuntimePath()) return "lua";
  return getPortrayalCatalogueRoot() ? "mvp-symbol" : "fallback";
}

function getPortrayalRuleFiles(): string[] {
  const catalogueRoot = getPortrayalCatalogueRoot();
  if (portrayalRuleCache?.catalogueRoot === catalogueRoot) {
    return portrayalRuleCache.files;
  }

  const rulesRoot = catalogueRoot ? join(catalogueRoot, "Rules") : null;
  const files =
    rulesRoot && existsSync(rulesRoot)
      ? readdirSync(rulesRoot)
          .filter((fileName) => fileName.toLowerCase().endsWith(".lua"))
          .sort((left, right) => left.localeCompare(right))
      : [];
  portrayalRuleCache = { catalogueRoot, files };
  return files;
}

async function checkDatabaseHealth(): Promise<"ok" | "error"> {
  try {
    await query("SELECT 1");
    return "ok";
  } catch {
    return "error";
  }
}

async function checkProjectionHealth(): Promise<"ok" | "error"> {
  try {
    await query("SELECT 1 FROM projection.s101_dataset_current LIMIT 1");
    return "ok";
  } catch {
    return "error";
  }
}

type ApiFeature = {
  type: "Feature";
  id: string;
  geometry: unknown;
  properties: Record<string, unknown>;
};

type LuaInstructionPayload = {
  rawInstructions: string[];
  trace: string[];
};

async function createLuaDrawingInstructions(features: ApiFeature[]): Promise<Map<string, LuaInstructionPayload>> {
  const cached = new Map<string, LuaInstructionPayload>();
  const missingFeatures: ApiFeature[] = [];
  for (const feature of features) {
    if (luaInstructionCache.has(feature.id)) {
      const payload = luaInstructionCache.get(feature.id);
      if (payload) {
        cached.set(feature.id, payload);
      }
    } else {
      missingFeatures.push(feature);
    }
  }
  if (missingFeatures.length === 0) {
    return cached;
  }

  const luaRuntimePath = getLuaRuntimePath();
  const catalogueRoot = getPortrayalCatalogueRoot();
  if (!luaRuntimePath || !catalogueRoot) {
    for (const feature of missingFeatures) {
      luaInstructionCache.set(feature.id, null);
    }
    return cached;
  }

  try {
    const runtime = new ExternalLuaPortrayalRuntime({
      luaRuntimePath,
      catalogueRoot,
      timeoutMs: Number(process.env.LUA_TIMEOUT_MS ?? 20_000)
    });
    const luaFeatures = missingFeatures.map((feature) => ({
      featureInstanceId: feature.id,
      featureTypeCode: Number(feature.properties.featureTypeCode ?? 0),
      featureCode: resolveFeatureName(feature.properties),
      featurePrimitive: getFeaturePrimitiveByCode().get(Number(feature.properties.featureTypeCode ?? 0)) ?? null,
      geometryType: geometryTypeName(feature.geometry),
      geometry: feature.geometry,
      attributes: createLuaAttributeMap(feature.properties)
    }));
    const results = [];
    const configuredChunkSize = Number(process.env.LUA_FEATURE_BATCH_SIZE ?? 200);
    const chunkSize = Number.isFinite(configuredChunkSize) && configuredChunkSize > 0 ? configuredChunkSize : 200;
    for (let index = 0; index < luaFeatures.length; index += chunkSize) {
      const chunk = luaFeatures.slice(index, index + chunkSize);
      results.push(
        ...(await runtime.executeBatch(chunk, {
          catalogueSnapshotId: "S-101-2.0.0",
          scaleDenominator: null,
          displayMode: "day",
          viewingGroups: []
        }))
      );
    }
    const fresh = new Map(
      results.map((result) => [
        result.featureReference,
        { rawInstructions: result.rawInstructions, trace: result.trace }
      ] satisfies [string, LuaInstructionPayload])
    );
    for (const feature of missingFeatures) {
      const payload = fresh.get(feature.id) ?? null;
      luaInstructionCache.set(feature.id, payload);
      if (payload) {
        cached.set(feature.id, payload);
      }
    }
    return cached;
  } catch (error) {
    console.warn("S-101 Lua portrayal runtime failed; using fallback DrawingInstruction.", error);
    for (const feature of missingFeatures) {
      luaInstructionCache.set(feature.id, null);
    }
    return cached;
  }
}

function createFeaturePortrayalProperties(properties: Record<string, unknown>, luaPayload: LuaInstructionPayload | null): Record<string, unknown> {
  const noDepthWreckFallback = shouldApplyNoDepthWreckFallback(properties, luaPayload);
  const rawInstructions = noDepthWreckFallback
    ? ["ViewingGroup:34050;DrawingPriority:12;DisplayPlane:UnderRadar;PointInstruction:WRECKS05"]
    : luaPayload?.rawInstructions ?? createFallbackDrawingInstructionText(properties);
  const drawingInstructions: PortrayalDrawingInstruction[] = parseDrawingInstructionText(rawInstructions).map((instruction) => ({
    raw: instruction.raw,
    tokens: instruction.tokens,
    instructionType: instruction.instructionType,
    viewingGroup: instruction.viewingGroup,
    drawingPriority: instruction.priority,
    displayPlane: instruction.displayPlane,
    symbolRef: instruction.symbolRef,
    lineStyleRef: instruction.lineStyleRef,
    areaFillRef: instruction.areaFillRef,
    colorFill: instruction.colorFill,
    text: instruction.text
  }));

  return {
    portrayalRuleName: resolveFeatureName(properties) || null,
    portrayalInstructionSource: noDepthWreckFallback ? "lua-host-fallback" : luaPayload ? "lua" : "mvp-fallback",
    portrayalLuaTrace: noDepthWreckFallback ? [] : luaPayload?.trace ?? [],
    portrayalDrawingInstructionText: rawInstructions,
    portrayalDrawingInstructions: drawingInstructions,
    portrayalSymbolRef: resolvePointSymbolRef(drawingInstructions),
    portrayalLineStyleRef: resolveLineStyleRef(drawingInstructions),
    portrayalLineColor: resolveLineColor(drawingInstructions),
    portrayalAreaFillRef: resolveAreaFillRef(drawingInstructions),
    portrayalColorFill: resolveColorFill(drawingInstructions),
    portrayalDisplayClass: resolveDisplayClass(properties),
    portrayalMinStage: resolveMvpMinStage(properties)
  };
}

function shouldApplyNoDepthWreckFallback(properties: Record<string, unknown>, luaPayload: LuaInstructionPayload | null): boolean {
  return (
    resolveFeatureName(properties) === "Wreck" &&
    !!luaPayload?.trace?.some((item) => item.includes("Neither valueOfSounding or defaultClearanceDepth have a value"))
  );
}

function createLuaAttributeMap(properties: Record<string, unknown>): Record<string, unknown> {
  const attributes: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (key.startsWith("portrayal_")) continue;
    if (key === "attributes") continue;
    attributes[key] = value;
  }

  if (Array.isArray(properties.attributes)) {
    const attributeRecords = properties.attributes
      .filter((attribute): attribute is Record<string, unknown> => !!attribute && typeof attribute === "object")
      .map((record) => ({
        record,
        name: String(record.name ?? attributeNameByCode(Number(record.natc)) ?? ""),
        valueType: String(record.valueType ?? ""),
        ordinal: Number(record.attributeOrdinal ?? record.attribute_ordinal ?? record.atix ?? 0),
        atix: Number(record.atix ?? 0),
        paix: Number(record.paix ?? 0)
      }));
    const parentOrdinals = new Set(attributeRecords.filter((item) => item.paix > 0).map((item) => item.paix));
    const nodesByOrdinal = new Map<number, Record<string, unknown>>();
    const roots: Record<string, Array<Record<string, unknown>>> = {};
    const addValue = (target: Record<string, unknown>, name: string, value: unknown) => {
      if (!name || value === null || value === undefined) return;
      if (target[name] === undefined) {
        target[name] = value;
      } else if (Array.isArray(target[name])) {
        (target[name] as unknown[]).push(value);
      } else {
        target[name] = [target[name], value];
      }
    };
    const addComplex = (target: Record<string, unknown>, name: string, node: Record<string, unknown>) => {
      if (!name) return;
      if (!target[name]) target[name] = [];
      (target[name] as Array<Record<string, unknown>>).push(node);
    };

    for (const item of attributeRecords) {
      if (!item.name || item.ordinal <= 0) continue;
      if (!parentOrdinals.has(item.ordinal) && item.valueType.toLowerCase() !== "complex") continue;
      nodesByOrdinal.set(item.ordinal, { simpleAttributes: {}, complexAttributes: {} });
    }

    for (const item of attributeRecords) {
      if (!item.name) continue;
      const isComplex = item.valueType.toLowerCase() === "complex";
      const value =
        item.record.valueInteger ??
        item.record.valueNumeric ??
        item.record.valueText ??
        item.record.valueDate ??
        item.record.rawValue;
      const parent = item.paix > 0 ? nodesByOrdinal.get(item.paix) : null;
      if (parent) {
        if (isComplex && item.ordinal > 0 && nodesByOrdinal.has(item.ordinal)) {
          addComplex(
            parent.complexAttributes as Record<string, unknown>,
            item.name,
            nodesByOrdinal.get(item.ordinal) as Record<string, unknown>
          );
        } else {
          addValue(parent.simpleAttributes as Record<string, unknown>, item.name, value);
        }
        continue;
      }
      if (isComplex && item.ordinal > 0 && nodesByOrdinal.has(item.ordinal)) {
        addComplex(roots, item.name, nodesByOrdinal.get(item.ordinal) as Record<string, unknown>);
        continue;
      }
      addValue(attributes, item.name, value);
    }

    if (Object.keys(roots).length > 0) {
      attributes.__complexAttributes = roots;
    }
  }
  return attributes;
}

function attributeNameByCode(code: number): string | null {
  const catalogueName = getAttributeNameByCode().get(code);
  if (catalogueName) return catalogueName;

  const fallbackNames: Record<number, string> = {
    2: "beaconShape",
    6: "buoyShape",
    14: "categoryOfCardinalMark",
    36: "categoryOfLight",
    75: "colour",
    107: "featureName",
    110: "fixedDateRange",
    140: "periodicDateRange",
    151: "restriction",
    174: "valueOfDepthContour",
    179: "verticalLength"
  };
  return fallbackNames[code] ?? null;
}

function geometryTypeName(geometry: unknown): string | null {
  if (!geometry || typeof geometry !== "object") return null;
  const type = (geometry as Record<string, unknown>).type;
  return typeof type === "string" ? type : null;
}

function createFallbackDrawingInstructionText(properties: Record<string, unknown>): string[] {
  const featureName = resolveFeatureName(properties);
  const symbolRef = resolveMvpSymbolRef(properties);
  const viewingGroup = resolveMvpViewingGroup(featureName);
  const drawingPriority = resolveMvpDrawingPriority(featureName);
  const displayPlane = resolveMvpDisplayPlane(featureName);
  const prefix = `ViewingGroup:${viewingGroup};DrawingPriority:${drawingPriority};DisplayPlane:${displayPlane}`;

  if (symbolRef) {
    return [`${prefix};PointInstruction:${symbolRef}`];
  }
  if (["DepthArea", "DredgedArea"].includes(featureName)) {
    return [`${prefix};ColorFill:DEPVS`];
  }
  if (["LandArea", "BuiltUpArea", "DockArea", "DryDock", "FloatingDock", "ShorelineConstruction", "Causeway"].includes(featureName)) {
    return [`${prefix};ColorFill:UIAFF`];
  }
  if (["DepthContour", "Coastline", "ShorelineConstruction"].includes(featureName)) {
    return [`${prefix};LineInstruction:_simple_`];
  }
  return [`${prefix};NullInstruction`];
}

function resolvePointSymbolRef(instructions: PortrayalDrawingInstruction[]): string | null {
  return instructions.find((instruction) => instruction.instructionType === "point" && instruction.symbolRef)?.symbolRef ?? null;
}

function resolveLineStyleRef(instructions: PortrayalDrawingInstruction[]): string | null {
  return instructions.find((instruction) => instruction.instructionType === "line" && instruction.lineStyleRef)?.lineStyleRef ?? null;
}

function resolveLineColor(instructions: PortrayalDrawingInstruction[]): string | null {
  for (const instruction of [...instructions].reverse()) {
    const lineStyle = instruction.tokens.LineStyle;
    if (typeof lineStyle !== "string") continue;
    const parts = lineStyle.split(",").map((part) => part.trim());
    for (let index = parts.length - 1; index >= 0; index -= 1) {
      const color = parts[index];
      if (/^CH[A-Z0-9]{3}$|^DEP[A-Z0-9]{2}$|^RES[A-Z0-9]{2}$/.test(color)) return color;
    }
  }
  return null;
}

function resolveAreaFillRef(instructions: PortrayalDrawingInstruction[]): string | null {
  return [...instructions].reverse().find((instruction) => instruction.instructionType === "area" && instruction.areaFillRef)?.areaFillRef ?? null;
}

function resolveColorFill(instructions: PortrayalDrawingInstruction[]): string | null {
  return [...instructions].reverse().find((instruction) => instruction.instructionType === "area" && instruction.colorFill)?.colorFill ?? null;
}

function resolveMvpViewingGroup(featureName: string): number {
  if (["DepthArea", "DredgedArea"].includes(featureName)) return 13030;
  if (["Wreck", "Obstruction", "UnderwaterAwashRock"].includes(featureName)) return 34050;
  if (["LightAllAround", "LightSectored"].includes(featureName)) return 27010;
  if (featureName.includes("Buoy") || featureName.includes("Beacon")) return 27020;
  return 21010;
}

function resolveMvpDrawingPriority(featureName: string): number {
  if (["DepthArea", "DredgedArea"].includes(featureName)) return 3;
  if (["Wreck", "Obstruction", "UnderwaterAwashRock"].includes(featureName)) return 12;
  if (featureName.includes("Buoy") || featureName.includes("Beacon") || featureName.includes("Light")) return 18;
  return 9;
}

function resolveMvpDisplayPlane(featureName: string): "UnderRadar" | "OverRadar" {
  if (featureName.includes("Buoy") || featureName.includes("Beacon") || featureName.includes("Light")) return "OverRadar";
  return "UnderRadar";
}

function resolveMvpSymbolRef(properties: Record<string, unknown>): string | null {
  const featureName = resolveFeatureName(properties);
  const colour = propertyNumber(properties, ["portrayal_colour_1", "colour"], 75);
  const buoyShape = propertyNumber(properties, ["portrayal_buoy_shape", "buoyShape"], 6);
  const beaconShape = propertyNumber(properties, ["portrayal_beacon_shape", "beaconShape"], 2);
  const category = propertyNumber(properties, ["portrayal_cardinal_category", "categoryOfCardinalMark"], 14);
  const lightCategory = propertyNumber(properties, ["portrayal_light_category", "categoryOfLight"], 36);

  if (featureName === "CardinalBuoy" || featureName === "BuoyCardinal") return cardinalSymbol("BOYCAR", category, "BOYDEF03");
  if (featureName === "LateralBuoy" || featureName === "BuoyLateral") {
    if (colour === 3) return buoyShape === 1 ? "BOYLAT14" : "BOYLAT24";
    if (colour === 4) return buoyShape === 1 ? "BOYLAT13" : "BOYLAT23";
    return "BOYDEF03";
  }
  if (featureName === "SafeWaterBuoy" || featureName === "BuoySafeWater") return "BOYSAW12";
  if (featureName === "SpecialPurposeGeneralBuoy" || featureName === "BuoySpecialPurposeGeneral") return "BOYSPP15";
  if (featureName === "CardinalBeacon" || featureName === "BeaconCardinal") return cardinalSymbol("BCNCAR", category, "BCNDEF13");
  if (featureName === "LateralBeacon" || featureName === "BeaconLateral") {
    if (colour === 3) return [3, 5].includes(beaconShape) ? "BCNLAT15" : "BCNLAT21";
    if (colour === 4) return [3, 5].includes(beaconShape) ? "BCNLAT16" : "BCNLAT22";
    return "BCNDEF13";
  }
  if (featureName === "SafeWaterBeacon" || featureName === "BeaconSafeWater") return "BCNSAW21";
  if (featureName === "SpecialPurposeGeneralBeacon" || featureName === "BeaconSpecialPurposeGeneral") return "BCNSPP13";
  if (featureName === "LightAllAround" || featureName === "LightSectored") {
    if ([8, 11].includes(lightCategory)) return "LIGHTS82";
    if (lightCategory === 9) return "LIGHTS81";
    if (colour === 3) return "LIGHTS11";
    if (colour === 4) return "LIGHTS12";
    return "LIGHTS13";
  }
  if (featureName === "Wreck") return "WRECKS01";
  if (featureName === "Obstruction") return "OBSTRN01";
  if (featureName === "UnderwaterAwashRock") return "UWTROC03";
  return null;
}

function getPortrayalCatalogueRoot(): string | null {
  const configuredPath = process.env.PORTRAYAL_CATALOGUE_PATH ? resolve(process.env.PORTRAYAL_CATALOGUE_PATH) : null;
  if (configuredPath && existsSync(configuredPath)) return configuredPath;
  const discovered = findFirstCatalogueFile((filePath) => basename(filePath).toLowerCase() === "portrayal_catalogue.xml");
  if (discovered) return dirname(discovered);
  return null;
}

function getFeatureCataloguePath(): string | null {
  const configuredPath = process.env.FEATURE_CATALOGUE_PATH ? resolve(process.env.FEATURE_CATALOGUE_PATH) : null;
  if (configuredPath && existsSync(configuredPath)) return configuredPath;
  return findFirstCatalogueFile((filePath) => /^101_Feature_Catalogue.*\.xml$/i.test(basename(filePath)));
}

function findFirstCatalogueFile(predicate: (filePath: string) => boolean): string | null {
  for (const root of catalogueSearchRoots()) {
    const found = findFirstFile(root, predicate, 10);
    if (found) return found;
  }
  return null;
}

function catalogueSearchRoots(): string[] {
  const candidates = [
    process.env.S100_CATALOGUE_ROOT,
    process.env.S100_PARSER_ROOT,
    "D:\\dev\\s100-parser",
    resolve(process.cwd(), "..", "s100-parser"),
    resolve(process.cwd(), "..", "..", "s100-parser"),
    resolve(process.cwd(), ".."),
    process.cwd()
  ].filter((value): value is string => !!value && existsSync(value));

  return [...new Set(candidates.map((value) => resolve(value)))];
}

function findFirstFile(root: string, predicate: (filePath: string) => boolean, maxDepth: number): string | null {
  if (maxDepth < 0) return null;

  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return null;
  }

  const fileMatches = entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(root, entry.name))
    .filter(predicate)
    .sort((left, right) => left.localeCompare(right));
  if (fileMatches[0]) return fileMatches[0];

  const directories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(root, entry.name))
    .filter((path) => !path.includes(`${join("node_modules")}`) && !path.includes(`${join(".git")}`))
    .sort((left, right) => left.localeCompare(right));

  for (const directory of directories) {
    const found = findFirstFile(directory, predicate, maxDepth - 1);
    if (found) return found;
  }
  return null;
}

function getFeatureCatalogueSnapshotId(): string | null {
  const featurePath = getFeatureCataloguePath();
  return featurePath ? `fc-${createHash("sha256").update(featurePath).digest("hex").slice(0, 12)}` : null;
}

function getFeatureNameByCode(): Map<number, string> {
  const cataloguePath = getFeatureCataloguePath();
  if (featureNameByCodeCache?.cataloguePath === cataloguePath) {
    return featureNameByCodeCache.names;
  }

  const names = new Map<number, string>();
  if (cataloguePath) {
    const xml = readFileSync(cataloguePath, "utf8");
    const sectionMatch = xml.match(/<S100FC:S100_FC_FeatureTypes\b[^>]*>([\s\S]*?)<\/S100FC:S100_FC_FeatureTypes>/);
    const section = sectionMatch?.[1] ?? "";
    const featurePattern = /<S100FC:S100_FC_FeatureType\b[^>]*>([\s\S]*?)<\/S100FC:S100_FC_FeatureType>/g;
    let match: RegExpExecArray | null;
    let sequence = 0;
    while ((match = featurePattern.exec(section)) !== null) {
      sequence += 1;
      const codeMatch = match[1].match(/<S100FC:code>([^<]+)<\/S100FC:code>/);
      const code = codeMatch?.[1]?.trim();
      if (code) names.set(sequence, code);
    }
  }
  featureNameByCodeCache = { cataloguePath, names };
  return names;
}

function getFeaturePrimitiveByCode(): Map<number, string> {
  const cataloguePath = getFeatureCataloguePath();
  if (featurePrimitiveByCodeCache?.cataloguePath === cataloguePath) {
    return featurePrimitiveByCodeCache.primitives;
  }

  const primitives = new Map<number, string>();
  if (cataloguePath) {
    const xml = readFileSync(cataloguePath, "utf8");
    const sectionMatch = xml.match(/<S100FC:S100_FC_FeatureTypes\b[^>]*>([\s\S]*?)<\/S100FC:S100_FC_FeatureTypes>/);
    const section = sectionMatch?.[1] ?? "";
    const featurePattern = /<S100FC:S100_FC_FeatureType\b[^>]*>([\s\S]*?)<\/S100FC:S100_FC_FeatureType>/g;
    let match: RegExpExecArray | null;
    let sequence = 0;
    while ((match = featurePattern.exec(section)) !== null) {
      sequence += 1;
      const primitiveValues = [...match[1].matchAll(/<S100FC:permittedPrimitives>([^<]+)<\/S100FC:permittedPrimitives>/g)]
        .map((primitiveMatch) => primitiveMatch[1]?.trim())
        .filter((value): value is string => !!value);
      if (primitiveValues.length > 0) primitives.set(sequence, primitiveValues.join(","));
    }
  }
  featurePrimitiveByCodeCache = { cataloguePath, primitives };
  return primitives;
}

function getAttributeNameByCode(): Map<number, string> {
  const cataloguePath = getFeatureCataloguePath();
  if (attributeNameByCodeCache?.cataloguePath === cataloguePath) {
    return attributeNameByCodeCache.names;
  }

  const names = new Map<number, string>();
  if (cataloguePath) {
    const xml = readFileSync(cataloguePath, "utf8");
    let sequence = 0;
    sequence = addCatalogueAttributeNames(xml, "S100_FC_SimpleAttributes", "S100_FC_SimpleAttribute", names, sequence);
    addCatalogueAttributeNames(xml, "S100_FC_ComplexAttributes", "S100_FC_ComplexAttribute", names, sequence);
  }
  attributeNameByCodeCache = { cataloguePath, names };
  return names;
}

function addCatalogueAttributeNames(
  xml: string,
  sectionName: string,
  itemName: string,
  names: Map<number, string>,
  startSequence: number
): number {
  const sectionMatch = xml.match(new RegExp(`<S100FC:${sectionName}\\b[^>]*>([\\s\\S]*?)<\\/S100FC:${sectionName}>`));
  const section = sectionMatch?.[1] ?? "";
  const attributePattern = new RegExp(`<S100FC:${itemName}\\b[^>]*>([\\s\\S]*?)<\\/S100FC:${itemName}>`, "g");
  let match: RegExpExecArray | null;
  let sequence = startSequence;
  while ((match = attributePattern.exec(section)) !== null) {
    sequence += 1;
    const codeMatch = match[1].match(/<S100FC:code>([^<]+)<\/S100FC:code>/);
    const code = codeMatch?.[1]?.trim();
    if (code) names.set(sequence, code);
  }
  return sequence;
}

function findCatalogueSymbolPath(symbolRef: string): string | null {
  const catalogueRoot = getPortrayalCatalogueRoot();
  if (!catalogueRoot) return null;
  const candidates = [
    join(catalogueRoot, "Symbols", `${symbolRef}.svg`),
    join(catalogueRoot, "symbols", `${symbolRef}.svg`),
    join(catalogueRoot, `${symbolRef}.svg`)
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function getPortrayalSymbolItems(): PortrayalSymbolCatalogItem[] {
  const catalogueRoot = getPortrayalCatalogueRoot();
  if (portrayalSymbolCache?.catalogueRoot === catalogueRoot) {
    return portrayalSymbolCache.items;
  }

  const items = catalogueRoot ? readCatalogueSymbolItems(catalogueRoot) : [];
  portrayalSymbolCache = {
    catalogueRoot,
    items:
      items.length > 0
        ? items
        : fallbackPortrayalSymbols.map((symbolRef) => ({
            symbolRef,
            description: getSymbolDescription(symbolRef),
            endpoint: `/api/portrayal/symbols/${symbolRef}.svg`,
            fileName: `${symbolRef}.svg`
          }))
  };
  return portrayalSymbolCache.items;
}

function readCatalogueSymbolItems(catalogueRoot: string): PortrayalSymbolCatalogItem[] {
  const symbolsRoot = join(catalogueRoot, "Symbols");
  if (!existsSync(symbolsRoot)) return [];

  const descriptions = readPortrayalCatalogueSymbolDescriptions(catalogueRoot);
  return readdirSync(symbolsRoot)
    .filter((fileName) => fileName.toLowerCase().endsWith(".svg"))
    .map((fileName) => {
      const symbolRef = fileName.replace(/\.svg$/i, "").toUpperCase();
      return {
        symbolRef,
        description: descriptions.get(symbolRef) ?? getSymbolDescription(symbolRef),
        endpoint: `/api/portrayal/symbols/${symbolRef}.svg`,
        fileName
      };
    })
    .sort((left, right) => left.symbolRef.localeCompare(right.symbolRef));
}

function readPortrayalCatalogueSymbolDescriptions(catalogueRoot: string): Map<string, string> {
  const cataloguePath = join(catalogueRoot, "portrayal_catalogue.xml");
  const descriptions = new Map<string, string>();
  if (!existsSync(cataloguePath)) return descriptions;

  const xml = readFileSync(cataloguePath, "utf8");
  const symbolPattern = /<symbol\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/symbol>/g;
  let match: RegExpExecArray | null;
  while ((match = symbolPattern.exec(xml)) !== null) {
    const symbolRef = match[1].toUpperCase();
    const body = match[2];
    const descriptionMatch = body.match(/<description>\s*<name>[\s\S]*?<\/name>\s*<description>([\s\S]*?)<\/description>/);
    descriptions.set(symbolRef, decodeXmlText(descriptionMatch?.[1] ?? symbolRef));
  }
  return descriptions;
}

function inlineSvgStyle(svgText: string, mode: "day" | "dusk" | "night"): string {
  const catalogueRoot = getPortrayalCatalogueRoot();
  const stylePath = catalogueRoot ? join(catalogueRoot, "Symbols", `${mode}SvgStyle.css`) : null;
  const styleText = stylePath && existsSync(stylePath) ? readFileSync(stylePath, "utf8") : "";
  if (!styleText) return svgText;

  const withoutStylesheet = svgText.replace(/<\?xml-stylesheet[\s\S]*?\?>\s*/i, "");
  const styleElement = `<style type="text/css"><![CDATA[\n${styleText}\n]]></style>`;
  return withoutStylesheet.replace(/(<svg\b[^>]*>)/i, `$1\n  ${styleElement}`);
}

function decodeXmlText(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

function resolveDisplayClass(properties: Record<string, unknown>): string {
  const featureName = resolveFeatureName(properties);
  if (["DepthArea", "DredgedArea"].includes(featureName)) return "depth-area";
  if (["LandArea", "BuiltUpArea", "DockArea", "DryDock", "FloatingDock", "ShorelineConstruction", "Causeway"].includes(featureName)) {
    return "land-area";
  }
  if (["DepthContour", "Coastline", "ShorelineConstruction"].includes(featureName)) return "linework";
  return "default";
}

function resolveMvpMinStage(properties: Record<string, unknown>): number {
  const featureName = resolveFeatureName(properties);
  if (["DepthArea", "DredgedArea", "LandArea", "Coastline"].includes(featureName)) return 0;
  if (["DepthContour"].includes(featureName)) return 1;
  if (["CardinalBuoy", "LateralBuoy", "SafeWaterBuoy", "SpecialPurposeGeneralBuoy", "BuoyCardinal", "BuoyLateral", "BuoySafeWater", "BuoySpecialPurposeGeneral"].includes(featureName)) return 3;
  if (["CardinalBeacon", "LateralBeacon", "SafeWaterBeacon", "SpecialPurposeGeneralBeacon", "BeaconCardinal", "BeaconLateral", "BeaconSafeWater", "BeaconSpecialPurposeGeneral"].includes(featureName)) return 3;
  if (["LightAllAround", "LightSectored"].includes(featureName)) return 4;
  if (["Wreck", "Obstruction", "UnderwaterAwashRock"].includes(featureName)) return 2;
  return 0;
}

function resolveFeatureName(properties: Record<string, unknown>): string {
  const explicitName = String(properties.feature_name ?? properties.featureName ?? properties.name ?? "");
  if (explicitName) return explicitName.replace(/\s+/g, "");

  const featureTypeCode = Number(properties.featureTypeCode ?? properties.feature_type_code ?? 0);
  const featureNamesByCode: Record<number, string> = {
    75: "DredgedArea",
    78: "DepthArea",
    86: "UnderwaterAwashRock",
    87: "Wreck",
    88: "Obstruction",
    154: "LightAllAround",
    155: "LightSectored",
    158: "LateralBuoy",
    159: "CardinalBuoy",
    161: "SafeWaterBuoy",
    162: "SpecialPurposeGeneralBuoy",
    166: "LateralBeacon",
    167: "CardinalBeacon",
    169: "SafeWaterBeacon",
    170: "SpecialPurposeGeneralBeacon"
  };
  if (featureNamesByCode[featureTypeCode]) return featureNamesByCode[featureTypeCode];

  const catalogueName = getFeatureNameByCode().get(featureTypeCode);
  if (catalogueName) return catalogueName;

  return "";
}

function propertyNumber(properties: Record<string, unknown>, names: string[], attributeCode: number): number {
  for (const name of names) {
    const value = Number(properties[name]);
    if (Number.isFinite(value) && value !== 0) return value;
  }

  if (!Array.isArray(properties.attributes)) return 0;
  for (const attribute of properties.attributes) {
    if (!attribute || typeof attribute !== "object") continue;
    const record = attribute as Record<string, unknown>;
    if (Number(record.natc) !== attributeCode) continue;
    const value = Number(record.valueInteger ?? record.valueNumeric ?? record.valueText ?? record.rawValue ?? 0);
    return Number.isFinite(value) ? value : 0;
  }
  return 0;
}

function cardinalSymbol(prefix: "BOYCAR" | "BCNCAR", category: number, fallback: string): string {
  if (category >= 1 && category <= 4) return `${prefix}0${category}`;
  return fallback;
}

function getSymbolDescription(symbolRef: string): string {
  if (symbolRef.startsWith("BOY")) return "遺??怨꾩뿴 MVP Portrayal symbol";
  if (symbolRef.startsWith("BCN")) return "?낇몴 怨꾩뿴 MVP Portrayal symbol";
  if (symbolRef.startsWith("LIGHTS")) return "?깊솕 怨꾩뿴 MVP Portrayal symbol";
  if (symbolRef.startsWith("WRECKS")) return "移⑥꽑 MVP Portrayal symbol";
  if (symbolRef.startsWith("OBSTRN")) return "?μ븷臾?MVP Portrayal symbol";
  if (symbolRef.startsWith("DEPARE")) return "?섏떖 援ъ뿭 MVP Portrayal symbol";
  return "S-101 MVP Portrayal symbol";
}

function createFallbackSymbolSvg(symbolRef: string): string {
  const palette = s101PaletteDay;
  const color = symbolColor(symbolRef);
  const stroke = palette.CHBLK;
  const label = symbolRef.replace(/\d+$/, "");
  if (symbolRef.startsWith("LIGHTS")) {
    return svg(`<circle cx="16" cy="16" r="8" fill="${palette.CHYLW}" stroke="${stroke}" stroke-width="2"/><path d="M16 2v6M16 24v6M2 16h6M24 16h6M6 6l4 4M22 22l4 4M26 6l-4 4M10 22l-4 4" stroke="${color}" stroke-width="2" stroke-linecap="round"/>`);
  }
  if (symbolRef.startsWith("BCN")) {
    return svg(`<path d="M16 3l8 12H8z" fill="${color}" stroke="${stroke}" stroke-width="2"/><path d="M16 15v14" stroke="${stroke}" stroke-width="3"/><path d="M9 29h14" stroke="${stroke}" stroke-width="3"/>`);
  }
  if (symbolRef.startsWith("BOY")) {
    return svg(`<path d="M16 4l9 9-9 9-9-9z" fill="${color}" stroke="${stroke}" stroke-width="2"/><path d="M16 22v7" stroke="${stroke}" stroke-width="3"/><path d="M10 29h12" stroke="${stroke}" stroke-width="3"/>`);
  }
  if (symbolRef.startsWith("WRECKS")) {
    return svg(`<path d="M6 10h20l-4 13H10z" fill="none" stroke="${stroke}" stroke-width="2"/><path d="M8 24l16-16M24 24L8 8" stroke="${palette.DNGHL}" stroke-width="2"/>`);
  }
  if (symbolRef.startsWith("OBSTRN") || symbolRef.startsWith("DANGER")) {
    return svg(`<path d="M16 3l13 24H3z" fill="${palette.DNGHL}" fill-opacity=".25" stroke="${palette.DNGHL}" stroke-width="2"/><text x="16" y="23" text-anchor="middle" font-family="Arial" font-size="18" font-weight="700" fill="${stroke}">!</text>`);
  }
  if (symbolRef.startsWith("DEPARE")) {
    return svg(`<rect x="4" y="6" width="24" height="20" rx="2" fill="${palette.DEPIT}" stroke="${stroke}" stroke-width="2"/><text x="16" y="20" text-anchor="middle" font-family="Arial" font-size="8" font-weight="700" fill="${stroke}">DEP</text>`);
  }
  return svg(`<circle cx="16" cy="16" r="11" fill="${color}" stroke="${stroke}" stroke-width="2"/><text x="16" y="19" text-anchor="middle" font-family="Arial" font-size="6" font-weight="700" fill="${stroke}">${label.slice(0, 3)}</text>`);
}

function symbolColor(symbolRef: string): string {
  if (symbolRef.includes("LAT13") || symbolRef.includes("LAT23") || symbolRef.includes("LIGHTS12")) return s101PaletteDay.CHRED;
  if (symbolRef.includes("LAT14") || symbolRef.includes("LAT24") || symbolRef.includes("LIGHTS11")) return s101PaletteDay.CHGRN;
  if (symbolRef.includes("CAR")) return s101PaletteDay.CHYLW;
  if (symbolRef.includes("SAW")) return s101PaletteDay.CHRED;
  if (symbolRef.includes("SPP")) return s101PaletteDay.CHMGD;
  return s101PaletteDay.TRFCD;
}

function svg(content: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" role="img">
  ${content}
</svg>`;
}
