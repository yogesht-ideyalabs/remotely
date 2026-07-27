package provider

import (
	"context"

	"github.com/hashicorp/terraform-plugin-framework/diag"
	"github.com/hashicorp/terraform-plugin-framework/types"
)

// An Optional+Computed attribute the user didn't set in their config is
// "unknown" (not null) during Create's plan — Terraform doesn't know what
// the provider will compute it to until after Create runs. Calling
// ElementsAs on an unknown List/Map produces a Value Conversion Error
// diagnostic rather than silently no-op'ing, which is what a naive
// unconditional ElementsAs call assumes. Found this by actually running
// `terraform apply` against the live control plane, not by inspection —
// every attribute below that's Optional+Computed needs this guard.
func listElementsAsIfKnown(ctx context.Context, l types.List, target interface{}) diag.Diagnostics {
	if l.IsUnknown() || l.IsNull() {
		return nil
	}
	return l.ElementsAs(ctx, target, false)
}

func mapElementsAsIfKnown(ctx context.Context, m types.Map, target interface{}) diag.Diagnostics {
	if m.IsUnknown() || m.IsNull() {
		return nil
	}
	return m.ElementsAs(ctx, target, false)
}
