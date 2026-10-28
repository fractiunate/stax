#!/usr/bin/env bash
# Checks jobs, artifacts and stored outputs of the current E2E workflow run.
# Needs GH_TOKEN plus the default GITHUB_REPOSITORY, GITHUB_RUN_ID and GITHUB_RUN_ATTEMPT.
#
#   run.sh jobs <name regex> <conclusion> <count>   exactly <count> jobs matching the regex have the conclusion
#   run.sh not-run <name regex>                     no job matching the regex succeeded
#   run.sh artifact <name regex> <directory>        downloads the newest artifact matching the regex
#   run.sh variable <environment> <name> <value>    the Environment variable has the value
#   run.sh delete-variables <environment> <name>... deletes the variables; missing ones are fine
set -euo pipefail

repo="repos/${GITHUB_REPOSITORY}"
run="${repo}/actions/runs/${GITHUB_RUN_ID}"

jobs_json() {
  gh api --paginate "${run}/attempts/${GITHUB_RUN_ATTEMPT}/jobs" --jq '.jobs[] | {id, name, conclusion}' | jq -s .
}

fail() {
  echo "::error::$*"
  exit 1
}

command="${1:?command required}"
shift
case "${command}" in
  jobs)
    pattern="$1" conclusion="$2" expected="$3"
    # Dependencies have finished, but the list endpoint can retain stale job
    # conclusions. Refresh matching pending jobs through their individual endpoint.
    for attempt in {1..13}; do
      all="$(jobs_json)"
      while read -r job_id; do
        job="$(gh api "${repo}/actions/jobs/${job_id}" --jq '{id, name, conclusion}')"
        all="$(jq --argjson job "${job}" 'map(if .id == $job.id then $job else . end)' <<<"${all}")"
      done < <(jq -r --arg pattern "${pattern}" '.[] | select((.name | test($pattern)) and .conclusion == null) | .id' <<<"${all}")
      pending="$(jq --arg pattern "${pattern}" '[.[] | select((.name | test($pattern)) and .conclusion == null)] | length' <<<"${all}")"
      if [[ "${pending}" == 0 || "${attempt}" == 13 ]]; then break; fi
      echo "Waiting for final Jobs API conclusions matching '${pattern}' (${pending} pending)"
      sleep 5
    done
    count="$(jq --arg pattern "${pattern}" --arg conclusion "${conclusion}" \
      '[.[] | select((.name | test($pattern)) and .conclusion == $conclusion)] | length' <<<"${all}")"
    if [[ "${count}" != "${expected}" || "${pending}" != 0 ]]; then
      jq -r '.[] | "\(.conclusion // "running")\t\(.name)"' <<<"${all}"
      fail "expected ${expected} job(s) matching '${pattern}' with conclusion ${conclusion}, found ${count}"
    fi
    echo "${count} job(s) matching '${pattern}': ${conclusion}"
    ;;
  not-run)
    succeeded="$(jobs_json | jq -r --arg pattern "$1" '.[] | select((.name | test($pattern)) and .conclusion == "success") | .name')"
    [[ -z "${succeeded}" ]] || fail "job(s) must not run: ${succeeded}"
    echo "No job matching '$1' ran"
    ;;
  artifact)
    pattern="$1" directory="$2"
    name="$(gh api --paginate "${run}/artifacts" --jq '.artifacts[] | [.created_at, .name] | @tsv' |
      sort -r | cut -f2 | grep -E "${pattern}" | head -n1 || true)"
    [[ -n "${name}" ]] || fail "no artifact matches ${pattern}"
    gh run download "${GITHUB_RUN_ID}" --repo "${GITHUB_REPOSITORY}" --name "${name}" --dir "${directory}"
    echo "Downloaded ${name}"
    ;;
  variable)
    environment="$1" name="$2" expected="$3"
    actual="$(gh api "${repo}/environments/${environment}/variables/${name}" --jq .value)"
    [[ "${actual}" == "${expected}" ]] || fail "${name} is '${actual}', expected '${expected}'"
    echo "${name} = ${actual}"
    ;;
  delete-variables)
    environment="$1"
    shift
    for name in "$@"; do
      if response="$(gh api --method DELETE "${repo}/environments/${environment}/variables/${name}" 2>&1)"; then
        echo "Deleted ${name}"
      elif grep -q 'HTTP 404' <<<"${response}"; then
        echo "${name} does not exist"
      else
        fail "deleting ${name}: ${response}"
      fi
    done
    ;;
  *)
    fail "unknown command ${command}"
    ;;
esac
