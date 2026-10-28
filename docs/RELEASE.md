# Publishing this repository

A checklist for turning this folder into a public GitHub repository and getting
it listed. Everything here is done by the maintainer (you); nothing in this
folder requires credentials.

## 0. Identity (already filled in)

The repository is pre-filled for **Leo / Leo1958923515 / 1958923515@qq.com**:

| Field | Value | Used in |
| --- | --- | --- |
| GitHub owner | `Leo1958923515` | READMEs, `package.json`, `SECURITY.md`, `docs/awesome-list-entry.yml` |
| Author name | `Leo` | `LICENSE`, `package.json` |
| Contact | `1958923515@qq.com` | `package.json`, `SECURITY.md` |

Everything carries one name:

| Thing | Value |
| --- | --- |
| GitHub repository | `dsh-popup-cards` |
| npm package | `dsh-popup-cards` |
| `cordis.patch.yml` `name` | `dsh-popup-cards` |
| Local folder | `dsh-popup-cards` (matches the repository) |

All URLs point at `Leo1958923515/dsh-popup-cards`, and the package name, the
bundle row and the folder name are consistent, so nothing needs to be renamed
before publishing.

## 1. Screenshots (already in place)

Storefronts read screenshots from `screenshots.json` in your repository, and
both PNGs are already committed: `assets/screenshots/01-card.png` (a real card)
and `assets/screenshots/02-self-test.png` (the self-test card). Keep the file
names and the relative paths; replacing an image later needs no pull request on
the list repo.

The list entry declares a storefront tile: `assets/icon-180.png` (180×180
raster, rendered from `icon.svg` by the same geometry) is committed and pointed
at with the `icon:` URL in `docs/awesome-list-entry.yml`. The guide only accepts
GitHub-hosted raster images (png/jpg/webp) — SVG and third-party hosts are
rejected — so keep the PNG in this repository and leave the URL pointing at
`main`.

Both PNGs are quantised to ~130 KB each so the storefront detail page stays
light; re-quantise if you replace them (`PIL: img.quantize(256)`).

## 2. Create and push the repository

Create a **new empty repository** on GitHub (`dsh-popup-cards`, no README, no
`.gitignore`). Do not use the Fork button: this project is a derivative work that
keeps the upstream MIT notice in `LICENSE`, not a GitHub fork.

```sh
git init
git add .
git commit -m "dsh-popup-cards 0.1.5: DSH-styled cards with click-to-focus, auto-close and × close"
git branch -M main
git remote add origin https://github.com/Leo1958923515/dsh-popup-cards.git
git push -u origin main
```

Then, on GitHub:

- Add the topic **`dsh-plugin`** (required by the awesome list).
- Set the description to the one in `docs/awesome-list-entry.yml` (no
  superlatives).
- Make sure the repository is at least **1 day old** before opening the list
  PR — the list CI rejects newer repositories automatically.
- Optional: enable Issues.

## 3. Tag the release

```sh
git tag -a v0.1.5 -m "dsh-popup-cards 0.1.5"
git push origin v0.1.5
```

Optionally attach a prebuilt tarball (`npm pack`) to the GitHub Release and add
its URL as `tarball:` in `docs/awesome-list-entry.yml`. The contributing guide
recommends that for repositories that cannot build from source.

## 4. Optional: publish to npm

The name `dsh-popup-cards` is free on npm (checked 2026-10-28), and
`package.json` already matches it, so `npm publish` works without renaming
anything. The npm package's `repository` field already points back at
`Leo1958923515/dsh-popup-cards`, which is what links the package to the list
entry.

## 5. Open the awesome-list pull request

1. Fork `awesome-dsh-plugin/awesome-dsh-plugin`.
2. Add exactly one file: `data/plugins/Leo1958923515__dsh-popup-cards.yml`
   with the contents of `docs/awesome-list-entry.yml`.
3. Do **not** edit either README — they are generated from `data/plugins/*.yml`.
4. Open the PR. One PR adds at most 3 entries, and it must not touch existing
   entries. CI checks: entry count, `dsh.bundle` manifest, repository age,
   awesome-lint and README regeneration.

If a maintainer applies `held: author`, push the fixes to the same branch and
leave one comment; the label is retired by a re-review, not automatically.

## 6. Attribution and upstream sync

- The upstream MIT notice stays in `LICENSE`, with your `Modifications
  Copyright` line below it (already present). Keep that file unchanged when
  editing anything else.
- Attribution is one line in each README ("based on dsh-popup-notify by
  yiumanlenong"), plus `contributors` in `package.json` and the `## [0.1.4] —
  upstream` section of `CHANGELOG.md`. Do not claim the event integration as
  original.
- When pulling fixes from upstream, add a changelog entry that says so, e.g.
  "sync with dsh-popup-notify 0.1.x".
