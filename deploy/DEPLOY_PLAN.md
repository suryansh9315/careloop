# CareLoop bridge deployment plan

## Architecture and scope

This Terraform stack deploys the voice bridge into AWS account `006215409341` in
`us-east-1`. The AWS provider uses the local profile `2care-admin-mgmt`, assumes
`OrganizationAccountAccessRole` in that target account, and has an
`allowed_account_ids` guard so Terraform refuses a different account.

The configured public hostname is `bridge.2careaihealth.com`, using the root
domain hosted at Hostinger.

The resulting path is:

```text
Twilio HTTPS/WSS -> Elastic IP -> Caddy :80/:443 -> Node bridge :3000
                                      |
                                      +-> SSM Session Manager (no SSH/port 22)
```

Terraform creates one EC2 `t3.small` instance using the default VPC's first
subnet, an Elastic IP, a security group allowing only TCP 80 and 443, an EC2
instance role for SSM and reading the SSM parameter, and a SecureString named
`/careloop/bridge-env`. The instance bootstrap clones the configured repository,
runs `npm ci` and `npm run build`, and runs the compiled bridge under systemd.

This is suitable for a hackathon or single-instance deployment. It is not highly
available: the bridge keeps call/session state in memory, and the default VPC,
subnet, DNS, and a public Git clone are prerequisites.

## Prerequisites

- The AWS CLI profile `2care-admin-mgmt` exists and can assume
  `arn:aws:iam::006215409341:role/OrganizationAccountAccessRole`.
- Terraform >= 1.5 is installed.
- The AWS Session Manager plugin is installed locally for interactive SSM
  sessions. AWS CLI `send-command` does not require this plugin.
- The project is pushed to a Git repository reachable by the EC2 instance.
- A real DNS name is available; create an A record in the authoritative Hostinger
  DNS zone.
- `terraform.tfvars` contains the real `domain` and `git_repo` values. Do not
  commit this file if the repository URL contains a token.
- The application's `.env` contains `PORT=3000`,
  `PUBLIC_HOST=<your domain>`, `ORCH_MODE=prompt`, and the required API keys.

Before Terraform, verify the base profile and role access:

```bash
aws sts get-caller-identity --profile 2care-admin-mgmt
aws sts assume-role \
  --profile 2care-admin-mgmt \
  --role-arn arn:aws:iam::006215409341:role/OrganizationAccountAccessRole \
  --role-session-name careloop-deploy >/dev/null
```

## Provision

```bash
cd deploy/terraform
terraform init
terraform fmt
terraform validate
terraform plan -out=careloop.tfplan
terraform apply careloop.tfplan
```

The plan should show `8 to add` (unless the state already contains resources),
with no changes outside account `006215409341`. Terraform outputs the public IP,
instance ID, SSM parameter name, bridge URL, and Twilio webhook URL.

If an instance was already created with a failed cloud-init bootstrap, first
apply the corrected bootstrap by replacing that instance:

```bash
terraform plan -replace=aws_instance.bridge -out=careloop-repair.tfplan
terraform apply careloop-repair.tfplan
```

This causes a short interruption while the EC2 instance is recreated. The
Elastic IP and SSM parameter remain Terraform-managed and are reattached to the
replacement instance.

## Configure the application secret

The SSM parameter is created with a placeholder during `apply`; upload the real
file after the parameter exists. Use credentials that target account
`006215409341` (a dedicated AWS CLI role profile is recommended).

```bash
export AWS_PROFILE=careloop-target
aws sts get-caller-identity
aws ssm put-parameter \
  --overwrite \
  --type SecureString \
  --name /careloop/bridge-env \
  --value file://../../.env \
  --region us-east-1
```

If `careloop-target` does not exist, create it as a role profile that uses
`2care-admin-mgmt` as its source profile and assumes
`OrganizationAccountAccessRole` in account `006215409341`:

```bash
aws configure set profile.careloop-target.role_arn \
  arn:aws:iam::006215409341:role/OrganizationAccountAccessRole
aws configure set profile.careloop-target.source_profile 2care-admin-mgmt
aws configure set profile.careloop-target.region us-east-1
export AWS_PROFILE=careloop-target
aws sts get-caller-identity
```

The final command must report account `006215409341` before you upload the
parameter. If the role assumption fails, the source profile needs
`sts:AssumeRole` permission and the target role must trust that source identity.

Reload the value on the instance and restart the bridge:

```bash
INSTANCE_ID=$(terraform output -raw instance_id)
aws ssm send-command \
  --region us-east-1 \
  --document-name AWS-RunShellScript \
  --targets "Key=InstanceIds,Values=${INSTANCE_ID}" \
  --parameters 'commands=["aws ssm get-parameter --name /careloop/bridge-env --with-decryption --region us-east-1 --query Parameter.Value --output text > /opt/careloop/.env", "systemctl restart careloop-bridge"]'
```

