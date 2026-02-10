// Package omni provides a fluent Go client for the Omni v2 API.
//
// Example usage:
//
//	client := omni.NewClient("http://localhost:8882", "omni_sk_your_key")
//
//	// List instances
//	instances, err := client.Instances.List(nil)
//	if err != nil {
//	    log.Fatal(err)
//	}
//	for _, inst := range instances.Items {
//	    fmt.Printf("%s: %s\n", inst.Name, inst.Channel)
//	}
//
//	// Send a message
//	result, err := client.Messages.Send(&SendMessageParams{
//	    InstanceID: "uuid",
//	    To:         "chat-id",
//	    Text:       "Hello from Go!",
//	})
package omni

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Config holds the client configuration.
type Config struct {
	BaseURL string
	APIKey  string
	Timeout time.Duration
}

// Client is the main Omni API client.
type Client struct {
	config     *Config
	httpClient *http.Client

	Instances   *InstancesAPI
	Messages    *MessagesAPI
	Events      *EventsAPI
	Persons     *PersonsAPI
	Access      *AccessAPI
	Automations *AutomationsAPI
	Webhooks    *WebhooksAPI
	Providers   *ProvidersAPI
	System      *SystemAPI
}

// NewClient creates a new Omni client with the given base URL and API key.
func NewClient(baseURL, apiKey string) *Client {
	return NewClientWithConfig(&Config{
		BaseURL: baseURL,
		APIKey:  apiKey,
		Timeout: 30 * time.Second,
	})
}

// NewClientWithConfig creates a new Omni client with the given configuration.
func NewClientWithConfig(config *Config) *Client {
	if config.Timeout == 0 {
		config.Timeout = 30 * time.Second
	}

	c := &Client{
		config: config,
		httpClient: &http.Client{
			Timeout: config.Timeout,
		},
	}

	c.Instances = &InstancesAPI{client: c}
	c.Messages = &MessagesAPI{client: c}
	c.Events = &EventsAPI{client: c}
	c.Persons = &PersonsAPI{client: c}
	c.Access = &AccessAPI{client: c}
	c.Automations = &AutomationsAPI{client: c}
	c.Webhooks = &WebhooksAPI{client: c}
	c.Providers = &ProvidersAPI{client: c}
	c.System = &SystemAPI{client: c}

	return c
}

// Error represents an API error.
type Error struct {
	Message    string `json:"error"`
	Code       string `json:"code,omitempty"`
	StatusCode int    `json:"-"`
}

func (e *Error) Error() string {
	if e.Code != "" {
		return fmt.Sprintf("%s (code: %s) [HTTP %d]", e.Message, e.Code, e.StatusCode)
	}
	return fmt.Sprintf("%s [HTTP %d]", e.Message, e.StatusCode)
}

// PaginationMeta holds pagination metadata.
type PaginationMeta struct {
	HasMore bool    `json:"hasMore"`
	Cursor  *string `json:"cursor,omitempty"`
}

// request performs an HTTP request to the API.
func (c *Client) request(method, path string, params url.Values, body interface{}) ([]byte, error) {
	baseURL := strings.TrimSuffix(c.config.BaseURL, "/")
	fullURL := fmt.Sprintf("%s/api/v2%s", baseURL, path)

	if len(params) > 0 {
		fullURL = fmt.Sprintf("%s?%s", fullURL, params.Encode())
	}

	var bodyReader io.Reader
	if body != nil {
		jsonBody, err := json.Marshal(body)
		if err != nil {
			return nil, fmt.Errorf("failed to marshal request body: %w", err)
		}
		bodyReader = bytes.NewReader(jsonBody)
	}

	req, err := http.NewRequest(method, fullURL, bodyReader)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("x-api-key", c.config.APIKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response body: %w", err)
	}

	if resp.StatusCode >= 400 {
		var apiErr Error
		if err := json.Unmarshal(respBody, &apiErr); err != nil {
			apiErr.Message = string(respBody)
		}
		apiErr.StatusCode = resp.StatusCode
		return nil, &apiErr
	}

	return respBody, nil
}

// ============================================================================
// INSTANCES
// ============================================================================

