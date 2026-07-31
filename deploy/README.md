# Deploy — voice bridge on EC2 (Terraform)

A single always-on EC2 instance in **us-east-1** running the CareLoop voice bridge,
with **Caddy** for automatic TLS + WebSocket proxying. us-east-1 co-locates the
bridge with Deepgram, Twilio's `us1` media edge, and Medplum for the lowest voice
latency. Shell access is via **SSM Session Manager** (no SSH key, no port 22).

```
Twilio ──WSS──▶ Caddy (auto-TLS) ──▶ node bridge :3000 ──▶ Deepgram / Medplum / Moss / Stedi / Groq
```

## Prerequisites
- Terraform ≥ 1.5, AWS CLI configured (`aws sts get-caller-identity` works).
- A domain whose DNS you control (Cloudflare). A real domain is required — Twilio
  needs a TLS `wss://` endpoint.
- Your app code in a git repo the box can clone (public, or a tokenized HTTPS URL
  for a private repo).

## 1. Configure
```bash
cd deploy/terraform
cp terraform.tfvars.example terraform.tfvars
# edit: domain, git_repo (region/instance_type are fine as defaults)
```

## 2. Provision
```bash
terraform init
terraform apply
```
Outputs include `public_ip`, `voice_webhook`, `env_param_name`, and an
`ssm_session_command`.

## 3. Push your .env into SSM
The instance reads its `.env` from an SSM SecureString on boot (kept out of
Terraform state). Use your existing project `.env`, but set:
- `PORT=3000`
- `PUBLIC_HOST=bridge.yourdomain.com`  ← so the TwiML emits `wss://bridge.yourdomain.com/twilio`
- `ORCH_MODE=prompt` and all the API keys (Deepgram, Twilio, Medplum, Moss, Stedi, Groq/LLM, SEED ids).

```bash
aws ssm put-parameter --overwrite --type SecureString \
  --name "/careloop/bridge-env" \
  --value "file://../../.env" --region us-east-1
```
> Do this **before** `apply` if you want the very first boot to have it; otherwise
> push it, then reboot the instance (or re-run the last bootstrap steps via SSM).

## 4. DNS (Cloudflare)
Add an **A record**: `bridge.yourdomain.com → <public_ip>`, **DNS only (grey cloud)**.
Grey-cloud matters: it lets Caddy issue the Let's Encrypt cert (HTTP-01 on :80) and
avoids an extra proxy hop on the audio path. Caddy auto-provisions TLS within ~30s
of DNS propagating.

## 5. Point Twilio at it
- Your number's **Voice webhook** → `https://bridge.yourdomain.com/voice` (HTTP POST).
- Set the Twilio **media region to `us1`** so the media stream originates in us-east.

## 6. Verify
```bash
curl https://bridge.yourdomain.com/            # "CareLoop bridge up. ORCH_MODE=prompt…"
curl https://bridge.yourdomain.com/conditions  # JSON treatment catalog
```
Then place a test call from the dashboard / Twilio.

## Operate
- **Shell in (no SSH):** `aws ssm start-session --target <id> --region us-east-1`
- **Logs:** `sudo journalctl -u careloop-bridge -f` · `sudo journalctl -u caddy -f`
- **Redeploy new code:** SSM in, then
  ```bash
  cd /opt/careloop && sudo git pull && sudo npm ci && sudo npm run build \
    && sudo systemctl restart careloop-bridge
  ```
  (or bake an AMI / use a CI step). Terraform provisions the box; app versions are
  pulled on the box.
- **Change env:** update the SSM parameter, re-pull it, restart:
  ```bash
  aws ssm get-parameter --name /careloop/bridge-env --with-decryption \
    --query Parameter.Value --output text | sudo tee /opt/careloop/.env >/dev/null
  sudo systemctl restart careloop-bridge
  ```

## Dashboard (separate, static)
The clinician dashboard is a static Vite build — host it on **S3 + CloudFront**:
```bash
cd dashboard
VITE_BRIDGE_URL=https://bridge.yourdomain.com npm run build
aws s3 sync dist/ s3://<your-bucket> --delete
# CloudFront distribution (OAC → bucket), then invalidate on each deploy.
```

## Scaling later
Each call is one WebSocket pinned to this box (in-memory session), so scale **out**
(more instances behind an NLB/ALB), not up. When you want zero-patching + auto-heal,
the same image moves to **App Runner** or **ECS Fargate** with no app changes.

## Teardown
```bash
terraform destroy
```
