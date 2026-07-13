# FoodOps Community

FoodOps Community is a local-first operations loop for chain food and beverage teams. It keeps the smallest useful workflow open: master data, manual imports, dashboards, rule-based alerts, task dispatch, H5 task feedback, in-app notifications, and audit logs.

This repository is a clean community export. Do not publish the parent/private product repository or its git history.

## Scope

Included:

- Tenant, department, role, user, store, product, material, and supplier master data
- Manual imports for sales, product sales, inventory, and reviews
- Dashboard, local rule alerts, alert-to-task flow, task H5 feedback, and review history
- In-app system notifications
- Audit logs and local environment status
- A single compressed database migration and demo seed

Not included:

- Enterprise connectors such as WeCom, Feishu, external access relay, and customer-specific SSO
- External AI model providers, prompt routing, knowledge assistants, or autonomous agent runtimes
- Public-opinion collection, social media workflows, design generation, forecasting, and private brand assets
- Any private customer data, browser profiles, uploads, runtime logs, or deployment secrets

## Quick Start

1. Copy environment variables:

```bash
cp .env.example .env
```

2. Start local infrastructure:

```bash
docker compose up -d
```

3. Prepare backend:

```bash
cd backend
python -m venv .venv
. .venv/Scripts/activate
pip install -r requirements.txt
alembic upgrade head
python scripts/seed_community.py
uvicorn main:app --reload --host 0.0.0.0 --port 23101
```

4. Start frontend:

```bash
cd frontend
npm install
npm run dev
```

Open `http://127.0.0.1:23000`. The demo seed prints the admin credentials after it runs.

## Development

Recommended verification:

```bash
cd backend
python -m compileall app main.py scripts

cd ../frontend
npm run lint
npm run build
```

Community contributions should stay inside the included scope. Enterprise integrations should be proposed as plugin boundaries rather than merged into the core loop.

## Community

- Contribution guide: `CONTRIBUTING.md`
- Security policy: `SECURITY.md`
- Publishing checklist: `PUBLISHING.md`
