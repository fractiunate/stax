import { apply_stack_filter, generate_stackfilter } from './stackFilterN.js'
import { generate_layerdeployment } from './layerDeploymentN.js'
import * as core from '@actions/core'
import {
  IDeployConfigDocument,
  IExternalRepos,
  ITerraformConfig,
  ITerraformLayerConfig
} from './types.js'
import {
  convert_implicit_to_explicit_dependencies,
  prune_external_dependencies
} from './stackDependencyN.js'
import { evaluateRunner } from './evaluateRunner.js'
import { mergeDeployConfigDocuments } from './mergeConfigs.js'
import { resolveSourceVersions } from './resolveSourceVersion.js'
import { validatePackerConfig } from './validatePackerConfig.js'
import { validateGitHubPagesConfig } from './validateGitHubPagesConfig.js'
import { validateStackFolder } from './validateStackFolder.js'

/**
 * The main function for the action.
 *
 * @returns Resolves when the action is complete.
 */
export async function run(): Promise<void> {
  core.info('Starting the action...')

  try {
    const deploy_depth: string = core.getInput('deploy-depth', {
      required: false
    })

    const stack_filter: string = core.getInput('stack-filter', {
      required: false
    })

    const deploy_config_json: string = core.getInput('deploy-config', {
      required: false
    })

    const deploy_configs_json: string = core.getInput('deploy-configs', {
      required: false
    })

    const global_vars_JSON: string = core.getInput('global-vars', {
      required: false
    })

    let deploy_depth_int: number
    if (deploy_depth === '') {
      deploy_depth_int = 14
      core.info('No deploy-depth provided. Defaulting to 14.')
    } else {
      try {
        deploy_depth_int = parseInt(deploy_depth)
        if (isNaN(deploy_depth_int)) {
          throw new Error('Deploy-depth is not a number.')
        }
      } catch (_e) {
        throw new Error(`Cannot parse deploy-depth to integer.`, { cause: _e })
      }
    }
    let deploy_config: Array<ITerraformConfig> = []

    try {
      if (deploy_config_json === '') {
        deploy_config = []
        core.info('No deploy-config provided. Skipping...')
      } else {
        deploy_config = JSON.parse(deploy_config_json)
      }
    } catch (_e) {
      throw new Error(
        `Cannot parse JSON deploy-config.
    Make sure you add the following to this action:

    with:
          deploy-config: \${{ toJSON(steps.read-deploy-config.outputs.deploy-config) }}
    `,
        { cause: _e }
      )
    }

    let global_vars: Record<string, string | boolean> = {}
    try {
      if (global_vars_JSON === '') {
        global_vars = {}
        core.info('No global-vars provided. Skipping...')
      } else {
        global_vars = JSON.parse(global_vars_JSON) as Record<
          string,
          string | boolean
        >
      }
    } catch (e) {
      throw new Error(
        `Cannot parse JSON global-vars.
    Make sure you add the following to this action:

    with:
          global-vars: \${{ toJSON(inputs.global-vars) }}
    `,
        { cause: e }
      )
    }

    const external_repos_JSON: string = core.getInput('external-repos', {
      required: false
    })

    let external_repos: IExternalRepos = {}
    try {
      if (
        external_repos_JSON === '' ||
        external_repos_JSON === '{}' ||
        external_repos_JSON === '[]'
      ) {
        external_repos = {}
        core.info(
          'No external-repos provided. Skipping source_version resolution...'
        )
      } else {
        external_repos = JSON.parse(external_repos_JSON) as IExternalRepos
      }
    } catch (e) {
      throw new Error(
        `Cannot parse JSON external-repos.
    Make sure you add the following to this action:

    with:
          external-repos: \${{ steps.read-deploy-config.outputs.external-repos }}
    `,
        { cause: e }
      )
    }

    let deploy_configs: IDeployConfigDocument[] = []
    let use_deploy_configs = false
    try {
      if (deploy_configs_json !== '' && deploy_configs_json !== '[]') {
        const parsed = JSON.parse(deploy_configs_json)
        if (Array.isArray(parsed) && parsed.length > 0) {
          deploy_configs = parsed as IDeployConfigDocument[]
          use_deploy_configs = true
        }
      }
    } catch (_e) {
      throw new Error(
        `Cannot parse JSON deploy-configs.
    Make sure you add the following to this action:

    with:
          deploy-configs: \${{ steps.read-deploy-config.outputs.deploy-configs }}
    `,
        { cause: _e }
      )
    }

    // Unify both inputs onto a single merge path (D2/D8): the new multi-document
    // input wins when present; otherwise the legacy scalar inputs are wrapped in
    // a single-element document array and run through the same merge logic.
    const documents: IDeployConfigDocument[] = use_deploy_configs
      ? deploy_configs
      : [
          {
            stacks: deploy_config,
            externalRepos: external_repos,
            sourceFile: 'deploy-config'
          }
        ]

    const merged = mergeDeployConfigDocuments(documents)
    deploy_config = merged.stacks
    external_repos = merged.externalRepos
    validateGitHubPagesConfig(deploy_config, global_vars)

    for (const config of deploy_config) {
      validatePackerConfig(config, (message) => core.warning(message))
      validateStackFolder(config)
    }

    deploy_config = convert_implicit_to_explicit_dependencies(deploy_config)
    deploy_config = prune_external_dependencies(deploy_config)

    // Resolve source_version from externalRepos.targetRevision for stacks
    // that specify source_repo but omit source_version
    if (Object.keys(external_repos).length > 0) {
      resolveSourceVersions(deploy_config, external_repos)
      core.info('Resolved source_version from external-repos where applicable.')
    }

    // With no explicit filter, evaluate conditions against all stacks rather than
    // an empty selection. A condition may exclude every stack.
    const evaluate_all_stacks =
      stack_filter === '' && deploy_config.some((config) => config.if)
    const expanded_stack_filter: string[] = generate_stackfilter(
      deploy_config,
      evaluate_all_stacks
        ? deploy_config.map((config) => config.id).join(',')
        : stack_filter,
      global_vars
    )

    if (stack_filter !== '' || evaluate_all_stacks) {
      core.info(`Applying stack filter: ${expanded_stack_filter}`)
      deploy_config = apply_stack_filter(deploy_config, expanded_stack_filter)
      core.info(`Filtered deploy-config: ${JSON.stringify(deploy_config)}`)
    }

    let layer_deployments: ITerraformLayerConfig[][] = []

    for (let i = 0; i < deploy_depth_int; i++) {
      layer_deployments.push(
        generate_layerdeployment(
          deploy_config,
          i,
          global_vars,
          layer_deployments
        )
      )
    }

    const scheduled_stack_ids = new Set(
      layer_deployments.flat().map((stack) => stack.id)
    )
    const unscheduled_stacks = deploy_config.filter(
      (stack) => !scheduled_stack_ids.has(stack.id)
    )
    if (unscheduled_stacks.length > 0) {
      const details = unscheduled_stacks
        .map((stack) => {
          const dependencies = stack.depends_on ?? []
          const unresolved_dependencies = dependencies.filter(
            (dependency) => !scheduled_stack_ids.has(dependency)
          )
          return (
            `"${stack.id}" (depends_on: ${JSON.stringify(dependencies)}, ` +
            `unresolved: ${JSON.stringify(unresolved_dependencies)})`
          )
        })
        .join('; ')
      throw new Error(
        `Unable to schedule all stacks within ${deploy_depth_int} layers: ${details}`
      )
    }

    layer_deployments = layer_deployments.filter((layer) => layer.length > 0)

    const environment: string | undefined = global_vars['environment'] as
      string | undefined
    if (environment !== undefined) {
      for (let i = 0; i < layer_deployments.length; i++) {
        for (let j = 0; j < layer_deployments[i].length; j++) {
          if (layer_deployments[i][j]['runs-on'] == 'self-hosted') {
            layer_deployments[i][j]['runs-on'] = evaluateRunner(environment)
          }
        }
      }
    } else {
      core.info(
        'No environment variable set in global-vars, skipping runner evaluation.'
      )
    }

    core.setOutput('layer-deployments', JSON.stringify(layer_deployments))
    core.info('Action completed successfully.')
  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof Error) core.setFailed(error.message)
  }
}

run()
