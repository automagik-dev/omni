# Instance

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Id** | **string** | Instance UUID | 
**Name** | **string** | Instance name | 
**Channel** | **string** | Channel type | 
**IsActive** | **bool** | Whether instance is active | 
**IsDefault** | **bool** | Whether this is the default instance for channel | 
**ProfileName** | **NullableString** | Connected profile name | 
**ProfilePicUrl** | **NullableString** | Profile picture URL | 
**OwnerIdentifier** | **NullableString** | Owner identifier | 
**AgentProviderId** | **NullableString** | Agent provider UUID | 
**AgentId** | **NullableString** | Agent ID | 
**AgentTimeout** | **float32** | Agent timeout in seconds | 
**AgentStreamMode** | **bool** | Whether streaming is enabled | 
**CreatedAt** | **time.Time** | Creation timestamp | 
**UpdatedAt** | **time.Time** | Last update timestamp | 

## Methods

### NewInstance

`func NewInstance(id string, name string, channel string, isActive bool, isDefault bool, profileName NullableString, profilePicUrl NullableString, ownerIdentifier NullableString, agentProviderId NullableString, agentId NullableString, agentTimeout float32, agentStreamMode bool, createdAt time.Time, updatedAt time.Time, ) *Instance`

NewInstance instantiates a new Instance object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewInstanceWithDefaults

`func NewInstanceWithDefaults() *Instance`

NewInstanceWithDefaults instantiates a new Instance object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetId

`func (o *Instance) GetId() string`

GetId returns the Id field if non-nil, zero value otherwise.

### GetIdOk

`func (o *Instance) GetIdOk() (*string, bool)`

GetIdOk returns a tuple with the Id field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetId

`func (o *Instance) SetId(v string)`

SetId sets Id field to given value.


### GetName

`func (o *Instance) GetName() string`

GetName returns the Name field if non-nil, zero value otherwise.

### GetNameOk

`func (o *Instance) GetNameOk() (*string, bool)`

GetNameOk returns a tuple with the Name field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetName

`func (o *Instance) SetName(v string)`

SetName sets Name field to given value.


### GetChannel

`func (o *Instance) GetChannel() string`

GetChannel returns the Channel field if non-nil, zero value otherwise.

### GetChannelOk

`func (o *Instance) GetChannelOk() (*string, bool)`

GetChannelOk returns a tuple with the Channel field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetChannel

`func (o *Instance) SetChannel(v string)`

SetChannel sets Channel field to given value.


### GetIsActive

`func (o *Instance) GetIsActive() bool`

GetIsActive returns the IsActive field if non-nil, zero value otherwise.

### GetIsActiveOk

`func (o *Instance) GetIsActiveOk() (*bool, bool)`

GetIsActiveOk returns a tuple with the IsActive field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetIsActive

`func (o *Instance) SetIsActive(v bool)`

SetIsActive sets IsActive field to given value.


### GetIsDefault

`func (o *Instance) GetIsDefault() bool`

GetIsDefault returns the IsDefault field if non-nil, zero value otherwise.

### GetIsDefaultOk

`func (o *Instance) GetIsDefaultOk() (*bool, bool)`

GetIsDefaultOk returns a tuple with the IsDefault field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetIsDefault

`func (o *Instance) SetIsDefault(v bool)`

SetIsDefault sets IsDefault field to given value.


### GetProfileName

`func (o *Instance) GetProfileName() string`

GetProfileName returns the ProfileName field if non-nil, zero value otherwise.

### GetProfileNameOk

`func (o *Instance) GetProfileNameOk() (*string, bool)`

GetProfileNameOk returns a tuple with the ProfileName field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetProfileName

`func (o *Instance) SetProfileName(v string)`

SetProfileName sets ProfileName field to given value.


### SetProfileNameNil

`func (o *Instance) SetProfileNameNil(b bool)`

 SetProfileNameNil sets the value for ProfileName to be an explicit nil

### UnsetProfileName
`func (o *Instance) UnsetProfileName()`

UnsetProfileName ensures that no value is present for ProfileName, not even an explicit nil
### GetProfilePicUrl

`func (o *Instance) GetProfilePicUrl() string`

GetProfilePicUrl returns the ProfilePicUrl field if non-nil, zero value otherwise.

### GetProfilePicUrlOk

`func (o *Instance) GetProfilePicUrlOk() (*string, bool)`

GetProfilePicUrlOk returns a tuple with the ProfilePicUrl field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetProfilePicUrl

`func (o *Instance) SetProfilePicUrl(v string)`

SetProfilePicUrl sets ProfilePicUrl field to given value.


### SetProfilePicUrlNil

`func (o *Instance) SetProfilePicUrlNil(b bool)`

 SetProfilePicUrlNil sets the value for ProfilePicUrl to be an explicit nil

