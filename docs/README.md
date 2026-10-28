# STAX Framework documentation

The canonical [Zensical](https://zensical.org/) documentation site for **STAX Framework**, a modern open-source opinionated GitHub Workflow Framework to combine and deploy all of your cloud infrastructure and services, developed by [GEBIT Solutions](https://www.gebit.de/). Framework interfaces and examples currently remain illustrative.

## Preview

Install [uv](https://docs.astral.sh/uv/getting-started/installation/), then run from the repository's `docs/` folder:

```sh
uv sync --locked
uv run zensical serve --dev-addr 127.0.0.1:8017
```

Open <http://127.0.0.1:8017/>. Zensical reloads the preview when you edit the documentation.

## Build

```sh
uv run zensical build --clean
```

The static website is written to `site/`.

## Publish to GitHub Pages

The repository's `.github/workflows/docs.yml` selects `configs/stax-docs.yaml` and deploys through STAX's reusable setup, deployment levels, and `github-pages-site-deploy` stack workflow. This is independent of infrastructure and service configurations.

Pull requests build a `preview` version without pushing archive history or publishing Pages. On `main`, `release.yml` supplies the release version and prepared release-commit SHA after approval; documentation deployment still gates release and CLI publication. The shared action installs locked dependencies and overrides the canonical URL without changing `zensical.toml`.

Commits without a new release do not deploy automatically. Manual `docs.yml` runs default to rebuilding the latest published release tag, not the current `main` source. Supply `release-version` and `source-ref` to select another version and source commit explicitly. `dry-run` prevents publication for both reusable and manual calls; non-main runs always build only.

Enable repository Pages with **GitHub Actions** as its source, configure the custom domain and HTTPS, and protect the `github-pages` deployment environment. The `docs` environment needs no Azure credentials. Versioned publication uses the existing release GitHub App credentials with repository Contents write access to maintain `gh-pages`; PR builds use read-only checkout credentials. The nested workflow chain still needs `pages: write` and `id-token: write`, without expanding its `GITHUB_TOKEN` Contents permission.

Forward release App secrets at every reusable-workflow boundary with `secrets: inherit`, including `docs.yml` → deployment levels → stack → Pages. Without forwarding, a downstream job can see the repository App ID variable but receives no private key.

### Versioned releases

The Zensical-compatible [mike fork](https://github.com/squidfunk/mike) is pinned by commit in `pyproject.toml` and `uv.lock`. The build fetches the complete generated archive from `gh-pages`, adds the selected version, and uploads the complete tree through the existing Pages stack. Archive publication and Pages deployment share a concurrency group so competing releases cannot build from the same stale history.

- Release pages live at `/<version>/`; `/latest/` and the site root redirect to the newest version.
- The native selector retains the current page when switching versions and marks the current release with `LATEST`.
- New releases preserve older generated pages. Rebuilding an older version does not move `latest` backward.
- PRs and dry runs can read existing versions but never push archive changes. A missing archive branch is a first deployment; a failed history fetch stops the build.

The first versioned deployment starts the archive; it does not reconstruct earlier unversioned releases. A source tag must contain the pinned mike dependency and selector configuration to rebuild it with this workflow. Do not delete `gh-pages`: GitHub Pages serves the uploaded artifact, but this branch preserves the history needed for the next deployment.

For a local single-version content preview, continue using `zensical serve` above. The selector needs a generated `versions.json`, so verify version switching against a complete archive rather than the single-version development server.

## Files

- `zensical.toml`: site title, navigation, and light/dark themes.
- `docs/`: the landing page, global and project-local CLI installation guide, configuration overview, Why STAX?, supported stack types, state backends, and a title-only placeholder for Your first config.
- `pyproject.toml` and `uv.lock`: documentation dependency and locked versions.
- `docs/assets/stax-logo.png` and `docs/assets/stax-favicon.png`: transparent header logo and favicon derived from the supplied Downloads image. The header symbol displays in white in dark mode through `docs/stylesheets/extra.css`.

## Design customization

The Astro-inspired layout uses neutral charcoal surfaces, a white homepage title, muted gray text, teal links, and a neutral gray active-navigation highlight. Dark mode is the initial theme for new visitors; the theme toggle also provides a light palette. `docs/stylesheets/extra.css` controls the header, search sizing, collapsible sidebar sections, indented child links, typography, responsive hero, and feature cards. No template overrides or custom JavaScript are required.

Keep the desktop sidebar height automatic so Zensical can shorten its scroll area above the footer. A viewport-based minimum height pushes the sticky navigation behind the header at the bottom of the page. When changing navigation styles, check the last section at the page bottom in a short desktop viewport and in the mobile drawer.

The slim parallelogram Get started button follows the teal theme accent. The transparent project logo remains white in dark mode and black in light mode. The previous red highlights, neon gradients, title backlight, and blue-gray surface overrides have been removed.

The homepage lives in `docs/index.md`; its hero and cards use semantic HTML inside the `stax-home` wrapper, with Markdown admonitions outside it. The supported technology checklist lives in `docs/stack-types.md`. Keep existing content when extending the navigation in `zensical.toml`; new sections currently use heading-only placeholder pages.
