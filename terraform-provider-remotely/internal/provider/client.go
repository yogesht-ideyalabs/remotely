package provider

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// Client for the Remotely control-plane REST API. Same API surface as
// sdk/ (the TypeScript client) — kept in sync by hand against that package
// and control-plane/src/store.ts, since there's no shared schema between
// the three.
type Client struct {
	BaseURL    string
	Token      string
	HTTPClient *http.Client
}

// APIError mirrors sdk's RemotelyApiError — carries the HTTP status and
// the raw error body, not just a flattened message.
type APIError struct {
	Status int
	Body   map[string]interface{}
}

func (e *APIError) Error() string {
	if msg, ok := e.Body["error"].(string); ok {
		return fmt.Sprintf("remotely api error (%d): %s", e.Status, msg)
	}
	return fmt.Sprintf("remotely api error (%d)", e.Status)
}

func NewClient(baseURL, username, password, token string) (*Client, error) {
	c := &Client{
		BaseURL:    strings.TrimRight(baseURL, "/"),
		HTTPClient: &http.Client{},
	}
	if token != "" {
		c.Token = token
		return c, nil
	}
	var session struct {
		Token string `json:"token"`
	}
	if err := c.request("POST", "/api/login", map[string]string{"username": username, "password": password}, &session); err != nil {
		return nil, fmt.Errorf("login failed: %w", err)
	}
	c.Token = session.Token
	return c, nil
}

func (c *Client) request(method, path string, body interface{}, out interface{}) error {
	var reqBody io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reqBody = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, c.BaseURL+path, reqBody)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	if c.Token != "" {
		req.Header.Set("Authorization", "Bearer "+c.Token)
	}
	res, err := c.HTTPClient.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()

	respBytes, err := io.ReadAll(res.Body)
	if err != nil {
		return err
	}

	if res.StatusCode >= 300 {
		var errBody map[string]interface{}
		_ = json.Unmarshal(respBytes, &errBody)
		return &APIError{Status: res.StatusCode, Body: errBody}
	}
	if res.StatusCode == 204 || len(respBytes) == 0 {
		return nil
	}
	if out != nil {
		return json.Unmarshal(respBytes, out)
	}
	return nil
}

// ---------- roles ----------

type Role struct {
	Name                 string              `json:"name"`
	Description          string              `json:"description"`
	Category             string              `json:"category"`
	AllowLabels          map[string][]string `json:"allowLabels"`
	DenyLabels           map[string][]string `json:"denyLabels"`
	ResourceTypes        []string            `json:"resourceTypes"`
	Logins               []string            `json:"logins"`
	MaxSessionTTLMinutes int                 `json:"maxSessionTTLMinutes"`
	AllowedCIDRs         []string            `json:"allowedCIDRs"`
	ExpiresAt            *string             `json:"expiresAt"`
	ManageLabels         map[string][]string `json:"manageLabels"`
	AllowClipboard       bool                `json:"allowClipboard"`
	BreakGlassEligible   bool                `json:"breakGlassEligible"`
}

func (c *Client) CreateRole(r Role) (*Role, error) {
	var out Role
	if err := c.request("POST", "/api/admin/roles", r, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) GetRole(name string) (*Role, error) {
	var roles []Role
	if err := c.request("GET", "/api/admin/roles", nil, &roles); err != nil {
		return nil, err
	}
	for _, r := range roles {
		if r.Name == name {
			return &r, nil
		}
	}
	return nil, nil
}

func (c *Client) UpdateRole(name string, r Role) (*Role, error) {
	var out Role
	if err := c.request("PATCH", "/api/admin/roles/"+urlEscape(name), r, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) DeleteRole(name string) error {
	return c.request("DELETE", "/api/admin/roles/"+urlEscape(name), nil, nil)
}

// ---------- organizations ----------

type Organization struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	CreatedAt  int64  `json:"createdAt"`
	BrandName  string `json:"brandName,omitempty"`
	BrandColor string `json:"brandColor,omitempty"`
}

func (c *Client) CreateOrganization(id, name string) (*Organization, error) {
	var out Organization
	if err := c.request("POST", "/api/admin/organizations", map[string]string{"id": id, "name": name}, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) GetOrganization(id string) (*Organization, error) {
	var orgs []Organization
	if err := c.request("GET", "/api/admin/organizations", nil, &orgs); err != nil {
		return nil, err
	}
	for _, o := range orgs {
		if o.ID == id {
			return &o, nil
		}
	}
	return nil, nil
}

func (c *Client) UpdateOrganization(id string, changes map[string]interface{}) (*Organization, error) {
	var out Organization
	if err := c.request("PATCH", "/api/admin/organizations/"+urlEscape(id), changes, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) DeleteOrganization(id string) error {
	return c.request("DELETE", "/api/admin/organizations/"+urlEscape(id), nil, nil)
}

// ---------- users ----------

type User struct {
	Username  string   `json:"username"`
	Roles     []string `json:"roles"`
	Tenant    string   `json:"tenant"`
	CreatedAt int64    `json:"createdAt"`
}

func (c *Client) CreateUser(username, password string, roles []string, tenant string) (*User, error) {
	var out User
	body := map[string]interface{}{"username": username, "password": password, "roles": roles, "tenant": tenant}
	if err := c.request("POST", "/api/admin/users", body, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) GetUser(username string) (*User, error) {
	var users []User
	if err := c.request("GET", "/api/admin/users", nil, &users); err != nil {
		return nil, err
	}
	for _, u := range users {
		if u.Username == username {
			return &u, nil
		}
	}
	return nil, nil
}

func (c *Client) UpdateUser(username string, changes map[string]interface{}) (*User, error) {
	var out User
	if err := c.request("PATCH", "/api/admin/users/"+urlEscape(username), changes, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) DeleteUser(username string) error {
	return c.request("DELETE", "/api/admin/users/"+urlEscape(username), nil, nil)
}

// ---------- connections ----------

type Connection struct {
	ID            string            `json:"id"`
	Hostname      string            `json:"hostname"`
	Type          string            `json:"type"`
	Labels        map[string]string `json:"labels"`
	Folder        string            `json:"folder"`
	Host          string            `json:"host"`
	Port          int               `json:"port"`
	Username      string            `json:"username"`
	Password      string            `json:"password,omitempty"`
	DatabaseName  string            `json:"databaseName,omitempty"`
	AssignedUsers []string          `json:"assignedUsers"`
	CreatedAt     int64             `json:"createdAt"`
}

func (c *Client) CreateConnection(conn Connection) (*Connection, error) {
	var out Connection
	if err := c.request("POST", "/api/admin/connections", conn, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) GetConnection(id string) (*Connection, error) {
	var conns []Connection
	if err := c.request("GET", "/api/admin/connections", nil, &conns); err != nil {
		return nil, err
	}
	for _, cn := range conns {
		if cn.ID == id {
			return &cn, nil
		}
	}
	return nil, nil
}

func (c *Client) UpdateConnection(id string, conn Connection) (*Connection, error) {
	var out Connection
	if err := c.request("PATCH", "/api/admin/connections/"+urlEscape(id), conn, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) DeleteConnection(id string) error {
	return c.request("DELETE", "/api/admin/connections/"+urlEscape(id), nil, nil)
}

func urlEscape(s string) string {
	// Path segments here are always simple names/ids in this project's own
	// data (usernames, role names, connection/org ids) — no need to pull
	// in net/url just for PathEscape's full generality.
	replacer := strings.NewReplacer("/", "%2F", " ", "%20", "?", "%3F", "#", "%23")
	return replacer.Replace(s)
}
