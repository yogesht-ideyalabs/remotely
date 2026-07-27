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

var _ resource.Resource = &ConnectionResource{}
var _ resource.ResourceWithImportState = &ConnectionResource{}

type ConnectionResource struct {
	client *Client
}

type ConnectionResourceModel struct {
	ID            types.String `tfsdk:"id"`
	Hostname      types.String `tfsdk:"hostname"`
	Type          types.String `tfsdk:"type"`
	Labels        types.Map    `tfsdk:"labels"`
	Folder        types.String `tfsdk:"folder"`
	Host          types.String `tfsdk:"host"`
	Port          types.Int64  `tfsdk:"port"`
	Username      types.String `tfsdk:"username"`
	Password      types.String `tfsdk:"password"`
	DatabaseName  types.String `tfsdk:"database_name"`
	AssignedUsers types.List   `tfsdk:"assigned_users"`
}

func NewConnectionResource() resource.Resource {
	return &ConnectionResource{}
}

func (r *ConnectionResource) Metadata(_ context.Context, req resource.MetadataRequest, resp *resource.MetadataResponse) {
	resp.TypeName = req.ProviderTypeName + "_connection"
}

func (r *ConnectionResource) Schema(_ context.Context, _ resource.SchemaRequest, resp *resource.SchemaResponse) {
	resp.Schema = schema.Schema{
		Description: "A directly-dialed connection (ssh-direct, rdp, database, or kubernetes). Reverse-tunnel ssh-agent resources aren't managed here — they register themselves.",
		Attributes: map[string]schema.Attribute{
			"id": schema.StringAttribute{
				Description: "Server-generated. Not settable.",
				Computed:    true,
				PlanModifiers: []planmodifier.String{
					stringplanmodifier.UseStateForUnknown(),
				},
			},
			"hostname": schema.StringAttribute{
				Description: "Display name.",
				Required:    true,
			},
			"type": schema.StringAttribute{
				Description: "One of: ssh-direct, rdp, database, kubernetes. Immutable after creation.",
				Required:    true,
				PlanModifiers: []planmodifier.String{
					stringplanmodifier.RequiresReplace(),
				},
			},
			"labels": schema.MapAttribute{
				Description: "Label key -> value, matched against role allow/deny/manage label patterns.",
				Optional:    true,
				Computed:    true,
				ElementType: types.StringType,
			},
			"folder": schema.StringAttribute{
				Optional: true,
				Computed: true,
			},
			"host": schema.StringAttribute{
				Description: "Target hostname/IP. Not used for kubernetes connections.",
				Optional:    true,
				Computed:    true,
			},
			"port": schema.Int64Attribute{
				Optional: true,
				Computed: true,
			},
			"username": schema.StringAttribute{
				Description: "Login username. For kubernetes connections this is conventionally \"exec\" (see the in-app Connections page).",
				Optional:    true,
				Computed:    true,
			},
			"password": schema.StringAttribute{
				Description: "Not returned by the API after being set (same as the in-app admin form) — Terraform can't detect out-of-band drift on this field.",
				Optional:    true,
				Sensitive:   true,
			},
			"database_name": schema.StringAttribute{
				Description: "database connections only.",
				Optional:    true,
				Computed:    true,
			},
			"assigned_users": schema.ListAttribute{
				Description: "Usernames directly granted access to this connection, independent of role matching.",
				Optional:    true,
				Computed:    true,
				ElementType: types.StringType,
			},
		},
	}
}

