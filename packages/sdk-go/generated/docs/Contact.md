# Contact

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**PlatformUserId** | **string** | Platform user ID | 
**DisplayName** | Pointer to **string** | Display name | [optional] 
**Phone** | Pointer to **string** | Phone number | [optional] 
**AvatarUrl** | Pointer to **string** | Avatar URL | [optional] 
**IsGroup** | **bool** | Whether this is a group | 
**IsBusiness** | Pointer to **bool** | Whether this is a business account | [optional] 
**PlatformMetadata** | Pointer to **map[string]interface{}** | Platform-specific metadata | [optional] 

## Methods

### NewContact

`func NewContact(platformUserId string, isGroup bool, ) *Contact`

NewContact instantiates a new Contact object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewContactWithDefaults

`func NewContactWithDefaults() *Contact`

NewContactWithDefaults instantiates a new Contact object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetPlatformUserId

`func (o *Contact) GetPlatformUserId() string`

GetPlatformUserId returns the PlatformUserId field if non-nil, zero value otherwise.

### GetPlatformUserIdOk

`func (o *Contact) GetPlatformUserIdOk() (*string, bool)`

GetPlatformUserIdOk returns a tuple with the PlatformUserId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetPlatformUserId

`func (o *Contact) SetPlatformUserId(v string)`

SetPlatformUserId sets PlatformUserId field to given value.


### GetDisplayName

`func (o *Contact) GetDisplayName() string`

GetDisplayName returns the DisplayName field if non-nil, zero value otherwise.

### GetDisplayNameOk

`func (o *Contact) GetDisplayNameOk() (*string, bool)`

GetDisplayNameOk returns a tuple with the DisplayName field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetDisplayName

`func (o *Contact) SetDisplayName(v string)`

SetDisplayName sets DisplayName field to given value.

### HasDisplayName

`func (o *Contact) HasDisplayName() bool`

HasDisplayName returns a boolean if a field has been set.

### GetPhone

`func (o *Contact) GetPhone() string`

GetPhone returns the Phone field if non-nil, zero value otherwise.

### GetPhoneOk

`func (o *Contact) GetPhoneOk() (*string, bool)`

GetPhoneOk returns a tuple with the Phone field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetPhone

`func (o *Contact) SetPhone(v string)`

SetPhone sets Phone field to given value.

### HasPhone

`func (o *Contact) HasPhone() bool`

HasPhone returns a boolean if a field has been set.

### GetAvatarUrl

`func (o *Contact) GetAvatarUrl() string`

GetAvatarUrl returns the AvatarUrl field if non-nil, zero value otherwise.

### GetAvatarUrlOk

`func (o *Contact) GetAvatarUrlOk() (*string, bool)`

GetAvatarUrlOk returns a tuple with the AvatarUrl field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetAvatarUrl

`func (o *Contact) SetAvatarUrl(v string)`

SetAvatarUrl sets AvatarUrl field to given value.

### HasAvatarUrl

`func (o *Contact) HasAvatarUrl() bool`

HasAvatarUrl returns a boolean if a field has been set.

### GetIsGroup

`func (o *Contact) GetIsGroup() bool`

GetIsGroup returns the IsGroup field if non-nil, zero value otherwise.

### GetIsGroupOk

`func (o *Contact) GetIsGroupOk() (*bool, bool)`

GetIsGroupOk returns a tuple with the IsGroup field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetIsGroup

`func (o *Contact) SetIsGroup(v bool)`

SetIsGroup sets IsGroup field to given value.


### GetIsBusiness

`func (o *Contact) GetIsBusiness() bool`

GetIsBusiness returns the IsBusiness field if non-nil, zero value otherwise.

### GetIsBusinessOk

`func (o *Contact) GetIsBusinessOk() (*bool, bool)`

GetIsBusinessOk returns a tuple with the IsBusiness field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetIsBusiness

`func (o *Contact) SetIsBusiness(v bool)`

SetIsBusiness sets IsBusiness field to given value.

### HasIsBusiness

`func (o *Contact) HasIsBusiness() bool`

HasIsBusiness returns a boolean if a field has been set.

### GetPlatformMetadata

`func (o *Contact) GetPlatformMetadata() map[string]interface{}`

GetPlatformMetadata returns the PlatformMetadata field if non-nil, zero value otherwise.

### GetPlatformMetadataOk

`func (o *Contact) GetPlatformMetadataOk() (*map[string]interface{}, bool)`

GetPlatformMetadataOk returns a tuple with the PlatformMetadata field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetPlatformMetadata

`func (o *Contact) SetPlatformMetadata(v map[string]interface{})`

SetPlatformMetadata sets PlatformMetadata field to given value.

### HasPlatformMetadata

`func (o *Contact) HasPlatformMetadata() bool`

HasPlatformMetadata returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


