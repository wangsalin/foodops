# Publishing

This directory is an independent git repository. Publish this repository, not the parent private workspace.

## Create A GitHub Repository

Create an empty public repository on GitHub, then run from this directory:

```bash
git remote add origin git@github.com:<owner>/<repo>.git
git push -u origin main
```

If using GitHub CLI:

```bash
gh auth login
gh repo create <owner>/<repo> --public --source . --remote origin --push
```

## Pre-Push Checklist

- `git status` is clean.
- `python -m compileall app main.py scripts` passes in `backend/`.
- `python -m py_compile alembic/versions/000001_init_community.py` passes in `backend/`.
- `npm run build` passes in `frontend/`.
- No generated directories are present: `node_modules`, `.next`, `__pycache__`.
- No private data, logs, uploads, browser profiles, or customer-specific brand assets are present.

