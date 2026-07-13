# Architecture Notes

FoodOps Community keeps the open-source core local-first and deterministic. The stack is intentionally conventional so small teams can run it without managed services.

## Runtime Shape

- Frontend: Next.js and Ant Design, served on port `23000` in development.
- Backend: FastAPI, SQLAlchemy, and Alembic, served on port `23101` in development.
- Database: PostgreSQL.
- Cache and queue: Redis and Celery-ready dependencies are present, but the community loop should prefer synchronous local rules until background work is clearly needed.
- Imports: local file normalization for sales, product sales, inventory, and reviews.

## Core Flow

1. Admin users maintain organization, store, product, material, supplier, and user master data.
2. Operators import local business data files.
3. Backend normalizers validate and persist imported rows.
4. Rule-based alert logic identifies operational exceptions.
5. Alerts become tasks with owners, due dates, and state history.
6. Store teams submit H5 task feedback.
7. Notifications and audit logs keep the loop traceable.

## Boundary Rules

Keep these outside the community core:

- Enterprise messaging connectors
- Customer-specific SSO
- External AI model providers
- Public-opinion and social media collection
- Private brand assets and private customer data
- Forecasting or autonomous agent orchestration

If a contribution needs one of those capabilities, propose a plugin boundary first.
