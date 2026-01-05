import { DOMParser, XMLSerializer } from '@xmldom/xmldom'
import { DomainError, ForbiddenError, NotFoundError } from '../../core/errors'
import { can } from '../../security/permissions'
import { PERM } from '../../security/perm'
import * as repo from './repo'
import type {
  LowerThirdConfigDto,
  LowerThirdConfigRow,
  LowerThirdDescriptor,
  LowerThirdDescriptorV1,
  LowerThirdDescriptorV2,
  LowerThirdDescriptorV2Binding,
  LowerThirdDescriptorV2Param,
  LowerThirdDescriptorColor,
  LowerThirdDescriptorField,
  LowerThirdTemplateDto,
  LowerThirdTemplateRow,
} from './types'

function normalizeName(raw: any): string {
  const name = String(raw ?? '').trim()
  if (!name) throw new DomainError('invalid_name', 'invalid_name', 400)
  if (name.length > 120) throw new DomainError('invalid_name', 'invalid_name', 400)
  return name
}

function normalizeTemplateKey(raw: any): string {
  const key = String(raw ?? '').trim()
  if (!key) throw new DomainError('invalid_template_key', 'invalid_template_key', 400)
  if (key.length > 80) throw new DomainError('invalid_template_key', 'invalid_template_key', 400)
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(key)) throw new DomainError('invalid_template_key', 'invalid_template_key', 400)
  return key
}

function normalizeVersion(raw: any): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) throw new DomainError('invalid_template_version', 'invalid_template_version', 400)
  return Math.round(n)
}

const LOWER_THIRD_DURATION_OPTIONS_SECONDS = [5, 10, 15, 20] as const
const DEFAULT_LOWER_THIRD_DURATION_SECONDS = 10

function normalizeTimingRule(raw: any): 'first_only' | 'entire' {
  const s = String(raw ?? '').trim().toLowerCase()
  if (!s) return 'first_only'
  if (s === 'first_n' || s === 'first' || s === 'first_only') return 'first_only'
  if (s === 'entire' || s === 'end' || s === 'till_end') return 'entire'
  throw new DomainError('invalid_timing_rule', 'invalid_timing_rule', 400)
}

function normalizeTimingSeconds(rule: 'first_only' | 'entire', raw: any): number | null {
  if (rule === 'entire') return null
  const n = Number(raw)
  if (!Number.isFinite(n)) return DEFAULT_LOWER_THIRD_DURATION_SECONDS
  const s = Math.round(n)
  if (!LOWER_THIRD_DURATION_OPTIONS_SECONDS.includes(s as any)) {
    throw new DomainError('invalid_timing_seconds', 'invalid_timing_seconds', 400)
  }
  return s
}

function isDescriptorV2(d: any): d is LowerThirdDescriptorV2 {
  return !!d && typeof d === 'object' && d.params && typeof d.params === 'object' && Array.isArray(d.bindings)
}