// InstancesAPI provides instance management operations.
type InstancesAPI struct {
	client *Client
}

// Instance represents a channel instance.
type Instance struct {
	ID              string                 `json:"id"`
	Name            string                 `json:"name"`
	Channel         string                 `json:"channel"`
	Status          string                 `json:"status"`
	AgentProviderID *string                `json:"agentProviderId,omitempty"`
	AgentID         *string                `json:"agentId,omitempty"`
	ProfileName     *string                `json:"profileName,omitempty"`
	ProfileAvatarURL *string               `json:"profileAvatarUrl,omitempty"`
	Settings        map[string]interface{} `json:"settings,omitempty"`
	CreatedAt       string                 `json:"createdAt"`
	UpdatedAt       string                 `json:"updatedAt"`
}

// ListInstancesParams holds parameters for listing instances.
type ListInstancesParams struct {
	Channel *string
	Status  *string
	Limit   *int
	Cursor  *string
}

// ListInstancesResponse holds the response from listing instances.
type ListInstancesResponse struct {
	Items []Instance     `json:"items"`
	Meta  PaginationMeta `json:"meta"`
}

// List returns all instances.
func (api *InstancesAPI) List(params *ListInstancesParams) (*ListInstancesResponse, error) {
	q := url.Values{}
	if params != nil {
		if params.Channel != nil {
			q.Set("channel", *params.Channel)
		}
		if params.Status != nil {
			q.Set("status", *params.Status)
		}
		if params.Limit != nil {
			q.Set("limit", fmt.Sprintf("%d", *params.Limit))
		}
		if params.Cursor != nil {
			q.Set("cursor", *params.Cursor)
		}
	}

	body, err := api.client.request("GET", "/instances", q, nil)
	if err != nil {
		return nil, err
	}

	var resp ListInstancesResponse
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	return &resp, nil
}

// Get returns an instance by ID.
func (api *InstancesAPI) Get(id string) (*Instance, error) {
	body, err := api.client.request("GET", fmt.Sprintf("/instances/%s", id), nil, nil)
	if err != nil {
		return nil, err
	}

	var resp struct {
		Data Instance `json:"data"`
	}
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	return &resp.Data, nil
}

// CreateInstanceParams holds parameters for creating an instance.
type CreateInstanceParams struct {
	Name            string  `json:"name"`
	Channel         string  `json:"channel"`
	AgentProviderID *string `json:"agentProviderId,omitempty"`
	AgentID         *string `json:"agentId,omitempty"`
}

// Create creates a new instance.
func (api *InstancesAPI) Create(params *CreateInstanceParams) (*Instance, error) {
	body, err := api.client.request("POST", "/instances", nil, params)
	if err != nil {
		return nil, err
	}

	var resp struct {
		Data Instance `json:"data"`
	}
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	return &resp.Data, nil
}

// Delete deletes an instance.
func (api *InstancesAPI) Delete(id string) error {
	_, err := api.client.request("DELETE", fmt.Sprintf("/instances/%s", id), nil, nil)
	return err
}

// InstanceStatus holds instance connection status.
type InstanceStatus struct {
	State       string  `json:"state"`
	IsConnected bool    `json:"isConnected"`
	ProfileName *string `json:"profileName,omitempty"`
}

// Status returns the connection status of an instance.
func (api *InstancesAPI) Status(id string) (*InstanceStatus, error) {
	body, err := api.client.request("GET", fmt.Sprintf("/instances/%s/status", id), nil, nil)
	if err != nil {
		return nil, err
	}

	var resp struct {
		Data InstanceStatus `json:"data"`
	}
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	return &resp.Data, nil
}

// QRCode holds QR code information.
type QRCode struct {
	QR        *string `json:"qr"`
	ExpiresAt *string `json:"expiresAt"`
	Message   string  `json:"message"`
}

// QR returns the QR code for a WhatsApp instance.
func (api *InstancesAPI) QR(id string) (*QRCode, error) {
	body, err := api.client.request("GET", fmt.Sprintf("/instances/%s/qr", id), nil, nil)
	if err != nil {
		return nil, err
	}

	var resp struct {
		Data QRCode `json:"data"`
	}
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	return &resp.Data, nil
}

