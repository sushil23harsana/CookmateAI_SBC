# Cookmate on AWS: prepared integration and staging deployment

Status: the Bedrock adapter and container configuration are prepared. No AWS
infrastructure has been created. Live inference validation remains blocked by
AWS account verification/model access. Both the CLI and SDK probes returned
`ValidationException: Operation not allowed`; successful inference is still
required before deployment.

## Bedrock locally

The new `COOKMATE_LLM=bedrock` route uses the AWS SDK Converse/ConverseStream API,
preserves the manual tool loop, and sends every tool request through the existing
executor. It does not fall back to direct OpenAI or Anthropic billing, even when
their keys are present. Existing direct-provider defaults remain unchanged.

Run in PowerShell after signing in to the dedicated Cookmate IAM user:

```powershell
aws login --profile cookmate --region ap-south-1
$env:COOKMATE_LLM = 'bedrock'
$env:AWS_PROFILE = 'cookmate'
$env:AWS_REGION = 'ap-south-1'
$env:BEDROCK_MODEL = 'in.openai.gpt-5.6-luna'
$env:BEDROCK_MAX_TOKENS = '64'
$env:COOKMATE_MAX_RETRIES = '0'
bun run test:bedrock:live
```

This is a real, billed inference test with synthetic text only. It requires a
nonempty streamed answer. No customer data, Swiggy tools or orders are involved.
Do not repeatedly retry an account-access error. Credit eligibility and Free
plan service restrictions still need confirmation in AWS Billing/Support.

For normal local development, use `BEDROCK_MAX_TOKENS=4096`, then `bun run app`.
Set these values in your private `.env` if you want them to persist. Always use
`AWS_PROFILE=cookmate` locally: the machine's default profile belongs to another
project. No credentials CSV or AWS access key is needed by this app.

## Container layout

### Console model testing permissions

The Bedrock console loads extra model selectors even when the app only uses one
model. For the developer user, an administrator can replace the inline
`CookmateConsoleRead` policy with `console-read-policy.json`. It grants the model
catalog/selector reads in Mumbai, including the marketplace endpoint,
provisioned throughput, custom model and prompt router lists requested by the
playground. It does not grant model invocation, provisioning or subscription
permissions. This console policy is not needed on the app's runtime role.

In the playground, select **IN OpenAI GPT-5.6 Luna**
(`in.openai.gpt-5.6-luna`). The catalog may default to
`global.openai.gpt-5.6-luna`; that profile is outside the invocation policy. A
Mumbai console region alone does not select the India inference profile.
Console-read access and account/model inference entitlement are separate checks.

### Services

`compose.aws.yaml` runs the Bun API, the standalone Next.js frontend and Caddy on
one Linux host. Only Caddy publishes ports 80/443. It routes `/api/*` and
`/oauth/*` to the API, with response buffering disabled for chat SSE; other paths
go to Next.js. The frontend is built with an empty `NEXT_PUBLIC_API_BASE` so all
browser requests use the same origin. A named volume keeps CLI pantry files;
the other volumes retain Caddy certificates and configuration. Logs rotate.

The initial target is a **single EC2 staging host**, because sessions, rate limits,
OAuth pending flows and order idempotency currently live in process memory.
Running multiple API replicas would break that state. Restarts still discard it;
this packaging is not a claim of production readiness or durable order safety.
Complete the outstanding readiness review before a public cutover; see
`PRODUCTION_READINESS.md` for the existing production checklist.

## Prepare the host (not provisioned by this change)

1. Choose a supported Linux EC2 instance in Mumbai after checking your Free plan
   eligibility and estimating compute, EBS, public IPv4 and inference costs.
   Start with enough RAM for both running services (2 GiB minimum as a staging
   starting point); build images on a separate machine if the host cannot build
   Next.js comfortably. Do not assume the $120 credit covers every service/model.
2. Use an encrypted EBS volume, require IMDSv2, and set the metadata response hop
   limit to 2 when using Docker's bridge network so the API can obtain role
   credentials. Attach a dedicated EC2 instance profile, `CookmateRuntime`, with
   the EC2 trust policy in `ec2-trust-policy.json` and the model invocation policy
   in `bedrock-invoke-policy.template.json` (replace `<AWS_ACCOUNT_ID>` with your
   own account ID before attaching it). The runtime needs no IAM administration
   or other project's permissions. This is separate from `cookmate-developer`.
