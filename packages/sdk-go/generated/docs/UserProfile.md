# UserProfile

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**PlatformUserId** | **string** | Platform user ID | 
**DisplayName** | Pointer to **string** | Display name | [optional] 
**AvatarUrl** | Pointer to **string** | Avatar URL | [optional] 
**Bio** | Pointer to **string** | Bio/status | [optional] 
**Phone** | Pointer to **string** | Phone number | [optional] 
**PlatformMetadata** | Pointer to **map[string]interface{}** | Platform-specific data | [optional] 

## Methods

### NewUserProfile

`func NewUserProfile(platformUserId string, ) *UserProfile`

NewUserProfile instantiates a new UserProfile object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewUserProfileWithDefaults

`func NewUserProfileWithDefaults() *UserProfile`

NewUserProfileWithDefaults instantiates a new UserProfile object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetPlatformUserId

`func (o *UserProfile) GetPlatformUserId() string`

GetPlatformUserId returns the PlatformUserId field if non-nil, zero value otherwise.

### GetPlatformUserIdOk

`func (o *UserProfile) GetPlatformUserIdOk() (*string, bool)`

GetPlatformUserIdOk returns a tuple with the PlatformUserId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetPlatformUserId

`func (o *UserProfile) SetPlatformUserId(v string)`

SetPlatformUserId sets PlatformUserId field to given value.


### GetDisplayName

`func (o *UserProfile) GetDisplayName() string`

GetDisplayName returns the DisplayName field if non-nil, zero value otherwise.

### GetDisplayNameOk

`func (o *UserProfile) GetDisplayNameOk() (*string, bool)`

GetDisplayNameOk returns a tuple with the DisplayName field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetDisplayName

`func (o *UserProfile) SetDisplayName(v string)`

SetDisplayName sets DisplayName field to given value.

### HasDisplayName

`func (o *UserProfile) HasDisplayName() bool`

HasDisplayName returns a boolean if a field has been set.

### GetAvatarUrl

`func (o *UserProfile) GetAvatarUrl() string`

GetAvatarUrl returns the AvatarUrl field if non-nil, zero value otherwise.

### GetAvatarUrlOk

`func (o *UserProfile) GetAvatarUrlOk() (*string, bool)`

GetAvatarUrlOk returns a tuple with the AvatarUrl field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetAvatarUrl

`func (o *UserProfile) SetAvatarUrl(v string)`

SetAvatarUrl sets AvatarUrl field to given value.

### HasAvatarUrl

`func (o *UserProfile) HasAvatarUrl() bool`

HasAvatarUrl returns a boolean if a field has been set.

### GetBio

`func (o *UserProfile) GetBio() string`

GetBio returns the Bio field if non-nil, zero value otherwise.

### GetBioOk

`func (o *UserProfile) GetBioOk() (*string, bool)`

GetBioOk returns a tuple with the Bio field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetBio

`func (o *UserProfile) SetBio(v string)`

SetBio sets Bio field to given value.

### HasBio

`func (o *UserProfile) HasBio() bool`

HasBio returns a boolean if a field has been set.

### GetPhone

`func (o *UserProfile) GetPhone() string`

GetPhone returns the Phone field if non-nil, zero value otherwise.

### GetPhoneOk

`func (o *UserProfile) GetPhoneOk() (*string, bool)`

GetPhoneOk returns a tuple with the Phone field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetPhone

`func (o *UserProfile) SetPhone(v string)`

SetPhone sets Phone field to given value.

### HasPhone

`func (o *UserProfile) HasPhone() bool`

HasPhone returns a boolean if a field has been set.

### GetPlatformMetadata

`func (o *UserProfile) GetPlatformMetadata() map[string]interface{}`

GetPlatformMetadata returns the PlatformMetadata field if non-nil, zero value otherwise.

### GetPlatformMetadataOk

`func (o *UserProfile) GetPlatformMetadataOk() (*map[string]interface{}, bool)`

GetPlatformMetadataOk returns a tuple with the PlatformMetadata field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetPlatformMetadata

`func (o *UserProfile) SetPlatformMetadata(v map[string]interface{})`

SetPlatformMetadata sets PlatformMetadata field to given value.

### HasPlatformMetadata

`func (o *UserProfile) HasPlatformMetadata() bool`

HasPlatformMetadata returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


