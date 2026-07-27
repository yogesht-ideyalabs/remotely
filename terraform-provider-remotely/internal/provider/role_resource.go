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

var _ resource.Resource = &RoleResource{}
var _ resource.ResourceWithImportState = &RoleResource{}

type RoleResource struct {
	client *Client
}

type RoleResourceModel struct {
	Name                 types.String `tfsdk:"name"`
	Description          types.String `tfsdk:"description"`
	Category             types.String `tfsdk:"category"`
	AllowLabels          types.Map    `tfsdk:"allow_labels"`
	DenyLabels           types.Map    `tfsdk:"deny_labels"`
	ResourceTypes        types.List   `tfsdk:"resource_types"`
	Logins               types.List   `tfsdk:"logins"`
	MaxSessionTTLMinutes types.Int64  `tfsdk:"max_session_ttl_minutes"`
	AllowedCIDRs         types.List   `tfsdk:"allowed_cidrs"`
	ManageLabels         types.Map    `tfsdk:"manage_labels"`
	AllowClipboard       types.Bool   `tfsdk:"allow_clipboard"`
	BreakGlassEligible   types.Bool   `tfsdk:"break_glass_eligible"`
}

func NewRoleResource() resource.Resource {
	return &RoleResource{}
}

func (r *RoleResource) Metadata(_ context.Context, req resource.MetadataRequest, resp *resource.MetadataResponse) {
	resp.TypeName = req.ProviderTypeName + "_role"
}

func (r *RoleResource) Schema(_ context.Context, _ resource.SchemaRequest, resp *resource.SchemaResponse) {
	resp.Schema = schema.Schema{
		Description: "An RBAC role — the unit of access control this whole system is built on. See the in-app Roles page for the same field explanations shown there.",
		Attributes: map[string]schema.Attribute{
			"name": schema.StringAttribute{
				Description: "Unique identifier. Immutable after creation.",
				Required:    true,
				PlanModifiers: []planmodifier.String{
					stringplanmodifier.RequiresReplace(),
				},
			},
			"description": schema.StringAttribute{
				Optional: true,
				Computed: true,
			},
			"category": schema.StringAttribute{
				Description: "Purely organizational grouping on the Roles page — has no effect on access.",
				Optional:    true,
				Computed:    true,
			},
			"allow_labels": schema.MapAttribute{
				Description: "Label key -> list of allowed values. A resource is visible only if every listed key matches one of its values. Empty/omitted = match every resource (a wildcard).",
				Optional:    true,
				Computed:    true,
				ElementType: types.ListType{ElemType: types.StringType},
			},
			"deny_labels": schema.MapAttribute{
				Description: "Same shape as allow_labels. Always wins over allow, even a wildcard allow.",
				Optional:    true,
				Computed:    true,
				ElementType: types.ListType{ElemType: types.StringType},
			},
			"resource_types": schema.ListAttribute{
				Description: "Restricts which resource types this role can reach: ssh-agent, ssh-direct, rdp, database, kubernetes. Empty = all types.",
				Optional:    true,
				Computed:    true,
				ElementType: types.StringType,
			},
			"logins": schema.ListAttribute{
				Description: "Allowed connection logins (OS/DB usernames, or \"exec\" for kubernetes connections).",
				Optional:    true,
				Computed:    true,
				ElementType: types.StringType,
			},
			"max_session_ttl_minutes": schema.Int64Attribute{
				Description: "Maximum session duration in minutes. 0 = unlimited.",
				Optional:    true,
				Computed:    true,
			},
			"allowed_cidrs": schema.ListAttribute{
				Description: "Source IP CIDRs this role's access is restricted to. Empty = unrestricted.",
				Optional:    true,
				Computed:    true,
				ElementType: types.StringType,
			},
			"manage_labels": schema.MapAttribute{
				Description: "Same shape as allow_labels. Non-empty turns this into a delegated-admin role: holders can manage users/connections matching this pattern. Leave empty for a plain access role.",
				Optional:    true,
				Computed:    true,
				ElementType: types.ListType{ElemType: types.StringType},
			},
			"allow_clipboard": schema.BoolAttribute{
				Description: "RDP sessions only — unchecked blocks copy/paste in both directions.",
				Optional:    true,
				Computed:    true,
			},
			"break_glass_eligible": schema.BoolAttribute{
				Description: "Lets a holder self-approve an access request marked break-glass instead of waiting for admin approval.",
				Optional:    true,
				Computed:    true,
			},
		},
	}
}

func (r *RoleResource) Configure(_ context.Context, req resource.ConfigureRequest, resp *resource.ConfigureResponse) {
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

func (r *RoleResource) Create(ctx context.Context, req resource.CreateRequest, resp *resource.CreateResponse) {
	var plan RoleResourceModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	if resp.Diagnostics.HasError() {
		return
	}

	role, diags := modelToRole(ctx, plan)
	resp.Diagnostics.Append(diags...)
	if resp.Diagnostics.HasError() {
		return
	}

	created, err := r.client.CreateRole(role)
	if err != nil {
		resp.Diagnostics.AddError("Error creating role", err.Error())
		return
	}

	model, diags := roleToModel(ctx, created)
	resp.Diagnostics.Append(diags...)
	resp.Diagnostics.Append(resp.State.Set(ctx, model)...)
}

func (r *RoleResource) Read(ctx context.Context, req resource.ReadRequest, resp *resource.ReadResponse) {
	var state RoleResourceModel
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}

	role, err := r.client.GetRole(state.Name.ValueString())
	if err != nil {
		resp.Diagnostics.AddError("Error reading role", err.Error())
		return
	}
	if role == nil {
		resp.State.RemoveResource(ctx)
		return
	}

	model, diags := roleToModel(ctx, role)
	resp.Diagnostics.Append(diags...)
	resp.Diagnostics.Append(resp.State.Set(ctx, model)...)
}

