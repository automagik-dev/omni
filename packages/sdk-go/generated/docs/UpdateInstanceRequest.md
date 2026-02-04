# UpdateInstanceRequest

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Name** | Pointer to **string** | Unique name for the instance | [optional] 
**Channel** | Pointer to **string** | Channel type | [optional] 
**AgentProviderId** | Pointer to **string** | Reference to agent provider | [optional] 
**AgentId** | Pointer to **string** | Agent ID within the provider | [optional] [default to "default"]
**AgentTimeout** | Pointer to **int32** | Agent timeout in seconds | [optional] [default to 60]
**AgentStreamMode** | Pointer to **bool** | Enable streaming responses | [optional] [default to false]
**IsDefault** | Pointer to **bool** | Set as default instance for channel | [optional] [default to false]
**Token** | Pointer to **string** | Bot token for Discord instances | [optional] 

## Methods

### NewUpdateInstanceRequest

`func NewUpdateInstanceRequest() *UpdateInstanceRequest`

NewUpdateInstanceRequest instantiates a new UpdateInstanceRequest object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewUpdateInstanceRequestWithDefaults

`func NewUpdateInstanceRequestWithDefaults() *UpdateInstanceRequest`

NewUpdateInstanceRequestWithDefaults instantiates a new UpdateInstanceRequest object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetName

`func (o *UpdateInstanceRequest) GetName() string`

GetName returns the Name field if non-nil, zero value otherwise.

### GetNameOk

`func (o *UpdateInstanceRequest) GetNameOk() (*string, bool)`

GetNameOk returns a tuple with the Name field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetName

`func (o *UpdateInstanceRequest) SetName(v string)`

SetName sets Name field to given value.

### HasName

`func (o *UpdateInstanceRequest) HasName() bool`

HasName returns a boolean if a field has been set.

### GetChannel

`func (o *UpdateInstanceRequest) GetChannel() string`

GetChannel returns the Channel field if non-nil, zero value otherwise.

### GetChannelOk

`func (o *UpdateInstanceRequest) GetChannelOk() (*string, bool)`

GetChannelOk returns a tuple with the Channel field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetChannel

`func (o *UpdateInstanceRequest) SetChannel(v string)`

SetChannel sets Channel field to given value.

### HasChannel

`func (o *UpdateInstanceRequest) HasChannel() bool`

HasChannel returns a boolean if a field has been set.

### GetAgentProviderId

`func (o *UpdateInstanceRequest) GetAgentProviderId() string`

GetAgentProviderId returns the AgentProviderId field if non-nil, zero value otherwise.

### GetAgentProviderIdOk

`func (o *UpdateInstanceRequest) GetAgentProviderIdOk() (*string, bool)`

GetAgentProviderIdOk returns a tuple with the AgentProviderId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetAgentProviderId

`func (o *UpdateInstanceRequest) SetAgentProviderId(v string)`

SetAgentProviderId sets AgentProviderId field to given value.

### HasAgentProviderId

`func (o *UpdateInstanceRequest) HasAgentProviderId() bool`

HasAgentProviderId returns a boolean if a field has been set.

### GetAgentId

`func (o *UpdateInstanceRequest) GetAgentId() string`

GetAgentId returns the AgentId field if non-nil, zero value otherwise.

### GetAgentIdOk

`func (o *UpdateInstanceRequest) GetAgentIdOk() (*string, bool)`

GetAgentIdOk returns a tuple with the AgentId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetAgentId

`func (o *UpdateInstanceRequest) SetAgentId(v string)`

SetAgentId sets AgentId field to given value.

### HasAgentId

`func (o *UpdateInstanceRequest) HasAgentId() bool`

HasAgentId returns a boolean if a field has been set.

### GetAgentTimeout

`func (o *UpdateInstanceRequest) GetAgentTimeout() int32`

GetAgentTimeout returns the AgentTimeout field if non-nil, zero value otherwise.

### GetAgentTimeoutOk

`func (o *UpdateInstanceRequest) GetAgentTimeoutOk() (*int32, bool)`

GetAgentTimeoutOk returns a tuple with the AgentTimeout field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetAgentTimeout

`func (o *UpdateInstanceRequest) SetAgentTimeout(v int32)`

SetAgentTimeout sets AgentTimeout field to given value.

### HasAgentTimeout

`func (o *UpdateInstanceRequest) HasAgentTimeout() bool`

HasAgentTimeout returns a boolean if a field has been set.

### GetAgentStreamMode

`func (o *UpdateInstanceRequest) GetAgentStreamMode() bool`

GetAgentStreamMode returns the AgentStreamMode field if non-nil, zero value otherwise.

### GetAgentStreamModeOk

`func (o *UpdateInstanceRequest) GetAgentStreamModeOk() (*bool, bool)`

GetAgentStreamModeOk returns a tuple with the AgentStreamMode field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetAgentStreamMode

`func (o *UpdateInstanceRequest) SetAgentStreamMode(v bool)`

SetAgentStreamMode sets AgentStreamMode field to given value.

### HasAgentStreamMode

`func (o *UpdateInstanceRequest) HasAgentStreamMode() bool`

HasAgentStreamMode returns a boolean if a field has been set.

### GetIsDefault

`func (o *UpdateInstanceRequest) GetIsDefault() bool`

GetIsDefault returns the IsDefault field if non-nil, zero value otherwise.

### GetIsDefaultOk

`func (o *UpdateInstanceRequest) GetIsDefaultOk() (*bool, bool)`

GetIsDefaultOk returns a tuple with the IsDefault field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetIsDefault

`func (o *UpdateInstanceRequest) SetIsDefault(v bool)`

SetIsDefault sets IsDefault field to given value.

### HasIsDefault

`func (o *UpdateInstanceRequest) HasIsDefault() bool`

HasIsDefault returns a boolean if a field has been set.

### GetToken

`func (o *UpdateInstanceRequest) GetToken() string`

GetToken returns the Token field if non-nil, zero value otherwise.

### GetTokenOk

`func (o *UpdateInstanceRequest) GetTokenOk() (*string, bool)`

GetTokenOk returns a tuple with the Token field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetToken

`func (o *UpdateInstanceRequest) SetToken(v string)`

SetToken sets Token field to given value.

### HasToken

`func (o *UpdateInstanceRequest) HasToken() bool`

HasToken returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


