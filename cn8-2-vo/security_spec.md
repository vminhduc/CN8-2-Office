# CN8-2 Office Firestore Security Specification

## 1. Data Invariants
1. **Strict Project Membership**: Only verified Google accounts (`email_verified == true`) that exist in `/members/{uid}` with `active == true` (or the bootstrapped Project Manager email `minhduc@pmh.com.vn` with `email_verified == true`) may read project collections. Random signed-in users are never auto-promoted and receive `PERMISSION_DENIED`.
2. **Server-Authoritative Orchestration**: Worker task leases (`/tasks/{taskId}`), device credentials/heartbeats (`/devices/{deviceId}`), mail dedupe records (`/mailItems/{sourceKey}`), and AI step results are written exclusively through the authenticated Express backend (`firebase-admin`), never directly via client SDK writes.
3. **Owner-Only Approval Closure & Schedule Activation**: Only the Project Manager (`role == 'owner'` in `/members/{uid}` or verified `minhduc@pmh.com.vn`) can close/reopen reports (`ownerClosedAt`), activate the 21:00 workflow schedule, or revoke site worker devices.
4. **Terminal & Immutable Constraints**: `id`, `createdByUid`, and `createdAt` cannot be modified after creation. All string/array lengths and document IDs are strictly bounded.

## 2. Dirty Dozen Attack Payloads (Must All Return `PERMISSION_DENIED`)
1. Unauthenticated `get` / `list` on `/jobs` or `/devices` -> DENIED.
2. Authenticated user NOT in `/members` attempting `list` on `/jobs` -> DENIED.
3. Authenticated user with `email_verified: false` (spoofed email) reading `/jobs` -> DENIED.
4. Non-owner member attempting to create `/members/attacker` with `role: "owner"` -> DENIED.
5. Client attempting to write `/tasks/fake-task` directly to forge a Codex execution -> DENIED.
6. Client attempting to write `/devices/fake-pc` with `revoked: false` -> DENIED.
7. Client attempting to write `/mailItems/fake-mail` to bypass dedupe -> DENIED.
8. Client attempting to update `jobs/{id}.results` or `jobs/{id}.status = "completed"` directly -> DENIED.
9. Client attempting to mutate `jobs/{id}` with a 1.5KB document ID (`isValidId` guard) -> DENIED.
10. Client attempting a shadow update adding `isApprovedByAdmin: true` on any document -> DENIED.
11. Non-owner member attempting to write `/workflows/cn82-daily-mail-review` (`enabled: true`) -> DENIED.
12. Deactivated member (`active: false` in `/members/{uid}`) reading `/jobs` or `/workflows` -> DENIED.