func (r *RoleResource) Update(ctx context.Context, req resource.UpdateRequest, resp *resource.UpdateResponse) {
	var plan RoleResourceModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	if resp.Diagnostics.HasError() {
		return
	}

	role, diags := modelToRole(ctx, plan)
	resp.Diagnostics.Append(diags...)
	if resp.Diagnostics.HasError() {
		return
	}

	updated, err := r.client.UpdateRole(plan.Name.ValueString(), role)
	if err != nil {
		resp.Diagnostics.AddError("Error updating role", err.Error())
		return
	}

	model, diags := roleToModel(ctx, updated)
	resp.Diagnostics.Append(diags...)
	resp.Diagnostics.Append(resp.State.Set(ctx, model)...)
}

func (r *RoleResource) Delete(ctx context.Context, req resource.DeleteRequest, resp *resource.DeleteResponse) {
	var state RoleResourceModel
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}

	if err := r.client.DeleteRole(state.Name.ValueString()); err != nil {
		resp.Diagnostics.AddError("Error deleting role", err.Error())
	}
}

func (r *RoleResource) ImportState(ctx context.Context, req resource.ImportStateRequest, resp *resource.ImportStateResponse) {
	resource.ImportStatePassthroughID(ctx, path.Root("name"), req, resp)
}

func modelToRole(ctx context.Context, m RoleResourceModel) (Role, diag.Diagnostics) {
	var diags diag.Diagnostics
	role := Role{
		Name:                 m.Name.ValueString(),
		Description:          m.Description.ValueString(),
		Category:             m.Category.ValueString(),
		MaxSessionTTLMinutes: int(m.MaxSessionTTLMinutes.ValueInt64()),
		AllowClipboard:       m.AllowClipboard.ValueBool(),
		BreakGlassEligible:   m.BreakGlassEligible.ValueBool(),
	}

	diags.Append(mapElementsAsIfKnown(ctx, m.AllowLabels, &role.AllowLabels)...)
	diags.Append(mapElementsAsIfKnown(ctx, m.DenyLabels, &role.DenyLabels)...)
	diags.Append(mapElementsAsIfKnown(ctx, m.ManageLabels, &role.ManageLabels)...)
	diags.Append(listElementsAsIfKnown(ctx, m.ResourceTypes, &role.ResourceTypes)...)
	diags.Append(listElementsAsIfKnown(ctx, m.Logins, &role.Logins)...)
	diags.Append(listElementsAsIfKnown(ctx, m.AllowedCIDRs, &role.AllowedCIDRs)...)

	if role.AllowLabels == nil {
		role.AllowLabels = map[string][]string{}
	}
	if role.DenyLabels == nil {
		role.DenyLabels = map[string][]string{}
	}
	if role.ManageLabels == nil {
		role.ManageLabels = map[string][]string{}
	}
	if role.ResourceTypes == nil {
		role.ResourceTypes = []string{}
	}
	if role.Logins == nil {
		role.Logins = []string{}
	}
	if role.AllowedCIDRs == nil {
		role.AllowedCIDRs = []string{}
	}

	return role, diags
}

func roleToModel(ctx context.Context, role *Role) (RoleResourceModel, diag.Diagnostics) {
	var diags diag.Diagnostics
	labelType := types.ListType{ElemType: types.StringType}

	allowLabels, d := types.MapValueFrom(ctx, labelType, role.AllowLabels)
	diags.Append(d...)
	denyLabels, d := types.MapValueFrom(ctx, labelType, role.DenyLabels)
	diags.Append(d...)
	manageLabels, d := types.MapValueFrom(ctx, labelType, role.ManageLabels)
	diags.Append(d...)
	resourceTypes, d := types.ListValueFrom(ctx, types.StringType, role.ResourceTypes)
	diags.Append(d...)
	logins, d := types.ListValueFrom(ctx, types.StringType, role.Logins)
	diags.Append(d...)
	allowedCIDRs, d := types.ListValueFrom(ctx, types.StringType, role.AllowedCIDRs)
	diags.Append(d...)

	return RoleResourceModel{
		Name:                 types.StringValue(role.Name),
		Description:          types.StringValue(role.Description),
		Category:             types.StringValue(role.Category),
		AllowLabels:          allowLabels,
		DenyLabels:           denyLabels,
		ResourceTypes:        resourceTypes,
		Logins:               logins,
		MaxSessionTTLMinutes: types.Int64Value(int64(role.MaxSessionTTLMinutes)),
		AllowedCIDRs:         allowedCIDRs,
		ManageLabels:         manageLabels,
		AllowClipboard:       types.BoolValue(role.AllowClipboard),
		BreakGlassEligible:   types.BoolValue(role.BreakGlassEligible),
	}, diags
}