function normalizeDescriptorV1(d: any): LowerThirdDescriptorV1 {
  const fieldsRaw = (d as any).fields
  const colorsRaw = (d as any).colors
  const defaultsRaw = (d as any).defaults

  const fields: LowerThirdDescriptorField[] = Array.isArray(fieldsRaw)
    ? fieldsRaw.map((f) => ({
        id: String(f?.id || '').trim(),
        label: String(f?.label || '').trim(),
        type: 'text',
        maxLength: f?.maxLength == null ? undefined : Number(f.maxLength),
      }))
    : []
  for (const f of fields) {
    if (!f.id || !f.label) throw new DomainError('invalid_descriptor', 'invalid_descriptor', 400)
    if (!/^[A-Za-z0-9_-]+$/.test(f.id)) throw new DomainError('invalid_descriptor', 'invalid_descriptor', 400)
    if (f.maxLength != null) {
      if (!Number.isFinite(f.maxLength) || f.maxLength <= 0 || f.maxLength > 500)
        throw new DomainError('invalid_descriptor', 'invalid_descriptor', 400)
      f.maxLength = Math.round(f.maxLength)
    }
  }

  const colors: LowerThirdDescriptorColor[] = Array.isArray(colorsRaw)
    ? colorsRaw.map((c) => ({
        id: String(c?.id || '').trim(),
        label: String(c?.label || '').trim(),
      }))
    : []
  for (const c of colors) {
    if (!c.id || !c.label) throw new DomainError('invalid_descriptor', 'invalid_descriptor', 400)
    if (!/^[A-Za-z0-9_-]+$/.test(c.id)) throw new DomainError('invalid_descriptor', 'invalid_descriptor', 400)
  }

  const defaults: Record<string, string> = {}
  if (defaultsRaw && typeof defaultsRaw === 'object') {
    for (const [k, v] of Object.entries(defaultsRaw)) {
      const key = String(k).trim()
      if (!key) continue
      defaults[key] = String(v ?? '')
    }
  }

  // Ensure all ids are unique across fields+colors.
  const allIds = [...fields.map((f) => f.id), ...colors.map((c) => c.id)]
  const set = new Set<string>()
  for (const id of allIds) {
    if (set.has(id)) throw new DomainError('invalid_descriptor', 'invalid_descriptor', 400)
    set.add(id)
  }

  return { fields, colors, defaults }
}

function normalizeDescriptorV2(d: any): LowerThirdDescriptorV2 {
  const templateIdRaw = (d as any).templateId
  const versionRaw = (d as any).version
  const paramsRaw = (d as any).params
  const bindingsRaw = (d as any).bindings

  const params: Record<string, LowerThirdDescriptorV2Param> = {}
  if (!paramsRaw || typeof paramsRaw !== 'object') throw new DomainError('invalid_descriptor', 'invalid_descriptor', 400)
  for (const [k, v] of Object.entries(paramsRaw)) {
    const key = String(k || '').trim()
    if (!key) continue
    if (!/^[A-Za-z0-9_-]+$/.test(key)) throw new DomainError('invalid_descriptor', 'invalid_descriptor', 400)
    const p = v && typeof v === 'object' ? (v as any) : {}
    const type = String(p.type || '').trim().toLowerCase()
    if (type !== 'text' && type !== 'color') throw new DomainError('invalid_descriptor', 'invalid_descriptor', 400)
    const label = String(p.label || '').trim()
    if (!label) throw new DomainError('invalid_descriptor', 'invalid_descriptor', 400)
    const def = p.default != null ? String(p.default) : undefined
    const maxLengthRaw = p.maxLength != null ? Number(p.maxLength) : undefined
    const param: LowerThirdDescriptorV2Param = { type: type as any, label }
    if (maxLengthRaw != null) {
      if (!Number.isFinite(maxLengthRaw) || maxLengthRaw <= 0 || maxLengthRaw > 500)
        throw new DomainError('invalid_descriptor', 'invalid_descriptor', 400)
      param.maxLength = Math.round(maxLengthRaw)
    }
    if (def != null) param.default = def
    params[key] = param
  }
  if (!Object.keys(params).length) throw new DomainError('invalid_descriptor', 'invalid_descriptor', 400)

  const bindings: LowerThirdDescriptorV2Binding[] = []
  if (!Array.isArray(bindingsRaw)) throw new DomainError('invalid_descriptor', 'invalid_descriptor', 400)
  for (const b of bindingsRaw) {
    const param = String((b as any)?.param || '').trim()
    const selector = String((b as any)?.selector || '').trim()
    const attrsRaw = (b as any)?.attributes
    if (!param || !selector) throw new DomainError('invalid_descriptor', 'invalid_descriptor', 400)
    if (!params[param]) throw new DomainError('invalid_descriptor', 'invalid_descriptor', 400)
    if (!attrsRaw || typeof attrsRaw !== 'object') throw new DomainError('invalid_descriptor', 'invalid_descriptor', 400)
    const attributes: Record<string, string> = {}
    for (const [attrK, attrV] of Object.entries(attrsRaw)) {
      const k = String(attrK || '').trim()
      if (!k) continue
      if (k.toLowerCase() === 'style') throw new DomainError('invalid_descriptor', 'invalid_descriptor', 400)
      if (/^on[a-z]+$/i.test(k)) throw new DomainError('invalid_descriptor', 'invalid_descriptor', 400)
      if (k.toLowerCase() === 'href' || k.toLowerCase() === 'xlink:href') throw new DomainError('invalid_descriptor', 'invalid_descriptor', 400)
      // Allow common SVG attribute names + special-case 'textContent'.
      if (k !== 'textContent' && !/^[A-Za-z_:][-A-Za-z0-9_:.]*$/.test(k)) {
        throw new DomainError('invalid_descriptor', 'invalid_descriptor', 400)
      }
      attributes[k] = String(attrV ?? '')
    }
    if (!Object.keys(attributes).length) throw new DomainError('invalid_descriptor', 'invalid_descriptor', 400)
    bindings.push({ param, selector, attributes })
  }
  if (!bindings.length) throw new DomainError('invalid_descriptor', 'invalid_descriptor', 400)

  const out: LowerThirdDescriptorV2 = {
    params,
    bindings,
  }
  if (templateIdRaw != null) out.templateId = String(templateIdRaw)
  if (versionRaw != null && Number.isFinite(Number(versionRaw))) out.version = Math.round(Number(versionRaw))
  return out
}

