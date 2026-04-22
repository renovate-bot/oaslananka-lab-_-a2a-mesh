# Azure DevOps Pipelines

This repository keeps its Azure DevOps YAML definitions in this folder.

## Files

- `../azure-pipelines.yml` — default CI entrypoint for Azure DevOps auto-detection
- `azure-pipelines-ci.yml` — shared CI wrapper used for build, docs, tests, and coverage
- `azure-pipelines-pr.yml` — PR validation pipeline with changeset enforcement
- `azure-pipelines-release.yml` — manual release pipeline for changesets and npm publish
- `templates/ci-job.yml` — reusable CI job template

## Bootstrap with Azure CLI

From the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup-azure-devops.ps1 `
  -Organization https://dev.azure.com/oaslananka `
  -Project open-source `
  -QueueCiRun
```

The script installs or upgrades the `azure-devops` Azure CLI extension, configures
the default organization and project, and then creates or updates the CI, PR, and
release pipelines against the YAML files in this repo.

## Secrets

Release and publish jobs use Doppler as the runtime secret source. CI platforms
only need the Doppler bootstrap variables:

- `DOPPLER_TOKEN` as a secret value
- `DOPPLER_PROJECT` such as `all`
- `DOPPLER_CONFIG` such as `main`

The Doppler config must contain `NPM_TOKEN` before npm publishing is enabled.
Future provider or marketplace tokens should also live in Doppler instead of
being copied into each CI platform.

## Useful commands

```bash
az pipelines list
az pipelines run --name a2a-mesh-ci --branch main
az pipelines run --name a2a-mesh-release --branch main
python scripts/azuredevops.py health
python scripts/azuredevops.py status
```
