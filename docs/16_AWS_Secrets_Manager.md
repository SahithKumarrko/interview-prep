# AWS Secrets Manager: Interview Preparation

> **Updated:** 27 October 2026 · **Level:** what a secret is → access control & encryption → rotation → consuming secrets safely → agents and multi-tenant credentials
> **How to use:** read the *Short answer* first, then *How it works* and the *Example* walkthrough. *Common mistake → fix* shows what goes wrong in real systems. *Interview answer* is what you can say out loud.

---

## Table of contents

1. [Mental model: the life of a secret](#1-mental-model-the-life-of-a-secret)
2. [Fundamentals](#2-fundamentals) (Q01–Q10)
3. [Access control & encryption](#3-access-control--encryption) (Q11–Q16)
4. [Rotation](#4-rotation) (Q17–Q23)
5. [Consuming secrets: SDK, ECS, Lambda, VPC, Terraform](#5-consuming-secrets-sdk-ecs-lambda-vpc-terraform) (Q24–Q30)
6. [Agents & multi-tenant credentials](#6-agents--multi-tenant-credentials) (Q31–Q33)
7. [Scenario & debugging questions](#7-scenario--debugging-questions) (Q34–Q39)
8. [Cheat sheet](#8-cheat-sheet)

---

## 1. Mental model: the life of a secret

**The one idea everything else follows from:** a password or API key should **not live in your code or your configuration files**. It lives in one guarded vault. Your application asks the vault for it **at run time**, the vault checks **who is asking**, hands over the value, and writes a record of the request. Because the value lives in one place, you can **change it** (rotate it) without redeploying every application that uses it, and you can see exactly who read it.

Think of a hotel safe-deposit room. Guests (applications) don't keep the jewellery in their rooms; the staff (Secrets Manager) check ID before opening a box, log every opening, and can swap the contents on a schedule without the guest needing to move rooms.

```flow
pipeline: One secret, from creation to audit
stage: 1. Store
Create secret prod/payments/db with a JSON value > The value is encrypted with a KMS (Key Management Service) key; the secret gets a version labeled AWSCURRENT.
stage: 2. Use
The payments service role calls GetSecretValue > IAM and the KMS key policy are both checked; the plaintext is returned over TLS.
The service caches the value for 5 minutes > It does not call the vault on every request.
stage: 3. Change
Rotation creates a new version, tests it, then moves the AWSCURRENT label > The old version becomes AWSPREVIOUS.
stage: 4. Audit
CloudTrail records every call with the caller's identity > An alarm can fire on unusual access or on deletion.
```

**Three rules that come straight from this model:**
1. **Give each identity the smallest set of secrets it needs.** Reading a secret needs permission on the secret *and* on its encryption key.
2. **Applications must cope with change.** Cache with a short lifetime, and when a login fails, fetch the secret again before giving up.
3. **A secret that leaks must be rotated, not just removed.** Deleting the evidence does not un-leak the value.

---

## 2. Fundamentals

### Q01. What is a secret, and what is AWS Secrets Manager?

**Short answer:** A **secret** is any sensitive value an application needs to prove who it is or to reach something: a database password, an API key, an OAuth client secret. **AWS Secrets Manager** is the managed service that **stores** secrets encrypted, **controls** who may read them, **rotates** them automatically, **replicates** them across Regions, and **logs** every access. It replaces hard-coded credentials with a run-time call.

**How it works:**
1. You create a secret with a name and a value (a string, often JSON, or binary).
2. Secrets Manager encrypts the value with an AWS KMS key.
3. Applications call `GetSecretValue` using their IAM (Identity and Access Management) role; Secrets Manager decrypts and returns the value.
4. You can switch on rotation so the value is changed on a schedule.
5. Every API call appears in AWS CloudTrail.

**Example:**
```bash
aws secretsmanager create-secret --name prod/payments/db \
  --secret-string '{"username":"app","password":"S3cr3t-example","host":"db.internal","port":5432}' \
  --kms-key-id alias/payments-secrets

aws secretsmanager get-secret-value --secret-id prod/payments/db --query SecretString --output text
```

**What happens, step by step:**
1. `create-secret` stores the JSON encrypted under the `payments-secrets` key and returns the secret's ARN (Amazon Resource Name, its global ID), e.g. `arn:aws:secretsmanager:eu-west-1:123456789012:secret:prod/payments/db-AbC123`.
2. `get-secret-value` is called by a user or role. IAM allows it; KMS allows decryption; the JSON string comes back.
3. CloudTrail now contains one `CreateSecret` and one `GetSecretValue` event, each with the caller's identity and time.

**Common mistake → fix:** putting the database password in an environment variable defined in the repository's deployment file. Anyone with repo access, build logs or the function's configuration can read it, and changing it means redeploying. Fix: store the password in Secrets Manager and let the application fetch it at run time.

**Interview answer:** "Secrets Manager is AWS's managed vault for credentials. It stores secrets encrypted with KMS, controls access with IAM and resource policies, logs every access in CloudTrail, can rotate secrets automatically and replicate them across Regions. Applications fetch values at run time and cache them, so there are no credentials in code or config."

**Follow-ups:**
- *Which AWS secrets should not go here?* AWS credentials belong in IAM roles, encryption keys in KMS, certificates in ACM (AWS Certificate Manager), and SSH keys in tools like EC2 Instance Connect.

---

### Q02. What is inside a secret?

**Short answer:** A secret is a **secret value** (a string or binary, up to **65,536 bytes**) plus **metadata**: its name, description, ARN, the KMS key that protects it, tags, an optional resource policy, and rotation settings. The value has **versions**; the metadata is not encrypted. To store several related values, put a **JSON object** in the string.

**How it works:**
- **Name:** up to you; paths such as `prod/payments/db` are common.
- **ARN:** `arn:aws:secretsmanager:<Region>:<Account>:secret:<name>-<6 random characters>`.
- **Value:** the encrypted data. Name, description, rotation settings, KMS key ARN and tags are **not** encrypted, so never put sensitive data in them.
- **Database secrets** that you want to rotate automatically must use the JSON structure the rotation function expects (`engine`, `host`, `username`, `password`, `dbname`, `port`).
- A secret can be **replicated** to other Regions, and has a **resource policy** and **tags** like other AWS resources.

**Example:**
```json
{
  "engine": "postgres",
  "host": "payments-db.cluster-abc.eu-west-1.rds.amazonaws.com",
  "port": 5432,
  "dbname": "payments",
  "username": "app_user",
  "password": "example-only-not-real"
}
```

**What happens, step by step:** an application calls `GetSecretValue` and receives this JSON in the `SecretString` field, parses it, and builds its connection from `host`, `port`, `username` and `password`. When rotation changes the password, the same keys come back with a new `password`, so the application code doesn't change.

**Common mistake → fix:** storing each field as a separate secret (`db-host`, `db-user`, `db-password`). It multiplies cost, API calls and permissions, and rotation can't update them together. Fix: one JSON secret per credential set.

**Interview answer:** "A secret is an encrypted value, up to 64 KB, plus unencrypted metadata: name, ARN, tags, description, rotation configuration, KMS key ARN and an optional resource policy. I store related values as one JSON object, and for database secrets I follow the JSON structure that the rotation functions expect. Because metadata isn't encrypted, I never put sensitive data in names, descriptions or tags."

**Follow-ups:**
- *Can the value be binary?* Yes, `SecretBinary`, within the same size limit.

---

### Q03. Secrets Manager vs Parameter Store: which one do I choose?

**Short answer:** **Secrets Manager** is built for **secrets with a lifecycle**: automatic rotation, cross-Region replication, resource policies for cross-account sharing, and 64 KB values. **Parameter Store** (part of AWS Systems Manager) is built for **configuration**: hierarchical names, standard parameters are free, and `SecureString` can encrypt simple secrets. Rule: credentials that should rotate or be shared across accounts go in Secrets Manager; plain config and feature flags go in Parameter Store (or AppConfig).

**How it works:**

| | Secrets Manager | Parameter Store |
|---|---|---|
| Main purpose | Secrets with rotation and audit | Configuration and simple secrets (`SecureString`) |
| Built-in rotation | Yes (managed rotation, or Lambda functions) | No |
| Cross-Region replication | Yes | Not built in |
| Cross-account | Resource policy plus customer managed KMS key | Only advanced-tier parameters, via sharing |
| Max value size | 65,536 bytes | 4 KB standard, 8 KB advanced |
| Number allowed | 500,000 secrets per Region | 10,000 standard, 100,000 advanced |
| Cost | Paid per secret per month plus API calls | Standard tier has no extra charge; advanced is charged |

**Example — choosing for four items:**
1. Database password that must change every 30 days → Secrets Manager.
2. Third-party API key shared with another AWS account → Secrets Manager.
3. Feature flag `new-checkout=true` → Parameter Store or AppConfig.
4. A rarely changing, non-rotating internal token for one app → either; Parameter Store `SecureString` is cheaper.

**What happens, step by step:** if you put the rotating database password in Parameter Store, you must build and run your own rotation job, alarms and cross-account sharing; with Secrets Manager those exist. If you put 2,000 feature flags in Secrets Manager, you pay per secret per month for values that never needed encryption or rotation.

**Common mistake → fix:** storing every setting in Secrets Manager "to be safe". It's costly and slows reads for things nobody needs to protect. Fix: classify values; secrets that need rotation or sharing go to Secrets Manager, everything else to Parameter Store.

**Interview answer:** "Secrets Manager is for credentials with a lifecycle: built-in rotation, replication, cross-account resource policies and 64 KB values. Parameter Store is for configuration and simple secrets, with a free standard tier but no built-in rotation. I choose Secrets Manager when a value must rotate or be shared across accounts, and Parameter Store or AppConfig for plain config and flags."

**Follow-ups:**
- *Can ECS or Lambda read from both?* Yes, ECS task definitions can inject from either, and the Lambda extension reads both.

---

### Q04. Why does a secret's ARN end in random characters?

**Short answer:** Secrets Manager adds **six random characters** to the secret's name to make its ARN: `...:secret:prod/payments/db-AbC123`. If someone deletes the secret and creates a new one with the same name, the new ARN has **different** characters, so a policy that pinned the old ARN does not accidentally grant access to the new secret. In policies, use the full ARN or the name followed by `-??????`.

**How it works:**
- `?` matches exactly one character, so `prod/payments/db-??????` matches six characters.
- `prod/payments/db-*` is **too broad**: it also matches `prod/payments/db-admin-xyz` because `*` matches anything.
- A `-??????` pattern lets you write a policy before the secret exists. But if the secret is deleted and recreated with the same name, a `-??????` policy covers the new secret too; a full-ARN policy does not.

**Example:**
```json
"Resource": [
  "arn:aws:secretsmanager:eu-west-1:123456789012:secret:prod/payments/db-AbC123",
  "arn:aws:secretsmanager:eu-west-1:123456789012:secret:prod/payments/api-??????"
]
```

**What happens, step by step:** `prod/payments/db` is deleted and recreated; its ARN becomes `...db-XyZ789`. The first statement (pinned) no longer matches, so the role loses access, which is safer and surfaces as an error. The second (`-??????`) still matches, so the role silently keeps access to the new secret.

**Common mistake → fix:** writing `secret:prod/payments/db*` to "cover the suffix". It also matches `prod/payments/db-admin-AbC123` and `prod/payments/db2-...`. Fix: use `-??????`, or the exact ARN when you want the pin.

**Interview answer:** "The six random characters make each secret's ARN unique, so deleting and recreating a name doesn't silently reuse old permissions. In policies I use the exact ARN when I want that pinning, or the name plus six question marks when I need to grant before creation; I avoid a trailing star because it matches other secrets with a similar prefix."

**Follow-ups:**
- *Can I call the API by name?* Yes within the same account; for cross-account access use the full ARN.

---

### Q05. What are secret versions and staging labels?

**Short answer:** Every change to a secret's value creates a new **version** (identified by a UUID). Versions are not numbered in order; instead **staging labels** mark the ones that matter: **`AWSCURRENT`** (what readers get by default), **`AWSPREVIOUS`** (the last good value), and **`AWSPENDING`** (a new value being rotated in). You can add your own labels, up to 20 labels per secret across all versions, and a label can be on only one version at a time.

**How it works:**
- `GetSecretValue` with no version returns the version labeled `AWSCURRENT`.
- You can request a specific `VersionId` or `VersionStage`.
- Secrets Manager **never deletes labeled versions**. Versions with no label are "deprecated" and are removed when there are more than 100, but never within 24 hours of creation.
- Moving a label (`update-secret-version-stage`) is how you promote or roll back a value without changing it.
- Avoid updating a secret's value more often than about once every 10 minutes, because new unlabeled versions can accumulate faster than they're cleaned up.

**Example:**
```bash
aws secretsmanager list-secret-version-ids --secret-id prod/payments/db
# v-aaa  [AWSPREVIOUS]
# v-bbb  [AWSCURRENT]
aws secretsmanager get-secret-value --secret-id prod/payments/db --version-stage AWSPREVIOUS
```

```flow
trace: Staging labels during one rotation
before: v-aaa **AWSPREVIOUS**, v-bbb **AWSCURRENT** > Readers get v-bbb by default.
rotation creates v-ccc with the label **AWSPENDING** > The new password exists in the vault but is not what readers get yet.
database updated with v-ccc's password and test login succeeds > The rotation function has proved the new value works.
labels move: v-ccc **AWSCURRENT**, v-bbb AWSPREVIOUS > v-aaa has no label and becomes deprecated.
rollback if needed: move AWSCURRENT back to v-bbb > No data is lost; labels are just pointers.
```

**What happens, step by step:** readers calling `GetSecretValue` during the PENDING phase still receive v-bbb, so nothing breaks. After `finishSecret` moves the label, new reads get v-ccc, while the older value remains retrievable as `AWSPREVIOUS` for clients that haven't refreshed yet.

**Common mistake → fix:** pinning an application to a `VersionId` "for stability". After the next rotation the pinned version is no longer current and may be deleted once unlabeled, so the app breaks. Fix: read `AWSCURRENT` by default; use `AWSPREVIOUS` only as a deliberate fallback.

**Interview answer:** "Each change creates a version; staging labels point to versions. AWSCURRENT is what readers get, AWSPREVIOUS is the last good value, and AWSPENDING is the new value during rotation. Labeled versions are never removed, unlabeled ones are cleaned up past 100. Rotation works by creating a PENDING version, testing it, then moving AWSCURRENT, and rollback is just moving the label back."

**Follow-ups:**
- *Why keep AWSPREVIOUS?* It lets clients holding the old credential, or a rollback, keep working during the switch.

---

### Q06. How should you name and tag secrets?

**Short answer:** Use a predictable path like **`<environment>/<application>/<purpose>`**, for example `prod/payments/db` or `prod/agent/jira-oauth`, and add tags such as `env`, `team`, `data-class` and `cost-center`. Consistent names let you write IAM policies by prefix, and tags enable **ABAC** (attribute-based access control) and cost tracking.

**How it works:**
- A policy on `arn:aws:secretsmanager:*:*:secret:prod/payments/*` covers every secret under that path.
- Condition keys such as `secretsmanager:ResourceTag/team` compare a secret's tag with the caller's `aws:PrincipalTag/team`, so one policy serves many teams.
- Tags are not encrypted, so never place sensitive information in them.
- Cost-allocation tags let you attribute spend to teams.

**Example:**
```bash
aws secretsmanager create-secret --name prod/payments/db --secret-string file://db.json \
  --tags Key=env,Value=prod Key=team,Value=payments Key=data-class,Value=restricted
```
```json
{ "Effect": "Allow", "Action": "secretsmanager:GetSecretValue", "Resource": "*",
  "Condition": { "StringEquals": { "secretsmanager:ResourceTag/team": "${aws:PrincipalTag/team}" } } }
```

**What happens, step by step:** a role tagged `team=payments` can read `prod/payments/db` (tag matches) but gets AccessDenied on `prod/search/api-key` (tagged `team=search`), even though both sit under the same policy. A new team gets access by tagging its roles and secrets, with no new policy.

**Common mistake → fix:** names like `my-db-pass-final2`. Nobody knows what it is, which environment it belongs to or who owns it, and prefix-based policies are impossible. Fix: adopt the path convention and require tags at creation (for example with a tag policy or SCP).

**Interview answer:** "I name secrets as environment, application and purpose, like prod/payments/db, and tag them with team, environment and data classification. That gives me prefix-scoped policies, tag-based ABAC so one policy scales across teams, and ownership and cost reporting."

**Follow-ups:**
- *Where do I put the tenant ID for multi-tenant systems?* In the path and a `tenant` tag (see the agents section).

---

### Q07. What happens when you delete a secret?

**Short answer:** `DeleteSecret` does **not** delete immediately. The secret becomes **inaccessible** and is scheduled for deletion after a **recovery window of 7 to 30 days** (default 30). During the window you can bring it back with `RestoreSecret`. Only `--force-delete-without-recovery` deletes at once, which cannot be undone. There's no charge for a secret marked for deletion.

**How it works:**
- During the window, `GetSecretValue` fails, which acts as a free "does anything still use this?" test.
- A primary secret that has replicas can't be deleted until the replicas are removed; replicas are deleted immediately.
- You can't delete a single version; remove its labels and it's cleaned up in the background.
- You can create a CloudWatch alarm on attempts to access a secret scheduled for deletion.

**Example:**
```bash
aws secretsmanager delete-secret --secret-id prod/legacy/api-key --recovery-window-in-days 7
aws secretsmanager restore-secret --secret-id prod/legacy/api-key       # undo within 7 days
```

```flow
trace: Deleting a secret you think is unused
Day 0: DeleteSecret with a 7-day window > The secret is immediately unreadable but still recoverable.
Day 2: the billing batch job fails with ResourceNotFound or "marked for deletion" > Failure reveals a hidden dependency.
Day 2: RestoreSecret > The secret and its versions are back, and nothing was lost.
Day 3: fix the batch job to use the new secret, then delete again > A second window gives another safety margin.
```

**What happens, step by step:** deleting on Monday breaks a monthly job on Wednesday only because that job ran early; because the data is still held, `RestoreSecret` fixes it in seconds. Had `--force-delete-without-recovery` been used, the value would be gone and you'd have to recover it from the source system.

**Common mistake → fix:** using force-delete in a cleanup script. Fix: always use a recovery window in production, and alert on `DeleteSecret` calls in CloudTrail.

**Interview answer:** "Deletion is scheduled with a recovery window of 7 to 30 days; during it the secret is unreadable but restorable with RestoreSecret, which makes it a safe way to find hidden dependencies. Force-delete skips the window and is irreversible. Replicas must be removed before the primary, and I alarm on DeleteSecret events."

**Follow-ups:**
- *Is a secret in the window billed?* No.

---

### Q08. How does multi-Region replication work?

**Short answer:** You can **replicate** a secret to other Regions. Each **replica secret** is a read-only copy kept in sync with the **primary**, with the same name and ARN apart from the Region, and it can use a different KMS key in each Region. Rotation happens in the primary and the new value propagates to every replica. If the primary Region is lost, you can **promote a replica** to a standalone secret.

**How it works:**
- Replication copies the encrypted value and metadata such as tags and resource policies.
- Each replica is encrypted with a KMS key in its own Region (the AWS managed key or your own).
- Workloads in the replica Region call the local endpoint, which gives lower latency and independence from the primary Region.
- You must enable the target Region first; AWS GovCloud and China Regions can only replicate within themselves.
- Each replica counts as a secret for pricing.

**Example:**
```bash
aws secretsmanager replicate-secret-to-regions --secret-id prod/payments/db \
  --add-replica-regions Region=eu-central-1,KmsKeyId=alias/payments-euc1

aws secretsmanager stop-replication-to-replica --secret-id arn:aws:secretsmanager:eu-central-1:123456789012:secret:prod/payments/db-AbC123   # promote in DR
```

**What happens, step by step:** the primary in `eu-west-1` rotates on day 30; the new value is copied to the replica in `eu-central-1` within moments. Services in Frankfurt read their local replica. In a Regional outage, you promote the Frankfurt replica to a standalone secret and set rotation there.

**Common mistake → fix:** a database secret replicated to another Region still points at the primary Region's database host. Fix: add regional connection keys to the secret (for example `host_euc1`) or keep per-Region secrets when the database differs.

**Interview answer:** "Replication keeps read-only copies of a secret in other Regions, each encrypted with a KMS key in its own Region, with rotation done once on the primary and propagated. I use it for multi-Region apps and DR, and in a disaster I promote a replica to standalone. I also make sure the secret's connection details make sense in each Region."

**Follow-ups:**
- *Can I delete the primary while replicas exist?* No; delete or detach the replicas first.

---

### Q09. How do you generate a strong secret value?

**Short answer:** Let AWS generate it: `GetRandomPassword` (CLI `get-random-password`) returns a cryptographically random password with the length and character rules you choose, so no human ever sees or invents the value. Rotation functions use the same call. Exclude characters your target system or connection string can't handle.

**How it works:**
- Parameters: length, which character classes to include or require, and `ExcludeCharacters`.
- Combine with `create-secret` or `put-secret-value`.
- The API has its own rate limit (50 requests per second per Region by default).

**Example:**
```bash
PASSWORD=$(aws secretsmanager get-random-password --password-length 32 \
  --exclude-characters '"@/\' --require-each-included-type --query RandomPassword --output text)
aws secretsmanager create-secret --name prod/search/admin --secret-string "{\"password\":\"$PASSWORD\"}"
```

**What happens, step by step:** the call returns a 32-character string without quotes, `@`, `/` or backslash, which would otherwise break URLs and shell strings. The value goes straight into the secret; it isn't printed in the terminal (output text is captured in a variable) or logged.

**Common mistake → fix:** a human choosing "Summer2026!" or reusing one password across environments. Fix: generated values, unique per environment, stored only in the vault.

**Interview answer:** "I use GetRandomPassword to generate secrets with the length and character set the target system accepts, excluding troublesome characters, and store them directly in Secrets Manager so no person sees them. Rotation functions use the same generator, giving consistent strength."

**Follow-ups:**
- *Does it work for non-password secrets like API keys?* It generates random strings; API keys that a vendor issues must come from the vendor.

---

### Q10. What are the limits and costs to know?

**Short answer:** Know five numbers: a secret value is up to **65,536 bytes**; each secret keeps up to **100 versions** (unlabeled ones are cleaned up); a Region can hold **500,000 secrets**; **`GetSecretValue`** is allowed **10,000 requests per second** per Region; and a secret's resource policy can be **20,480 characters**. Pricing is **per secret per month plus per API calls**, with KMS charges if you use your own key, so caching reduces cost.

**How it works:**
- Limits are per Region; for cross-account requests the **caller's** account is throttled, not the secret owner's.
- Avoid sustained `PutSecretValue`/`UpdateSecret` more often than once every 10 minutes: each creates a version, and you can reach the 100-version limit.
- At most 20 staging labels per secret.
- No charge for secrets marked for deletion; the AWS managed key `aws/secretsmanager` is free, customer managed keys are billed by KMS; rotation Lambda functions are billed at Lambda rates (managed rotation uses none).
- For current prices, see the pricing page; prices change.

**Example:**
```text
200 secrets, each read 50 times per second without caching:
  200 × 50 = 10,000 requests per second  → right at the Regional GetSecretValue limit
with a 5-minute cache in 20 app instances:
  200 secrets × 20 instances / 300 s ≈ 13 requests per second
```

**What happens, step by step:** without caching, a traffic spike drives read calls past the limit and you get `ThrottlingException`; with caching, reads become a trickle, cost drops by orders of magnitude, and rotation still takes effect within the cache lifetime.

**Common mistake → fix:** updating a secret's value every minute from a script to "store the latest token". It creates a version each time and can hit the version limit. Fix: store fast-changing data in a database or cache; use Secrets Manager for slow-changing credentials.

**Interview answer:** "A secret is up to 64 KB, with 100 versions, 500,000 secrets per Region, and GetSecretValue is allowed 10,000 requests per second. Cost is per secret per month plus per API call, plus KMS if I use my own key. So I cache reads, avoid frequent value updates, and use Parameter Store for plain configuration."

**Follow-ups:**
- *Whose quota applies for cross-account reads?* The caller's account.

---
## 3. Access control & encryption

### Q11. How is access to a secret controlled: identity policies vs resource policies?

**Short answer:** Access is decided by two kinds of policy. An **identity-based policy** is attached to a user or role and says which secrets that identity may use. A **resource-based policy** is attached to the **secret** and says which principals (including ones in other accounts) may use it. In the same account, either one allowing the action is enough (unless something denies it); across accounts, **both** must allow it. An explicit **Deny** anywhere always wins.

**How it works:**
- Typical same-account setup: put an identity policy on the application's role listing the secret's ARN. No resource policy needed.
- Use a resource policy to grant another account's role, to add guardrails (deny everyone outside your AWS Organization), or to restrict the secret to specific roles.
- `PutResourcePolicy` itself is powerful: whoever can change the resource policy can grant themselves access. Protect it.
- The `BlockPublicPolicy` option on `PutResourcePolicy` rejects policies that would make a secret public; IAM Access Analyzer can verify cross-account access.
- Secrets Manager also checks **KMS** permissions (see Q12).

**Example:**
```json
// Resource policy on the secret: only the payments role may read it, and only from inside our Organization
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow",
      "Principal": { "AWS": "arn:aws:iam::123456789012:role/payments-service" },
      "Action": "secretsmanager:GetSecretValue", "Resource": "*" },
    { "Effect": "Deny", "Principal": "*", "Action": "secretsmanager:*", "Resource": "*",
      "Condition": { "StringNotEquals": { "aws:PrincipalOrgID": "o-exampleorg1" } } }
  ]
}
```

**What happens, step by step:**
1. `payments-service` calls `GetSecretValue`. The resource policy allows it and the Organization condition passes → allowed (subject to KMS).
2. A role in an account outside the Organization calls the same secret: the explicit Deny matches, so the request is refused even if that role's own policy allows it.
3. A same-account admin role with `secretsmanager:GetSecretValue` on `*` can still read it only if no Deny applies to it; here the Deny only triggers outside the Organization, so the admin succeeds.

**Common mistake → fix:** assuming a resource policy alone grants access to a role in another account. The other account's role also needs an identity policy allowing the action. Fix: allow on both sides (and the KMS key policy; see Q14).

**Interview answer:** "Identity policies attach to roles and say what they can use; resource policies attach to the secret and can name principals from other accounts or add org-wide guardrails. Within one account either is sufficient, across accounts both must allow, and an explicit Deny wins. I keep PutResourcePolicy tightly restricted because it can grant access, and I validate public or cross-account exposure with BlockPublicPolicy and Access Analyzer."

**Follow-ups:**
- *Which API calls work cross-account?* A defined list including GetSecretValue, DescribeSecret and PutSecretValue; it isn't every operation.

---

### Q12. What permissions are needed to read a secret?

**Short answer:** The caller needs **`secretsmanager:GetSecretValue`** on the secret's ARN, **and** permission to use the secret's KMS key (**`kms:Decrypt`**) if it's encrypted with a customer managed key. If either is missing the read fails. `DescribeSecret` reads metadata only. Reading a group of secrets with `BatchGetSecretValue` also needs `ListSecrets`, with `GetSecretValue` allowed only for the specific secrets you permit.

**How it works:**
1. Secrets Manager checks IAM/resource policy for `GetSecretValue`.
2. It calls KMS `Decrypt` on the secret's encrypted data key, **on behalf of the caller**, so KMS checks the caller's permission through the key policy and IAM.
3. KMS returns the data key; Secrets Manager decrypts the value and returns it.
4. With the AWS managed key `aws/secretsmanager`, the key policy already lets any principal in the account that is allowed to use Secrets Manager do this, so you don't add `kms:Decrypt`. With a customer managed key, you must grant it.
5. Add `kms:ViaService = secretsmanager.<Region>.amazonaws.com` to limit the key to calls made through Secrets Manager.

**Example:**
```json
[
  { "Effect": "Allow", "Action": "secretsmanager:GetSecretValue",
    "Resource": "arn:aws:secretsmanager:eu-west-1:123456789012:secret:prod/payments/db-??????" },
  { "Effect": "Allow", "Action": "kms:Decrypt",
    "Resource": "arn:aws:kms:eu-west-1:123456789012:key/1111-2222",
    "Condition": { "StringEquals": { "kms:ViaService": "secretsmanager.eu-west-1.amazonaws.com" } } }
]
```

```flow
sequence: Reading a secret protected by a customer managed key
actors: App role, Secrets Manager, KMS
App role -> Secrets Manager: GetSecretValue(prod/payments/db)
Secrets Manager -> Secrets Manager: IAM check: does the role allow GetSecretValue on this ARN?
Secrets Manager -> KMS: Decrypt the secret's encrypted data key, with encryption context SecretARN
KMS -> KMS: key policy and IAM check: may this role use the key for kms:Decrypt?
KMS --> Secrets Manager: plaintext data key (256-bit AES)
Secrets Manager --> App role: secret value after decrypting with the data key
> Both permissions are needed. If KMS denies, the caller gets AccessDeniedException with "Access to KMS is not allowed".
```

**What happens, step by step:** a role that has the first statement but not the second gets `AccessDeniedException: Access to KMS is not allowed` on `GetSecretValue`, even though the secret's own permission passed. Adding the `kms:Decrypt` statement (or a key policy entry) fixes it.

**Common mistake → fix:** granting `secretsmanager:GetSecretValue` on `*` "so it just works". Fix: grant the exact secret ARN (using `-??????`) plus `kms:Decrypt` on the specific key.

**Interview answer:** "Reading a secret needs secretsmanager:GetSecretValue on the secret and, for a customer managed key, kms:Decrypt on the key, because Secrets Manager decrypts the data key through KMS on the caller's behalf. I scope both to exact ARNs, add the kms:ViaService condition, and give writers and rotators separate roles. A KMS denial shows up as 'Access to KMS is not allowed'."

**Follow-ups:**
- *Does the AWS managed key need an explicit permission?* No, its key policy already allows principals in the account through Secrets Manager.

---

### Q13. How are secrets encrypted, and when do you use your own KMS key?

**Short answer:** Secrets Manager uses **envelope encryption**: it asks **KMS** (Key Management Service) for a 256-bit **data key**, encrypts the secret value with that data key, then stores the data key **encrypted under your KMS key** alongside the secret. Reading reverses this through KMS, so every read is checked against the key policy as well. You can use the free AWS managed key `aws/secretsmanager`, or a **customer managed key** (required for cross-account access, and for custom key policies and separation of duties).

**How it works:**
- **Write:** `GenerateDataKey` → plaintext data key encrypts the value (outside KMS) → plaintext key is discarded → encrypted data key stored in the secret's metadata.
- **Read:** `Decrypt` the stored data key → decrypt the value → discard the key.
- **Encryption context:** each call includes `SecretARN` and `SecretVersionId`, which appear in CloudTrail and can be used in policy conditions.
- Only **symmetric** KMS keys are supported.
- The secret **name, description, rotation settings, KMS key ARN and tags are not encrypted**.
- **Changing the key** re-encrypts the `AWSCURRENT`, `AWSPREVIOUS` and `AWSPENDING` versions with the new key; older versions stay decryptable with the previous key, so make a new version if you need the old key to be unusable.

**Example:**
```bash
aws secretsmanager update-secret --secret-id prod/payments/db --kms-key-id alias/payments-secrets-v2
aws secretsmanager put-secret-value --secret-id prod/payments/db --secret-string file://db.json   # new version, new key only
```

**What happens, step by step:** after `update-secret`, versions `AWSCURRENT`/`AWSPREVIOUS`/`AWSPENDING` are re-encrypted under `payments-secrets-v2` but can still be decrypted by the old key. `put-secret-value` creates a fresh version encrypted only under the new key; once that becomes `AWSCURRENT`, readers need `kms:Decrypt` on the new key.

| Key | Cross-account | Custom key policy | Cost |
|---|---|---|---|
| `aws/secretsmanager` (AWS managed) | No | No (fixed policy) | Free |
| Customer managed key | Yes | Yes | KMS charges |

**Common mistake → fix:** trying to share a secret encrypted with `aws/secretsmanager` to another account. Its key policy can't be changed, so the other account can't decrypt. Fix: re-encrypt the secret with a customer managed key and allow the other account in the key policy.

**Interview answer:** "Secrets Manager uses envelope encryption: KMS generates a data key, the value is encrypted with it, and the data key is stored encrypted under the KMS key, so every read passes a KMS check. The AWS managed key is free but can't be shared cross-account; a customer managed key gives me key policy control, separation of duties between key admins and secret readers, and cross-account access. Metadata like names and tags is not encrypted."

**Follow-ups:**
- *Can I force teams to use a customer managed key?* Yes, with an IAM or SCP deny on `CreateSecret`/`UpdateSecret` when the key is the AWS managed one.

---

### Q14. How do you share a secret with another AWS account?

**Short answer:** Three things must all allow it: the **secret's resource policy** (names the other account's role), the **KMS key policy** (lets that role decrypt; the secret must use a **customer managed key**), and the **role's own identity policy** in the other account (using the secret's **full ARN**). If any one is missing, the call fails.

**How it works:**
1. In account A, attach a resource policy to the secret allowing account B's role `secretsmanager:GetSecretValue`.
2. In account A, add a key policy statement allowing that role `kms:Decrypt` and `kms:DescribeKey`.
3. In account B, attach an identity policy to the role allowing `GetSecretValue` on the full secret ARN and `kms:Decrypt` on the key.
4. Account B's code calls `GetSecretValue` with the **full ARN**.
5. Rate limits are charged to the **caller's** account (B).

**Example:**
```json
// A: resource policy on the secret
{ "Effect": "Allow", "Principal": { "AWS": "arn:aws:iam::222233334444:role/ApplicationRole" },
  "Action": "secretsmanager:GetSecretValue", "Resource": "*" }
// A: statement in the KMS key policy
{ "Effect": "Allow", "Principal": { "AWS": "arn:aws:iam::222233334444:role/ApplicationRole" },
  "Action": ["kms:Decrypt", "kms:DescribeKey"], "Resource": "*" }
// B: identity policy on ApplicationRole
{ "Effect": "Allow", "Action": ["secretsmanager:GetSecretValue", "kms:Decrypt"],
  "Resource": ["arn:aws:secretsmanager:eu-west-1:111122223333:secret:shared/partner-key-AbC123",
               "arn:aws:kms:eu-west-1:111122223333:key/1111-2222"] }
```

```flow
sequence: Cross-account read from account B of a secret in account A
actors: Role in B, Secret in A, KMS key in A
Role in B -> Secret in A: GetSecretValue with the full ARN
Secret in A -> Secret in A: resource policy allows the B role? And B's identity policy allows it?
Secret in A -> KMS key in A: Decrypt the data key on behalf of the B role
KMS key in A -> KMS key in A: key policy allows the B role to decrypt? (key must be customer managed)
KMS key in A --> Role in B: secret value returned
> Three checks must all pass: B's identity policy, A's secret resource policy, A's KMS key policy.
```

**What happens, step by step:** if only the resource policy and identity policy exist, step 3 fails with "Access to KMS is not allowed". If the secret uses `aws/secretsmanager`, step 3 can never pass, so you must change the secret's key first.

**Common mistake → fix:** calling with the secret's *name* from account B. Cross-account requests need the full ARN, otherwise Secrets Manager looks in B's own account and returns "not found". Fix: use the full ARN.

**Interview answer:** "Cross-account access needs three allowances: the secret's resource policy naming the other account's role, a customer managed KMS key whose key policy lets that role decrypt, and the role's own identity policy in the caller account using the secret's full ARN. The calling account bears the request quota. I use Access Analyzer and the Organization ID condition to keep sharing intentional."

**Follow-ups:**
- *Why not the AWS managed key?* Its key policy can't be edited, so no other account can be granted decrypt.

---

### Q15. Why is `secretsmanager:*` dangerous, and how do you separate duties?

**Short answer:** `secretsmanager:*` on `*` lets a principal **read every secret, change values, turn off rotation, delete secrets and rewrite resource policies** (granting outsiders access). Instead, split permissions into roles: **readers** (applications) get `GetSecretValue` on specific secrets; **writers/rotators** get `PutSecretValue` and `UpdateSecretVersionStage` on specific secrets; **administrators** manage metadata and policies, and *cannot* read values; key administrators on the KMS side are separate again.

**How it works:**
- The strongest separation: secret admins don't get `kms:Decrypt` on the key, so they can manage but not read.
- Deletion and policy changes (`DeleteSecret`, `PutResourcePolicy`) go to a small break-glass or platform role, with alarms.
- Preventive guardrails: an SCP that denies `DeleteSecret` with `ForceDeleteWithoutRecovery`, or denies secrets encrypted with the AWS managed key.

**Example:**

| Role | Allowed | Not allowed |
|---|---|---|
| `payments-service` | `GetSecretValue` on `prod/payments/db-??????`, `kms:Decrypt` | everything else |
| `payments-rotator` (rotation Lambda) | `GetSecretValue`, `PutSecretValue`, `DescribeSecret`, `UpdateSecretVersionStage` on that secret, `GetRandomPassword` | `DeleteSecret`, policy changes |
| `platform-admin` | `CreateSecret`, tag, policies on `prod/*` | `kms:Decrypt` (cannot read values) |

**What happens, step by step:** an attacker who steals `payments-service` credentials can read one secret and nothing else. If that role had `secretsmanager:*`, they could also read all other teams' secrets, change the payments password to lock the team out, and attach a resource policy giving their own account access.

**Common mistake → fix:** giving the CI pipeline role `secretsmanager:*` because "it creates secrets". A compromised pipeline then owns every secret. Fix: allow `CreateSecret` and `TagResource` only on the `prod/<app>/*` prefix and nothing for reading.

**Interview answer:** "Wildcard secretsmanager permissions let a principal read all secrets, alter values and policies and delete. I separate roles: applications can only get specific secrets, rotators can only write and relabel their own secret, and administrators can manage policies and metadata but not decrypt values because they lack the KMS permission. SCPs and alarms add guardrails around deletes and policy changes."

**Follow-ups:**
- *How do I stop admins from reading?* Don't give them `kms:Decrypt` on the key; they can still create and tag secrets.

---

### Q16. How do you restrict secret access by network or context?

**Short answer:** Combine **policy conditions** with a **private network path**. Conditions such as `aws:SourceVpce` (only via your VPC endpoint), `aws:SourceVpc`, `aws:PrincipalOrgID`, `aws:PrincipalTag/...` and `secretsmanager:ResourceTag/...` narrow when an allow applies. An **interface VPC endpoint** for Secrets Manager (with its own endpoint policy) lets private workloads reach the service without a NAT gateway or the internet.

**How it works:**
- A resource policy can **Deny** any request that does not come through your endpoint (`StringNotEquals aws:SourceVpce`).
- The endpoint policy limits *which* secrets and actions can be used through that endpoint, even by principals with broader IAM rights.
- Use a security group on the endpoint that allows 443 from your workloads.
- Rotation Lambda functions in a VPC need the same private path (or a NAT) to reach Secrets Manager.

**Example:**
```json
{ "Effect": "Deny", "Principal": "*", "Action": "secretsmanager:GetSecretValue", "Resource": "*",
  "Condition": { "StringNotEqualsIfExists": { "aws:SourceVpce": "vpce-0abc1234" } } }
```

**What happens, step by step:** a task in the private subnet calls `secretsmanager.eu-west-1.amazonaws.com`; private DNS resolves it to the endpoint, the request carries `aws:SourceVpce=vpce-0abc1234`, so the deny doesn't match and IAM allows it. If a developer's laptop with valid credentials calls the same secret from the internet, there's no `SourceVpce`, so the deny applies.

**Common mistake → fix:** adding the deny condition but forgetting the rotation function or a CI runner that legitimately runs outside the VPC. Rotation silently fails. Fix: test every legitimate caller (including rotation Lambdas and pipelines), or exempt specific roles in the condition.

**Interview answer:** "I use an interface VPC endpoint so private workloads reach Secrets Manager without NAT, an endpoint policy to limit what can be fetched through it, and resource-policy conditions such as aws:SourceVpce, aws:PrincipalOrgID and tag matches to deny anything outside the intended path. I make sure rotation functions and pipelines are covered by the same design."

**Follow-ups:**
- *Does this replace IAM?* No; conditions add to IAM, they don't replace least privilege.

---

## 4. Rotation

### Q17. What is automatic rotation, and why do it?

**Short answer:** **Rotation** means periodically replacing a secret's value, both in the vault **and** in the system that uses it (the database user's password, the API key at the vendor). It limits the damage of a leak: a stolen password stops working at the next rotation. Secrets Manager automates it with **managed rotation**, **Lambda rotation functions**, or **managed external secrets** for partner services.

**How it works:**
1. A schedule fires.
2. The rotation process creates a new value and stores it as `AWSPENDING`.
3. It sets that value in the target system and tests it.
4. It moves `AWSCURRENT` to the new version; the old version becomes `AWSPREVIOUS`.
5. Applications pick up the new value the next time they read (or refresh their cache).
6. If any step fails, `AWSCURRENT` stays on the old version, so applications keep working.

**Example:**
```bash
aws secretsmanager rotate-secret --secret-id prod/payments/db \
  --rotation-lambda-arn arn:aws:lambda:eu-west-1:123456789012:function:SecretsManagerRotatePostgres \
  --rotation-rules '{"ScheduleExpression":"rate(30 days)"}'
```

```flow
cycle: The rotation loop for prod/payments/db
Schedule fires: every 30 days in the rotation window > Secrets Manager invokes the rotation function.
createSecret stores a new random password as AWSPENDING > The live password is untouched.
setSecret changes the password for the database user > The database now accepts the new password.
testSecret logs in with the AWSPENDING password > If this fails, AWSCURRENT is not moved.
finishSecret moves AWSCURRENT to the new version > Apps read the new password at their next refresh.
exit > The loop repeats at the next schedule; a leaked password is useless after the rotation completes.
```

**What happens, step by step:** on day 30 the function generates `Pq9...`, runs the equivalent of `ALTER USER app_user WITH PASSWORD 'Pq9...'`, logs in with it successfully, then relabels. The password from day 0 becomes `AWSPREVIOUS`. By day 60 the day-0 password has been replaced twice and cannot be used.

**Common mistake → fix:** turning on rotation without checking that the application re-reads the secret. After the first rotation, running instances keep using the old password and fail. Fix: make clients cache briefly and refetch on authentication failure (Q22) before enabling rotation in production.

**Interview answer:** "Rotation periodically replaces a credential in both the vault and the target system, so a leaked value expires. Secrets Manager runs it on a schedule: create a pending version, set it in the target, test it, then move the current label, and if anything fails the current label stays put. It can be managed rotation for supported AWS services, a Lambda function for anything else, or managed external secrets for partners."

**Follow-ups:**
- *Does a manual `PutSecretValue` count as a rotation?* Yes; Secrets Manager treats a manual update as a valid rotation when it calculates the next rotation date.

---

### Q18. How are rotation schedules and windows set?

**Short answer:** You set a **schedule** as a `rate()` or `cron()` expression and an optional **window duration**. Secrets Manager rotates at some time inside the window. The shortest interval is **every four hours**, the longest is **999 days**, all in **UTC**. Windows start on the hour, can be as short as one hour, and must not extend into the next window.

**How it works:**
- `rate(30 days)`: window starts at midnight UTC and by default lasts until the end of the day. `rate(4 hours)`: window defaults to one hour.
- `cron(0 16 1,15 * ? *)`: 16:00 UTC on the 1st and 15th. The minutes field must be `0` and the year field `*`.
- If a rotation step fails, Secrets Manager retries the entire rotation several times while the window is open.
- If you also update the value manually, the next rotation date is recalculated from that time.

**Example:**
```bash
aws secretsmanager rotate-secret --secret-id prod/payments/db \
  --rotation-rules '{"ScheduleExpression":"cron(0 2 ? * SUN *)","Duration":"3h"}'
```

**What happens, step by step:** this rotates the secret during a three-hour window starting at 02:00 UTC every Sunday, which is a quiet time. If the first attempt at 02:10 fails because the database was in maintenance, Secrets Manager retries inside the window until 05:00 UTC. If it never succeeds, the secret keeps its old value and a failure is recorded.

**Common mistake → fix:** scheduling all secrets at midnight UTC (the default start for day-based rates). Every rotation function and database change runs at once. Fix: stagger start times using `cron()` and choose off-peak windows.

**Interview answer:** "Schedules are rate or cron expressions in UTC, from every four hours to 999 days, with a window of at least one hour that starts on the hour. Secrets Manager rotates at some point inside the window and retries failed attempts while it's open. I use cron to stagger secrets and choose quiet hours."

**Follow-ups:**
- *Can I trigger rotation on demand?* Yes, `rotate-secret` or the console's rotate immediately option.

---

### Q19. What kinds of rotation exist: managed, Lambda and external?

**Short answer:** Three. **Managed rotation**: the owning service (Amazon RDS, Aurora, DocumentDB, Redshift admin passwords, ECS Service Connect certificates) creates the secret and configures rotation for you, with **no Lambda function**. **Rotation by Lambda function**: Secrets Manager invokes a Lambda function that you control (AWS provides templates for RDS, Aurora, Redshift and DocumentDB; the generic template covers anything else). **Managed external secrets**: rotation of secrets held by Secrets Manager **partners**, also without Lambda.

**How it works:**

| Type | Who writes the code | When to use |
|---|---|---|
| Managed rotation | AWS service | Master user credentials of RDS, Aurora, DocumentDB, Redshift |
| Lambda rotation | You (or AWS templates) | Application database users, API keys, any custom system |
| Managed external secrets | Partner + AWS | Supported third-party SaaS secrets |

- Managed rotation typically completes within a minute; new connections that fetch the secret during rotation can briefly get the previous version.
- For application users, AWS recommends a least-privilege database user, not the master user.
- Lambda rotation costs Lambda time; managed rotation doesn't use a function.

**Example:**
```bash
# RDS creates and rotates the master secret itself
aws rds modify-db-instance --db-instance-identifier payments --manage-master-user-password
# App user: use the Lambda template
aws secretsmanager rotate-secret --secret-id prod/payments/app-user --rotation-lambda-arn <template-lambda-arn> \
  --rotation-rules '{"ScheduleExpression":"rate(30 days)"}'
```

**What happens, step by step:** RDS stores the master password in a secret it manages and rotates it on its own schedule with no function to maintain. The application user, which you created, rotates through the template Lambda, which connects with credentials from a master secret to set the new password.

**Common mistake → fix:** letting the application use the RDS master user because "its rotation is managed". The master user has full database rights. Fix: create a least-privilege application user and rotate it with the Lambda template (or alternating users).

**Interview answer:** "There are three kinds: managed rotation, where services like RDS, Aurora, DocumentDB and Redshift own and rotate their master credentials with no Lambda; Lambda rotation, where Secrets Manager calls a function I control, using AWS templates for databases or a generic template; and managed external secrets for partner-held secrets. Applications should still use least-privilege users, not the master user."

**Follow-ups:**
- *Who pays for the Lambda?* You, at Lambda rates; managed rotation has no function cost.

---

### Q20. What are the four steps of a rotation function?

**Short answer:** Secrets Manager invokes the same Lambda function four times with a `Step` value: **`create_secret`** (generate a new value and store it as `AWSPENDING`), **`set_secret`** (change the credential in the target system), **`test_secret`** (use the pending value to prove it works), **`finish_secret`** (move `AWSCURRENT` to the new version; the old becomes `AWSPREVIOUS`). Each step must be **idempotent**, because failed rotations are retried.

**How it works:**
- The event contains `Step`, `SecretId`, `ClientRequestToken` (the new version's ID, which gives idempotency) and, for cross-account or assumed-role rotation, `RotationToken`.
- Templates name the functions `createSecret`, `setSecret`, `testSecret`, `finishSecret`.
- Storing the new value as `AWSPENDING` first means a retry reuses the same pending value instead of generating another.
- **Security checks** in `set_secret`: verify the `AWSCURRENT` credential still works and that `AWSCURRENT` and `AWSPENDING` refer to the same resource (same host and username), to prevent a confused-deputy attack.
- Don't remove `AWSPENDING` yourself before `finish_secret`.
- The function can only rotate the secret directly; it can't call another Lambda to do it.
- Keep provisioned concurrency off, or at least 10, to avoid throttling.

**Example:**
```python
def lambda_handler(event, context):
    arn, token, step = event["SecretId"], event["ClientRequestToken"], event["Step"]
    sm = boto3.client("secretsmanager")
    versions = sm.describe_secret(SecretId=arn)["VersionIdsToStages"]
    if "AWSCURRENT" in versions.get(token, []):
        return                                   # already finished: idempotent
    if step == "create_secret":   create_secret(sm, arn, token)
    elif step == "set_secret":    set_secret(sm, arn, token)
    elif step == "test_secret":   test_secret(sm, arn, token)
    elif step == "finish_secret": finish_secret(sm, arn, token)
```

```flow
pipeline: The four steps of rotating a database password
createSecret: put_secret_value of a random password with label AWSPENDING > A retry finds the same pending value, so no second password is generated.
setSecret: ALTER USER app_user WITH PASSWORD (pending value) > Before this, check that AWSCURRENT works and both versions name the same host.
testSecret: log in with the pending password and run a read > The template tests with read access.
finishSecret: update_secret_version_stage moves AWSCURRENT to the pending version > AWSPREVIOUS is added to the old version; if any earlier step failed, AWSCURRENT never moved and apps keep working.
```

**What happens, step by step:** if `set_secret` succeeds but the Lambda times out before `test_secret`, the next attempt re-runs `create_secret` (finds the existing pending value), re-runs `set_secret` (setting the same password again is harmless) and carries on. Applications never saw the new password because `AWSCURRENT` didn't move.

**Common mistake → fix:** a custom rotation function that generates a new password in every invocation of `set_secret`. After a retry, the database holds one password and the vault another. Fix: generate once in `create_secret`, store as `AWSPENDING`, and have later steps read that stored value.

**Interview answer:** "A rotation function is invoked four times: create_secret generates a new value and stores it as AWSPENDING, set_secret changes it in the target system, test_secret logs in with it, and finish_secret moves AWSCURRENT. Each step is idempotent because rotations retry, the pending value is the shared state between steps, and AWSCURRENT only moves after the test passes, so a failure leaves applications on the old working credential."

**Follow-ups:**
- *What if the function crashes in finish_secret?* The next retry sees `AWSPENDING` already on the right version and completes the label move.

---

### Q21. What is the difference between single-user and alternating-users rotation?

**Short answer:** **Single-user** rotation changes the password of **one** database user. It is the simplest and is appropriate for most cases; open connections are not dropped, though there is a short window between the database change and the secret update when a new connection using the old value could be denied. **Alternating-users** rotation keeps **two users** (`app` and `app_clone`) and each rotation updates the **inactive** one, then switches `AWSCURRENT` to it, so the credential applications already hold stays valid during the switch.

**How it works:**
- Alternating needs a separate **superuser secret** (the clone must be created by a privileged user). The first rotation clones the user with the same permissions; later rotations alternate which user's password is updated.
- If you change the original user's permissions after cloning, change the clone's too.
- Use alternating for high-availability apps, or where one role owns the tables and another accesses them. AWS recommends single-user when the clone wouldn't have the same permissions as the original, and for ad hoc/interactive users.
- Even with alternating users, a replicated database might need a moment for password changes to propagate, so apps still need a retry strategy.

**Example:**
```text
Start:      secret = {username: app,       password: P1}        (AWSCURRENT)
Rotation 1: create app_clone with P2; secret = {username: app_clone, password: P2} (AWSCURRENT), P1 version = AWSPREVIOUS
Rotation 2: update app's password to P3; secret = {username: app, password: P3} (AWSCURRENT), app_clone/P2 = AWSPREVIOUS
Rotation 3: update app_clone's password to P4 ...
```

```flow
trace: Alternating users, three rotations
before: secret holds app / **P1**, AWSCURRENT > Applications connect as app with P1.
rotation 1: app_clone is created with P2 and AWSCURRENT moves to app_clone / **P2** > The app/P1 credential still works for connections that already use it.
rotation 2: app's password changes to P3, AWSCURRENT is app / **P3** > The app_clone/P2 credential is the previous one and still valid.
rotation 3: app_clone's password changes to P4 > There is always one valid credential that clients currently hold.
```

**What happens, step by step:** during rotation 2, an application that read `app_clone / P2` a minute ago keeps working because `app_clone`'s password isn't touched; only `app` is being changed. In single-user rotation the one account's password changes in the middle, so a client reading at that moment may briefly be denied, which a retry fixes.

**Common mistake → fix:** choosing alternating users and then forgetting that the clone has the old permissions only at creation. Later grants to `app` aren't copied. Fix: manage grants for both users (for example through a role both inherit).

**Interview answer:** "Single-user rotation changes one user's password: simplest, existing connections stay open, with a small window where a fresh connection might be denied, which a retry covers. Alternating users maintains two users and updates the inactive one before switching AWSCURRENT, so clients holding the previous credential keep working. It needs a superuser secret and I have to keep the clone's permissions in sync."

**Follow-ups:**
- *Which should I start with?* Single-user plus a retry on authentication failure; move to alternating for strict availability.

---

### Q22. How should an application cope with rotation?

**Short answer:** **Cache** the secret with a **short time to live** (minutes), and when authentication fails, **fetch the secret again once** and retry. Don't call Secrets Manager on every request (cost, latency, throttling) and don't cache forever (it breaks at the first rotation). Make connection pools able to reconnect with the new credentials.

**How it works:**
- Caching options: the AWS caching clients (the Python client refreshes hourly by default and uses LRU eviction), the Lambda extension (default 300 s), or Powertools.
- Refresh-on-failure turns a rotation from an outage into a single retried request.
- Existing database connections usually stay open after a password change; only new connections need the new credential, so refresh when creating a connection.
- Keep the TTL shorter than the interval during which the previous credential remains valid.

**Example:**
```python
def get_connection():
    for attempt in (1, 2):
        creds = cache.get_secret_string("prod/payments/db", refresh=(attempt == 2))
        try:
            return connect(**json.loads(creds))
        except AuthenticationError:
            if attempt == 2:
                raise            # the secret really is wrong
```

```flow
sequence: A service surviving a rotation
actors: Service, Cache, Secrets Manager, Database
Service -> Cache: get prod/payments/db (cached 5 minutes ago, password P1)
Cache --> Service: P1 from cache
Service -> Database: connect with P1
Database --> Service: authentication failed, because the password was rotated to P2
Service -> Secrets Manager: refresh now, via the cache bypassing its TTL
Secrets Manager --> Service: AWSCURRENT with P2
Service -> Database: reconnect with P2
Database --> Service: connected, and the request succeeds with one extra round trip
> One failed login and one refresh turn a rotation into a short delay, not an outage.
```

**What happens, step by step:** the rotation finishes at 02:00:30; at 02:01 the service tries its cached P1, is rejected, refreshes (one `GetSecretValue`), and connects with P2. Other service instances do the same independently. Without refresh-on-failure, every instance would keep failing until its cache expired or it was restarted.

**Common mistake → fix:** caching the password in a module-level constant at start-up, so it never changes. Fix: use a cache with a TTL and a refresh path on authentication errors.

**Interview answer:** "I cache secrets in memory with a short TTL, and on an authentication failure I refetch AWSCURRENT once and retry. I don't read per request, which costs money and risks throttling, and I don't cache forever. With alternating-users rotation, the previous credential stays valid, which gives even more room."

**Follow-ups:**
- *What TTL?* A few minutes; the Lambda extension defaults to 5 minutes and the Python client to an hour, which you may want to shorten for frequent rotation.

---

### Q23. How do you rotate different kinds of secrets (database, OAuth, API key)?

**Short answer:** It depends on whether you control **both sides**. A **database password**: yes, you control the database, so full automatic rotation works. An **OAuth client secret**: rotate it at the identity provider (many allow two active secrets), then update the vault. **OAuth access tokens**: short-lived and refreshed with a refresh token, not rotated by Secrets Manager. A **third-party API key**: only automatic if the vendor offers an API to create and revoke keys; otherwise a documented overlap procedure.

**How it works:**

| Secret | Rotation approach |
|---|---|
| Database password | Managed rotation or Lambda template; set, test, swap labels |
| OAuth client secret | Create a second secret at the IdP, update the vault, deploy/refresh, revoke the old one |
| OAuth access token | Not rotated; obtain with refresh token (kept in a token vault), expires in minutes |
| Vendor API key | Create new key via vendor API, test, swap, revoke old; if no API, runbook with overlap |

- Always have an **overlap period** where old and new both work, then revoke the old.
- A custom Lambda can call the vendor API in the four steps (create key in `set_secret`, test call in `test_secret`, revoke old in a later cycle).

**Example — vendor API key with an overlap:**
1. `create_secret`: store a placeholder as `AWSPENDING`.
2. `set_secret`: call the vendor to create a new key; save it into `AWSPENDING`.
3. `test_secret`: make a test call with the new key.
4. `finish_secret`: move `AWSCURRENT`.
5. Next cycle: revoke the key held in `AWSPREVIOUS` (never in the same run, so in-flight clients keep working).

**What happens, step by step:** clients refresh within their cache TTL (say 5 minutes) and move to the new key; the old key is revoked at the next rotation, long after every client has refreshed. If the vendor has no API, the runbook performs the same steps manually with a calendar reminder.

**Common mistake → fix:** revoking the old vendor key in the same rotation run that creates the new one. Clients with a cached copy start failing immediately. Fix: revoke the previous key in a later cycle, after the cache TTL has passed.

**Interview answer:** "Database passwords I fully automate because I control both sides. OAuth client secrets are rotated at the identity provider, ideally with two active secrets for overlap, then updated in the vault. Access tokens are short-lived and refreshed rather than rotated. For vendor API keys I automate if there's an API and otherwise use a runbook; in every case I keep an overlap and revoke the old credential only after clients have refreshed."

**Follow-ups:**
- *Where should refresh tokens live?* In a token vault or encrypted store keyed by user, not in plain secrets read by the model or the browser.

---
## 5. Consuming secrets: SDK, ECS, Lambda, VPC, Terraform

### Q24. What are the ways to retrieve a secret, and why cache?

**Short answer:** You can call **`GetSecretValue`** (or **`BatchGetSecretValue`** for several secrets at once) through any AWS SDK or the CLI, use an **AWS caching client** (Java, Python, .NET, Go and others) that wraps the SDK with an in-memory cache, or use a platform integration: ECS and EKS injection, the Lambda **Parameters and Secrets extension**, CloudFormation dynamic references, CI integrations. AWS recommends **client-side caching** because it improves speed and reduces cost.

**How it works:**
- `BatchGetSecretValue` takes a list of secret IDs (or filters) and returns their values; the caller still needs `GetSecretValue` on each secret, plus `ListSecrets`/`BatchGetSecretValue`. Secrets the caller isn't allowed to read are not returned.
- The Python caching client (`pip install aws-secretsmanager-caching`) uses least-recently-used eviction and refreshes secrets every hour by default; it needs `GetSecretValue` and `DescribeSecret`. It does not invalidate on rotation, so lower the refresh interval if you rotate often.
- Read `AWSCURRENT` by default; ask for a specific stage or version only on purpose.

**Example:**
```python
import botocore.session
from aws_secretsmanager_caching import SecretCache, SecretCacheConfig

client = botocore.session.get_session().create_client("secretsmanager")
cache = SecretCache(config=SecretCacheConfig(secret_refresh_interval=300), client=client)  # refresh every 5 min

def db_password():
    return json.loads(cache.get_secret_string("prod/payments/db"))["password"]
```

**What happens, step by step:**
1. First call: the cache has nothing, so it calls `DescribeSecret`/`GetSecretValue` once and stores the value with a 5-minute refresh time.
2. The next 10,000 calls in those 5 minutes return the cached string from memory in microseconds, with no network call and no API charge.
3. After 5 minutes the next call refreshes the value, picking up a rotated password.

**Common mistake → fix:** creating a new `SecretCache` per request. Each has an empty cache, so every request calls the API. Fix: create one cache at start-up and reuse it.

**Interview answer:** "I fetch secrets with the SDK's GetSecretValue, or BatchGetSecretValue for several, usually through a caching client or a platform integration like ECS injection or the Lambda extension. Caching in memory with a short refresh interval cuts latency, API cost and throttling, while still picking up rotated values. I read AWSCURRENT and create one cache per process."

**Follow-ups:**
- *Does the cache notice rotation immediately?* No; it refreshes on its interval, which is why I also refetch on authentication failure.

---

### Q25. How does ECS inject secrets, and what happens when a secret rotates?

**Short answer:** In a task definition you map an environment variable to a secret with `valueFrom`. ECS reads the secret **once, when the container starts**, using the task's **execution role**, and passes it in as an environment variable. After rotation, **running containers keep the old value**; to get the new one you must start a new task (for a service, force a new deployment) or have the application fetch the secret itself at run time.

**How it works:**
- `valueFrom` format: `arn:aws:secretsmanager:<region>:<account>:secret:<name>:<json-key>:<version-stage>:<version-id>`. Missing parts are left empty but the colons stay. No stage means `AWSCURRENT`.
- `...:password::` selects the `password` key from a JSON secret.
- Needs a task **execution role** with `secretsmanager:GetSecretValue` (and `kms:Decrypt` for a customer managed key), and network access to Secrets Manager (a NAT gateway or an interface VPC endpoint).
- Fargate platform version 1.3.0+ for whole secrets, 1.4.0+ (Linux) for a specific JSON key or version.
- Anything with access to the container's environment can read it (logs, debug tools).

**Example:**
```json
"secrets": [
  { "name": "DB_PASSWORD",
    "valueFrom": "arn:aws:secretsmanager:eu-west-1:123456789012:secret:prod/payments/db-AbC123:password::" }
]
```

```flow
trace: An injected secret across one rotation
task starts at 09:00: DB_PASSWORD = **P1** > ECS read AWSCURRENT once with the execution role.
rotation at 10:00 changes the secret to **P2** with single-user rotation > The database now rejects P1 for new connections.
new connections from the running task fail with P1 > Env vars never change inside a running container.
fix: force a new deployment (or fetch at runtime) > New tasks read AWSCURRENT = P2 at start.
```

**What happens, step by step:** at 10:05 the task opens a new database connection with `P1` and gets "password authentication failed". Until you replace the task (`aws ecs update-service --force-new-deployment`), it keeps failing, while a newly started task works because ECS reads `P2` at its start. With alternating-users rotation, `P1` stays valid for a while, which hides the problem until the next rotation.

**Common mistake → fix:** turning on rotation for a secret injected as an environment variable and assuming containers pick it up. Fix: choose one: (1) fetch the secret in code with a TTL cache, (2) trigger a rolling redeploy after each rotation (EventBridge rule on the rotation event invoking a function that calls `UpdateService`), or (3) use alternating users plus redeploy within the validity window.

**Interview answer:** "ECS resolves `valueFrom` once at task start using the execution role and injects an environment variable, so running tasks keep the old value after rotation. I either fetch the secret at run time with a cache, force a new deployment after rotation, or use alternating users so the old credential stays valid. The execution role needs GetSecretValue and, for a customer managed key, Decrypt, and the task needs a network path to Secrets Manager."

**Follow-ups:**
- *Execution role or task role?* Injection uses the execution role; SDK calls from your code use the task role.

---

### Q26. How should a Lambda function use secrets?

**Short answer:** Fetch the secret **once per execution environment** (at init or on first use) and **cache** it, rather than on every invocation. Two supported approaches: the **AWS Parameters and Secrets Lambda extension** (a layer that serves secrets over `localhost:2773` and caches them, default 300 seconds and up to 1,000 secrets), or the **Powertools parameters utility** (in-code cache, supports Secrets Manager, Parameter Store and AppConfig). Grant `secretsmanager:GetSecretValue` on the specific secret, and in a VPC add a Secrets Manager VPC endpoint.

**How it works:**
- Extension request: `GET http://localhost:2773/secretsmanager/get?secretId=<name>` with header `X-Aws-Parameters-Secrets-Token` set to the function's session token (resolve it inside the handler so it stays fresh after a restore).
- Tune with `SECRETS_MANAGER_TTL` (0–300 s), `PARAMETERS_SECRETS_EXTENSION_CACHE_SIZE`, `PARAMETERS_SECRETS_EXTENSION_HTTP_PORT`; request `?versionStage=AWSCURRENT` for a specific stage.
- Powertools' default TTL is only a few seconds unless you set `max_age`, so set it explicitly.
- The execution environment, init phase and warm reuse that make this work are covered in the Lambda course (execution environment lifecycle).

**Example:**
```python
from aws_lambda_powertools.utilities import parameters

def lambda_handler(event, context):
    db = parameters.get_secret("prod/payments/db", transform="json", max_age=300)
    return query(db["host"], db["username"], db["password"], event["sql"])
```

**What happens, step by step:** the first invocation in a new environment calls Secrets Manager (tens of milliseconds); the next hundreds of invocations within 5 minutes read from memory. At 5 minutes the next call refreshes, picking up a rotated password. Without caching, 200 invocations per second would make 200 API calls per second.

**Common mistake → fix:** putting the secret in a plain Lambda environment variable "for speed". It's visible to anyone with function-read access and never rotates. Fix: fetch with the extension or Powertools and cache.

**Interview answer:** "In Lambda I fetch secrets once per environment and cache them, using either the Parameters and Secrets extension, which caches for 5 minutes by default and serves over localhost, or the Powertools parameters utility with an explicit max age. The role gets GetSecretValue on that one secret, a VPC function needs a Secrets Manager endpoint, and I refresh on authentication failures so rotation is seamless."

**Follow-ups:**
- *Extension or Powertools?* The extension is runtime-agnostic and needs no code dependency; Powertools adds multi-provider support and transforms in Python, TypeScript, Java and .NET.

---

### Q27. How do private workloads reach Secrets Manager, and what breaks when they can't?

**Short answer:** Secrets Manager is a public regional API endpoint. A workload in a **private subnet** reaches it through a **NAT gateway** or, better, an **interface VPC endpoint** (AWS PrivateLink) created for `secretsmanager`. If neither exists, calls **hang until timeout**: ECS tasks fail to start with `ResourceInitializationError: unable to pull secrets`, Lambda functions time out, and rotation functions stall after logging "Found credentials in environment variables".

**How it works:**
- Create the interface endpoint in the VPC subnets, enable private DNS, and attach a security group allowing inbound 443 from the workloads.
- Add an endpoint policy to limit actions and secrets.
- Rotation Lambda functions in a VPC need both the Secrets Manager endpoint **and** network access to the database.
- Network ACLs must allow HTTPS in and out.
- If the superuser secret is managed by another service (RDS, Redshift), the rotation function may also need that service's API endpoint.

**Example:**
```bash
aws ec2 create-vpc-endpoint --vpc-id vpc-0abc --vpc-endpoint-type Interface \
  --service-name com.amazonaws.eu-west-1.secretsmanager \
  --subnet-ids subnet-a subnet-b --security-group-ids sg-endpoint --private-dns-enabled
```

**What happens, step by step:** with private DNS on, `secretsmanager.eu-west-1.amazonaws.com` resolves to the endpoint's private IPs, so the SDK needs no code change. Without the endpoint or NAT, the connection attempt never completes: an ECS service sits in a restart loop with the pull-secrets error, and a Lambda reports `Task timed out after 30.00 seconds` with no application error.

**Common mistake → fix:** creating the endpoint but forgetting the security group rule for 443 (or a restrictive endpoint policy). The calls still time out or are denied. Fix: allow 443 from the workload's security group and review the endpoint policy.

**Interview answer:** "Private workloads need a path to the Secrets Manager endpoint: an interface VPC endpoint with private DNS, a security group allowing 443 and a sensible endpoint policy, or a NAT gateway. The symptom of a missing path is a hang until timeout: ECS fails with unable to pull secrets, Lambda times out, and rotation logs stop after the credentials message."

**Follow-ups:**
- *Does the rotation function need other endpoints?* Possibly the database's API endpoint when the superuser secret is managed by RDS or Redshift.

---

### Q28. How do you keep secrets out of logs?

**Short answer:** Treat everything that gets logged as public inside the company. **Don't log** configuration objects, connection strings, request headers or exception messages that may contain credentials; **redact** known fields in a logging filter; avoid `set -x` in CI; never return secrets in API errors; mark Terraform variables `sensitive`; and **scan** logs and repositories for secrets. If a secret does leak, **rotate it immediately**.

**How it works:**
- Allow-list the fields you log instead of dumping whole objects.
- A logging filter masks patterns like `password=...`, `Authorization: ...`.
- Lambda rotation functions can write to CloudWatch Logs, so keep debug statements free of secret values.
- Step Functions stores every state's input and output in the execution history; pass references instead of secret values (see the Step Functions course on keeping secrets out of history).
- Use secret scanners on logs, pull requests and artifact stores.

**Example:**
```python
import logging, re

class RedactFilter(logging.Filter):
    PATTERN = re.compile(r"(password|secret|token|authorization)(=|:)\s*([^\s&,]+)", re.I)
    def filter(self, record):
        record.msg = self.PATTERN.sub(r"\1\2 ***", str(record.msg))
        return True

logging.getLogger().addFilter(RedactFilter())
logging.error("db connect failed: host=db password=Hunter2 user=app")
# logged as: db connect failed: host=db password ***  user=app
```

**What happens, step by step:** the error line contains the password because a library put the connection string in the exception text. The filter rewrites the message before the handler formats it, so CloudWatch stores `password ***`. A scanner that finds an unredacted token in an old log group triggers rotation of that credential.

**Common mistake → fix:** `logger.info(f"config = {config}")` at start-up "for debugging". It writes the password to logs retained for months. Fix: log only non-sensitive keys, e.g. `config.keys()`.

**Interview answer:** "I allow-list what I log, redact credential patterns in a logging filter, avoid shell tracing in CI, never echo secrets in error responses, mark IaC variables sensitive, and run secret scanning on logs and repos. If something leaks I rotate it immediately, because deleting log lines doesn't undo exposure."

**Follow-ups:**
- *Where else do secrets leak?* Environment variables in crash dumps, execution histories, build logs, container images and Terraform state.

---

### Q29. How do you handle secrets in Terraform and other infrastructure-as-code?

**Short answer:** If Terraform sets a secret's value, the value is written to the **state file** in plain text. So let Terraform manage the **container** (the secret resource, its policy, rotation configuration and tags) and set the **value** out of band, via rotation, or via a **write-only argument** where your provider version supports it. For RDS and Aurora, let AWS manage the master password (`manage_master_user_password = true`). Protect the state anyway: encrypted bucket, restricted access.

**How it works:**
- Resource `aws_secretsmanager_secret` (container) and `aws_secretsmanager_secret_version` (value). The value in the version resource ends up in state.
- Newer Terraform and provider versions offer ephemeral resources and write-only arguments (for example `secret_string_wo`) that avoid persisting the value; check your provider version.
- Lifecycle `ignore_changes` on the value stops Terraform from overwriting a rotated value on every apply.
- Never expose secret values through Terraform outputs; applications read at run time.

**Example:**
```hcl
resource "aws_secretsmanager_secret" "db" {
  name       = "prod/payments/db"
  kms_key_id = aws_kms_key.secrets.arn
}

resource "aws_secretsmanager_secret_rotation" "db" {
  secret_id           = aws_secretsmanager_secret.db.id
  rotation_lambda_arn = aws_lambda_function.rotator.arn
  rotation_rules { automatically_after_days = 30 }
}

resource "aws_db_instance" "payments" {
  manage_master_user_password = true       # AWS creates and rotates the master secret
}
```

**What happens, step by step:** `terraform apply` creates the empty secret and the rotation schedule; the first rotation (or an operator's `put-secret-value`) writes the real value, so it never appears in state or in the repository. For the database, RDS creates the master secret itself and Terraform only sees its ARN.

**Common mistake → fix:** `secret_string = var.db_password` with the password in a `.tfvars` committed to git. It's in the repo and in state. Fix: set the value outside Terraform or via a write-only argument, keep tfvars out of git, and encrypt and restrict the state backend.

**Interview answer:** "Terraform state stores any value it manages in plain text, so I let Terraform create the secret, policy and rotation settings, and populate the value through rotation, an operator, or write-only arguments. For RDS I use managed master passwords. I never output secret values, I ignore changes to the value after rotation, and I protect state with encryption and tight access."

**Follow-ups:**
- *What about CloudFormation?* Use dynamic references like `{{resolve:secretsmanager:...}}` so values aren't stored in the template, and managed rotation resources for rotation.

---

### Q30. How do you audit and monitor secret access?

**Short answer:** CloudTrail records every Secrets Manager API call (`GetSecretValue`, `PutSecretValue`, `RotateSecret`, `DeleteSecret`, policy changes) with the caller's identity, and KMS records the matching `Decrypt` calls with the secret ARN in the encryption context. Build **alarms** for deletion, policy changes, access by unexpected principals and rotation failures, use **AWS Config** rules to check rotation is enabled and find unused secrets, and review access regularly.

**How it works:**
- EventBridge rules on CloudTrail events trigger notifications (for example `DeleteSecret`, `PutResourcePolicy`, `RotationFailed`).
- CloudWatch alarm for access attempts to secrets **scheduled for deletion**.
- AWS Config managed rules such as `secretsmanager-rotation-enabled-check` and `secretsmanager-secret-unused`; Security Hub controls flag secrets without rotation.
- KMS CloudTrail events with `SecretARN` and `SecretVersionId` let you tie a key use to a specific secret and version; validation calls use the version ID `RequestToValidateKeyAccess`.
- Regularly remove access nobody uses (IAM Access Analyzer and last-accessed data).

**Example (EventBridge pattern):**
```json
{
  "source": ["aws.secretsmanager"],
  "detail-type": ["AWS API Call via CloudTrail"],
  "detail": { "eventName": ["DeleteSecret", "PutResourcePolicy", "RestoreSecret"] }
}
```

**What happens, step by step:** someone calls `PutResourcePolicy` adding an outside account to `prod/payments/db`. CloudTrail records the call; the rule matches within minutes and posts to the security topic with the caller's ARN and the secret name. The on-call reverts the policy and checks `GetSecretValue` events from the new principal during the exposure window, then rotates the secret.

**Common mistake → fix:** enabling CloudTrail but never alerting on anything, so a policy change is noticed weeks later. Fix: alarms on destructive and permission-changing events and on rotation failures, reviewed with an owner.

**Interview answer:** "CloudTrail logs every Secrets Manager call with the caller identity, and KMS logs the decrypts with the secret ARN in the encryption context. I alarm on deletes, resource policy changes, unexpected principals and rotation failures via EventBridge, use Config rules for rotation and unused secrets, and prune unused access. After any suspected exposure I rotate."

**Follow-ups:**
- *How do I know a secret is unused?* The Config `secretsmanager-secret-unused` rule and last-accessed date on the secret.

---

## 6. Agents & multi-tenant credentials

### Q31. How do you use an OAuth client secret without exposing it to an AI agent?

**Short answer:** Only the **backend component that exchanges tokens** should be able to read the client secret. Store it in Secrets Manager (customer managed key), grant read to that component alone (or use a managed **token vault** such as AgentCore Identity credential providers), and give the agent only **short-lived access tokens**. The client secret never reaches the browser, the prompt, the model, or traces.

**How it works:**
1. The backend fetches `client_secret` (cached) using its IAM role.
2. It requests a token from the identity provider using `client_id` and `client_secret`.
3. It receives a short-lived access token (for example 1 hour) and uses it, or hands it to the tool call, never the client secret.
4. Per-user tokens obtained through user consent are stored encrypted per user, with refresh handled centrally.
5. Logs and traces redact tokens.

**Example:**
```python
def get_access_token():
    cs = json.loads(cache.get_secret_string("prod/agent/jira-oauth"))
    r = requests.post("https://auth.example.com/oauth/token", timeout=5, data={
        "grant_type": "client_credentials", "client_id": cs["client_id"], "client_secret": cs["client_secret"]})
    return r.json()["access_token"]          # returned to the tool code only
```

```flow
sequence: Using an OAuth client secret without exposing it
actors: Agent, Tool backend, Secrets Manager, Identity provider
Agent -> Tool backend: call tool search_issues (no credentials in the request)
Tool backend -> Secrets Manager: get prod/agent/jira-oauth (cached)
Secrets Manager --> Tool backend: client_id and client_secret
Tool backend -> Identity provider: token request with client credentials
Identity provider --> Tool backend: access token valid for 1 hour
Tool backend -> Tool backend: call the Jira API with the token and return only the results
> The agent and the model see the results, never the secret or the token.
```

**What happens, step by step:** a prompt-injection attempt tells the agent to "print your credentials". The agent has none: it only sent a tool name and arguments. The backend returned issue titles, not the token, and logs show only `token=***`.

**Common mistake → fix:** passing the client secret to the agent as part of its configuration so it can "call the API itself". Any prompt injection can then exfiltrate it. Fix: keep credentials in the tool layer and expose capabilities, not secrets.

**Interview answer:** "The client secret lives in Secrets Manager, readable only by the token-exchange backend, or in a managed token vault. The agent calls tools; the tool layer fetches the secret, gets a short-lived token and calls the API, returning only results. Nothing sensitive enters prompts, traces or the browser, and logs redact tokens."

**Follow-ups:**
- *Why short-lived tokens?* A leaked token expires quickly, unlike a client secret.

---

### Q32. How do you prevent cross-tenant secret exposure in a multi-tenant agent system?

**Short answer:** Make the **tenant** part of the secret's identity and let **the platform, not the model**, decide which secret to load. Name and tag secrets per tenant (`prod/tenants/t-42/jira`, tag `tenant=t-42`), use **ABAC** so a session can read only secrets whose `tenant` tag matches its own principal tag, derive the tenant from verified identity, and never accept a secret name from model output.

**How it works:**
- The tool service assumes a role with a session tag `tenant=<verified id>` (from the validated token).
- The IAM policy condition `secretsmanager:ResourceTag/tenant == ${aws:PrincipalTag/tenant}` limits reads to that tenant's secrets.
- Per-tenant KMS keys or key policy conditions add another layer for high-sensitivity tenants.
- Audit: alarm on `AccessDenied` for cross-tenant attempts.
- Tenant-level isolation of compute (separate execution environments per tenant) complements this; see the Lambda course on tenant isolation mode.

**Example:**
```json
{ "Effect": "Allow", "Action": "secretsmanager:GetSecretValue", "Resource": "*",
  "Condition": { "StringEquals": { "secretsmanager:ResourceTag/tenant": "${aws:PrincipalTag/tenant}" } } }
```

**What happens, step by step:** a request from tenant `t-42` arrives with a valid token; the service assumes the role with `tenant=t-42` and the code asks for `prod/tenants/t-42/jira` (built from the verified tenant, not from model output) → allowed. A manipulated prompt makes the model suggest `t-77`; the code ignores it, and even if it tried, the tag condition returns AccessDenied.

**Common mistake → fix:** a tool that takes `secret_name` as an argument chosen by the model. Prompt injection can request any secret the shared role can read. Fix: the tool computes the name from the trusted tenant ID and the role can only read that tenant's tag.

**Interview answer:** "I give each tenant its own secrets named and tagged by tenant, assume a role with a tenant session tag taken from the verified identity, and use an ABAC condition so reads only succeed when the secret's tenant tag matches. The model never picks a secret; tool code derives it from trusted context, and cross-tenant AccessDenied events raise alarms."

**Follow-ups:**
- *When use per-tenant KMS keys?* For regulated tenants who need key-level revocation or separate audit trails.

---

### Q33. Design: an agent calling Jira and Confluence securely

**Short answer:** Make calls **as the end user** with that user's own OAuth tokens, held in a **token vault**, and have a **gateway** attach the token on outbound calls so the agent never holds it. Jira then enforces the user's real permissions. Use a **service account** only for narrowly scoped, read-only, organisation-wide content, stored in Secrets Manager and rotated.

**How it works:**
1. The user authenticates (a signed JWT); the API passes that identity to the agent runtime.
2. The agent calls a tool through the gateway.
3. The gateway asks the token vault for **this user's** Jira token (obtained once through user consent, 3-legged OAuth, and refreshed centrally).
4. The gateway calls Jira with that token.
5. Secrets Manager holds only the long-lived pieces: OAuth client secret(s) for the vault/gateway and any fallback service account credential.

**Example (decisions):**

| Concern | Choice |
|---|---|
| Whose permissions? | The user's, through per-user OAuth tokens |
| Where do tokens live? | Token vault; encrypted; never in prompts, logs or traces |
| Where is the client secret? | Secrets Manager (customer managed key), read only by the vault/gateway role |
| Fallback | Read-only service account, rotated, scoped to specific spaces |
| Audit | CloudTrail for secret reads; gateway logs for tool calls with user ID |

```flow
sequence: Agent calling Jira as the user
actors: User, API, Agent, Gateway, Token vault, Jira
User -> API: request with a signed identity token
API -> Agent: invoke with the verified user context
Agent -> Gateway: tool call search_issues(query)
Gateway -> Token vault: get the Jira token for THIS user
Token vault --> Gateway: user's short-lived access token (refreshed if needed)
Gateway -> Jira: API call with the user's token
Jira --> Agent: only issues that this user may see
> Jira enforces the user's own permissions; the model never sees the token.
```

**What happens, step by step:** Asha asks for "open payment bugs". The gateway fetches Asha's token and Jira returns only projects Asha can see. If Ben asks the same, he gets his own view. If Asha leaves the company, revoking her access at the identity provider ends it immediately; no shared credential has to be rotated.

**Common mistake → fix:** one powerful service account for everyone. The agent can then show users data they shouldn't see, and a prompt injection reaches everything. Fix: per-user tokens; the service account only for read-only org-wide content.

**Interview answer:** "I'd call Jira and Confluence as the user: the user consents once, the user's OAuth token sits in a token vault, and the gateway attaches it on outbound calls, so the target system enforces that user's permissions and the model never sees a credential. Secrets Manager holds the OAuth client secrets and any fallback service account, encrypted with a customer managed key, read only by the vault or gateway role, and rotated. Everything is audited."

**Follow-ups:**
- *What if the user hasn't consented yet?* The gateway returns a consent URL and the agent asks the user to complete it.

---

## 7. Scenario & debugging questions

### Q34. An ECS app gets AccessDenied reading a secret. How do you debug it?

**Short answer:** First decide **which identity** is reading. Injected `secrets` are read at task start by the **execution role**; SDK calls in your code use the **task role**. Then check, in order: the IAM allow on the exact secret ARN, KMS decrypt permission, resource policy or SCP denies, VPC endpoint policy, and the Region. CloudTrail shows the denied call and the principal.

**Debugging steps:**
1. **Read the error.** Check: `ResourceInitializationError: unable to pull secrets` at task start = execution role or network path; `AccessDeniedException` inside the app = task role. Meaning: tells you which role to fix.
2. **Check the ARN in the policy.** Check: it has the six-character suffix or `-??????`, and the right Region/account. Meaning: a name-only or wrong-suffix resource silently doesn't match.
3. **Check KMS.** Check: for a customer managed key, the role has `kms:Decrypt` (identity policy or key policy). Meaning: "Access to KMS is not allowed" points here.
4. **Look for denies.** Check: the secret's resource policy, an SCP, a permissions boundary, the VPC endpoint policy, `aws:SourceVpce` conditions. Meaning: an explicit deny overrides any allow.
5. **Check the network.** Check: NAT or interface endpoint, security group 443. Meaning: timeouts look like errors at start.
6. **Confirm in CloudTrail.** Check: the event's `errorCode`, `userIdentity` and `errorMessage`.

**Example:**
```text
ECS event: ResourceInitializationError: unable to pull secrets or registry auth ...
  AccessDeniedException ... is not authorized to perform: secretsmanager:GetSecretValue
  on resource: arn:aws:secretsmanager:eu-west-1:123456789012:secret:prod/payments/db-AbC123
Role in the message: ecsTaskExecutionRole
```

**What happens, step by step:** the message names `ecsTaskExecutionRole`, not the application's task role, so adding the permission to the task role changes nothing. Adding `GetSecretValue` (and `kms:Decrypt`) to the execution role lets the next task start succeed.

**Interview answer:** "I first identify whether injection (execution role) or the application SDK (task role) is reading. Then I check the exact secret ARN in the policy, KMS decrypt on the key, any explicit denies from resource policies, SCPs or endpoint policies, and the network path. CloudTrail confirms which principal was denied and why."

**Follow-ups:**
- *Why does the task fail only at start?* Injected secrets are resolved before the container runs.

---

### Q35. A password rotation caused an outage. What do you do now, and how do you prevent it?

**Short answer:** **Mitigate:** make the credential in the vault match what the database accepts, restart or redeploy clients that cached the old value, and move `AWSCURRENT` back to the known-good version if the database still accepts it. **Prevent:** clients that refetch on authentication failure, alternating users, a tested rotation function, off-peak windows, ECS redeploy after rotation, alarms, and trying rotation in staging first.

**Debugging steps:**
1. **Establish what the database accepts.** Check: log in with the `AWSCURRENT` and `AWSPREVIOUS` values (`get-secret-value --version-stage ...`). Meaning: which version works decides the fix.
2. **If `AWSPREVIOUS` works:** move the label back: `update-secret-version-stage --version-stage AWSCURRENT --move-to-version-id <prev> --remove-from-version-id <current>`.
3. **If neither works:** set the database password to match `AWSCURRENT` (or `put-secret-value` with the real password).
4. **Refresh clients.** Check: do they cache forever or inject at start (ECS)? Meaning: restart or force new deployment.
5. **Find the cause.** Check: rotation function logs, `RotationFailed` events, whether clients re-fetch.
6. **Fix the design.**

**Example:**
```bash
aws secretsmanager update-secret-version-stage --secret-id prod/payments/db \
  --version-stage AWSCURRENT --move-to-version-id 6f2a-prev --remove-from-version-id 91cc-current
aws ecs update-service --cluster prod --service payments --force-new-deployment
```

**What happens, step by step:** the old password still works for the database, so moving the label restores service for any client that refreshes; the forced deployment replaces tasks that injected the bad value. In the post-incident review the cause is that tasks cached the password at start-up (single-user rotation), so the fix is runtime fetch with refresh-on-failure plus an alarm for rotation events.

**Common mistake → fix:** testing rotation only in a quiet staging environment with short-lived connections. Fix: test with realistic clients, pooled connections and cached secrets, and run a scheduled rotation drill.

**Interview answer:** "First restore service: find which version the database accepts, move AWSCURRENT back if the old one works or reset the database password to match, then restart clients that cached the bad value. Afterward I fix the design: clients refetch on authentication failure with a short TTL, alternating users, redeploy hooks for injected secrets, rotation windows off-peak, alarms on rotation events, and staging drills."

**Follow-ups:**
- *Which label do I use for rollback?* `AWSPREVIOUS` holds the last known good version.

---

### Q36. Secrets Manager calls are throttled during a traffic spike. Why, and what's the fix?

**Short answer:** The application calls `GetSecretValue` on **every request**. At 5,000 requests per second across many secrets you approach the Regional limit (10,000 `GetSecretValue` requests per second) and get `ThrottlingException`; every extra call also costs money and adds latency. Fix it by **caching** in memory with a TTL, loading at start-up, and retrying with exponential backoff and jitter for the rare refresh.

**Debugging steps:**
1. **Measure the rate.** Check: CloudTrail `GetSecretValue` counts and CloudWatch API metrics per principal. Meaning: which workload generates calls.
2. **Check for per-request fetches.** Check: code path. Meaning: a call inside the request handler is the bug.
3. **Check cross-account.** Check: the caller's account quota applies. Meaning: another account's traffic might be using your calling-account limit.
4. **Fix.** Cache (caching client, Lambda extension, Powertools) with a TTL of minutes; fetch once at start; use `BatchGetSecretValue` for multiple secrets; retry with backoff and jitter.

**Example:**
```text
Before: 40 pods × 125 requests/s × 1 call/request = 5,000 GetSecretValue/s
After:  40 pods × 1 refresh / 300 s ≈ 0.13 GetSecretValue/s
```

**What happens, step by step:** after adding a 5-minute cache, a spike in user traffic no longer changes the number of Secrets Manager calls; only refreshes remain. If throttled during a refresh, the SDK retries with backoff, and the application keeps using the cached value meanwhile.

**Interview answer:** "Throttling usually means per-request fetching. I cache secrets in memory with a TTL of a few minutes, load once at start-up, batch where useful, and retry refreshes with backoff and jitter. That removes the dependence of API volume on traffic, and cuts cost and latency too."

**Follow-ups:**
- *Does caching hurt rotation?* Only up to the TTL; refresh on authentication failure covers the gap.

---

### Q37. A secret was committed to git. What do you do?

**Short answer:** Treat it as **compromised** and **rotate or revoke it immediately**. Deleting the commit isn't enough: clones, forks, CI caches and the hosting provider's history may already hold it. Then check for misuse, clean the history if policy requires, add secret scanning to stop a repeat, and move the secret to Secrets Manager.

**Debugging steps:**
1. **Revoke/rotate now.** Check: who issues the credential (database, vendor, cloud). Meaning: a new value invalidates the leaked one.
2. **Find the exposure.** Check: repository visibility, when pushed, who has cloned, whether any public mirror exists. Meaning: sets the urgency and scope.
3. **Look for misuse.** Check: CloudTrail, vendor audit logs, database logs since the commit time. Meaning: shows whether the secret was used by someone else.
4. **Clean up.** Check: rewrite history (`git filter-repo`), force-push, ask collaborators to re-clone. Meaning: reduces ongoing exposure, but isn't a fix on its own.
5. **Prevent.** Add push protection and pre-commit scanning; give applications a run-time fetch from Secrets Manager.

**Example:**
```bash
aws secretsmanager rotate-secret --secret-id prod/partner/api-key      # new value, old one invalid
git filter-repo --path config/.env --invert-paths                       # remove the file from history
```

**What happens, step by step:** the key `sk_live_...` was pushed to a private repository at 14:02. At 14:20 you rotate it, so the leaked value stops working at the vendor within minutes. Vendor logs show no calls from unknown IPs between 14:02 and 14:20. You rewrite history, enable push protection, and move the key to Secrets Manager with a run-time read.

**Common mistake → fix:** deleting the file in a new commit and calling it done. The value stays in history. Fix: rotate first, clean second.

**Interview answer:** "I assume compromise and rotate or revoke immediately, because removing the commit doesn't remove copies. Then I audit logs for misuse since the push time, clean the history if needed, and prevent recurrence with secret scanning and push protection, moving the secret to Secrets Manager so code never contains it."

**Follow-ups:**
- *What if the repository was public?* Assume it was harvested within minutes; rotate and audit with extra urgency.

---

### Q38. Rotation keeps failing or says a rotation is already in progress. What do you check?

**Short answer:** Read the **rotation Lambda's CloudWatch logs** to see which step stops. Common causes: no network path to Secrets Manager or the database, wrong credentials in `AWSCURRENT`, a missing `kms:Decrypt`, a too-short Lambda timeout, low concurrency, and a stale **`AWSPENDING`** label left by a failed run. Fix the cause, **clear `AWSPENDING`** if it's stuck, and run `rotate-secret` again.

**Debugging steps:**
1. **Find the last step in the logs.** Check: which of create/set/test/finish logged last. Meaning: where the failure is.
2. **Stops after "Found credentials in environment variables" or after `createSecret`.** Check: Secrets Manager endpoint or NAT, network ACLs, security group, endpoint policy, Lambda timeout. Meaning: the function can't reach the service.
3. **`setSecret: Unable to log into database`.** Check: function-to-database security groups; the credentials in `AWSCURRENT` and `AWSPREVIOUS` (log in manually); SSL/TLS or `scram-sha-256` support in older function bundles. Meaning: network, credentials or an outdated template.
4. **`Access to KMS is not allowed`.** Check: the function's role has `kms:Decrypt` (and `GenerateDataKey` to write). Meaning: key policy gap.
5. **"Key is missing from secret JSON".** Check: the secret's JSON structure for the engine. Meaning: wrong keys.
6. **Rotation already in progress.** Check: `list-secret-version-ids` for an `AWSPENDING` label on a version that is not `AWSCURRENT`. Meaning: a previous run left it. Remove it, then retry.
7. **Throttling or loops between create/set.** Check: the function's concurrency (reserved or provisioned below 10 causes throttling). Meaning: raise or remove the setting.

**Example:**
```bash
aws secretsmanager list-secret-version-ids --secret-id prod/payments/db      # find the stuck AWSPENDING version id
aws secretsmanager update-secret-version-stage --secret-id prod/payments/db \
  --version-stage AWSPENDING --remove-from-version-id 3b7e-stuck
aws secretsmanager rotate-secret --secret-id prod/payments/db
```

**What happens, step by step:** the log stops after `createSecret` and the function times out at 30 seconds, so it can't reach the `secretsmanager` endpoint from its VPC subnets; adding an interface endpoint fixes that. The earlier failed run left `AWSPENDING` on a version, which would make the next rotation error out, so you remove the label and trigger a fresh rotation, which now passes all four steps.

**Interview answer:** "I start with the rotation function's logs to see the last step it reached. No activity after createSecret means a network or timeout problem reaching Secrets Manager; setSecret login errors mean database reachability, credentials or an old template; KMS errors mean decrypt permissions; and a rotation 'already in progress' means a stale AWSPENDING label that I remove before retrying. I also keep concurrency settings reasonable and alarm on RotationFailed."

**Follow-ups:**
- *Can I cancel a rotation?* Yes, `cancel-rotate-secret` turns off rotation for the secret, or you can clear the stuck pending label and retry.

---

### Q39. A cross-account application can't read a shared secret. Where is it failing?

**Short answer:** Cross-account reads need **three** allowances plus the **right call form**. Work through them in order: the **secret's resource policy**, the **KMS key policy** (the secret must use a **customer managed key**), the **caller's identity policy**, and whether the caller used the secret's **full ARN**. A missing one gives AccessDenied or "not found".

**Debugging steps:**
1. **Which key encrypts the secret?** Check: `describe-secret` (no `KmsKeyId` means `aws/secretsmanager`). Meaning: the AWS managed key can never be shared; re-encrypt with a customer managed key.
2. **Which form of ID does the caller use?** Check: code and logs. Meaning: a name resolves in the caller's own account and returns ResourceNotFound; use the full ARN.
3. **Resource policy.** Check: `get-resource-policy` lists the caller's role with `GetSecretValue`. Meaning: absent means AccessDenied from the secret.
4. **Key policy.** Check: the role (or its account) allowed `kms:Decrypt`/`DescribeKey`. Meaning: "Access to KMS is not allowed" otherwise.
5. **Caller identity policy.** Check: it allows `GetSecretValue` on the full ARN and `kms:Decrypt` on the key ARN. Meaning: both sides are required.
6. **Explicit denies.** Check: SCPs, permissions boundaries, `aws:PrincipalOrgID` conditions. Meaning: a deny beats everything.
7. **Throttling.** Remember the caller's account quota applies.

**Example:**
```text
Symptom: AccessDeniedException ... Access to KMS is not allowed
Diagnosis: resource policy and identity policy are right; the key policy in account A lacks the role from account B
Fix: add the role to the KMS key policy with kms:Decrypt and kms:DescribeKey
```

**What happens, step by step:** the call passes the secret's resource-policy check but fails at KMS, because KMS evaluates its own key policy independently. After adding the role to the key policy, the same call succeeds.

**Interview answer:** "I check the key first: if the secret uses the AWS managed key, it can't be shared and must be re-encrypted with a customer managed key. Then the call form (full ARN), the secret's resource policy, the KMS key policy, the caller's identity policy on both the secret and the key, and any SCP or condition denies. 'Access to KMS is not allowed' points to the key policy."

**Follow-ups:**
- *Which account's quota is hit?* The caller's.

---

## 8. Cheat sheet

| Concept | Remember |
|---|---|
| Secrets Manager | Vault for secrets: encrypted, access-controlled, audited, rotatable, replicable |
| vs Parameter Store | Rotation, replication, cross-account, 64 KB vs cheap config, 4/8 KB |
| Limits | 65,536-byte value, 100 versions, 500,000 secrets, GetSecretValue 10,000/s per Region |
| ARN suffix | 6 random characters; use `-??????`, not `*`, in policies |
| Staging labels | AWSCURRENT (default read), AWSPREVIOUS (rollback), AWSPENDING (rotation in progress) |
| Reading a secret | `GetSecretValue` on the ARN + `kms:Decrypt` on a customer managed key |
| Encryption | Envelope encryption via KMS; names, tags, rotation settings not encrypted |
| Cross-account | Resource policy + customer managed key policy + caller identity policy, use full ARN |
| Separation of duties | Readers, rotators, admins separate; admins without `kms:Decrypt` |
| Rotation kinds | Managed (RDS, Aurora, DocumentDB, Redshift), Lambda, managed external secrets |
| Rotation schedule | rate/cron in UTC, every 4 hours to 999 days, window ≥ 1 hour |
| Rotation steps | create_secret → set_secret → test_secret → finish_secret, idempotent |
| Single vs alternating | One user vs two users with a superuser secret; alternating keeps the old credential valid |
| Apps | Cache with TTL, refetch on auth failure, one cache per process |
| ECS | Injected once at task start by the execution role; redeploy after rotation |
| Lambda | Extension (localhost:2773, 300 s default) or Powertools; cache; VPC endpoint |
| Terraform | Value lands in state; manage the container, set value out of band |
| Deletion | 7–30 day recovery window; force-delete is irreversible |
| Agents | Token vault and per-user OAuth; ABAC by tenant tag; never secrets in prompts or logs |

## Official references

- What is Secrets Manager: https://docs.aws.amazon.com/secretsmanager/latest/userguide/intro.html
- What's in a secret (versions and labels): https://docs.aws.amazon.com/secretsmanager/latest/userguide/whats-in-a-secret.html
- Quotas: https://docs.aws.amazon.com/secretsmanager/latest/userguide/reference_limits.html
- Encryption: https://docs.aws.amazon.com/secretsmanager/latest/userguide/security-encryption.html
- Identity policies and cross-account access: https://docs.aws.amazon.com/secretsmanager/latest/userguide/auth-and-access_iam-policies.html · https://docs.aws.amazon.com/secretsmanager/latest/userguide/auth-and-access_examples_cross.html
- Rotation: https://docs.aws.amazon.com/secretsmanager/latest/userguide/rotating-secrets.html · https://docs.aws.amazon.com/secretsmanager/latest/userguide/rotate-secrets_schedule.html · https://docs.aws.amazon.com/secretsmanager/latest/userguide/rotation-strategy.html · https://docs.aws.amazon.com/secretsmanager/latest/userguide/troubleshoot_rotation.html
- Replication and deletion: https://docs.aws.amazon.com/secretsmanager/latest/userguide/replicate-secrets.html · https://docs.aws.amazon.com/secretsmanager/latest/userguide/manage_delete-secret.html
- Lambda usage: https://docs.aws.amazon.com/lambda/latest/dg/with-secrets-manager.html
- ECS secrets: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/secrets-envvar-secrets-manager.html
- Parameter Store tiers: https://docs.aws.amazon.com/systems-manager/latest/userguide/parameter-store-advanced-parameters.html
