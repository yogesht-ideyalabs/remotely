package provider

import (
	"context"
	"os"

	"github.com/hashicorp/terraform-plugin-framework/datasource"
	"github.com/hashicorp/terraform-plugin-framework/provider"
	"github.com/hashicorp/terraform-plugin-framework/provider/schema"
	"github.com/hashicorp/terraform-plugin-framework/resource"
	"github.com/hashicorp/terraform-plugin-framework/types"
)

var _ provider.Provider = &RemotelyProvider{}

type RemotelyProvider struct {
	version string
}

type RemotelyProviderModel struct {
	Endpoint types.String `tfsdk:"endpoint"`
	Username types.String `tfsdk:"username"`
	Password types.String `tfsdk:"password"`
	Token    types.String `tfsdk:"token"`
}

func New(version string) func() provider.Provider {
	return func() provider.Provider {
		return &RemotelyProvider{version: version}
	}
}

func (p *RemotelyProvider) Metadata(_ context.Context, _ provider.MetadataRequest, resp *provider.MetadataResponse) {
	resp.TypeName = "remotely"
	resp.Version = p.version
}

func (p *RemotelyProvider) Schema(_ context.Context, _ provider.SchemaRequest, resp *provider.SchemaResponse) {
	resp.Schema = schema.Schema{
		Description: "Manage a Remotely control plane's users, roles, connections, and organizations as code.",
		Attributes: map[string]schema.Attribute{
			"endpoint": schema.StringAttribute{
				Description: "Base URL of the Remotely control plane, e.g. http://localhost:4000. Can also be set via REMOTELY_ENDPOINT.",
				Optional:    true,
			},
			"username": schema.StringAttribute{
				Description: "Admin username for password-based login. Can also be set via REMOTELY_USERNAME. Ignored if `token` is set.",
				Optional:    true,
			},
			"password": schema.StringAttribute{
				Description: "Admin password for password-based login. Can also be set via REMOTELY_PASSWORD. Ignored if `token` is set.",
				Optional:    true,
				Sensitive:   true,
			},
			"token": schema.StringAttribute{
				Description: "An existing session token, as an alternative to username/password. Can also be set via REMOTELY_TOKEN.",
				Optional:    true,
				Sensitive:   true,
			},
		},
	}
}

func (p *RemotelyProvider) Configure(ctx context.Context, req provider.ConfigureRequest, resp *provider.ConfigureResponse) {
	var data RemotelyProviderModel
	resp.Diagnostics.Append(req.Config.Get(ctx, &data)...)
	if resp.Diagnostics.HasError() {
		return
	}

	endpoint := firstNonEmpty(data.Endpoint.ValueString(), os.Getenv("REMOTELY_ENDPOINT"))
	username := firstNonEmpty(data.Username.ValueString(), os.Getenv("REMOTELY_USERNAME"))
	password := firstNonEmpty(data.Password.ValueString(), os.Getenv("REMOTELY_PASSWORD"))
	token := firstNonEmpty(data.Token.ValueString(), os.Getenv("REMOTELY_TOKEN"))

	if endpoint == "" {
		resp.Diagnostics.AddError("Missing endpoint", "Set `endpoint` in the provider block or the REMOTELY_ENDPOINT environment variable.")
		return
	}
	if token == "" && (username == "" || password == "") {
		resp.Diagnostics.AddError("Missing credentials", "Set either `token`, or both `username` and `password` (directly or via REMOTELY_TOKEN / REMOTELY_USERNAME+REMOTELY_PASSWORD).")
		return
	}

	client, err := NewClient(endpoint, username, password, token)
	if err != nil {
		resp.Diagnostics.AddError("Unable to authenticate to Remotely", err.Error())
		return
	}

	resp.ResourceData = client
}

func (p *RemotelyProvider) Resources(_ context.Context) []func() resource.Resource {
	return []func() resource.Resource{
		NewRoleResource,
		NewOrganizationResource,
		NewUserResource,
		NewConnectionResource,
	}
}

func (p *RemotelyProvider) DataSources(_ context.Context) []func() datasource.DataSource {
	return nil
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}
