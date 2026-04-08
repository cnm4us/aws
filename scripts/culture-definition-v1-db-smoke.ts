import assert from 'node:assert/strict'
import { ensureSchema, getPool } from '../src/db'
import {
  createCulture,
  getCultureWithDefinition,
  saveCulture,
} from '../src/features/cultures/repo'

async function run(): Promise<void> {
  const db = getPool()
  try {
    await ensureSchema(db)

    const name = `Culture Smoke ${Date.now()}`
    const createdId = await createCulture(
      {
        name,
        description: 'phase-b smoke',
      },
      db
    )
    assert.ok(createdId > 0, 'createCulture should return id')

    const loaded = await getCultureWithDefinition(createdId, db)
    assert.ok(loaded, 'culture should load')
    assert.equal(loaded?.definition.name, name, 'definition.name should sync with culture name')
    assert.ok(loaded?.definition.version, 'definition.version should exist')

    let rejected = false
    try {
      await saveCulture(
        createdId,
        {
          name: `${name} Updated`,
          description: 'invalid write test',
          definition_json: { id: 'bad', extra_key: true },
        },
        db as any
      )
    } catch {
      rejected = true
    }
    assert.equal(rejected, true, 'invalid definition_json should be rejected on explicit write')

    await saveCulture(
      createdId,
      {
        name: `${name} Updated`,
        description: 'valid write test',
      },
      db as any
    )
    const reloaded = await getCultureWithDefinition(createdId, db)
    assert.ok(reloaded, 'culture should reload')
    assert.equal(
      reloaded?.definition.name,
      `${name} Updated`,
      'definition.name should remain synced after save'
    )
    assert.equal(reloaded?.definition.id.startsWith('culture_smoke_'), true, 'definition.id should be derived')

    await db.query(`DELETE FROM culture_categories WHERE culture_id = ?`, [createdId])
    await db.query(`DELETE FROM cultures WHERE id = ?`, [createdId])

    // eslint-disable-next-line no-console
    console.log('[culture-definition-v1-db-smoke] ok')
  } finally {
    await db.end().catch(() => undefined)
  }
}

run().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[culture-definition-v1-db-smoke] failed', err)
  process.exit(1)
})
