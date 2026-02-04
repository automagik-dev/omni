# ListInstanceGroups200ResponseItemsInner

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**ExternalId** | **string** | External group ID | 
**Name** | Pointer to **string** | Group name | [optional] 
**Description** | Pointer to **string** | Group description | [optional] 
**MemberCount** | Pointer to **float32** | Number of members | [optional] 
**CreatedAt** | Pointer to **time.Time** | Creation timestamp | [optional] 
**CreatedBy** | Pointer to **string** | Creator ID | [optional] 
**IsReadOnly** | Pointer to **bool** | Whether group is read-only | [optional] 
**PlatformMetadata** | Pointer to **map[string]interface{}** | Platform-specific metadata | [optional] 

## Methods

### NewListInstanceGroups200ResponseItemsInner

`func NewListInstanceGroups200ResponseItemsInner(externalId string, ) *ListInstanceGroups200ResponseItemsInner`

NewListInstanceGroups200ResponseItemsInner instantiates a new ListInstanceGroups200ResponseItemsInner object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewListInstanceGroups200ResponseItemsInnerWithDefaults

`func NewListInstanceGroups200ResponseItemsInnerWithDefaults() *ListInstanceGroups200ResponseItemsInner`

NewListInstanceGroups200ResponseItemsInnerWithDefaults instantiates a new ListInstanceGroups200ResponseItemsInner object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetExternalId

`func (o *ListInstanceGroups200ResponseItemsInner) GetExternalId() string`

GetExternalId returns the ExternalId field if non-nil, zero value otherwise.

### GetExternalIdOk

`func (o *ListInstanceGroups200ResponseItemsInner) GetExternalIdOk() (*string, bool)`

GetExternalIdOk returns a tuple with the ExternalId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetExternalId

`func (o *ListInstanceGroups200ResponseItemsInner) SetExternalId(v string)`

SetExternalId sets ExternalId field to given value.


### GetName

`func (o *ListInstanceGroups200ResponseItemsInner) GetName() string`

GetName returns the Name field if non-nil, zero value otherwise.

### GetNameOk

`func (o *ListInstanceGroups200ResponseItemsInner) GetNameOk() (*string, bool)`

GetNameOk returns a tuple with the Name field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetName

`func (o *ListInstanceGroups200ResponseItemsInner) SetName(v string)`

SetName sets Name field to given value.

### HasName

`func (o *ListInstanceGroups200ResponseItemsInner) HasName() bool`

HasName returns a boolean if a field has been set.

### GetDescription

`func (o *ListInstanceGroups200ResponseItemsInner) GetDescription() string`

GetDescription returns the Description field if non-nil, zero value otherwise.

### GetDescriptionOk

`func (o *ListInstanceGroups200ResponseItemsInner) GetDescriptionOk() (*string, bool)`

GetDescriptionOk returns a tuple with the Description field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetDescription

`func (o *ListInstanceGroups200ResponseItemsInner) SetDescription(v string)`

SetDescription sets Description field to given value.

### HasDescription

`func (o *ListInstanceGroups200ResponseItemsInner) HasDescription() bool`

HasDescription returns a boolean if a field has been set.

### GetMemberCount

`func (o *ListInstanceGroups200ResponseItemsInner) GetMemberCount() float32`

GetMemberCount returns the MemberCount field if non-nil, zero value otherwise.

### GetMemberCountOk

`func (o *ListInstanceGroups200ResponseItemsInner) GetMemberCountOk() (*float32, bool)`

GetMemberCountOk returns a tuple with the MemberCount field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetMemberCount

`func (o *ListInstanceGroups200ResponseItemsInner) SetMemberCount(v float32)`

SetMemberCount sets MemberCount field to given value.

### HasMemberCount

`func (o *ListInstanceGroups200ResponseItemsInner) HasMemberCount() bool`

HasMemberCount returns a boolean if a field has been set.

### GetCreatedAt

`func (o *ListInstanceGroups200ResponseItemsInner) GetCreatedAt() time.Time`

GetCreatedAt returns the CreatedAt field if non-nil, zero value otherwise.

### GetCreatedAtOk

`func (o *ListInstanceGroups200ResponseItemsInner) GetCreatedAtOk() (*time.Time, bool)`

GetCreatedAtOk returns a tuple with the CreatedAt field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetCreatedAt

`func (o *ListInstanceGroups200ResponseItemsInner) SetCreatedAt(v time.Time)`

SetCreatedAt sets CreatedAt field to given value.

### HasCreatedAt

`func (o *ListInstanceGroups200ResponseItemsInner) HasCreatedAt() bool`

HasCreatedAt returns a boolean if a field has been set.

### GetCreatedBy

`func (o *ListInstanceGroups200ResponseItemsInner) GetCreatedBy() string`

GetCreatedBy returns the CreatedBy field if non-nil, zero value otherwise.

### GetCreatedByOk

`func (o *ListInstanceGroups200ResponseItemsInner) GetCreatedByOk() (*string, bool)`

GetCreatedByOk returns a tuple with the CreatedBy field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetCreatedBy

`func (o *ListInstanceGroups200ResponseItemsInner) SetCreatedBy(v string)`

SetCreatedBy sets CreatedBy field to given value.

### HasCreatedBy

`func (o *ListInstanceGroups200ResponseItemsInner) HasCreatedBy() bool`

HasCreatedBy returns a boolean if a field has been set.

### GetIsReadOnly

`func (o *ListInstanceGroups200ResponseItemsInner) GetIsReadOnly() bool`

GetIsReadOnly returns the IsReadOnly field if non-nil, zero value otherwise.

### GetIsReadOnlyOk

`func (o *ListInstanceGroups200ResponseItemsInner) GetIsReadOnlyOk() (*bool, bool)`

GetIsReadOnlyOk returns a tuple with the IsReadOnly field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetIsReadOnly

`func (o *ListInstanceGroups200ResponseItemsInner) SetIsReadOnly(v bool)`

SetIsReadOnly sets IsReadOnly field to given value.

### HasIsReadOnly

`func (o *ListInstanceGroups200ResponseItemsInner) HasIsReadOnly() bool`

HasIsReadOnly returns a boolean if a field has been set.

### GetPlatformMetadata

`func (o *ListInstanceGroups200ResponseItemsInner) GetPlatformMetadata() map[string]interface{}`

GetPlatformMetadata returns the PlatformMetadata field if non-nil, zero value otherwise.

### GetPlatformMetadataOk

`func (o *ListInstanceGroups200ResponseItemsInner) GetPlatformMetadataOk() (*map[string]interface{}, bool)`

GetPlatformMetadataOk returns a tuple with the PlatformMetadata field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetPlatformMetadata

`func (o *ListInstanceGroups200ResponseItemsInner) SetPlatformMetadata(v map[string]interface{})`

SetPlatformMetadata sets PlatformMetadata field to given value.

### HasPlatformMetadata

`func (o *ListInstanceGroups200ResponseItemsInner) HasPlatformMetadata() bool`

HasPlatformMetadata returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


