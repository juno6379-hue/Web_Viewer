import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { DatasetItem, FeatureDetail, FeatureGeoJsonCollection, QaSummary } from "../../../packages/shared/src/index.js";
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
      lifecycle_status: string;
      attributes: Record<string, unknown>;
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
        fc.lifecycle_status,
        fc.attributes,
        CASE WHEN fc.geometry IS NULL THEN NULL ELSE GeometryType(fc.geometry) END AS geometry_type
      FROM projection.s101_feature_current fc
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
    const detail: FeatureDetail = {
      featureInstanceId: row.feature_instance_id,
      datasetId: row.dataset_id,
      datasetVersionId: row.dataset_version_id,
      featureRecordId: row.feature_record_id,
      featureTypeCode: row.feature_type_code,
      foid: { agen: row.foid_agen, fidn: row.foid_fidn, fids: row.foid_fids },
      lifecycleStatus: row.lifecycle_status,
      attributes: row.attributes,
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
        (SELECT COUNT(*)::int FROM projection.s101_feature_current WHERE dataset_id = $1 AND dataset_version_id = $2) AS "projectedFeatures",
        (SELECT COUNT(*)::int FROM projection.s101_feature_geojson WHERE dataset_id = $1) AS "geoJsonRows",
        (SELECT COUNT(*)::int FROM projection.s101_feature_current fc LEFT JOIN projection.s101_feature_geojson gj ON gj.feature_instance_id = fc.feature_instance_id WHERE fc.dataset_id = $1 AND fc.dataset_version_id = $2 AND gj.feature_instance_id IS NULL) AS "missingGeoJson",
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