// ConnectResult holds the result of a connect operation.
type ConnectResult struct {
	Status  string `json:"status"`
	Message string `json:"message"`
}

// Connect connects an instance.
func (api *InstancesAPI) Connect(id string) (*ConnectResult, error) {
	body, err := api.client.request("POST", fmt.Sprintf("/instances/%s/connect", id), nil, map[string]interface{}{})
	if err != nil {
		return nil, err
	}

	var resp struct {
		Data ConnectResult `json:"data"`
	}
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	return &resp.Data, nil
}

// Disconnect disconnects an instance.
func (api *InstancesAPI) Disconnect(id string) error {
	_, err := api.client.request("POST", fmt.Sprintf("/instances/%s/disconnect", id), nil, nil)
	return err
}

// ============================================================================
// MESSAGES
// ============================================================================

// MessagesAPI provides message sending operations.
type MessagesAPI struct {
	client *Client
}

// SendMessageParams holds parameters for sending a text message.
type SendMessageParams struct {
	InstanceID string  `json:"instanceId"`
	To         string  `json:"to"`
	Text       string  `json:"text"`
	ReplyTo    *string `json:"replyTo,omitempty"`
}

// SendResult holds the result of a send operation.
type SendResult struct {
	MessageID string `json:"messageId"`
	Status    string `json:"status"`
}

// Send sends a text message.
func (api *MessagesAPI) Send(params *SendMessageParams) (*SendResult, error) {
	body, err := api.client.request("POST", "/messages", nil, params)
	if err != nil {
		return nil, err
	}

	var resp struct {
		Data SendResult `json:"data"`
	}
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	return &resp.Data, nil
}

// SendMediaParams holds parameters for sending media.
type SendMediaParams struct {
	InstanceID string  `json:"instanceId"`
	To         string  `json:"to"`
	Type       string  `json:"type"` // image, audio, video, document
	URL        *string `json:"url,omitempty"`
	Base64     *string `json:"base64,omitempty"`
	Filename   *string `json:"filename,omitempty"`
	Caption    *string `json:"caption,omitempty"`
	VoiceNote  *bool   `json:"voiceNote,omitempty"`
}

// SendMedia sends a media message.
func (api *MessagesAPI) SendMedia(params *SendMediaParams) (*SendResult, error) {
	body, err := api.client.request("POST", "/messages/media", nil, params)
	if err != nil {
		return nil, err
	}

	var resp struct {
		Data SendResult `json:"data"`
	}
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	return &resp.Data, nil
}

// SendReactionParams holds parameters for sending a reaction.
type SendReactionParams struct {
	InstanceID string `json:"instanceId"`
	To         string `json:"to"`
	MessageID  string `json:"messageId"`
	Emoji      string `json:"emoji"`
}

// SendReaction sends a reaction to a message.
func (api *MessagesAPI) SendReaction(params *SendReactionParams) error {
	_, err := api.client.request("POST", "/messages/reaction", nil, params)
	return err
}

// SendLocationParams holds parameters for sending a location.
type SendLocationParams struct {
	InstanceID string  `json:"instanceId"`
	To         string  `json:"to"`
	Latitude   float64 `json:"latitude"`
	Longitude  float64 `json:"longitude"`
	Name       *string `json:"name,omitempty"`
	Address    *string `json:"address,omitempty"`
}

// SendLocation sends a location message.
func (api *MessagesAPI) SendLocation(params *SendLocationParams) (*SendResult, error) {
	body, err := api.client.request("POST", "/messages/location", nil, params)
	if err != nil {
		return nil, err
	}

	var resp struct {
		Data SendResult `json:"data"`
	}
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	return &resp.Data, nil
}

// ============================================================================
// EVENTS
// ============================================================================

// EventsAPI provides event querying operations.
type EventsAPI struct {
	client *Client
}

