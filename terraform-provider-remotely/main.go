// Terraform provider for the Remotely control plane — manages users,
// roles, connections, and organizations as code against the same REST API
// the web app and CLI use, via terraform-plugin-framework.
package main

import (
	"context"
	"flag"
	"log"

	"github.com/hashicorp/terraform-plugin-framework/providerserver"

	"github.com/yogesht-ideyalabs/terraform-provider-remotely/internal/provider"
)

var version = "dev"

func main() {
	var debug bool
	flag.BoolVar(&debug, "debug", false, "run the provider with support for debuggers")
	flag.Parse()

	err := providerserver.Serve(context.Background(), provider.New(version), providerserver.ServeOpts{
		Address: "registry.terraform.io/yogesht-ideyalabs/remotely",
		Debug:   debug,
	})
	if err != nil {
		log.Fatal(err.Error())
	}
}
