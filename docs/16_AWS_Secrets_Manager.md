# AWS Secrets Manager: L2 → L3 Interview Preparation

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

```bash
aws secretsmanager create-secret --name prod/payments/db \
  --secret-string '{"username":"app","password":"S3cr3t!","host":"db.internal","port":5432}' \
  --kms-key-id alias/payments-secrets
aws secretsmanager get-secret-value --secret-id prod/payments/db --query SecretString
```

---

### Q02. Secrets Manager vs SSM Parameter Store

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

---

### Q04. Versions and staging labels

**Short answer:** Each change creates a **version** (UUID). **Staging labels** point to versions: `AWSCURRENT` (default read), `AWSPREVIOUS` (last good — lets you roll back or let old clients keep working), `AWSPENDING` (new value during rotation). You can read a specific version by ID or label.

---

### Q05. Naming and tagging strategy

`<env>/<team-or-app>/<purpose>` e.g. `prod/payments/db`, `prod/agent/jira-oauth`. Tags (`env`, `team`, `data-class`) enable ABAC policies (`secretsmanager:ResourceTag/team`) and cost/ownership tracking.

---

### Q06. Deletion and recovery window

`DeleteSecret` schedules deletion with a **recovery window of 7–30 days** (default 30); `RestoreSecret` cancels it. `--force-delete-without-recovery` deletes immediately (dangerous). Alarm on `DeleteSecret` events in CloudTrail.

---

### Q07. Multi-region replication

Replicate a secret to other regions (replica secrets, read-only, kept in sync, can use a different KMS key per region) for DR and multi-region apps. Rotation happens on the primary and propagates. In DR you can promote a replica to standalone.

---

### Q08. Generating strong secrets

`aws secretsmanager get-random-password --password-length 32 --exclude-characters '"@/\'` — use in rotation functions or provisioning instead of human-chosen passwords.

---

## 3. Access control & encryption

### Q09. IAM actions for retrieving a secret

**Short answer:** Readers need `secretsmanager:GetSecretValue` on the secret ARN **and** `kms:Decrypt` on its KMS key (if a customer-managed key; via the key policy/grants). `DescribeSecret` for metadata; `ListSecrets` only if needed (reveals names). Writers/rotators need `PutSecretValue`, `UpdateSecretVersionStage`, etc.

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

---

### Q11. Resource policies and cross-account access

Attach a **resource policy** to the secret granting a principal in another account; that account's identity policy must also allow it; the secret must use a **customer-managed KMS key** whose key policy allows the other account to decrypt. Use `BlockPublicPolicy` validation and conditions like `aws:PrincipalOrgID`.

---

### Q12. Why `secretsmanager:*` is dangerous

It allows reading **every** secret, changing values, disabling rotation, deleting secrets, and modifying resource policies (granting outsiders access). Grant only the actions and secret ARNs needed; separate read (apps), rotate (rotation function), admin (platform team) roles.

---

### Q13. Restricting access by network or context

Conditions such as `aws:SourceVpce` (only through your VPC endpoint), `aws:SourceVpc`, `aws:PrincipalTag`, `secretsmanager:ResourceTag`. Use an **interface VPC endpoint** for Secrets Manager so private workloads don't need NAT, plus an endpoint policy.

---

## 4. Rotation

### Q14. What is automatic rotation and why do it?

**Short answer:** Periodically replace a secret's value (every N days/hours, or on schedule expression) to limit the damage of a leaked credential. Two flavours: **managed rotation** (AWS handles it, e.g., RDS-managed master passwords) and **Lambda rotation functions** (AWS templates for RDS/Aurora/Redshift/DocumentDB, or custom for any system).

---

### Q15. The four steps of a rotation function

```
 1. createSecret  – generate new value, store as AWSPENDING version
 2. setSecret     – set the new credential in the target system (ALTER USER … PASSWORD …)
 3. testSecret    – log in with AWSPENDING to verify it works
 4. finishSecret  – move AWSCURRENT label to the new version (old becomes AWSPREVIOUS)
```
Each step must be **idempotent** (rotation can retry). If any step fails, AWSCURRENT stays on the old version, so apps keep working.

---

### Q16. Single-user vs alternating-users rotation

- **Single user:** change the password of the same DB user. Brief window where connections using the old password fail until clients refresh.
- **Alternating users:** two DB users (`app_a`, `app_b`); rotation updates the *inactive* one and switches AWSCURRENT → old credential remains valid during the transition → near-zero downtime. Requires a superuser/"rotator" secret.

---

### Q17. How should apps handle rotation?

Cache the secret with a TTL (e.g., 5–15 min); on **authentication failure**, re-fetch AWSCURRENT and retry once; use connection pools that can reconnect. Don't fetch on every request (cost/latency/throttling), and don't cache forever.

---

### Q18. Rotation succeeded in Secrets Manager but the database still has the old password?

With a correct rotation function this shouldn't happen (finishSecret runs only after testSecret passes). If someone manually ran `PutSecretValue` or a custom function skipped testing: AWSCURRENT is wrong → apps fail. Mitigate: move `AWSCURRENT` back to `AWSPREVIOUS` version (`UpdateSecretVersionStage`), fix the function, add testSecret, alarm on rotation failures (`RotationFailed` events).

---

### Q19. Rotating a DB password vs an OAuth token vs an API key