Check the command result and logs if the service does not come up:

```bash
aws ssm start-session --target "$INSTANCE_ID" --region us-east-1
sudo systemctl status careloop-bridge caddy
sudo journalctl -u careloop-bridge -n 100 --no-pager
sudo journalctl -u caddy -n 100 --no-pager
```

## DNS and Twilio

After apply, create this Hostinger DNS record:

```text
Type: A
Host: bridge
Points to: terraform output -raw public_ip
```

Wait for DNS to resolve and for Caddy to obtain its Let's Encrypt certificate.
Then configure Twilio:

```text
Voice webhook: https://<your domain>/voice
Method: POST
Media region: us1
```

Verify the bridge:

```bash
curl -i "https://<your domain>/"
curl -i "https://<your domain>/conditions"
```

For dashboard-triggered outbound calls, add these secrets to the root `.env`
before uploading it to SSM:

```text
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_PHONE_NUMBER=+1...
```

In the Twilio Console, purchase or select a Voice-capable number. Under the
number's **Voice Configuration**, set **A call comes in** to the same
`https://<your domain>/voice` URL using `HTTP POST`. Trial accounts can call
only verified destination numbers.

## Dashboard (separate, static)

Use Vercel so every Git push can automatically create a deployment. Import the
repository in Vercel and set:

```text
Root directory: dashboard
Framework: Vite
Build command: npm run build
Output directory: dist
```

Add these Production environment variables in Vercel:

```text
VITE_MEDPLUM_BASE_URL=https://api.medplum.com/
VITE_MEDPLUM_CLIENT_ID=<your Medplum client ID>
VITE_MEDPLUM_PROJECT_ID=<your Medplum project ID>
VITE_PATIENT_ID=<your patient ID>
VITE_BRIDGE_URL=https://bridge.2careaihealth.com
```

Add the custom domain `app.2careaihealth.com` in Vercel. Vercel will show the
exact DNS record to add in Hostinger. The dashboard requires a Medplum user
login; never put passwords, auth tokens, or API secrets in frontend variables
because Vite compiles `VITE_*` values into browser JavaScript.

For an AWS-native alternative, host the same `dist/` contents on S3 + CloudFront:

```bash
cd dashboard
VITE_BRIDGE_URL=https://bridge.2careaihealth.com npm run build
aws s3 sync dist/ s3://<your-bucket> --delete
```

## Redeploy and operate

For an interactive `aws ssm start-session` shell on an Apple Silicon Mac, install
the official Session Manager plugin once:

```bash
curl "https://s3.amazonaws.com/session-manager-downloads/plugin/latest/mac_arm64/session-manager-plugin.pkg" \
  -o /tmp/session-manager-plugin.pkg
sudo installer -pkg /tmp/session-manager-plugin.pkg -target /
sudo mkdir -p /usr/local/bin
sudo ln -sf /usr/local/sessionmanagerplugin/bin/session-manager-plugin \
  /usr/local/bin/session-manager-plugin
session-manager-plugin --version
```

Then start a shell with `aws ssm start-session`. The official AWS installation
instructions are available [here](https://docs.aws.amazon.com/systems-manager/latest/userguide/install-plugin-macos-overview.html).

For a code redeploy, push the new commit and run:

```bash
aws ssm send-command \
  --region us-east-1 \
  --document-name AWS-RunShellScript \
  --targets "Key=InstanceIds,Values=${INSTANCE_ID}" \
  --parameters 'commands=["cd /opt/careloop && git pull && npm ci && npm run build && systemctl restart careloop-bridge"]'
```

For an environment change, update the SSM parameter, repeat the reload command,
and restart the service. For teardown, review the resources and run
`terraform destroy`; this releases the Elastic IP and removes the instance,
security group, IAM resources, and SSM parameter managed by this stack.

## Known limitations

- The current bootstrap clones the repository over HTTPS. A private repository
  requires a safer access mechanism than committing a token in `git_repo`.
- The first boot may start with the placeholder environment until the SSM reload
  command above is run.
- Caddy requires DNS to point at the Elastic IP and ports 80/443 to be reachable
  before it can complete HTTP-01 certificate issuance.
- The dashboard is not created by this Terraform stack; build and host it
  separately on S3/CloudFront or another static host.
- The Moss SDK uses an optional native binding. The bridge lazy-loads it and
  falls back to the built-in corpus if the host cannot load the binding. Live
  Moss on Amazon Linux may require moving the workload to an image with glibc
  2.38 or newer.
