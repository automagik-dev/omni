# GetInstanceStatus200ResponseData

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

### NewGetInstanceStatus200ResponseData

`func NewGetInstanceStatus200ResponseData(instanceId string, state string, isConnected bool, connectedAt NullableTime, profileName NullableString, profilePicUrl NullableString, ownerIdentifier NullableString, ) *GetInstanceStatus200ResponseData`

NewGetInstanceStatus200ResponseData instantiates a new GetInstanceStatus200ResponseData object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewGetInstanceStatus200ResponseDataWithDefaults

`func NewGetInstanceStatus200ResponseDataWithDefaults() *GetInstanceStatus200ResponseData`

NewGetInstanceStatus200ResponseDataWithDefaults instantiates a new GetInstanceStatus200ResponseData object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetInstanceId

`func (o *GetInstanceStatus200ResponseData) GetInstanceId() string`

GetInstanceId returns the InstanceId field if non-nil, zero value otherwise.

### GetInstanceIdOk

`func (o *GetInstanceStatus200ResponseData) GetInstanceIdOk() (*string, bool)`

GetInstanceIdOk returns a tuple with the InstanceId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetInstanceId

`func (o *GetInstanceStatus200ResponseData) SetInstanceId(v string)`

SetInstanceId sets InstanceId field to given value.


### GetState

`func (o *GetInstanceStatus200ResponseData) GetState() string`

GetState returns the State field if non-nil, zero value otherwise.

### GetStateOk

`func (o *GetInstanceStatus200ResponseData) GetStateOk() (*string, bool)`

GetStateOk returns a tuple with the State field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetState

`func (o *GetInstanceStatus200ResponseData) SetState(v string)`

SetState sets State field to given value.


### GetIsConnected

`func (o *GetInstanceStatus200ResponseData) GetIsConnected() bool`

GetIsConnected returns the IsConnected field if non-nil, zero value otherwise.

### GetIsConnectedOk

`func (o *GetInstanceStatus200ResponseData) GetIsConnectedOk() (*bool, bool)`

GetIsConnectedOk returns a tuple with the IsConnected field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetIsConnected

`func (o *GetInstanceStatus200ResponseData) SetIsConnected(v bool)`

SetIsConnected sets IsConnected field to given value.


### GetConnectedAt

`func (o *GetInstanceStatus200ResponseData) GetConnectedAt() time.Time`

GetConnectedAt returns the ConnectedAt field if non-nil, zero value otherwise.

### GetConnectedAtOk

`func (o *GetInstanceStatus200ResponseData) GetConnectedAtOk() (*time.Time, bool)`

GetConnectedAtOk returns a tuple with the ConnectedAt field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetConnectedAt

`func (o *GetInstanceStatus200ResponseData) SetConnectedAt(v time.Time)`

SetConnectedAt sets ConnectedAt field to given value.


### SetConnectedAtNil

`func (o *GetInstanceStatus200ResponseData) SetConnectedAtNil(b bool)`

 SetConnectedAtNil sets the value for ConnectedAt to be an explicit nil

### UnsetConnectedAt
`func (o *GetInstanceStatus200ResponseData) UnsetConnectedAt()`

UnsetConnectedAt ensures that no value is present for ConnectedAt, not even an explicit nil
### GetProfileName

`func (o *GetInstanceStatus200ResponseData) GetProfileName() string`

GetProfileName returns the ProfileName field if non-nil, zero value otherwise.

### GetProfileNameOk

`func (o *GetInstanceStatus200ResponseData) GetProfileNameOk() (*string, bool)`

GetProfileNameOk returns a tuple with the ProfileName field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetProfileName

`func (o *GetInstanceStatus200ResponseData) SetProfileName(v string)`

SetProfileName sets ProfileName field to given value.


### SetProfileNameNil

`func (o *GetInstanceStatus200ResponseData) SetProfileNameNil(b bool)`

 SetProfileNameNil sets the value for ProfileName to be an explicit nil

### UnsetProfileName
`func (o *GetInstanceStatus200ResponseData) UnsetProfileName()`

UnsetProfileName ensures that no value is present for ProfileName, not even an explicit nil
### GetProfilePicUrl

`func (o *GetInstanceStatus200ResponseData) GetProfilePicUrl() string`

GetProfilePicUrl returns the ProfilePicUrl field if non-nil, zero value otherwise.

### GetProfilePicUrlOk

`func (o *GetInstanceStatus200ResponseData) GetProfilePicUrlOk() (*string, bool)`

GetProfilePicUrlOk returns a tuple with the ProfilePicUrl field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetProfilePicUrl

`func (o *GetInstanceStatus200ResponseData) SetProfilePicUrl(v string)`

SetProfilePicUrl sets ProfilePicUrl field to given value.


### SetProfilePicUrlNil

`func (o *GetInstanceStatus200ResponseData) SetProfilePicUrlNil(b bool)`

 SetProfilePicUrlNil sets the value for ProfilePicUrl to be an explicit nil

### UnsetProfilePicUrl
`func (o *GetInstanceStatus200ResponseData) UnsetProfilePicUrl()`

UnsetProfilePicUrl ensures that no value is present for ProfilePicUrl, not even an explicit nil
### GetOwnerIdentifier

`func (o *GetInstanceStatus200ResponseData) GetOwnerIdentifier() string`

GetOwnerIdentifier returns the OwnerIdentifier field if non-nil, zero value otherwise.

### GetOwnerIdentifierOk

`func (o *GetInstanceStatus200ResponseData) GetOwnerIdentifierOk() (*string, bool)`

GetOwnerIdentifierOk returns a tuple with the OwnerIdentifier field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetOwnerIdentifier

`func (o *GetInstanceStatus200ResponseData) SetOwnerIdentifier(v string)`

SetOwnerIdentifier sets OwnerIdentifier field to given value.


### SetOwnerIdentifierNil

`func (o *GetInstanceStatus200ResponseData) SetOwnerIdentifierNil(b bool)`

 SetOwnerIdentifierNil sets the value for OwnerIdentifier to be an explicit nil

### UnsetOwnerIdentifier
`func (o *GetInstanceStatus200ResponseData) UnsetOwnerIdentifier()`

UnsetOwnerIdentifier ensures that no value is present for OwnerIdentifier, not even an explicit nil
### GetMessage

`func (o *GetInstanceStatus200ResponseData) GetMessage() string`

GetMessage returns the Message field if non-nil, zero value otherwise.

### GetMessageOk

`func (o *GetInstanceStatus200ResponseData) GetMessageOk() (*string, bool)`

GetMessageOk returns a tuple with the Message field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetMessage

`func (o *GetInstanceStatus200ResponseData) SetMessage(v string)`

SetMessage sets Message field to given value.

### HasMessage

`func (o *GetInstanceStatus200ResponseData) HasMessage() bool`

HasMessage returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


