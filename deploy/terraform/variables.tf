variable "region" {
  description = "AWS region — keep in us-east-1 to co-locate with Deepgram, Twilio media (us1), and Medplum for lowest voice latency."
  type        = string
  default     = "us-east-1"
}

variable "aws_profile" {
  description = "Local AWS CLI profile used to authenticate before Terraform assumes the deployment role."
  type        = string
}

variable "target_account_id" {
  description = "AWS account ID that Terraform is permitted to deploy into."
  type        = string

  validation {
    condition     = can(regex("^[0-9]{12}$", var.target_account_id))
    error_message = "target_account_id must be a 12-digit AWS account ID."
  }
}

variable "assume_role_name" {
  description = "IAM role name Terraform assumes in the target account."
  type        = string
}

variable "instance_type" {
  description = "EC2 instance type (x86_64). t3.small is plenty for the audio relay; bump for many concurrent calls."
  type        = string
  default     = "t3.small"
}

variable "domain" {
  description = "Public hostname for the bridge, e.g. bridge.yourdomain.com. Add a DNS-only (grey-cloud) A record in Cloudflare → the EIP output."
  type        = string
}

variable "git_repo" {
  description = "Git URL the instance clones on boot. For a private repo use a tokenized URL (https://<TOKEN>@github.com/you/repo.git)."
  type        = string
}

variable "env_param_name" {
  description = "SSM SecureString parameter that holds the full .env contents. Populate it after apply (see README)."
  type        = string
  default     = "/careloop/bridge-env"
}

variable "name" {
  description = "Name prefix for resources."
  type        = string
  default     = "careloop-bridge"
}
