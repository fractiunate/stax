import { ITerraformConfig } from './types.js'

function invalidPackerField(
  config: ITerraformConfig,
  field: 'packer_directory' | 'packer_template' | 'packer_version',
  reason: string
): never {
  throw new Error(
    `Packer stack "${config.id}" has invalid ${field}: ${reason}.`
  )
}

function containsAsciiControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const characterCode = value.charCodeAt(index)
    if (characterCode <= 0x1f || characterCode === 0x7f) return true
  }

  return false
}

function validateRelativePosixPath(
  config: ITerraformConfig,
  field: 'packer_directory' | 'packer_template',
  value: unknown
): void {
  if (typeof value !== 'string' || value.trim() === '') {
    invalidPackerField(config, field, 'must be a nonempty string')
  }
  if (/^[A-Za-z]:/.test(value)) {
    invalidPackerField(config, field, 'must be repository-relative')
  }
  if (containsAsciiControlCharacter(value)) {
    invalidPackerField(config, field, 'must not contain control characters')
  }
  if (value.startsWith('/')) {
    invalidPackerField(config, field, 'must be repository-relative')
  }
  if (value.includes('\\')) {
    invalidPackerField(config, field, 'must use POSIX separators')
  }

  const segments = value.split('/')
  if (segments.includes('..')) {
    invalidPackerField(config, field, 'must not contain a ".." segment')
  }
  if (segments.includes('')) {
    invalidPackerField(config, field, 'must not contain empty path segments')
  }
}

const GALLERY_FIELDS = [
  'image_resource_group_name',
  'gallery_name',
  'image_definition_name',
  'image_version',
  'target_regions'
] as const

function buildTargetOf(config: ITerraformConfig): 'azure' | 'hetzner' | 'aws' {
  if (config.build_target === undefined) return 'azure'
  if (
    config.build_target !== 'azure' &&
    config.build_target !== 'hetzner' &&
    config.build_target !== 'aws'
  ) {
    throw new Error(
      `Packer stack "${config.id}" has invalid build_target: must be azure, hetzner, or aws.`
    )
  }
  return config.build_target
}

export function validatePackerConfig(
  config: ITerraformConfig,
  warn: (message: string) => void = () => undefined
): void {
  if (config.type !== 'packer') return

  validateRelativePosixPath(config, 'packer_directory', config.packer_directory)
  if (
    typeof config.packer_version !== 'string' ||
    !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(config.packer_version)
  ) {
    invalidPackerField(
      config,
      'packer_version',
      'must be an exact numeric Major.Minor.Patch version'
    )
  }

  if (config.packer_template !== undefined) {
    validateRelativePosixPath(config, 'packer_template', config.packer_template)
  }

  const buildTarget = buildTargetOf(config)
  if (buildTarget === 'aws') {
    warn(
      `Packer stack "${config.id}" uses build_target aws, which is reserved and not implemented.`
    )
  }

  for (const field of GALLERY_FIELDS) {
    if (config[field] !== undefined) {
      warn(
        `Packer stack "${config.id}" field ${field} is a deprecated alias of azure.${field}.`
      )
    }
    if (
      config.azure?.[field] !== undefined &&
      config[field] !== undefined &&
      JSON.stringify(config.azure[field]) !== JSON.stringify(config[field])
    ) {
      throw new Error(
        `Packer stack "${config.id}" azure.${field} conflicts with deprecated alias ${field}.`
      )
    }
  }

  if (buildTarget === 'hetzner') {
    if (!config.hetzner || typeof config.hetzner !== 'object') {
      throw new Error(
        `Packer stack "${config.id}" build_target hetzner requires a hetzner object.`
      )
    }
    if (!config.hetzner.location || !config.hetzner.server_type) {
      throw new Error(
        `Packer stack "${config.id}" hetzner.location and hetzner.server_type are required.`
      )
    }
  } else if (config.hetzner !== undefined) {
    throw new Error(
      `Packer stack "${config.id}" hetzner does not apply when build_target is ${buildTarget}.`
    )
  }

  if (buildTarget !== 'aws' && config.aws !== undefined) {
    throw new Error(
      `Packer stack "${config.id}" aws does not apply when build_target is ${buildTarget}.`
    )
  }
  if (buildTarget === 'aws' && !config.aws?.regions?.length) {
    throw new Error(
      `Packer stack "${config.id}" build_target aws requires aws.regions.`
    )
  }
}