function normalizeDescriptor(raw: any): LowerThirdDescriptor {
  const d = typeof raw === 'string' ? (() => { try { return JSON.parse(raw) } catch { return null } })() : raw
  if (!d || typeof d !== 'object') throw new DomainError('invalid_descriptor', 'invalid_descriptor', 400)
  if (isDescriptorV2(d)) return normalizeDescriptorV2(d)
  return normalizeDescriptorV1(d)
}

function normalizeParams(raw: any): Record<string, string> {
  if (raw == null) return {}
  if (typeof raw !== 'object') throw new DomainError('invalid_params', 'invalid_params', 400)
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw)) {
    const key = String(k).trim()
    if (!key) continue
    out[key] = String(v ?? '')
  }
  return out
}

function normalizeHexColor(raw: any): string {
  const s = String(raw ?? '').trim()
  if (!/^#[0-9a-fA-F]{6}$/.test(s)) throw new DomainError('invalid_color', 'invalid_color', 400)
  return s
}

function stripSvgPreamble(raw: string): string {
  let s = String(raw ?? '')
  // Strip BOM
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1)
  s = s.trimStart()
  // Strip XML declaration + leading comments (common from Illustrator exports).
  s = s.replace(/^<\?xml[\s\S]*?\?>\s*/i, '')
  while (s.startsWith('<!--')) {
    const end = s.indexOf('-->')
    if (end === -1) break
    s = s.slice(end + 3).trimStart()
  }
  return s
}

function mapTemplateRow(row: LowerThirdTemplateRow): LowerThirdTemplateDto {
  const descriptor = normalizeDescriptor((row as any).descriptor_json)
  return {
    templateKey: String(row.template_key || ''),
    version: Number(row.version || 0),
    label: String(row.label || ''),
    category: row.category == null ? null : String(row.category),
    descriptor,
    createdAt: String(row.created_at || ''),
    archivedAt: row.archived_at == null ? null : String(row.archived_at),
  }
}

function mapConfigRow(row: LowerThirdConfigRow): LowerThirdConfigDto {
  const params = normalizeParams((row as any).params_json)
  const timingRule = (() => {
    try { return normalizeTimingRule((row as any).timing_rule) } catch { return 'first_only' as const }
  })()
  const timingSeconds = (() => {
    try { return normalizeTimingSeconds(timingRule, (row as any).timing_seconds) } catch { return DEFAULT_LOWER_THIRD_DURATION_SECONDS }
  })()
  return {
    id: Number(row.id),
    name: String(row.name || ''),
    templateKey: String(row.template_key || ''),
    templateVersion: Number(row.template_version || 0),
    params,
    timingRule,
    timingSeconds,
    createdAt: String(row.created_at || ''),
    updatedAt: String(row.updated_at || ''),
    archivedAt: row.archived_at == null ? null : String(row.archived_at),
  }
}

