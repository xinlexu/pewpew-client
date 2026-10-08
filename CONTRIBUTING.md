# Contributing to PewPew Cloud Client

This repository maintains the PewPew-specific client built on Clash Verge Rev. Use this repository's [issues](https://github.com/xinlexu/pewpew-client/issues) and pull requests for changes to this client. Keep upstream attribution and license notices intact.

## Development setup

Install Node.js 22, pnpm 10.33.0, the Rust toolchain specified by `rust-toolchain.toml`, and the [Tauri platform prerequisites](https://tauri.app/start/prerequisites/). Windows builds use the MSVC toolchain. Cross-platform source support does not mean a tested PewPew installer is available for every platform.

```sh
pnpm install --frozen-lockfile
pnpm run prebuild
pnpm dev
```

`prebuild` obtains the native sidecars needed for local development. The checked-in lockfiles and toolchain files define the dependency baseline.

## Validation

GitHub Actions workflows have been removed from this repository. Run validation and builds locally when needed. For frontend changes:

```sh
pnpm typecheck
pnpm web:build
```

Run the relevant existing tests for the code you changed. For Rust changes, also run `cargo check` for the target platform and the affected Rust tests. Translation work has a separate [i18n guide](docs/CONTRIBUTING_i18n.md).

Document what was verified and any remaining platform or real-device checks. Build success alone does not confirm installation, upgrade, exit behavior or real network connectivity.

## Changes and pull requests

1. Create a focused branch from `main`.
2. Make one coherent change and preserve existing user configuration behavior.
3. Run relevant validation and describe the result in the pull request.
4. Update the user documentation when behavior changes.

Use a GitHub no-reply commit email if you prefer not to publish an email address. Do not include subscription URLs, tokens, account data or unredacted diagnostics in commits or public reports.

## Releases and documentation

- The [main README](README.md#下载) is the current download entry point.
- [Changelog.md](Changelog.md) records PewPew releases. [Upstream history](docs/Changelog.history.md) is reference material.
- Keep internal test builds marked as prereleases and include known limitations and checksums.
- Retain old packages for traceability, label obsolete builds clearly, and do not change existing tags or replace previously published binaries during a documentation cleanup.
- Update the Chinese README and English guide together when release status changes. Other language pages point readers to these maintained guides.
