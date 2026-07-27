package provider

import (
	"context"
	"fmt"

	"github.com/hashicorp/terraform-plugin-framework/path"
	"github.com/hashicorp/terraform-plugin-framework/resource"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/planmodifier"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/stringplanmodifier"
	"github.com/hashicorp/terraform-plugin-framework/types"
)

var _ resource.Resource = &OrganizationResource{}
var _ resource.ResourceWithImportState = &OrganizationResource{}

type OrganizationResource struct {
	client *Client
}

type OrganizationResourceModel struct {
	ID         types.String `tfsdk:"id"`
	Name       types.String `tfsdk:"name"`
	BrandName  types.String `tfsdk:"brand_name"`
	BrandColor types.String `tfsdk:"brand_color"`
}

func NewOrganizationResource() resource.Resource {
	return &OrganizationResource{}
}

func (r *OrganizationResource) Metadata(_ context.Context, req resource.MetadataRequest, resp *resource.MetadataResponse) {
	resp.TypeName = req.ProviderTypeName + "_organization"
}

func (r *OrganizationResource) Schema(_ context.Context, _ resource.SchemaRequest, resp *resource.SchemaResponse) {
	resp.Schema = schema.Schema{
		Description: "A tenant/organization — scopes delegated-admin management and (optionally) white-label branding.",
		Attributes: map[string]schema.Attribute{
			"id": schema.StringAttribute{
				Description: "Stable identifier, e.g. \"acme-corp\". Immutable after creation.",
				Required:    true,
				PlanModifiers: []planmodifier.String{
					stringplanmodifier.RequiresReplace(),
				},
			},
			"name": schema.StringAttribute{
				Description: "Display name.",
				Required:    true,
			},
			"brand_name": schema.StringAttribute{
				Description: "White-label wordmark shown in the topbar to this org's members. Empty = default branding.",
				Optional:    true,
				Computed:    true,
			},
			"brand_color": schema.StringAttribute{
				Description: "White-label accent color (hex).",
				Optional:    true,
				Computed:    true,
			},
		},
	}
}

func (r *OrganizationResource) Configure(_ context.Context, req resource.ConfigureRequest, resp *resource.ConfigureResponse) {
	if req.ProviderData == nil {
		return
	}
	client, ok := req.ProviderData.(*Client)
	if !ok {
		resp.Diagnostics.AddError("Unexpected provider data type", fmt.Sprintf("expected *Client, got %T", req.ProviderData))
		return
	}
	r.client = client
}

func (r *OrganizationResource) Create(ctx context.Context, req resource.CreateRequest, resp *resource.CreateResponse) {
	var plan OrganizationResourceModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	if resp.Diagnostics.HasError() {
		return
	}

	org, err := r.client.CreateOrganization(plan.ID.ValueString(), plan.Name.ValueString())
	if err != nil {
		resp.Diagnostics.AddError("Error creating organization", err.Error())
		return
	}

	changes := map[string]interface{}{}
	if !plan.BrandName.IsNull() && !plan.BrandName.IsUnknown() {
		changes["brandName"] = plan.BrandName.ValueString()
	}
	if !plan.BrandColor.IsNull() && !plan.BrandColor.IsUnknown() {
		changes["brandColor"] = plan.BrandColor.ValueString()
	}
	if len(changes) > 0 {
		org, err = r.client.UpdateOrganization(org.ID, changes)
		if err != nil {
			resp.Diagnostics.AddError("Error setting organization branding", err.Error())
			return
		}
	}

	resp.Diagnostics.Append(resp.State.Set(ctx, organizationToModel(org))...)
}

func (r *OrganizationResource) Read(ctx context.Context, req resource.ReadRequest, resp *resource.ReadResponse) {
	var state OrganizationResourceModel
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}

	org, err := r.client.GetOrganization(state.ID.ValueString())
	if err != nil {
		resp.Diagnostics.AddError("Error reading organization", err.Error())
		return
	}
	if org == nil {
		resp.State.RemoveResource(ctx)
		return
	}

	resp.Diagnostics.Append(resp.State.Set(ctx, organizationToModel(org))...)
}

func (r *OrganizationResource) Update(ctx context.Context, req resource.UpdateRequest, resp *resource.UpdateResponse) {
	var plan OrganizationResourceModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	if resp.Diagnostics.HasError() {
		return
	}

	changes := map[string]interface{}{
		"name":       plan.Name.ValueString(),
		"brandName":  plan.BrandName.ValueString(),
		"brandColor": plan.BrandColor.ValueString(),
	}
	org, err := r.client.UpdateOrganization(plan.ID.ValueString(), changes)
	if err != nil {
		resp.Diagnostics.AddError("Error updating organization", err.Error())
		return
	}

	resp.Diagnostics.Append(resp.State.Set(ctx, organizationToModel(org))...)
}

func (r *OrganizationResource) Delete(ctx context.Context, req resource.DeleteRequest, resp *resource.DeleteResponse) {
	var state OrganizationResourceModel
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}

	if err := r.client.DeleteOrganization(state.ID.ValueString()); err != nil {
		resp.Diagnostics.AddError("Error deleting organization", err.Error())
	}
}

func (r *OrganizationResource) ImportState(ctx context.Context, req resource.ImportStateRequest, resp *resource.ImportStateResponse) {
	resource.ImportStatePassthroughID(ctx, path.Root("id"), req, resp)
}

func organizationToModel(o *Organization) OrganizationResourceModel {
	return OrganizationResourceModel{
		ID:         types.StringValue(o.ID),
		Name:       types.StringValue(o.Name),
		BrandName:  types.StringValue(o.BrandName),
		BrandColor: types.StringValue(o.BrandColor),
	}
}
