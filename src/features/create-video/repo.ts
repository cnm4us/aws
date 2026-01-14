import { getPool } from '../../db'
import type { CreateVideoProjectRow } from './types'

export async function getActiveByUser(userId: number): Promise<CreateVideoProjectRow | null> {
  const db = getPool()
  const [rows] = await db.query(
    `SELECT *
       FROM create_video_projects
      WHERE user_id = ?
        AND archived_at IS NULL
      ORDER BY id DESC
      LIMIT 1`,
    [userId]
  )
  return (rows as any[])[0] || null
}

export async function getById(id: number): Promise<CreateVideoProjectRow | null> {
  const db = getPool()
  const [rows] = await db.query(`SELECT * FROM create_video_projects WHERE id = ? LIMIT 1`, [id])
  return (rows as any[])[0] || null
}

export async function create(input: { userId: number; timelineJson: string }): Promise<CreateVideoProjectRow> {
  const db = getPool()
  const [result] = await db.query(
    `INSERT INTO create_video_projects (user_id, status, timeline_json)
     VALUES (?, 'active', ?)`,
    [input.userId, input.timelineJson]
  )
  const id = Number((result as any).insertId)
  const row = await getById(id)
  if (!row) throw new Error('failed_to_create_create_video_project')
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