func (r *ConnectionResource) Configure(_ context.Context, req resource.ConfigureRequest, resp *resource.ConfigureResponse) {
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

func (r *ConnectionResource) Create(ctx context.Context, req resource.CreateRequest, resp *resource.CreateResponse) {
	var plan ConnectionResourceModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	if resp.Diagnostics.HasError() {
		return
	}

	conn, diags := modelToConnection(ctx, plan)
	resp.Diagnostics.Append(diags...)
	if resp.Diagnostics.HasError() {
		return
	}

	created, err := r.client.CreateConnection(conn)
	if err != nil {
		resp.Diagnostics.AddError("Error creating connection", err.Error())
		return
	}

	model, diags := connectionToModel(ctx, created, plan.Password)
	resp.Diagnostics.Append(diags...)
	resp.Diagnostics.Append(resp.State.Set(ctx, model)...)
}

func (r *ConnectionResource) Read(ctx context.Context, req resource.ReadRequest, resp *resource.ReadResponse) {
	var state ConnectionResourceModel
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}

	conn, err := r.client.GetConnection(state.ID.ValueString())
	if err != nil {
		resp.Diagnostics.AddError("Error reading connection", err.Error())
		return
	}
	if conn == nil {
		resp.State.RemoveResource(ctx)
		return
	}

	model, diags := connectionToModel(ctx, conn, state.Password)
	resp.Diagnostics.Append(diags...)
	resp.Diagnostics.Append(resp.State.Set(ctx, model)...)
}

func (r *ConnectionResource) Update(ctx context.Context, req resource.UpdateRequest, resp *resource.UpdateResponse) {
	var plan ConnectionResourceModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	if resp.Diagnostics.HasError() {
		return
	}

	conn, diags := modelToConnection(ctx, plan)
	resp.Diagnostics.Append(diags...)
	if resp.Diagnostics.HasError() {
		return
	}

	updated, err := r.client.UpdateConnection(plan.ID.ValueString(), conn)
	if err != nil {
		resp.Diagnostics.AddError("Error updating connection", err.Error())
		return
	}

	model, diags := connectionToModel(ctx, updated, plan.Password)
	resp.Diagnostics.Append(diags...)
	resp.Diagnostics.Append(resp.State.Set(ctx, model)...)
}

func (r *ConnectionResource) Delete(ctx context.Context, req resource.DeleteRequest, resp *resource.DeleteResponse) {
	var state ConnectionResourceModel
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}

	if err := r.client.DeleteConnection(state.ID.ValueString()); err != nil {
		resp.Diagnostics.AddError("Error deleting connection", err.Error())
	}
}

func (r *ConnectionResource) ImportState(ctx context.Context, req resource.ImportStateRequest, resp *resource.ImportStateResponse) {
	resource.ImportStatePassthroughID(ctx, path.Root("id"), req, resp)
}

func modelToConnection(ctx context.Context, m ConnectionResourceModel) (Connection, diag.Diagnostics) {
	var diags diag.Diagnostics
	conn := Connection{
		ID:           m.ID.ValueString(),
		Hostname:     m.Hostname.ValueString(),
		Type:         m.Type.ValueString(),
		Folder:       m.Folder.ValueString(),
		Host:         m.Host.ValueString(),
		Port:         int(m.Port.ValueInt64()),
		Username:     m.Username.ValueString(),
		Password:     m.Password.ValueString(),
		DatabaseName: m.DatabaseName.ValueString(),
	}

	diags.Append(mapElementsAsIfKnown(ctx, m.Labels, &conn.Labels)...)
	diags.Append(listElementsAsIfKnown(ctx, m.AssignedUsers, &conn.AssignedUsers)...)
	if conn.Labels == nil {
		conn.Labels = map[string]string{}
	}
	if conn.AssignedUsers == nil {
		conn.AssignedUsers = []string{}
	}

	return conn, diags
}

func connectionToModel(ctx context.Context, c *Connection, password types.String) (ConnectionResourceModel, diag.Diagnostics) {
	var diags diag.Diagnostics
	labels, d := types.MapValueFrom(ctx, types.StringType, c.Labels)
	diags.Append(d...)
	assignedUsers, d := types.ListValueFrom(ctx, types.StringType, c.AssignedUsers)
	diags.Append(d...)

	return ConnectionResourceModel{
		ID:            types.StringValue(c.ID),
		Hostname:      types.StringValue(c.Hostname),
		Type:          types.StringValue(c.Type),
		Labels:        labels,
		Folder:        types.StringValue(c.Folder),
		Host:          types.StringValue(c.Host),
		Port:          types.Int64Value(int64(c.Port)),
		Username:      types.StringValue(c.Username),
		Password:      password,
		DatabaseName:  types.StringValue(c.DatabaseName),
		AssignedUsers: assignedUsers,
	}, diags
}
