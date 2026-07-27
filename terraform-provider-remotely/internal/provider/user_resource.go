package provider

import (
	"context"
	"fmt"

	"github.com/hashicorp/terraform-plugin-framework/diag"
	"github.com/hashicorp/terraform-plugin-framework/path"
	"github.com/hashicorp/terraform-plugin-framework/resource"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/planmodifier"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/stringplanmodifier"
	"github.com/hashicorp/terraform-plugin-framework/types"
)

var _ resource.Resource = &UserResource{}
var _ resource.ResourceWithImportState = &UserResource{}

type UserResource struct {
	client *Client
}

type UserResourceModel struct {
	Username types.String `tfsdk:"username"`
	Password types.String `tfsdk:"password"`
	Roles    types.List   `tfsdk:"roles"`
	Tenant   types.String `tfsdk:"tenant"`
}

func NewUserResource() resource.Resource {
	return &UserResource{}
}

func (r *UserResource) Metadata(_ context.Context, req resource.MetadataRequest, resp *resource.MetadataResponse) {
	resp.TypeName = req.ProviderTypeName + "_user"
}

func (r *UserResource) Schema(_ context.Context, _ resource.SchemaRequest, resp *resource.SchemaResponse) {
	resp.Schema = schema.Schema{
		Description: "A Remotely user account.",
		Attributes: map[string]schema.Attribute{
			"username": schema.StringAttribute{
				Required: true,
				PlanModifiers: []planmodifier.String{
					stringplanmodifier.RequiresReplace(),
				},
			},
			"password": schema.StringAttribute{
				Description: "The control plane never returns a user's password, so Terraform can't detect out-of-band changes to it — this attribute is write-only from Terraform's perspective. Required on create.",
				Required:    true,
				Sensitive:   true,
			},
			"roles": schema.ListAttribute{
				Optional:    true,
				Computed:    true,
				ElementType: types.StringType,
			},
			"tenant": schema.StringAttribute{
				Description: "Organization this user belongs to. Empty = no org (typically full-admin staff).",
				Optional:    true,
				Computed:    true,
			},
		},
	}
}

func (r *UserResource) Configure(_ context.Context, req resource.ConfigureRequest, resp *resource.ConfigureResponse) {
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

func (r *UserResource) Create(ctx context.Context, req resource.CreateRequest, resp *resource.CreateResponse) {
	var plan UserResourceModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	if resp.Diagnostics.HasError() {
		return
	}

	var roles []string
	resp.Diagnostics.Append(listElementsAsIfKnown(ctx, plan.Roles, &roles)...)
	if resp.Diagnostics.HasError() {
		return
	}

	user, err := r.client.CreateUser(plan.Username.ValueString(), plan.Password.ValueString(), roles, plan.Tenant.ValueString())
	if err != nil {
		resp.Diagnostics.AddError("Error creating user", err.Error())
		return
	}

	model, diags := userToModel(ctx, user, plan.Password)
	resp.Diagnostics.Append(diags...)
	resp.Diagnostics.Append(resp.State.Set(ctx, model)...)
}

func (r *UserResource) Read(ctx context.Context, req resource.ReadRequest, resp *resource.ReadResponse) {
	var state UserResourceModel
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}

	user, err := r.client.GetUser(state.Username.ValueString())
	if err != nil {
		resp.Diagnostics.AddError("Error reading user", err.Error())
		return
	}
	if user == nil {
		resp.State.RemoveResource(ctx)
		return
	}

	// Password is never returned by the API — keep whatever's already in
	// state instead of clobbering it with an empty value, since this isn't
	// actually a value the Read call can refresh.
	model, diags := userToModel(ctx, user, state.Password)
	resp.Diagnostics.Append(diags...)
	resp.Diagnostics.Append(resp.State.Set(ctx, model)...)
}

func (r *UserResource) Update(ctx context.Context, req resource.UpdateRequest, resp *resource.UpdateResponse) {
	var plan UserResourceModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	if resp.Diagnostics.HasError() {
		return
	}

	var roles []string
	resp.Diagnostics.Append(listElementsAsIfKnown(ctx, plan.Roles, &roles)...)
	if resp.Diagnostics.HasError() {
		return
	}

	changes := map[string]interface{}{
		"roles":  roles,
		"tenant": plan.Tenant.ValueString(),
	}
	if !plan.Password.IsNull() && !plan.Password.IsUnknown() {
		changes["password"] = plan.Password.ValueString()
	}

	user, err := r.client.UpdateUser(plan.Username.ValueString(), changes)
	if err != nil {
		resp.Diagnostics.AddError("Error updating user", err.Error())
		return
	}

	model, diags := userToModel(ctx, user, plan.Password)
	resp.Diagnostics.Append(diags...)
	resp.Diagnostics.Append(resp.State.Set(ctx, model)...)
}

func (r *UserResource) Delete(ctx context.Context, req resource.DeleteRequest, resp *resource.DeleteResponse) {
	var state UserResourceModel
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}

	if err := r.client.DeleteUser(state.Username.ValueString()); err != nil {
		resp.Diagnostics.AddError("Error deleting user", err.Error())
	}
}

func (r *UserResource) ImportState(ctx context.Context, req resource.ImportStateRequest, resp *resource.ImportStateResponse) {
	resource.ImportStatePassthroughID(ctx, path.Root("username"), req, resp)
}

func userToModel(ctx context.Context, u *User, password types.String) (UserResourceModel, diag.Diagnostics) {
	var diags diag.Diagnostics
	roles, d := types.ListValueFrom(ctx, types.StringType, u.Roles)
	diags.Append(d...)

	return UserResourceModel{
		Username: types.StringValue(u.Username),
		Password: password,
		Roles:    roles,
		Tenant:   types.StringValue(u.Tenant),
	}, diags
}
