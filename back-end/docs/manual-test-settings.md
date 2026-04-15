# Manual Test: Settings API

Assumptions:
- API base: `http://localhost:4000`
- Station: `01STATIONABC1234567890123`
- Access token is valid manager token

Set token:

```bash
TOKEN="<paste_access_token>"
STATION="01STATIONABC1234567890123"
```

Get settings snapshot:

```bash
curl -X GET "http://localhost:4000/api/stations/$STATION/settings" \
  -H "Authorization: Bearer $TOKEN"
```

Create tank:

```bash
curl -X POST "http://localhost:4000/api/stations/$STATION/settings/tanks" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Petrol Tank B","fuelType":"PETROL","capacityLitres":25000}'
```

Update tank capacity:

```bash
curl -X PATCH "http://localhost:4000/api/stations/$STATION/settings/tanks/<TANK_PUBLIC_ID>" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"capacityLitres":26000}'
```

Create pump:

```bash
curl -X POST "http://localhost:4000/api/stations/$STATION/settings/pumps" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"pumpNumber":6,"fuelType":"PETROL","tankPublicId":"<TANK_PUBLIC_ID>","status":"ACTIVE"}'
```

Update staff role:

```bash
curl -X PATCH "http://localhost:4000/api/stations/$STATION/settings/staff/<STAFF_ID>" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"role":"ATTENDANT"}'
```

Update profile name:

```bash
curl -X PATCH "http://localhost:4000/api/users/me" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"fullName":"Station Manager Updated"}'
```

Update queue settings:

```bash
curl -X PATCH "http://localhost:4000/api/stations/$STATION/settings/queue" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"capacity":120,"grace_minutes":12,"priority_mode":"HYBRID","hybrid_queue_n":2,"hybrid_walkin_n":1}'
```

Expected response shape:

```json
{
  "ok": true,
  "data": {}
}
```

Validation failures return:

```json
{
  "ok": false,
  "error": "Validation failed",
  "details": []
}
```
