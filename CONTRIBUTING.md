# Contributing

FoodOps Community keeps the open-source core focused on the local operations loop:

- master data
- manual imports
- dashboard
- local rule alerts
- tasks and H5 feedback
- in-app notifications
- audit logs

Please keep enterprise integrations out of the community core. WeCom, Feishu, external AI providers, public-opinion collection, social media workflows, SSO, relay services, and customer-specific connectors should be proposed as plugin or Enterprise boundaries.

## Local Checks

Before opening a pull request, run:

```bash
cd backend
python -m compileall app main.py scripts
python -m py_compile alembic/versions/000001_init_community.py

cd ../frontend
npm install
npm run build
```

## Pull Request Expectations

- Keep changes scoped and explain the user-facing workflow they support.
- Include schema changes in a migration.
- Avoid adding private customer data, brand assets, logs, uploaded files, browser profiles, generated build output, or local environment files.
- Prefer deterministic local rules over external services in the community core.

