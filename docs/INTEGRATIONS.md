# Website lead intake

Endpoint: POST `/api/intake/petronik` (also afrilube, petronex and istanegry).

Configure `INTAKE_PETRONIK_SECRET` (at least 32 random characters) and `INTAKE_PETRONIK_OWNER_ID` (an active authorised sales user). Use the equivalent uppercase prefix for each company. Domain spelling for Istanegry is unconfirmed; the company identifier is configurable in source before deployment.

Call from the website backend only. Never embed the secret in client JavaScript. Configure a reverse-proxy rate limit and body limit of 20 KB before exposing intake publicly. This endpoint validates an HMAC and a five-minute timestamp window and deduplicates repeated event IDs; business-level duplicate customer review remains separate.

Headers: `Content-Type: application/json`, `x-enercore-timestamp` (Unix milliseconds), `x-enercore-signature` (hex HMAC-SHA256 of `timestamp + '.' + exactBody`). Use the same `eventId` for retries, with a fresh timestamp/signature. Retries do not create additional leads.

Payload example (fictional):

```json
{"eventId":"website-request-001","title":"Example Trading","contact":"Example Buyer","email":"buyer@example.invalid","phone":"","product":"Base Oil SN 500","quantity":200,"destination":"Mombasa","message":"Please quote CFR terms.","website":"petronik.ae"}
```

No websites, email accounts, WhatsApp accounts or live endpoints have been connected. Email ingestion, SMTP, WhatsApp Business API, carrier tracking and external accounting integrations require provider selection, credentials and implementation. Do not advertise live tracking or auto-sending until those connections are verified.
