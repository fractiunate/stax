const fields = [
  'project',
  'customer_id',
  'stage',
  'cloud',
  'default_location',
  'resource_group_name',
  'public_cloud_flag',
  'dns_zone_name',
  'dns_zone_resource_group_name',
  'state_storage_account_name',
  'state_container_name',
  'state_resource_group_name',
  'state_bucket_name',
  'state_region',
  'aws_endpoint_url',
  'aws_endpoint_url_s3',
  'aws_endpoint_url_sts',
  'aws_endpoint_url_iam',
  'aws_s3_compatible',
  'aws_skip_sts_check',
  'state_use_lockfile',
  'state_use_path_style',
];

const requiredCommon = ['project', 'customer_id', 'stage', 'cloud', 'default_location', 'public_cloud_flag'];
const requiredAzure = [
  'resource_group_name',
  'dns_zone_name',
  'dns_zone_resource_group_name',
  'state_storage_account_name',
  'state_container_name',
  'state_resource_group_name',
];
const requiredAws = ['state_bucket_name', 'state_region'];
// State-backend configs only describe the backend; application and DNS fields stay optional.
// The container is optional so an account can be deployed before any project uses it.
const requiredStateAzure = ['default_location', 'state_resource_group_name', 'state_storage_account_name'];
const requiredStateAws = ['state_bucket_name'];
const profiles = new Set(['deploy', 'state']);
const fieldSet = new Set(fields);
const booleanFields = new Set(['public_cloud_flag', 'aws_s3_compatible', 'aws_skip_sts_check', 'state_use_lockfile', 'state_use_path_style']);
const endpointFields = ['aws_endpoint_url', 'aws_endpoint_url_s3', 'aws_endpoint_url_sts', 'aws_endpoint_url_iam'];
// Optional AWS-only options with the value that keeps today's behaviour (AWS endpoints, S3 native locking, STS check).
const awsOptionDefaults = {
  aws_endpoint_url: '',
  aws_endpoint_url_s3: '',
  aws_endpoint_url_sts: '',
  aws_endpoint_url_iam: '',
  aws_s3_compatible: 'false',
  aws_skip_sts_check: 'false',
  state_use_lockfile: 'true',
  state_use_path_style: 'false',
};

