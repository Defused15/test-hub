# QA Test Hub

> Aggregated test dashboard that combines results from all QA project repos into a single view.

[![Build Hub Dashboard](https://github.com/Defused15/test-hub/actions/workflows/build-hub.yml/badge.svg)](https://github.com/Defused15/test-hub/actions/workflows/build-hub.yml)

**Live dashboard →** [http://qa.rcastillo.dev/](http://qa.rcastillo.dev/)

---

## How it works

```
Each project repo                      This repo (hub)
─────────────────                      ───────────────
Tests run on push          push JSON   projects/
  → report.json    ──────────────────► project-name/
                   GitHub API (PUT)       latest.json
                                              │
                                    workflow triggers on
                                    projects/*/latest.json
                                              │
                                    generate-hub-dashboard.mjs
                                    reads all latest.json files
                                    injects data into dashboard.html
                                    copies style.css + public/ assets
                                              │
                                       GitHub Pages deploy
                                    (published to qa.rcastillo.dev)
```

Each project repo pushes its `report.json` to `projects/<name>/latest.json` in this repo via the GitHub API. That push triggers the hub workflow, which regenerates and deploys the combined dashboard.

---

## Repository Structure

```
test-hub/
├── projects/                         # Auto-updated by project repos
│   ├── QA-Playground-Tests/
│   │   └── latest.json
│   └── your-other-project/
│       └── latest.json
├── scripts/
│   ├── generate-hub-dashboard.mjs    # Build script — reads projects/, writes dist/
│   ├── dashboard.html                # HTML template (data injected at build time)
│   ├── dashboard.css                 # Styles, copied to dist/style.css
│   └── public/                       # Static assets copied as-is to dist/
│       ├── favicon.ico
│       ├── favicon-16x16.png
│       ├── favicon-32x32.png
│       ├── apple-touch-icon.png
│       ├── android-chrome-192x192.png
│       ├── android-chrome-512x512.png
│       └── site.webmanifest
├── .github/
│   └── workflows/
│       └── build-hub.yml
├── docs/
│   └── hub-upload-step.yml           # Copy this step into each project's workflow
├── .gitignore
├── package.json
└── README.md
```

> `dist/` is generated at build time and never committed — it's deployed directly to the `gh-pages` branch by the workflow.

---

## Build output

Running `npm run build` produces:

```
dist/
├── index.html          # dashboard.html with JSON data injected
├── style.css           # copied from scripts/dashboard.css
├── favicon.ico
├── favicon-16x16.png
├── favicon-32x32.png
├── apple-touch-icon.png
├── android-chrome-192x192.png
├── android-chrome-512x512.png
└── site.webmanifest
```

---

## Setup

### 1. Create this repo

Create a new GitHub repo named `test-hub` (public, so GitHub Pages works on the free plan).

### 2. Create a Personal Access Token

Go to **GitHub Settings → Developer settings → Personal access tokens → Fine-grained tokens** and create a token with:

- **Resource owner:** your account
- **Repository access:** Only `test-hub`
- **Permissions:** Contents → Read and Write

Copy the token value.

### 3. Add the token to each project repo

In every project repo that should report to the hub:

**Settings → Secrets and variables → Actions → New repository secret**

- Name: `HUB_TOKEN`
- Value: the token you just created

### 4. Add the upload step to each project workflow

Copy the step from [`docs/hub-upload-step.yml`](./docs/hub-upload-step.yml) at the root of this repo and paste it at the end of each project's workflow. Then update these two env vars:

```yaml
env:
  HUB_TOKEN: ${{ secrets.HUB_TOKEN }}
  HUB_REPO: Defused15/test-hub       # ← your hub repo
  PROJECT_NAME: your-project-name    # ← folder name under projects/
  REPORT_PATH: ./playwright-report/report.json  # ← path to your report.json
```

Make sure the step has `if: always()` so it runs even when tests fail.

### 5. Enable GitHub Pages

**Settings → Pages → Source:** Deploy from a branch → `gh-pages` → `/ (root)`

---

## Local development

```sh
# Generate the dashboard from whatever is in projects/
npm run build

# Preview it in the browser
npm run dev
```

---

## Adding a new project

1. Add the `HUB_TOKEN` secret to the new project repo
2. Paste the upload step into its workflow with the correct `PROJECT_NAME`
3. Push — the hub will automatically pick it up on the next test run

---

## Supported frameworks

| Framework | Status | Notes |
|-----------|--------|-------|
| Playwright | ✅ Supported | Uses the native JSON reporter (`--reporter=json`) |
| Jest | 🔜 Planned | — |
| Postman / Newman | 🔜 Planned | — |

Currently the dashboard parser expects Playwright's JSON report structure. Support for additional frameworks will be added by implementing per-format parsers in `generate-hub-dashboard.mjs`.