import { getPool } from '../../db'
import type { CreateVideoProjectRow } from './types'

export async function getActiveByUser(userId: number): Promise<CreateVideoProjectRow | null> {
  const db = getPool()
  const [rows] = await db.query(
    `SELECT *
       FROM create_video_projects
      WHERE user_id = ?
        AND archived_at IS NULL
      ORDER BY updated_at DESC, id DESC
      LIMIT 1`,
    [userId]
  )
  return (rows as any[])[0] || null
}

export async function listByUser(userId: number): Promise<CreateVideoProjectRow[]> {
  const db = getPool()
  const [rows] = await db.query(
    `SELECT *
       FROM create_video_projects
      WHERE user_id = ?
      ORDER BY (archived_at IS NULL) DESC, updated_at DESC, id DESC`,
    [userId]
  )
  return rows as any[]
}

export async function getById(id: number): Promise<CreateVideoProjectRow | null> {
  const db = getPool()
  const [rows] = await db.query(`SELECT * FROM create_video_projects WHERE id = ? LIMIT 1`, [id])
  return (rows as any[])[0] || null
}

export async function create(input: { userId: number; name?: string | null; description?: string | null; timelineJson: string }): Promise<CreateVideoProjectRow> {
  const db = getPool()
  const [result] = await db.query(
    `INSERT INTO create_video_projects (user_id, name, description, status, timeline_json)
     VALUES (?, ?, ?, 'active', ?)`,
    [input.userId, input.name ?? null, input.description ?? null, input.timelineJson]
  )
  const id = Number((result as any).insertId)
  const row = await getById(id)
  if (!row) throw new Error('failed_to_create_create_video_project')
  return row
}

export async function updateMeta(id: number, fields: { name?: string | null; description?: string | null }): Promise<CreateVideoProjectRow> {
  const db = getPool()
  const nextName = fields.name !== undefined ? fields.name : undefined
  const nextDescription = fields.description !== undefined ? fields.description : undefined

  if (nextName !== undefined && nextDescription !== undefined) {
    await db.query(`UPDATE create_video_projects SET name = ?, description = ? WHERE id = ?`, [nextName, nextDescription, id])
  } else if (nextName !== undefined) {
    await db.query(`UPDATE create_video_projects SET name = ? WHERE id = ?`, [nextName, id])
  } else if (nextDescription !== undefined) {
    await db.query(`UPDATE create_video_projects SET description = ? WHERE id = ?`, [nextDescription, id])
  }
  const row = await getById(id)
  if (!row) throw new Error('not_found')
  return row
}

export async function updateTimeline(id: number, timelineJson: string): Promise<CreateVideoProjectRow> {
  const db = getPool()
  await db.query(`UPDATE create_video_projects SET timeline_json = ? WHERE id = ?`, [timelineJson, id])
  const row = await getById(id)
  if (!row) throw new Error('not_found')
  return row
}

export async function archive(id: number): Promise<void> {
  const db = getPool()
  await db.query(
    `UPDATE create_video_projects
        SET status = 'archived',
            archived_at = COALESCE(archived_at, CURRENT_TIMESTAMP)
      WHERE id = ?`,
    [id]
  )
}

export async function detachUploadsFromProject(userId: number, projectId: number): Promise<void> {
  const db = getPool()
  await db.query(
    `UPDATE uploads
        SET create_video_project_id = NULL
      WHERE create_video_project_id = ?
        AND user_id = ?`,
    [projectId, userId]
  )
}

export async function deleteForUserById(userId: number, projectId: number): Promise<void> {
  const db = getPool()
  await db.query(`DELETE FROM create_video_projects WHERE id = ? AND user_id = ?`, [projectId, userId])
}

export async function setLastExport(id: number, fields: { jobId?: number | null; uploadId?: number | null }): Promise<void> {
  const db = getPool()
  const jobId = fields.jobId !== undefined ? fields.jobId : null
  const uploadId = fields.uploadId !== undefined ? fields.uploadId : null
  await db.query(
    `UPDATE create_video_projects
        SET last_export_job_id = COALESCE(?, last_export_job_id),
            last_export_upload_id = COALESCE(?, last_export_upload_id)
      WHERE id = ?`,
    [jobId, uploadId, id]
  )
}
