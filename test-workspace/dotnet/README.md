# dotnet test workspace

Minimal ASP.NET Core app used by the extension integration tests.

## Endpoints

- `GET /health` → `{ "status": "ok" }`
- `GET /api/echo/{text}` → `{ "echo": "..." }`
- `POST /api/echo` with JSON body `{ "text": "..." }` → `{ "echo": "..." }`

## Port

The app is configured to listen on `http://localhost:5005` via `Properties/launchSettings.json`.
