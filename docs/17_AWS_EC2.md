# Amazon EC2: Interview Preparation

> **Updated:** 27 October 2026 · **Level:** what an instance is → storage, networking, access → pricing → Auto Scaling → hardening & incident response
> **How to use:** read the *Short answer* first, then *How it works* and the *Example* walkthrough. *Common mistake → fix* shows what goes wrong in real setups. *Interview answer* is what you can say out loud.

---

## Table of contents

1. [Mental model: what makes up an EC2 instance](#1-mental-model-what-makes-up-an-ec2-instance)
2. [Fundamentals](#2-fundamentals) (Q01–Q07)
3. [Storage](#3-storage) (Q08–Q10)
4. [Networking, access & identity](#4-networking-access--identity) (Q11–Q17)
5. [Pricing models](#5-pricing-models) (Q18–Q19)
6. [Auto Scaling & high availability](#6-auto-scaling--high-availability) (Q20–Q25)
7. [Security & operations](#7-security--operations) (Q26–Q30)
8. [Scenario & debugging questions](#8-scenario--debugging-questions) (Q31–Q36)
9. [Cheat sheet](#9-cheat-sheet)

---

## 1. Mental model: what makes up an EC2 instance

**The one idea everything else follows from:** EC2 (Elastic Compute Cloud) rents you a **virtual server**. You choose four things: what it boots from (an **AMI**), how big it is (an **instance type**), what disks it has (**EBS** volumes or instance store), and what network it sits on (a **subnet** with **security groups**). AWS runs the hardware and the hypervisor; you own the operating system and everything above it: patching, software, logs, security.

Think of renting a furnished flat. The landlord (AWS) keeps the building, power and plumbing working. You choose the size of the flat, bring your own belongings (the OS image and software), and you are responsible for what happens inside, including locking the door (security groups) and fixing the furniture (patching).

```
 ┌──────────────────────────── EC2 instance (i-0abc…) ────────────────────────────┐
 │  AMI (OS + software)  ── what boots                                            │
 │  Instance type m7g.large ── 2 vCPU (Graviton), 8 GiB RAM                        │
 │  Root EBS volume (gp3) + extra EBS volumes / instance store (temporary, local)  │
 │  ENI: private IP 10.0.11.20 (+ public IP / Elastic IP), security groups         │
 │  Instance profile → IAM role → temporary credentials via IMDSv2                  │
 │  User data (script that runs at first boot)                                     │
 │  Placement: Region → AZ → (placement group)                                     │
 └─────────────────────────────────────────────────────────────────────────────────┘
        ▲ managed via                 ▲ access via                ▲ observed via
   Launch template + ASG       SSM Session Manager (no SSH)    CloudWatch agent, Inspector
```

```flow
pipeline: EC2 instance states and what you pay for
pending > The instance is being placed on a host and booting from the AMI. User data runs on first boot. Compute is not billed yet.
running > The instance is up. You pay per second for the instance, plus its EBS volumes and public IPv4 address.
stopping then stopped > Only for EBS-backed instances. The disks are kept and billed for storage, there is no compute charge, and an auto-assigned public IP is lost.
shutting-down then terminated > The instance is deleted. The root volume is deleted by default and instance store data is always lost.
```

**Three rules that come straight from this picture:**
1. **Treat instances as replaceable.** Anything that must survive (data, config) lives outside the instance: S3, a database, EBS snapshots, or is rebuilt from an AMI and user data.
2. **The AMI plus launch template describe the server.** If you can recreate it from those, you can scale it, replace it and recover it automatically.
3. **Identity comes from a role, not from keys on disk.** The instance gets temporary credentials from its instance profile.

---

## 2. Fundamentals

### Q01. What is EC2, and when do you choose it?

**Short answer:** EC2 gives you resizable virtual machines with full control of the operating system. Choose it when you need that control: a specific OS, kernel or drivers, GPUs or other special hardware, software that must run on a long-lived server (legacy apps, self-managed databases), licences tied to servers, or the lowest cost at very high steady load. For ordinary web APIs and workers, a more managed option (Fargate, Lambda) removes OS work.

**How it works:**
1. You call `RunInstances` (console, CLI, Auto Scaling or infrastructure as code) naming an AMI, instance type, subnet, security groups, key pair or role, and storage.
2. EC2 picks a physical host in the chosen AZ (on the **Nitro** system, AWS's modern virtualisation platform) and starts your instance.
3. You are billed per second (minimum 60 seconds) while it runs, depending on the pricing model (Q18).
4. You choose how to scale: change the instance type (vertical) or add instances in an Auto Scaling group (horizontal).

| Need | EC2 a good fit? |
|---|---|
| Custom kernel module, special agent, Windows with licences | yes |
| GPU or high-memory machine learning host | yes |
| Stateless web API, small team | usually no; consider Fargate |
| 15-second event handler | no; Lambda |
| Very large, steady, predictable fleet | yes, with Savings Plans and Spot |

**Example:** launch one instance from the CLI.
```bash
aws ec2 run-instances --image-id ami-0abc1234 --instance-type t3.micro \
  --subnet-id subnet-0a1 --security-group-ids sg-0app \
  --iam-instance-profile Name=app-profile \
  --metadata-options HttpTokens=required \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=demo}]'
```

**What happens, step by step:**
1. EC2 validates that the AMI, subnet and security group exist in the same Region and VPC.
2. The instance is created in state `pending` with private IP, say, `10.0.1.37` from the subnet. It becomes `running` in tens of seconds.
3. The OS boots, cloud-init runs the user data (if any), and the instance gets role credentials from its profile.
4. Billing starts at `running`: for a `t3.micro` that is a few US cents an hour (illustrative; prices vary by Region).
5. If you stop it, the compute charge stops, but the EBS volume keeps costing storage; if you terminate it, everything on a default root volume is deleted.

**Common mistake → fix:** forgetting running instances. A forgotten large instance keeps billing every second. Fix: tag instances with owner and purpose, set budgets and alarms, and use schedules or Auto Scaling for non-production environments.

**Interview answer:** "EC2 rents virtual machines where I control the OS. I pick it for OS-level control, GPUs or special hardware, legacy or licensed software, and for large steady fleets where Savings Plans and Spot make it the cheapest. For typical stateless services I prefer Fargate or Lambda to avoid patching and capacity management."

**Follow-ups:**
- *What is Nitro?* AWS's virtualisation platform with dedicated hardware for networking, storage and security, giving near bare-metal performance.
- *Dedicated Hosts vs shared tenancy?* Dedicated Hosts and Dedicated Instances give single-tenant hardware for licensing or compliance, at higher cost.

---

### Q02. What is the instance lifecycle: stop, hibernate, terminate and reboot?

**Short answer:** An instance is `pending`, then `running`. You can **reboot** it (stays on the same host, keeps everything), **stop** it (EBS-backed instances only: the VM shuts down, disks are kept, no compute charge), **hibernate** it (RAM is saved to the encrypted root volume so it resumes where it left off) or **terminate** it (deleted permanently). Instance store data is lost on stop and terminate; the root EBS volume is deleted on terminate by default.

**How it works:**

| Action | Compute billed? | Disks (EBS) | Instance store | Private IP | Auto-assigned public IP |
|---|---|---|---|---|---|
| Reboot | yes | kept | kept | same | same |
| Stop / start | no while stopped | kept | **lost** | same | **changes** (Elastic IP stays) |
| Hibernate | no while hibernated | kept, RAM saved to root | lost | same | changes |
| Terminate | no | root deleted by default (`DeleteOnTermination`), others kept unless flagged | lost | released | released |

Other points: a stopped-then-started instance may move to a **different physical host**; **termination protection** (`DisableApiTermination`) blocks accidental terminates; you can change instance type only while stopped.

**Example:**
```bash
aws ec2 stop-instances --instance-ids i-0abc
aws ec2 modify-instance-attribute --instance-id i-0abc --instance-type '{"Value":"m7g.xlarge"}'
aws ec2 start-instances --instance-ids i-0abc
```

**What happens, step by step:**
1. `stop-instances`: state `stopping` then `stopped`. The compute meter stops; the 100 GB gp3 root volume still bills for storage.
2. The instance type is changed from `m7g.large` to `m7g.xlarge` (allowed while stopped; the architecture must stay compatible with the AMI).
3. `start-instances`: the instance starts on a possibly different host, keeps `10.0.1.37`, but its auto-assigned public IP changes from `13.x.x.x` to `3.y.y.y`. Anything pointing at the old public IP breaks, unless an Elastic IP is used.
4. Anything saved in instance store (for example a scratch cache) is gone.

**Common mistake → fix:** storing important data on the instance store and expecting it to survive a stop. Fix: use EBS or S3 for anything that must persist.

**Interview answer:** "Reboot keeps everything; stop keeps EBS but not instance store, ends compute billing and drops the auto-assigned public IP; hibernate saves RAM to the root volume; terminate deletes the instance and, by default, its root volume. I enable termination protection on critical pet instances and treat everything else as replaceable."

**Follow-ups:**
- *Why did my instance's IP change?* Stop/start releases the auto-assigned public IPv4; use an Elastic IP or a load balancer DNS name.

---

### Q03. What is an AMI?

**Short answer:** An **AMI** (Amazon Machine Image) is the template an instance boots from: a snapshot of a root volume with an operating system and software, plus launch settings (architecture, virtualisation, block device mapping). Every instance starts from exactly one AMI. AMIs are regional; to use one in another Region you copy it.

**How it works:**
- **Sources:** AWS-provided (Amazon Linux, Ubuntu, Windows), AWS Marketplace, community, or your own **custom** AMI.
- **Building your own:** boot an instance, install and configure software, then `create-image`; or use **EC2 Image Builder** or Packer to build repeatably from a pipeline.
- An AMI references EBS **snapshots**; the image is only as secret as those snapshots.
- AMIs are **immutable once created**: a new version is a new AMI ID (`ami-0123…`).
- **Golden AMI** pattern: bake OS patches and agents into the image so instances boot ready, instead of installing everything at first boot.
- Public parameters (SSM parameter store, for example the latest Amazon Linux AMI) let launch templates always pick the newest AWS-provided image.

**Example:**
```bash
aws ec2 create-image --instance-id i-0abc --name "orders-api-2026-10-27" --no-reboot
aws ec2 copy-image --source-region ap-south-1 --source-image-id ami-0abc --region eu-west-1 --name orders-api-2026-10-27
```

**What happens, step by step:**
1. `create-image` snapshots the instance's volumes and registers `ami-0f12…`. With `--no-reboot` the file system may be captured in an inconsistent state; omitting it makes EC2 reboot the instance first for a clean snapshot.
2. A launch template is updated to use `ami-0f12…`; new instances boot in ~30 s with software already installed.
3. `copy-image` makes a separate AMI in `eu-west-1` with a new ID; the original is unaffected.
4. If the image bakes in a database password or SSH key, every instance and anyone you share the AMI with gets it: a classic leak.

**Common mistake → fix:** baking secrets or personal SSH keys into an AMI. Fix: keep secrets in Secrets Manager or Parameter Store and fetch them with the instance role at start-up.

**Interview answer:** "An AMI is the boot template for an instance: a root volume snapshot with the OS and software plus launch configuration. It's regional and immutable, so I build a new AMI per change, usually with Image Builder, using the golden-AMI pattern so instances start fast and consistent. I never bake secrets into an AMI."

**Follow-ups:**
- *AMI vs user data?* AMI bakes slow-changing software in; user data handles per-instance setup at boot (Q05).
- *How do I find the latest Amazon Linux AMI?* Reference the public SSM parameter in the launch template.

---

### Q04. How do instance types work, and how do you read the names?

**Short answer:** An **instance type** fixes the vCPUs, memory, network speed and storage options. Names follow a pattern: family letter(s), generation number, optional attributes, then size, for example `m7g.large`. The family says what the machine is tuned for: general purpose (`m`, `t`), compute-optimised (`c`), memory-optimised (`r`, `x`), storage-optimised (`i`, `d`), accelerated computing with GPUs or chips (`p`, `g`, `inf`, `trn`).

**How it works:** reading `m7g.2xlarge`:

| Part | Meaning |
|---|---|
| `m` | family: general purpose |
| `7` | generation: newer is generally better price/performance |
| `g` | attribute: Graviton (AWS ARM) processor; `a` = AMD, `i` = Intel, `d` = local NVMe disk, `n` = network-optimised, `e` = extra memory |
| `2xlarge` | size within the family: 8 vCPU for most families |

**Burstable `t` instances** (such as `t3`, `t4g`) earn **CPU credits** while idle and spend them when busy; they suit light, spiky workloads. In **Unlimited** mode they can burst beyond credits for an extra charge; in standard mode they are throttled when credits run out.

**How to choose:** start with general purpose, measure, then move to compute-optimised if CPU-bound or memory-optimised if memory-bound. Try Graviton (ARM) for better price/performance if your software supports ARM. Use **attribute-based instance type selection** in launch templates and Auto Scaling groups to describe needs (vCPU, memory) instead of listing types, which widens Spot options.

**Example:** a Java API using 6 GB memory per 2 vCPU.

**What happens, step by step:**
1. `m7g.large` (2 vCPU, 8 GiB) fits: 75 % memory use at peak. Choose it.
2. Benchmarks show the app is CPU-bound at 80 % CPU: moving to `c7g.large` (2 vCPU, 4 GiB) would run out of memory, so `m` stays.
3. A `t3.medium` was tried first and worked until a sustained load drained its CPU credits, then latency spiked as the CPU was throttled. Credits explain why "low average CPU" can still hide a throttle.
4. The architecture change from x86 to Graviton requires an ARM64 AMI and ARM-compatible binaries (the same applies to container images).

**Common mistake → fix:** using a burstable instance for a steady production load. Fix: use a non-burstable family for sustained CPU, or monitor `CPUCreditBalance` and use Unlimited mode knowingly.

**Interview answer:** "Instance names encode family, generation, attributes and size: m7g.2xlarge is a seventh-generation general-purpose Graviton instance with 8 vCPUs. I pick the family by the bottleneck (CPU, memory, storage, GPU), prefer newer generations and Graviton where compatible, use burstable types only for light spiky loads, and let launch templates choose from several types by attribute."

**Follow-ups:**
- *Why the `g`/`a`/`i` suffix matters?* It changes the CPU architecture or vendor, which affects compatibility (ARM vs x86) and price.

---

### Q05. What are user data and cloud-init?

**Short answer:** **User data** is a script or configuration you pass to an instance at launch; the **cloud-init** agent on most Linux AMIs runs it at first boot (as root), so you can install packages, write config and start services without logging in. It is limited to 16 KB, runs once by default, and is **not a safe place for secrets** because it is readable from the instance and via the API.

**How it works:**
1. You pass user data when launching (often in a launch template).
2. At first boot cloud-init reads it from the instance metadata service and runs it. Output goes to `/var/log/cloud-init-output.log`.
3. By default scripts run only on the first boot of an instance; a stop/start does not re-run them (you can configure that).
4. Use **cloud-config** YAML for declarative setup, or a shell script starting with `#!/bin/bash`.

**Example:**
```bash
#!/bin/bash
set -euxo pipefail
dnf install -y amazon-cloudwatch-agent nginx
aws ssm get-parameter --name /orders/prod/config --with-decryption \
  --query Parameter.Value --output text > /etc/orders/config.json
systemctl enable --now nginx amazon-cloudwatch-agent
```

**What happens, step by step:**
1. A new instance boots; cloud-init runs the script as root.
2. Packages install from the Region's repositories. In a private subnet this needs a NAT gateway or VPC endpoints for the repositories, otherwise `dnf` hangs and the instance never becomes ready.
3. `aws ssm get-parameter` uses the instance role to fetch config: no secret is in the script.
4. The services start; the load balancer health check begins passing after about a minute.
5. If a command fails, `set -e` stops the script, the services never start, and the instance fails health checks; the cause is in `/var/log/cloud-init-output.log`.

**Common mistake → fix:** putting a password or API key in user data. Anyone with `ec2:DescribeInstanceAttribute` can read it. Fix: fetch secrets at boot from Secrets Manager using the instance role.

**Interview answer:** "User data is a boot-time script, run by cloud-init once at first boot, for per-instance setup. I keep it short, idempotent and free of secrets, fetching configuration from Parameter Store or Secrets Manager with the instance role, and I bake heavy installs into the AMI so scale-out is fast. When an instance misbehaves at start-up I read cloud-init's output log."

**Follow-ups:**
- *Size limit?* 16 KB before base64 encoding.
- *Can user data run on every boot?* Yes, with cloud-init settings or by using a systemd unit.

---

### Q06. What are launch templates, and why use versions?

**Short answer:** A **launch template** stores the settings for launching instances: AMI, instance type (or attributes), key pair, security groups, instance profile, storage, user data, metadata options and tags. It is **versioned**: each change creates a new version, so Auto Scaling groups can use a chosen or `$Latest`/`$Default` version, and you can roll back. It replaces the older launch configurations, which can no longer be created for new accounts.

**How it works:**
1. Create the template (version 1). Edit it to create version 2; versions are immutable.
2. An Auto Scaling group points at the template and a version (specific number, `$Default` or `$Latest`).
3. New instances use that version. Existing instances are unaffected until you replace them (Q23).
4. Templates can also specify mixed instance types and purchase options via the Auto Scaling group's mixed instances policy.

**Example:**
```json
{
  "ImageId": "resolve:ssm:/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64",
  "InstanceType": "m7g.large",
  "IamInstanceProfile": { "Name": "orders-api-profile" },
  "SecurityGroupIds": ["sg-0app"],
  "MetadataOptions": { "HttpTokens": "required", "HttpPutResponseHopLimit": 1 },
  "BlockDeviceMappings": [{ "DeviceName": "/dev/xvda", "Ebs": { "VolumeSize": 30, "VolumeType": "gp3", "Encrypted": true } }],
  "UserData": "<base64>"
}
```

**What happens, step by step:**
1. Version 1 launches 4 instances with the current Amazon Linux AMI.
2. You add a new agent to the user data and save version 2.
3. The Auto Scaling group is set to `$Latest`: new scale-out instances use version 2 immediately, while the 4 existing ones still run version 1 until an instance refresh replaces them.
4. Version 2 has a bug; setting the group's version back to 1 (or `$Default` to 1) stops new bad instances. Pinned numeric versions make such changes explicit and reviewable.

**Common mistake → fix:** using `$Latest` in production so an accidental template edit changes the next scale-out. Fix: reference explicit version numbers (or `$Default` controlled by your pipeline).

**Interview answer:** "A launch template is the versioned definition of how to launch an instance. Auto Scaling groups reference a version, so I can roll forward or back and review changes. Changing the template doesn't touch running instances; I roll the change out with an instance refresh. I pin explicit versions in production and require IMDSv2 and encrypted volumes in the template."

**Follow-ups:**
- *Launch template vs launch configuration?* Launch templates are the current standard, versioned and support newer features like mixed instances.

---

### Q07. What are placement groups?

**Short answer:** A **placement group** influences how instances are placed on hardware. **Cluster** packs instances close together in one AZ for the lowest latency and highest network throughput (HPC, tightly coupled jobs). **Spread** puts each instance on distinct hardware so one failure hits only one instance (small critical groups; at most 7 running instances per AZ per group). **Partition** divides instances into partitions that do not share hardware (large distributed systems like Kafka or Cassandra).

**How it works:**

| Type | Placement | Good for | Trade-off |
|---|---|---|---|
| **Cluster** | same rack/area, one AZ | low latency, high throughput between nodes | correlated failure; capacity errors if you launch late |
| **Spread** | each on separate hardware | few critical instances | max 7 per AZ per group |
| **Partition** | groups of instances on separate racks (up to 7 partitions per AZ) | big distributed data stores | you map replicas to partitions |

**Example:** an HPC job of 16 nodes needing 100 Gbps between nodes: cluster placement group, one launch request for all 16 with the same instance type.

**What happens, step by step:**
1. You launch all 16 in one request into the cluster group. EC2 finds a place where all fit together.
2. Network latency between nodes is the lowest AWS offers; throughput between them is higher than across AZs.
3. If you later add 8 more, EC2 may fail with `InsufficientInstanceCapacity` because no room remains near the rest. Stopping and restarting all instances often fixes it.
4. A single hardware failure can affect several nodes in the cluster group, so the job must checkpoint.

**Common mistake → fix:** using a cluster group for a web tier "for speed". It reduces resilience for no benefit. Fix: spread across AZs by default; use cluster groups only where inter-node latency matters.

**Interview answer:** "Cluster placement groups give lowest latency and highest bandwidth by packing instances together in one AZ, spread groups isolate a few critical instances on different hardware, and partition groups separate big distributed systems into fault domains. For a normal web tier I just spread across AZs with an Auto Scaling group."

**Follow-ups:**
- *Can I move an existing instance into a group?* Yes, while it is stopped, via modify-instance-placement.

---

## 3. Storage

### Q08. EBS vs instance store

**Short answer:** **EBS** (Elastic Block Store) is a network-attached virtual disk that lives independently of the instance: it survives stop and (if configured) terminate, is replicated within its AZ, and can be snapshotted. **Instance store** is a disk physically attached to the host: very fast, included in the instance price, but **temporary**: data is lost when the instance is stopped, terminated or the host fails.

**How it works:**

| | EBS | Instance store |
|---|---|---|
| Attached via | network (fast, dedicated EBS bandwidth) | physically on the host |
| Persists after stop | yes | **no** |
| Persists after terminate | root deleted by default; others kept unless flagged | **no** |
| Snapshots / encryption | yes | encrypted, no snapshots |
| Scope | one AZ, attach to one instance (Multi-Attach only for some io1/io2 volumes) | that instance only |
| Cost | per GB-month (+ IOPS/throughput extras) | included for types that have it |
| Best for | OS disks, databases, anything to keep | caches, buffers, scratch data, replicated data stores |

**Example:** a data-processing node on `i4i` with local NVMe for shuffle data, plus a gp3 root volume for the OS.

**What happens, step by step:**
1. The job writes 400 GB of intermediate data to the local NVMe volume at very high speed.
2. Results are copied to S3 at the end of the job.
3. The instance is stopped for resizing: the NVMe data is gone, but the job's results are safe in S3 and the EBS root volume still has the OS.
4. If the same data had been the only copy of a customer's database, this would have been data loss.

**Common mistake → fix:** a database on instance store with no replication. A host failure loses it. Fix: use EBS with snapshots, or instance store only when the application replicates data itself.

**Interview answer:** "EBS is persistent, snapshot-able network block storage tied to one AZ; instance store is fast local disk that disappears when the instance stops or fails. I keep anything that must survive on EBS or S3, and use instance store only for caches, scratch data or systems that replicate data themselves."

**Follow-ups:**
- *Does `DeleteOnTermination` apply to data volumes?* It defaults to false for volumes you attach later and true for the root volume of a normal launch; set it deliberately.

---

### Q09. Which EBS volume types exist, and how do you choose?

**Short answer:** **gp3** (General Purpose SSD) is the default choice: IOPS and throughput are set independently of size (baseline 3,000 IOPS and 125 MiB/s, up to 80,000 IOPS and 2,000 MiB/s). **io2 Block Express** (Provisioned IOPS SSD) is for the most demanding databases (up to 256,000 IOPS, 99.999 % durability). **st1** and **sc1** are HDD volumes for large sequential throughput (big data, logs) and cold data; they cannot be boot volumes. **gp2** and **io1** are older.

**How it works:**

| Type | Max size | Max IOPS | Max throughput | Use |
|---|---|---|---|---|
| **gp3** | 64 TiB | 80,000 | 2,000 MiB/s | boot volumes, most workloads |
| gp2 | 16 TiB | 16,000 | 250 MiB/s | older; IOPS tied to size |
| **io2 Block Express** | 64 TiB | 256,000 | 4,000 MiB/s | latency-sensitive databases; Multi-Attach supported |
| io1 | 16 TiB | 64,000 | 1,000 MiB/s | older Provisioned IOPS |
| **st1** | 16 TiB | 500 | 500 MiB/s | big sequential reads: data warehouse, logs |
| **sc1** | 16 TiB | 250 | 250 MiB/s | cold, infrequently accessed |

(Figures from the EBS volume types documentation; the instance type must also have enough EBS bandwidth to use them.)

You can change a volume's type, size and performance **while it is in use** (Elastic Volumes), though a volume can be modified only once every few hours.

**Example:**
```bash
aws ec2 modify-volume --volume-id vol-0abc --volume-type gp3 --iops 6000 --throughput 400
```

**What happens, step by step:**
1. A PostgreSQL host has a 500 GiB gp2 volume. gp2 gives 3 IOPS per GiB = 1,500 IOPS (with a floor of 100 and bursting above), which is the bottleneck at peak.
2. `modify-volume` converts it to gp3 with 6,000 IOPS and 400 MiB/s with no downtime. The volume goes through the `optimizing` state; performance may be reduced slightly meanwhile.
3. gp3 is also usually cheaper per GB than gp2, so you get more performance for less money.
4. You still need an instance type with enough EBS bandwidth; a small instance caps throughput below what the volume can deliver.

**Common mistake → fix:** buying io2 "for performance" when gp3 meets the need, or ignoring the instance's own EBS bandwidth limit. Fix: measure the real IOPS and latency (`VolumeReadOps`, `VolumeQueueLength`) before choosing.

**Interview answer:** "gp3 is my default: baseline 3,000 IOPS and 125 MiB/s with IOPS and throughput configurable independently of size. io2 Block Express is for latency-critical databases needing very high IOPS; st1 and sc1 are HDD types for large sequential and cold data; gp2 is the legacy type. I can change type and performance online, and I check that the instance type's EBS bandwidth isn't the real limit."

**Follow-ups:**
- *What is EBS encryption?* Volumes can be encrypted with KMS keys with no performance penalty; you can enable encryption by default per Region.

---

### Q10. What are EBS snapshots, and how do you protect AMIs and backups?

**Short answer:** An EBS **snapshot** is a point-in-time backup of a volume, stored durably in S3 (managed by AWS, not visible in your buckets). After the first full copy, snapshots are **incremental**: only changed blocks are stored. You restore a snapshot by creating a new volume (or an AMI). Automate with **Data Lifecycle Manager** or **AWS Backup**, copy cross-Region or cross-account for disaster recovery, and keep snapshots encrypted.

**How it works:**
1. `create-snapshot` captures the volume's data as of that moment (writes in flight after the start are not included). For databases, quiesce or use application-consistent tooling first.
2. Each later snapshot stores only blocks changed since the previous one, but each snapshot is independently restorable, so deleting an old snapshot never breaks newer ones.
3. A volume created from a snapshot is lazily loaded from S3; first reads of blocks are slower unless fast snapshot restore is enabled.
4. Snapshots can be shared with other accounts, copied across Regions, and used as the basis of AMIs.
5. **Recycle Bin** retention rules can recover accidentally deleted snapshots and AMIs.

**Example:** a daily snapshot policy.
```bash
aws dlm create-lifecycle-policy --description "daily-ebs" --state ENABLED \
  --execution-role-arn arn:aws:iam::111122223333:role/dlm-role \
  --policy-details file://daily-7.json   # target tag Backup=daily, create at 02:00, retain 7
```

**What happens, step by step:**
1. Day 1 snapshot of a 500 GiB volume with 120 GiB used stores about 120 GiB.
2. Day 2: 6 GiB changed, so about 6 GiB is added.
3. On day 8 the policy deletes the day-1 snapshot; AWS keeps any blocks that later snapshots still reference, so day 2–8 snapshots remain complete.
4. A bad deployment corrupts the volume on day 5: create a volume from the day-4 snapshot in the same AZ, attach it, and recover. For a Region loss you need the cross-Region copy.

**Common mistake → fix:** snapshots stored only in the same account and Region as the instance. A compromised account or Region failure loses both. Fix: copy to a separate backup account and a second Region.

**Interview answer:** "Snapshots are incremental, point-in-time EBS backups stored in S3; each is independently restorable. I automate them with Data Lifecycle Manager or AWS Backup, encrypt them, copy them to another account and Region for DR, and use Recycle Bin to guard against accidental deletion. I test restores, because an untested backup is just a hope."

**Follow-ups:**
- *Are snapshots consistent?* Crash-consistent by default; use application quiescing or multi-volume snapshots for consistent multi-disk sets.

---

## 4. Networking, access & identity

### Q11. Private IP, public IP and Elastic IP

**Short answer:** Every instance has a **private IP** inside its subnet that stays the same for its life (including stop/start). A **public IPv4** address is optional, auto-assigned in public subnets, and **changes when the instance is stopped and started**. An **Elastic IP** (EIP) is a static public IPv4 address that you allocate and attach to an instance, so it survives stop/start and can be moved to another instance. All public IPv4 addresses are charged hourly, including those in use.

**How it works:**
- Public IPs are mapped to the private IP by the internet gateway; the OS itself only sees the private address.
- Instances in **private subnets** have no public IP and reach the internet via NAT.
- Prefer DNS names (load balancer, Route 53) over IP addresses; use an Elastic IP only when something requires a fixed address (an allow-list at a partner).
- IPv6 addresses are globally unique; use an egress-only internet gateway for outbound-only IPv6.

**Example:**
```bash
aws ec2 allocate-address --domain vpc
aws ec2 associate-address --instance-id i-0abc --allocation-id eipalloc-0123
```

**What happens, step by step:**
1. Instance `i-0abc` has private `10.0.1.37` and auto public `13.201.5.9`.
2. A partner allow-lists `13.201.5.9`. You stop and start the instance for resizing; the public IP becomes `3.108.4.2`, and the partner's firewall now blocks you.
3. Fix: allocate an Elastic IP `65.2.10.20`, associate it, and give that to the partner. After the next stop/start, it is unchanged.
4. If the instance dies, you re-associate the EIP with a replacement within seconds: a simple failover for single-instance setups.
5. An unattached EIP still costs money; release unused ones.

**Common mistake → fix:** using public IPs for communication between instances in the same VPC. It goes out and back through the internet gateway path and pays data charges. Fix: use private IPs or DNS names.

**Interview answer:** "Private IPs are stable inside the VPC; auto-assigned public IPs disappear on stop; Elastic IPs are static public addresses I attach when a fixed address is required, such as a partner allow-list. All public IPv4 addresses cost money, so in production I keep instances private behind a load balancer and use names instead of IPs."

**Follow-ups:**
- *Can an instance have multiple IPs?* Yes, through multiple ENIs or secondary private IPs.

---

### Q12. How do security groups apply to EC2?

**Short answer:** A security group is a stateful, allow-only firewall attached to an instance's network interface. For EC2, define inbound rules for the ports clients need, reference other security groups instead of IP ranges for internal traffic, and keep outbound rules as narrow as your policy needs. A new group denies all inbound; changes apply immediately to running instances.

**How it works:** (the full model is in the AWS Foundations course; here is how it shows up for EC2)
- You can attach several groups to one instance; rules are combined.
- **Instance-to-instance:** the source can be the other instance's security group.
- **Admin access:** do not open port 22 to `0.0.0.0/0`; use Session Manager (Q13) so no inbound admin port is needed.
- A rule change does not drop established connections, because the connection is tracked.

**Example:**
```
 web-sg:  inbound 443 from 0.0.0.0/0        (or from the ALB group)
 app-sg:  inbound 8080 from web-sg           (only the web tier)
 db-sg:   inbound 5432 from app-sg
 no rule for 22; admin through SSM Session Manager
```

**What happens, step by step:**
1. A client connects to the web tier on 443: allowed.
2. The web instance calls `app` on 8080: source is `web-sg`, allowed; a new web instance gets `web-sg` automatically and works with no rule changes.
3. A scanner tries SSH to the web instance: no rule, dropped; it sees a timeout.
4. An admin removes the 8080 rule by mistake: new connections from web fail (timeout), but connections already established keep working until they close. This explains "it worked, then slowly broke".

**Common mistake → fix:** a "temporary" `0.0.0.0/0` rule on 22 or 3389 that stays for months. Fix: no inbound admin ports; use Session Manager, and an AWS Config rule that flags open admin ports.

**Interview answer:** "On EC2, security groups are stateful allow lists on the instance's network interface. I chain them by referencing groups, avoid open admin ports by using Session Manager, and keep outbound traffic as tight as policy requires. A change affects new connections immediately while existing tracked connections continue."

**Follow-ups:**
- *Instance can't reach the internet?* Check outbound rules, route table (NAT or internet gateway) and NACLs.

---

### Q13. Key pairs vs better access options

**Short answer:** An EC2 **key pair** is an SSH public/private key pair: AWS places the public key on the instance at launch and you keep the private key to log in over SSH (port 22; for Windows, to decrypt the Administrator password). Key files are long-lived secrets that are easy to leak and hard to audit. Better: **AWS Systems Manager Session Manager** (a shell through IAM, with no inbound port, no key, and logged sessions) or **EC2 Instance Connect** for short-lived keys.

**How it works:**

| Method | Credential | Inbound port | Audit | Notes |
|---|---|---|---|---|
| **Key pair + SSH** | long-lived private key file | 22 open | host logs only | simple, but keys get shared and copied |
| **EC2 Instance Connect** | temporary key pushed by IAM for 60 seconds | 22 from specific sources | CloudTrail | good for occasional use |
| **SSM Session Manager** | IAM identity | none | CloudTrail + session logs to S3/CloudWatch | needs the SSM Agent, an instance role with SSM permissions, and network path to SSM endpoints |

**Example:**
```bash
aws ssm start-session --target i-0abc
```

**What happens, step by step:**
1. Your IAM identity is checked for `ssm:StartSession` on that instance (you can restrict by tag, e.g. only `Env=dev`).
2. SSM tells the agent on the instance to open a channel; the shell arrives over HTTPS: no port 22, no key file.
3. Every session is recorded to CloudTrail, and keystrokes can be logged to an encrypted bucket.
4. If it fails with "TargetNotConnected": the SSM Agent is not running, the instance role lacks `AmazonSSMManagedInstanceCore` permissions, or private subnets lack the `ssm`, `ssmmessages`, `ec2messages` endpoints (or NAT).
5. A leaked key pair, on the other hand, gives access to every instance launched with it, until you rotate it by redeploying.

**Common mistake → fix:** one shared `.pem` for the whole team. Nobody can tell who did what and offboarding means rotating it everywhere. Fix: Session Manager with individual IAM identities (via SSO).

**Interview answer:** "Key pairs are long-lived SSH credentials with open port 22 and weak auditing. I use Session Manager instead: access through IAM, no inbound ports, every session logged, and tag-based restrictions on which instances people may reach. Instance Connect is an alternative for short-lived SSH keys."

**Follow-ups:**
- *Lost the key pair?* You can't recover it; use SSM, replace the instance, or attach the volume to another instance to fix `authorized_keys`.

---

### Q14. What are instance profiles and IAM roles for EC2?

**Short answer:** Applications on an instance should never use stored access keys. Instead, attach an **IAM role** to the instance through an **instance profile** (the wrapper that carries the role to the instance). The AWS SDK on the instance automatically fetches temporary credentials for that role from the **instance metadata service** and refreshes them before they expire.

**How it works:**
1. Create a role whose trust policy lets `ec2.amazonaws.com` assume it, attach permission policies, and put it in an instance profile (the console creates the profile for you; the CLI needs `create-instance-profile` and `add-role-to-instance-profile`).
2. Launch the instance with `--iam-instance-profile`.
3. The SDK's default credential chain asks IMDS at `http://169.254.169.254/latest/meta-data/iam/security-credentials/<role>` (with a session token under IMDSv2) and caches the result.
4. Credentials rotate automatically (new ones are available well before expiry).
5. Grant least privilege, and use separate roles for different instance fleets.

**Example:** trust policy and permissions for a reporting worker.
```json
{ "Effect": "Allow", "Principal": { "Service": "ec2.amazonaws.com" }, "Action": "sts:AssumeRole" }
```
```json
{ "Effect": "Allow", "Action": ["s3:GetObject"], "Resource": "arn:aws:s3:::acme-reports/monthly/*" }
```

**What happens, step by step:**
1. The worker starts; boto3 finds no environment keys, so it queries IMDS and gets `AccessKeyId ASIA…`, a secret key and a session token, valid for several hours.
2. `s3.get_object` on `monthly/2026-09.csv` succeeds.
3. An SSRF bug in the app lets an attacker make the app fetch `http://169.254.169.254/...` and return the response; with IMDSv1 the attacker obtains the credentials. With IMDSv2 the required `PUT` token request fails, protecting the credentials (Q15).
4. Even if credentials leak, they carry only read access to one prefix and expire.

**Common mistake → fix:** attaching `AdministratorAccess` or `s3:*` on `*` to the instance role. A compromised instance equals a compromised account. Fix: least privilege and one role per workload.

**Interview answer:** "Instances get AWS access through an instance profile that carries an IAM role; the SDK fetches temporary, automatically rotated credentials from the metadata service, so no keys are stored on disk. The role is least-privilege and per workload, and I require IMDSv2 so SSRF bugs can't easily steal the credentials."

**Follow-ups:**
- *Role vs instance profile?* The role holds permissions; the instance profile is the container that attaches one role to an instance.

---

### Q15. What is the instance metadata service (IMDS), and why enforce IMDSv2?

**Short answer:** The **instance metadata service** is a local HTTP endpoint at `169.254.169.254` that tells an instance about itself (ID, type, tags if enabled, network info) and provides its role credentials. **IMDSv1** answers plain `GET` requests, so a web-app bug that fetches an attacker-supplied URL (SSRF, server-side request forgery) can leak credentials. **IMDSv2** requires a session token obtained with a `PUT` request first, which such bugs generally cannot do, so you should require it.

**How it works:**
1. **IMDSv2 flow:** `PUT /latest/api/token` with header `X-aws-ec2-metadata-token-ttl-seconds` (1 second to 6 hours) returns a token; later `GET` requests send `X-aws-ec2-metadata-token: <token>`. Without a valid token the response is `401`.
2. The token is only valid on that instance, and `PUT` requests with an `X-Forwarded-For` header are rejected (so proxies don't relay them).
3. The default `PUT` response **hop limit is 1**, so the token response cannot travel beyond the instance. Containers on the instance in bridge mode may need a hop limit of 2.
4. By default both v1 and v2 are allowed; you can require v2 per instance (`HttpTokens=required`), in launch templates, and with account-level defaults for new instances.
5. Use SDK versions that support IMDSv2 (all current ones do).

```flow
sequence: Reading the role credentials with IMDSv2
actors: App, IMDS (169.254.169.254)
App -> IMDS (169.254.169.254): PUT /latest/api/token, header ttl-seconds 21600
IMDS (169.254.169.254) --> App: session token abc123
> The token only works on this instance and the reply cannot hop beyond the instance with the default hop limit of 1.
App -> IMDS (169.254.169.254): GET /latest/meta-data/iam/security-credentials/orders-role, header token abc123
IMDS (169.254.169.254) --> App: temporary AccessKeyId, SecretAccessKey and session Token
> A plain GET without the token header gets 401 Unauthorized when IMDSv2 is required.
```

**Example:**
```bash
aws ec2 modify-instance-metadata-options --instance-id i-0abc \
  --http-tokens required --http-put-response-hop-limit 1 --http-endpoint enabled
```

**What happens, step by step (SSRF attack):**
1. A web app has an "import from URL" feature with no validation.
2. The attacker submits `http://169.254.169.254/latest/meta-data/iam/security-credentials/orders-role`.
3. With IMDSv1, the app's server makes a plain GET and shows the response: the attacker now holds the role's credentials and uses them from anywhere until they expire.
4. With `HttpTokens=required`, the GET lacks a token and the app receives 401; the attacker would also need to make the app send a PUT with a custom header, which a simple URL fetch cannot do.
5. After enforcing v2 an old script using plain `curl` to IMDS breaks: update it to fetch a token first.

**Common mistake → fix:** enforcing IMDSv2 but running containers that cannot reach it (hop limit 1 with bridge networking). Fix: set the hop limit to 2 for those hosts, or use task-level credentials (ECS) instead of instance credentials.

**Interview answer:** "IMDS exposes instance data and role credentials on 169.254.169.254. IMDSv1 answers plain GETs, so an SSRF vulnerability can leak credentials; IMDSv2 needs a PUT to get a session token with a header and a hop limit of one, which blocks most SSRF. I require IMDSv2 in launch templates and account defaults and fix any legacy scripts that call IMDS without a token."

**Follow-ups:**
- *Disable IMDS entirely?* Yes, `HttpEndpoint=disabled` for instances that never need it.
- *Does IMDSv2 stop a fully compromised host?* No; code running on the instance can still request a token. Least privilege limits the damage.

---

### Q16. What limits network performance on EC2?

**Short answer:** Each instance type has a **network bandwidth** limit and a separate **EBS bandwidth** limit, plus packet-per-second and connection-tracking limits. Smaller sizes within a family can burst to a higher "up to" figure but have a lower sustained baseline. Cross-AZ and internet traffic also cost money. If throughput is poor, check the instance limits before the application.

**How it works:**
- Instance sizes list "up to 12.5 Gbps"-style figures: burst allowed for a while, then a lower baseline.
- **ENA** (Elastic Network Adapter) is the high-performance network driver; current instances use it.
- **Enhanced networking**, larger MTU (9001 within a VPC) and **placement groups** raise performance.
- CloudWatch network metrics, and ENA-specific counters (`bw_in_allowance_exceeded`, `pps_allowance_exceeded`, `conntrack_allowance_exceeded`), show when you hit the limits.
- Security group connection tracking has a per-instance table; very high connection rates can exhaust it.

**Example:** a log-shipping fleet moves 8 Gbps of data on `m7g.large` instances.

**What happens, step by step:**
1. `m7g.large` is rated "up to 12.5 Gbps" but its sustained baseline is far lower (roughly one Gbps for this size; check the instance type page), so after the burst credits end the transfer slows dramatically.
2. ENA counter `bw_out_allowance_exceeded` increases; throughput charts flatten.
3. Moving to a larger size (higher baseline) or more instances fixes it.
4. Separately, EBS-optimised bandwidth for the same size can cap disk throughput, so a fast gp3 volume still looks slow.

**Common mistake → fix:** benchmarking a short test on a small instance and assuming the burst rate is sustained. Fix: test for long enough to exhaust burst and read the ENA allowance counters.

**Interview answer:** "Instance type determines network and EBS bandwidth, packets per second and connection tracking, and small sizes burst above a lower baseline. When throughput is poor I check the instance's baseline, EBS bandwidth and ENA allowance-exceeded counters, then consider a larger size, more instances or a cluster placement group."

**Follow-ups:**
- *Does same-AZ traffic cost money?* Private traffic within an AZ is free; cross-AZ and internet egress are charged.

---

### Q17. EC2 status checks vs application health

**Short answer:** EC2 runs two automatic checks every minute: the **system status check** (the AWS host, power, network and hypervisor) and the **instance status check** (the instance's OS and network configuration). They say whether the *machine* is reachable, **not whether your application works**. The application can be dead while both checks pass, so rely on load balancer health checks and application metrics for readiness.

**How it works:**

| Check | Tests | Typical failure | Action |
|---|---|---|---|
| System status | AWS infrastructure for the host | host hardware or network problem | stop/start moves to a new host; CloudWatch alarm action `recover` |
| Instance status | OS accepts traffic; kernel, network config | kernel panic, full disk, bad network config, exhausted memory | reboot, or fix via console output |
| Application health | your app responds correctly | crash, deadlock, bad deploy | ALB health check, ASG replacement |

You can add CloudWatch alarms on `StatusCheckFailed_System` with the **auto recover** action, and an ASG can use the ELB health check (not just EC2 checks) to replace instances.

**Example:** an app thread deadlocks; the process still exists.

**What happens, step by step:**
1. Both EC2 status checks stay green: the OS responds to pings and ARP.
2. The ALB health check (`GET /health` every 15 s) times out twice and marks the target unhealthy; no more traffic.
3. If the Auto Scaling group's health check type is `EC2` only, it still considers the instance healthy and never replaces it. With health check type `ELB`, the ASG terminates it and launches a replacement.
4. A dead instance with failed system status would be detected by EC2 itself and auto-recovered or replaced.

**Common mistake → fix:** ASG health check type left at EC2 behind a load balancer, so hung apps stay forever. Fix: enable ELB health checks on the ASG (with a grace period for boot time).

**Interview answer:** "System and instance status checks tell me whether the host and the OS are healthy, not whether my application is. I use ALB health checks for readiness and have the Auto Scaling group use ELB health checks so it replaces hung instances. For host failures I can alarm on StatusCheckFailed_System with the recover action."

**Follow-ups:**
- *Why a health check grace period?* New instances need time to boot; without it the ASG may kill them before they become healthy.

---

## 5. Pricing models

### Q18. On-Demand vs Savings Plans vs Reserved Instances vs Spot

**Short answer:** **On-Demand** is pay per second with no commitment. **Savings Plans** give a discount in return for committing to a dollar amount of usage per hour for 1 or 3 years, and apply flexibly across instance families, sizes and (for Compute Savings Plans) Regions, plus Fargate and Lambda. **Reserved Instances** are older, less flexible commitments to specific instance attributes. **Spot** uses spare capacity at a large discount, but AWS can take the instance back with two minutes' notice.

**How it works:**

| Model | Commitment | Flexibility | Interruption risk | Best for |
|---|---|---|---|---|
| **On-Demand** | none | full | none | new, unpredictable, short-lived |
| **Compute Savings Plan** | $/hour for 1 or 3 years | any instance family, size, OS, Region; also Fargate and Lambda | none | steady baseline across changing fleets |
| **EC2 Instance Savings Plan** | $/hour, one family in one Region | size and OS within the family | none | stable known family, deeper discount |
| **Reserved Instances** | specific type/Region (Standard or Convertible) | limited | none | legacy; Savings Plans are usually simpler |
| **Spot** | none | many instance types needed | **yes**, 2-minute notice | stateless, fault-tolerant, batch, CI |
| **Capacity Reservations** | none (billed while reserved) | n/a | none | guarantee capacity in an AZ for an event or DR |

(Discount sizes vary by term and payment option; check the pricing page rather than memorising percentages.)

**How to choose:** cover the steady baseline with a Savings Plan, run bursts On-Demand, and run interruptible work on Spot. Do not commit above your *minimum* steady usage.

**Example (illustrative numbers):** a fleet averages 20 instances but never falls below 12. Commit Savings Plan for 12 instances' worth of $/hour. Up to 6 more are On-Demand at peak, and a batch pool of 10 uses Spot.

**What happens, step by step:**
1. Hourly use hits 20 instances: the first 12 instances' cost is covered by the plan at its discounted rate; the other 8 bill On-Demand.
2. At night use falls to 12: all covered, no waste.
3. If you had committed to 20 and use falls to 12, you still pay the full commitment for hours you don't use; this is the main Savings Plan risk.
4. Moving workloads from m5 to Graviton m7g next year: a Compute Savings Plan keeps applying, an EC2 Instance Savings Plan for m5 would not.

**Common mistake → fix:** committing to the *average* rather than the *minimum* usage. Fix: size the commitment on the lowest steady level (look at 30–90 days of usage in Cost Explorer) and top up gradually.

**Interview answer:** "On-Demand is flexible but the most expensive; Savings Plans trade a one- or three-year hourly dollar commitment for a discount and flexibility across instance types, with Compute Savings Plans also covering Fargate and Lambda; Spot is the cheapest but interruptible. I cover the steady minimum with Savings Plans, handle peaks with On-Demand, and run fault-tolerant work on Spot."

**Follow-ups:**
- *Savings Plans vs RIs?* Savings Plans are more flexible; Reserved Instances can also reserve capacity in an AZ (zonal RIs), which Savings Plans do not.

---

### Q19. How do you use Spot instances safely?

**Short answer:** Use Spot only for work that tolerates interruption: stateless workers, batch jobs, CI runners, and the extra capacity beyond an on-demand base. Diversify across many instance types and AZs, use the **capacity-optimised** allocation strategy, react to the **two-minute interruption notice**, and checkpoint or keep work in a queue so another instance can retry it.

**How it works:**
1. In an Auto Scaling group use a **mixed instances policy**: an on-demand base plus a percentage above base on Spot, with several instance types (attribute-based selection) across AZs.
2. Allocation strategy **price-capacity-optimized** (or capacity-optimized) picks pools least likely to be interrupted.
3. EC2 sends a **rebalance recommendation** (early signal that an instance is at elevated risk), then a **Spot interruption notice** two minutes before stopping or terminating it, both as EventBridge events and in instance metadata (`spot/instance-action`, check every few seconds).
4. ASG **capacity rebalancing** proactively launches a replacement when a recommendation arrives.
5. Your app drains: stops taking work, finishes or checkpoints, deregisters from the load balancer.

```flow
sequence: A Spot interruption handled gracefully
actors: EC2, Instance, SQS, ASG
EC2 -> Instance: rebalance recommendation (elevated interruption risk)
> Capacity rebalancing lets the Auto Scaling group start a replacement early.
EC2 -> Instance: Spot interruption notice, two minutes before reclaim (spot/instance-action)
Instance -> SQS: stop polling, return the current job (visibility timeout) or save a checkpoint
Instance -> ASG: signal ready to terminate (lifecycle hook)
EC2 -> Instance: terminate after about two minutes
ASG -> SQS: replacement instance starts and the job is processed again from the checkpoint
```

**Example:**
```json
"MixedInstancesPolicy": {
  "InstancesDistribution": { "OnDemandBaseCapacity": 2, "OnDemandPercentageAboveBaseCapacity": 0,
                             "SpotAllocationStrategy": "price-capacity-optimized" },
  "LaunchTemplate": { "LaunchTemplateSpecification": { "LaunchTemplateId": "lt-0abc", "Version": "3" },
    "Overrides": [{ "InstanceType": "m7g.large" }, { "InstanceType": "m6g.large" }, { "InstanceType": "c7g.large" }] }
}
```

**What happens, step by step:**
1. The group runs 2 on-demand instances (the base) plus 8 Spot across three instance types and three AZs.
2. AWS reclaims 3 Spot instances in one pool; each gets a notice and its worker returns jobs to the queue.
3. The ASG launches replacements, possibly in other pools. Meanwhile the 2 on-demand instances and the remaining Spot ones keep serving.
4. A single-type, single-AZ Spot group would lose all capacity at once when that one pool was exhausted.

**Common mistake → fix:** Spot for a single-instance stateful database. An interruption means downtime and data loss. Fix: Spot only for replaceable workers; keep state in managed services.

**Interview answer:** "Spot is for stateless, fault-tolerant work. I use an Auto Scaling group with mixed instances: an on-demand base plus Spot across many types and AZs with price-capacity-optimised allocation and capacity rebalancing. I handle the two-minute notice by draining and checkpointing, and keep jobs in a queue so any worker can retry them."

**Follow-ups:**
- *Spot on containers?* ECS and EKS capacity on Spot works the same way; ECS drains tasks when the instance receives the interruption notice.

---

## 6. Auto Scaling & high availability

### Q20. What is an Auto Scaling group?

**Short answer:** An **Auto Scaling group** (ASG) manages a fleet of identical EC2 instances launched from a launch template. You set a **minimum**, **desired** and **maximum** size and subnets in several AZs; the ASG keeps the desired number running, replaces unhealthy instances, spreads them across AZs, registers them with a load balancer, and changes the desired number when scaling policies say so.

**How it works:**
1. The ASG launches instances from the launch template (a specific version) into the chosen subnets, balancing across AZs.
2. It checks health: EC2 status checks by default, and load balancer (ELB) health checks if you enable them. An unhealthy instance is terminated and replaced.
3. A **health check grace period** gives new instances time to boot before health is judged. Set it explicitly: the API default is 0 seconds, so a slow-booting app can be replaced before it ever becomes healthy.
4. When the group scales in, a **termination policy** chooses which instance goes (by default it first balances AZs, then picks by launch template age and closeness to the next billing hour).
5. **Lifecycle hooks** pause launching or terminating so you can run custom actions (Q22). **Warm pools** keep pre-initialised stopped instances ready for faster scale-out.
6. **Instance protection** stops specific instances from being chosen for scale-in.

```flow
cycle: The Auto Scaling group loop
Compare desired and in-service instances > Desired is 4 but only 3 instances are healthy.
Launch from the template > A new instance starts in the AZ with the fewest instances.
Wait for the grace period > The instance boots and runs user data before health is judged.
Register with the load balancer > The target joins the group once it passes health checks.
exit > In-service equals desired, so the group is steady and keeps watching health and policies.
```

**Example:**
```bash
aws autoscaling create-auto-scaling-group --auto-scaling-group-name orders-api \
  --launch-template LaunchTemplateName=orders-api,Version=3 \
  --min-size 2 --max-size 10 --desired-capacity 3 \
  --vpc-zone-identifier "subnet-a,subnet-b,subnet-c" \
  --target-group-arns arn:aws:elasticloadbalancing:...:targetgroup/orders-tg/abc \
  --health-check-type ELB --health-check-grace-period 300
```

**What happens, step by step:**
1. The ASG launches 3 instances, one per AZ.
2. Each boots (about 60 s), the app starts, and ALB health checks pass at about 90 s, within the grace period (set to 300 seconds in this example).
3. Instance B hangs. The ALB marks it unhealthy; because the health check type is `ELB`, the ASG terminates it and starts a replacement in the same AZ.
4. Total capacity stays at 3 within a couple of minutes without anyone being paged.

**Common mistake → fix:** a health check grace period shorter than start-up time. The ASG terminates instances that are still booting, launches new ones, and loops forever (Q33). Fix: set it to the measured boot time plus margin.

**Interview answer:** "An ASG keeps a desired number of identical instances running from a launch template, spread across AZs, replacing unhealthy ones and registering them with the load balancer. I set min, desired and max, use ELB health checks with a grace period longer than boot time, and attach scaling policies. Lifecycle hooks and warm pools handle custom start-up and shutdown work and faster scale-out."

**Follow-ups:**
- *Min = max = 1 pattern?* A self-healing single instance: if it dies, the ASG replaces it (with a short outage).

---

### Q21. What scaling policies exist?

**Short answer:** **Target tracking** keeps a metric near a target value (for example average CPU 50 %, or `ALBRequestCountPerTarget` 1,000): the simplest and usually the best choice. **Step scaling** adds or removes capacity by size depending on how far an alarm breaches. **Simple scaling** is the older single-step form. **Scheduled** scaling sets capacity at known times. **Predictive scaling** forecasts from history and scales ahead of demand.

**How it works:**
- Target tracking creates and manages the CloudWatch alarms for you; it scales out fast and in conservatively.
- Choose a metric that actually tracks load: request count per target for web tiers, queue backlog per instance for workers, not CPU if CPU is not the bottleneck.
- **Instance warm-up** tells the ASG how long a new instance takes to start contributing, so it does not overshoot.
- Policies with a **cooldown** avoid flapping.
- Min and max are guardrails. Max also caps your bill.

**Example:** a web tier: target tracking on `ALBRequestCountPerTarget` at 1,000, min 3, max 30.

**What happens, step by step:**
1. 6 instances handle 6,000 requests per minute: 1,000 each, exactly at the target. No change.
2. A marketing email lifts traffic to 12,000 requests per minute: 2,000 per instance, double the target.
3. Target tracking computes 12,000 / 1,000 = 12 instances needed and raises desired capacity from 6 to 12.
4. The new instances take 3 minutes to boot and warm up; during that time the existing 6 are overloaded, which is why headroom, warm pools or a lower target matter.
5. Traffic falls back; scale-in removes instances gradually after a delay.

**Common mistake → fix:** target tracking on CPU for an I/O-bound service whose CPU stays at 15 % while latency climbs. Fix: choose a metric tied to demand (request count or latency), or a custom metric such as queue depth per instance.

**Interview answer:** "I prefer target tracking on a metric that follows demand, like request count per target or queue backlog per instance, because it manages the alarms itself and scales out quickly and in slowly. Scheduled scaling covers known peaks and predictive scaling covers repeating patterns. I set min and max as guardrails and keep headroom because new instances take minutes to become useful."

**Follow-ups:**
- *Why not scale on memory?* EC2 does not publish memory metrics by default; the CloudWatch agent must provide them first.

---

### Q22. How do lifecycle hooks and graceful termination work?

**Short answer:** When an ASG terminates an instance it normally just stops it, cutting any work in progress. A **lifecycle hook** pauses the instance in a wait state (`Terminating:Wait`) so you can drain traffic, finish or hand off jobs, upload logs or deregister from a system, and then continue. Pair it with load balancer **deregistration delay** so in-flight requests complete. The same mechanism works at launch (`Pending:Wait`) to finish configuration before the instance receives traffic.

**How it works:**
1. You add a hook for `autoscaling:EC2_INSTANCE_TERMINATING` (or `LAUNCHING`).
2. When the ASG decides to remove an instance, it first deregisters it from the load balancer (the target drains for the deregistration delay) and then puts it into `Terminating:Wait`.
3. A notification goes to EventBridge, SNS or SQS; your automation (or the instance itself via SSM) performs cleanup.
4. It calls `complete-lifecycle-action` with `CONTINUE` (or `ABANDON`). If nothing responds before the **heartbeat timeout** (default 3,600 seconds), the default result applies. You can extend with `record-lifecycle-action-heartbeat`.
5. Then the instance terminates.

**Example:**
```bash
aws autoscaling put-lifecycle-hook --lifecycle-hook-name drain-workers \
  --auto-scaling-group-name orders-workers \
  --lifecycle-transition autoscaling:EC2_INSTANCE_TERMINATING \
  --heartbeat-timeout 300 --default-result CONTINUE
```

**What happens, step by step (scale-in of a worker):**
1. The ASG picks instance `i-0abc` to remove. It enters `Terminating:Wait` with a 300-second timer.
2. An EventBridge rule triggers an SSM command on the instance: "stop polling SQS, finish the current job, flush logs".
3. The current job finishes after 90 seconds; the script calls `complete-lifecycle-action --lifecycle-action-result CONTINUE`.
4. The instance terminates at about 100 seconds. Without the hook, the job would have been killed immediately and retried later after the queue's visibility timeout.

**Common mistake → fix:** a hook with no handler or a handler that fails, so every scale-in waits the whole timeout and capacity lingers. Fix: always implement the handler and alarm on hooks that time out.

**Interview answer:** "A lifecycle hook holds an instance in a wait state during launch or termination so my automation can finish work, drain connections or register it before the ASG continues. Together with the load balancer's deregistration delay, it gives graceful scale-in. I always complete the action explicitly and monitor for timeouts."

**Follow-ups:**
- *Spot interruptions and hooks?* A two-minute notice is a different mechanism; a hook can still be used for cleanup, but it cannot extend the two minutes.

---

### Q23. How do you deploy a new version on EC2?

**Short answer:** Treat instances as immutable: bake a new AMI (or deploy a new container) with the change, create a new launch template version, and roll it through the fleet. For ASGs the built-in tool is an **instance refresh**, which replaces instances in batches while keeping a minimum healthy percentage; **blue/green** (a second ASG behind the same load balancer) gives instant rollback; **canary** shifts a small share first. In-place updates are acceptable only for small, controlled cases.

**How it works:**
1. Build and test an AMI; register launch template version N+1.
2. Start an instance refresh with `MinHealthyPercentage` (for example 90), an instance warm-up time, optional **checkpoints** (pause at 20 %, 50 %…) and **automatic rollback** if alarms fire.
3. The ASG terminates and replaces instances in batches that respect the minimum healthy percentage; each new instance must pass health checks.
4. For blue/green: create a new ASG from the new template, attach it to a second target group, shift ALB weights (10 %, 50 %, 100 %), watch alarms, then delete the old ASG.

| Strategy | Rollback speed | Cost during deploy | Complexity |
|---|---|---|---|
| In-place update (SSM Run Command/CodeDeploy) | slow | none | low; drift risk |
| Instance refresh (rolling, immutable) | minutes | small extra | low |
| Blue/green with two ASGs | seconds | double fleet | medium |
| Canary with weighted target groups | seconds | small extra | medium |

**Example:**
```bash
aws autoscaling start-instance-refresh --auto-scaling-group-name orders-api \
  --preferences '{"MinHealthyPercentage":90,"InstanceWarmup":120,"AutoRollback":true,"CheckpointPercentages":[20,50],"CheckpointDelay":300}'
```

```flow
trace: Instance refresh on 10 instances with checkpoints at 20 and 50 percent
template v4 set, refresh starts > The group still has 10 instances on template v3 (old AMI) and the refresh replaces them one at a time.
**2 of 10** replaced (20 percent) > New instances passed health checks and a 120 second warm-up. The refresh pauses for the 300 second checkpoint delay.
alarm check during the pause > If the 5xx alarm fires, automatic rollback replaces the new instances with the previous version. If it stays quiet, the refresh continues.
**5 of 10** replaced (50 percent) > Second checkpoint, another 300 second pause while you watch error rate and latency.
**10 of 10** on template v4 > The refresh finishes. At no point were fewer than 9 instances healthy.
```

**What happens, step by step (10 instances, minimum healthy 90 %):**
1. Template version 4 (new AMI) is set on the group.
2. The refresh replaces 1 instance at a time (10 % batch), each new one must be healthy and warmed up (120 s) before the next batch starts.
3. At 20 % (2 replaced) it pauses for 300 s at the checkpoint. If your 5xx alarm fires here, auto rollback replaces the new instances with the previous version.
4. If all is quiet, it continues to 50 % and then to 100 %. Total duration is around 25–30 minutes for 10 instances.

**Common mistake → fix:** editing the launch template and expecting running instances to change. They do not; only new launches use it. Fix: run an instance refresh.

**Interview answer:** "I deploy immutably: bake an AMI, create a new launch template version and roll it with an instance refresh that keeps a minimum healthy percentage, with checkpoints and automatic rollback on alarms. For instant rollback I use blue/green with two ASGs behind weighted target groups. In-place changes drift over time, so I avoid them."

**Follow-ups:**
- *CodeDeploy?* It can deploy application revisions to EC2 in place or blue/green with hooks; good when AMI baking per release is too heavy.

---

### Q24. How do you build a resilient multi-AZ EC2 service?

**Short answer:** Put an Application Load Balancer in public subnets in at least two AZs, an ASG of stateless instances in private subnets across those AZs, and a Multi-AZ database. Keep state out of instances (sessions in a cache or database, files in S3), use ELB health checks, size so the surviving AZs can carry the load, and have NAT or VPC endpoints per AZ.

**How it works:**

```flow
sequence: A request, and an AZ failing
actors: Client, ALB, Instances in AZ a and b, Database
Client -> ALB: HTTPS request
ALB -> Instances in AZ a and b: forward to a healthy target in either AZ
Instances in AZ a and b -> Database: query the Multi-AZ primary
Database --> Client: response via the instance and ALB
> AZ b fails: its targets stop answering and the ALB sends everything to AZ a.
Instances in AZ a and b -> Instances in AZ a and b: the ASG launches replacements in the healthy AZ and the database fails over to its standby
```

Design checklist: ALB across AZs; ASG `vpc-zone-identifier` in 3 subnets; at least N+1 capacity across AZs; stateless instances; Multi-AZ RDS or Aurora; per-AZ NAT or endpoints; health checks of type ELB; no single-instance dependencies (a lone cron server, a lone license server).

**Example:** peak needs 6 instances. With 2 AZs and 6 instances (3 each), an AZ failure leaves 3, which cannot carry peak. With 3 AZs at 3 each (9 instances), losing one leaves 6.

**What happens, step by step:**
1. AZ b fails at 14:00. Its 3 instances become unreachable.
2. Within ~30–60 seconds the ALB marks them unhealthy; no traffic goes there.
3. The remaining 6 instances serve all traffic, matching peak. Latency rises but no outage.
4. The ASG, which keeps desired at 9, tries to launch 3 more in AZ b but cannot; it launches them in a and c instead (rebalancing happens when b returns). The database fails over in about a minute.

**Common mistake → fix:** the session state kept in instance memory. When the instance is replaced, users get logged out. Fix: store sessions in ElastiCache/DynamoDB or use stateless tokens.

**Interview answer:** "ALB across AZs, an ASG of stateless instances in private subnets across at least two AZs sized for N plus one, a Multi-AZ database, per-AZ NAT or endpoints, and ELB-based health checks. State lives in managed stores, and I test by simulating an AZ failure."

**Follow-ups:**
- *Why 3 AZs rather than 2?* With 3, losing one AZ costs a third of capacity instead of half, so headroom is cheaper.

---

### Q25. How do you design an EC2-backed ECS cluster?

**Short answer:** Run the cluster's container instances in an ASG that uses the ECS-optimised AMI and a launch template, register it as an ECS **capacity provider** with **managed scaling** and managed termination protection, spread across AZs, use awsvpc tasks, and plan instance replacement (drain instances before terminating). If you do not need to manage hosts, Fargate or ECS Managed Instances is simpler (see the ECS course).

**How it works:**
1. The launch template uses the **ECS-optimised AMI** and sets `ECS_CLUSTER=<name>` via user data so the ECS agent joins the cluster.
2. The instance role (instance profile) lets the agent talk to ECS and pull images.
3. The ASG is attached to the cluster as a capacity provider; managed scaling grows it when tasks are pending, and **managed termination protection** prevents scale-in from killing instances that run tasks.
4. **Managed instance draining** lets ECS drain tasks before the ASG terminates an instance.
5. Choose spread (AZ) then binpack placement; choose instance sizes so several tasks fit; consider ENI limits for awsvpc tasks.

**Example user data:**
```bash
#!/bin/bash
echo "ECS_CLUSTER=prod" >> /etc/ecs/ecs.config
echo "ECS_ENABLE_SPOT_INSTANCE_DRAINING=true" >> /etc/ecs/ecs.config
```

**What happens, step by step:**
1. A service raises desired count from 10 to 20; tasks cannot be placed; ECS publishes a higher `CapacityProviderReservation`.
2. Managed scaling increases the ASG's desired count; new instances boot, join the cluster, and the pending tasks are placed.
3. Load falls; the ASG wants to scale in but protected instances still run tasks, so only empty instances are removed.
4. A weekly AMI rollout replaces instances: each is drained (tasks move to others) before it terminates, so the service stays up.

**Common mistake → fix:** no managed termination protection, so scale-in kills instances with running tasks, causing 5xx during every scale-in. Fix: enable managed termination protection and managed draining on the capacity provider.

**Interview answer:** "I run the ASG on the ECS-optimised AMI with ECS_CLUSTER set in user data, register it as a capacity provider with managed scaling and termination protection, spread across AZs, and rotate instances with draining. For most teams Fargate or Managed Instances removes this work, so I use EC2-backed clusters only for specific hardware, AMI or cost needs."

**Follow-ups:**
- *Why Spot draining?* `ECS_ENABLE_SPOT_INSTANCE_DRAINING` makes the agent drain tasks when the Spot notice arrives.

---

## 7. Security & operations

### Q26. How do you patch and harden instances?

**Short answer:** Prefer **immutable** patching: build a new, patched AMI regularly (EC2 Image Builder) and roll it out with an instance refresh, rather than patching running servers. Where you must patch in place, use **Systems Manager Patch Manager** with maintenance windows. Harden the image: minimal packages, no password SSH, IMDSv2 required, encrypted volumes, a CIS-style baseline, agents for monitoring, and scan with **Amazon Inspector**.

**How it works:**
- **Image Builder pipeline:** start from the latest Amazon Linux AMI → apply components (updates, hardening, agents) → test → publish the new AMI ID to a Parameter Store parameter → trigger an instance refresh.
- **Patch Manager:** patch baselines define approved patches; maintenance windows run them in batches with rate controls; reports show compliance.
- **Inspector** continuously scans instances (via SSM) and ECR images for known vulnerabilities and network exposure.
- **Shared responsibility:** on EC2 the OS and everything above is yours.

**Example:** a monthly pipeline.

**What happens, step by step:**
1. The second Tuesday: Image Builder builds `orders-base-2026-10` on the newest Amazon Linux, applies the hardening component, runs tests, and records the AMI ID.
2. A pipeline updates the launch template and starts an instance refresh with automatic rollback.
3. In 30 minutes every instance runs the patched image; Inspector shows the critical CVE count drop to zero.
4. A server that cannot be rebuilt (a pet) is patched via Patch Manager in a maintenance window instead, and reports show its compliance.

**Common mistake → fix:** patching by logging in and running `yum update` on each box. Drift, no audit, no rollback. Fix: immutable images plus automated refresh; Patch Manager for exceptions.

**Interview answer:** "I patch immutably: Image Builder bakes a hardened, patched AMI on a schedule and an instance refresh rolls it out with rollback. For long-lived exceptions I use Patch Manager with maintenance windows. I harden the image, require IMDSv2, encrypt volumes, and use Inspector for continuous vulnerability scanning."

**Follow-ups:**
- *Zero-day in the OS?* Rebuild and refresh immediately; use Inspector findings to prioritise and WAF/security groups for temporary mitigation.

---

### Q27. What can AWS Systems Manager (SSM) do for EC2?

**Short answer:** **Systems Manager** is a set of operations tools that work on instances running the **SSM Agent** with an IAM role allowing it. Key tools: **Session Manager** (shell without SSH), **Run Command** (run a script on many instances), **Patch Manager**, **Parameter Store** (config and secrets), **State Manager** (keep a desired configuration), **Automation** (runbooks), and **Inventory**.

**How it works:**
- The instance role needs `AmazonSSMManagedInstanceCore`; the agent calls the SSM endpoints (`ssm`, `ssmmessages`, `ec2messages`) outbound over HTTPS, so no inbound port is needed.
- Targets are selected by instance IDs or tags (`Env=prod, Role=api`).
- Results and logs can go to S3 or CloudWatch; every action is in CloudTrail.

**Example:** restart a service on every production API instance.
```bash
aws ssm send-command --document-name AWS-RunShellScript \
  --targets Key=tag:Role,Values=api Key=tag:Env,Values=prod \
  --parameters 'commands=["systemctl restart orders-api"]' \
  --max-concurrency 25% --max-errors 1
```

**What happens, step by step (10 instances):**
1. SSM selects the 10 tagged instances and runs the command on 25 % (3) at a time.
2. After each batch it checks failures; `max-errors 1` stops the rollout if more than one instance fails.
3. Output and exit codes are recorded per instance and stored for audit.
4. An instance that is offline (agent down or no network path) shows as not managed; the first thing to check is the role and endpoint reachability.

**Common mistake → fix:** private subnets with no route to SSM endpoints, so instances never appear in Fleet Manager. Fix: add the three SSM interface endpoints (or NAT) and the managed-instance role.

**Interview answer:** "Systems Manager lets me operate instances without SSH: Session Manager for shells, Run Command with rate and error limits for fleet actions, Patch Manager for compliance, Parameter Store for configuration, and Automation for runbooks. It needs the SSM Agent, an instance role, and outbound HTTPS to the SSM endpoints."

**Follow-ups:**
- *Run Command vs user data?* User data runs once at boot; Run Command runs on demand on running instances.

---

### Q28. How do you monitor EC2?

**Short answer:** EC2 publishes basic metrics automatically every 5 minutes (1 minute with detailed monitoring): CPU, network, disk operations, and status checks. It does **not** publish memory or disk-space usage, so install the **CloudWatch agent** for those and for logs. Alarm on user-facing symptoms first (via the load balancer), then on saturation such as CPU, memory, disk space, burstable CPU credits and EBS queue length.

**How it works:**

| Signal | Source |
|---|---|
| CPU, network, disk ops, status checks | built-in EC2 metrics |
| Memory, disk used %, swap, processes | CloudWatch agent |
| Application and system logs | CloudWatch agent → CloudWatch Logs |
| Credit balance (burstable) | `CPUCreditBalance` |
| EBS performance | `VolumeQueueLength`, `VolumeReadOps/WriteOps`, burst balance |
| Host health | `StatusCheckFailed_System` / `_Instance` |
| Traffic and errors | ALB 5xx, `TargetResponseTime` |

**Example:** CloudWatch agent config for memory and disk.
```json
{ "metrics": { "append_dimensions": { "AutoScalingGroupName": "${aws:AutoScalingGroupName}" },
  "metrics_collected": { "mem": { "measurement": ["mem_used_percent"] },
                         "disk": { "measurement": ["used_percent"], "resources": ["/"] } } } }
```

**What happens, step by step:**
1. The application leaks memory; EC2's built-in CPU graph stays flat.
2. The agent publishes `mem_used_percent`; an alarm fires at 85 % for 10 minutes.
3. The on-call engineer sees growth, restarts via SSM or lets the ASG replace the instance, and files the bug.
4. Without the agent, the first signal would have been the kernel OOM-killer terminating the app and users seeing 5xx.

**Common mistake → fix:** relying on CPU alone. Fix: add memory, disk, status check and application-level alarms.

**Interview answer:** "Built-in EC2 metrics cover CPU, network, disk operations and status checks, but not memory or disk space, so I run the CloudWatch agent for those and for logs. I alarm on ALB error rate and latency first, then on saturation like memory, disk, EBS queue length and CPU credits, with per-ASG dimensions so alarms survive instance replacement."

**Follow-ups:**
- *Detailed monitoring?* One-minute metrics for a small fee; useful for faster scaling reactions.

---

### Q29. What do you do when an instance may be compromised?

**Short answer:** Contain first, preserve evidence, then eradicate and recover: isolate the instance with a quarantine security group (no inbound or outbound), snapshot its volumes and capture memory if needed, revoke its role sessions, investigate from CloudTrail and logs, then replace it from a clean AMI and rotate anything it could reach. Do not simply terminate it before collecting evidence.

**Step by step:**
1. **Detect and confirm.** *How:* GuardDuty finding, unusual outbound traffic in flow logs, CloudTrail calls from the instance role. *Means:* an indicator of compromise, not yet proof.
2. **Contain.** *How:* replace the instance's security groups with a quarantine group (deny all); remove it from the load balancer or ASG with standby/protection so the ASG does not delete it. *Means:* stops spread and data exfiltration; the instance stays running for evidence.
3. **Revoke credentials.** *How:* attach a deny-all-before-time policy to the instance role (the "revoke older sessions" action) so already-issued temporary credentials stop working. *Means:* attacker keys stolen from IMDS are dead.
4. **Preserve evidence.** *How:* snapshot all EBS volumes (tagged as evidence), copy logs, optionally capture memory with a forensic tool via SSM. *Means:* chain of evidence for analysis.
5. **Investigate.** *How:* CloudTrail for actions by the role and instance, VPC Flow Logs for connections, instance logs and the forensic snapshot attached to an isolated analysis instance. *Means:* scope: what was accessed or changed.
6. **Eradicate and recover.** *How:* build a fresh instance from a known-good AMI, fix the root cause (vulnerable app, open port, leaked key), rotate secrets and keys the instance could access. *Means:* clean restore.
7. **Learn.** Write a post-incident review; add detection and preventive controls.

```flow
pipeline: Responding to a compromised instance
Contain > Swap the security group for a quarantine group with no rules, and keep the ASG from deleting the instance.
Revoke > Attach the revoke-older-sessions policy to the instance role so stolen temporary credentials stop working.
Preserve > Snapshot every EBS volume and copy logs before changing anything else.
Investigate > Use CloudTrail, VPC Flow Logs and the snapshot on an isolated analysis instance to find the scope.
Rebuild and rotate > Launch a clean instance from a known-good AMI, fix the root cause and rotate reachable secrets.
```

**Example:** GuardDuty reports `UnauthorizedAccess:EC2/TorIPCaller` for `i-0abc`. Swap its security group to `sg-quarantine`, snapshot `vol-0abc`, attach the revoke-sessions policy, and start analysis.

**Interview answer:** "I isolate with a quarantine security group, remove it from service without letting the ASG delete it, revoke the role's existing sessions, snapshot volumes for evidence, and investigate with CloudTrail, flow logs and the snapshot on an isolated host. Then I rebuild from a clean image, fix the root cause and rotate every secret the instance could reach."

**Follow-ups:**
- *Why not just terminate it?* You lose volatile and disk evidence and may never learn how they got in or what they touched.

---

### Q30. EC2 vs Fargate vs Lambda: how do you decide?

**Short answer:** Choose the most managed option that meets the requirement. **Lambda** for short (up to 15 minutes), event-driven or spiky work. **Fargate** (ECS or EKS) for long-running containerised services without managing servers. **EC2** when you need OS or hardware control, GPUs, specific licences, or the lowest cost for a large, steady, well-utilised fleet and can afford the operations.

**How it works:**

| | **EC2** | **Fargate** | **Lambda** |
|---|---|---|---|
| You manage | OS, patching, scaling, capacity | container image | function code |
| Max run time | unlimited | unlimited | 15 minutes |
| Scaling speed | minutes | about a minute | seconds |
| Hardware choice | everything (GPU, local NVMe …) | CPU/memory sizes | memory size (CPU scales with it) |
| Billing | per instance second | per task vCPU and GB second | per request and duration |
| Cheapest when | high, steady utilisation with commitments | steady to moderate services | spiky or low traffic |

**Example:** three workloads: a 40-second image-resize on upload (Lambda), a REST API with a steady 200 requests per second (Fargate), and a 300-node GPU training cluster (EC2 with Spot and Savings Plans).

**What happens, step by step:** at 5 requests per hour the API on Lambda costs cents, while the Fargate service costs for 24 hours of at least one task. At 200 requests per second 24/7 the Lambda per-request cost exceeds the Fargate cost, and EC2 with Savings Plans may be cheaper still if utilisation is high and ops capacity exists (all illustrative; model with the pricing calculator).

**Common mistake → fix:** choosing EC2 "because it's cheapest" without counting the engineering time for patching, scaling and incident handling. Fix: include operations cost when comparing.

**Interview answer:** "I pick the most managed option that fits: Lambda for short event-driven work, Fargate for long-running container services, EC2 for OS or hardware control, GPUs, licences, or very large steady fleets. Cost depends on utilisation and the people-time needed to operate the fleet, so I model both."

**Follow-ups:**
- *What about App Runner or Elastic Beanstalk?* Higher-level services that deploy web apps on managed capacity, with less control.

---

## 8. Scenario & debugging questions

### Q31. An instance is running but unreachable (SSH or the application)

**Short answer:** "Running" only means the VM exists. Walk the path from outside in: DNS or IP, route, security group, NACL, OS firewall, the service listening, and the instance's own health.

**Step by step:**
1. **Right address?** *How:* confirm the public IP or Elastic IP now (it changes after stop/start) and DNS records. *Means:* a stale IP explains many timeouts.
2. **Status checks.** *How:* console or `describe-instance-status`. *Means:* failed system check → host problem (stop/start to move hosts); failed instance check → OS problem (read console output, screenshot).
3. **Route and gateway.** *How:* the subnet's route table has `0.0.0.0/0 → igw` for public access, and the instance has a public IP or EIP. *Means:* missing → unreachable from the internet.
4. **Security group.** *How:* inbound rule for the port from your source IP. *Means:* absent → silent timeout.
5. **NACL.** *How:* inbound and outbound rules including ephemeral ports 1024–65535. *Means:* stateless; a deny or missing return rule breaks it.
6. **VPC Flow Logs.** *How:* find your source IP. *Means:* `REJECT` → SG/NACL; no record → never arrived (route, IP, DNS).
7. **OS and service.** *How:* via Session Manager or serial console: `ss -ltnp`, `systemctl status`, `iptables`/firewalld. *Means:* nothing listening or a host firewall blocking → "refused" or timeout.
8. **Disk or memory exhaustion.** *How:* `df -h`, `free -m`, system logs. *Means:* a full disk or OOM can make SSH and apps fail.
9. **Key/user issues for SSH.** *How:* correct username (`ec2-user`, `ubuntu`), key permissions `chmod 400`, `-i` file. *Means:* `Permission denied (publickey)` is auth, not network.

**Example:** SSH times out; flow logs show no record; the instance's subnet route table has no internet gateway route: it was a private subnet. Use Session Manager instead of SSH.

**Interview answer:** "I go from outside in: correct IP and DNS, status checks, subnet route and public IP, security group and NACL, flow logs to see accept or reject, then the OS using Session Manager or the serial console: is anything listening, is the disk full, is a host firewall blocking. A timeout, a refusal and a permission-denied error each point at a different layer."

---

### Q32. CPU stays low but endpoint latency spikes

**Short answer:** Low CPU with high latency means requests are waiting, not computing: for I/O, locks, connection pools, throttled resources, or a burst limit being hit. Find what they wait for.

**Step by step:**
1. **Where is time spent?** *How:* traces or per-dependency timers. *Means:* a slow database call, external API or disk.
2. **Burstable CPU credits.** *How:* `CPUCreditBalance` on `t` instances. *Means:* zero credits → throttled even if the OS shows low CPU.
3. **EBS limits.** *How:* `VolumeQueueLength`, IOPS and throughput at the volume or instance limit, gp2 burst balance. *Means:* disk I/O wait.
4. **Network limits.** *How:* ENA counters `bw_*_allowance_exceeded`, `pps_allowance_exceeded`, `conntrack_allowance_exceeded`. *Means:* instance bandwidth or packet limits.
5. **Memory pressure / swapping.** *How:* CloudWatch agent memory, `vmstat`. *Means:* swapping makes everything slow.
6. **Connection pools / threads.** *How:* pool wait metrics, thread dumps. *Means:* requests queue inside the app.
7. **Dependency throttling or cross-AZ calls.** *How:* 429s, latency by AZ. *Means:* downstream limits.
8. **Load balancer queueing.** *How:* ALB `TargetResponseTime` and surge. *Means:* uneven distribution or slow targets.

**Example:** `t3.large` API; latency jumps at 14:00 daily. `CPUCreditBalance` hits 0 at 13:55 and CPU is capped at the baseline (30 %), so "CPU 30 %" is the throttle, not idleness. Move to a non-burstable `m7g.large` or enable Unlimited mode with cost awareness.

**Interview answer:** "Low CPU with high latency means waiting. I use traces to find the slow hop, then check burstable credits, EBS queue length and limits, ENA allowance counters, memory and swapping, application pools and threads, and dependency throttling."

---

### Q33. An Auto Scaling group keeps replacing instances in a loop

**Short answer:** Instances are being declared unhealthy before they finish becoming ready, or a start-up step fails every time. Find which signal marks them unhealthy and why.

**Step by step:**
1. **Activity history.** *How:* `aws autoscaling describe-scaling-activities`. *Means:* the cause text: "Health check failed", "EC2 instance failed status check", or launch failures such as `InsufficientInstanceCapacity` or a bad AMI.
2. **Which health check type?** *How:* group settings. *Means:* `ELB` health failing or `EC2` status failing tells where to look.
3. **Grace period vs boot time.** *How:* compare cloud-init duration with `HealthCheckGracePeriod`. *Fix:* extend the grace period.
4. **User data failures.** *How:* `/var/log/cloud-init-output.log` (keep one failing instance via instance protection or standby). *Means:* a failed install (no route to repositories in a private subnet) leaves the app not running.
5. **Health check path/port and security group.** *How:* curl the health endpoint; check the ALB-to-instance rule. *Fix:* correct path, port, rule.
6. **Dependencies in the health check.** *How:* does it call the database? *Means:* an outage fails all instances at once. *Fix:* shallow check.
7. **Bad launch template version.** *How:* compare with the last good version. *Fix:* roll back to it.
8. **Stop the churn while debugging.** *How:* put the ASG's `ReplaceUnhealthy` process on suspend or set instances to standby. *Means:* you can inspect a failing instance.

**Example:** activity says "Instance failed ELB health checks" every ~5 minutes; cloud-init log shows `dnf` timing out because the new private subnet has no NAT. Add NAT or endpoints.

**Interview answer:** "I read the scaling activity history for the stated reason, compare the health check grace period with real boot time, inspect cloud-init output on a held instance, verify the health check path, port and security group, make sure the check is shallow, and compare the launch template version. I suspend replacement briefly to debug."

---

### Q34. Migrate a legacy EC2 API to ECS

**Short answer:** Containerise the app, make it stateless and 12-factor, run both versions in parallel, shift traffic gradually, and keep the EC2 version as a fallback until the new one is proven. Use Fargate unless there is a reason for EC2-backed capacity.

**Step by step:**
1. **Assess.** *Check:* local state, file writes, cron jobs, hard-coded config, OS dependencies, session handling. *Means:* work needed before containerising.
2. **Containerise.** Write a Dockerfile, run as non-root, log to stdout, read config from environment variables, handle SIGTERM, expose a health endpoint.
3. **Externalise state.** Sessions to a cache, files to S3 or EFS, secrets to Secrets Manager (injected by the task definition).
4. **Define ECS resources.** Task definition with task and execution roles, service in private subnets, security groups, target group.
5. **Run in parallel.** Same ALB with weighted target groups (EC2 ASG and ECS service).
6. **Shift traffic.** 5 % → 25 % → 100 % with alarms on errors and latency; rollback by weight.
7. **Decommission.** Keep the ASG scaled down for a rollback window, then remove.
8. **Replace cron and ops scripts.** Scheduled tasks via EventBridge, operations via ECS Exec/SSM.

**Example:** weights: EC2 target group 95, ECS target group 5 at the first step. A bug found at 5 % exposes only a small share of users, and setting the weight back to 100/0 reverts immediately.

**Interview answer:** "I containerise a stateless, 12-factor version, move state and secrets to managed services, define the ECS service, run it beside the EC2 fleet behind weighted ALB target groups, shift traffic in steps with alarms, and only decommission the EC2 fleet after a safe rollback window."

---

### Q35. Spot instances are being interrupted mid-job

**Short answer:** Interruption is normal on Spot. The fix is to make work restartable and capacity diverse, not to avoid interruptions.

**Step by step:**
1. **Confirm the cause.** *How:* EventBridge "EC2 Spot Instance Interruption Warning" events and the ASG activity history. *Means:* capacity reclaim vs price vs your own scale-in.
2. **Diversify.** *How:* check the number of instance types and AZs in the group. *Fix:* many types (attribute-based selection) across all AZs, `price-capacity-optimized` allocation.
3. **Capacity rebalancing.** *How:* enable it on the ASG. *Means:* replacements launch on a rebalance recommendation, before the two-minute notice.
4. **Handle the notice.** *How:* poll `spot/instance-action` every few seconds (or use EventBridge). *Fix:* stop taking work, return the job to the queue, checkpoint.
5. **Checkpoint long jobs.** *How:* write progress to S3 or DynamoDB periodically. *Means:* a retry resumes rather than restarts.
6. **Keep a base.** *How:* on-demand base capacity for the critical part. *Means:* interruptions degrade throughput, not availability.
7. **Make queue settings match.** *How:* visibility timeout longer than checkpoint interval but short enough for quick retry; DLQ for poison jobs.

**Example:** a 3-hour render job restarts from zero on each interruption. Adding a checkpoint every 5 minutes means an interruption costs at most 5 minutes of work.

**Interview answer:** "I diversify instance types and AZs, enable capacity rebalancing, handle the two-minute notice by draining and checkpointing, keep work in a queue with sensible visibility timeouts and a DLQ, and retain an on-demand base for anything critical."

---

### Q36. How do you reduce EC2 costs?

**Short answer:** Remove waste first, right-size second, then change the pricing model, then architecture.

**Step by step:**
1. **Find waste.** *How:* Cost Explorer by tag, Trusted Advisor/Compute Optimizer. *Fix:* terminate idle instances, delete unattached EBS volumes and old snapshots, release unused Elastic IPs, stop non-production at night.
2. **Right-size.** *How:* Compute Optimizer recommendations from CPU, memory and network history. *Fix:* smaller or different families; migrate to Graviton where compatible.
3. **Storage.** *How:* gp2 to gp3 (cheaper per GB, tunable performance); remove over-provisioned IOPS.
4. **Pricing models.** *How:* Savings Plans for the steady minimum; Spot for fault-tolerant work.
5. **Scaling.** *How:* target tracking with a sensible minimum; scheduled scale-down off hours.
6. **Network.** *How:* VPC endpoints instead of NAT for AWS traffic; keep traffic in one AZ where safe; CloudFront for egress.
7. **Architecture.** *How:* move spiky workloads to Lambda or Fargate; use S3 instead of large EBS volumes for data.
8. **Guardrails.** *How:* Budgets and Cost Anomaly Detection; mandatory owner tags.

**Example (illustrative):** 40 `m5.xlarge` at 18 % CPU. Right-size to 20 `m7g.large` (Graviton), cover the 12-instance minimum with a Savings Plan, and put the batch share on Spot: typically a large reduction without changing the application logic.

**Interview answer:** "I start with waste (idle instances, orphaned volumes and IPs), then right-size with Compute Optimizer and move to Graviton and gp3, cover the steady minimum with Savings Plans, put fault-tolerant work on Spot, tune scaling, cut NAT and egress costs, and put budgets, tags and anomaly alerts in place."

---

## 9. Cheat sheet

| Topic | Remember |
|---|---|
| EC2 | virtual servers; you own the OS and everything above it |
| AMI / launch template | boot image (regional, immutable) / versioned launch settings |
| Stop vs terminate | stop keeps EBS and drops auto public IP; terminate deletes (root by default) |
| Instance name | `m7g.2xlarge` = family, generation, attribute (g = Graviton), size |
| Burstable (t) | CPU credits; throttled when empty |
| EBS vs instance store | persistent, snapshot-able, one AZ vs temporary local disk |
| gp3 | default; baseline 3,000 IOPS and 125 MiB/s, up to 80,000 IOPS and 2,000 MiB/s |
| Snapshots | incremental, stored in S3; copy cross-account and cross-Region |
| IP addresses | private stable; public changes on stop; Elastic IP static |
| Access | Session Manager over SSH; key pairs are long-lived secrets |
| Role | instance profile gives temporary credentials via IMDS |
| IMDSv2 | PUT for token, hop limit 1; require it (blocks most SSRF theft) |
| Status checks | host/OS only; use ELB health checks for the app |
| Pricing | On-Demand, Savings Plans (commit $/hour), Spot (2-minute notice), Capacity Reservations |
| Spot | diversify types and AZs, capacity rebalancing, drain on notice |
| ASG | min/desired/max, ELB health checks, grace period, lifecycle hooks, warm pools |
| Scaling | target tracking on a demand metric; keep headroom |
| Deploy | immutable AMI + instance refresh (min healthy %, checkpoints, rollback) or blue/green |
| Patching | bake new AMI; Patch Manager for exceptions |
| Incident | quarantine, revoke sessions, snapshot, investigate, rebuild, rotate |

## Official references

- Amazon EC2 user guide: https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/concepts.html
- Instance metadata and IMDSv2: https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/configuring-instance-metadata-service.html
- EBS volume types: https://docs.aws.amazon.com/ebs/latest/userguide/ebs-volume-types.html
- Spot Instance interruptions: https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/spot-interruptions.html
- Spot interruption notices: https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/spot-instance-termination-notices.html
- Auto Scaling user guide: https://docs.aws.amazon.com/autoscaling/ec2/userguide/what-is-amazon-ec2-auto-scaling.html
- Instance refresh: https://docs.aws.amazon.com/autoscaling/ec2/userguide/asg-instance-refresh.html
- Systems Manager: https://docs.aws.amazon.com/systems-manager/latest/userguide/what-is-systems-manager.html
- Savings Plans: https://docs.aws.amazon.com/savingsplans/latest/userguide/what-is-savings-plans.html
