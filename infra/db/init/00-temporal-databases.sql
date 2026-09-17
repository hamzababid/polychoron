-- Temporal's own persistence + visibility stores live in separate
-- databases on the same Postgres server as the app's `polychoron`
-- database — one server, three databases. Temporal's internal schema
-- is managed entirely by temporalio/auto-setup; it is never touched by
-- app migrations, and the app's migrations never touch these.
CREATE DATABASE temporal;
CREATE DATABASE temporal_visibility;