- **DB password:** you control both sides → full automatic rotation.
- **OAuth client secret:** rotate in the IdP (often supports two active secrets) then update the secret; access tokens are short-lived anyway and refreshed by the app/token vault, not stored long-term.
- **Third-party API key:** depends on vendor API; if no API, rotation is a documented manual runbook with overlap (create new key → update secret → verify → revoke old).

---

## 5. Consuming secrets: ECS, Lambda, EC2, Terraform

### Q20. ECS task-injected secrets — behaviour during rotation

`secrets` in the task definition are resolved **once at task start** (by the execution role) and injected as env vars. After rotation, running tasks still hold the **old value** until replaced. Options: force a new deployment after rotation (EventBridge rule on rotation → `UpdateService --force-new-deployment`), use alternating-users so old creds stay valid, or have the app fetch at runtime with a cache.

```json
"secrets": [
  { "name": "DB_PASSWORD", "valueFrom": "arn:aws:secretsmanager:ap-south-1:123:secret:prod/payments/db-AbC123:password::" }
]
```
(`:password::` selects a JSON key; version stage/ID can be appended.)

---

### Q21. Lambda: retrieve and cache

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

```python
class RedactFilter(logging.Filter):
    PATTERN = re.compile(r"(password|secret|token)=([^&\s]+)", re.I)
    def filter(self, record):
        record.msg = self.PATTERN.sub(r"\1=***", str(record.msg)); return True
```

---

### Q23. Terraform and secrets

Creating a secret with its value in Terraform puts the value in **state**. Prefer: Terraform creates the secret resource (container) and access policies; value set by rotation/out-of-band; or use **ephemeral resources/write-only arguments** (`secret_string_wo`) in newer Terraform; or let RDS manage the master password (`manage_master_user_password = true`). Protect state (encrypted S3, restricted IAM).

---

### Q24. Auditing secret access

CloudTrail logs `GetSecretValue`, `PutSecretValue`, `RotateSecret`, `DeleteSecret`… with caller identity. Create alarms/EventBridge rules for: access from unexpected principals, deletes, policy changes, rotation failures. AWS Config rules: `secretsmanager-rotation-enabled-check`, `secretsmanager-secret-unused`. Security Hub controls flag unrotated secrets.

---

## 6. Agents & multi-tenant credentials

### Q25. Inject an OAuth client secret securely

Store client secret in Secrets Manager (CMK), grant read only to the token-exchange component (or use **AgentCore Identity credential providers**, which store client secrets/tokens in a managed token vault). The agent never sees the client secret; it receives short-lived access tokens. Tokens obtained for users are stored per user, encrypted, with refresh handled centrally.

---

### Q26. Avoid cross-tenant secret exposure in agent systems

Per-tenant secrets named and tagged by tenant (`prod/tenants/t-42/jira`), ABAC policy so a session can read only secrets whose `tenant` tag matches its session tag, or per-user OAuth tokens in a token vault keyed by verified identity. Never let the model choose which secret to load; the tool code decides from trusted context. Secrets never placed in prompts or traces.

```json
"Condition": { "StringEquals": { "secretsmanager:ResourceTag/tenant": "${aws:PrincipalTag/tenant}" } }
```

---

### Q27. Design: agent calling Jira and Confluence securely

```
 User (Okta) ─► API ─► AgentCore Runtime (agent) ─► AgentCore Gateway (MCP)
                                                   │ outbound auth via Identity credential provider
                                                   ▼
                              3LO OAuth: token for THIS user (consented once) from token vault
                              → Jira/Confluence enforce the user's own permissions
 Fallback service account (2LO/API token) only for read-only org-wide content, stored in
 Secrets Manager/token vault, rotated, scoped minimal; never shared with the model.
```
Benefits: least privilege (user's own rights), no static secrets in code, centralised revocation, audit.

---

## 7. Scenario & debugging questions

### Q28. ECS app gets AccessDenied reading a secret

Determine **who** reads it: injected `secrets` → **execution role**; runtime SDK call → **task role**. Check: action `GetSecretValue` on correct ARN (suffix wildcard `-??????`), KMS key policy/grant allows `kms:Decrypt` for that role, resource policy explicit deny, SCP deny, VPC endpoint policy, correct region. CloudTrail shows the denied call and principal. Error `ResourceInitializationError: unable to pull secrets` = execution role or network path (no NAT/endpoint).

---

### Q29. A password rotation caused an outage. Mitigation and prevention

Immediate: revert AWSCURRENT to AWSPREVIOUS (if DB still accepts old) or set DB password to match current; restart/redeploy clients to pick up the value. Prevention: alternating-users strategy, apps re-fetch on auth failure, testSecret step, rotation windows outside peak, alarms, ECS redeploy automation after rotation, staged rotation in non-prod first.

---

### Q30. Secrets Manager API throttling during a traffic spike

Apps fetch secrets per request. Fix with caching (Powertools/extension/caching client), fetch at startup, exponential backoff, check `GetSecretValue` rate in CloudWatch/CloudTrail.

---

### Q31. A secret was committed to git. What do you do?

Treat as compromised: **rotate/revoke immediately** (removing the commit isn't enough — clones and caches exist), check CloudTrail/vendor logs for misuse, purge from history if policy requires, add pre-commit/push-protection secret scanning, move the secret to Secrets Manager.

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