// Event represents an event.
type Event struct {
	ID          string                 `json:"id"`
	Type        string                 `json:"type"`
	Channel     *string                `json:"channel,omitempty"`
	InstanceID  *string                `json:"instanceId,omitempty"`
	Payload     map[string]interface{} `json:"payload,omitempty"`
	ProcessedAt *string                `json:"processedAt,omitempty"`
	CreatedAt   string                 `json:"createdAt"`
}

// ListEventsParams holds parameters for listing events.
type ListEventsParams struct {
	Channel    *string
	InstanceID *string
	EventType  *string
	Since      *string
	Until      *string
	Search     *string
	Limit      *int
	Cursor     *string
}

// ListEventsResponse holds the response from listing events.
type ListEventsResponse struct {
	Items []Event        `json:"items"`
	Meta  PaginationMeta `json:"meta"`
}

// List returns events with optional filters.
func (api *EventsAPI) List(params *ListEventsParams) (*ListEventsResponse, error) {
	q := url.Values{}
	if params != nil {
		if params.Channel != nil {
			q.Set("channel", *params.Channel)
		}
		if params.InstanceID != nil {
			q.Set("instanceId", *params.InstanceID)
		}
		if params.EventType != nil {
			q.Set("eventType", *params.EventType)
		}
		if params.Since != nil {
			q.Set("since", *params.Since)
		}
		if params.Until != nil {
			q.Set("until", *params.Until)
		}
		if params.Search != nil {
			q.Set("search", *params.Search)
		}
		if params.Limit != nil {
			q.Set("limit", fmt.Sprintf("%d", *params.Limit))
		}
		if params.Cursor != nil {
			q.Set("cursor", *params.Cursor)
		}
	}

	body, err := api.client.request("GET", "/events", q, nil)
	if err != nil {
		return nil, err
	}

	var resp ListEventsResponse
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	return &resp, nil
}

// ============================================================================
// PERSONS
// ============================================================================

// PersonsAPI provides person/identity operations.
type PersonsAPI struct {
	client *Client
}

// Person represents a person.
type Person struct {
	ID          string                 `json:"id"`
	DisplayName *string                `json:"displayName,omitempty"`
	FirstName   *string                `json:"firstName,omitempty"`
	LastName    *string                `json:"lastName,omitempty"`
	AvatarURL   *string                `json:"avatarUrl,omitempty"`
	Metadata    map[string]interface{} `json:"metadata,omitempty"`
	CreatedAt   string                 `json:"createdAt"`
	UpdatedAt   string                 `json:"updatedAt"`
}

// Search searches for persons.
func (api *PersonsAPI) Search(search string, limit *int) ([]Person, error) {
	q := url.Values{}
	q.Set("search", search)
	if limit != nil {
		q.Set("limit", fmt.Sprintf("%d", *limit))
	}

	body, err := api.client.request("GET", "/persons", q, nil)
	if err != nil {
		return nil, err
	}

	var resp struct {
		Items []Person `json:"items"`
	}
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	return resp.Items, nil
}

// Get returns a person by ID.
func (api *PersonsAPI) Get(id string) (*Person, error) {
	body, err := api.client.request("GET", fmt.Sprintf("/persons/%s", id), nil, nil)
	if err != nil {
		return nil, err
	}

	var resp struct {
		Data Person `json:"data"`
	}
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	return &resp.Data, nil
}

// ============================================================================
// ACCESS
// ============================================================================

// AccessAPI provides access control operations.
type AccessAPI struct {
	client *Client
}

// AccessRule represents an access rule.
type AccessRule struct {
	ID             string  `json:"id"`
	RuleType       string  `json:"ruleType"`
	InstanceID     *string `json:"instanceId,omitempty"`
	PhonePattern   *string `json:"phonePattern,omitempty"`
	PlatformUserID *string `json:"platformUserId,omitempty"`
	Priority       int     `json:"priority"`
	Action         string  `json:"action"`
	Reason         *string `json:"reason,omitempty"`
	BlockMessage   *string `json:"blockMessage,omitempty"`
	Enabled        bool    `json:"enabled"`
	CreatedAt      string  `json:"createdAt"`
}