function isMapping(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isAbsent(value) {
  return value === null || value === undefined || (typeof value === 'string' && !/[\r\n]/.test(value) && value.trim() === '');
}

function validateValue(field, value, source) {
  if (typeof value === 'string' && /[\r\n]/.test(value)) {
    throw new Error(`${source}.${field} must not contain newlines (unsafe for workflow environment data)`);
  }
  if (isAbsent(value)) return undefined;
  if (booleanFields.has(field)) {
    if (value === true || value === false || value === 'true' || value === 'false') {
      return String(value);
    }
    throw new Error(`${source}.${field} must be a boolean or 'true'/'false' string`);
  }
  if (typeof value !== 'string') {
    throw new Error(`${source}.${field} must be a string`);
  }
  if (endpointFields.includes(field)) return validateEndpointUrl(field, value.trim(), source);
  return value;
}

// Endpoint URLs end up in AWS_ENDPOINT_URL_* for Terraform/OpenTofu and the AWS CLI.
// Credentials never belong in them, and plain http is only accepted for local test servers.
function validateEndpointUrl(field, value, source) {
  if (value.includes('@')) {
    throw new Error(`${source}.${field} must not contain credentials or '@'`);
  }
  if (/[?#]/.test(value)) {
    throw new Error(`${source}.${field} must not contain a query string or fragment`);
  }
  if (/[\s\\]/.test(value)) {
    throw new Error(`${source}.${field} must not contain whitespace or backslashes`);
  }
  try {
    new URL(value);
  } catch {
    throw new Error(`${source}.${field} must be an absolute URL such as https://s3.example.com (received '${value}')`);
  }
  if (!value.startsWith('https://') && !/^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::[0-9]+)?(?:\/|$)/.test(value)) {
    throw new Error(`${source}.${field} must use https (http is only allowed for localhost / 127.0.0.1 / [::1])`);
  }
  return value;
}

function readDeployment(mapping, source, label) {
  if (mapping === null || mapping === undefined) return {};
  if (!isMapping(mapping)) throw new Error(`${source}: ${label} must be a mapping`);
  const values = {};
  for (const [field, rawValue] of Object.entries(mapping)) {
    if (!fieldSet.has(field)) throw new Error(`${source}: unknown ${label} key '${field}'`);
    const value = validateValue(field, rawValue, `${source}: ${label}`);
    if (value !== undefined) values[field] = value;
  }
  return values;
}

// Later selected documents win; missing fields fall back to GitHub variables.
// profile 'deploy' (default) validates stack deployments; 'state' validates a state-backend config.
export function resolveDeploymentContext({ documents, variables = {}, skipCloudValidation = false, profile = 'deploy' }) {
  if (!Array.isArray(documents)) throw new Error('documents must be an array of config documents');
  if (!isMapping(variables)) throw new Error('variables must be a mapping of GitHub variables');
  if (!profiles.has(profile)) throw new Error(`profile must be 'deploy' or 'state' (received '${profile}')`);

  const configured = {};
  for (const [index, document] of documents.entries()) {
    if (!isMapping(document)) throw new Error(`documents[${index}] must be a config document`);
    const source = document.sourceFile || `documents[${index}]`;
    if (profile === 'state' && Array.isArray(document.stacks) && document.stacks.length > 0) {
      throw new Error(`${source}: state configs must not define stacks; deploy stacks with a separate config`);
    }
    const selected = readDeployment(document.deployment, source, 'deployment');
    Object.assign(configured, selected);
  }

  const result = {};
  for (const field of fields) {
    const variableName = field.toUpperCase();
    if (configured[field] !== undefined) {
      result[variableName] = configured[field];
      continue;
    }
    const rawVariable = field === 'project' && !isAbsent(variables.project)
      ? variables.project
      : variables[variableName];
    result[variableName] = validateValue(field, rawVariable, `GitHub variable ${variableName}`) ?? '';
  }

  const cloud = result.CLOUD.toLowerCase();
  if (cloud && !['azure', 'aws'].includes(cloud)) {
    throw new Error(`deployment.cloud / GitHub variable CLOUD must be 'azure' or 'aws' (received '${result.CLOUD}')`);
  }
  result.CLOUD = cloud;
  let required;
  if (profile === 'state') {
    // Backend coordinates are the whole point of a state config, so they are always enforced.
    required = ['cloud', ...(cloud === 'aws' ? requiredStateAws : cloud === 'azure' ? requiredStateAzure : [])];
  } else {
    required = [...requiredCommon];
    if (!skipCloudValidation) required.push(...(cloud === 'aws' ? requiredAws : cloud === 'azure' ? requiredAzure : []));
  }
  for (const field of required) {
    if (!result[field.toUpperCase()]) {
      throw new Error(`Missing deployment.${field}; set it in deployment or GitHub variable ${field.toUpperCase()}`);
    }
  }
  if (profile === 'state' && cloud === 'aws' && !result.STATE_REGION && !result.DEFAULT_LOCATION) {
    throw new Error('Missing deployment.state_region (or deployment.default_location) for the AWS state bucket');
  }

  if (!skipCloudValidation && cloud !== 'aws') {
    const awsOnly = Object.entries(awsOptionDefaults)
      .filter(([field, fallback]) => result[field.toUpperCase()] && result[field.toUpperCase()] !== fallback)
      .map(([field]) => field);
    if (awsOnly.length > 0) {
      throw new Error(`deployment.${awsOnly.join(', deployment.')} require cloud 'aws' (cloud is '${cloud || 'unset'}'); remove them or the matching GitHub variables`);
    }
  }

  if (cloud === 'azure' && result.STATE_STORAGE_ACCOUNT_NAME) {
    const name = result.STATE_STORAGE_ACCOUNT_NAME.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (name.length < 3 || name.length > 24) {
      throw new Error(`deployment.state_storage_account_name / GitHub variable STATE_STORAGE_ACCOUNT_NAME must normalize to 3-24 lowercase letters or digits (got '${name}')`);
    }
    result.STATE_STORAGE_ACCOUNT_NAME = name;
  }
  return result;
}
