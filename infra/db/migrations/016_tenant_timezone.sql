-- specs/platform/02-platform-data-models.py::Tenant.timezone
-- Times are stored in UTC; each tenant names the zone its people (and
-- its agents' prompts) read them in. Found 2026-09-29: the agent quoted
-- UTC clock times while Case Workspace showed the browser's local time.
ALTER TABLE tenants ADD COLUMN timezone TEXT NOT NULL DEFAULT 'UTC';
