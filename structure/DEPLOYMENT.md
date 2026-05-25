# MJCC Inventory System — Deployment Reference (Azure)

**Target platform:** Microsoft Azure
**Deployment method:** Docker container via Azure App Service
**Database:** Supabase (external, managed — no Azure DB needed)
**Last updated:** 2026-05-25

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Azure Resources Required](#2-azure-resources-required)
3. [One-Time Setup](#3-one-time-setup)
4. [Environment Variables (App Settings)](#4-environment-variables-app-settings)
5. [CI/CD Pipeline (GitHub Actions)](#5-cicd-pipeline-github-actions)
6. [CORS Configuration](#6-cors-configuration)
7. [Health Check & Monitoring](#7-health-check--monitoring)
8. [Scaling](#8-scaling)
9. [Custom Domain & SSL](#9-custom-domain--ssl)
10. [Supabase ↔ Azure Connectivity](#10-supabase--azure-connectivity)
11. [Deployment Checklist](#11-deployment-checklist)
12. [Rollback Procedure](#12-rollback-procedure)

---

## 1. Architecture Overview

```
GitHub
  └── push to main
        │
        ▼
  GitHub Actions
    1. Build Docker image
    2. Push to Azure Container Registry (ACR)
    3. Deploy to Azure App Service
        │
        ▼
  Azure App Service (Linux, Docker)
    ├── Flask + Gunicorn (4 workers)
    ├── Port 5000 (mapped to 443 by Azure)
    └── App Settings = environment variables
        │
        ▼
  Supabase (PostgreSQL, us-west-1)
    └── Connected via HTTPS from App Service
```

**What Azure hosts:** The Flask/Gunicorn application container.
**What Azure does NOT host:** The database (Supabase is self-managed), AI providers (Groq/Ollama are external).

---

## 2. Azure Resources Required

| Resource | Type | Suggested Name | Notes |
|---|---|---|---|
| Resource Group | `Microsoft.Resources/resourceGroups` | `mjcc-rg` | Holds everything |
| Container Registry | `Microsoft.ContainerRegistry/registries` | `mjccacr` | Stores Docker images |
| App Service Plan | `Microsoft.Web/serverfarms` | `mjcc-plan` | Linux, B2 tier recommended |
| App Service | `Microsoft.Web/sites` | `mjcc-api` | The running application |
| Key Vault *(optional)* | `Microsoft.KeyVault/vaults` | `mjcc-vault` | Recommended for production secrets |

### Recommended Region

**`eastus`** (East US) or **`westus2`** (West US 2).

Supabase project is in `us-west-1` (AWS). Choose `westus2` to minimize latency between the app and the database.

### App Service Plan Tiers

| Tier | vCPU | RAM | Cost | Use when |
|---|---|---|---|---|
| **B1** | 1 | 1.75 GB | ~$13/mo | Development / staging |
| **B2** | 2 | 3.5 GB | ~$26/mo | Production (recommended) |
| **P1v3** | 2 | 8 GB | ~$75/mo | High traffic or if adding v1 routes + AI |

---

## 3. One-Time Setup

Run these commands once using the Azure CLI (`az`). Replace values in `< >`.

### 3.1 Login & Create Resource Group

```bash
az login

az group create \
  --name mjcc-rg \
  --location westus2
```

### 3.2 Create Azure Container Registry

```bash
az acr create \
  --resource-group mjcc-rg \
  --name mjccacr \
  --sku Basic \
  --admin-enabled true
```

Get the ACR login server URL (you'll need this):
```bash
az acr show --name mjccacr --query loginServer --output tsv
# Returns: mjccacr.azurecr.io
```

### 3.3 Create App Service Plan (Linux)

```bash
az appservice plan create \
  --name mjcc-plan \
  --resource-group mjcc-rg \
  --is-linux \
  --sku B2
```

### 3.4 Create App Service

```bash
az webapp create \
  --resource-group mjcc-rg \
  --plan mjcc-plan \
  --name mjcc-api \
  --deployment-container-image-name mjccacr.azurecr.io/mjcc-app:latest
```

### 3.5 Grant App Service Access to ACR

```bash
# Get the App Service principal ID
PRINCIPAL_ID=$(az webapp identity assign \
  --resource-group mjcc-rg \
  --name mjcc-api \
  --query principalId --output tsv)

# Get the ACR resource ID
ACR_ID=$(az acr show \
  --name mjccacr \
  --query id --output tsv)

# Grant pull access
az role assignment create \
  --assignee $PRINCIPAL_ID \
  --scope $ACR_ID \
  --role AcrPull
```

### 3.6 Enable Continuous Deployment from ACR

```bash
az webapp config container set \
  --name mjcc-api \
  --resource-group mjcc-rg \
  --docker-custom-image-name mjccacr.azurecr.io/mjcc-app:latest \
  --docker-registry-server-url https://mjccacr.azurecr.io
```

---

## 4. Environment Variables (App Settings)

In Azure App Service, environment variables are set as **Application Settings**, not in a `.env` file. The `.env` file is gitignored and must never be deployed inside the container.

Set all of these via the Azure Portal → App Service → Configuration → Application Settings, or via CLI:

```bash
az webapp config appsettings set \
  --resource-group mjcc-rg \
  --name mjcc-api \
  --settings KEY=VALUE KEY2=VALUE2
```

### Required Settings

| Setting Name | Example Value | Description |
|---|---|---|
| `FLASK_ENV` | `production` | Activates `ProductionConfig` (secure cookies, no debug) |
| `SECRET_KEY` | *(generate: `python -c "import secrets; print(secrets.token_hex(32))"`)* | Flask session signing key. Must be long and random. |
| `SUPABASE_URL` | `https://mgvyylvmkxhhataavqjz.supabase.co` | Supabase project URL |
| `SUPABASE_ANON_KEY` | `eyJ...` | Supabase anon/public key |
| `SUPABASE_SERVICE_KEY` | `eyJ...` | Supabase service role key — **treat as a password** |
| `CORS_ORIGINS` | `https://mjcc-api.azurewebsites.net` | Comma-separated. Set to your actual Azure domain. |

### Optional Settings

| Setting Name | Default | Description |
|---|---|---|
| `AI_PROVIDER` | `ollama` | `ollama` (free) or `groq` |
| `GROQ_API_KEY` | — | Required only if `AI_PROVIDER=groq` |
| `GROQ_MODEL` | `mixtral-8x7b-32768` | Groq model name |
| `AI_MODEL` | `llama3.2:3b` | Ollama model name |
| `RATELIMIT_DEFAULT` | `100 per hour` | Flask-Limiter default |
| `REDIS_URL` | `memory://` | Use a Redis URL for distributed rate limiting in multi-instance deployments |
| `LOG_LEVEL` | `WARNING` | Python logging level |
| `FLASK_HOST` | `0.0.0.0` | Leave as default |
| `FLASK_PORT` | `5000` | Leave as default |
| `WEBSITES_PORT` | `5000` | **Required by Azure** — tells App Service which port the container listens on |

> **Critical:** `WEBSITES_PORT=5000` must be set. Without it, Azure will not route traffic to the container correctly.

### Generating a Strong SECRET_KEY

```bash
python -c "import secrets; print(secrets.token_hex(32))"
```

Never reuse the dev value (`mjc-dev-secret-change-in-prod`). Changing the secret key invalidates all existing sessions.

---

## 5. CI/CD Pipeline (GitHub Actions)

Create this file at `.github/workflows/deploy.yml` in the repository.

```yaml
name: Build and Deploy to Azure

on:
  push:
    branches: [main]

env:
  ACR_REGISTRY: mjccacr.azurecr.io
  IMAGE_NAME: mjcc-app
  APP_SERVICE_NAME: mjcc-api
  RESOURCE_GROUP: mjcc-rg

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Log in to Azure Container Registry
        uses: docker/login-action@v3
        with:
          registry: ${{ env.ACR_REGISTRY }}
          username: ${{ secrets.ACR_USERNAME }}
          password: ${{ secrets.ACR_PASSWORD }}

      - name: Build and push Docker image
        uses: docker/build-push-action@v5
        with:
          context: .
          push: true
          tags: |
            ${{ env.ACR_REGISTRY }}/${{ env.IMAGE_NAME }}:latest
            ${{ env.ACR_REGISTRY }}/${{ env.IMAGE_NAME }}:${{ github.sha }}
          cache-from: type=gha
          cache-to: type=gha,mode=max

      - name: Log in to Azure
        uses: azure/login@v1
        with:
          creds: ${{ secrets.AZURE_CREDENTIALS }}

      - name: Deploy to Azure App Service
        uses: azure/webapps-deploy@v3
        with:
          app-name: ${{ env.APP_SERVICE_NAME }}
          images: ${{ env.ACR_REGISTRY }}/${{ env.IMAGE_NAME }}:${{ github.sha }}
```

### GitHub Secrets Required

Set these in GitHub → Repository → Settings → Secrets and variables → Actions:

| Secret Name | How to Get It |
|---|---|
| `ACR_USERNAME` | `az acr credential show --name mjccacr --query username -o tsv` |
| `ACR_PASSWORD` | `az acr credential show --name mjccacr --query passwords[0].value -o tsv` |
| `AZURE_CREDENTIALS` | See below |

**Generating `AZURE_CREDENTIALS`:**
```bash
az ad sp create-for-rbac \
  --name "mjcc-github-deploy" \
  --role contributor \
  --scopes /subscriptions/<SUBSCRIPTION_ID>/resourceGroups/mjcc-rg \
  --sdk-auth
```
Copy the entire JSON output into the `AZURE_CREDENTIALS` secret.

### Deploy Behavior

- Every push to `main` triggers a build and deploy.
- Each image is tagged with both `latest` and the git SHA.
- The git SHA tag makes every deployment uniquely identifiable and reversible.
- Build layer caching is enabled (`cache-from: type=gha`) — subsequent builds are significantly faster.

---

## 6. CORS Configuration

The current `CORS_ORIGINS` default is `*` (open). This must be tightened before going live.

### Setting CORS for Azure

Set `CORS_ORIGINS` in App Settings to your actual domain(s), comma-separated:

```
# Default Azure domain only
CORS_ORIGINS=https://mjcc-api.azurewebsites.net

# Azure domain + custom domain
CORS_ORIGINS=https://mjcc-api.azurewebsites.net,https://inventory.mjcmiami.org

# Dev + prod (use only during transition)
CORS_ORIGINS=https://mjcc-api.azurewebsites.net,http://localhost:5000
```

The Flask app reads this at startup from `backend/config.py`:
```python
CORS_ORIGINS = os.getenv('CORS_ORIGINS', '*').split(',')
```

CORS is applied in `backend/main.py`:
```python
CORS(app, supports_credentials=True, origins=app_config.CORS_ORIGINS)
```

`supports_credentials=True` is required because the app uses session cookies.

---

## 7. Health Check & Monitoring

### Built-in Health Check

The Dockerfile already includes a health check:
```dockerfile
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:5000/ || exit 1
```

Azure App Service also has its own health check feature. Configure it:

**Portal:** App Service → Monitoring → Health check
- **Path:** `/`
- **Unhealthy threshold:** 2 failed checks

### Logs

View live logs from the Azure CLI:
```bash
az webapp log tail \
  --resource-group mjcc-rg \
  --name mjcc-api
```

Enable application logging (persistent):
```bash
az webapp log config \
  --resource-group mjcc-rg \
  --name mjcc-api \
  --docker-container-logging filesystem \
  --level information
```

The app writes to stdout/stderr (Gunicorn `--access-logfile -` and `--error-logfile -`), which Azure captures automatically.

### Azure Monitor (Optional)

For production alerting, enable Application Insights:
```bash
az monitor app-insights component create \
  --app mjcc-insights \
  --location westus2 \
  --resource-group mjcc-rg
```

Then add the instrumentation key as an App Setting: `APPINSIGHTS_INSTRUMENTATIONKEY`.

---

## 8. Scaling

### Vertical Scaling (Upgrade Plan Tier)

```bash
az appservice plan update \
  --name mjcc-plan \
  --resource-group mjcc-rg \
  --sku P1v3
```

No downtime — Azure handles the migration.

### Horizontal Scaling (Multiple Instances)

```bash
az webapp scale \
  --resource-group mjcc-rg \
  --name mjcc-api \
  --number-of-workers 2
```

**Before scaling to multiple instances:**
- Switch `RATELIMIT_STORAGE_URL` from `memory://` to a Redis connection string. In-memory rate limiting does not work across multiple instances.
- Flask sessions are stored in encrypted cookies (client-side), so they already work across instances without changes.

### Auto-scaling (P-tier plans only)

Auto-scaling is only available on Premium tiers (P1v3+). For the current B2 plan, manual scaling is the only option.

---

## 9. Custom Domain & SSL

Azure App Service provides a free SSL certificate for the default `.azurewebsites.net` domain. For a custom domain:

### Add Custom Domain

```bash
az webapp config hostname add \
  --webapp-name mjcc-api \
  --resource-group mjcc-rg \
  --hostname inventory.mjcmiami.org
```

Then add a CNAME record at your DNS provider:
```
inventory.mjcmiami.org  CNAME  mjcc-api.azurewebsites.net
```

### Enable Managed SSL Certificate (Free)

```bash
az webapp config ssl create \
  --resource-group mjcc-rg \
  --name mjcc-api \
  --hostname inventory.mjcmiami.org
```

### Enforce HTTPS

```bash
az webapp update \
  --resource-group mjcc-rg \
  --name mjcc-api \
  --https-only true
```

This redirects all HTTP requests to HTTPS at the Azure load balancer level, before they reach the container.

---

## 10. Supabase ↔ Azure Connectivity

Supabase is hosted on AWS `us-west-1`. The app connects to it over the public internet via HTTPS — no VPN or private networking is required.

### Connection Details

| Setting | Value |
|---|---|
| Supabase URL | `https://mgvyylvmkxhhataavqjz.supabase.co` |
| Port | 443 (HTTPS) |
| Protocol | HTTPS — all traffic is encrypted in transit |
| Auth | API keys in App Settings (never hardcoded) |

### Latency Expectation

From Azure `westus2` to Supabase `us-west-1` (AWS Oregon):
- Expected round-trip: **5–20ms**
- This is acceptable for all current use cases including the scanner endpoint (200ms budget)

If latency becomes a concern, Supabase supports moving a project to a different AWS region. `us-east-1` would be closer to Azure `eastus`.

### Outbound IP Addresses

Supabase's database connection pooler (if you ever switch to direct Postgres connections) can be restricted by IP. Get your App Service's outbound IPs:

```bash
az webapp show \
  --resource-group mjcc-rg \
  --name mjcc-api \
  --query outboundIpAddresses \
  --output tsv
```

Add these to the Supabase project's database allow-list if needed.

---

## 11. Deployment Checklist

### Before First Deploy

- [ ] `.env` is in `.gitignore` — confirmed
- [ ] All secrets moved to Azure App Settings (not in code, not in image)
- [ ] `SECRET_KEY` is a new randomly generated value (not the dev placeholder)
- [ ] `FLASK_ENV=production` set in App Settings
- [ ] `WEBSITES_PORT=5000` set in App Settings
- [ ] `CORS_ORIGINS` set to actual Azure/custom domain
- [ ] `SESSION_COOKIE_SECURE=True` confirmed (automatic when `FLASK_ENV=production`)
- [ ] Docker image builds cleanly: `docker build -t mjcc-app .`
- [ ] Container runs locally: `docker run -p 5000:5000 --env-file .env mjcc-app`
- [ ] Health check responds: `curl http://localhost:5000/`
- [ ] GitHub Actions secrets configured (`ACR_USERNAME`, `ACR_PASSWORD`, `AZURE_CREDENTIALS`)
- [ ] HTTPS-only enforced on App Service

### Every Deploy (automated via GitHub Actions)

- [ ] Tests pass: `pytest`
- [ ] Linter passes: `ruff check .`
- [ ] Push to `main` triggers GitHub Actions workflow
- [ ] Image pushed to ACR with git SHA tag
- [ ] App Service updated to new image
- [ ] Health check confirms new container is up

### Post-Deploy Verification

- [ ] Login page loads at `https://mjcc-api.azurewebsites.net`
- [ ] Staff PIN login works
- [ ] Admin password login works
- [ ] Dashboard data loads (Supabase connection confirmed)
- [ ] Check App Service logs for errors: `az webapp log tail --name mjcc-api --resource-group mjcc-rg`

---

## 12. Rollback Procedure

Every deployment tags the image with the git SHA. To roll back to a previous version:

### Find the Previous SHA

```bash
# In the repo
git log --oneline -10
```

### Redeploy the Previous Image

```bash
az webapp config container set \
  --name mjcc-api \
  --resource-group mjcc-rg \
  --docker-custom-image-name mjccacr.azurecr.io/mjcc-app:<PREVIOUS_SHA>
```

Azure will pull the tagged image from ACR and restart the container. No rebuild needed.

### Emergency: Restart Current Container

If the app is running but behaving unexpectedly:
```bash
az webapp restart \
  --resource-group mjcc-rg \
  --name mjcc-api
```
