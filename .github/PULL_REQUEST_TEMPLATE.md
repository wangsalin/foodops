## What Changed

- 

## Why

- 

## Verification

- [ ] `python -m compileall app main.py scripts`
- [ ] `python -m py_compile alembic/versions/000001_init_community.py`
- [ ] `npm run build`

## Scope Check

- [ ] This change stays inside the community core.
- [ ] This change does not add private data, secrets, build output, uploads, or customer-specific assets.
- [ ] Enterprise integrations are proposed as plugin boundaries instead of being merged into the core loop.