3. Install Docker Engine and the Docker Compose plugin. Use Systems Manager for
   administration if enabled with its required instance-role policy and network
   access. Otherwise, restrict SSH to your own IP. Allow inbound 80/443 for the
   site; never open 3000 or 8787 publicly. Only the reverse proxy may reach API
   ports because `TRUST_PROXY=true` trusts its forwarded client IP.
4. Point a staging domain at the host's stable public address. Verify its DNS
   before startup so Caddy can issue the HTTPS certificate.
5. Copy the repository to the host, without `.env`, credentials, `.aws`, local
   databases or development caches. Copy `.env.aws.example` to `.env.aws` on the
   host and restrict the file to the deploying OS user (`chmod 600 .env.aws`).
   Set `COOKMATE_DOMAIN` and `PUBLIC_ORIGIN` to the real staging domain and origin.
   Keep `COOKMATE_PROVIDER=mock` for staging validation.

On AWS, do **not** set `AWS_PROFILE` or inject the developer's keys. The API uses
temporary instance-role credentials. Compose explicitly clears `AWS_PROFILE`.
No secrets are baked into either image. The frontend never receives AWS or LLM
credentials. The Docker build contexts exclude `.env*` files.

## Build and start on the prepared host

Run from the repository root:

```sh
docker compose --env-file .env.aws -f compose.aws.yaml config --quiet
docker compose --env-file .env.aws -f compose.aws.yaml build
docker compose --env-file .env.aws -f compose.aws.yaml up -d
docker compose --env-file .env.aws -f compose.aws.yaml ps
```

`/api/health` must show `llm: "bedrock"`, `model: "in.openai.gpt-5.6-luna"` and
`fallback: false`. This endpoint only proves the API is running; it deliberately
does not call a paid model or prove Bedrock entitlement. A chat smoke test is
required separately. Verify text arrives incrementally through Caddy, reload the
page, inspect the demo cart, and verify no orders can bypass human confirmation.

For repeatable releases, build once, tag images with a Git commit, push to your
Cookmate registry, and deploy those image tags instead of rebuilding on the host.
Keep the previous images and volumes for rollback. Do not use `down -v` during
updates. Do not switch a live order/payment session between deployments.

## Before live Swiggy cutover

- Resolve the review's order pricing, idempotency, session authentication and
  login-before-model-spend findings, then run representative shopping evaluations
  against the selected Bedrock model. Connectivity alone does not prove model
  quality or safe ordering.
- Obtain Swiggy approval for the exact new HTTPS callback
  `https://<domain>/oauth/callback`. Compose sets this from `PUBLIC_ORIGIN`; pin
  the corresponding `SWIGGY_CLIENT_ID`. Per-user OAuth tokens remain server-side.
- Keep the existing Neon database during the initial host move if its deployment
  and data location remain suitable. Set `DATABASE_URL` privately. Do not assume
  the current Neon HTTP driver can talk to arbitrary RDS PostgreSQL; an RDS
  migration needs a separate driver and connection review.
- Keep the old Vercel/Render deployment available until the new site's auth,
  pricing, checkout, payment return, tracking and restart behavior are verified.
- Deployment permissions for `cookmate-developer` must be scoped to the chosen
  Cookmate resources and its runtime role. They have not been granted here.

## Validation completed during preparation

- Full `bun run check`: TypeScript, lint, formatting and all test suites passed.
  The Bedrock tests cover tool-result IDs/errors, token truncation, invalid and
  duplicate calls, interrupted streams, reasoning preservation, rollback,
  iteration limits and disabling direct-provider fallback.
- Both Linux Docker images built successfully, including the Next.js production
  build and typecheck. The API and web containers run as UID 1000.
- Compose configuration validated and all three services started locally without
  AWS credentials. Through Caddy, `/` and `/api/health` returned 200, session
  creation/status worked, and an incomplete OAuth callback returned the expected
  400. Temporary test containers and volumes were removed afterward.
- A real SDK streaming probe and an AWS CLI non-streaming probe both returned
  `ValidationException: Operation not allowed`. Live model responses, streaming
  over the full deployed path, shopping quality and AWS hosting remain unverified.

## References

- [AWS Converse and streaming examples](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/javascript_bedrock-runtime_code_examples.html)
- [Bedrock GPT-5.6 Luna capabilities](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-openai-gpt-56-luna.html)
- [Inference profile IAM requirements](https://docs.aws.amazon.com/bedrock/latest/userguide/inference-profiles-prereq.html)
- [AWS CLI browser sign-in](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sign-in.html)
- [Next.js standalone output](https://nextjs.org/docs/app/api-reference/config/next-config-js/output)
- [Swiggy OAuth configuration](https://mcp.swiggy.com/builders/docs/start/authenticate/)
