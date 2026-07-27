# terraform-provider-remotely

A real Terraform provider for the Remotely control plane, built with [terraform-plugin-framework](https://github.com/hashicorp/terraform-plugin-framework) — manages users, roles, connections, and organizations as code against the same REST API the web app and CLI use.

Not published to the Terraform Registry (this is a POC) — build and use it locally via `dev_overrides`.

## Build

```bash
go build -o terraform-provider-remotely .
```

## Use locally (dev_overrides)

Add to `~/.terraformrc`:

```hcl
provider_installation {
  dev_overrides {
    "registry.terraform.io/yogesht-ideyalabs/remotely" = "/absolute/path/to/terraform-provider-remotely"
  }
  direct {}
}
```

Then in a `.tf` file:

```hcl
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
  # or: token = "<existing session token>"
}
```

With `dev_overrides` active, skip `terraform init` (it'll warn that the override provider isn't installed the normal way — that's expected) and go straight to `terraform plan`/`apply`.

## Resources

- `remotely_organization` — tenant/org, optional white-label branding
- `remotely_role` — the RBAC unit everything else is built on: allow/deny/manage label patterns, resource types, logins, session TTL, CIDRs, break-glass eligibility
- `remotely_user` — account + role assignment + tenant. Password is write-only (the API never returns it, so Terraform can't detect drift on it)
- `remotely_connection` — ssh-direct/rdp/database/kubernetes connections. `id` is server-generated, not settable

Not covered: ssh-agent (reverse-tunnel) resources, since those register themselves from the agent side rather than being admin-configured; session/audit/recording data, which isn't infrastructure-as-code shaped.

## Verified

`plan`/`apply`/idempotent re-`plan` (no changes)/`apply` an update/`destroy`/`import` all tested end-to-end against a real running control plane — see `examples/basic/`.
