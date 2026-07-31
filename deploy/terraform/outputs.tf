output "public_ip" {
  description = "Elastic IP. Create a DNS-only (grey-cloud) A record in Cloudflare pointing to this IP."
  value       = aws_eip.bridge.public_ip
}

output "instance_id" {
  description = "EC2 instance ID used for AWS Systems Manager commands."
  value       = aws_instance.bridge.id
}

output "bridge_url" {
  description = "Public bridge URL once DNS + TLS are up."
  value       = "https://${var.domain}"
}

output "voice_webhook" {
  description = "Point your Twilio number's Voice webhook here (HTTP POST)."
  value       = "https://${var.domain}/voice"
}

output "env_param_name" {
  description = "Populate this SSM SecureString with your full .env before/after boot (see README)."
  value       = aws_ssm_parameter.env.name
}

output "ssm_session_command" {
  description = "Shell into the box without SSH."
  value       = "aws ssm start-session --region ${var.region} --target ${aws_instance.bridge.id}"
}
