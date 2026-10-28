packer {
  required_plugins {
    hcloud = {
      source  = "github.com/hetznercloud/hcloud"
      version = ">= 1.6.0"
    }
  }
}

variable "location" {
  type = string
}

variable "server_type" {
  type = string
}

variable "snapshot_name" {
  type = string
}

variable "snapshot_labels" {
  type = map(string)
}

variable "stax_build_target" {
  type    = string
  default = "hetzner"
}

variable "stax_stack_id" {
  type = string
}

variable "stax_env" {
  type = string
}

variable "stax_git_sha" {
  type = string
}

variable "stax_image_version" {
  type = string
}

source "hcloud" "personal_assistant" {
  location        = var.location
  server_type     = var.server_type
  image           = "ubuntu-24.04"
  ssh_username    = "root"
  snapshot_name   = var.snapshot_name
  snapshot_labels = var.snapshot_labels
}

build {
  sources = ["source.hcloud.personal_assistant"]

  provisioner "shell" {
    inline = ["echo personal-assistant golden image"]
  }

  post-processor "manifest" {
    output     = "manifest.json"
    strip_path = true
  }
}
