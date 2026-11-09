# Feature: Authentication

## Behavior

Login and registration run in the browser against Supabase Auth.

- `/login` calls `signInWithPassword` and `signInWithOAuth` (`provider: 'google'`) from `src/components/features/auth/LoginForm.tsx`.
- `/register` calls `signUp` and the same Google OAuth helper from `src/components/features/auth/RegisterForm.tsx`.
- `src/middleware.ts` treats `/dashboard`, `/demo-trading`, `/ai-assistant`, `/exchange`, `/profile`, and `/api/exchange`, `/api/pnl`, `/api/demo`, `/api/ai`, `/api/profile` as protected. `/api/exchange/debug` is not public. `/login` and `/register` are auth routes.
- A protected page without a session redirects to `/login?next=<path>`. A protected API route without a session returns `{ success: false, data: null, error: "UNAUTHORIZED" }` with HTTP 401.
- A signed-in user who opens `/login` or `/register` is redirected to `/dashboard`.
- `GET /api/auth/callback` exchanges the Supabase code for a session and redirects to a same-origin path from `next`, or `/dashboard`.
- `database/schema.sql` `handle_new_user` inserts `public.users (id, email)` after `auth.users` insert. There is no onboarding route or `onboarding_completed` column.

## Acceptance Criteria

```powershell
$dash = curl.exe -s -o NUL -w "%{http_code} %{redirect_url}" http://localhost:3000/dashboard
if ($dash -notmatch '^307 ' -or $dash -notmatch '/login') { Write-Output $dash; exit 1 }
$api = curl.exe -s -o NUL -w "%{http_code}" http://localhost:3000/api/profile
if ($api -ne '401') { Write-Output $api; exit 1 }
rg -n "signInWithPassword" src/components/features/auth/LoginForm.tsx
rg -n "signInWithOAuth" src/components/features/auth/LoginForm.tsx
rg -n "PROTECTED_ROUTES" src/middleware.ts
```
