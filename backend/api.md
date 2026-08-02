# Personal Test Endpoint — API Documentation

## Overview

A lightweight endpoint for receiving and logging POST requests from external sources (e.g. Toters). No authentication required. Accepts large payloads.

---

## Endpoint

```
POST https://3alijny.com/api/personaltest/
```

---

## Request

### Headers

| Header         | Value              | Required |
|----------------|--------------------|----------|
| Content-Type   | `application/json` | Yes      |

### Body

```json
{
  "source": "toters",
  "raw_text": "any text content here"
}
```

| Field      | Type   | Required | Description                                      |
|------------|--------|----------|--------------------------------------------------|
| `source`   | string | Yes      | Identifier of the sender (e.g. `"toters"`)       |
| `raw_text` | string | No       | Any raw text content. Accepts large payloads.    |

### Limits

- Maximum body size: **100 MB**
- No rate limiting applied

---

## Response

### Success `200 OK`

```json
{
  "status": "received",
  "source": "toters",
  "raw_text_length": 21
}
```

| Field             | Type   | Description                              |
|-------------------|--------|------------------------------------------|
| `status`          | string | Always `"received"` on success           |
| `source`          | string | Echo of the `source` field sent          |
| `raw_text_length` | int    | Character length of the `raw_text` sent  |

---

## Example

### cURL

```bash
curl -X POST https://3alijny.com/api/personaltest/ \
  -H "Content-Type: application/json" \
  -d '{"source": "toters", "raw_text": "order #1234 placed"}'
```

### Response

```json
{
  "status": "received",
  "source": "toters",
  "raw_text_length": 18
}
```

---

## Logging

Every request is logged on the server with the full body, content type, source, and raw_text length. Log entries are prefixed with `[personal_test]` for easy filtering.

---

## Notes

- No authentication or API key required
- CSRF exempt
- If `raw_text` is not provided, `raw_text_length` will be `0`
