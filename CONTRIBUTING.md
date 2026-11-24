# Contributing to PnLens

Thanks for your interest in PnLens. Bug reports, ideas and pull requests are welcome.

## Before you start

- For bugs, open an issue with steps to reproduce, the exchange involved, and the error code shown in the app (for example `INVALID_KEY` or `IP_NOT_WHITELISTED`). Never paste API keys, secrets or private keys.
- For larger changes, open an issue first so we can agree on the approach.

## Requirements

- Node.js 20 or newer
- pnpm 10 (npm and yarn are blocked by `engines`)
- A Supabase project (Postgres, Auth, Storage, Realtime)

## Local setup

The Next.js app lives in `src/`, not the repository root. Run every command from `src/`.

```bash
git clone https://github.com/dui14/PnLens.git
cd PnLens/src
pnpm install
```

Create `src/.env.local`:

```bash
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
SUPABASE_SERVICE_ROLE_KEY=<service role key>
ENCRYPTION_MASTER_KEY=<32-byte key, base64>
```

Never commit `.env.local` or any file containing real credentials.

### Database schema

The database migrations are not published in this repository. If you want to run PnLens locally against your own Supabase project, [contact me](README.md#contact) and I will share the schema.

### Run the app

```bash
pnpm dev
```

The app runs at http://localhost:3000.

## Checks

CI runs these in order on every pull request. Run them locally before opening one:

| Task | Command |
|---|---|
| Tests | `pnpm test` |
| Lint | `pnpm lint` |
| Type check | `pnpm exec tsc --noEmit` |
| Production build | `pnpm build` |

Run a single test file with `pnpm vitest run tests/unit/<file>.test.ts`.

## Code guidelines

- Keep changes scoped to the issue. Avoid unrelated refactors in the same pull request.
- No comments in code. Prefer clear names and small functions.
- No hardcoded values: user-facing text goes through i18n (`src/lib/i18n/en.ts` and `vi.ts`), limits and settings go in config.
- Follow the existing layering: route handler → service → engine / db / adapter. See [ARCHITECTURE.md](ARCHITECTURE.md).
- API responses use `{ success, data, error }` with `SCREAMING_SNAKE_CASE` error codes.
- Add or update tests for behavior you change.

## Pull requests

1. Fork the repository and create a branch from `main` (for example `fix/okx-pagination` or `feat/export-csv`).
2. Make your change and run the checks above.
3. Open a pull request against `main` with a short description of what changed and why, and screenshots for UI changes.

## Security issues

Do not open a public issue for security problems. Report them privately through the [contact](README.md#contact) channels.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
