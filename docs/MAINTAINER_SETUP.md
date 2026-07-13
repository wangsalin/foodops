# Maintainer Setup

This file records the GitHub repository settings that are not stored directly in git.

## Repository Details

Set these values on the repository landing page:

- Description: `FoodOps Community: open-source local-first food service operations system`
- Website: leave empty until a public demo or documentation site exists.
- Topics:
  - `foodops`
  - `restaurant-operations`
  - `fastapi`
  - `nextjs`
  - `postgresql`
  - `self-hosted`
  - `operations`

GitHub path:

```text
https://github.com/wangsalin/foodops
```

Use the gear icon near the About panel to edit description and topics.

## Branch Protection

Protect the `main` branch before accepting external contributions.

Recommended rule:

- Branch name pattern: `main`
- Require a pull request before merging.
- Require approvals: `1`
- Dismiss stale pull request approvals when new commits are pushed.
- Require status checks to pass before merging.
- Required status checks:
  - `backend`
  - `frontend`
- Require branches to be up to date before merging.
- Block force pushes.
- Block deletions.
- Allow administrators to bypass only while the project is still in initial setup.

GitHub path:

```text
https://github.com/wangsalin/foodops/settings/branches
```

## Labels

Recommended initial labels:

- `area: backend`
- `area: frontend`
- `area: docs`
- `area: imports`
- `area: alerts`
- `area: tasks`
- `area: h5`
- `good first issue`
- `help wanted`
- `plugin boundary`

## First Public Issues

Good first issues should be narrow and demo-data friendly:

- Add sample import templates for sales, product sales, inventory, and reviews.
- Add backend tests for import normalizers.
- Add backend tests for alert-to-task flow.
- Add frontend smoke tests for dashboard, alerts, tasks, and H5 feedback.
- Improve demo seed coverage for multiple stores and products.
