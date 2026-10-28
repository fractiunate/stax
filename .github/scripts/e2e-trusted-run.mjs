// Fork PRs cannot access deploy credentials. Require real acceptance of the exact
// head commit by a maintainer-dispatched run in the upstream repository instead.
export function trustedDeployRun(runs, repository, sha) {
  return runs
    .filter(run => run.repository?.full_name === repository && run.head_sha === sha &&
      run.event === 'workflow_dispatch' && run.path === '.github/workflows/e2e-deploy.yml')
    .sort((a, b) => b.id - a.id)[0];
}
