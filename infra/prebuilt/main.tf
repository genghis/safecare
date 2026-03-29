terraform {
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
}

variable "project_id" {
  description = "GCP project ID"
  default     = "safecare-maps"
}

variable "region" {
  description = "GCP region"
  default     = "us-central1"
}

variable "zone" {
  description = "GCP zone for build VM"
  default     = "us-central1-a"
}

provider "google" {
  project = var.project_id
  region  = var.region
}

# ---------------------------------------------------------------------------
# Cloud Storage bucket for OSRM pre-built files
# ---------------------------------------------------------------------------

resource "google_storage_bucket" "osrm" {
  name     = "${var.project_id}-osrm"
  location = "US"

  uniform_bucket_level_access = true

  # Keep 2 versions (current + previous quarter)
  versioning {
    enabled = false
  }

  lifecycle_rule {
    condition {
      age = 180 # 6 months
    }
    action {
      type = "Delete"
    }
  }

  cors {
    origin          = ["*"]
    method          = ["GET", "HEAD"]
    response_header = ["Content-Type", "Content-Length", "Content-Range"]
    max_age_seconds = 86400
  }
}

# Public read access
resource "google_storage_bucket_iam_member" "public_read" {
  bucket = google_storage_bucket.osrm.name
  role   = "roles/storage.objectViewer"
  member = "allUsers"
}

# ---------------------------------------------------------------------------
# Service account for the build VM
# ---------------------------------------------------------------------------

resource "google_service_account" "builder" {
  account_id   = "osrm-builder"
  display_name = "OSRM Map Builder"
}

resource "google_project_iam_member" "builder_storage" {
  project = var.project_id
  role    = "roles/storage.objectAdmin"
  member  = "serviceAccount:${google_service_account.builder.email}"
}

resource "google_project_iam_member" "builder_compute" {
  project = var.project_id
  role    = "roles/compute.instanceAdmin.v1"
  member  = "serviceAccount:${google_service_account.builder.email}"
}

# ---------------------------------------------------------------------------
# Build VM — spot instance, self-terminates after build
# ---------------------------------------------------------------------------

resource "google_compute_instance" "builder" {
  name         = "osrm-builder"
  machine_type = "c2-standard-30" # 30 vCPUs, 120 GB RAM
  zone         = var.zone

  scheduling {
    preemptible                 = true
    automatic_restart           = false
    provisioning_model          = "SPOT"
    instance_termination_action = "STOP"
  }

  boot_disk {
    initialize_params {
      image = "projects/ubuntu-os-cloud/global/images/family/ubuntu-2204-lts"
      size  = 300 # GB SSD
      type  = "pd-ssd"
    }
  }

  network_interface {
    network = "default"
    access_config {}
  }

  service_account {
    email  = google_service_account.builder.email
    scopes = ["cloud-platform"]
  }

  metadata = {
    bucket     = google_storage_bucket.osrm.name
    startup-script = file("${path.module}/build-osrm.sh")
  }

  tags = ["osrm-builder"]

  # Start stopped — trigger manually or via scheduler
  desired_status = "TERMINATED"

  lifecycle {
    ignore_changes = [desired_status]
  }
}

# ---------------------------------------------------------------------------
# Outputs
# ---------------------------------------------------------------------------

output "bucket_name" {
  value = google_storage_bucket.osrm.name
}

output "bucket_url" {
  value = "https://storage.googleapis.com/${google_storage_bucket.osrm.name}"
}

output "manifest_url" {
  value = "https://storage.googleapis.com/${google_storage_bucket.osrm.name}/manifest.json"
}

output "start_build" {
  value = "gcloud compute instances start osrm-builder --zone=${var.zone} --project=${var.project_id}"
}

output "check_build_logs" {
  value = "gcloud compute ssh osrm-builder --zone=${var.zone} --project=${var.project_id} --command='tail -f /var/log/syslog'"
}
