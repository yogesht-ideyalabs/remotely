terraform {
  required_providers {
    remotely = {
      source = "yogesht-ideyalabs/remotely"
    }
  }
}

provider "remotely" {
  endpoint = "http://localhost:4000"
  username = "admin"
  password = "admin123"
}

resource "remotely_organization" "tf_test" {
  id         = "tf-test-org"
  name       = "Terraform Test Org"
  brand_color = "#5b8cff"
}

resource "remotely_role" "tf_test" {
  name                    = "tf-test-role"
  description             = "Created by the Terraform provider, end-to-end test"
  category                = "Terraform"
  resource_types          = ["ssh-direct"]
  logins                  = ["demo"]
  max_session_ttl_minutes = 90
  allow_labels = {
    client = ["tf-test-org"]
  }
}

resource "remotely_user" "tf_test" {
  username = "tf-test-user"
  password = "tf-test-password-123"
  roles    = [remotely_role.tf_test.name]
  tenant   = remotely_organization.tf_test.id
}

resource "remotely_connection" "tf_test" {
  hostname = "tf-test-bastion"
  type     = "ssh-direct"
  host     = "localhost"
  port     = 2222
  username = "demo"
  password = "demo1234"
  folder   = "Terraform"
  labels = {
    client = "tf-test-org"
  }
}

output "role_name" {
  value = remotely_role.tf_test.name
}

output "connection_id" {
  value = remotely_connection.tf_test.id
}
