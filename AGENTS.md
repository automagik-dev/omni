# Omni repository contract

Omni is a Bun and TypeScript monorepo built around Hono, tRPC, Drizzle, and NATS.

- Validate every external boundary with Zod.
- Represent state changes with events.
- Never edit a deployed migration or use `drizzle push` against shared or production databases.
- Change the schema and its generated SQL migration together.
- Inspect nearby code and established repository patterns before implementing.
- Do not start services, access databases or production systems, or send external messages without explicit approval.
- Prefer safe static gates for routine validation.
- Use a disposable database for database-backed or full integration tests.
