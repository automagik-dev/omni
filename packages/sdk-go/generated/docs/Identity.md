# Identity

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Id** | **string** | Identity UUID | 
**PersonId** | **string** | Person UUID | 
**Channel** | **string** | Channel type | 
**PlatformUserId** | **string** | Platform user ID | 
**DisplayName** | **NullableString** | Display name | 
**ProfilePicUrl** | **NullableString** | Profile picture URL | 
**MessageCount** | **int32** | Total messages | 
**LastSeenAt** | **NullableTime** | Last seen timestamp | 

## Methods

### NewIdentity

`func NewIdentity(id string, personId string, channel string, platformUserId string, displayName NullableString, profilePicUrl NullableString, messageCount int32, lastSeenAt NullableTime, ) *Identity`

NewIdentity instantiates a new Identity object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewIdentityWithDefaults

`func NewIdentityWithDefaults() *Identity`

NewIdentityWithDefaults instantiates a new Identity object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetId

`func (o *Identity) GetId() string`

GetId returns the Id field if non-nil, zero value otherwise.

### GetIdOk

`func (o *Identity) GetIdOk() (*string, bool)`

GetIdOk returns a tuple with the Id field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetId

`func (o *Identity) SetId(v string)`

SetId sets Id field to given value.


### GetPersonId

`func (o *Identity) GetPersonId() string`

GetPersonId returns the PersonId field if non-nil, zero value otherwise.

### GetPersonIdOk

`func (o *Identity) GetPersonIdOk() (*string, bool)`

GetPersonIdOk returns a tuple with the PersonId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetPersonId

`func (o *Identity) SetPersonId(v string)`

SetPersonId sets PersonId field to given value.


### GetChannel

`func (o *Identity) GetChannel() string`

GetChannel returns the Channel field if non-nil, zero value otherwise.

### GetChannelOk

`func (o *Identity) GetChannelOk() (*string, bool)`

GetChannelOk returns a tuple with the Channel field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetChannel

`func (o *Identity) SetChannel(v string)`

SetChannel sets Channel field to given value.


### GetPlatformUserId

`func (o *Identity) GetPlatformUserId() string`

GetPlatformUserId returns the PlatformUserId field if non-nil, zero value otherwise.

### GetPlatformUserIdOk

`func (o *Identity) GetPlatformUserIdOk() (*string, bool)`

GetPlatformUserIdOk returns a tuple with the PlatformUserId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetPlatformUserId

`func (o *Identity) SetPlatformUserId(v string)`

SetPlatformUserId sets PlatformUserId field to given value.


### GetDisplayName

`func (o *Identity) GetDisplayName() string`

GetDisplayName returns the DisplayName field if non-nil, zero value otherwise.

### GetDisplayNameOk

`func (o *Identity) GetDisplayNameOk() (*string, bool)`

GetDisplayNameOk returns a tuple with the DisplayName field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetDisplayName

`func (o *Identity) SetDisplayName(v string)`

SetDisplayName sets DisplayName field to given value.


### SetDisplayNameNil

`func (o *Identity) SetDisplayNameNil(b bool)`

 SetDisplayNameNil sets the value for DisplayName to be an explicit nil

### UnsetDisplayName
`func (o *Identity) UnsetDisplayName()`

UnsetDisplayName ensures that no value is present for DisplayName, not even an explicit nil
### GetProfilePicUrl

`func (o *Identity) GetProfilePicUrl() string`

GetProfilePicUrl returns the ProfilePicUrl field if non-nil, zero value otherwise.

### GetProfilePicUrlOk

`func (o *Identity) GetProfilePicUrlOk() (*string, bool)`

GetProfilePicUrlOk returns a tuple with the ProfilePicUrl field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetProfilePicUrl

`func (o *Identity) SetProfilePicUrl(v string)`

SetProfilePicUrl sets ProfilePicUrl field to given value.


### SetProfilePicUrlNil

`func (o *Identity) SetProfilePicUrlNil(b bool)`

 SetProfilePicUrlNil sets the value for ProfilePicUrl to be an explicit nil

### UnsetProfilePicUrl
`func (o *Identity) UnsetProfilePicUrl()`

UnsetProfilePicUrl ensures that no value is present for ProfilePicUrl, not even an explicit nil
### GetMessageCount

`func (o *Identity) GetMessageCount() int32`

GetMessageCount returns the MessageCount field if non-nil, zero value otherwise.

### GetMessageCountOk

`func (o *Identity) GetMessageCountOk() (*int32, bool)`

GetMessageCountOk returns a tuple with the MessageCount field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetMessageCount

`func (o *Identity) SetMessageCount(v int32)`

SetMessageCount sets MessageCount field to given value.


### GetLastSeenAt

`func (o *Identity) GetLastSeenAt() time.Time`

GetLastSeenAt returns the LastSeenAt field if non-nil, zero value otherwise.

### GetLastSeenAtOk

`func (o *Identity) GetLastSeenAtOk() (*time.Time, bool)`

GetLastSeenAtOk returns a tuple with the LastSeenAt field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetLastSeenAt

`func (o *Identity) SetLastSeenAt(v time.Time)`

SetLastSeenAt sets LastSeenAt field to given value.


### SetLastSeenAtNil

`func (o *Identity) SetLastSeenAtNil(b bool)`

 SetLastSeenAtNil sets the value for LastSeenAt to be an explicit nil

### UnsetLastSeenAt
`func (o *Identity) UnsetLastSeenAt()`

UnsetLastSeenAt ensures that no value is present for LastSeenAt, not even an explicit nil

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


