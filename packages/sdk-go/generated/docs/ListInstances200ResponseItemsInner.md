# ListInstances200ResponseItemsInner

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

### NewListInstances200ResponseItemsInner

`func NewListInstances200ResponseItemsInner(id string, name string, channel string, isActive bool, isDefault bool, profileName NullableString, profilePicUrl NullableString, ownerIdentifier NullableString, agentProviderId NullableString, agentId NullableString, agentTimeout float32, agentStreamMode bool, createdAt time.Time, updatedAt time.Time, ) *ListInstances200ResponseItemsInner`

NewListInstances200ResponseItemsInner instantiates a new ListInstances200ResponseItemsInner object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewListInstances200ResponseItemsInnerWithDefaults

`func NewListInstances200ResponseItemsInnerWithDefaults() *ListInstances200ResponseItemsInner`

NewListInstances200ResponseItemsInnerWithDefaults instantiates a new ListInstances200ResponseItemsInner object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetId

`func (o *ListInstances200ResponseItemsInner) GetId() string`

GetId returns the Id field if non-nil, zero value otherwise.

### GetIdOk

`func (o *ListInstances200ResponseItemsInner) GetIdOk() (*string, bool)`

GetIdOk returns a tuple with the Id field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetId

`func (o *ListInstances200ResponseItemsInner) SetId(v string)`

SetId sets Id field to given value.


### GetName

`func (o *ListInstances200ResponseItemsInner) GetName() string`

GetName returns the Name field if non-nil, zero value otherwise.

### GetNameOk

`func (o *ListInstances200ResponseItemsInner) GetNameOk() (*string, bool)`

GetNameOk returns a tuple with the Name field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetName

`func (o *ListInstances200ResponseItemsInner) SetName(v string)`

SetName sets Name field to given value.


### GetChannel

`func (o *ListInstances200ResponseItemsInner) GetChannel() string`

GetChannel returns the Channel field if non-nil, zero value otherwise.

### GetChannelOk

`func (o *ListInstances200ResponseItemsInner) GetChannelOk() (*string, bool)`

GetChannelOk returns a tuple with the Channel field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetChannel

`func (o *ListInstances200ResponseItemsInner) SetChannel(v string)`

SetChannel sets Channel field to given value.


### GetIsActive

`func (o *ListInstances200ResponseItemsInner) GetIsActive() bool`

GetIsActive returns the IsActive field if non-nil, zero value otherwise.

### GetIsActiveOk

`func (o *ListInstances200ResponseItemsInner) GetIsActiveOk() (*bool, bool)`

GetIsActiveOk returns a tuple with the IsActive field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetIsActive

`func (o *ListInstances200ResponseItemsInner) SetIsActive(v bool)`

SetIsActive sets IsActive field to given value.


### GetIsDefault

`func (o *ListInstances200ResponseItemsInner) GetIsDefault() bool`

GetIsDefault returns the IsDefault field if non-nil, zero value otherwise.

### GetIsDefaultOk

`func (o *ListInstances200ResponseItemsInner) GetIsDefaultOk() (*bool, bool)`

GetIsDefaultOk returns a tuple with the IsDefault field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetIsDefault

`func (o *ListInstances200ResponseItemsInner) SetIsDefault(v bool)`

SetIsDefault sets IsDefault field to given value.


### GetProfileName

`func (o *ListInstances200ResponseItemsInner) GetProfileName() string`

GetProfileName returns the ProfileName field if non-nil, zero value otherwise.

### GetProfileNameOk

`func (o *ListInstances200ResponseItemsInner) GetProfileNameOk() (*string, bool)`

GetProfileNameOk returns a tuple with the ProfileName field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetProfileName

`func (o *ListInstances200ResponseItemsInner) SetProfileName(v string)`

SetProfileName sets ProfileName field to given value.


### SetProfileNameNil

`func (o *ListInstances200ResponseItemsInner) SetProfileNameNil(b bool)`

 SetProfileNameNil sets the value for ProfileName to be an explicit nil

### UnsetProfileName
`func (o *ListInstances200ResponseItemsInner) UnsetProfileName()`

UnsetProfileName ensures that no value is present for ProfileName, not even an explicit nil
### GetProfilePicUrl

`func (o *ListInstances200ResponseItemsInner) GetProfilePicUrl() string`

GetProfilePicUrl returns the ProfilePicUrl field if non-nil, zero value otherwise.

### GetProfilePicUrlOk

`func (o *ListInstances200ResponseItemsInner) GetProfilePicUrlOk() (*string, bool)`

GetProfilePicUrlOk returns a tuple with the ProfilePicUrl field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetProfilePicUrl

`func (o *ListInstances200ResponseItemsInner) SetProfilePicUrl(v string)`

SetProfilePicUrl sets ProfilePicUrl field to given value.


### SetProfilePicUrlNil

`func (o *ListInstances200ResponseItemsInner) SetProfilePicUrlNil(b bool)`

 SetProfilePicUrlNil sets the value for ProfilePicUrl to be an explicit nil

### UnsetProfilePicUrl
`func (o *ListInstances200ResponseItemsInner) UnsetProfilePicUrl()`

UnsetProfilePicUrl ensures that no value is present for ProfilePicUrl, not even an explicit nil
### GetOwnerIdentifier

`func (o *ListInstances200ResponseItemsInner) GetOwnerIdentifier() string`