async function isSiteAdmin(userId: number): Promise<boolean> {
  try {
    return await can(Number(userId), PERM.VIDEO_DELETE_ANY)
  } catch {
    return false
  }
}

function ensureConfigAccess(row: LowerThirdConfigRow, userId: number, allowAdmin: boolean) {
  const ownerId = Number(row.owner_user_id)
  if (ownerId === Number(userId)) return
  if (allowAdmin) return
  throw new ForbiddenError()
}

export async function listTemplatesForUser(userId: number, params?: { includeArchived?: boolean }): Promise<LowerThirdTemplateDto[]> {
  if (!userId) throw new ForbiddenError()
  const includeArchivedRequested = Boolean(params?.includeArchived)
  const admin = includeArchivedRequested ? await isSiteAdmin(userId) : false
  const rows = await repo.listTemplates({ includeArchived: includeArchivedRequested && admin })
  return rows.map(mapTemplateRow)
}

export async function listConfigsForUser(userId: number, params?: { includeArchived?: boolean; limit?: number }): Promise<LowerThirdConfigDto[]> {
  if (!userId) throw new ForbiddenError()
  const rows = await repo.listConfigsByOwner(Number(userId), params)
  return rows.map(mapConfigRow)
}

export async function getConfigForUser(id: number, userId: number): Promise<LowerThirdConfigDto> {
  if (!userId) throw new ForbiddenError()
  const row = await repo.getConfigById(id)
  if (!row) throw new NotFoundError('not_found')
  const admin = await isSiteAdmin(userId)
  ensureConfigAccess(row, userId, admin)
  return mapConfigRow(row)
}

export async function createConfigForUser(
  input: { name: any; templateKey: any; templateVersion: any; params: any; timingRule?: any; timingSeconds?: any },
  userId: number
): Promise<LowerThirdConfigDto> {
  if (!userId) throw new ForbiddenError()
  const name = normalizeName(input.name)
  const templateKey = normalizeTemplateKey(input.templateKey)
  const templateVersion = normalizeVersion(input.templateVersion)
  const params = normalizeParams(input.params)
  const timingRule = normalizeTimingRule(input.timingRule)
  const timingSeconds = normalizeTimingSeconds(timingRule, input.timingSeconds)

  const tpl = await repo.getTemplateByKeyVersion(templateKey, templateVersion)
  if (!tpl || tpl.archived_at) throw new NotFoundError('template_not_found')
  const descriptor = normalizeDescriptor((tpl as any).descriptor_json)
  const resolvedParams = resolveParams(descriptor, params)
  // Validate now so we can fail early on bad configs.
  resolveSvgMarkup(tpl.svg_markup, descriptor, resolvedParams)

  const row = await repo.createConfig({
    ownerUserId: Number(userId),
    name,
    templateKey,
    templateVersion,
    paramsJson: resolvedParams,
    timingRule,
    timingSeconds,
  })
  return mapConfigRow(row)
}

export async function updateConfigForUser(
  id: number,
  patch: { name?: any; params?: any; timingRule?: any; timingSeconds?: any },
  userId: number
): Promise<LowerThirdConfigDto> {
  if (!userId) throw new ForbiddenError()
  const existing = await repo.getConfigById(id)
  if (!existing) throw new NotFoundError('not_found')
  const admin = await isSiteAdmin(userId)
  ensureConfigAccess(existing, userId, admin)
  if (existing.archived_at) throw new DomainError('archived', 'archived', 400)

  const nextName = patch.name !== undefined ? normalizeName(patch.name) : String(existing.name || '')
  const nextParams = patch.params !== undefined ? normalizeParams(patch.params) : normalizeParams((existing as any).params_json)
  const nextTimingRule =
    patch.timingRule !== undefined ? normalizeTimingRule(patch.timingRule) : normalizeTimingRule((existing as any).timing_rule)
  const nextTimingSeconds =
    patch.timingRule !== undefined || patch.timingSeconds !== undefined
      ? normalizeTimingSeconds(nextTimingRule, patch.timingSeconds)
      : normalizeTimingSeconds(nextTimingRule, (existing as any).timing_seconds)
  const templateKey = String(existing.template_key || '')
  const templateVersion = Number(existing.template_version || 0)
  const tpl = await repo.getTemplateByKeyVersion(templateKey, templateVersion)
  if (!tpl || tpl.archived_at) throw new NotFoundError('template_not_found')
  const descriptor = normalizeDescriptor((tpl as any).descriptor_json)
  const resolvedParams = resolveParams(descriptor, nextParams)
  resolveSvgMarkup(tpl.svg_markup, descriptor, resolvedParams)

  const row = await repo.updateConfig(id, {
    name: nextName,
    paramsJson: resolvedParams,
    timingRule: nextTimingRule,
    timingSeconds: nextTimingSeconds,
  })
  return mapConfigRow(row)
}

