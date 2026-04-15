# Manual Auth Test (curl)

Use a cookie jar so refresh/logout can read/write `sl_refresh`.

## 1) Login (email + password)
```bash
curl -i -X POST http://localhost:4000/auth/login \
  -H "Content-Type: application/json" \
  -c cookies.txt \
  -d "{\"email\":\"manager@smartlink.test\",\"password\":\"your_password\"}"
```

You should receive:
- `Set-Cookie: sl_refresh=...; HttpOnly; Path=/auth`
- JSON with `accessToken`

## 2) Me (access token)
```bash
curl -i http://localhost:4000/auth/me \
  -H "Authorization: Bearer <ACCESS_TOKEN_FROM_LOGIN>"
```

## 3) Refresh (rotate refresh cookie + get new access token)
```bash
curl -i -X POST http://localhost:4000/auth/refresh \
  -b cookies.txt \
  -c cookies.txt
```

Use returned access token for subsequent `/api/*` and `/auth/me`.

## 4) Logout (revoke session + clear cookie)
```bash
curl -i -X POST http://localhost:4000/auth/logout \
  -b cookies.txt \
  -c cookies.txt
```

After logout, refreshing should fail:
```bash
curl -i -X POST http://localhost:4000/auth/refresh \
  -b cookies.txt \
  -c cookies.txt
```

## 5) Business API with bearer token
```bash
curl -i http://localhost:4000/api/stations \
  -H "Authorization: Bearer <ACCESS_TOKEN>"
```