GetOwnerIdentifier returns the OwnerIdentifier field if non-nil, zero value otherwise.

### GetOwnerIdentifierOk

`func (o *ListInstances200ResponseItemsInner) GetOwnerIdentifierOk() (*string, bool)`

GetOwnerIdentifierOk returns a tuple with the OwnerIdentifier field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetOwnerIdentifier

`func (o *ListInstances200ResponseItemsInner) SetOwnerIdentifier(v string)`

SetOwnerIdentifier sets OwnerIdentifier field to given value.


### SetOwnerIdentifierNil

`func (o *ListInstances200ResponseItemsInner) SetOwnerIdentifierNil(b bool)`

 SetOwnerIdentifierNil sets the value for OwnerIdentifier to be an explicit nil

### UnsetOwnerIdentifier
`func (o *ListInstances200ResponseItemsInner) UnsetOwnerIdentifier()`

UnsetOwnerIdentifier ensures that no value is present for OwnerIdentifier, not even an explicit nil
### GetAgentProviderId

`func (o *ListInstances200ResponseItemsInner) GetAgentProviderId() string`

GetAgentProviderId returns the AgentProviderId field if non-nil, zero value otherwise.

### GetAgentProviderIdOk

`func (o *ListInstances200ResponseItemsInner) GetAgentProviderIdOk() (*string, bool)`

GetAgentProviderIdOk returns a tuple with the AgentProviderId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetAgentProviderId

`func (o *ListInstances200ResponseItemsInner) SetAgentProviderId(v string)`

SetAgentProviderId sets AgentProviderId field to given value.


### SetAgentProviderIdNil

`func (o *ListInstances200ResponseItemsInner) SetAgentProviderIdNil(b bool)`

 SetAgentProviderIdNil sets the value for AgentProviderId to be an explicit nil

### UnsetAgentProviderId
`func (o *ListInstances200ResponseItemsInner) UnsetAgentProviderId()`

UnsetAgentProviderId ensures that no value is present for AgentProviderId, not even an explicit nil
### GetAgentId

`func (o *ListInstances200ResponseItemsInner) GetAgentId() string`

GetAgentId returns the AgentId field if non-nil, zero value otherwise.

### GetAgentIdOk

`func (o *ListInstances200ResponseItemsInner) GetAgentIdOk() (*string, bool)`

GetAgentIdOk returns a tuple with the AgentId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetAgentId

`func (o *ListInstances200ResponseItemsInner) SetAgentId(v string)`

SetAgentId sets AgentId field to given value.


### SetAgentIdNil

`func (o *ListInstances200ResponseItemsInner) SetAgentIdNil(b bool)`

 SetAgentIdNil sets the value for AgentId to be an explicit nil

### UnsetAgentId
`func (o *ListInstances200ResponseItemsInner) UnsetAgentId()`

UnsetAgentId ensures that no value is present for AgentId, not even an explicit nil
### GetAgentTimeout

`func (o *ListInstances200ResponseItemsInner) GetAgentTimeout() float32`

GetAgentTimeout returns the AgentTimeout field if non-nil, zero value otherwise.

### GetAgentTimeoutOk

`func (o *ListInstances200ResponseItemsInner) GetAgentTimeoutOk() (*float32, bool)`

GetAgentTimeoutOk returns a tuple with the AgentTimeout field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetAgentTimeout

`func (o *ListInstances200ResponseItemsInner) SetAgentTimeout(v float32)`

SetAgentTimeout sets AgentTimeout field to given value.


### GetAgentStreamMode

`func (o *ListInstances200ResponseItemsInner) GetAgentStreamMode() bool`

GetAgentStreamMode returns the AgentStreamMode field if non-nil, zero value otherwise.

### GetAgentStreamModeOk

`func (o *ListInstances200ResponseItemsInner) GetAgentStreamModeOk() (*bool, bool)`

GetAgentStreamModeOk returns a tuple with the AgentStreamMode field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetAgentStreamMode

`func (o *ListInstances200ResponseItemsInner) SetAgentStreamMode(v bool)`

SetAgentStreamMode sets AgentStreamMode field to given value.


### GetCreatedAt

`func (o *ListInstances200ResponseItemsInner) GetCreatedAt() time.Time`

GetCreatedAt returns the CreatedAt field if non-nil, zero value otherwise.

### GetCreatedAtOk

`func (o *ListInstances200ResponseItemsInner) GetCreatedAtOk() (*time.Time, bool)`

GetCreatedAtOk returns a tuple with the CreatedAt field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetCreatedAt

`func (o *ListInstances200ResponseItemsInner) SetCreatedAt(v time.Time)`

SetCreatedAt sets CreatedAt field to given value.


### GetUpdatedAt

`func (o *ListInstances200ResponseItemsInner) GetUpdatedAt() time.Time`

GetUpdatedAt returns the UpdatedAt field if non-nil, zero value otherwise.

### GetUpdatedAtOk

`func (o *ListInstances200ResponseItemsInner) GetUpdatedAtOk() (*time.Time, bool)`

GetUpdatedAtOk returns a tuple with the UpdatedAt field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetUpdatedAt

`func (o *ListInstances200ResponseItemsInner) SetUpdatedAt(v time.Time)`

SetUpdatedAt sets UpdatedAt field to given value.



[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