// ListRules returns access rules.
func (api *AccessAPI) ListRules(instanceID *string, ruleType *string) ([]AccessRule, error) {
	q := url.Values{}
	if instanceID != nil {
		q.Set("instanceId", *instanceID)
	}
	if ruleType != nil {
		q.Set("type", *ruleType)
	}

	body, err := api.client.request("GET", "/access/rules", q, nil)
	if err != nil {
		return nil, err
	}

	var resp struct {
		Items []AccessRule `json:"items"`
	}
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	return resp.Items, nil
}

// CheckAccessResult holds the result of an access check.
type CheckAccessResult struct {
	Allowed bool        `json:"allowed"`
	Reason  *string     `json:"reason,omitempty"`
	Rule    *AccessRule `json:"rule,omitempty"`
}

// Check checks if a user has access.
func (api *AccessAPI) Check(instanceID, platformUserID, channel string) (*CheckAccessResult, error) {
	body, err := api.client.request("POST", "/access/check", nil, map[string]string{
		"instanceId":     instanceID,
		"platformUserId": platformUserID,
		"channel":        channel,
	})
	if err != nil {
		return nil, err
	}

	var resp struct {
		Data CheckAccessResult `json:"data"`
	}
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	return &resp.Data, nil
}

// ============================================================================
// AUTOMATIONS
// ============================================================================

// AutomationsAPI provides automation management operations.
type AutomationsAPI struct {
	client *Client
}

// Automation represents an automation.
type Automation struct {
	ID                string                   `json:"id"`
	Name              string                   `json:"name"`
	Description       *string                  `json:"description,omitempty"`
	TriggerEventType  string                   `json:"triggerEventType"`
	TriggerConditions []map[string]interface{} `json:"triggerConditions,omitempty"`
	ConditionLogic    *string                  `json:"conditionLogic,omitempty"`
	Actions           []map[string]interface{} `json:"actions"`
	Enabled           bool                     `json:"enabled"`
	Priority          int                      `json:"priority"`
	CreatedAt         string                   `json:"createdAt"`
	UpdatedAt         string                   `json:"updatedAt"`
}

// List returns all automations.
func (api *AutomationsAPI) List(enabled *bool) ([]Automation, error) {
	q := url.Values{}
	if enabled != nil {
		q.Set("enabled", fmt.Sprintf("%t", *enabled))
	}

	body, err := api.client.request("GET", "/automations", q, nil)
	if err != nil {
		return nil, err
	}

	var resp struct {
		Items []Automation `json:"items"`
	}
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	return resp.Items, nil
}

// Get returns an automation by ID.
func (api *AutomationsAPI) Get(id string) (*Automation, error) {
	body, err := api.client.request("GET", fmt.Sprintf("/automations/%s", id), nil, nil)
	if err != nil {
		return nil, err
	}

	var resp struct {
		Data Automation `json:"data"`
	}
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	return &resp.Data, nil
}

// Enable enables an automation.
func (api *AutomationsAPI) Enable(id string) (*Automation, error) {
	body, err := api.client.request("POST", fmt.Sprintf("/automations/%s/enable", id), nil, nil)
	if err != nil {
		return nil, err
	}

	var resp struct {
		Data Automation `json:"data"`
	}
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	return &resp.Data, nil
}

// Disable disables an automation.
func (api *AutomationsAPI) Disable(id string) (*Automation, error) {
	body, err := api.client.request("POST", fmt.Sprintf("/automations/%s/disable", id), nil, nil)
	if err != nil {
		return nil, err
	}

	var resp struct {
		Data Automation `json:"data"`
	}
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	return &resp.Data, nil
}

// Delete deletes an automation.
func (api *AutomationsAPI) Delete(id string) error {
	_, err := api.client.request("DELETE", fmt.Sprintf("/automations/%s", id), nil, nil)
	return err
}

// ============================================================================
// WEBHOOKS
// ============================================================================

// WebhooksAPI provides webhook management operations.
type WebhooksAPI struct {
	client *Client
}

// WebhookSource represents a webhook source.
type WebhookSource struct {
	ID              string          `json:"id"`
	Name            string          `json:"name"`
	Description     *string         `json:"description,omitempty"`
	ExpectedHeaders map[string]bool `json:"expectedHeaders,omitempty"`
	Enabled         bool            `json:"enabled"`
	CreatedAt       string          `json:"createdAt"`
	UpdatedAt       string          `json:"updatedAt"`
}

