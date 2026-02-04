# ListAutomations200ResponseItemsInnerActionsInnerAnyOf4Config

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**ProviderId** | Pointer to **string** | Provider ID (template: {{instance.agentProviderId}}) | [optional] 
**AgentId** | **string** | Agent ID (required or template) | 
**AgentType** | Pointer to **string** | Agent type | [optional] 
**SessionStrategy** | Pointer to **string** | Session strategy for agent memory | [optional] 
**PrefixSenderName** | Pointer to **bool** | Prefix messages with sender name | [optional] 
**TimeoutMs** | Pointer to **int32** | Timeout in milliseconds | [optional] 
**ResponseAs** | Pointer to **string** | Store agent response as variable for chaining (e.g., \&quot;agentResponse\&quot;) | [optional] 

## Methods

### NewListAutomations200ResponseItemsInnerActionsInnerAnyOf4Config

`func NewListAutomations200ResponseItemsInnerActionsInnerAnyOf4Config(agentId string, ) *ListAutomations200ResponseItemsInnerActionsInnerAnyOf4Config`

NewListAutomations200ResponseItemsInnerActionsInnerAnyOf4Config instantiates a new ListAutomations200ResponseItemsInnerActionsInnerAnyOf4Config object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewListAutomations200ResponseItemsInnerActionsInnerAnyOf4ConfigWithDefaults

`func NewListAutomations200ResponseItemsInnerActionsInnerAnyOf4ConfigWithDefaults() *ListAutomations200ResponseItemsInnerActionsInnerAnyOf4Config`

NewListAutomations200ResponseItemsInnerActionsInnerAnyOf4ConfigWithDefaults instantiates a new ListAutomations200ResponseItemsInnerActionsInnerAnyOf4Config object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetProviderId

`func (o *ListAutomations200ResponseItemsInnerActionsInnerAnyOf4Config) GetProviderId() string`

GetProviderId returns the ProviderId field if non-nil, zero value otherwise.

### GetProviderIdOk

`func (o *ListAutomations200ResponseItemsInnerActionsInnerAnyOf4Config) GetProviderIdOk() (*string, bool)`

GetProviderIdOk returns a tuple with the ProviderId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetProviderId

`func (o *ListAutomations200ResponseItemsInnerActionsInnerAnyOf4Config) SetProviderId(v string)`

SetProviderId sets ProviderId field to given value.

### HasProviderId

`func (o *ListAutomations200ResponseItemsInnerActionsInnerAnyOf4Config) HasProviderId() bool`

HasProviderId returns a boolean if a field has been set.

### GetAgentId

`func (o *ListAutomations200ResponseItemsInnerActionsInnerAnyOf4Config) GetAgentId() string`

GetAgentId returns the AgentId field if non-nil, zero value otherwise.

### GetAgentIdOk

`func (o *ListAutomations200ResponseItemsInnerActionsInnerAnyOf4Config) GetAgentIdOk() (*string, bool)`

GetAgentIdOk returns a tuple with the AgentId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetAgentId

`func (o *ListAutomations200ResponseItemsInnerActionsInnerAnyOf4Config) SetAgentId(v string)`

SetAgentId sets AgentId field to given value.


### GetAgentType

`func (o *ListAutomations200ResponseItemsInnerActionsInnerAnyOf4Config) GetAgentType() string`

GetAgentType returns the AgentType field if non-nil, zero value otherwise.

### GetAgentTypeOk

`func (o *ListAutomations200ResponseItemsInnerActionsInnerAnyOf4Config) GetAgentTypeOk() (*string, bool)`

GetAgentTypeOk returns a tuple with the AgentType field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetAgentType

`func (o *ListAutomations200ResponseItemsInnerActionsInnerAnyOf4Config) SetAgentType(v string)`

SetAgentType sets AgentType field to given value.

### HasAgentType

`func (o *ListAutomations200ResponseItemsInnerActionsInnerAnyOf4Config) HasAgentType() bool`

HasAgentType returns a boolean if a field has been set.

### GetSessionStrategy

`func (o *ListAutomations200ResponseItemsInnerActionsInnerAnyOf4Config) GetSessionStrategy() string`

GetSessionStrategy returns the SessionStrategy field if non-nil, zero value otherwise.

### GetSessionStrategyOk

`func (o *ListAutomations200ResponseItemsInnerActionsInnerAnyOf4Config) GetSessionStrategyOk() (*string, bool)`

GetSessionStrategyOk returns a tuple with the SessionStrategy field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetSessionStrategy

`func (o *ListAutomations200ResponseItemsInnerActionsInnerAnyOf4Config) SetSessionStrategy(v string)`

SetSessionStrategy sets SessionStrategy field to given value.

### HasSessionStrategy

`func (o *ListAutomations200ResponseItemsInnerActionsInnerAnyOf4Config) HasSessionStrategy() bool`

HasSessionStrategy returns a boolean if a field has been set.

### GetPrefixSenderName

`func (o *ListAutomations200ResponseItemsInnerActionsInnerAnyOf4Config) GetPrefixSenderName() bool`

GetPrefixSenderName returns the PrefixSenderName field if non-nil, zero value otherwise.

### GetPrefixSenderNameOk

`func (o *ListAutomations200ResponseItemsInnerActionsInnerAnyOf4Config) GetPrefixSenderNameOk() (*bool, bool)`

GetPrefixSenderNameOk returns a tuple with the PrefixSenderName field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetPrefixSenderName

`func (o *ListAutomations200ResponseItemsInnerActionsInnerAnyOf4Config) SetPrefixSenderName(v bool)`

SetPrefixSenderName sets PrefixSenderName field to given value.

### HasPrefixSenderName

`func (o *ListAutomations200ResponseItemsInnerActionsInnerAnyOf4Config) HasPrefixSenderName() bool`

HasPrefixSenderName returns a boolean if a field has been set.

### GetTimeoutMs

`func (o *ListAutomations200ResponseItemsInnerActionsInnerAnyOf4Config) GetTimeoutMs() int32`

GetTimeoutMs returns the TimeoutMs field if non-nil, zero value otherwise.

### GetTimeoutMsOk

`func (o *ListAutomations200ResponseItemsInnerActionsInnerAnyOf4Config) GetTimeoutMsOk() (*int32, bool)`

GetTimeoutMsOk returns a tuple with the TimeoutMs field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetTimeoutMs

`func (o *ListAutomations200ResponseItemsInnerActionsInnerAnyOf4Config) SetTimeoutMs(v int32)`

SetTimeoutMs sets TimeoutMs field to given value.

### HasTimeoutMs

`func (o *ListAutomations200ResponseItemsInnerActionsInnerAnyOf4Config) HasTimeoutMs() bool`

HasTimeoutMs returns a boolean if a field has been set.

### GetResponseAs

`func (o *ListAutomations200ResponseItemsInnerActionsInnerAnyOf4Config) GetResponseAs() string`

GetResponseAs returns the ResponseAs field if non-nil, zero value otherwise.

### GetResponseAsOk

`func (o *ListAutomations200ResponseItemsInnerActionsInnerAnyOf4Config) GetResponseAsOk() (*string, bool)`

GetResponseAsOk returns a tuple with the ResponseAs field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetResponseAs

`func (o *ListAutomations200ResponseItemsInnerActionsInnerAnyOf4Config) SetResponseAs(v string)`

SetResponseAs sets ResponseAs field to given value.

### HasResponseAs

`func (o *ListAutomations200ResponseItemsInnerActionsInnerAnyOf4Config) HasResponseAs() bool`

HasResponseAs returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


