# AWS Secrets Manager: Interview Preparation

> **Updated:** 24 October 2026 · **Level:** what a secret is → access, encryption, rotation → secure credential architecture for agents
> **How to use:** *Short answer* = what you say first. *Explanation / Example* = intuition and code. *Pitfall / Follow-up* = where interviewers dig.

---

## Table of contents

1. [Mental model: secret lifecycle](#1-mental-model-secret-lifecycle)
2. [Fundamentals](#2-fundamentals) (Q01–Q08)
3. [Access control & encryption](#3-access-control--encryption) (Q09–Q13)
4. [Rotation](#4-rotation) (Q14–Q19)
5. [Consuming secrets: ECS, Lambda, EC2, Terraform](#5-consuming-secrets-ecs-lambda-ec2-terraform) (Q20–Q24)
6. [Agents & multi-tenant credentials](#6-agents--multi-tenant-credentials) (Q25–Q27)
7. [Scenario & debugging questions](#7-scenario--debugging-questions) (Q28–Q31)
8. [Cheat sheet](#8-cheat-sheet)

---

## 1. Mental model: secret lifecycle

**A secret = a sensitive value (DB password, API key, OAuth client secret) that must be stored encrypted, accessed only by the right identities, audited, and rotated without downtime.**

```
                ┌──────────────────────── AWS Secrets Manager ────────────────────────┐
  create ─────► │ Secret "prod/payments/db"  (ARN …:secret:prod/payments/db-AbC123)    │
                │   ├─ version v1  labels: AWSPREVIOUS                                 │
                │   ├─ version v2  labels: AWSCURRENT   ◄── what apps read by default   │
                │   └─ version v3  labels: AWSPENDING   (during rotation)              │
                │   value encrypted with KMS key (envelope encryption)                 │
                │   resource policy · tags · replication to other regions             │
                └───────▲────────────────────────────▲───────────────────▲─────────────┘
                        │ GetSecretValue (IAM)        │ rotation (Lambda / │ CloudTrail logs every
                        │                             │ managed rotation)  │ API call
             ECS task / Lambda / EC2 / CI     rotate DB user password    audit, alarms
             (cache value, refresh on error)  every N days
```

---

## 2. Fundamentals

### Q01. What is Secrets Manager?

**Short answer:** A managed service to **store, retrieve, rotate and audit** secrets. Values are encrypted with KMS, access is controlled by IAM + resource policies, every access is logged in CloudTrail, rotation can be automatic, secrets can be replicated across regions. Max secret size 64 KB; value is a string (often JSON) or binary.

```flow
pipeline: A secret's life in Secrets Manager
Create > Value stored encrypted with KMS.
Grant access > IAM / resource policy for specific roles.
Apps read at runtime > GetSecretValue, cached.
Rotate automatically > New value without downtime.
Audit > CloudTrail logs every access.
```

```bash
aws secretsmanager create-secret --name prod/payments/db \
  --secret-string '{"username":"app","password":"S3cr3t!","host":"db.internal","port":5432}' \
  --kms-key-id alias/payments-secrets
aws secretsmanager get-secret-value --secret-id prod/payments/db --query SecretString
```

---

### Q02. Secrets Manager vs SSM Parameter Store

```flow
pipeline: Secrets Manager or Parameter Store?
Needs rotation, cross-account sharing, replication? > Secrets Manager.
Plain config, feature flags, non-secret values? > Parameter Store (Standard is free).
Simple secrets without rotation? > Parameter Store SecureString can work.
Reference both > ECS/Lambda can inject from either.
```

| | Secrets Manager | Parameter Store |
|---|---|---|
| Purpose | secrets with lifecycle | config + simple secrets (`SecureString`) |
| **Rotation** | built-in (managed rotation for RDS/Aurora/Redshift/DocumentDB, Lambda for anything) | none built-in |
| Cross-region replication | ✅ | ❌ |
| Resource policies / cross-account | ✅ | limited (advanced params via RAM sharing) |
| Size | 64 KB | 4 KB standard / 8 KB advanced |
| Cost | per secret/month + per API calls | standard tier free; advanced paid |
| Hierarchies/versions | versions + staging labels | paths `/app/prod/...`, versions, labels |

**Rule of thumb:** credentials that should rotate or be shared cross-account → Secrets Manager; plain configuration and feature flags → Parameter Store (or AppConfig).

---

### Q03. Secret name vs ARN

The **ARN** includes a random 6-character suffix (`…:secret:prod/db-AbC123`) so that deleting and recreating a secret with the same name doesn't silently grant access to the new one. In IAM policies use the full ARN or `prod/db-??????` wildcard (6 chars), not `prod/db*` (which also matches `prod/db-admin`).

```flow
trace: Name vs ARN
name: prod/payments/db > Human-readable.
ARN: …:secret:prod/payments/db-**AbC123** > AWS appends 6 random characters.
delete + recreate same name  →  new suffix **XyZ789** > Policies pinned to the full ARN won't match the new secret.
use name-prefix wildcards in policies: …:secret:prod/payments/db-?????? > Or reference by name.
```

---

### Q04. Versions and staging labels

**Short answer:** Each change creates a **version** (UUID). **Staging labels** point to versions: `AWSCURRENT` (default read), `AWSPREVIOUS` (last good — lets you roll back or let old clients keep working), `AWSPENDING` (new value during rotation). You can read a specific version by ID or label.

```flow
trace: Staging labels during a rotation
v1 AWSPREVIOUS, v2 **AWSCURRENT** > Apps read AWSCURRENT by default.
rotation creates v3 **AWSPENDING** > New value being set up and tested.
finish: v3 **AWSCURRENT**, v2 AWSPREVIOUS > Labels move; versions are kept.
rollback = move AWSCURRENT back to v2 > Old clients can still use AWSPREVIOUS during the switch.
```

---

### Q05. Naming and tagging strategy

`<env>/<team-or-app>/<purpose>` e.g. `prod/payments/db`, `prod/agent/jira-oauth`. Tags (`env`, `team`, `data-class`) enable ABAC policies (`secretsmanager:ResourceTag/team`) and cost/ownership tracking.

```flow
pipeline: Naming and tagging secrets
env/app/purpose > prod/payments/db-credentials.
Tags > owner, data-classification, cost-center.
Policies by prefix or tag > prod/payments/* or ABAC on tags.
Consistent everywhere > Easy discovery and least-privilege policies.
```

---

### Q06. Deletion and recovery window

`DeleteSecret` schedules deletion with a **recovery window of 7–30 days** (default 30); `RestoreSecret` cancels it. `--force-delete-without-recovery` deletes immediately (dangerous). Alarm on `DeleteSecret` events in CloudTrail.

```flow
trace: Deletion with a recovery window
DeleteSecret (window 7–30 days) > Scheduled, not immediate.
apps calling it  →  **error** > A safe test: failures reveal hidden dependencies.
RestoreSecret within the window > Undo the deletion.
window ends  →  **permanently deleted** > ForceDeleteWithoutRecovery skips the window (use with care).
```

---

### Q07. Multi-region replication

Replicate a secret to other regions (replica secrets, read-only, kept in sync, can use a different KMS key per region) for DR and multi-region apps. Rotation happens on the primary and propagates. In DR you can promote a replica to standalone.

```flow
pipeline: Multi-region replication
Primary secret > ap-south-1.
Replica secrets > Other regions, kept in sync automatically.
Rotation on primary > Replicas get the new value.
DR > Apps in the failover region read the local replica.
```

---

### Q08. Generating strong secrets

`aws secretsmanager get-random-password --password-length 32 --exclude-characters '"@/\'` — use in rotation functions or provisioning instead of human-chosen passwords.

```flow
pipeline: Generating strong secrets
GetRandomPassword > Length, character rules, exclusions.
Store immediately > No human ever sees it.
Rotation uses the same generator > Consistent strength.
Never hard-code > Or reuse across environments.
```

---

## 3. Access control & encryption

### Q09. IAM actions for retrieving a secret

**Short answer:** Readers need `secretsmanager:GetSecretValue` on the secret ARN **and** `kms:Decrypt` on its KMS key (if a customer-managed key; via the key policy/grants). `DescribeSecret` for metadata; `ListSecrets` only if needed (reveals names). Writers/rotators need `PutSecretValue`, `UpdateSecretVersionStage`, etc.

```flow
sequence: Reading a KMS-encrypted secret
actors: App role, Secrets Manager, KMS
App role -> Secrets Manager: GetSecretValue (needs secretsmanager:GetSecretValue)
Secrets Manager -> KMS: decrypt data key (on the caller's behalf)
KMS -> KMS: key policy/IAM: may this role use the key? (kms:Decrypt)
KMS --> Secrets Manager: plaintext data key
Secrets Manager --> App role: secret value
> With a customer managed key, BOTH permissions are required.
```

```json
{
  "Effect": "Allow",
  "Action": "secretsmanager:GetSecretValue",
  "Resource": "arn:aws:secretsmanager:ap-south-1:123456789012:secret:prod/payments/db-??????"
},
{
  "Effect": "Allow",
  "Action": "kms:Decrypt",
  "Resource": "arn:aws:kms:ap-south-1:123456789012:key/1111-2222",
  "Condition": { "StringEquals": { "kms:ViaService": "secretsmanager.ap-south-1.amazonaws.com" } }
}
```

---

### Q10. How are secrets encrypted? (KMS)

Envelope encryption: Secrets Manager asks KMS for a data key, encrypts the secret value, stores the encrypted data key with it. Default key `aws/secretsmanager` (AWS managed) or a **customer-managed key** — required for cross-account access and gives you key policy control, rotation settings, separation of duties (key admins ≠ secret readers). Decrypt is always via KMS → every read is policy-checked twice (secret + key).

```flow
pipeline: Encryption under the hood
Secret value > Encrypted with a data key.
Data key > Encrypted by your KMS key (envelope encryption).
AWS managed vs customer managed key > CMK needed for cross-account access and key-policy control.
Every decrypt logged > CloudTrail shows key usage.
```

---

### Q11. Resource policies and cross-account access

Attach a **resource policy** to the secret granting a principal in another account; that account's identity policy must also allow it; the secret must use a **customer-managed KMS key** whose key policy allows the other account to decrypt. Use `BlockPublicPolicy` validation and conditions like `aws:PrincipalOrgID`.

```flow
sequence: Cross-account secret access
actors: Role in account B, Secret in account A, KMS key in account A
Role in account B -> Secret in account A: GetSecretValue
Secret in account A -> Secret in account A: resource policy allows B's role?
Secret in account A -> KMS key in account A: decrypt
KMS key in account A -> KMS key in account A: key policy allows B's role? (must be a customer managed key)
KMS key in account A --> Role in account B: value
> Three things must allow it: B's IAM policy, the secret's resource policy, and the KMS key policy.
```

---

### Q12. Why `secretsmanager:*` is dangerous

It allows reading **every** secret, changing values, disabling rotation, deleting secrets, and modifying resource policies (granting outsiders access). Grant only the actions and secret ARNs needed; separate read (apps), rotate (rotation function), admin (platform team) roles.

```flow
pipeline: Why secretsmanager:* is dangerous
Read every secret > GetSecretValue on all.
Change values > PutSecretValue: break or hijack services.
Change policies > Grant access to outsiders.
Delete > Outage. Grant only GetSecretValue on specific ARNs.
```

---

### Q13. Restricting access by network or context

Conditions such as `aws:SourceVpce` (only through your VPC endpoint), `aws:SourceVpc`, `aws:PrincipalTag`, `secretsmanager:ResourceTag`. Use an **interface VPC endpoint** for Secrets Manager so private workloads don't need NAT, plus an endpoint policy.

```flow
pipeline: Restricting access by context
Resource policy condition > aws:SourceVpce = only through our VPC endpoint.
Principal conditions > aws:PrincipalOrgID, tags.
Request conditions > secretsmanager:VersionStage, resource tags.
Deny statements > Block everything outside the allowed path.
```

---

## 4. Rotation

### Q14. What is automatic rotation and why do it?

**Short answer:** Periodically replace a secret's value (every N days/hours, or on schedule expression) to limit the damage of a leaked credential. Two flavours: **managed rotation** (AWS handles it, e.g., RDS-managed master passwords) and **Lambda rotation functions** (AWS templates for RDS/Aurora/Redshift/DocumentDB, or custom for any system).

```flow
cycle: Automatic rotation
Schedule fires > e.g. every 30 days or a cron expression.
Rotation function runs > create → set → test → finish.
New AWSCURRENT > Apps pick it up on next read / cache refresh.
Old value retired > After a safe period.
exit > Repeats forever; a leaked secret stops working at the next rotation.
```

---

### Q15. The four steps of a rotation function

```flow
pipeline: The four rotation steps (each must be idempotent)
createSecret > Generate a new value and store it as the AWSPENDING version.
setSecret > Set that credential in the target system, e.g. `ALTER USER … PASSWORD …`.
testSecret > Log in with AWSPENDING to prove it works.
finishSecret > Move the AWSCURRENT label to the new version; the old one becomes AWSPREVIOUS. If any step fails, AWSCURRENT stays on the old version, so apps keep working.
```
Each step must be **idempotent** (rotation can retry). If any step fails, AWSCURRENT stays on the old version, so apps keep working.

---

### Q16. Single-user vs alternating-users rotation

```flow
trace: Alternating-users rotation
app uses **user_a** (AWSCURRENT) > Two database users exist.
rotation: set new password on **user_b**, test it > user_a keeps working throughout.
AWSCURRENT → user_b > Apps switch on next read.
next rotation updates user_a > No moment when the credential in use is invalid. Single-user rotation has a brief window where old clients fail.
```

- **Single user:** change the password of the same DB user. Brief window where connections using the old password fail until clients refresh.
- **Alternating users:** two DB users (`app_a`, `app_b`); rotation updates the *inactive* one and switches AWSCURRENT → old credential remains valid during the transition → near-zero downtime. Requires a superuser/"rotator" secret.

---

### Q17. How should apps handle rotation?

Cache the secret with a TTL (e.g., 5–15 min); on **authentication failure**, re-fetch AWSCURRENT and retry once; use connection pools that can reconnect. Don't fetch on every request (cost/latency/throttling), and don't cache forever.

```flow
sequence: An app surviving rotation
actors: App, Cache, Secrets Manager, Database
App -> Cache: get credentials (cached 5 min)
App -> Database: connect
Database --> App: auth failed (password rotated)
App -> Secrets Manager: refresh now
Secrets Manager --> App: new AWSCURRENT
App -> Database: reconnect → ok
```

---

### Q18. Rotation succeeded in Secrets Manager but the database still has the old password?

With a correct rotation function this shouldn't happen (finishSecret runs only after testSecret passes). If someone manually ran `PutSecretValue` or a custom function skipped testing: AWSCURRENT is wrong → apps fail. Mitigate: move `AWSCURRENT` back to `AWSPREVIOUS` version (`UpdateSecretVersionStage`), fix the function, add testSecret, alarm on rotation failures (`RotationFailed` events).

```flow
pipeline: Rotation "succeeded" but DB has old password
Check rotation function logs > Did setSecret actually run ALTER USER?
Network access > Can the function reach the DB (VPC, SG)?
Permissions > DB user allowed to change the password?
Labels > Is AWSCURRENT on the version the DB really has?
```

---

### Q19. Rotating a DB password vs an OAuth token vs an API key

```flow
pipeline: Rotating different secret types
Database password > Managed rotation / Lambda: change in DB, test, swap labels.
OAuth client secret > Create new secret at the IdP, deploy, revoke old.
OAuth access token > Short-lived; refresh via refresh token, not "rotation".
Third-party API key > Create new key, switch, revoke old (provider must allow two keys).
```

- **DB password:** you control both sides → full automatic rotation.
- **OAuth client secret:** rotate in the IdP (often supports two active secrets) then update the secret; access tokens are short-lived anyway and refreshed by the app/token vault, not stored long-term.
- **Third-party API key:** depends on vendor API; if no API, rotation is a documented manual runbook with overlap (create new key → update secret → verify → revoke old).

---

## 5. Consuming secrets: ECS, Lambda, EC2, Terraform

### Q20. ECS task-injected secrets — behaviour during rotation

`secrets` in the task definition are resolved **once at task start** (by the execution role) and injected as env vars. After rotation, running tasks still hold the **old value** until replaced. Options: force a new deployment after rotation (EventBridge rule on rotation → `UpdateService --force-new-deployment`), use alternating-users so old creds stay valid, or have the app fetch at runtime with a cache.

```flow
trace: ECS-injected secret during rotation
task starts → env DB_PASSWORD = **v2** > Read once at task start.
rotation → AWSCURRENT = **v3** > Running tasks still hold v2.
single-user rotation  →  tasks fail auth **until replaced** > Old password no longer valid.
fix: alternating users, or fetch at runtime, or redeploy tasks after rotation > Know which model you use.
```

```json
"secrets": [
  { "name": "DB_PASSWORD", "valueFrom": "arn:aws:secretsmanager:ap-south-1:123:secret:prod/payments/db-AbC123:password::" }
]
```
(`:password::` selects a JSON key; version stage/ID can be appended.)

---

### Q21. Lambda: retrieve and cache

```flow
pipeline: Secrets in Lambda
Read outside the handler > Once per environment.
Cache with TTL > Extension or Powertools parameters.
Refresh on auth failure > Handles rotation.
Never log it > Or put it in environment variables in plain text.
```

```python
from aws_lambda_powertools.utilities import parameters

def handler(event, context):
    db = parameters.get_secret("prod/payments/db", transform="json", max_age=300)  # cached 5 min
    ...
```
Or the **AWS Parameters and Secrets Lambda Extension** (local HTTP cache at `localhost:2773`), or the AWS-provided caching client libraries (`aws-secretsmanager-caching`). Fetch at INIT/first use, not per request.

---

### Q22. Never leak secrets into logs

Don't log config objects or exception messages that include connection strings; redact with logging filters; avoid `set -x` in CI; avoid returning secrets in API errors; mark Terraform variables `sensitive`; review Step Functions inputs (execution history is visible); scan logs/repos with secret detection.

```flow
pipeline: Keeping secrets out of logs
Structured logging with redaction > Mask known fields (password, token, authorization).
Don't log full requests/configs > Allowlist fields instead.
Scan logs > Secret detectors on log streams.
Leak? > Rotate immediately, purge logs where possible.
```

```python
class RedactFilter(logging.Filter):
    PATTERN = re.compile(r"(password|secret|token)=([^&\s]+)", re.I)
    def filter(self, record):
        record.msg = self.PATTERN.sub(r"\1=***", str(record.msg)); return True
```

---

### Q23. Terraform and secrets

Creating a secret with its value in Terraform puts the value in **state**. Prefer: Terraform creates the secret resource (container) and access policies; value set by rotation/out-of-band; or use **ephemeral resources/write-only arguments** (`secret_string_wo`) in newer Terraform; or let RDS manage the master password (`manage_master_user_password = true`). Protect state (encrypted S3, restricted IAM).

```flow
pipeline: Terraform and secrets
Terraform creates the secret resource > Name, policy, rotation config.
Value set outside or write-only > So it isn't in state.
Apps read at runtime > Never via Terraform outputs.
State protected anyway > Encrypted, restricted.
```

---

### Q24. Auditing secret access

CloudTrail logs `GetSecretValue`, `PutSecretValue`, `RotateSecret`, `DeleteSecret`… with caller identity. Create alarms/EventBridge rules for: access from unexpected principals, deletes, policy changes, rotation failures. AWS Config rules: `secretsmanager-rotation-enabled-check`, `secretsmanager-secret-unused`. Security Hub controls flag unrotated secrets.

```flow
pipeline: Auditing secret access
CloudTrail > Every GetSecretValue with caller identity.
Alarms > Access from unexpected roles/IPs, spikes, failed attempts.
Config rules > Rotation enabled? Unused secrets?
Review > Regularly remove access nobody uses.
```

---

## 6. Agents & multi-tenant credentials

### Q25. Inject an OAuth client secret securely

Store client secret in Secrets Manager (CMK), grant read only to the token-exchange component (or use **AgentCore Identity credential providers**, which store client secrets/tokens in a managed token vault). The agent never sees the client secret; it receives short-lived access tokens. Tokens obtained for users are stored per user, encrypted, with refresh handled centrally.

```flow
sequence: Using an OAuth client secret without exposing it
actors: Backend, Secrets Manager, IdP
Backend -> Secrets Manager: get client_secret (cached)
Backend -> IdP: token request (client_id + client_secret)
IdP --> Backend: access token (short-lived)
Backend -> Backend: call APIs with the token
> The secret never reaches the browser or the LLM; only the backend holds it.
```

---

### Q26. Avoid cross-tenant secret exposure in agent systems

Per-tenant secrets named and tagged by tenant (`prod/tenants/t-42/jira`), ABAC policy so a session can read only secrets whose `tenant` tag matches its session tag, or per-user OAuth tokens in a token vault keyed by verified identity. Never let the model choose which secret to load; the tool code decides from trusted context. Secrets never placed in prompts or traces.

```flow
pipeline: Preventing cross-tenant secret exposure
Secret per tenant > tenants/{id}/… naming.
Access by verified tenant > ABAC tags or per-tenant role.
Never via the model > Tools fetch credentials server-side.
Audit > Alert on cross-tenant access attempts.
```

```json
"Condition": { "StringEquals": { "secretsmanager:ResourceTag/tenant": "${aws:PrincipalTag/tenant}" } }
```

---

### Q27. Design: agent calling Jira and Confluence securely

```flow
sequence: Agent calling Jira as the user
actors: User, API, Agent (Runtime), Gateway, Token vault, Jira
User -> API: request (Okta JWT)
API -> Agent (Runtime): invoke with user context
Agent (Runtime) -> Gateway: tool call (MCP)
Gateway -> Token vault: outbound auth: token for THIS user
> 3LO OAuth: the user consented once; the token is stored in AgentCore Identity's vault, never shown to the model.
Token vault --> Gateway: user's access token
Gateway -> Jira: API call as the user
> Jira enforces the user's own permissions. A service account is only a fallback for read-only org-wide content, kept in Secrets Manager and rotated.
```
Benefits: least privilege (user's own rights), no static secrets in code, centralised revocation, audit.

---

## 7. Scenario & debugging questions

### Q28. ECS app gets AccessDenied reading a secret

Determine **who** reads it: injected `secrets` → **execution role**; runtime SDK call → **task role**. Check: action `GetSecretValue` on correct ARN (suffix wildcard `-??????`), KMS key policy/grant allows `kms:Decrypt` for that role, resource policy explicit deny, SCP deny, VPC endpoint policy, correct region. CloudTrail shows the denied call and principal. Error `ResourceInitializationError: unable to pull secrets` = execution role or network path (no NAT/endpoint).

```flow
pipeline: AccessDenied reading a secret from ECS
Right role? > Injection uses the execution role; runtime SDK calls use the task role.
IAM allows GetSecretValue on this ARN? > Watch the random suffix.
KMS decrypt allowed? > Customer managed key policy.
Resource policy / SCP deny? > Or a VPC endpoint condition.
```

---

### Q29. A password rotation caused an outage. Mitigation and prevention

Immediate: revert AWSCURRENT to AWSPREVIOUS (if DB still accepts old) or set DB password to match current; restart/redeploy clients to pick up the value. Prevention: alternating-users strategy, apps re-fetch on auth failure, testSecret step, rotation windows outside peak, alarms, ECS redeploy automation after rotation, staged rotation in non-prod first.

```flow
pipeline: A rotation caused an outage
Mitigate > Roll AWSCURRENT back to AWSPREVIOUS / restart tasks.
Find why > Apps cached forever? Single-user rotation with long-lived connections?
Fix design > Alternating users, cache TTL + refresh on auth failure.
Test rotation > In staging, on a schedule, with alarms.
```

---

### Q30. Secrets Manager API throttling during a traffic spike

Apps fetch secrets per request. Fix with caching (Powertools/extension/caching client), fetch at startup, exponential backoff, check `GetSecretValue` rate in CloudWatch/CloudTrail.

```flow
pipeline: Throttled during a traffic spike
Cause > Every request calls GetSecretValue.
Cache client-side > TTL minutes, not per request.
Read at startup > Share across requests.
Retry with backoff > For the rare refresh.
```

---

### Q31. A secret was committed to git. What do you do?

Treat as compromised: **rotate/revoke immediately** (removing the commit isn't enough — clones and caches exist), check CloudTrail/vendor logs for misuse, purge from history if policy requires, add pre-commit/push-protection secret scanning, move the secret to Secrets Manager.

```flow
pipeline: A secret was committed to git
Rotate / revoke immediately > Assume it's compromised: removal alone isn't enough.
Check usage > Logs for misuse since the commit.
Remove from history > If required (filter-repo), force-push with coordination.
Prevent > Secret scanning + pre-commit hooks.
```

---

## 8. Cheat sheet

| Concept | One-liner |
|---|---|
| Secrets Manager | store + rotate + audit + replicate secrets, KMS-encrypted |
| vs Parameter Store | rotation/replication/cross-account vs cheap config |
| ARN suffix | random 6 chars; use `-??????` in policies |
| Labels | AWSCURRENT, AWSPREVIOUS, AWSPENDING |
| Read permission | `GetSecretValue` + `kms:Decrypt` |
| Cross-account | resource policy + CMK key policy + caller policy |
| Rotation steps | create → set → test → finish (idempotent) |
| Zero-downtime rotation | alternating users + client re-fetch on auth failure |
| ECS | injected at start by execution role; redeploy after rotation |
| Lambda | cache via Powertools/extension |
| Terraform | value in state! → ephemeral/write-only or AWS-managed |
| Deletion | 7–30 day recovery window |
| Agents | token vault / 3LO per user; never in prompts or logs |

## Official references

- https://docs.aws.amazon.com/secretsmanager/latest/userguide/intro.html
- Rotation: https://docs.aws.amazon.com/secretsmanager/latest/userguide/rotating-secrets.html
- Authentication & access control: https://docs.aws.amazon.com/secretsmanager/latest/userguide/auth-and-access.html
- ECS secrets: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/specifying-sensitive-data-secrets.html
- Lambda extension: https://docs.aws.amazon.com/secretsmanager/latest/userguide/retrieving-secrets_lambda.html