export async function archiveConfigForUser(id: number, userId: number): Promise<{ ok: true }> {
  if (!userId) throw new ForbiddenError()
  const row = await repo.getConfigById(id)
  if (!row) throw new NotFoundError('not_found')
  const admin = await isSiteAdmin(userId)
  ensureConfigAccess(row, userId, admin)
  await repo.archiveConfig(id)
  return { ok: true }
}

function assertSvgSafe(svg: string) {
  const s = stripSvgPreamble(String(svg || ''))
  if (!s.trimStart().toLowerCase().startsWith('<svg')) {
    throw new DomainError('SVG must start with <svg> (remove XML/metadata header).', 'invalid_svg', 400)
  }
  if (/<\s*!doctype/i.test(s)) throw new DomainError('SVG DOCTYPE is not allowed.', 'invalid_svg', 400)
  if (/<\s*script\b/i.test(s)) throw new DomainError('SVG <script> is not allowed.', 'invalid_svg', 400)
  if (/<\s*foreignObject\b/i.test(s)) throw new DomainError('SVG <foreignObject> is not allowed.', 'invalid_svg', 400)
  if (/<\s*image\b/i.test(s)) throw new DomainError('SVG <image> is not allowed.', 'invalid_svg', 400)
  if (/\son[a-z]+\s*=/i.test(s)) throw new DomainError('SVG event handler attributes are not allowed.', 'invalid_svg', 400)
  // Disallow external href references; fragment refs are OK (e.g. href="#id").
  try {
    const re = /\s(?:href|xlink:href)\s*=\s*(['"])(.*?)\1/gi
    let m: RegExpExecArray | null
    while ((m = re.exec(s))) {
      const v = String(m[2] ?? '').trim()
      if (!v) continue
      if (!v.startsWith('#')) throw new DomainError('External href/xlink:href references are not allowed in SVG.', 'invalid_svg', 400)
    }
  } catch {}
  // Disallow external refs; internal url(#id) is OK.
  if (/url\(\s*['"]?\s*https?:/i.test(s)) throw new DomainError('External url(http...) in SVG is not allowed.', 'invalid_svg', 400)
  if (/url\(\s*['"]?\s*data:/i.test(s)) throw new DomainError('External url(data:...) in SVG is not allowed.', 'invalid_svg', 400)
}

function findElementById(doc: any, id: string): any | null {
  try {
    const all = doc.getElementsByTagName('*')
    for (let i = 0; i < all.length; i++) {
      const el = all.item(i)
      if (!el) continue
      const elId = el.getAttribute && el.getAttribute('id')
      if (elId === id) return el
    }
  } catch {}
  return null
}

function resolveParamsV1(descriptor: LowerThirdDescriptorV1, provided: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  const defaults = (descriptor as any).defaults || {}
  const fields = (descriptor as any).fields || []
  const colors = (descriptor as any).colors || []

  for (const f of fields as LowerThirdDescriptorField[]) {
    const raw = provided[f.id] !== undefined ? String(provided[f.id]) : (defaults[f.id] !== undefined ? String(defaults[f.id]) : '')
    const text = raw
    if (f.maxLength != null && text.length > f.maxLength) throw new DomainError('invalid_text', 'invalid_text', 400)
    out[f.id] = text
  }

  for (const c of colors as LowerThirdDescriptorColor[]) {
    const raw = provided[c.id] !== undefined ? provided[c.id] : (defaults[c.id] !== undefined ? defaults[c.id] : '#000000')
    out[c.id] = normalizeHexColor(raw)
  }

  return out
}

function resolveParamsV2(descriptor: LowerThirdDescriptorV2, provided: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, def] of Object.entries(descriptor.params || {})) {
    const providedValue = Object.prototype.hasOwnProperty.call(provided, key) ? provided[key] : undefined
    const raw = providedValue !== undefined ? String(providedValue) : def.default != null ? String(def.default) : undefined
    if (raw == null) continue
    if (def.type === 'text') {
      if (def.maxLength != null && raw.length > def.maxLength) throw new DomainError('invalid_text', 'invalid_text', 400)
      out[key] = raw
    } else if (def.type === 'color') {
      out[key] = normalizeHexColor(raw)
    }
  }
  return out
}

function resolveParams(descriptor: LowerThirdDescriptor, provided: Record<string, string>): Record<string, string> {
  if (isDescriptorV2(descriptor)) return resolveParamsV2(descriptor, provided)
  return resolveParamsV1(descriptor as any, provided)
}

function parseSvgOrThrow(svgMarkup: string): { doc: any; svgMarkup: string } {
  const cleaned = stripSvgPreamble(svgMarkup)
  assertSvgSafe(cleaned)
  const parser = new DOMParser()
  const doc = parser.parseFromString(cleaned, 'image/svg+xml')
  const root = doc && doc.documentElement ? doc.documentElement : null
  if (!root || String(root.tagName || '').toLowerCase() !== 'svg') throw new DomainError('Invalid SVG root element.', 'invalid_svg', 400)
  return { doc, svgMarkup: cleaned }
}

function findAllByTagName(root: any, tagName: string): any[] {
  try {
    const nodes = root.getElementsByTagName(tagName)
    const out: any[] = []
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes.item(i)
      if (n) out.push(n)
    }
    return out
  } catch {
    return []
  }
}

function findDescendantsMatching(root: any, match: (el: any) => boolean): any[] {
  const out: any[] = []
  const stack: any[] = []
  try {
    if (root && root.childNodes) {
      for (let i = 0; i < root.childNodes.length; i++) {
        const c = root.childNodes.item(i)
        if (c) stack.push(c)
      }
    }
    while (stack.length) {
      const n = stack.pop()
      if (!n) continue
      try {
        if (n.nodeType === 1 && match(n)) out.push(n)
      } catch {}
      try {
        if (n.childNodes) {
          for (let i = 0; i < n.childNodes.length; i++) {
            const c = n.childNodes.item(i)
            if (c) stack.push(c)
          }
        }
      } catch {}
    }
  } catch {}
  return out
}

function parseSimpleSelectorPart(part: string): { kind: 'id'; id: string } | { kind: 'tag'; tag: string; attr?: { name: string; value: string } } | null {
  const p = String(part || '').trim()
  if (!p) return null
  if (p.startsWith('#')) {
    const id = p.slice(1).trim()
    if (!id) return null
    return { kind: 'id', id }
  }
  // tagName[attr='value']
  const m = p.match(/^([A-Za-z][A-Za-z0-9_-]*)(?:\[\s*([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*(['"])(.*?)\3\s*\])?$/)
  if (!m) return null
  const tag = m[1]
  const attrName = m[2]
  const attrValue = m[4]
  if (attrName) return { kind: 'tag', tag, attr: { name: attrName, value: String(attrValue ?? '') } }
  return { kind: 'tag', tag }
}

function selectAll(doc: any, selector: string): any[] {
  const sel = String(selector || '').trim()
  if (!sel) return []
  if (sel.includes(',')) throw new DomainError('Unsupported selector (commas not allowed).', 'invalid_descriptor', 400)
  const parts = sel.split(/\s+/).filter(Boolean)
  if (!parts.length) return []

  let current: any[] = [doc.documentElement]
  for (let i = 0; i < parts.length; i++) {
    const parsed = parseSimpleSelectorPart(parts[i])
    if (!parsed) throw new DomainError('Unsupported selector syntax.', 'invalid_descriptor', 400)
    const next: any[] = []
    if (parsed.kind === 'id') {
      // id selectors are absolute.
      const el = findElementById(doc, parsed.id)
      if (el) next.push(el)
    } else {
      for (const base of current) {
        const matches = findDescendantsMatching(base, (el) => {
          const tag = String(el.tagName || '').toLowerCase()
          if (tag !== parsed.tag.toLowerCase()) return false
          if (parsed.attr) {
            try {
              const v = el.getAttribute(parsed.attr.name)
              return String(v ?? '') === parsed.attr.value
            } catch {
              return false
            }
          }
          return true
        })
        for (const el of matches) next.push(el)
      }
    }
    current = next
  }
  return current
}

function applyBindings(doc: any, descriptor: LowerThirdDescriptorV2, params: Record<string, string>) {
  for (const binding of descriptor.bindings || []) {
    const value = params[binding.param]
    if (value == null) continue
    const nodes = selectAll(doc, binding.selector)
    for (const node of nodes) {
      for (const [attr, tpl] of Object.entries(binding.attributes || {})) {
        if (attr === 'textContent') {
          while (node.firstChild) node.removeChild(node.firstChild)
          node.appendChild(doc.createTextNode(String(value)))
        } else {
          const template = String(tpl ?? '')
          const applied = template.includes('{value}') ? template.split('{value}').join(String(value)) : String(value)
          node.setAttribute(attr, applied)
        }
      }
    }
  }
}

function resolveSvgMarkup(svgMarkupRaw: string, descriptor: LowerThirdDescriptor, params: Record<string, string>): string {
  const { doc, svgMarkup } = parseSvgOrThrow(svgMarkupRaw)

  if (isDescriptorV2(descriptor)) {
    applyBindings(doc, descriptor, params)
    const serializer = new XMLSerializer()
    return serializer.serializeToString(doc)
  }

  const fields = (descriptor as any).fields || []
  const colors = (descriptor as any).colors || []

  for (const f of fields as LowerThirdDescriptorField[]) {
    const el = findElementById(doc, f.id)
    if (!el) throw new DomainError('SVG is missing a required id.', 'invalid_svg', 400)
    const value = params[f.id] != null ? String(params[f.id]) : ''
    // Replace children to keep templates deterministic (avoid nested tspans in v1).
    while (el.firstChild) el.removeChild(el.firstChild)
    el.appendChild(doc.createTextNode(value))
  }

  for (const c of colors as LowerThirdDescriptorColor[]) {
    const el = findElementById(doc, c.id)
    if (!el) throw new DomainError('SVG is missing a required id.', 'invalid_svg', 400)
    const value = normalizeHexColor(params[c.id])
    const tag = String(el.tagName || '').toLowerCase()
    const hasAttr = (name: string) => {
      try {
        if (!el || typeof el.getAttribute !== 'function') return false
        const v = el.getAttribute(name)
        return v != null && v !== ''
      } catch {
        return false
      }
    }
    if (tag === 'stop' || hasAttr('stop-color')) el.setAttribute('stop-color', value)
    else if (hasAttr('fill')) el.setAttribute('fill', value)
    else el.setAttribute('fill', value)
  }

  const serializer = new XMLSerializer()
  // Preserve cleaned SVG so we don't re-introduce XML headers.
  void svgMarkup
  return serializer.serializeToString(doc)
}

export function validateLowerThirdTemplateDraft(input: { svgMarkup: any; descriptorJson: any }): { svgMarkup: string; descriptor: LowerThirdDescriptor } {
  const svgMarkupRaw = String(input.svgMarkup ?? '')
  const descriptor = normalizeDescriptor(input.descriptorJson)

  const { doc, svgMarkup } = parseSvgOrThrow(svgMarkupRaw)

  if (isDescriptorV2(descriptor)) {
    // Validate selectors match at least one node (fail fast).
    for (const binding of descriptor.bindings || []) {
      const nodes = selectAll(doc, binding.selector)
      if (!nodes.length) throw new DomainError(`Selector matched no nodes: ${binding.selector}`, 'invalid_descriptor', 400)
    }
    // Ensure defaults can produce a resolved SVG.
    const defaults = resolveParams(descriptor, {})
    resolveSvgMarkup(svgMarkup, descriptor, defaults)
    return { svgMarkup, descriptor }
  }

  const ids = [
    ...(((descriptor as any).fields || []) as LowerThirdDescriptorField[]).map((f) => f.id),
    ...(((descriptor as any).colors || []) as LowerThirdDescriptorColor[]).map((c) => c.id),
  ]
  for (const id of ids) {
    const el = findElementById(doc, id)
    if (!el) throw new DomainError(`SVG is missing id="${id}"`, 'invalid_svg', 400)
  }

  // Ensure defaults can produce a resolved SVG (basic determinism check).
  const defaults = resolveParams(descriptor, (descriptor as any).defaults || {})
  resolveSvgMarkup(svgMarkup, descriptor, defaults)

  return { svgMarkup, descriptor }
}

export async function resolveLowerThirdSvgForUser(input: {
  presetId?: any
  templateKey?: any
  templateVersion?: any
  params?: any
}, userId: number): Promise<{ svg: string; templateKey: string; templateVersion: number; params: Record<string, string> }> {
  if (!userId) throw new ForbiddenError()
  const presetIdRaw = input.presetId
  if (presetIdRaw != null && presetIdRaw !== '') {
    const presetId = Number(presetIdRaw)
    if (!Number.isFinite(presetId) || presetId <= 0) throw new DomainError('bad_id', 'bad_id', 400)
    const cfg = await repo.getConfigById(presetId)
    if (!cfg) throw new NotFoundError('not_found')
    const admin = await isSiteAdmin(userId)
    ensureConfigAccess(cfg, userId, admin)
    if (cfg.archived_at) throw new DomainError('archived', 'archived', 400)
    const templateKey = String(cfg.template_key || '')
    const templateVersion = Number(cfg.template_version || 0)
    const tpl = await repo.getTemplateByKeyVersion(templateKey, templateVersion)
    if (!tpl || tpl.archived_at) throw new NotFoundError('template_not_found')
    const descriptor = normalizeDescriptor((tpl as any).descriptor_json)
    const params = resolveParams(descriptor, normalizeParams((cfg as any).params_json))
    const svg = resolveSvgMarkup(tpl.svg_markup, descriptor, params)
    return { svg, templateKey, templateVersion, params }
  }

  const templateKey = normalizeTemplateKey(input.templateKey)
  const templateVersion = normalizeVersion(input.templateVersion)
  const tpl = await repo.getTemplateByKeyVersion(templateKey, templateVersion)
  if (!tpl || tpl.archived_at) throw new NotFoundError('template_not_found')
  const descriptor = normalizeDescriptor((tpl as any).descriptor_json)
  const params = resolveParams(descriptor, normalizeParams(input.params))
  const svg = resolveSvgMarkup(tpl.svg_markup, descriptor, params)
  return { svg, templateKey, templateVersion, params }
}

// Server-side helper for production rendering: resolve from a snapshot without re-checking preset ownership.
// This keeps "preview == render" while ensuring productions are stable even if presets change later.
export async function resolveLowerThirdSvgFromSnapshot(input: {
  templateKey?: any
  templateVersion?: any
  params?: any
}): Promise<{ svg: string; templateKey: string; templateVersion: number; params: Record<string, string> }> {
  const templateKey = normalizeTemplateKey(input.templateKey)
  const templateVersion = normalizeVersion(input.templateVersion)
  const tpl = await repo.getTemplateByKeyVersion(templateKey, templateVersion)
  if (!tpl || tpl.archived_at) throw new NotFoundError('template_not_found')
  const descriptor = normalizeDescriptor((tpl as any).descriptor_json)
  const params = resolveParams(descriptor, normalizeParams(input.params))
  const svg = resolveSvgMarkup(tpl.svg_markup, descriptor, params)
  return { svg, templateKey, templateVersion, params }
}
