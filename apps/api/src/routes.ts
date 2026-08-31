import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type {
  CatalogueRuntimeStatus,
  DatasetItem,
  FeatureDetail,
  FeatureGeoJsonCollection,
  FeatureSearchItem,
  QaSummary
} from "../../../packages/shared/src/index.js";
import { query } from "./db.js";

const numberText = z.string().trim().regex(/^\d+$/).transform((value) => Number(value));
const featureQuerySchema = z.object({
  datasetId: numberText,
  datasetVersionId: numberText.optional(),
  bbox: z.string().optional(),
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
        dc.conformance_status,
        CASE WHEN dc.bbox IS NULL THEN NULL ELSE ST_AsGeoJSON(dc.bbox)::jsonb END AS bbox,
        COUNT(fc.feature_instance_id)::text AS feature_count
      FROM projection.s101_dataset_current dc
      LEFT JOIN projection.s101_feature_current fc
        ON fc.dataset_id = dc.dataset_id
       AND fc.dataset_version_id = dc.dataset_version_id
      GROUP BY dc.dataset_id, dc.dataset_version_id, dc.dsnm, dc.product_id,
               dc.edition_number, dc.update_number, dc.purpose, dc.conformance_status, dc.bbox
      ORDER BY dc.dsnm
    `);

    const items: DatasetItem[] = result.rows.map((row) => ({
      datasetId: row.dataset_id,
      datasetVersionId: row.dataset_version_id,
      dsnm: row.dsnm,
      productId: row.product_id,
      editionNumber: row.edition_number,
      updateNumber: row.update_number,
      purpose: row.purpose,
      conformanceStatus: row.conformance_status,
      bbox: row.bbox,
      featureCount: Number(row.feature_count)
    }));
    return { items };
  });

  app.get("/api/catalogue/status", async (): Promise<CatalogueRuntimeStatus> => {
    return {
      featureCatalogue: null,
      portrayalCatalogue: null,
      cacheReady: false,
      catalogueMismatch: false,
      warning:
        "Feature Catalogue XML 초기화 cache와 parser DB catalogue version/hash 비교는 다음 구현 단계에서 연결합니다."
    };
  });

  app.get("/api/features", async (request) => {
    const parsed = featureQuerySchema.parse(request.query);
    const limit = Math.min(parsed.limit ?? 5000, 20000);
    const values: unknown[] = [parsed.datasetId];
    const conditions = ["gj.dataset_id = $1"];

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
        const error = new Error("bbox는 minX,minY,maxX,maxY 형식이어야 합니다.");
        Object.assign(error, { statusCode: 400 });
        throw error;
      }
      values.push(parts[0], parts[1], parts[2], parts[3]);
      const index = values.length - 3;
      conditions.push(`gj.bbox && ST_MakeEnvelope($${index}, $${index + 1}, $${index + 2}, $${index + 3}, 4326)`);
    }
    values.push(limit);
    const limitIndex = values.length;

    const result = await query<{
      feature_instance_id: string;
      feature_type_code: number;
      properties: Record<string, unknown>;
      geometry_geojson: unknown;
    }>(
      `
      SELECT gj.feature_instance_id::text, gj.feature_type_code, gj.properties, gj.geometry_geojson
      FROM projection.s101_feature_geojson gj
      JOIN projection.s101_feature_current fc
        ON fc.feature_instance_id = gj.feature_instance_id
      WHERE ${conditions.join(" AND ")}
      ORDER BY gj.feature_instance_id
      LIMIT $${limitIndex}
      `,
      values
    );

    const collection: FeatureGeoJsonCollection = {
      type: "FeatureCollection",
      features: result.rows.map((row) => ({
        type: "Feature",
        id: row.feature_instance_id,
        geometry: row.geometry_geojson,
        properties: {
          ...row.properties,
          featureInstanceId: row.feature_instance_id,
          featureTypeCode: row.feature_type_code
        }
      }))
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
      featureName: null,
      foid: { agen: row.foid_agen, fidn: row.foid_fidn, fids: row.foid_fids },
      geometryType: row.geometry_type,
      bbox: row.bbox,
      matchReason: row.match_reason
    }));
    return { items };
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
      const error = new Error("feature를 찾을 수 없습니다.");
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
      catalogueSnapshotId: null,
      featureName: null,
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
        name: attribute.name,
        atix: attribute.atix,
        paix: attribute.paix,
        atin: attribute.atin,
        valueType: attribute.value_type,
        value: attribute.value,
        rawValue: attribute.raw_value
      })),
      complexAttributes: complexAttributes.rows.map((attribute) => ({
        id: attribute.id,
        code: attribute.code,
        name: attribute.name,
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
