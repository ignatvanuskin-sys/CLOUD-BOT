# Incident runbooks

## Payment succeeded but delivery failed
Find order by id/request id, verify status fulfilled, check asset status and storage health, retry delivery by issuing a new download token. Do not create a second order.

## Webhook replaying
Check `webhook_updates`; duplicate update ids must return duplicate=true. Rotate webhook secret if traffic is suspicious.

## Storage unavailable
Readiness must fail. Pause sales, keep fulfilled orders intact, restore bucket permissions or provider service, then reissue download links.

## Redis unavailable
Production sensitive endpoints fail closed. Restore Redis or fail over; sessions may need re-login.

## Leaked secret/token
Revoke at provider, rotate env secret, redeploy, invalidate sessions, audit logs for abuse.

## Accidental public bucket
Remove public policy, rotate S3 credentials, audit object access logs, notify affected users if required.
