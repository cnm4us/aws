import { DB, SpacePublicationEventRow, SpacePublicationRow, SpacePublicationStatus, SpacePublicationVisibility, getPool } from '../db';

type JsonValue = Record<string, any> | Array<any> | string | number | boolean | null;

export type SpacePublicationCreateInput = {
  uploadId: number;
  productionId?: number | null;
  spaceId: number;
  status?: SpacePublicationStatus;
  requestedBy?: number | null;
  approvedBy?: number | null;
  isPrimary?: boolean;
  visibility?: SpacePublicationVisibility;
  distributionFlags?: JsonValue;
  ownerUserId?: number | null;
  visibleInSpace?: boolean;
  visibleInGlobal?: boolean;
  publishedAt?: Date | string | null;
  unpublishedAt?: Date | string | null;
};

export type SpacePublicationStatusUpdate = {
  status: SpacePublicationStatus;
  approvedBy?: number | null;
  publishedAt?: Date | string | null;
  unpublishedAt?: Date | string | null;
  distributionFlags?: JsonValue;
};

export type SpacePublicationEventInput = {
  publicationId: number;
  actorUserId?: number | null;
  action: string;
  detail?: JsonValue;
};

function ensureDb(db?: DB): DB {
  return db ?? getPool();
}

function parseJsonColumn(value: any): any {
  if (value == null) return null;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value;
}

function mapPublication(row: any): SpacePublicationRow {
  return {
    id: Number(row.id),
    upload_id: Number(row.upload_id),
    production_id: row.production_id == null ? null : Number(row.production_id),
    space_id: Number(row.space_id),
    status: row.status as SpacePublicationStatus,
    requested_by: row.requested_by == null ? null : Number(row.requested_by),
    approved_by: row.approved_by == null ? null : Number(row.approved_by),
    is_primary: Boolean(Number(row.is_primary)),
    visibility: (row.visibility || 'inherit') as SpacePublicationVisibility,
    distribution_flags: parseJsonColumn(row.distribution_flags),
    published_at: row.published_at ? String(row.published_at) : null,
    unpublished_at: row.unpublished_at ? String(row.unpublished_at) : null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function mapEvent(row: any): SpacePublicationEventRow {
  return {
    id: Number(row.id),
    publication_id: Number(row.publication_id),
    actor_user_id: row.actor_user_id == null ? null : Number(row.actor_user_id),
    action: String(row.action),
    detail: parseJsonColumn(row.detail),
    created_at: String(row.created_at),
  };
}

export async function createSpacePublication(input: SpacePublicationCreateInput, db?: DB): Promise<SpacePublicationRow> {
  const conn = ensureDb(db);
  const status = input.status ?? 'draft';
  const requestedBy = input.requestedBy ?? null;
  const approvedBy = input.approvedBy ?? null;
  const isPrimary = input.isPrimary ? 1 : 0;
  const visibility = input.visibility ?? 'inherit';
  const distribution = input.distributionFlags == null ? null : JSON.stringify(input.distributionFlags);
  const ownerUserId = input.ownerUserId ?? null;
  const visibleInSpace = input.visibleInSpace === undefined ? 1 : (input.visibleInSpace ? 1 : 0);
  const visibleInGlobal = input.visibleInGlobal === undefined ? 0 : (input.visibleInGlobal ? 1 : 0);
  const publishedAt = input.publishedAt ? new Date(input.publishedAt).toISOString().slice(0, 19).replace('T', ' ') : null;
  const unpublishedAt = input.unpublishedAt ? new Date(input.unpublishedAt).toISOString().slice(0, 19).replace('T', ' ') : null;

  const [result] = await conn.query(
    `INSERT INTO space_publications
       (upload_id, production_id, space_id, status, requested_by, approved_by, is_primary, visibility, distribution_flags, owner_user_id, visible_in_space, visible_in_global, published_at, unpublished_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.uploadId,
      input.productionId ?? null,
      input.spaceId,
      status,
      requestedBy,
      approvedBy,
      isPrimary,
      visibility,
      distribution,
      ownerUserId,
      visibleInSpace,
      visibleInGlobal,
      publishedAt,
      unpublishedAt,
    ]
  );

  const insertId = Number((result as any).insertId);
  const created = await getSpacePublicationById(insertId, conn);
  if (!created) throw new Error('failed_to_create_space_publication');
  return created;
}

export async function getSpacePublicationById(id: number, db?: DB): Promise<SpacePublicationRow | null> {
  const conn = ensureDb(db);
  const [rows] = await conn.query(`SELECT * FROM space_publications WHERE id = ? LIMIT 1`, [id]);
  const row = (rows as any[])[0];
  return row ? mapPublication(row) : null;
}

export async function listSpacePublicationsForUpload(uploadId: number, db?: DB): Promise<SpacePublicationRow[]> {
  const conn = ensureDb(db);
  const [rows] = await conn.query(
    `SELECT * FROM space_publications WHERE upload_id = ? ORDER BY is_primary DESC, created_at ASC`,
    [uploadId]
  );
  return (rows as any[]).map(mapPublication);
}

export async function updateSpacePublicationStatus(
  publicationId: number,
  update: SpacePublicationStatusUpdate,
  db?: DB
): Promise<SpacePublicationRow | null> {
  const conn = ensureDb(db);
  const distribution = update.distributionFlags == null ? null : JSON.stringify(update.distributionFlags);
  const publishedAt = update.publishedAt
    ? new Date(update.publishedAt).toISOString().slice(0, 19).replace('T', ' ')
    : null;
  const unpublishedAt = update.unpublishedAt
    ? new Date(update.unpublishedAt).toISOString().slice(0, 19).replace('T', ' ')
    : null;

  await conn.query(
    `UPDATE space_publications
        SET status = ?,
            approved_by = COALESCE(?, approved_by),
            distribution_flags = COALESCE(?, distribution_flags),
            published_at = ?,
            unpublished_at = ?,
            updated_at = NOW()
      WHERE id = ?`,
    [
      update.status,
      update.approvedBy ?? null,
      distribution,
      publishedAt,
      unpublishedAt,
      publicationId,
    ]
  );
  return getSpacePublicationById(publicationId, conn);
}

export async function recordSpacePublicationEvent(event: SpacePublicationEventInput, db?: DB): Promise<SpacePublicationEventRow> {
  const conn = ensureDb(db);
  const detail = event.detail == null ? null : JSON.stringify(event.detail);
  const [result] = await conn.query(
    `INSERT INTO space_publication_events (publication_id, actor_user_id, action, detail) VALUES (?, ?, ?, ?)`,
    [event.publicationId, event.actorUserId ?? null, event.action, detail]
  );
  const insertId = Number((result as any).insertId);
  const [rows] = await conn.query(`SELECT * FROM space_publication_events WHERE id = ? LIMIT 1`, [insertId]);
  const row = (rows as any[])[0];
  if (!row) throw new Error('failed_to_record_publication_event');
  return mapEvent(row);
}

export async function listSpacePublicationEvents(
  publicationId: number,
  db?: DB
): Promise<SpacePublicationEventRow[]> {
  const conn = ensureDb(db);
  const [rows] = await conn.query(
    `SELECT * FROM space_publication_events WHERE publication_id = ? ORDER BY created_at ASC`,
    [publicationId]
  );
  return (rows as any[]).map(mapEvent);
}
