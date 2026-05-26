---
name: azure-deploy
description: Deploy MJCC to Azure — build Docker image, push to ACR (kpncloud.azurecr.io), set up resource group rg-jeremiah, create/update App Service mjcc-api, and configure all app settings. Use this skill whenever deploying, redeploying, setting up Azure infra, or troubleshooting the Azure pipeline for MJCC. Always use this for any Azure infrastructure work on this project.
---

# MJCC Azure Deploy Skill

Handles the full Azure deployment lifecycle for the MJCC Flask app.

## Infrastructure constants

| Resource         | Value                                 |
| ---------------- | ------------------------------------- |
| Resource group   | `rg-jeremiah`                         |
| Location         | `eastus`                              |
| ACR name         | `KpnCloud`                            |
| ACR login server | `kpncloud.azurecr.io`                 |
| Image            | `kpncloud.azurecr.io/mjcc-api:latest` |
| App Service name | `mjcc-api`                            |
| App Service Plan | `mjcc-plan`                           |
| SKU              | `B1` (Basic, cheapest with always-on) |
| Container port   | `5000` → `WEBSITES_PORT=5000`         |

## Full setup from scratch

```bash
# 1. Create resource group
az group create --name rg-jeremiah --location eastus

# 2. Create ACR (admin enabled so App Service can pull)
az acr create --name KpnCloud --resource-group rg-jeremiah --sku Basic --admin-enabled true

# 3. Get ACR credentials
az acr credential show --name KpnCloud --output table

# 4. Create App Service Plan (Linux)
az appservice plan create \
  --name mjcc-plan \
  --resource-group rg-jeremiah \
  --is-linux \
  --sku B1

# 5. Create Web App (container)
az webapp create \
  --name mjcc-api \
  --resource-group rg-jeremiah \
  --plan mjcc-plan \
  --deployment-container-image-name kpncloud.azurecr.io/mjcc-api:latest

# 6. Configure container registry credentials
az webapp config container set \
  --name mjcc-api \
  --resource-group rg-jeremiah \
  --docker-custom-image-name kpncloud.azurecr.io/mjcc-api:latest \
  --docker-registry-server-url https://kpncloud.azurecr.io \
  --docker-registry-server-user <ACR_USERNAME> \
  --docker-registry-server-password <ACR_PASSWORD>

# 7. Set all app settings
az webapp config appsettings set \
  --name mjcc-api \
  --resource-group rg-jeremiah \
  --settings \
    WEBSITES_PORT=5000 \
    FLASK_ENV=production \
    LOG_LEVEL=WARNING \
    AI_PROVIDER=groq \
    AI_MODEL=mixtral-8x7b-32768
```

## App settings to configure (secrets — set manually or via CLI)

Read values from `.env` for the non-secret ones; set secrets from a secure store.

| Setting                | Source                                                               |
| ---------------------- | -------------------------------------------------------------------- |
| `SECRET_KEY`           | Generate: `python -c "import secrets; print(secrets.token_hex(32))"` |
| `SUPABASE_URL`         | `.env` → `SUPABASE_URL`                                              |
| `SUPABASE_ANON_KEY`    | `.env` → `SUPABASE_ANON_KEY`                                         |
| `SUPABASE_SERVICE_KEY` | `.env` → `SUPABASE_SERVICE_KEY`                                      |
| `GROQ_API_KEY`         | `.env` → `GROQ_API_KEY`                                              |
| `GROQ_MODEL`           | `mixtral-8x7b-32768`                                                 |
| `GEMINI_API_KEY`       | Get from Google AI Studio if AI_PROVIDER=gemini                      |
| `CORS_ORIGINS`         | App Service hostname, e.g. `https://mjcc-api.azurewebsites.net`      |
| `WEBSITES_PORT`        | `5000`                                                               |
| `AI_PROVIDER`          | `groq` (Ollama won't work on App Service — local daemon only)        |

## Build and push image manually

```bash
# Login to ACR
az acr login --name KpnCloud

# Build
docker build -t kpncloud.azurecr.io/mjcc-api:latest .

# Push
docker push kpncloud.azurecr.io/mjcc-api:latest

# Restart app to pull new image
az webapp restart --name mjcc-api --resource-group rg-jeremiah
```

## GitHub Actions secrets (required for CI/CD)

Before pushing to main, add these in GitHub → Settings → Secrets → Actions:

| Secret              | How to get                                                                                                                              |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `AZURE_CREDENTIALS` | `az ad sp create-for-rbac --name mjcc-deploy --role contributor --scopes /subscriptions/<sub-id>/resourceGroups/rg-jeremiah --sdk-auth` |
| `ACR_USERNAME`      | `az acr credential show --name KpnCloud --query username -o tsv`                                                                        |
| `ACR_PASSWORD`      | `az acr credential show --name KpnCloud --query passwords[0].value -o tsv`                                                              |

## Logs and debugging

```bash
# Stream live logs
az webapp log tail --name mjcc-api --resource-group rg-jeremiah

# Enable logging (if not already on)
az webapp log config --name mjcc-api --resource-group rg-jeremiah \
  --docker-container-logging filesystem

# Show current app settings
az webapp config appsettings list --name mjcc-api --resource-group rg-jeremiah --output table

# Show container config
az webapp config container show --name mjcc-api --resource-group rg-jeremiah
```

## Common failures

| Symptom                      | Fix                                                                        |
| ---------------------------- | -------------------------------------------------------------------------- |
| 502 on App Service           | Container not started — check `az webapp log tail`                         |
| Health check timeout         | Gunicorn not binding fast enough — increase `--start-period` or check PORT |
| `unauthorized` pulling image | ACR creds not set on App Service — run `config container set` again        |
| `AI_PROVIDER=ollama` error   | Change to `groq` in app settings — Ollama needs local daemon               |
| Auth token mismatch          | Run `az login` to refresh stale credentials                                |
