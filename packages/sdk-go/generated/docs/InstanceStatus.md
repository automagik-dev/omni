# InstanceStatus

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**InstanceId** | **string** | Instance UUID | 
**State** | **string** | Connection state | 
**IsConnected** | **bool** | Whether instance is connected | 
**ConnectedAt** | **NullableTime** | When connected | 
**ProfileName** | **NullableString** | Profile name | 
**ProfilePicUrl** | **NullableString** | Profile picture URL | 
**OwnerIdentifier** | **NullableString** | Owner identifier | 
**Message** | Pointer to **string** | Status message | [optional] 

## Methods

### NewInstanceStatus

`func NewInstanceStatus(instanceId string, state string, isConnected bool, connectedAt NullableTime, profileName NullableString, profilePicUrl NullableString, ownerIdentifier NullableString, ) *InstanceStatus`

NewInstanceStatus instantiates a new InstanceStatus object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewInstanceStatusWithDefaults

`func NewInstanceStatusWithDefaults() *InstanceStatus`

NewInstanceStatusWithDefaults instantiates a new InstanceStatus object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetInstanceId

`func (o *InstanceStatus) GetInstanceId() string`

GetInstanceId returns the InstanceId field if non-nil, zero value otherwise.

### GetInstanceIdOk

`func (o *InstanceStatus) GetInstanceIdOk() (*string, bool)`

GetInstanceIdOk returns a tuple with the InstanceId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetInstanceId

`func (o *InstanceStatus) SetInstanceId(v string)`

SetInstanceId sets InstanceId field to given value.


### GetState

`func (o *InstanceStatus) GetState() string`

GetState returns the State field if non-nil, zero value otherwise.

### GetStateOk

`func (o *InstanceStatus) GetStateOk() (*string, bool)`

GetStateOk returns a tuple with the State field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetState

`func (o *InstanceStatus) SetState(v string)`

SetState sets State field to given value.


### GetIsConnected

`func (o *InstanceStatus) GetIsConnected() bool`

GetIsConnected returns the IsConnected field if non-nil, zero value otherwise.

### GetIsConnectedOk

`func (o *InstanceStatus) GetIsConnectedOk() (*bool, bool)`

GetIsConnectedOk returns a tuple with the IsConnected field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetIsConnected

`func (o *InstanceStatus) SetIsConnected(v bool)`

SetIsConnected sets IsConnected field to given value.


### GetConnectedAt

`func (o *InstanceStatus) GetConnectedAt() time.Time`

GetConnectedAt returns the ConnectedAt field if non-nil, zero value otherwise.

### GetConnectedAtOk

`func (o *InstanceStatus) GetConnectedAtOk() (*time.Time, bool)`

GetConnectedAtOk returns a tuple with the ConnectedAt field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetConnectedAt

`func (o *InstanceStatus) SetConnectedAt(v time.Time)`

SetConnectedAt sets ConnectedAt field to given value.


### SetConnectedAtNil

`func (o *InstanceStatus) SetConnectedAtNil(b bool)`

 SetConnectedAtNil sets the value for ConnectedAt to be an explicit nil

### UnsetConnectedAt
`func (o *InstanceStatus) UnsetConnectedAt()`

UnsetConnectedAt ensures that no value is present for ConnectedAt, not even an explicit nil
### GetProfileName

`func (o *InstanceStatus) GetProfileName() string`

GetProfileName returns the ProfileName field if non-nil, zero value otherwise.

### GetProfileNameOk

`func (o *InstanceStatus) GetProfileNameOk() (*string, bool)`

GetProfileNameOk returns a tuple with the ProfileName field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetProfileName

`func (o *InstanceStatus) SetProfileName(v string)`

SetProfileName sets ProfileName field to given value.


### SetProfileNameNil

`func (o *InstanceStatus) SetProfileNameNil(b bool)`

 SetProfileNameNil sets the value for ProfileName to be an explicit nil

### UnsetProfileName
`func (o *InstanceStatus) UnsetProfileName()`

UnsetProfileName ensures that no value is present for ProfileName, not even an explicit nil
### GetProfilePicUrl

`func (o *InstanceStatus) GetProfilePicUrl() string`

GetProfilePicUrl returns the ProfilePicUrl field if non-nil, zero value otherwise.

### GetProfilePicUrlOk

`func (o *InstanceStatus) GetProfilePicUrlOk() (*string, bool)`

GetProfilePicUrlOk returns a tuple with the ProfilePicUrl field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetProfilePicUrl

`func (o *InstanceStatus) SetProfilePicUrl(v string)`

SetProfilePicUrl sets ProfilePicUrl field to given value.


### SetProfilePicUrlNil

`func (o *InstanceStatus) SetProfilePicUrlNil(b bool)`

 SetProfilePicUrlNil sets the value for ProfilePicUrl to be an explicit nil

### UnsetProfilePicUrl
`func (o *InstanceStatus) UnsetProfilePicUrl()`

UnsetProfilePicUrl ensures that no value is present for ProfilePicUrl, not even an explicit nil
### GetOwnerIdentifier

`func (o *InstanceStatus) GetOwnerIdentifier() string`

GetOwnerIdentifier returns the OwnerIdentifier field if non-nil, zero value otherwise.

### GetOwnerIdentifierOk

`func (o *InstanceStatus) GetOwnerIdentifierOk() (*string, bool)`

GetOwnerIdentifierOk returns a tuple with the OwnerIdentifier field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetOwnerIdentifier

`func (o *InstanceStatus) SetOwnerIdentifier(v string)`

SetOwnerIdentifier sets OwnerIdentifier field to given value.


### SetOwnerIdentifierNil

`func (o *InstanceStatus) SetOwnerIdentifierNil(b bool)`

 SetOwnerIdentifierNil sets the value for OwnerIdentifier to be an explicit nil

### UnsetOwnerIdentifier
`func (o *InstanceStatus) UnsetOwnerIdentifier()`

UnsetOwnerIdentifier ensures that no value is present for OwnerIdentifier, not even an explicit nil
### GetMessage

`func (o *InstanceStatus) GetMessage() string`

GetMessage returns the Message field if non-nil, zero value otherwise.

### GetMessageOk

`func (o *InstanceStatus) GetMessageOk() (*string, bool)`

GetMessageOk returns a tuple with the Message field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetMessage

`func (o *InstanceStatus) SetMessage(v string)`

SetMessage sets Message field to given value.

### HasMessage

`func (o *InstanceStatus) HasMessage() bool`

HasMessage returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


