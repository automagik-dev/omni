# GetPersonPresence200ResponseDataIdentitiesInner

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

### NewGetPersonPresence200ResponseDataIdentitiesInner

`func NewGetPersonPresence200ResponseDataIdentitiesInner(id string, personId string, channel string, platformUserId string, displayName NullableString, profilePicUrl NullableString, messageCount int32, lastSeenAt NullableTime, ) *GetPersonPresence200ResponseDataIdentitiesInner`

NewGetPersonPresence200ResponseDataIdentitiesInner instantiates a new GetPersonPresence200ResponseDataIdentitiesInner object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewGetPersonPresence200ResponseDataIdentitiesInnerWithDefaults

`func NewGetPersonPresence200ResponseDataIdentitiesInnerWithDefaults() *GetPersonPresence200ResponseDataIdentitiesInner`

NewGetPersonPresence200ResponseDataIdentitiesInnerWithDefaults instantiates a new GetPersonPresence200ResponseDataIdentitiesInner object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetId

`func (o *GetPersonPresence200ResponseDataIdentitiesInner) GetId() string`

GetId returns the Id field if non-nil, zero value otherwise.

### GetIdOk

`func (o *GetPersonPresence200ResponseDataIdentitiesInner) GetIdOk() (*string, bool)`

GetIdOk returns a tuple with the Id field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetId

`func (o *GetPersonPresence200ResponseDataIdentitiesInner) SetId(v string)`

SetId sets Id field to given value.


### GetPersonId

`func (o *GetPersonPresence200ResponseDataIdentitiesInner) GetPersonId() string`

GetPersonId returns the PersonId field if non-nil, zero value otherwise.

### GetPersonIdOk

`func (o *GetPersonPresence200ResponseDataIdentitiesInner) GetPersonIdOk() (*string, bool)`

GetPersonIdOk returns a tuple with the PersonId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetPersonId

`func (o *GetPersonPresence200ResponseDataIdentitiesInner) SetPersonId(v string)`

SetPersonId sets PersonId field to given value.


### GetChannel

`func (o *GetPersonPresence200ResponseDataIdentitiesInner) GetChannel() string`

GetChannel returns the Channel field if non-nil, zero value otherwise.

### GetChannelOk

`func (o *GetPersonPresence200ResponseDataIdentitiesInner) GetChannelOk() (*string, bool)`

GetChannelOk returns a tuple with the Channel field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetChannel

`func (o *GetPersonPresence200ResponseDataIdentitiesInner) SetChannel(v string)`

SetChannel sets Channel field to given value.


### GetPlatformUserId

`func (o *GetPersonPresence200ResponseDataIdentitiesInner) GetPlatformUserId() string`

GetPlatformUserId returns the PlatformUserId field if non-nil, zero value otherwise.

### GetPlatformUserIdOk

`func (o *GetPersonPresence200ResponseDataIdentitiesInner) GetPlatformUserIdOk() (*string, bool)`

GetPlatformUserIdOk returns a tuple with the PlatformUserId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetPlatformUserId

`func (o *GetPersonPresence200ResponseDataIdentitiesInner) SetPlatformUserId(v string)`

SetPlatformUserId sets PlatformUserId field to given value.


### GetDisplayName

`func (o *GetPersonPresence200ResponseDataIdentitiesInner) GetDisplayName() string`

GetDisplayName returns the DisplayName field if non-nil, zero value otherwise.

### GetDisplayNameOk

`func (o *GetPersonPresence200ResponseDataIdentitiesInner) GetDisplayNameOk() (*string, bool)`

GetDisplayNameOk returns a tuple with the DisplayName field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetDisplayName

`func (o *GetPersonPresence200ResponseDataIdentitiesInner) SetDisplayName(v string)`

SetDisplayName sets DisplayName field to given value.


### SetDisplayNameNil

`func (o *GetPersonPresence200ResponseDataIdentitiesInner) SetDisplayNameNil(b bool)`

 SetDisplayNameNil sets the value for DisplayName to be an explicit nil

### UnsetDisplayName
`func (o *GetPersonPresence200ResponseDataIdentitiesInner) UnsetDisplayName()`

UnsetDisplayName ensures that no value is present for DisplayName, not even an explicit nil
### GetProfilePicUrl

`func (o *GetPersonPresence200ResponseDataIdentitiesInner) GetProfilePicUrl() string`

GetProfilePicUrl returns the ProfilePicUrl field if non-nil, zero value otherwise.

### GetProfilePicUrlOk

`func (o *GetPersonPresence200ResponseDataIdentitiesInner) GetProfilePicUrlOk() (*string, bool)`

GetProfilePicUrlOk returns a tuple with the ProfilePicUrl field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetProfilePicUrl

`func (o *GetPersonPresence200ResponseDataIdentitiesInner) SetProfilePicUrl(v string)`

SetProfilePicUrl sets ProfilePicUrl field to given value.


### SetProfilePicUrlNil

`func (o *GetPersonPresence200ResponseDataIdentitiesInner) SetProfilePicUrlNil(b bool)`

 SetProfilePicUrlNil sets the value for ProfilePicUrl to be an explicit nil

### UnsetProfilePicUrl
`func (o *GetPersonPresence200ResponseDataIdentitiesInner) UnsetProfilePicUrl()`

UnsetProfilePicUrl ensures that no value is present for ProfilePicUrl, not even an explicit nil
### GetMessageCount

`func (o *GetPersonPresence200ResponseDataIdentitiesInner) GetMessageCount() int32`

GetMessageCount returns the MessageCount field if non-nil, zero value otherwise.

### GetMessageCountOk

`func (o *GetPersonPresence200ResponseDataIdentitiesInner) GetMessageCountOk() (*int32, bool)`

GetMessageCountOk returns a tuple with the MessageCount field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetMessageCount

`func (o *GetPersonPresence200ResponseDataIdentitiesInner) SetMessageCount(v int32)`

SetMessageCount sets MessageCount field to given value.


### GetLastSeenAt

`func (o *GetPersonPresence200ResponseDataIdentitiesInner) GetLastSeenAt() time.Time`

GetLastSeenAt returns the LastSeenAt field if non-nil, zero value otherwise.

### GetLastSeenAtOk

`func (o *GetPersonPresence200ResponseDataIdentitiesInner) GetLastSeenAtOk() (*time.Time, bool)`

GetLastSeenAtOk returns a tuple with the LastSeenAt field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetLastSeenAt

`func (o *GetPersonPresence200ResponseDataIdentitiesInner) SetLastSeenAt(v time.Time)`

SetLastSeenAt sets LastSeenAt field to given value.


### SetLastSeenAtNil

`func (o *GetPersonPresence200ResponseDataIdentitiesInner) SetLastSeenAtNil(b bool)`

 SetLastSeenAtNil sets the value for LastSeenAt to be an explicit nil

### UnsetLastSeenAt
`func (o *GetPersonPresence200ResponseDataIdentitiesInner) UnsetLastSeenAt()`

UnsetLastSeenAt ensures that no value is present for LastSeenAt, not even an explicit nil

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


