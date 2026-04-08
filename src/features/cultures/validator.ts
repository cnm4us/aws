import Ajv2020, { type ErrorObject } from 'ajv/dist/2020'
import {
  CULTURE_DEFINITION_SCHEMA_V1,
  CULTURE_DEFINITION_SCHEMA_V1_ID,
} from './schema-v1'
import {
  type CultureDefinitionInput,
  type CultureDefinitionMetadataContext,
  type CultureDefinitionV1,
  type CultureDefinitionValidationError,
  type CultureDefinitionValidationResult,
} from './types'
import { normalizeCultureDefinitionInput } from './normalize'

const ajv = new Ajv2020({
  allErrors: true,
  strict: false,
  allowUnionTypes: true,
  coerceTypes: false,
  useDefaults: false,
  removeAdditional: false,
})

const validateCultureDefinitionV1Schema = ajv.compile(CULTURE_DEFINITION_SCHEMA_V1)

function toDotPath(pointer: string): string {
  if (!pointer) return ''
  return pointer
    .split('/')
    .slice(1)
    .map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'))
    .join('.')
}

function normalizeAjvErrors(errors: ErrorObject[] | null | undefined): CultureDefinitionValidationError[] {
  if (!Array.isArray(errors) || !errors.length) {
    return [{ path: '', keyword: 'validation', message: 'Validation failed' }]
  }

  return errors.map((err) => {
    const missingProp =
      err.keyword === 'required' && err.params && typeof (err.params as any).missingProperty === 'string'
        ? String((err.params as any).missingProperty)
        : null

    const path = missingProp
      ? `${toDotPath(err.instancePath)}${toDotPath(err.instancePath) ? '.' : ''}${missingProp}`
      : toDotPath(err.instancePath)

    return {
      path,
      keyword: String(err.keyword || 'validation'),
      message: String(err.message || 'Invalid value'),
    }
  })
}

export function validateCultureDefinitionV1(
  input: unknown,
  context: CultureDefinitionMetadataContext = {}
): CultureDefinitionValidationResult {
  const normalized = normalizeCultureDefinitionInput(input, context)
  const valid = validateCultureDefinitionV1Schema(normalized)
  if (!valid) {
    return {
      ok: false,
      errors: normalizeAjvErrors(validateCultureDefinitionV1Schema.errors),
    }
  }
  return { ok: true, value: normalized as CultureDefinitionV1 }
}

export function assertCultureDefinitionV1(
  input: unknown,
  context: CultureDefinitionMetadataContext = {}
): CultureDefinitionV1 {
  const result = validateCultureDefinitionV1(input, context)
  if (result.ok) return result.value
  const err = new Error('invalid_culture_definition_v1') as Error & {
    code?: string
    details?: CultureDefinitionValidationError[]
  }
  err.code = 'invalid_culture_definition_v1'
  err.details = result.errors
  throw err
}

export function getCultureDefinitionSchemaV1Id(): string {
  return CULTURE_DEFINITION_SCHEMA_V1_ID
}

export function normalizeCultureDefinitionForValidation(
  input: unknown,
  context: CultureDefinitionMetadataContext = {}
): CultureDefinitionInput {
  return normalizeCultureDefinitionInput(input, context)
}
