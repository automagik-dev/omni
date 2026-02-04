# ListInstanceContacts200ResponseItemsInner

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

### NewListInstanceContacts200ResponseItemsInner

`func NewListInstanceContacts200ResponseItemsInner(platformUserId string, isGroup bool, ) *ListInstanceContacts200ResponseItemsInner`

NewListInstanceContacts200ResponseItemsInner instantiates a new ListInstanceContacts200ResponseItemsInner object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewListInstanceContacts200ResponseItemsInnerWithDefaults

`func NewListInstanceContacts200ResponseItemsInnerWithDefaults() *ListInstanceContacts200ResponseItemsInner`

NewListInstanceContacts200ResponseItemsInnerWithDefaults instantiates a new ListInstanceContacts200ResponseItemsInner object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetPlatformUserId

`func (o *ListInstanceContacts200ResponseItemsInner) GetPlatformUserId() string`

GetPlatformUserId returns the PlatformUserId field if non-nil, zero value otherwise.

### GetPlatformUserIdOk

`func (o *ListInstanceContacts200ResponseItemsInner) GetPlatformUserIdOk() (*string, bool)`

GetPlatformUserIdOk returns a tuple with the PlatformUserId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetPlatformUserId

`func (o *ListInstanceContacts200ResponseItemsInner) SetPlatformUserId(v string)`

SetPlatformUserId sets PlatformUserId field to given value.


### GetDisplayName

`func (o *ListInstanceContacts200ResponseItemsInner) GetDisplayName() string`

GetDisplayName returns the DisplayName field if non-nil, zero value otherwise.

### GetDisplayNameOk

`func (o *ListInstanceContacts200ResponseItemsInner) GetDisplayNameOk() (*string, bool)`

GetDisplayNameOk returns a tuple with the DisplayName field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetDisplayName

`func (o *ListInstanceContacts200ResponseItemsInner) SetDisplayName(v string)`

SetDisplayName sets DisplayName field to given value.

### HasDisplayName

`func (o *ListInstanceContacts200ResponseItemsInner) HasDisplayName() bool`

HasDisplayName returns a boolean if a field has been set.

### GetPhone

`func (o *ListInstanceContacts200ResponseItemsInner) GetPhone() string`

GetPhone returns the Phone field if non-nil, zero value otherwise.

### GetPhoneOk

`func (o *ListInstanceContacts200ResponseItemsInner) GetPhoneOk() (*string, bool)`

GetPhoneOk returns a tuple with the Phone field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetPhone

`func (o *ListInstanceContacts200ResponseItemsInner) SetPhone(v string)`

SetPhone sets Phone field to given value.

### HasPhone

`func (o *ListInstanceContacts200ResponseItemsInner) HasPhone() bool`

HasPhone returns a boolean if a field has been set.

### GetAvatarUrl

`func (o *ListInstanceContacts200ResponseItemsInner) GetAvatarUrl() string`

GetAvatarUrl returns the AvatarUrl field if non-nil, zero value otherwise.

### GetAvatarUrlOk

`func (o *ListInstanceContacts200ResponseItemsInner) GetAvatarUrlOk() (*string, bool)`

GetAvatarUrlOk returns a tuple with the AvatarUrl field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetAvatarUrl

`func (o *ListInstanceContacts200ResponseItemsInner) SetAvatarUrl(v string)`

SetAvatarUrl sets AvatarUrl field to given value.

### HasAvatarUrl

`func (o *ListInstanceContacts200ResponseItemsInner) HasAvatarUrl() bool`

HasAvatarUrl returns a boolean if a field has been set.

### GetIsGroup

`func (o *ListInstanceContacts200ResponseItemsInner) GetIsGroup() bool`

GetIsGroup returns the IsGroup field if non-nil, zero value otherwise.

### GetIsGroupOk

`func (o *ListInstanceContacts200ResponseItemsInner) GetIsGroupOk() (*bool, bool)`

GetIsGroupOk returns a tuple with the IsGroup field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetIsGroup

`func (o *ListInstanceContacts200ResponseItemsInner) SetIsGroup(v bool)`

SetIsGroup sets IsGroup field to given value.


### GetIsBusiness

`func (o *ListInstanceContacts200ResponseItemsInner) GetIsBusiness() bool`

GetIsBusiness returns the IsBusiness field if non-nil, zero value otherwise.

### GetIsBusinessOk

`func (o *ListInstanceContacts200ResponseItemsInner) GetIsBusinessOk() (*bool, bool)`

GetIsBusinessOk returns a tuple with the IsBusiness field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetIsBusiness

`func (o *ListInstanceContacts200ResponseItemsInner) SetIsBusiness(v bool)`

SetIsBusiness sets IsBusiness field to given value.

### HasIsBusiness

`func (o *ListInstanceContacts200ResponseItemsInner) HasIsBusiness() bool`

HasIsBusiness returns a boolean if a field has been set.

### GetPlatformMetadata

`func (o *ListInstanceContacts200ResponseItemsInner) GetPlatformMetadata() map[string]interface{}`

GetPlatformMetadata returns the PlatformMetadata field if non-nil, zero value otherwise.

### GetPlatformMetadataOk

`func (o *ListInstanceContacts200ResponseItemsInner) GetPlatformMetadataOk() (*map[string]interface{}, bool)`

GetPlatformMetadataOk returns a tuple with the PlatformMetadata field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetPlatformMetadata

`func (o *ListInstanceContacts200ResponseItemsInner) SetPlatformMetadata(v map[string]interface{})`

SetPlatformMetadata sets PlatformMetadata field to given value.

### HasPlatformMetadata

`func (o *ListInstanceContacts200ResponseItemsInner) HasPlatformMetadata() bool`

HasPlatformMetadata returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