// ListSources returns all webhook sources.
func (api *WebhooksAPI) ListSources(enabled *bool) ([]WebhookSource, error) {
	q := url.Values{}
	if enabled != nil {
		q.Set("enabled", fmt.Sprintf("%t", *enabled))
	}

	body, err := api.client.request("GET", "/webhook-sources", q, nil)
	if err != nil {
		return nil, err
	}

	var resp struct {
		Items []WebhookSource `json:"items"`
	}
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	return resp.Items, nil
}

// TriggerEventParams holds parameters for triggering a custom event.
type TriggerEventParams struct {
	EventType     string                 `json:"eventType"`
	Payload       map[string]interface{} `json:"payload"`
	CorrelationID *string                `json:"correlationId,omitempty"`
	InstanceID    *string                `json:"instanceId,omitempty"`
}

// TriggerResult holds the result of triggering an event.
type TriggerResult struct {
	EventID   string `json:"eventId"`
	EventType string `json:"eventType"`
}

// Trigger triggers a custom event.
func (api *WebhooksAPI) Trigger(params *TriggerEventParams) (*TriggerResult, error) {
	body, err := api.client.request("POST", "/events/trigger", nil, params)
	if err != nil {
		return nil, err
	}

	var resp TriggerResult
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	return &resp, nil
}

// ============================================================================
// PROVIDERS
// ============================================================================

// ProvidersAPI provides provider management operations.
type ProvidersAPI struct {
	client *Client
}

// Provider represents an agent provider.
type Provider struct {
	ID              string                 `json:"id"`
	Name            string                 `json:"name"`
	Schema          string                 `json:"schema"`
	BaseURL         string                 `json:"baseUrl"`
	SchemaConfig    map[string]interface{} `json:"schemaConfig,omitempty"`
	DefaultStream   bool                   `json:"defaultStream"`
	DefaultTimeout  int                    `json:"defaultTimeout"`
	Active          bool                   `json:"active"`
	CreatedAt       string                 `json:"createdAt"`
	UpdatedAt       string                 `json:"updatedAt"`
}

// List returns all providers.
func (api *ProvidersAPI) List(active *bool) ([]Provider, error) {
	q := url.Values{}
	if active != nil {
		q.Set("active", fmt.Sprintf("%t", *active))
	}

	body, err := api.client.request("GET", "/providers", q, nil)
	if err != nil {
		return nil, err
	}

	var resp struct {
		Items []Provider `json:"items"`
	}
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	return resp.Items, nil
}

// Get returns a provider by ID.
func (api *ProvidersAPI) Get(id string) (*Provider, error) {
	body, err := api.client.request("GET", fmt.Sprintf("/providers/%s", id), nil, nil)
	if err != nil {
		return nil, err
	}

	var resp struct {
		Data Provider `json:"data"`
	}
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	return &resp.Data, nil
}

// HealthResult holds the result of a health check.
type HealthResult struct {
	Healthy bool    `json:"healthy"`
	Latency int     `json:"latency"`
	Error   *string `json:"error,omitempty"`
}

// CheckHealth checks the health of a provider.
func (api *ProvidersAPI) CheckHealth(id string) (*HealthResult, error) {
	body, err := api.client.request("POST", fmt.Sprintf("/providers/%s/health", id), nil, nil)
	if err != nil {
		return nil, err
	}

	var resp HealthResult
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	return &resp, nil
}

// ============================================================================
// SYSTEM
// ============================================================================

// SystemAPI provides system operations.
type SystemAPI struct {
	client *Client
}

// HealthStatus holds the system health status.
type HealthStatus struct {
	Status string `json:"status"`
}

// Health returns the system health status.
func (api *SystemAPI) Health() (*HealthStatus, error) {
	body, err := api.client.request("GET", "/health", nil, nil)
	if err != nil {
		return nil, err
	}

	var resp HealthStatus
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	return &resp, nil
}
