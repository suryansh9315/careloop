terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region              = var.region
  profile             = var.aws_profile
  allowed_account_ids = [var.target_account_id]

  assume_role {
    role_arn = "arn:aws:iam::${var.target_account_id}:role/${var.assume_role_name}"
  }
}

# ── Networking: use the account's default VPC + a public subnet ───────────────
data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}

# Latest Amazon Linux 2023 (x86_64) via the public SSM parameter.
data "aws_ssm_parameter" "al2023" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64"
}

# ── Security group: only 80 + 443 open (shell access is via SSM, no SSH) ──────
resource "aws_security_group" "bridge" {
  name        = var.name
  description = "CareLoop voice bridge: HTTP 80 and HTTPS WSS 443"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description = "HTTP Lets Encrypt HTTP-01 redirect"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  ingress {
    description = "HTTPS / WSS (Twilio media stream + dashboard API)"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# ── SSM SecureString holding the .env (value set out-of-band, not in TF state) ─
resource "aws_ssm_parameter" "env" {
  name        = var.env_param_name
  description = "CareLoop bridge .env (populate with: aws ssm put-parameter --overwrite ...)"
  type        = "SecureString"
  value       = "PLACEHOLDER — populate after apply"

  lifecycle {
    ignore_changes = [value] # real secrets are pushed via the CLI; keep them out of state
  }
}

# ── IAM: Session Manager access + read the env parameter ──────────────────────
resource "aws_iam_role" "bridge" {
  name = "${var.name}-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ssm_core" {
  role       = aws_iam_role.bridge.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_role_policy" "read_env" {
  name = "${var.name}-read-env"
  role = aws_iam_role.bridge.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["ssm:GetParameter"]
        Resource = aws_ssm_parameter.env.arn
      },
      {
        Effect   = "Allow"
        Action   = ["kms:Decrypt"]
        Resource = "*" # the AWS-managed alias/aws/ssm key used for the SecureString
      }
    ]
  })
}

resource "aws_iam_instance_profile" "bridge" {
  name = "${var.name}-profile"
  role = aws_iam_role.bridge.name
}

# ── The instance ──────────────────────────────────────────────────────────────
resource "aws_instance" "bridge" {
  ami                         = data.aws_ssm_parameter.al2023.value
  instance_type               = var.instance_type
  subnet_id                   = data.aws_subnets.default.ids[0]
  vpc_security_group_ids      = [aws_security_group.bridge.id]
  iam_instance_profile        = aws_iam_instance_profile.bridge.name
  associate_public_ip_address = true

  user_data = templatefile("${path.module}/user_data.sh.tftpl", {
    domain    = var.domain
    env_param = var.env_param_name
    git_repo  = var.git_repo
    region    = var.region
  })

  metadata_options {
    http_tokens = "required" # IMDSv2 only
  }

  tags = { Name = var.name }
}

# Stable public IP so the Cloudflare A record never has to change.
resource "aws_eip" "bridge" {
  instance = aws_instance.bridge.id
  domain   = "vpc"
  tags     = { Name = var.name }
}