### UnsetProfilePicUrl
`func (o *Instance) UnsetProfilePicUrl()`

UnsetProfilePicUrl ensures that no value is present for ProfilePicUrl, not even an explicit nil
### GetOwnerIdentifier

`func (o *Instance) GetOwnerIdentifier() string`

GetOwnerIdentifier returns the OwnerIdentifier field if non-nil, zero value otherwise.

### GetOwnerIdentifierOk

`func (o *Instance) GetOwnerIdentifierOk() (*string, bool)`

GetOwnerIdentifierOk returns a tuple with the OwnerIdentifier field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetOwnerIdentifier

`func (o *Instance) SetOwnerIdentifier(v string)`

SetOwnerIdentifier sets OwnerIdentifier field to given value.


### SetOwnerIdentifierNil

`func (o *Instance) SetOwnerIdentifierNil(b bool)`

 SetOwnerIdentifierNil sets the value for OwnerIdentifier to be an explicit nil

### UnsetOwnerIdentifier
`func (o *Instance) UnsetOwnerIdentifier()`

UnsetOwnerIdentifier ensures that no value is present for OwnerIdentifier, not even an explicit nil
### GetAgentProviderId

`func (o *Instance) GetAgentProviderId() string`

GetAgentProviderId returns the AgentProviderId field if non-nil, zero value otherwise.

### GetAgentProviderIdOk

`func (o *Instance) GetAgentProviderIdOk() (*string, bool)`

GetAgentProviderIdOk returns a tuple with the AgentProviderId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetAgentProviderId

`func (o *Instance) SetAgentProviderId(v string)`

SetAgentProviderId sets AgentProviderId field to given value.


### SetAgentProviderIdNil

`func (o *Instance) SetAgentProviderIdNil(b bool)`

 SetAgentProviderIdNil sets the value for AgentProviderId to be an explicit nil

### UnsetAgentProviderId
`func (o *Instance) UnsetAgentProviderId()`

UnsetAgentProviderId ensures that no value is present for AgentProviderId, not even an explicit nil
### GetAgentId

`func (o *Instance) GetAgentId() string`

GetAgentId returns the AgentId field if non-nil, zero value otherwise.

### GetAgentIdOk

`func (o *Instance) GetAgentIdOk() (*string, bool)`

GetAgentIdOk returns a tuple with the AgentId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetAgentId

`func (o *Instance) SetAgentId(v string)`

SetAgentId sets AgentId field to given value.


### SetAgentIdNil

`func (o *Instance) SetAgentIdNil(b bool)`

 SetAgentIdNil sets the value for AgentId to be an explicit nil

### UnsetAgentId
`func (o *Instance) UnsetAgentId()`

UnsetAgentId ensures that no value is present for AgentId, not even an explicit nil
### GetAgentTimeout

`func (o *Instance) GetAgentTimeout() float32`

GetAgentTimeout returns the AgentTimeout field if non-nil, zero value otherwise.

### GetAgentTimeoutOk

`func (o *Instance) GetAgentTimeoutOk() (*float32, bool)`

GetAgentTimeoutOk returns a tuple with the AgentTimeout field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetAgentTimeout

`func (o *Instance) SetAgentTimeout(v float32)`

SetAgentTimeout sets AgentTimeout field to given value.


### GetAgentStreamMode

`func (o *Instance) GetAgentStreamMode() bool`

GetAgentStreamMode returns the AgentStreamMode field if non-nil, zero value otherwise.

### GetAgentStreamModeOk

`func (o *Instance) GetAgentStreamModeOk() (*bool, bool)`

GetAgentStreamModeOk returns a tuple with the AgentStreamMode field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetAgentStreamMode

`func (o *Instance) SetAgentStreamMode(v bool)`

SetAgentStreamMode sets AgentStreamMode field to given value.


### GetCreatedAt

`func (o *Instance) GetCreatedAt() time.Time`

GetCreatedAt returns the CreatedAt field if non-nil, zero value otherwise.

### GetCreatedAtOk

`func (o *Instance) GetCreatedAtOk() (*time.Time, bool)`

GetCreatedAtOk returns a tuple with the CreatedAt field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetCreatedAt

`func (o *Instance) SetCreatedAt(v time.Time)`

SetCreatedAt sets CreatedAt field to given value.


### GetUpdatedAt

`func (o *Instance) GetUpdatedAt() time.Time`

GetUpdatedAt returns the UpdatedAt field if non-nil, zero value otherwise.

### GetUpdatedAtOk

`func (o *Instance) GetUpdatedAtOk() (*time.Time, bool)`

GetUpdatedAtOk returns a tuple with the UpdatedAt field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetUpdatedAt

`func (o *Instance) SetUpdatedAt(v time.Time)`

SetUpdatedAt sets UpdatedAt field to given value.



[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


