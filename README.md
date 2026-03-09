# QA Test Hub

> Aggregated test dashboard that combines results from all QA project repos into a single view.

[![Build Hub Dashboard](https://github.com/Defused15/qa-test-hub/actions/workflows/build-hub.yml/badge.svg)](https://github.com/Defused15/qa-test-hub/actions/workflows/build-hub.yml)

**Live dashboard →** `https://defused15.github.io/qa-test-hub/`

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
                                              │
                                         dist/index.html
                                              │
                                       GitHub Pages deploy
```

Each project repo pushes its `report.json` to `projects/<name>/latest.json` in this repo via the GitHub API. That push triggers the hub workflow, which regenerates and deploys the combined dashboard.

---

## Repository Structure

```
qa-test-hub/
├── projects/                         # Auto-updated by project repos
│   ├── QA-Playground-Tests/
│   │   └── latest.json
│   └── your-other-project/
│       └── latest.json
├── scripts/
│   └── generate-hub-dashboard.mjs    # Reads projects/, writes dist/
├── dist/
│   └── index.html                    # Generated — do not edit manually
├── .github/
│   └── workflows/
│       └── build-hub.yml
└── package.json
```

---

## Setup

### 1. Create this repo

Create a new GitHub repo named `qa-test-hub` (public, so GitHub Pages works on the free plan).

### 2. Create a Personal Access Token

Go to **GitHub Settings → Developer settings → Personal access tokens → Fine-grained tokens** and create a token with:

- **Resource owner:** your account
- **Repository access:** Only `qa-test-hub`
- **Permissions:** Contents → Read and Write

Copy the token value.

### 3. Add the token to each project repo

In every project repo that should report to the hub:

**Settings → Secrets and variables → Actions → New repository secret**

- Name: `HUB_TOKEN`
- Value: the token you just created

### 4. Add the upload step to each project workflow

Copy the contents of `hub-upload-step.yml` and paste it at the end of each project's workflow, updating the two env vars:

```yaml
env:
  HUB_TOKEN: ${{ secrets.HUB_TOKEN }}
  HUB_REPO: Defused15/qa-test-hub       # ← your hub repo
  PROJECT_NAME: your-project-name        # ← folder name under projects/
```

### 5. Enable GitHub Pages on the hub repo

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
