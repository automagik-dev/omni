# GetUserProfile200ResponseData

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

### NewGetUserProfile200ResponseData

`func NewGetUserProfile200ResponseData(platformUserId string, ) *GetUserProfile200ResponseData`

NewGetUserProfile200ResponseData instantiates a new GetUserProfile200ResponseData object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewGetUserProfile200ResponseDataWithDefaults

`func NewGetUserProfile200ResponseDataWithDefaults() *GetUserProfile200ResponseData`

NewGetUserProfile200ResponseDataWithDefaults instantiates a new GetUserProfile200ResponseData object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetPlatformUserId

`func (o *GetUserProfile200ResponseData) GetPlatformUserId() string`

GetPlatformUserId returns the PlatformUserId field if non-nil, zero value otherwise.

### GetPlatformUserIdOk

`func (o *GetUserProfile200ResponseData) GetPlatformUserIdOk() (*string, bool)`

GetPlatformUserIdOk returns a tuple with the PlatformUserId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetPlatformUserId

`func (o *GetUserProfile200ResponseData) SetPlatformUserId(v string)`

SetPlatformUserId sets PlatformUserId field to given value.


### GetDisplayName

`func (o *GetUserProfile200ResponseData) GetDisplayName() string`

GetDisplayName returns the DisplayName field if non-nil, zero value otherwise.

### GetDisplayNameOk

`func (o *GetUserProfile200ResponseData) GetDisplayNameOk() (*string, bool)`

GetDisplayNameOk returns a tuple with the DisplayName field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetDisplayName

`func (o *GetUserProfile200ResponseData) SetDisplayName(v string)`

SetDisplayName sets DisplayName field to given value.

### HasDisplayName

`func (o *GetUserProfile200ResponseData) HasDisplayName() bool`

HasDisplayName returns a boolean if a field has been set.

### GetAvatarUrl

`func (o *GetUserProfile200ResponseData) GetAvatarUrl() string`

GetAvatarUrl returns the AvatarUrl field if non-nil, zero value otherwise.

### GetAvatarUrlOk

`func (o *GetUserProfile200ResponseData) GetAvatarUrlOk() (*string, bool)`

GetAvatarUrlOk returns a tuple with the AvatarUrl field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetAvatarUrl

`func (o *GetUserProfile200ResponseData) SetAvatarUrl(v string)`

SetAvatarUrl sets AvatarUrl field to given value.

### HasAvatarUrl

`func (o *GetUserProfile200ResponseData) HasAvatarUrl() bool`

HasAvatarUrl returns a boolean if a field has been set.

### GetBio

`func (o *GetUserProfile200ResponseData) GetBio() string`

GetBio returns the Bio field if non-nil, zero value otherwise.

### GetBioOk

`func (o *GetUserProfile200ResponseData) GetBioOk() (*string, bool)`

GetBioOk returns a tuple with the Bio field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetBio

`func (o *GetUserProfile200ResponseData) SetBio(v string)`

SetBio sets Bio field to given value.

### HasBio

`func (o *GetUserProfile200ResponseData) HasBio() bool`

HasBio returns a boolean if a field has been set.

### GetPhone

`func (o *GetUserProfile200ResponseData) GetPhone() string`

GetPhone returns the Phone field if non-nil, zero value otherwise.

### GetPhoneOk

`func (o *GetUserProfile200ResponseData) GetPhoneOk() (*string, bool)`

GetPhoneOk returns a tuple with the Phone field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetPhone

`func (o *GetUserProfile200ResponseData) SetPhone(v string)`

SetPhone sets Phone field to given value.

### HasPhone

`func (o *GetUserProfile200ResponseData) HasPhone() bool`

HasPhone returns a boolean if a field has been set.

### GetPlatformMetadata

`func (o *GetUserProfile200ResponseData) GetPlatformMetadata() map[string]interface{}`

GetPlatformMetadata returns the PlatformMetadata field if non-nil, zero value otherwise.

### GetPlatformMetadataOk

`func (o *GetUserProfile200ResponseData) GetPlatformMetadataOk() (*map[string]interface{}, bool)`

GetPlatformMetadataOk returns a tuple with the PlatformMetadata field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetPlatformMetadata

`func (o *GetUserProfile200ResponseData) SetPlatformMetadata(v map[string]interface{})`

SetPlatformMetadata sets PlatformMetadata field to given value.

### HasPlatformMetadata

`func (o *GetUserProfile200ResponseData) HasPlatformMetadata() bool`

HasPlatformMetadata returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


